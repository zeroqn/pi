/**
 * The half of the prelude that belongs to RSI: the learned-skill wrappers.
 *
 * Split out of RLM's `PRELUDE_TAIL` by map ticket 04. The two halves concatenate in acceptance
 * order — RLM's contribution is accepted first, from the manifest's load order and the child
 * loader's factory order — and the concatenation is byte-identical to the pre-split string
 * captured at `.scratch/rsi-oneway/tools/pre-split-prelude-tail.txt` (990 chars, sha256
 * `4943da42…`; this half is the last 293).
 *
 * The host functions it names (`skills_host`, `skill_host`) are contributed in the **same**
 * `contribute()` call, so a cell can never see a name whose host function was rejected — the
 * ledger's all-or-nothing rule, which is why the two arrive together or not at all.
 *
 * The names are unchanged from the pre-split prelude for a hard reason rather than a
 * stylistic one: a dump-restored session skips re-feeding the prelude, so a restored kernel
 * still holds these definitions calling `skills_host` by name, while host functions resolve
 * per cell through `externalLookup`. A rename would break every restored dump.
 */
export const RSI_PRELUDE = `async def skills():
    """The learned skills this session can see: a list of {name, description, location, scope}."""
    return await skills_host()

async def skill(name):
    """Load one learned skill's content. Raises when the name is not in skills()."""
    return await skill_host(name)
`;
