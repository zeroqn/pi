# pi-skill-bridge

Shows skills on a code-mode surface. pi renders its `<available_skills>` block only when `read` or
`bash` is active, and a code-mode session's surface is `["python"]` — so pi loads every skill and
renders none. This package renders the block itself, owns the `skill()` / `skills()` call form in the
kernel, and asks **providers** for the skills it does not have in hand.

- **The human tier** — everything pi loaded — comes from the `before_agent_start` event. This package
  never reads `~/.pi/agent/skills` itself.
- **A provider** — another package's store — registers per session on
  `Symbol.for("pi-skill-bridge:providers")` with `{ owner, apiVersion: 1, list(), read(name) }`. This
  package never learns a store's layout; `read(name)` is the only door.
- **One call form.** `skill(name)` answers for both tiers as `{ content, files }`; `skills()` lists
  what the providers supply. The names are frozen: a dump-restored kernel calls them by bare name, and
  a provider's usage evidence may be a `skill_host` name match in code-mode's journal.

The design, the reasons, and the acceptance bar live in `.scratch/skill-bridge/`
(`map.md`, `issues/01-the-settled-design.md`, `acceptance.md`).
