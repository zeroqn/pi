/**
 * pi-compat — the host-version-tolerant loader for pi-ai's `completeSimple`, carried verbatim from
 * upstream (`advisor/pi-compat.ts`) because the problem it solves is about the *host*, not the lane.
 *
 * Pi >= 0.80.1 moved the global dispatch API (`completeSimple` et al.) to the `@earendil-works/pi-ai/compat`
 * entrypoint; hosts <= 0.79.x export it from the package root and have no `/compat` entrypoint at all.
 * pi-ai resolves at runtime against the HOST's copy, so neither path can be a static import.
 *
 * The fallback is reserved for RESOLUTION failures (the `/compat` subpath does not exist on this host);
 * any other `/compat` error — the entrypoint exists but throws at module init — rethrows, so a real
 * failure is never masked by a root import that may lack the export.
 *
 * `/compat` is documented as temporary (deleted with pi's ModelManager migration); when that lands, this
 * module is the single place to migrate.
 */

type CompleteSimpleFn = typeof import("@earendil-works/pi-ai/compat").completeSimple;

/**
 * Resolve Pi's auth-aware completion facade when the host exposes one.
 *
 * Current hosts keep the canonical `ModelRuntime` behind the extension `ModelRegistry`'s runtime-private
 * `runtime` slot. Calling that facade is what lets Pi apply credential-derived request fields such as
 * GitHub Copilot's OAuth-specific `baseUrl`. Older hosts, and future hosts that move the slot, fall
 * through to the legacy global completion path below.
 *
 * The returned method is bound because `ModelRuntime.completeSimple()` calls other runtime methods
 * through `this`.
 */
export function getRuntimeCompleteSimple(modelRegistry: unknown): CompleteSimpleFn | undefined {
	try {
		if (modelRegistry === null || typeof modelRegistry !== "object") return undefined;
		const runtime = (modelRegistry as { runtime?: unknown }).runtime;
		if (runtime === null || typeof runtime !== "object") return undefined;
		const completeSimple = (runtime as { completeSimple?: unknown }).completeSimple;
		return typeof completeSimple === "function" ? (completeSimple.bind(runtime) as CompleteSimpleFn) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Error codes meaning "the /compat entrypoint is not resolvable on this host":
 *   - `ERR_PACKAGE_PATH_NOT_EXPORTED` — Node's ESM resolver when the installed pi-ai (<= 0.79.x) resolves
 *     but has no "./compat" in its `exports` map.
 *   - `ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND` — Node's / jiti's resolver for an unresolvable module
 *     (jiti is what pi loads `.ts` extensions with).
 */
const MODULE_NOT_FOUND_CODES = new Set([
	"ERR_PACKAGE_PATH_NOT_EXPORTED",
	"ERR_MODULE_NOT_FOUND",
	"MODULE_NOT_FOUND",
]);

/** True for a module-resolution failure. Walks the `cause` chain, bounded against cycles. */
function isModuleNotFound(err: unknown): boolean {
	for (
		let cur: unknown = err, depth = 0;
		cur != null && depth < 16;
		cur = (cur as { cause?: unknown }).cause, depth++
	) {
		if (typeof cur === "object" && MODULE_NOT_FOUND_CODES.has((cur as { code?: unknown }).code as string)) {
			return true;
		}
	}
	return false;
}

export async function loadCompleteSimple(): Promise<CompleteSimpleFn> {
	let mod: { completeSimple?: CompleteSimpleFn };
	try {
		mod = (await import("@earendil-works/pi-ai/compat")) as { completeSimple?: CompleteSimpleFn };
	} catch (err) {
		if (!isModuleNotFound(err)) throw err;
		mod = (await import("@earendil-works/pi-ai")) as { completeSimple?: CompleteSimpleFn };
	}
	const completeSimple = mod.completeSimple;
	if (typeof completeSimple !== "function") {
		throw new Error(
			"pi-ai does not expose completeSimple on /compat or the package root — unsupported host pi-ai version",
		);
	}
	return completeSimple;
}
