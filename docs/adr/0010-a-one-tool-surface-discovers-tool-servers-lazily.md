# A one-tool cell surface discovers its tool servers lazily, and owns the section pi would have written

A code-mode session puts exactly one tool in front of the model: `python`. Everything else is reached from a
cell — by the tool bridge, by the skill bridge, by an owner's publication. MCP servers were the exception, and
they failed in both directions at once. pi's built-in MCP extension connects **every** enabled server in
`mcp.json` on `session_start`, whether or not the session will ever call one, and tells the model about them
through a system-prompt section (`mcp_servers`) that lists only servers whose tools are reached by *pi's*
indirect mechanisms — `codemode` or `tool_search` — neither of which this repo's surface has. So the eager
connect was paid for and then unused, and the discovery text was unreadable anyway: measured 2026-10-15, a
configured server reached a governed session's first prompt as **nothing at all**, and the section appeared
only after a cell had already spelled `mcp__<server>__<tool>` — a circularity, since naming a server is
exactly what the model cannot do until it has been told the name.

`packages/mcp-lazy` replaces that extension (`-builtin:mcp`, and its `loadConfig` returns an empty config so
pi's own bookkeeping can neither connect a server nor activate a tool underneath the `["python"]` surface).
What this decision settles is what replaces the *behaviour*: the eager connect goes, and the discovery text
stays — but written by us, from the union pi would have ignored, and connecting nothing.

**The two layers.** An **eager layer**: mcp-lazy's own `before_agent_start` writes pi's `mcp_servers`
section — one line per server, `- mcp__<server>: <one-liner>`, alphabetical, over the configured *plus*
registered union, under pi's 4096-character inner cap, with pi's own sacrifice order (descriptions before
names; a tail omitted behind a count once even bare names stop fitting) and one correction pi cannot make:
our truncator cuts at whitespace and never inside a URL. An **on-demand layer**: one publication into the tool
bridge's owners slot, so `await tool("mcp__<server>")` answers that server's inventory — its own
`instructions`, then each tool with its description and parameter names — and is the **only** call that
connects it, bounded at 30 s and abort-aware. `await tool("mcp__<server>__<tool>")` is not in that catalogue,
so the owner raises `NameError` and code mode's existing MCP dispatch takes it. Nothing in code mode changed
to make the route exist.

Three properties are the decision, and each was a trade-off:

- **A name is cheap, a connection is not.** The eager layer may be read by every request and starts nothing;
  the detail layer starts exactly the server the model named, and only then. The claim is measured, not
  argued: a configured server that no cell names leaves its spawn witness untouched, and a named one starts
  once (`.scratch/mcp-discovery/acceptance.md`, R6/R7).
- **We render a section pi refuses to export.** `renderServersSection`, `MCP_SERVERS_SECTION` and its cap are
  declared in pi's shipped types and excluded from its package exports, so mcp-lazy renders its own line
  format, its own cap arithmetic and its own omission line ("call `tool()` to list them all") — and it is the
  section's **single writer**, registered *after* `createMcpExtension(...)(pi)` in the same factory, because
  section ownership is load order and the embedded instance deletes `mcp_servers` in the same turn when its
  own list is empty.
- **Discovery is taught, not implied.** mcp-lazy's session contribution carries a 77-character guideline —
  what the call answers, and that the call is what starts the server — so the route survives a session whose
  prompt is forced by another extension and every section is dropped from the request. It costs 79 bytes in
  `<rules>` and appears only when the session has a configured server.

It is **hard to reverse**: the section is written by behaviour that lives in one package and pinned by a bar
of thirteen rows, the accept-the-congestion alternative is a config change away but the discovery text would
then be pi's again and the model would learn nothing before it acted, and reverting means re-owning a prompt
section pi does not export. It is **surprising without this context**: a reader finds a repo writing a section
named after pi's own, a section writer ordered after another extension's, and a cell call whose name looks
like pi's tool naming (`mcp__…`) but which answers prose. And it was a **real trade-off** — against the three
options below, each of which this repo could have taken.

The alternatives, and why not:

- **Let the built-in extension do it, and accept the eager connects.** Simplest by far, and rejected: those
  connections are the thing `mcp-lazy` exists to remove, and the built-in's discovery bookkeeping can activate
  `tool_search` underneath the one-tool surface.
- **Teach the model to read `mcp.json` itself, with `bash`.** No section, no publication. Rejected: it makes
  the model parse a host-specific config with two files and override semantics, it is invisible to a person
  reading the prompt, and it fails in a `--readonly` session — which is exactly where the *listing* should
  still work.
- **Declare the servers' tools to the model** (`exposure: "direct"`, or reviving `tool_search`), so discovery
  is ordinary tool listing. Rejected: it is the one-tool surface the whole architecture rests on. The
  concession made instead is `toolExposure` hygiene: a config that asks for `direct` — at server or tool level
  — is rewritten to the undisclosed reach before registration, with a notice naming what was changed.
- **A second capability-ranked search across servers** (pi's `tool_search` in a cell, our own BM25 over the
  server list). Deferred rather than rejected: built where it earns its place — a `query` argument inside one
  connected server's inventory, copying pi's own document and parameters — and the *list* stays the eager
  layer's job while it is human-scale.

Cross-references: `docs/adr/0003-one-composition-root-for-the-cells-host-surface.md` (the seam the route
arrives through), `0005-an-owner-moves-its-tools-effect-into-the-executor.md` (what an owner is, and why a
name in the catalogue must not also be a callable pi tool), `0007-an-egress-slot-for-a-sessions-network-policy.md`
(an MCP call is a network call no gate inspects — a gap this map recorded as out of scope, not one it
introduced), and `../GLOSSARY.md` § MCP discovery.

Built by wayfinder map `.scratch/mcp-discovery/` (commits `f3289b1`, `4b5cf49`; bar
`.scratch/mcp-discovery/acceptance.md`).
