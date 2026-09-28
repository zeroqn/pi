# pi-fff (prebuilt)

`@ff-labs/pi-fff` from **[zeroqn/fff](https://github.com/zeroqn/fff)**, branch `pi` — upstream plus two
commits:

1. **the engine slot** — `Symbol.for("pi-fff:finder")` publishes `{ apiVersion, activeCwd(), route() }`,
   so another extension in the process (a code-mode kernel's `grep`/`find`) can answer from FFF's index.
2. **`engine-only`** — a fourth mode that registers no pi tool at all, keeping the finder and the `@`
   autocomplete. A session whose host owns the tool surface wants exactly this.

**This directory is generated.** `.github/workflows/fff.yml` rebuilds it from `vendor/fff` on every push
to `main` and commits the result; `check` in the same workflow fails when the stamp does not match the
submodule pin, so the directory can never quietly lag the fork. Do not edit `index.js` by hand.

| file | where it comes from |
|---|---|
| `index.js` | `bun build vendor/fff/packages/pi-fff/src/index.ts` — one bundle, native SDK and pi runtime external |
| `pi-fff.schema.json` | copied from the submodule (the editor schema for `pi-fff.json`) |
| `package.json` | hand-written, except `version` and `builtFrom`, which CI stamps |

`version` is **upstream's own rule** for a commit that is not a release tag, applied to the pin: the
patch in `crates/fff-core/Cargo.toml` is bumped and the commit appended — `0.11.1-nightly.2c45bec` says
"upstream's 0.11.0 line, one commit into the next patch, built from `2c45bec`". Upstream reads the same
file in `scripts/determine-version.lua` for the same purpose, so this cannot disagree with their npm
versions.

A *release* pin is deliberately not expressible here: a GitHub fork advertises **no tags at all**
(`git ls-remote --tags https://github.com/zeroqn/fff` is empty while upstream has 862), so the
`describe --exact-match` branch of upstream's rule can never fire against this submodule. `builtFrom`
carries `commit`, `shortCommit` and `upstreamVersion` — what the string is derived from — and the
workflow recomputes the version from them rather than trusting it.

Rebuild locally:

```bash
git submodule update --init vendor/fff
bun build vendor/fff/packages/pi-fff/src/index.ts --target=node --format=esm \
  --outfile=packages/pi-fff/index.js \
  --external '@ff-labs/fff-node' --external '@ff-labs/fff-bun' \
  --external '@earendil-works/pi-coding-agent' --external '@earendil-works/pi-tui' \
  --external '@sinclair/typebox'
cp vendor/fff/packages/pi-fff/pi-fff.schema.json packages/pi-fff/
```

The native side is never bundled: `@ff-labs/fff-node`/`fff-bun` are `dependencies` here and `ffi-rs`
dlopens the `@ff-labs/fff-bin-*` `.so` at runtime.
