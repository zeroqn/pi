/**
 * How a cell's value is shown back to the model (`# => ...`).
 *
 * monty marshals a Python dict as a JS **`Map`** on the way out of the sandbox, and
 * `JSON.stringify(new Map())` is `{}` — so the most ordinary thing a cell can return
 * (`await bash("ls")` as the last expression) would be reported as an empty object.
 * Containers are converted instead, and anything JSON cannot express falls back to
 * `String` rather than throwing into the middle of a turn.
 */
export function renderValue(value: unknown): string {
	try {
		return (
			JSON.stringify(value, (_key, candidate) => {
				if (candidate instanceof Map) return Object.fromEntries(candidate);
				if (candidate instanceof Set) return [...candidate];
				if (typeof candidate === "bigint") return `${candidate}n`;
				return candidate;
			}) ?? String(value)
		);
	} catch {
		// A true cycle, or something JSON refuses; a readable fallback beats a thrown turn.
		return String(value);
	}
}
