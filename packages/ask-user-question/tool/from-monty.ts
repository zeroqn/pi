/**
 * Convert what monty hands a host function into plain JavaScript.
 *
 * monty's value-conversion table (`@pydantic/monty` README) maps a Python `dict` onto a JavaScript
 * **`Map`** — not a plain object — and a `list` onto an `Array`. So a questionnaire arrives as an `Array` of
 * `Map`s, and every key read the obvious way is `undefined`:
 *
 *     await ask_user_question(questions=[{"question": …, "options": [{"label": …}]}])
 *     // the host receives: { questions: [ Map { … } ] }
 *     // Object.keys(question) === []      JSON.stringify(question) === "{}"
 *
 * Measured, not read: a probe host function reported
 * `{"questions":[{}]}` for `JSON.stringify(args[0])` while `arg0` itself — the kwargs bag, which monty
 * builds — had its keys. `tuple` arrives as an `Array` with a non-enumerable `__tuple__`, `bytes` as a
 * `Buffer`, and `set` as a `Set`; none of those reach this port's parameters, so they are passed through.
 *
 * The conversion is deep because a questionnaire is: a list of dicts, each holding a list of dicts.
 */
export function fromMonty(value: unknown): unknown {
	if (value instanceof Map) {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of value) out[String(key)] = fromMonty(entry);
		return out;
	}
	if (Array.isArray(value)) return value.map((entry) => fromMonty(entry));
	if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) out[key] = fromMonty(entry);
		return out;
	}
	return value;
}
