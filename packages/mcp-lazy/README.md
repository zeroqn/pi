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

## The one operator step

pi prints a startup warning naming this replacement. Silence it by disabling the built-in in
`~/.pi/agent/settings.json`:

```json
{ "extensions": ["-builtin:mcp"] }
```

Nothing else is needed. `DEFAULT_TOOL_NAMES` is `["read", "bash", "edit", "write"]`
(`src/core/settings-manager.ts:85`), so no codemode tool is ever active unless something activates it —
and nothing here does.

## What it is not

- It does not publish MCP tools as kernel host functions, and it contributes nothing to the kernel
  surface; it only decides *when* a server connects. The cell's call is what reports a server that is
  slow, unreachable or misconfigured.
- It cannot make a `.pi/mcp.json` in an untrusted project take effect; that file is not read at all
  unless the project is trusted, exactly as upstream.
- A malformed `mcp.json` is surfaced as a warning and contributes no servers; it never stops a session
  from starting or a cell from running.
