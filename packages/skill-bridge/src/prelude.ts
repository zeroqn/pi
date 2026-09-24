/**
 * The half of the prelude that belongs to the bridge: the learned-skill wrappers.
 *
 * Moved here from RSI (`packages/rsi/prelude-rsi.ts`, wayfinder map `.scratch/rsi-oneway` ticket 04)
 * when the call form changed hands (`.scratch/skill-bridge` tickets 01 and 05). The names are
 * unchanged and **frozen**: a dump-restored kernel skips re-feeding the prelude, so it still holds
 * these definitions calling `skills_host` / `skill_host` by bare name while host functions resolve per
 * cell — a rename would break every restored dump. A provider's usage evidence may also be a
 * `skill_host` name match in code-mode's journal, which a rename would silence.
 *
 * The host functions it names are contributed in the **same** `contribute()` call, so a cell can never
 * see a name whose host function was rejected — the ledger's all-or-nothing rule, which is why the two
 * arrive together or not at all.
 *
 * **The one deliberate change** from RSI's text: `skill()`'s docstring. It used to promise "one
 * *learned* skill's content" and to raise "when the name is not in skills()" — both false now that a
 * pi-loaded skill resolves by name too, and false in a way that would teach a model reading
 * `skill.__doc__` to stop trying them. The composed prelude tail therefore differs from the closed
 * map's capture (`4943da42…`), which ticket 09 records as a dated amendment.
 */
export const SKILL_PRELUDE = `async def skills():
    """The skills this session's providers supply: a list of {name, description, location, scope}."""
    return await skills_host()

async def skill(name):
    """Load one skill's content by name — provider-supplied or one pi loaded. Call skills() for the provider's list."""
    return await skill_host(name)
`;
