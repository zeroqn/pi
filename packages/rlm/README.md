# rlm — delegation and the agent-side seams for pi

The agent-shaped half of the code-mode runtime: **children** (delegation), the notices that tell the
model when one finishes, and the seams to [Magic Context](https://github.com/cortexkit/magic-context),
RSI (the learned-skill store in this repo) and `web-code`.

It owns **no kernel**. The kernel, the `python` tool, the prelude's base half, the host functions,
the journal, the dump and the rotation all belong to
[`pi-code-mode`](../code-mode), which rlm reaches through a process-global registry — never an
import, because pi gives every extension entry its own module graph and a child session loads no
ambient extensions at all. The reasoning is in
[`docs/adr/0001-code-mode-registry-seam.md`](../../docs/adr/0001-code-mode-registry-seam.md).

## It requires code mode, and says so when it is missing

`packages/rlm/package.json` declares `peerDependencies: { "pi-code-mode": "*" }` and there is no
runtime dependency, because rlm never resolves code mode as code. Installed without it, or against a
code mode whose contract version is older than rlm needs, a session comes up **loudly and inertly**:
no `python` tool, one sentence in the system prompt, `rlm-preflight` recording which of *absent*,
*too old* and *wrong shape* it was, and everything else — children, skills, the seams — still
working. A throwing extension factory would be a process kill (a fact measured while building this:
pi exits 1 before any session exists), so nothing here throws to "refuse to load".

## What it contributes to the kernel

One `contribute()` call, at `session_start`, before the first cell:

- **The prelude's delegation half** (`src/prelude-rlm.ts`): `_Rlm`/`rlm`, `agent_message`,
  `find_models`, and the learned-skill seam's `skills`/`skill`.
- **The host functions they name**: `rlm_spawn`, `rlm_poll`, `rlm_list`, `rlm_remove`, `rlm_send`,
  `rlm_find_models`, `rlm_tree_cost`, `agent_message_send`, `skills_host`, `skill_host` — bound to
  this session's child manager, or to the child's own `ChildKernelContext` inside a child.
- **The snippet connector and the delegation guideline**, so the composed tool surface is
  byte-identical to what it was before the split (`.scratch/code-mode/acceptance-baseline.md`
  records the hashes).
- **Provenance**: which journals this session replays and which scratch to seed from — a fork's
  fragment plus its parent's prefix, a child's own journal only.
- **The host-call observer**: `bash_host` reports every command, and RSI's counted backstop owns the
  matching. The caller identity lives in this session's closure, not in a module-level ref — which
  is a bug the split *fixed*: the old code kept one global caller for the whole process, so a
  child's report could be attributed to whichever session bound last.
- **The tool bridge** (`src/tool-bridge.ts`): what other extensions publish on
  `pi-tool-bridge`'s process-global slot (`Symbol.for("pi-tool-bridge:owners")`) becomes one host
  function named `tool`, so a cell can call an owner's pi tools — `await tool("ctx_reduce",
  drop="3-5")`, `await tool()` to list the catalogue — while pi's active set stays `["python"]`.
  Contributed after the bind and before the first cell; the matching surface rule (a name a cell can
  reach is not an active pi tool) lives in the `pi-tool-bridge` entry, which is declared after Magic
  Context so its `session_start` re-append cannot win. Not adopted in a child: a child's allowed set
  is Magic Context's three-name child allowlist, and the publication is answered by the owner's
  session policy, so adopting there would widen the child's bound.

## What it keeps

- **Delegation**: `await rlm.spawn(prompt, name=, model=, thinking=)` creates an in-process child
  `AgentSession` and returns a handle **immediately** — an answer is never a return value, it
  arrives later as a message. Also `rlm.poll`, `rlm.list`, `rlm.remove`, `rlm.send`,
  `rlm.tree_cost`, `find_models` and `agent_message.send(text, receiver_role=)`. Children load no
  ambient extensions; a child's kernel is mounted through the registry by rlm's own factory, in the
  parent's process and module instance. Depth is capped at 2, live children at 8.
- **A failed mount fails the spawn.** pi's default would create a child with the built-in tools and
  no kernel — a silently different agent than the parent asked for — so rlm reads its loader's
  errors after `reload()` and abandons the spawn instead.
- **Notices** for a finished child or background handle, held while the parent is mid-turn and
  withdrawn only if a cell read a *finished* child first (pi cannot retract a delivered message).
  `rlm.send()` to a finished child resumes it through the same path, so that turn notifies too.
- **The Magic Context child shim**: looks for MC's process-global registry and, when found, binds
  the child, forwards its `context` and `session_before_compact` to its parent's MC instance,
  registers the three tools a bound child is granted (`ctx_search`, `ctx_reduce`, `ctx_expand`) as
  pi tools, scrubs tag prefixes on `message_end`, and clears the child's state on shutdown. This is
  the *child* seam only — rlm carries two Magic Context seams, and a root code-mode session reaches
  MC through the tool bridge above, not here.
- **The skills block**: pi renders no skills for a session whose active tools are `["python"]`, so
  rlm appends the block itself — the human tier from the event plus the learned store from the RSI
  seam.
- **The web hook's wiring**: `RLM_WEB_MODULE` is resolved once at load, so nothing is promised that
  cannot be called, and instantiated per kernel — a child's fetches spill into the child's own
  scratch — then contributed as `web-code`'s host functions and sentences. rlm does not import
  web-code and never learns what the functions do.

## Tests

```bash
cd /workspace/pi/extensions/packages/rlm
bun test        # 64 tests, 0 fail
```

`test/delegation`-adjacent suites are `children.test.ts` (spawning, caps, cost, provenance, and the
Magic Context child shim), `fork-source.test.ts` (which journals a fork replays),
`prelude-tail.test.ts` (the contributed prelude names routing to host functions, in a real kernel),
`rsi-seam.test.ts`, `skills-block.test.ts`, `tool-bridge.test.ts` (adopting a publication, and the
child exclusion) and `web-hook.test.ts`.

## Run it

```bash
cd /workspace/pi
MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty \
pi -ne -e /workspace/pi/extensions/packages/code-mode/src/index.ts \
      -e /workspace/pi/extensions/packages/rlm/src/index.ts -nbt \
   --session-dir /tmp/rlm-sessions -p "your task"
```

### Verify delegation and background handles

```bash
cd /workspace/pi
D=/tmp/rlm-surface
rm -rf $D && mkdir -p $D/sessions

pi -ne -e /workspace/pi/extensions/packages/code-mode/src/index.ts \
      -e /workspace/pi/extensions/packages/rlm/src/index.ts -nbt --session-dir $D/sessions -p \
  "Use the python tool exactly once, with ONE CELL: h = await rlm.spawn('Reply with exactly CHILD-OK.', name='probe'); print('spawned', h['child_id'], h['status']); b = await bash('printf hello', background=True); await bash('sleep 6'); print('bg', (await b.poll())['status'], (await b.output())['text'])"

ls $D/sessions/                        # the child's session file sits beside the parent's
head -1 $D/sessions/<child>.jsonl      # its header carries parentSession
```

Expected: the handle is `running` with no answer in it; the child's transcript appears beside the
parent's with `parentSession` in its header; the background handle reaches `done` with output
`hello`, and its completion notice is dispatched and sent (`rlm-notice-trace` entries).

Observability: `rlm-child` (the notice), `rlm-notice-trace`, `rlm-web`, `rlm-rsi`,
`rlm-magic-context` and `rlm-preflight` record what happened. None of them carry LLM context.

## Known limitations

- **A child cannot outlive a one-shot run.** `pi -p` exits at `agent_end`, so a child spawned in the
  final turn is killed with the process. Children need a live session.
- **A poll or list withdraws the pending notice** for a child or background handle that has
  *finished*, by design: if the model has read the result, it will not also receive a completion
  message about it. Polling a **running** child is a status check, not a read.
- **`rlm-notice-trace` entries** are written for each notice; they exist because the delivery path
  is otherwise invisible when it works.
