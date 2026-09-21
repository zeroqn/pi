/**
 * The half of the prelude that belongs to rlm: delegation (`_Rlm`/`rlm`,
 * `agent_message`, `find_models`) and the learned-skill seam (`skills`, `skill`).
 *
 * Contributed to code mode's kernel at `session_start`, verbatim, in owner order — the
 * kernel's base prelude is a function of `ROOT`/`SCRATCH` and this is appended to it. The
 * host functions it names are contributed in the same call, so the two halves arrive
 * together or not at all (ticket 01: all-or-nothing).
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

async def skills():
    """The learned skills this session can see: a list of {name, description, location, scope}."""
    return await skills_host()

async def skill(name):
    """Load one learned skill's content. Raises when the name is not in skills()."""
    return await skill_host(name)
`;
