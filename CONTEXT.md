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

## The agent side

**rlm**:
The extension that adds delegation inside code mode — children, notices, and the seams to RSI,
Magic Context and web-code. It owns no kernel.
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
