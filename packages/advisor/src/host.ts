/**
 * host — the one function a cell calls.
 *
 * `await advisor()` takes **no arguments** (ticket 06, Q7). monty hands a host function's keyword
 * arguments as one trailing plain object, so `advisor(focus="x")` arrives as a dict: this refuses it with
 * a `ValueError` *before* the reviewer is called, rather than ignoring the extra the way a typebox schema
 * does on the tool lane. An unknown keyword that silently does nothing is how a cell loses a request it
 * believed it made.
 */
import { fail } from "./errors.ts";
import { type AdvisorValue, executeAdvisor } from "./execute.ts";
import { ADVISOR_HOST_FN, errUnknownArgument } from "./messages.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createAdvisorHost(input: {
	ctx: unknown;
	progress?: (text: string) => void;
}): (...args: unknown[]) => Promise<AdvisorValue> {
	return async (...args: unknown[]): Promise<AdvisorValue> => {
		if (args.length > 0) {
			const last = args[args.length - 1];
			const keys = args.length === 1 && isPlainObject(last) ? Object.keys(last) : ["<positional>"];
			throw fail("ValueError", errUnknownArgument(ADVISOR_HOST_FN, keys));
		}
		return executeAdvisor({ ctx: input.ctx, progress: input.progress });
	};
}
