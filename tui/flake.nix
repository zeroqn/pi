{
  description = "The Rust pi client (rpi) and the ahead-of-time pi host it drives";

  # pi's own flake pins this revision, so both trees share a nixpkgs and a toolchain.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/3ed67ec0a4d3c7ab4ae1f04f8ee8df07bfa506a2";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAll = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: import nixpkgs { inherit system; };

      # This tree without build output. `nix build` from a plain directory copies everything it is pointed
      # at, and `target/` and `results/` are gigabytes.
      src = nixpkgs.lib.cleanSourceWith {
        src = self;
        filter =
          path: type:
          !(builtins.elem (builtins.baseNameOf path) [
            "target"
            "results"
            ".git"
          ]);
      };

      clientFor = system: (pkgsFor system).callPackage ./nix/package.nix { inherit src; };

      # AOT needs a Bun with `--aot`; see nix/runtime.nix for why that is a canary build.
      runtimeFor = system: (pkgsFor system).callPackage ./nix/runtime.nix { };

      # The ONNX Runtime ABI shim the vendored `onnxruntime-node` binding in
      # `../packages/onnxruntime-node` is loaded against; see nix/onnxruntime-shim/default.nix. The host
      # embeds the canary Bun above (>= 1.4), so Magic Context's local embeddings take the native path.
      shimFor = system: (pkgsFor system).callPackage ./nix/onnxruntime-shim { };

      devShellFor =
        system:
        let
          lib = nixpkgs.lib;
          pkgs = pkgsFor system;
          runtime = runtimeFor system;
          shim = shimFor system;
          # The release flow's scripts: the host build, the tarballs a release page carries, the gate, and
          # the pin update. Each is installed under its own name so `nix develop --command <name>` finds it.
          script = name: extension: pkgs.stdenvNoCC.mkDerivation {
            name = lib.removeSuffix extension name;
            src = ./. + "/nix/${name}";
            dontUnpack = true;
            installPhase = "install -Dm755 $src $out/bin/${lib.removeSuffix extension name}";
          };
        in
        pkgs.mkShell {
          name = "pi-tui";

          # An attribute, not a `shellHook` export: `nix develop --command` builds its environment from the
          # derivation and never runs the hook, and a script in a shell must find the runtime too.
          PI_TUI_RUNTIME = "${runtime}/bin/bun";

          packages = [
            pkgs.cargo
            pkgs.rustc
            pkgs.rustfmt
            pkgs.clippy
            pkgs.nodejs_22
            pkgs.git
            pkgs.python3
            pkgs.unzip
            pkgs.jq
            pkgs.patchelf
            pkgs.pkg-config
            pkgs.cacert
            pkgs.curl
            pkgs.openssl
            runtime
            # What Magic Context's native embeddings load: the shim directory the loader is fed and the
            # real ONNX Runtime it forwards to are both exported below.
            shim
            (script "aot-host.sh" ".sh")
            (script "aot-release.sh" ".sh")
            (script "tui-release.sh" ".sh")
            (script "aot-smoke.sh" ".sh")
            (script "onnxruntime-check.sh" ".sh")
            (script "bun-pin-update.sh" ".sh")
            (script "bun-pin-tools.py" ".py")
          ];

          shellHook = ''
            # Magic Context's local embeddings are native on this host — it embeds the canary Bun above,
            # which is >= 1.4 — and what they load is the binding `../packages/onnxruntime-node` ships.
            # Two exports are the whole contract, and both are needed by the *launching* environment:
            # glibc reads LD_LIBRARY_PATH at program start, and the shim reads its target in the same
            # process. `LD_LIBRARY_PATH` names the shim's directory (the one place the binding's
            # `NEEDED libonnxrtabi24.so.1` can be satisfied) and libstdc++/libgcc_s for the binding's
            # other needs; `ONNXRUNTIME_LIB_PATH` names the *real* library's directory — the flake's own
            # `onnxruntime`, never the shim itself, which the shim refuses rather than absorbs.
            #
            # Set, not defaulted, unlike PI_REPO below: an inherited `ONNXRUNTIME_LIB_PATH` may name a
            # library built against a glibc this shell's host cannot load, and the shim answers that with
            # `_exit(1)` — which takes the whole pi process with it the first time an embedding runs.
            export ONNXRUNTIME_LIB_PATH="${pkgs.onnxruntime}/lib"
            export LD_LIBRARY_PATH="${shim}/lib:${pkgs.stdenv.cc.cc.lib}/lib''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

            # The pi tree the host is built from: this checkout's sibling, or set PI_REPO first.
            export PI_REPO="''${PI_REPO:-$(cd "$PWD/../../pi" 2>/dev/null && pwd || true)}"
            # The extensions repository this flake's `tui/` sits in — what `onnxruntime-check` reads the
            # vendored member and the Magic Context chunk from.
            export PI_TUI_EXTENSIONS="''${PI_TUI_EXTENSIONS:-$(cd "$PWD/.." 2>/dev/null && pwd || true)}"
            export PI_TUI_OUT="''${PI_TUI_OUT:-$PWD/results/pi}"
            # Every client in this shell drives the host this shell builds, not whatever `pi` is on PATH.
            export PI_TUI_HOST="''${PI_TUI_HOST:-$PI_TUI_OUT/pi}"

            echo "pi-tui: bun $("$PI_TUI_RUNTIME" --version), node $(node --version)"
            echo "pi-tui: PI_REPO=''${PI_REPO:-<unset>} PI_TUI_OUT=$PI_TUI_OUT"
            echo "pi-tui: aot-host | aot-release | tui-release | aot-smoke | onnxruntime-check | bun-pin-update | cargo build"
          '';
        };
    in
    {
      # The release artifacts of nix/manifest.nix, installed without compiling anything, and the source
      # build of the client. `pi-aot` and `rpi-bin` appear only for a platform that has been released.
      packages = forAll (
        system:
        let
          pkgs = pkgsFor system;
          prebuilt = pkgs.callPackage ./nix/prebuilt.nix { onnxruntimeShim = shimFor system; };
          manifest = import ./nix/manifest.nix;
          manifestTui = import ./nix/manifest-tui.nix;
          released = manifest.${system} or { };
          releasedTui = manifestTui.${system} or { };
        in
        {
          rpi = clientFor system;
          default = clientFor system;
          bun-aot = runtimeFor system;
          # The ABI shim `.#pi-aot`'s wrapper exports, and what `onnxruntime-check` runs against.
          onnxruntime-shim = shimFor system;
        }
        // nixpkgs.lib.optionalAttrs (released ? piAot) {
          pi-aot = prebuilt.mkPiAot released.piAot;
        }
        // nixpkgs.lib.optionalAttrs (releasedTui ? piTui) {
          # The client's own stream: released independently of pi, see nix/manifest-tui.nix.
          rpi-bin = prebuilt.mkPiTui releasedTui.piTui;
        }
      );

      devShells = forAll (system: {
        default = devShellFor system;
      });

      apps = forAll (system: {
        default = {
          type = "app";
          program = "${(clientFor system)}/bin/pi";
          meta.description = "The Rust pi client";
        };
        rpi = {
          type = "app";
          program = "${(clientFor system)}/bin/rpi";
          meta.description = "The Rust pi client, without the wrapper";
        };
      });

      formatter = forAll (system: (pkgsFor system).nixfmt-rfc-style);
    };
}
