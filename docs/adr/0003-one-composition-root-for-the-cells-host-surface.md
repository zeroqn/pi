# One composition root and one client for code mode's registry

Every package that adds to a cell had its own way in. `pi-rlm` mounted the kernel through its own
private copy of the registry client and contributed from there; `pi-skill-bridge` carried a second copy
and mounted for itself, because it had to work with rsi absent; `rsi` carried a third to hold a handle
for its learner gate; and web-access's functions reached a kernel through an environment variable
(`RLM_WEB_MODULE`) that only rlm read. Three copies of the same ~150-line client, a hook that named one
package from another, and a child path each package had to be told about separately.

We therefore introduced **`pi-host-bridge`**: the one client of code mode's registry, and the
**composition root** for a session — it mounts, asks every contributor for the session (root or child),
writes it into the ledger, records what landed, and composes a child's factories. A package becomes a
**contributor** by registering `{key, owner, apiVersion, session(input) → {contribution?, systemPrompt?,
reaches?, problems?}, childEligible, childFactories, childSurface, bindChild, childStatus}` on a
process-global slot; nothing names it from outside.

## Considered options

- **Widen the tool bridge to carry host functions too.** Its publication convention exists for pi tools,
  and its reader's inputs (the catalogue, the native-only list, the child-eligibility list) are owner
  knowledge; a package that carried all of that would be a composition root with an owner's policy
  inside it, which is exactly the coupling the tool-ownership effort removed.
- **Give each contributor its own mount** (what the skill bridge did). It works and it is simple, but it
  leaves the mount count as a convention rather than a rule, and every contributor has to be taught the
  child path separately — which is how rlm ended up naming the skill bridge in its child factory list.
- **Move the active-set rule in too.** The rule is about *pi's* active set and every input to it is owner
  knowledge; it stays with the tool bridge, which reads the record the composition root writes.

## Consequences

- **A contributor registers; nothing is named.** rlm no longer imports the tool bridge or the skill
  bridge, rlm's child factory list names only rsi (its own seam), and `RLM_WEB_MODULE` is gone: web-access
  registers itself, so a spawned child gets its host functions with no entry of its own loaded.
- **The record is the composition root's, and it is written after the ledger.** A name lands there only
  if the contribution did, which is what keeps the active-set rule from stripping a pi tool whose cell
  route never appeared (`reaches` is the contributor's own answer, recorded only for contributions that
  landed).
- **Two APIs, not one**: the client (mount and contribute, for a package that wants a handle — rsi
  registers nothing) is separate from the registry (for a package the seam must serve in a child too). A
  seam that demanded a contribution in exchange for a handle would be a seam with a lie in it.
- **The registry's state is process-global.** pi loads each extension entry through its own jiti instance
  (`moduleCache: false`), so a shared module's *state* is not shared: the contributor registry, the child
  detector, the session records and skill-bridge's per-session facts are all `Symbol.for` slots. A spawned
  child measured the cost of forgetting this — two installs of one surface, and therefore two blocks.
- **Absence is inert.** With no code mode the composition records `mounted: false` and every contributor
  degrades; a session with no contributor registered at all is touched in no way (no mount, no record).
