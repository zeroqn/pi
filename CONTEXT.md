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
delegation and web names that other packages contribute.
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
bridge, not a contributor in its own right: Magic Context is the live one.
_Avoid_: contributor, publisher (of the tool bridge's slot)

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
`execute`, so the convention forbids publishing it.
_Avoid_: pi-only tool

**Ceiling**:
The most a child session may be offered — its spawning session's surface, narrowed to what a child may
hold.
_Avoid_: limit, cap

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
