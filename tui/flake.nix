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

      devShellFor =
        system:
        let
          lib = nixpkgs.lib;
          pkgs = pkgsFor system;
          runtime = runtimeFor system;
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
            (script "aot-host.sh" ".sh")
            (script "aot-release.sh" ".sh")
            (script "aot-smoke.sh" ".sh")
            (script "bun-pin-update.sh" ".sh")
            (script "bun-pin-tools.py" ".py")
          ];

          shellHook = ''
            # The pi tree the host is built from: this checkout's sibling, or set PI_REPO first.
            export PI_REPO="''${PI_REPO:-$(cd "$PWD/../../pi" 2>/dev/null && pwd || true)}"
            export PI_TUI_OUT="''${PI_TUI_OUT:-$PWD/results/pi}"
            # Every client in this shell drives the host this shell builds, not whatever `pi` is on PATH.
            export PI_TUI_HOST="''${PI_TUI_HOST:-$PI_TUI_OUT/pi}"

            echo "pi-tui: bun $("$PI_TUI_RUNTIME" --version), node $(node --version)"
            echo "pi-tui: PI_REPO=''${PI_REPO:-<unset>} PI_TUI_OUT=$PI_TUI_OUT"
            echo "pi-tui: aot-host | aot-release | aot-smoke | bun-pin-update | cargo build | nix build .#rpi"
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
          prebuilt = pkgs.callPackage ./nix/prebuilt.nix { };
          manifest = import ./nix/manifest.nix;
          released = manifest.${system} or { };
        in
        {
          rpi = clientFor system;
          default = clientFor system;
          bun-aot = runtimeFor system;
        }
        // nixpkgs.lib.optionalAttrs (released ? piAot) {
          pi-aot = prebuilt.mkPiAot released.piAot;
        }
        // nixpkgs.lib.optionalAttrs (released ? piTui) {
          rpi-bin = prebuilt.mkPiTui released.piTui;
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
