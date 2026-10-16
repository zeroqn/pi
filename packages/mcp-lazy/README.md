# pi-mcp-lazy — MCP servers that connect when a cell names one

pi's built-in MCP extension reads `mcp.json` on `session_start` and connects every enabled server in the
background, whether or not the session will ever call one. In a code-mode session the model's whole
surface is `python`, so those connections are paid for up front and then sit unused — and because MCP
tools are not declared to the model, the extension's discovery bookkeeping can activate the codemode
tool underneath code mode's `["python"]` surface.

This package replaces that extension with a lazy one:

- `mcp.json` is still read from pi's own locations, and project overrides and `enabled: false` still
  work.
- No server connects at startup.
- When a `tool_call` for `python` arrives, the cell's `code` is scanned for MCP tool names
  (`mcp__<server>__<tool>`). Every configured server the cell names is registered then, and the handler
  waits — bounded, abort-aware — until that server's tools appear, so the connection is already in
  flight when the cell's call reaches pi.
- pi's active tool set is never touched. It stays `python`.

## Why `loadConfig` returns nothing

`createMcpExtension` reads `loadConfig(ctx)` on `session_start` and treats those entries as
authoritative: in its own `registeredServers()`, a server registered with `pi.registerMcpServer()`
whose name matches **any** entry `loadConfig` returned is skipped as "overridden"
(`packages/coding-agent/src/extensions/mcp/index.ts:344-362`). A `loadConfig` that returned the real
`mcp.json` would therefore make every dynamic registration this package exists to perform dead on
arrival.

So the extension hands `createMcpExtension` an empty, codemode-free config —

```ts
createMcpExtension({ loadConfig: () => ({ servers: [], errors: [], autoEnableCodemode: false }) })(pi)
```

— and `src/config.ts` reads the two files itself. It reads pi's locations (`<agentDir>/mcp.json`, and
`<cwd>/.pi/mcp.json` only when the project is trusted), applies the project-override rule, and drops
`enabled: false`. It does **not** reimplement validation or `${VAR}` / `!command` expansion: the
configs are handed to `pi.registerMcpServer()` raw, which validates them, and the transport resolves
the values when it is created.

`autoEnableCodemode: false` is the other half: this extension must never activate the codemode tool on
code mode's behalf.

## Why the built-in is replaced

Built-in extensions are `replaceable` (`packages/coding-agent/src/extensions/index.ts:11-13`), and
`omitReplacedExtensions` leaves one out when another extension registers the same tool, command or flag
name (`src/core/resource-loader.ts:116-150`). This extension registers `/mcp` (it *is* the MCP
extension), so `builtin:mcp` is not loaded at all: no eager connect, and no codemode activation.
Because it is loaded through the manifest — and, in a
spawned child, through host-bridge's `childFactories` (`registerContributor` in `index.ts`) — the lazy
registrar runs in root sessions and in children alike.

## Discovery: names eagerly, detail on demand

This package is also the discovery layer: the model learns that a server exists before it acts, and
nothing connects until a cell names one.

- **The eager section.** mcp-lazy's own `before_agent_start` writes pi's `mcp_servers` section with
  ticket 03's intro and one line per server, `- mcp__<server>: <one-liner>`, alphabetical, for every
  configured server plus any another extension registered. It is rendered under pi's own 4096-char cap
  with the map's sacrifice order — descriptions before names, from roughly 183 servers — word- and
  URL-aware truncation (`…`), and the tail omitted behind
  `- ... K more servers; call tool() to list them all`. The handler is registered *after*
  `createMcpExtension(...)`, because section ownership is load order and the embedded instance deletes
  the key in the same turn when its own list is empty.
- **The route.** One publication into `pi-tool-bridge`'s owners slot (a documented literal) gives a cell
  `await tool()` to list servers, `await tool("mcp__<server>")` to fetch that server's inventory — and
  only that call starts it, on a 30 s bound — and `await tool("mcp__docs_api", query="…")` to rank that
  inventory (pi's own BM25). An `mcp__<server>__<tool>` call is not in the catalogue, so code-mode's
  existing MCP dispatch takes it.
- **The teaching.** A `session` contribution carries one guideline into the `python` tool's `<rules>`,
  only when the session has a configured server. A child gets it too (a child loads this factory).
- **A listing never connects anything.** `catalogue()` reads the same two config files the rest of the
  package does and nothing else.

**Exposure is made safe before a server is registered.** A `direct` exposure — at server level or on a
single tool (`toolExposure: { "search": "direct" }`) — is rewritten to `codemode`, because pi would
otherwise declare those tools to the model and break the one-tool surface; one warning names the server
and, for a per-tool entry, the tools it changed. A server whose config leaves **no** reachable tool
(`exposure: "hidden"`, or a catch-all `"*": "hidden"` with nothing brought back) is left out of both
layers — naming it would invite a call that can only answer "no tools" — while a hidden server whose
overrides expose a few tools is listed. A server whose namespace is already a callable pi tool name is
skipped in the catalogue, with one warning. Both layers use one predicate, so they always name the same
set.

## The one operator step

Three built-ins are in the way of this package's surface, and disabling all three is the operator's own
one-line change in `~/.pi/agent/settings.json`:

```json
{ "extensions": ["-builtin:mcp", "-builtin:codemode", "-builtin:tool-search"] }
```

- `mcp` — replaced by this package (it is the extension it replaces).
- `codemode` — pi's JavaScript tool, registered `defaultActive: false`; leaving it loaded costs nothing but
  the registered tool, and its absence is what makes "one tool" a property of the configuration rather than
  of an activation nobody performs.
- `tool-search` — pi's model-facing tool search, `model-only` exposure. It is not reachable from a cell, and
  one path could still have activated it: pi's MCP extension activates `tool-search` for a config-`deferred`
  server, a path that is dead here only because this package passes an empty `loadConfig`. Disabling it makes
  the one-tool surface a decision instead of an accident.

Nothing else is needed. `DEFAULT_TOOL_NAMES` is `["read", "bash", "edit", "write"]`
(`src/core/settings-manager.ts:85`), so no codemode tool is ever active unless something activates it —
and nothing here does.

## What it is not

- It does not publish MCP tools as *pi* tools (the model-facing surface stays `python`); the discovery
  route above is a `tool(...)` call, and the cell's call is what reports a server that is slow,
  unreachable or misconfigured.
- It cannot make a `.pi/mcp.json` in an untrusted project take effect; that file is not read at all
  unless the project is trusted, exactly as upstream.
- A malformed `mcp.json` is surfaced as a warning and contributes no servers; it never stops a session
  from starting or a cell from running.

## The record

The vocabulary is `GLOSSARY.md`'s **MCP discovery** section, and the trade-off is
`docs/adr/0010-a-one-tool-surface-discovers-tool-servers-lazily.md`. The measured acceptance bar is
`.scratch/mcp-discovery/acceptance.md` (13 rows; re-run with `bash tools/bar.sh wire cells readonly`).
