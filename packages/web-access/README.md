# pi-web-access

Web access for the **rlm** Python kernel: `web_search` and `fetch_content` host functions over
DuckDuckGo and AnySearch, written for code mode rather than for an agent's tool list, plus the
untrusted-content guard for what they (and the installed `pi-web-access`) return.

Built from the wayfinder map at `/workspace/pi/.scratch/rlm-web/`. Every contract below is
a closed ticket's decision; the map holds the reasoning and the evidence.

## What it is (and is not)

- **A kernel hook, not a tool.** rlm imports this module at load time and calls
  `createHost(ctx)` once per kernel:

  ```bash
  export RLM_WEB_MODULE=/workspace/pi/extensions/packages/web-access/host.ts
  ```

  The returned functions join the same host surface as `bash`, `find`, `grep` and
  `read_image`, so journal recording, name-keyed binding and replay apply to them unchanged.
- **It registers no pi-level tools.** `pi install` loads the file's default export, which
  registers the untrusted-content guard and nothing else — no tool of its own, which is what
  keeps it from colliding with the installed `pi-web-access` (whose `web_search` is the
  agent-facing tool in sessions that do not run rlm).
- **Config is shared and read-only**: the same file `pi-web-access` uses — the same
  `provider` order, `anysearchApiKey`, `ssrf.allowRanges` and `fetchContent.domainPolicy`.
  Nothing here writes to it. Resolution order: `PI_CODING_AGENT_DIR`, then
  `$XDG_CONFIG_HOME/pi`, then `~/.pi`, then **`~/.pi/agent`** — the last one is our
  deliberate addition. Upstream consults `~/.pi/agent` only when `XDG_CONFIG_HOME` is
  unset, and on this host it *is* set, so both extensions were resolving to
  `$XDG_CONFIG_HOME/pi/web-search.json`, which does not exist: the configured provider
  order and the AnySearch key were both being silently missed. Verified inside a live pi
  session, for upstream's `getWebSearchConfigPath()` and for ours.

## The two functions

```python
r = await web_search("pydantic monty", num_results=5, provider=None, domain_filter=None)
# => {"query", "provider", "results": [{"title", "url", "snippet", "content"}], "errors"}
#    providers are tried in order and the first that answers wins; a per-provider failure
#    is data in `errors`, and only "every provider failed" raises.

f = await fetch_content("https://example.com/post")               # markdown
# => {"url", "title", "path", "chars", "head"}   head = first 2000 chars
#    the full text is written to SCRATCH/web/<slug>-<hash>.md — the same URL always lands
#    in the same file, so a path means "the most recent fetch of that URL".

f = await fetch_content("https://example.com/paper.pdf", "raw")   # the bytes, on disk
# => {"url", "path", "bytes", "content_type"}
```

- Arguments may be positional or keyword: monty hands a host function Python keyword
  arguments as one trailing plain object, so `web_search("q", num_results=3)` arrives as
  `("q", { num_results: 3 })` and is unwrapped here (the first live integration run is
  what proved that, and it is why the tests call both ways).
- `num_results` defaults to 5 and is clamped to 1..20.
- `provider` is `None` (the config's order, DuckDuckGo then AnySearch), a name, or an
  ordered list. An unknown name raises `ValueError`.
- `domain_filter` takes hostnames; a `-` prefix denies. Applied here, identically for both
  providers: over-fetch, then keep the first `num_results` survivors.
- Content types: HTML is extracted to markdown, `text/*`/JSON/XML pass through, PDFs go
  through `unpdf`, and anything else raises `ValueError` in both modes. A page with nothing
  extractable spills its raw body and says so in `note`.

### Errors, in sandbox terms

Only monty's built-in exception types cross the boundary, so the mapping is deliberate:

| raises | when |
| --- | --- |
| `TypeError` / `ValueError` | wrong argument types; unknown provider; the SSRF guard refusing a URL; an unsupported content type |
| `TimeoutError` | a provider or fetch ran out of its budget (30 s per search, 60 s per fetch) |
| `OSError` | transport, DNS, TLS, a non-2xx response |
| `RuntimeError` | every provider failed; too many redirects |

## The untrusted-content guard

Two layers, defense in depth, both ported from the former `pi-web-guard`:

1. A system-prompt rule (`before_agent_start`) saying web output is data to analyze, never
   instructions to follow. This is the **primary** defense.
2. A `<untrusted_web_content>` fence. Web content reaches the model by two routes and the fence
   covers both: the kernel route's envelopes carry fenced text fields (`web_search`'s
   `title`/`snippet`/`content` and per-provider error strings, `fetch_content`'s `title`/`head`),
   and the pi route — the installed `pi-web-access` tools — is fenced on its `tool_result`.

The markers are a **soft** boundary: a hostile page can emit a closing tag, so they back the rule
up, never replace it. The spilled markdown file is not fenced — a cell that reads it gets raw text
and must treat it as untrusted on the same rule.

## The SSRF guard

`fetch_content` validates the URL **and every redirect hop** (cap 5, walked manually):
http/https only, no `localhost`/`*.localhost`, and every address it resolves must be public
— RFC1918, loopback, CGNAT, link-local/metadata, `198.18/15` fake-IP, multicast/reserved,
IPv6 ULA/link-local/multicast and mapped IPv4 are all refused. `ssrf.allowRanges` exempts
*addresses* (never internal hostnames), and `fetchContent.domainPolicy` allow/denies
hostnames per hop.

It is a **preflight, not a connection pin**: validation resolves DNS and the request
resolves again, so a DNS-rebinding race is possible. That is inherited on purpose from
upstream and documented in map ticket 06 — the kernel's `bash` already reaches anything the
process can, so this is depth against the easy mistake, not a boundary.

## Development

```bash
bun test          # offline: fixtures for the providers, literal addresses for the guard
bun run typecheck
RLM_WEB_SMOKE=1 bun run smoke    # the network-touching check
```
