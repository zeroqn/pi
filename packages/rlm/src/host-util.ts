/** `bind`, as code mode's `host.ts` has it: positional-then-keyword arguments, which is how
 * a Python call arrives. Duplicated for the same reason the four coercions are: the contract
 * forbids an import between the two packages (ticket 03, C8).
 */
export function bind(args: unknown[], names: string[]): Record<string, unknown> {
	const list = [...args];
	let kwargs: Record<string, unknown> = {};
	const last = list[list.length - 1];
	if (last && typeof last === "object" && !Array.isArray(last) && !Buffer.isBuffer(last)) {
		kwargs = list.pop() as Record<string, unknown>;
	}
	const out: Record<string, unknown> = {};
	names.forEach((name, index) => {
		const positional = list[index];
		out[name] = positional !== undefined && positional !== null ? positional : (kwargs[name] ?? null);
	});
	return out;
}
