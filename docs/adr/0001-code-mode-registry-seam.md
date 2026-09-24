# Code mode and rlm meet through a process-global registry, not an import

rlm needs the monty kernel that `pi-code-mode` owns, but pi loads every extension entry through its
own jiti instance with `moduleCache: false` (`core/extensions/loader.js:416`), so an import would
give rlm a second copy of that module and a second kernel for the same session. A child session
rules the import out entirely: it loads no ambient extensions and can only reach code mode through
the process it runs in. We therefore publish `{ publisher, apiVersion, sessions, mount }` on
`Symbol.for("pi-code-mode:registry")` at module load, with `mount` idempotent by session key, so one
session has one kernel whichever extension asks first.

## Considered options

- **Import the module.** Simplest, and wrong for exactly the case above: two module instances, and
  pi would not even notice the duplicate — a tool name registered after startup is silently
  first-wins (`core/extensions/runner.js:324-335`).
- **`pi.events`**, pi's bus for extension-to-extension communication. Cannot reach a child: a child
  carries no ambient extensions, so code mode's subscriber is simply not there.
- **Refuse to load** when code mode is absent. A throwing factory is a process kill at startup
  (`main.js:721-731`), so that is a global outage, not a self-disable.

## Consequences

- The contract version rides on the published entry, because pi offers no extension enumeration and
  no version query: *absent*, *inert* and *too old* are distinguishable only by what code mode
  itself publishes.
- **A contribution is all-or-nothing, and the observer slots are single-owner.** A rejected name, a
  malformed field or a stolen host-function name refuses the whole contribution, so a cell can never
  see a prelude line whose host function was refused. `onNotice` and `provenance` may be declared by
  **one** owner only: a second declarer is refused rather than silently ignored, and an owner may
  replace its own, which is what keeps a second `session_start` free. (`onHostCall` left the contract
  with the `.scratch/rsi-oneway` effort — its only subscriber, RSI, now counts consultations from the
  journal it already reads.)
- rlm degrades loudly and inertly to no `python` tool. Because it never imports code mode, the
  dependency is a runtime requirement rather than a build-time one — declared as a peer so an
  install cannot be silently broken, never resolved as code.
- **A kernel belongs to the session, not to the instance that mounted it.** The published handle
  carries the kernel itself and the ctx it was mounted for, so *any* code-mode instance in the process
  can dump and close a session's kernel. That is not bookkeeping: a child's kernel is mounted by the
  instance that published the registry while the child loads no code-mode entry of its own, and a
  `/new` or `/reload` re-imports the entry — so the instance that creates a kernel is regularly *not*
  the instance that later handles that session's ctx. A per-instance kernel map hid the difference: a
  child's kernel was never dumped and never closed, and after a `/new` it was unreachable even in
  principle. `session_start` now reaps the kernels of sessions that are provably gone (their ctx has
  been invalidated — liveness, not the absence of a key, because a finished child is still resumable),
  which is the one moment both shapes are certain.
