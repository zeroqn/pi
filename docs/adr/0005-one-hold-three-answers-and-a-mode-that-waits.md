# One hold, three answers, and a mode that waits

Read-only mode could be asked for and then not be true. Two ways, both found by the guard effort's own
acceptance bar:

- **A child's hold died with its spawner.** The guard made a child's mode a *live* floor — its spawner's
  effective answer, read live — which is right while the spawner is in the process and nothing once it is
  not. A child resumed later came back **writable**, and a spawned child carries no state of its own to
  say otherwise, so nothing recorded what it had been.
- **A background shell started before the toggle kept writing.** The mount cannot reach a host process, so
  the mode could be on, the prompt could say the workspace was frozen, and a shell started five minutes
  earlier could still be changing files.

We answered both by making the mode's claim either true or explicitly not-yet:

- **The hold is written down.** The session that answers for a child writes its answer into **the child's
  own transcript**, and the hold is then read in one order: a **live** spawner (still unliftable from
  inside the child), then **this session's own decision**, then the **inherited marker**. So a resumed
  child starts read-only and can lift it itself; a child under a live spawner cannot; and a session with
  no opinion at all still gets the safe answer when someone else knows better.
- **The toggle asks.** If background shells are running it names them and asks — kill them now, or wait.
  With a dialog-capable UI the user answers; with none the answer is *kill*, because enabling the mode is
  the decision. **"Wait" means the mode does not turn on**: the status line says
  `read-only (waiting for N shell(s))`, nothing is taken away yet, and it starts by itself at the next
  turn boundary.

## Considered options

- **A sticky hold** (a resumed child stays read-only, and its own toggle cannot lift it). Fail-safe, and
  it makes the mode's own toggle report an "off" that does not take — a lie with no one to report it,
  because the spawner that set it is gone. The tri-state exists to make that state expressible instead.
- **No marker at all**, leaving a resumed child writable. The limit was in the guard map for a reason: a
  hold that silently evaporates is worse than one that is deliberately liftable.
- **Killing the shells instantly, at the toggle, without asking.** Exact, and it takes the shells of a
  build the user may have started deliberately. Asking costs one dialog and keeps the decision where the
  project puts it.
- **Starting the mode now and treating the running shells as an acknowledged exception.** Honest to
  "let them finish", and it requires *removing* the mode-change kill — otherwise that kill stops the
  spared shells at the next cell and the user's answer is overridden — which in turn leaves a child's
  pre-existing shells running with nobody to ask. The wait keeps that kill, and keeps the mode's claim
  true for free.
- **Warning without asking** (a notification that shells keep running). Cheap, and it makes the mode's
  claim false for as long as the warning is true.

## Consequences

- **The mode is never on while something can write to the workspace.** That is now a property rather than
  a hope, and it is why the guard map's mode-change kill was kept rather than reversed: a spared shell
  means the mode has not started, so there is nothing for that kill to contradict.
- **The toggle can be pending**, which is a third state a user can see. It resolves at a turn boundary and
  not on a timer: a session that goes idle with shells still running is a session where nothing is running
  cells either.
- **The hold is a record, not a copy.** The marker is rewritten every time a spawner answers for a child,
  so a relaxation cannot leave a read-only record behind; and it is written through **the child's own**
  context, so there is no second writer on a session file.
- **Who may lift a hold is now explicit**: a live hold is not the child's to lift and the toggle says so;
  an inherited one is the child's own to change. Both are visible in the status line.
- **The kernel handle gained two members** (`backgrounds()`, `killBackgrounds(ids?)`) — a third deliberate
  widening, on the surface `problems()` already lives on, so that a policy can name what it would stop.
  The contribution shape gained nothing.
- **Headless sessions kill rather than ask.** `ctx.hasUI` is false in print and RPC, and pi's
  non-interactive `confirm` is a stub that answers *no* — which must not be read as consent to keep a
  writer running.
