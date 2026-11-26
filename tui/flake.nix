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

      # That binding is vendored for `linux/x64` alone (`../packages/onnxruntime-node/bin/napi-v6/linux/x64`)
      # and `nix/onnxruntime-shim/default.nix` declares the same one platform, so the shim exists nowhere
      # else. The list is written here rather than read from the declared `meta.platforms`, because
      # *evaluating* the package on another platform is the failure this avoids: nixpkgs refuses it while the
      # derivation is built — `Refusing to evaluate package 'onnxruntime-shim-1.24.3' … because it is not
      # available on the requested hostPlatform` — before any attribute of it can be inspected, which is how
      # an `aarch64-linux` dev shell broke once the shim entered it. That platform's release leg is gone, but
      # this dev shell is still evaluated on arm64, so the list stays. Keep the two in step.
      hasShim = system: builtins.elem system [ "x86_64-linux" ];

      devShellFor =
        system:
        let
          lib = nixpkgs.lib;
          pkgs = pkgsFor system;
          runtime = runtimeFor system;
          shim = shimFor system;
          # What Magic Context's native embeddings need in the environment of whatever launches pi: the
          # shim's directory on `LD_LIBRARY_PATH` (the one place the binding's `NEEDED libonnxrtabi24.so.1`
          # is satisfied, plus libstdc++/libgcc_s for its other needs) and the *real* library's directory in
          # `ONNXRUNTIME_LIB_PATH`, which the shim forwards to. Both are read by a *process* at start, so they
          # belong in the environment and not in an extension. Empty where there is no shim: the vendored
          # binding is `linux/x64`, so another platform has nothing to satisfy.
          embeddingExports = lib.optionalString (hasShim system) ''
            export ONNXRUNTIME_LIB_PATH="${pkgs.onnxruntime}/lib"
            export LD_LIBRARY_PATH="${shim}/lib:${pkgs.stdenv.cc.cc.lib}/lib''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
          '';
          # The release flow's scripts: the host build, the tarballs a release page carries, the gate, and
          # the pin update. Each is installed under its own name so `nix develop --command <name>` finds it.
          script = name: extension: pkgs.stdenvNoCC.mkDerivation {
            name = lib.removeSuffix extension name;
            src = ./. + "/nix/${name}";
            dontUnpack = true;
            installPhase = "install -Dm755 $src $out/bin/${lib.removeSuffix extension name}";
          };

          # `rpi` for the shell: the client you built, found where cargo put it. It is a launcher and not
          # the binary because the binary does not exist until `cargo build --release`, and it lives on
          # PATH as a package rather than as a shellHook export so `nix develop --command rpi` works too
          # (that mode never runs the hook — the same reason PI_TUI_RUNTIME is an attribute above).
          clientLauncher = pkgs.writeShellScriptBin "rpi" ''
            set -eu
            # The shell's own target directory, then the tree the caller is standing in: `target/` from
            # extensions/tui, `../target` from nix/, `../../target` from tools/harness.
            for dir in "''${CARGO_TARGET_DIR:-}" "$PWD/target" "$PWD/../target" "$PWD/../../target"; do
              [ -n "$dir" ] || continue
              if [ -x "$dir/release/rpi" ]; then exec "$dir/release/rpi" "$@"; fi
            done
            echo "rpi: no built client. Run 'cargo build --release' in extensions/tui." >&2
            echo "rpi: looked in ''${CARGO_TARGET_DIR:+$CARGO_TARGET_DIR }$PWD/target $PWD/../target $PWD/../../target" >&2
            exit 127
          '';
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
            # What the hook below hands the interactive shell over to, and what `nix develop -c fish` runs.
            pkgs.fish
            pkgs.unzip
            pkgs.jq
            pkgs.patchelf
            pkgs.pkg-config
            pkgs.cacert
            pkgs.curl
            pkgs.openssl
            runtime
            (script "aot-host.sh" ".sh")
            (script "aot-release.sh" ".sh")
            (script "tui-release.sh" ".sh")
            (script "aot-smoke.sh" ".sh")
            (script "onnxruntime-check.sh" ".sh")
            (script "bun-pin-update.sh" ".sh")
            (script "bun-pin-tools.py" ".py")
            clientLauncher
          ]
          # Appended rather than placed in the list above: `lib.optional` answers a *list*, so as a list
          # element it became a nested list, which nixpkgs 26.05 warns about and will refuse. What Magic
          # Context's native embeddings load: the shim's directory the loader is fed, and the real ONNX
          # Runtime it forwards to (both exported below), on the one platform that has a shim.
          ++ lib.optional (hasShim system) shim;

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
            ${embeddingExports}

            # The pi tree the host is built from: this checkout's sibling, or set PI_REPO first.
            export PI_REPO="''${PI_REPO:-$(cd "$PWD/../../pi" 2>/dev/null && pwd || true)}"
            # The extensions repository this flake's `tui/` sits in — what `onnxruntime-check` reads the
            # vendored member and the Magic Context chunk from.
            export PI_TUI_EXTENSIONS="''${PI_TUI_EXTENSIONS:-$(cd "$PWD/.." 2>/dev/null && pwd || true)}"
            export PI_TUI_OUT="''${PI_TUI_OUT:-$PWD/results/pi}"
            # Every client in this shell drives the host this shell builds, not whatever `pi` is on PATH.
            export PI_TUI_HOST="''${PI_TUI_HOST:-$PI_TUI_OUT/pi}"

            # No CARGO_TARGET_DIR override: `cargo build --release` writes `./target` where it is run, which
            # is extensions/tui per this README, and the `rpi` launcher looks there (and one and two
            # directories up) with `$CARGO_TARGET_DIR` honoured first. The shell used to name no target
            # directory at all, so the binary landed somewhere nothing knew and `rpi` was not a command.

            echo "pi-tui: bun $("$PI_TUI_RUNTIME" --version), node $(node --version)"
            echo "pi-tui: PI_REPO=''${PI_REPO:-<unset>} PI_TUI_OUT=$PI_TUI_OUT"
            echo "pi-tui: rpi -> the client cargo builds here (cargo build --release)"
            if [ ! -x "$PI_TUI_HOST" ]; then
              # The shell points PI_TUI_HOST at the host it builds, so a client run before `aot-host` fails
              # on a missing file. Say so here rather than letting the client report it.
              echo "pi-tui: no AOT host yet at $PI_TUI_HOST — run aot-host (or set PI_TUI_HOST to another pi)"
            fi
            echo "pi-tui: aot-host | aot-release | tui-release | aot-smoke | onnxruntime-check | bun-pin-update | cargo build"

            # The interactive shell is fish. `nix develop` has no knob for this: it runs nixpkgs'
            # bashInteractive and overrides `SHELL` in the environment it builds (nix's src/nix/develop.cc),
            # and stdenv's setup exports `SHELL` again, so a `SHELL` attribute here is ignored. This hook is
            # therefore the only place left, and it runs *inside* that bash. `$-` carries `i` only when the
            # bash nix started is interactive (it is started without `-c` and reads a terminal); `nix develop
            # -c` instead runs this same script non-interactively and then execs its command, so a command
            # keeps bash. Note the trade a fish shell makes: stdenv's exported bash functions (`genericBuild`,
            # `buildPhase`) exist only in bash — use `nix develop -c bash` or `--phase build` for those.
            case $- in
              *i*)
                # `SHELL` names the shell you are in, not the bash nix started.
                export SHELL=${pkgs.fish}/bin/fish
                exec ${pkgs.fish}/bin/fish
                ;;
            esac
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
          # A shim only where one exists: `nix/prebuilt.nix` leaves the embeddings' exports out of the
          # wrapper when it is `null` (see `hasShim`), so a host on another platform names no package that
          # would not evaluate.
          prebuilt = pkgs.callPackage ./nix/prebuilt.nix {
            onnxruntimeShim = if hasShim system then shimFor system else null;
          };
          manifest = import ./nix/manifest.nix;
          manifestTui = import ./nix/manifest-tui.nix;
          released = manifest.${system} or { };
          releasedTui = manifestTui.${system} or { };
        in
        {
          rpi = clientFor system;
          default = clientFor system;
          bun-aot = runtimeFor system;
        }
        // nixpkgs.lib.optionalAttrs (hasShim system) {
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
