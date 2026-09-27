/**
 * errors — the one way this package fails a cell.
 *
 * A host function's failure reaches Python as however monty maps the thrown JS error, and it maps by
 * `.name`: `RuntimeError` becomes a Python `RuntimeError`, `ValueError` a `ValueError`. So the name is
 * part of the contract, not decoration — `advisor()` raises because ticket 01 (Q8) decided a fault must
 * not be mistakable for guidance.
 *
 * `fail` returns the error rather than throwing it so a call site reads `throw fail("RuntimeError", …)`
 * and TypeScript still sees the throw as the terminator of the branch.
 */
export function fail(name: "RuntimeError" | "ValueError" | "TypeError", message: string): Error {
	const error = new Error(message);
	error.name = name;
	return error;
}
