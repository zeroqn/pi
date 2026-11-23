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
          pkgs = pkgsFor system;
          runtime = runtimeFor system;
          aotHost = pkgs.stdenvNoCC.mkDerivation {
            name = "aot-host";
            src = ./nix/aot-host.sh;
            dontUnpack = true;
            installPhase = "install -Dm755 $src $out/bin/aot-host";
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
            runtime
            aotHost
          ];

          shellHook = ''
            # The pi tree the host is built from: this checkout's sibling, or set PI_REPO first.
            export PI_REPO="''${PI_REPO:-$(cd "$PWD/../../pi" 2>/dev/null && pwd || true)}"
            export PI_TUI_OUT="''${PI_TUI_OUT:-$PWD/results/pi}"
            # Every client in this shell drives the host this shell builds, not whatever `pi` is on PATH.
            export PI_TUI_HOST="''${PI_TUI_HOST:-$PI_TUI_OUT/pi}"

            echo "pi-tui: bun $("$PI_TUI_RUNTIME" --version), node $(node --version)"
            echo "pi-tui: PI_REPO=''${PI_REPO:-<unset>} PI_TUI_OUT=$PI_TUI_OUT"
            echo "pi-tui: aot-host | cargo build --release | rpi | nix build .#rpi"
          '';
        };
    in
    {
      packages = forAll (system: {
        rpi = clientFor system;
        default = clientFor system;
      });

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
