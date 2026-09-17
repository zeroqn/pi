/**
 * Errors that must arrive in the sandbox as recognisable Python types.
 *
 * monty carries an exception across the boundary by `error.name` when it matches one of
 * the types monty implements (`docs/limitations/exceptions.md`), so the mapping decided in
 * map ticket 04 is expressed by naming the JS error:
 *
 *   - `TypeError` / `ValueError`  bad arguments, and the SSRF guard refusing a URL
 *   - `TimeoutError`              the call ran out of its budget
 *   - `OSError`                   transport, DNS, TLS, a non-2xx response
 *   - `RuntimeError`              every provider failed; too many redirects
 *
 * `ConnectionError` is deliberately never used: monty does not implement it.
 */

export type WebErrorName = "TypeError" | "ValueError" | "TimeoutError" | "OSError" | "RuntimeError";

export function webError(name: WebErrorName, message: string): Error {
	const error = new Error(message);
	error.name = name;
	return error;
}

export function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Wrap an unknown rejection so the sandbox sees a Python type it can catch. */
export function asWebError(error: unknown, fallback: WebErrorName, context: string): Error {
	if (error instanceof Error && (error.name === "TypeError" || error.name === "ValueError" || error.name === "TimeoutError" || error.name === "OSError" || error.name === "RuntimeError")) {
		return error;
	}
	return webError(fallback, `${context}: ${messageOf(error)}`);
}
