# One package owns the code-mode skills surface, and stores supply skills as providers

pi renders its `<available_skills>` block only when `read` or `bash` is active
(`core/system-prompt.js:14`), and a code-mode session's surface is `["python"]` — so pi loads every
skill and renders none. The first fix put the whole surface inside the extension that knew the learned
store: it rendered the block, owned the `skill()` / `skills()` call form, and contributed the host
functions to code mode's kernel. That made a pi-level asset — the skills pi had already loaded —
disappear whenever that extension was absent, disabled, or refused, which is a strange thing for an
unrelated switch to cost. We therefore split the two roles: `pi-skill-bridge` owns the **surface** (the
block and the call form) and knows nothing about any store, while a **provider** supplies the skills it
owns through a per-session `list()` / `read(name)` rendezvous on
`Symbol.for("pi-skill-bridge:providers")`. The store's owner becomes a provider and keeps its store.

## Considered options

- **The store's owner keeps the surface.** The status quo, and the reason for the change: a code-mode
  session with that extension absent is told about *no* skills, including the ones pi loaded itself.
- **Code mode owns the surface.** The candidate its own map's fog named ("the kernel could compensate
  with a sentence naming no owner"). Rejected twice over: code mode is manifest position 1, so a
  renderer there runs before the provider's and cannot defer to the richer block; and this repo's
  glossary puts a capability's host functions in the package that owns the capability, not in the
  kernel.
- **A render-only fallback, with the store's owner keeping the call form.** Cheaper — no kernel
  contribution, no third registry client — but it means two renderers, a rendezvous to decide which of
  them appends, and a call form that is uniform only when the owner is present. The uniformity is the
  point.
- **Chosen**: one package owns the block *and* the call form; stores are providers. The bridge mounts
  code mode itself (a third copy of the registry client — the price), renders pi's loaded skills plus
  every provider's, and answers `skill(name)` for both tiers.

## Consequences

- **Four names are frozen**: `skill`, `skills`, `skill_host`, `skills_host`. A dump-restored kernel
  calls the Python names by bare name without re-feeding the prelude, and a provider's usage evidence
  may be a `skill_host` name match in code-mode's journal.
- **A store's isolation is structural**: the bridge never reads a store's files, layout or payload
  declaration, and it raises rather than falling back to a file when a provider claims a name and cannot
  answer. The provider's `read(name)` is the only door.
- **One deliberate byte change**, named: `skill()`'s docstring, because it promised a learned-only
  lookup that the uniform call form no longer is. The composed prelude tail therefore no longer matches
  the capture that `.scratch/rsi-oneway` pinned.
- **Two display routes, one per surface.** Where pi can read files it renders the block itself, fed by
  the store owner's `resources_discover`; where it cannot, the bridge renders. A code-mode session
  therefore sees a learned skill twice — once through pi's loaded list, once through its provider —
  which is why the composition dedupes first-wins and routes reads provider-first.
