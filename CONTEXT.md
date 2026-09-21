# pi-extensions

My personal pi extensions: a small set of packages that each put one capability in front of the
agent. This is the vocabulary this repo uses about its own machinery.

## Code mode

**Code mode**:
The pi surface in which the agent's whole tool set is one persistent Python kernel, reached through
a single tool named `python`.
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
