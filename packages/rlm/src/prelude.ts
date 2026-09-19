/**
 * The Python prelude fed to a fresh kernel — the contract in ticket 05.
 *
 * A pure string builder. The helpers resolve relative paths against ROOT, and every
 * host function it wraps is injected per feed, so the names it mentions are only
 * resolved when a cell actually calls one.
 */

export function prelude(root: string, scratch: string): string {
	return `import os, json

ROOT = ${JSON.stringify(root)}
SCRATCH = ${JSON.stringify(scratch)}

def _abs(p):
    p = str(p)
    return p if p.startswith("/") else ROOT + "/" + p

def read_text(path):
    with open(_abs(path)) as f:
        return f.read()

def write_text(path, text):
    with open(_abs(path), "w") as f:
        f.write(text)
    return len(text)

def exists(path):
    try:
        os.stat(_abs(path))
        return True
    except Exception:
        return False

def edit_text(path, old, new, count=1):
    text = read_text(path)
    if old not in text:
        raise ValueError("oldText not found in " + _abs(path))
    write_text(path, text.replace(old, new, count))
    return "ok"

def walk(root="."):
    stack = [_abs(root)]
    out = []
    while stack:
        d = stack.pop()
        for name in os.listdir(d):
            p = d + "/" + name
            try:
                os.listdir(p)
                out.append(p + "/")
                stack.append(p)
            except Exception:
                out.append(p)
    return sorted(out)

def read_json(path):
    return json.loads(read_text(path))

def write_json(path, value, indent=2):
    write_text(path, json.dumps(value, indent=indent))
    return "ok"

def mkdirp(path):
    try:
        os.makedirs(_abs(path))
    except Exception:
        pass
    return _abs(path)

class BgHandle:
    def __init__(self, handle_id):
        self.id = handle_id

    def poll(self):
        return bg_poll(self.id)

    def output(self, tail_bytes=None):
        return bg_read(self.id)

    def kill(self):
        return bg_kill(self.id)

async def bash(command, timeout=None, background=False):
    result = await bash_host(command, timeout, background)
    if isinstance(result, dict) and result.get("id"):
        return BgHandle(result["id"])
    return result

class _Rlm:
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
}
