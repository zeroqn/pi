/** `bind`, as code mode's `host.ts` has it: positional-then-keyword arguments, which is how
 * a Python call arrives. Duplicated for the same reason the four coercions are: the contract
 * forbids an import between the two packages (ticket 03, C8).
 *
 * An unknown keyword and a surplus positional are **refused, not dropped**, which is the rule code
 * mode's copy enforces and for the same reason: a caller who misspells `name` believes it named the
 * child, and the refusal is the only way it hears otherwise — `rlm.spawn(promtp="…", name="…")`
 * would otherwise spawn with an empty prompt, or wait for a `selector` that was never bound.
 */
export function bind(args: unknown[], names: string[], fn: string): Record<string, unknown> {
	const list = [...args];
	let kwargs: Record<string, unknown> = {};
	const last = list[list.length - 1];
	if (last && typeof last === "object" && !Array.isArray(last) && !Buffer.isBuffer(last)) {
		kwargs = list.pop() as Record<string, unknown>;
	}
	if (list.length > names.length) {
		throw badArgument(
			`${fn} takes at most ${names.length} positional arguments (${names.join(", ")}), got ${list.length}`,
		);
	}
	for (const key of Object.keys(kwargs)) {
		if (!names.includes(key)) throw badArgument(`${fn} has no parameter "${key}" (takes ${names.join(", ")})`);
	}
	const out: Record<string, unknown> = {};
	names.forEach((name, index) => {
		const positional = list[index];
		if (index < list.length && kwargs[name] !== undefined) {
			throw badArgument(`${fn}: "${name}" was given twice, as a positional and by name`);
		}
		out[name] = positional !== undefined && positional !== null ? positional : (kwargs[name] ?? null);
	});
	return out;
}

/** The exception a cell sees for an argument its host function cannot bind. `.name` is what monty
 * maps onto the Python exception, so a misspelling arrives as a `ValueError` rather than as a
 * default nobody can see. */
function badArgument(message: string): Error {
	const error = new Error(message);
	error.name = "ValueError";
	return error;
}
