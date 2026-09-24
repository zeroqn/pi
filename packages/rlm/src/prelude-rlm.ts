/**
 * The half of the prelude that belongs to rlm: delegation (`_Rlm`/`rlm`, `agent_message`,
 * `find_models`).
 *
 * Contributed to code mode's kernel at `session_start`, verbatim, in owner order — the kernel's
 * base prelude is a function of `ROOT`/`SCRATCH` and this is appended to it. `pi-skill-bridge`
 * contributes the `skills()` / `skill(name)` half, which concatenates **after** this one: rlm's
 * contribution is accepted first, from the manifest's load order and the child loader's factory
 * order, so this half keeps its position in the composed tail.
 *
 * That tail is **no longer byte-identical** to the capture at
 * `.scratch/rsi-oneway/tools/pre-split-prelude-tail.txt` (990 chars, sha256 `4943da42…`; this half is
 * the first 697): `skill()`'s docstring changed when the call form moved to the bridge, and
 * `.scratch/skill-bridge` ticket 09 records the amendment. The ordering above is what still holds.
 *
 * The host functions it names are contributed in the same call, so a cell can never see a name whose
 * host function was rejected.
 */
export const PRELUDE_TAIL = `class _Rlm:
    def spawn(self, prompt, name, model=None, thinking=None):
        return rlm_spawn(prompt, name, model, thinking)

    def poll(self, selector):
        return rlm_poll(selector)

    def list(self):
        return rlm_list()

    def remove(self, selector):
        return rlm_remove(selector)

    def send(self, selector, text):
        return rlm_send(selector, text)

    def tree_cost(self):
        return rlm_tree_cost()

rlm = _Rlm()

class _AgentMessage:
    def send(self, text, receiver_role=None):
        return agent_message_send(text, receiver_role)

agent_message = _AgentMessage()

def find_models(query=None, limit=20):
    return rlm_find_models(query, limit)

`;
