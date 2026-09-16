# rlm — code-mode Python kernel for pi

The implementation of the plan in `/workspace/pi/.scratch/rlm-extension/`. Read `v1-acceptance.md` there first; `issues/05-kernel-namespace-and-tool-contract.md` is the normative contract this code implements.

Replaces pi's built-in tool surface with a single persistent Python kernel backed by [monty](https://github.com/pydantic/monty), bridged to host capability where the sandbox cannot reach.

## Status

Implemented and verified (each with a run recorded in the sections below):

- **One `python` tool**, built-ins disabled on `session_start`, tool executions serialised behind a FIFO queue (pi runs a batch in parallel by default, and one monty session cannot be fed twice at once).
- **The workspace mounted read-write at its real path**, so `bash` output and sandbox paths agree.
- **`SCRATCH`**: a second read-write mount at `<sessionFile>.scratch`, mirrored at its real host path, created lazily, never deleted during the session (ticket 14).
- **The Python prelude** with `ROOT`/`SCRATCH` and the file helpers (`read_text`, `write_text`, `edit_text`, `walk`, `read_json`, `write_json`, `exists`, `mkdirp`), all sync.
- **Host functions**: `bash`, `find`, `grep`, `read_image` — async, all awaited.
- **The preflight** (tickets 13, 15): at `session_start`, verify the napi binding loads, `MONTY_BIN` exists, and the client/worker versions agree. Loud, once, creates no pool.
- **Progress updates** for long host calls, so a slow cell is not opaque (ticket 10).
- **Journal-and-replay durability** (ticket 04): successful cells are journaled to `<sessionFile>.rlm-journal.jsonl` (code plus every host-call result) with a metadata-only `rlm-cell` entry in the transcript; a resumed or forked session rebuilds the kernel by replaying them as **one composite feed over `overlay` mounts with host calls served from the journal** — so replay cannot write to the host and does not re-run shell commands. A fork also copies the source's scratch (ticket 14). The result reports itself honestly, and a partial replay says so rather than pretending.
- **Delegation** (ticket 06): `await rlm.spawn(prompt, name=, model=, thinking=)` creates an in-process child `AgentSession` and returns a handle **immediately** — an answer is never a return value, it arrives later as a message. Also `rlm.poll(selector)`, `rlm.list()`, `rlm.remove(selector)`, `rlm.send(selector, text)`, `find_models(query, limit)` and `agent_message.send(text, receiver_role=)`. Children load **no ambient extensions** (ticket 07) and get the kernel injected inline; the child's session header carries `parentSession`, which is what Magic Context recognises (ticket 16). Depth is capped at 2 and live children at 8; notices are held until the parent goes idle and dropped if a cell read the child first.
- **Background handles** (ticket 10): `await bash(cmd, background=True)` returns a prelude `BgHandle` — `h.poll()`, `h.output()`, `h.kill()` — over the host functions `bg_poll`/`bg_read`/`bg_kill`/`bg_list`. The process lives on the host; the kernel has none. Cap of 8 live handles, `timeout=` applies in both forms, one notice per finished handle, and `kill` on `session_shutdown` with the record preserved. Records are restored read-only after a resume and **never re-executed**.
- **The Magic Context child shim** (tickets 07, 16): `src/magic-context.ts` looks for MC's process-global registry and, when found, binds the child, forwards its `context` and `session_before_compact` to its parent's MC instance, scrubs tag prefixes on `message_end`, and clears the child's state on shutdown. **MC's side of this now exists** — the registry, the facade and the recognition rule are implemented in MC's `pi-agents` branch (`pi-registry.ts`), with the spec in `.scratch/rlm-extension/mc-reduced-mode-spec.md`. Until that build is installed, the shim finds nothing, logs the degradation once per session, and children use pi's native compaction.
- **A dump fast path** (ticket 04): a matching dump (`<sessionFile>.rlm-dump.bin`, written at `agent_end` and shutdown) restores the kernel directly, gated on the client version and the journal's cell count; `loadSession` is only valid on a fresh session, so the dump is tried before the prelude is fed. A stale dump is ignored silently and replay runs instead.
- **Image reads verified** (ticket 15): `await read_image(path)` returns a real `ImageContent` part on the tool result — confirmed with a 2.5 KB PNG (3420 base64 chars delivered).

Deliberately not yet implemented, in planned order:

| Remaining gap | Ticket |
| --- | --- |
| The Magic Context registry itself — the shim exists and no-ops until MC publishes it | 16 |

### Tests

```bash
cd /workspace/pi/extensions/rlm
export MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty
bun test        # 25 tests, 0 fail
```

The monty-backed tests skip themselves when no worker is available, so the suite is runnable anywhere; set `MONTY_BIN` on a host whose glibc is not at `/lib64`.

| Suite | Covers |
| --- | --- |
| `test/journal.test.ts` | the journal file (round-trip, torn lines, absent file), the restore report's three honest shapes, and that replay serves recorded results without calling through |
| `test/background.test.ts` | real processes: status transitions, exit codes, kill, timeout reason, the cap, the log file, read-only restore, and shutdown |
| `test/prelude.test.ts` | the prelude's promised names, then its **semantics in a real kernel**: `ROOT`/`SCRATCH`, the sync file helpers, `bash` returning a plain result versus a `BgHandle`, and the delegation calls routing to the host |
| `test/render.test.ts` | `# => value` rendering, including the `Map` case below |

What the suite cannot reach is the pi session surface — spawning, notices, journal-and-replay across a real resume, and the MC shim. Those were verified by driving real sessions, and the commands are in this file.

### Known limitations

- **A child cannot outlive a one-shot run.** `pi -p` exits at `agent_end`, so a child spawned in the final turn is killed with the process. Children need a live session — an interactive one, or a parent turn that outlives them. This is inherent to one-shot mode, not to the child mechanism.
- **Session files, the journal and scratch live outside the workspace mount** when the session directory is outside the workspace, so `read_text` cannot reach them; `await bash("cat …")` can. The completion notice says so.
- **`rlm-notice-trace` entries** are written for each notice (dispatch, and the flush outcome). They carry no LLM context; they exist because the delivery path is otherwise invisible when it works.
- **A poll or list cancels the pending notice** for that child or background handle, by design (tickets 06, 10). If the model reads it, it will not also receive a completion message about it.
- **A dump is a fast path, never the truth.** It is gated on the client version *and* the journal's cell count; a stale dump is ignored silently and replay takes over. A worker-version change therefore costs a replay, not correctness.
- **The Magic Context shim is inert until MC ships the registry** (`.scratch/rlm-extension/mc-reduced-mode-spec.md`). Until then children use pi's native compaction, reported once per session as `rlm-magic-context`.
- **monty hands a Python dict back as a JS `Map`.** `JSON.stringify(new Map())` is `{}`, so the `# => ...` line is rendered by `src/render.ts`, which converts Maps, Sets and BigInts. Without it, a cell ending in `await bash(...)` would have reported an empty object — the silent-wrong-answer class the acceptance criteria disqualify. Found by a test, not by a run.

`rlm.spawn` is absent from the tool description on purpose: the description must not promise what the kernel cannot do.

## Run it

```bash
cd /workspace/pi
MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty \
pi -ne -e /workspace/pi/extensions/rlm/src/index.ts -nbt -na \
   --session-dir /tmp/rlm-sessions -p "your task"
```

`-ne` keeps other extensions out, `-nbt` disables built-in tools while keeping extension tools, `-na` ignores project-local config.

Environment overrides: `RLM_FD` (find backend), `RLM_ZG` (grep backend), `RLM_SHELL`.

**`MONTY_BIN` is only needed on a host without `/lib64/ld-linux-x86-64.so.2`** — NixOS, musl. The flake's `.#monty-bin` is the published worker patched for Nix; do **not** use `.#monty`, which is the local checkout at protocol 3 and cannot talk to the published client. On ordinary glibc, macOS and Windows, nothing is needed. See the install story in `.scratch/rlm-extension/spike/package/README.md`.

## Install as a pi package

```bash
pi install /workspace/pi/extensions/rlm      # or -l for project scope, or -e to try it
```

The `pi` manifest in `package.json` points at `./src/index.ts`.

## Verify

```bash
cd /workspace/pi
MONTY_BIN=… pi -ne -e /workspace/pi/extensions/rlm/src/index.ts -nbt -na --mode json \
  --session-dir /tmp/rlm-sessions -p "Use the python tool once. In one cell: print(ROOT); print(SCRATCH); print(write_text(SCRATCH+'/p.txt','ok')); print(read_text(SCRATCH+'/p.txt')); r = await bash('echo hi'); print(r['exit_code'])"
```

Expected: `ROOT` is the working directory, `SCRATCH` is `<sessionFile>.scratch`, the write/read round-trips, and `bash` exits 0. A non-empty `rlm-preflight` entry in the session JSONL means the preflight found a problem.

### Verify durability (ticket 04)

Run 1 defines state and performs a shell side effect; run 2 resumes the same session and reads the state back:

```bash
cd /workspace/pi
export MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty
D=/tmp/rlm-journal-test
rm -rf $D && mkdir -p $D/sessions

pi -ne -e /workspace/pi/extensions/rlm/src/index.ts -nbt -na --session-dir $D/sessions -p \
  "Use the python tool once, ONE cell: x = 41; await bash('printf side-effect\\n >> $D/side-effect.txt'); print('defined')"

SF=$(ls $D/sessions/*.jsonl | head -1)
pi -ne -e /workspace/pi/extensions/rlm/src/index.ts -nbt -na --session-dir $D/sessions --session "$SF" -p \
  "Use the python tool once, ONE cell: print('restored x+1 =', x + 1)"

wc -l < $D/side-effect.txt   # must still be 1: bash was served from the journal
```

The second run's tool result must begin with `# kernel rebuilt from journal: replayed N cells and M host calls`, print `restored x+1 = 42`, and the side-effect file must still hold **one** line — replay reconstructs and does not re-execute.

After a clean turn the same session also writes a dump, so a later resume reports `# kernel restored from a dump taken at cell N` instead. Both are correct; the dump is simply faster.

### Verify delegation, background handles and images

```bash
cd /workspace/pi
export MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty
D=/tmp/rlm-surface
rm -rf $D && mkdir -p $D/sessions

pi -ne -e /workspace/pi/extensions/rlm/src/index.ts -nbt -na --session-dir $D/sessions -p \
  "Use the python tool exactly once, with ONE CELL: h = await rlm.spawn('Reply with exactly CHILD-OK.', name='probe'); print('spawned', h['child_id'], h['status']); b = await bash('printf hello', background=True); await bash('sleep 6'); print('bg', (await b.poll())['status'], (await b.output())['text']); await read_image('pi/packages/ai/test/data/red-circle.png')"

ls $D/sessions/                       # the child's session file sits beside the parent's
head -1 $D/sessions/<child>.jsonl      # its header carries parentSession
```

Expected: the handle is `running` with no answer in it; the child's transcript appears beside the parent's with `parentSession` in its header; the background handle reaches `done` with output `hello`; and the tool result carries a real `image` part.

Observability: `rlm-cell`, `rlm-bg`, `rlm-child`(the notice), `rlm-notice-trace`, `rlm-dump` and `rlm-magic-context` custom entries record what happened. None of them carry LLM context.
