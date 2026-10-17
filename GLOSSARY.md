# pi-extensions

My personal pi extensions: a small set of packages that each put one capability in front of the
agent. This is the vocabulary this repo uses about its own machinery.

## Code mode

**Code mode**:
The pi surface in which the agent's work runs in one persistent Python kernel, reached through a tool
named `python`. (Other active tools — `ask_user_question`, `todowrite` — are not code mode's own; the
tool bridge is what keeps them there.)
_Avoid_: code-mode session, REPL mode

**Kernel**:
The live monty session a code-mode surface runs inside, together with the mounts, prelude and host
functions it was fed.
_Avoid_: sandbox, VM, interpreter

**Host function**:
A function the kernel reaches out to the host with — `bash`, `find`, `grep`, `read_image`, and the
delegation, web, zvec-grep and advisor names that other packages contribute.
_Avoid_: tool, native function

**Mount** (verb):
Bringing a session's kernel into existence, or handing back the one that already exists for that
session.
_Avoid_: start, initialize, attach

**Session key**:
The identity a kernel is mounted under, for the length of one session.
_Avoid_: session id, kernel id

**Rotation**:
Replacing a kernel with a fresh one in the middle of a cell, when the suspension budget nears its
ceiling.
_Avoid_: restart, recycle, reset

**Turn-owned work**:
Work a cell started in the foreground — a `bash`, `find` or `grep` call — whose process the run owns:
aborting the run kills its process group, and nothing of it outlives the cell. The escape hatch is
`background=True`.
_Avoid_: foreground work (that names the syntax, not the ownership)

**Session-owned work**:
Work that outlives the turn that started it — a background handle, a child — and ends when someone ends
it (`bg_kill`, `rlm.stop`), when its own bound fires, or when a shell that declared no bound runs out
its **lease** (2026-10-17).
_Avoid_: detached work, async work

**Lease**:
The stand-in bound a background shell gets when its caller declared no `timeout=`: an hour of running, a
notice while it is still going, then ten minutes in which the model may grant more
(`await h.extend(seconds)`) before the handle is killed as *unattended*. The grant **becomes** the
declared bound, so one call leaves the handle bounded exactly as if the caller had declared it; a shell
that declared a `timeout=` is never leased. A shell an **earlier** session started is leased the moment
the next session finds it (2026-10-17) — see **Orphan**.
_Avoid_: deadline, idle timeout (a lease is not the caller's bound, and it is not about silence)

**Orphan**:
A background shell found still alive by a **different** session from the one that started it. The next
session probes the recorded pid and answers three ways: gone (`killed`, the old sentence, now checked),
alive and verified by the process's own start time (`running`, and leased at once), or alive and
unprovable — status **`unverified`** — which is reported and never killed, because a pid can be reused.
_Avoid_: zombie, leftover (an orphan may be perfectly healthy work)

## The seam between packages

**Contribution**:
What a package other than code mode adds to a kernel it does not own — host functions, prelude
lines, and the sentences the model is shown about them.
_Avoid_: plugin, hook, extension point

**Registry**:
The process-global meeting point where the kernels of the running process are published for other
packages to find.
_Avoid_: service locator, bus

**Host surface**:
The table of names a cell can call that are not Python: code mode's base host functions plus every
contributor's. The kernel materializes it; who writes into it is the host bridge's question.
_Avoid_: tool list, API surface, kernel surface

**Contributor**:
An extension that adds to a session's host surface by registering with the host bridge — rlm, the tool
bridge, the skill bridge, web-access.
_Avoid_: plugin, extension point, provider (a provider supplies skills to the skill bridge)

**Owner**:
An extension whose *pi tools* the tool bridge publishes on a cell's behalf. A publisher behind the tool
bridge, not a contributor in its own right: Magic Context is one, and since 2026-10-16 **mcp-lazy** is the
other — its `catalogue` advertises one entry per configured MCP server and its `execute` answers that
server's inventory, so `await tool("mcp__<server>")` is an owner call and `await tool("mcp__<server>__<tool>")`
falls through to code mode's own MCP dispatch.
_Avoid_: contributor, publisher (of the tool bridge's slot)

**Vendored member**:
A tracked package in this repo whose whole purpose is to satisfy a *bare specifier* some prebuilt bundle
imports — `packages/onnxruntime-node` answers the fork's `requireFromHere("onnxruntime-node")`. The
package name is the contract (a member is found by its `name`), and the consumer names it by **path**
(`file:../onnxruntime-node`) so the link is recorded rather than inferred from a version range a member's
`version` happens to satisfy. It carries only the payload that is actually loaded — here the compiled JS
and one 384 KB napi binding — and never the published package's own library, other platforms' binaries or
install scripts.
_Avoid_: vendored package (the whole published tarball), shim (that is the library, below)

**ABI shim**:
A small library that carries the symbol **version node** a prebuilt binary asks the loader for and forwards
the call to the real library — `shell/onnxruntime-shim` defines `OrtGetApiBase@@VERS_1.24.3` over nixpkgs'
ONNX Runtime, which exports `@@VERS_1.27.1`, because the version node is generated from the release tag and
the loader checks it before any runtime negotiation. It is named after the *requester's* ABI
(`libonnxrtabi24.so.1`), never after the library it stands in for: `LD_LIBRARY_PATH` outranks a binary's
own `RUNPATH`, so a file named `libonnxruntime.so.1` on that path becomes the ONNX Runtime for every process
in the environment, and a shim can only answer for the one version node it was built with (a stand-in named
that way broke `zg`). The real library it forwards to is chosen by the environment
(`ONNXRUNTIME_LIB_PATH`, defaulted to the pinned store path), and a self-reference is refused rather than
absorbed.
_Avoid_: stub, wrapper, loader shim (it does not resolve anything itself)

**Version node**:
The `VERS_x.y.z` name the loader attaches to a symbol — `OrtGetApiBase@VERS_1.24.3` — and checks *before* a
binary runs, so it couples a prebuilt binding to an ONNX Runtime release **exactly**. ONNX Runtime generates
it from the release tag while keeping `SOVERSION 1`, which is why every release ships the same file name
(`libonnxruntime.so.1`) with a different node: the name cannot be a version check, so nothing can be
substituted by symlink across releases, and a binding that asks for an older node needs an **ABI shim**.
See `docs/adr/0011-a-prebuilt-packages-native-library-comes-from-the-environment.md`.
_Avoid_: soname (the file name, `libonnxruntime.so.1`, stable across releases), API version (what
`OrtApiBase::GetApi(N)` negotiates *after* the loader is satisfied)

**Client** (of the registry):
A package that reaches code mode's registry to mount a session's kernel and contribute — or only to
hold the handle, which is what rsi does.
_Avoid_: consumer, mounter

**Composition root**:
Whoever mounts a session's kernel, asks every contributor for it and writes the session's record — for
a root and a child alike. `pi-host-bridge` is it.
_Avoid_: orchestrator, kernel owner

**The child notion**:
Everything a package must know about child sessions — whether this one is a child, which factories it
loads, what it may hold (the ceiling) and what it was given. It lives in one place, the host bridge;
the *policy* stays with the contributors.
_Avoid_: child mode, inheritance

**Seam**:
A place a policy can be enforced — a **kernel seam** or a **tool seam**. The kernel seam is code mode's
`egress` slot, where a cell's host calls are judged; the tool seam is pi's own `tool_call`/`tool_result`
events, where the model's direct tool calls are judged. One policy can be enforced at both, and what it
governs is its **coverage**, not the seam it was born in
(`docs/adr/0009-the-coverage-belongs-to-the-policy.md`).
_Avoid_: slot, hook — a slot is one seam's contract; a seam is the place, whatever reaches it

**Coverage**:
Which seams and which paths a policy actually governs. The guardrail's claim has always been
class-shaped — external text is data, however it arrived — and coverage is what makes its reach match it,
and says where it does not. Two known gaps: a tool that reaches the network with **no shell command** (an
MCP server, a future fetch tool), and a shell tool whose backend is `BashOperations` over SSH, which runs
no command text for either seam to read.
_Avoid_: scope, boundary — coverage names the seams and paths a policy governs, not what contains them

**Policy slot**:
A single-owner place a session's policy is declared, asked before its host calls run — `guard` (may this
call run, and which mode does the cwd mount get) and `egress` (may it reach the network) — consulted in
that order, one declarer each, a second refused whole. Two slots rather than one because they are two
questions held by two packages: read-only mode owns the first, web-access the second.
_Avoid_: callback, hook, interceptor

**Egress policy**:
The `egress` slot's content: whether a host call may leave this host. pi-web-access's `checkEgress`
refuses a `bash` command whose purpose is to leave and steers it to `fetch_content` — and to the
**escape hatch** when that route cannot reach the page. For a target-bearing transport the refusal is no
longer the only answer: where a human is present it becomes **the ask**, and a **grant** turns it into
an allowance that carries the **remote-output fence**. It is no longer only the kernel's: the same
policy is enforced at the **tool seam** too, so a session with no code mode is guarded, and a command is
never allowed in a cell while refused as a shell tool.
_Avoid_: network guard, firewall; and "egress" for the host surface itself, which is the **Host surface**

**Escape hatch**:
The sanctioned way past a refusal that would otherwise stop work: `fetch_content(url, via="shell")` runs
`curl` on the host for the pages the guarded route cannot reach, and fences what it returns. A **grant**
is the other sanctioned way past a refusal, and it is not this one: the escape hatch reaches a *page*
the guardrail was never built for, while a grant reaches a *host* the human named. Neither hides what it
brings back — a bypass does, and that is why both are fenced rather than allowed silently.
_Avoid_: bypass, fallback — a bypass hides what it fetches, and a fallback may return unfenced text;
this one cannot, and a grant fences instead of hiding

**Fence**:
The untrusted-content markers wrapped around text that came from outside this host, so the model reads
it as data. One set of words with two appliers: code mode's `applyFence` wraps a granted cell call's
result, and the tool seam's `fenceToolResult` wraps a granted shell tool call's text block.
_Avoid_: sandbox, boundary — a fence wraps text, it does not contain a process

**Untrusted content**:
Text that came from outside this host — a web page, a search result, a remote command's output — and
must be read as data, never as instructions. It is a claim about *where the text came from*, not about
which tool fetched it.
_Avoid_: untrusted input, tainted text — the class is about *provenance*, and the section that states the
rule wears the wire name if anyone needs it (`untrusted_external_content`)

**Remote-output fence**:
The fence for a granted connection's output: its own marker and preamble, because a remote shell is not
a web page even though both are external. Both seams apply it: `applyFence` for the kernel, and
`fenceToolResult` for pi's own shell tool.
_Avoid_: ssh fence, shell fence — one fence covers every granted transport, and it is not the web fence

**Verdict**:
One policy's answer for one host call: `{allow: false, reason}` or `{allow: true}` — and for the **egress
policy**, since ADR 0008, `{allow: true, fence}`.
_Avoid_: decision, result — a verdict answers *whether* (and, for egress, *how the answer comes back*); it
is not what the call returned

**Grant**:
A human's answer for one session: *this* destination may be reached. Not a **declaration**, not a model's
decision, and not a property of the host — the answer comes from a person. It is held once per session
**across both seams**: one store, one ask, and a refusal at either seam counts the same.
_Avoid_: permission, access — a grant is one session's answer about one destination, not a host-wide
policy

**Declaration**:
A project's statement of a destination, in `.pi/ssh-grant.json` (a **trusted** project only, read at
session start). It is not a **grant**: where a human can be asked it is a pre-filled question, and where
nobody can be asked — no UI — it is what applies, because a session must not be left with no route at
all. A session's own refusal or revocation overrides it without editing the repo.
_Avoid_: default, allowlist — a declaration is what a project says about itself, and it is offered rather
than answered

**Granted target**:
The destination a grant names, as character-for-character text — the form a **destination key** holds and
the matcher compares against.
_Avoid_: host, alias — an alias is a promise about what a key resolves to, and the gate cannot resolve

**Destination key**:
The identity of a **granted target**: `[user@]host[:port]` exactly as the command line writes it, matched
per command family. Port is part of the key only when the command names one; a key that names no user
covers no user.
_Avoid_: endpoint, address — a key is text from the command line, not a resolved endpoint

**The ask**:
The moment the refusal turns into a question, at the call that was refused. Its answer is the grant; its
absence (no UI, no answer) is a refusal. The dialog says which **seam** is asking — *in a cell* or *as a
shell command* — so the same refusal reads the same whichever seam raised it.
_Avoid_: prompt, request — the ask is the refusal's own question, not the model asking in prose

## The agent side

**rlm**:
The extension that adds delegation inside code mode — children, notices, and the seams to RSI,
Magic Context and web-access. It owns no kernel.
_Avoid_: the code-mode extension

**Child**:
A pi session rlm spawns to run a delegated task, with its own kernel and its own scratch.
_Avoid_: subagent, task, worker

**Notice**:
A message the model receives about work it is not currently watching — a child or a background
handle reaching a terminal state.
_Avoid_: alert, notification, event

**Status read**:
Asking what a child is doing — `rlm.poll`, `rlm.list`, or the moment a join resolves. It reports status
and usage, never the answer, and it withdraws the completion notice of any child that is already
terminal.
_Avoid_: check, look (both too vague to set against the read below)

**Result read**:
Collecting a child's answer — what `rlm.wait` does. It is a status read *and* the answer: the text of the
child's last assistant message, returned to the cell.
_Avoid_: fetch, await (both already mean something in the kernel)

**Stale**:
A running child that has made no progress for longer than the threshold. It is a report, not a state: the
child is still running, nothing has ended it, and stopping it is the model's decision.
_Avoid_: hung, dead, stuck, zombie

**Progress**:
Evidence that a child is working — a message it produced, or a call it is in the middle of. Its absence
is what stale measures.
_Avoid_: activity, heartbeat (a heartbeat is a promise to report; progress is what a reader can see)

**Stop**:
Ending a child that is still running. It stops being live from that moment on, and everything it did stays
readable — its record, the reason it ended, its transcript.
_Avoid_: kill (that names a process, not a session), terminate, cancel

**Remove**:
Forgetting a child that has ended: its record leaves the session's list and its name is free for another
child. A remove erases nothing — the transcript and the session file stay.
_Avoid_: delete, drop, clear

**Resumable**:
A child whose session is still open, so it can be given another turn with everything it has built up
intact. Ending one deliberately closes its session; one that ended by itself leaves its session open.
_Avoid_: restartable, reopenable, retryable

**Message** (from a child):
What a child sends its parent with `agent_message.send`. It is content, not status, and **nothing
withdraws it** — not even reading the child that sent it.
_Avoid_: notice (a notice is about state), reply (it need not answer anything)

## The tool bridge

**Surface**:
The list of pi tools a session offers the model — pi's *active set*, which is also what the turn's
prompt is built from.
_Avoid_: tool list, tool set, catalogue

**Catalogue**:
What an owner publishes for one session: the tools a cell may call, with their descriptions and
parameter schemas. Not a surface — a catalogue is reached from inside a cell, a surface is offered
to the model.
_Avoid_: publication, tool list

**Child surface**:
A child's surface — the root's surface narrowed to what a child may hold. A child is never offered a
tool its root does not have.
_Avoid_: child tool list

**Native-only tool**:
A tool that must stay a real pi tool because its effect is pi's dispatch rather than its own
`execute`, so the convention forbids publishing it. **Nothing declares one today** — `todowrite` was the
only member, and it stopped qualifying when its effect moved into the bridge's executor rather than the
convention learning an exception; the declaration stays because the question ("must this stay a real pi
tool?") is one only an owner can answer about its own tool.
_Avoid_: pi-only tool

**Ceiling**:
The most a child session may be offered — its spawning session's surface, narrowed to what a child may
hold.
_Avoid_: limit, cap

**Dispatched call**:
A pi tool call pi itself resolved against the surface — the event, the owner's `execute`, the result —
which is what an owner's call-side effects have historically been wired to.
_Avoid_: tool call (too broad: a cell-routed call is a call too), real call

**Cell-routed call**:
The same tool reached from inside a code-mode cell through the bridge: the owner's definition runs, but pi
dispatches nothing by that name — the transcript records code mode's own tool, so an effect wired to
pi's event never fires.
_Avoid_: bridged call, proxied call, tool call

**Call observer**:
The one function per phase that turns "this call happened" into an owner's call-side effects — recording
state, firing a trigger, clearing one — run for a dispatched *and* a cell-routed call, so the two routes
cannot drift. A **dispatch-derived** observer reads only pi's event; a **transcript-derived** one reads
pi's messages or the tags, and a cell-routed call leaves neither, so it stays blind until something
writes the call down.
_Avoid_: hook (pi's own event registration), handler, listener

**Child-eligible**:
A tool a child session may hold, declared by whoever owns it: a tool whose effect is pi's dispatch, or
code mode's own tool. Every other tool is reached from a cell instead of being offered to the model.
_Avoid_: allowed tool, child tool

## The skill bridge

**Skills block**:
The `<available_skills>` text appended to a code-mode prompt, because pi renders its own only for a
surface that can read files.
_Avoid_: skills prompt, skill list

**Human tier**:
Everything pi loaded — the user directory, the project's, packages, `--skill` paths.
_Avoid_: user skills, pi skills

**Learned tier**:
A store a provider supplies, learned rather than authored.
_Avoid_: rsi skills, generated skills

**Skills provider**:
The per-session rendezvous by which a store offers its skills to the bridge: `list()`, and `read(name)`
for one skill's body and its declared files.
_Avoid_: catalogue (that is the tool bridge's), publication, plugin

**Call form**:
`skill(name)` and `skills()` — the two names the model calls from a cell. One form, both tiers.
_Avoid_: skill tool, skill API

**Route**:
How a name is *read* — through the provider that claims it, or from the file it names. Distinct from
the order the block lists entries in, which puts pi's own first.
_Avoid_: resolution, lookup

## The advisor

**Advisor**:
The stronger reviewer model a cell consults when the executor wants a second opinion — reached as
`advisor()`, never as a pi tool. The *capability*, not the model: which model answers is a choice the
user persists, and whether the capability exists at all is the gate's.
_Avoid_: consultant, helper model

**Executor**:
The model running the task, whose branch is forwarded to the advisor, and whose model and reasoning
level the blocklist is written against. The advisor is judged *for* an executor, which is why a
blocklist entry is meaningless without one.
_Avoid_: main model, primary model, driver

**The gate**:
The mount-time decision that `advisor` exists in a session at all: a persisted `modelKey` that resolves,
and an executor the blocklist does not cover. One answer per session, taken when the kernel is mounted,
because a contribution cannot be added after the first cell — which is why `/advisor` says the next
session rather than this one.
_Avoid_: check, guard (read-only mode has the guard), condition

**The surface block**:
The `## Available Executor Surface` text prepended to the advisor's payload: what the executor's cell can
call, since the reviewer sees no system prompt and no tool schemas. Static prose plus the host functions
the session actually landed.
_Avoid_: inventory (upstream's word for the `getAllTools` dump this replaces), tool list

## Read-only mode

**Read-only mode**:
The query-only mode: `/readonly`, `Ctrl+Alt+R` or `--readonly`, persisted in the session and restored on
a resume. It governs **the workspace** — file tools, shell commands, and a cell's workspace mount — and a
declared exemption list is the only way an extension's capability reaches a cell while it is on.
_Avoid_: safe mode, lockdown, sandbox (this is a guardrail against incident, not a sandbox)

**Guard**:
The single-owner contribution a session's policy answers a kernel through: asked before **every** host
call, and for the mode the session's workspace mount gets. The guard is the *policy*, not the answer.
_Avoid_: hook, veto (that is the answer), observer (an observer decides nothing)

**Refusal**:
A guard's "no" for one call. It is raised **before** the callee runs, as a `PermissionError` — the same
exception the read-only mount itself raises — and the journal records it, so a replay re-raises it rather
than running the call.
_Avoid_: block, denial

**Exemption**:
One entry in read-only mode's allowlist: an extension's capability permitted while the mode is on, written
by hand with a reason. **Purely for extensions** — never a model-facing escape, and never something an
extension grants itself, so that nothing is permitted without a person deciding it.
_Avoid_: allowlist entry (the list is the allowlist; one line of it is an exemption), whitelist exception

**Per-feed mount**:
The mount set handed to monty with *each* feed rather than bound to the session — which is what makes a
mode change land on the next cell with the kernel, its variables and its journal intact, and what makes
"read-only starts at the next cell" one story for the mount, the shell gate and the live shells alike.
_Avoid_: dynamic mount, hot mount

**Inherited hold**:
The mode a child session was spawned under, kept in the child's own transcript by the session that
spawned it, so that a child resumed after that session is gone comes back read-only instead of silently
writable. Distinct from a **live hold** — a spawner still in the process — which the child cannot lift;
an inherited hold is an initial state the child's own `/readonly` may change.
_Avoid_: parent mode, saved state, sticky mode

**Pending read-only**:
Read-only mode asked for and not yet on, because background shells are still running and the answer to the
toggle's question was *wait*. The status line says so, the mode's ordinary effects have not begun, and it
starts by itself once nothing is running.
_Avoid_: queued, deferred mode, half-on

## MCP discovery

The vocabulary of the two layers that let a cell-surface session learn which MCP servers exist — map
`.scratch/mcp-discovery/`, and `packages/mcp-lazy`. The distinction the whole design turns on is between a
server the session is *told about* and a server that is *running*.

**Discovery**:
What the model learns about MCP servers **before it acts**: their names, and what each offers. Two layers:
an eager line per server in the system prompt, and an on-demand answer about one named server.
_Avoid_: probing, listing (that is one call's answer, not the layer)

**Configured server**:
An MCP server named in `<agentDir>/mcp.json`, or in the trusted project's `.pi/mcp.json` (project entries
override global ones by name). The set discovery must be able to name exactly.
_Avoid_: available server, installed server

**Registered server**:
A server this session has handed to pi — by a cell naming it, or by any extension calling
`pi.registerMcpServer()`. Registration is what makes its tools exist; it says nothing about whether the
server answered.
_Avoid_: loaded server, active server

**Connected server**:
A registered server whose transport is up and whose tools pi can report. Only a connected server has an
inventory to read, and only a **named** server is ever connected in a code-mode session.
_Avoid_: live server, running server

**Named** (a server):
A cell's source spells a word beginning `mcp__<server>__`. Naming is the one act that connects a server —
which is why discovery exists at all: without it the model cannot name what it was never told about.
_Avoid_: referenced, requested

**Eager layer**:
What the first prompt carries about servers: the `mcp_servers` section, one line per server, connecting
nothing. Its budget is pi's 4096 characters of inner text, and it sacrifices descriptions before names.
_Avoid_: listing, catalogue (the catalogue is the cell's, `await tool()`)

**On-demand detail**:
What one call answers about a server — its tools with descriptions, the server's own `instructions`, and a
ranked view of them when the inventory is large. The only layer that may connect anything.
_Avoid_: lookup, inspection

**One-liner**:
The sentence that says what a server offers: its config `description`, else the first line of the
`instructions` it sends when it connects, else nothing (a bare namespace).
_Avoid_: summary line, blurb

**Spawn witness**:
The file a test MCP server writes when it starts — the evidence that an **unnamed** server never ran, which
is the claim the whole lazy design is measured by.
_Avoid_: start log, liveness check

**Exposure**:
pi's property of a server or a single tool — `codemode`, `deferred`, `direct`, `hidden` — saying how its
tools may be reached. `direct` declares tools to the model and is **rewritten** before mcp-lazy registers a
server, because this repo's cell surface has exactly one model-facing tool; `hidden` with nothing brought
back is omitted from discovery altogether. Not to be confused with the eager layer's line, which carries no
reach label.
_Avoid_: visibility, reach (say *reach* for the route a call takes)
