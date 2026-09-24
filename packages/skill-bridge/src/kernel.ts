/**
 * This package's client for code mode's registry — the one place in this package that knows another
 * package's shape, and deliberately the only one.
 *
 * It does not import code mode: pi loads each extension entry through its own module graph, and a child
 * session loads no ambient extensions at all, so the seam is a `Symbol.for` registry published at module
 * load. The literals below are therefore duplicated on both sides rather than shared — the rule
 * `rlm/src/bind.ts` and `rsi/code-mode.ts` already follow, and this is the third copy of it
 * (`.scratch/skill-bridge` ticket 01 #10 priced that as the cost of owning the call form).
 *
 * Everything here degrades **inertly**: a missing, old or malformed code mode means no kernel and a
 * recorded reason, never a crash. A throwing extension factory is a process kill at startup, so no path
 * in this module may throw.
 */

/** Same symbol, same string: a rendezvous, not an import. */
export const REGISTRY_KEY = Symbol.for("pi-code-mode:registry");

/** The contract version this build needs. Code mode publishes its own; the consumer compares. */
export const REQUIRED_API_VERSION = 1;

export type KernelRejection = { name: string; reason: string };
export type KernelReceipt = { owner: string; accepted: string[]; rejected: KernelRejection[] };

/** What this package needs from a mounted kernel. */
export type KernelHandle = {
	readonly publisher: string;
	readonly apiVersion: number;
	readonly sessionKey: string;
	contribute: (contribution: KernelContribution) => KernelReceipt;
};

/** What this package contributes: the two host functions and the prelude that names them. */
export type KernelContribution = {
	owner: string;
	hostFns?: Record<string, (...args: unknown[]) => Promise<unknown>>;
	prelude?: string;
};

type RegistryEntry = {
	publisher: string;
	apiVersion: number;
	sessions: Map<string, unknown>;
	mount: (pi: unknown, ctx: unknown) => KernelHandle;
};

/** The outcome of trying to serve one session. A refusal still leaves a usable handle. */
export type KernelBind = {
	handle: KernelHandle | null;
	receipt: KernelReceipt | null;
	problem?: string;
};

function message(error: unknown): string {
	return String((error as Error)?.message ?? error);
}

function shapeProblem(raw: unknown): string | null {
	if (typeof raw !== "object" || raw === null) return "the registry entry is not an object";
	const entry = raw as Partial<RegistryEntry>;
	if (typeof entry.publisher !== "string") return "the entry has no publisher name";
	if (typeof entry.apiVersion !== "number") return "the entry has no numeric apiVersion";
	if (!(entry.sessions instanceof Map)) return "the entry has no sessions map";
	if (typeof entry.mount !== "function") return "the entry has no mount function";
	return null;
}

/** The version this build needs against the one code mode publishes. */
export function versionProblem(entry: { apiVersion: number }): string | null {
	if (typeof entry.apiVersion !== "number") return "the entry has no numeric apiVersion";
	if (entry.apiVersion >= REQUIRED_API_VERSION) return null;
	return `code mode's contract is version ${entry.apiVersion}, and this build of skill-bridge needs ${REQUIRED_API_VERSION}`;
}

/** Find code mode's entry, or say why it cannot be used. */
export function findKernelEntry(
	glob: Record<symbol, unknown> = globalThis as Record<symbol, unknown>,
): { status: "found"; entry: RegistryEntry } | { status: "inert"; reason: string } {
	let raw: unknown;
	try {
		raw = glob?.[REGISTRY_KEY];
	} catch {
		return { status: "inert", reason: "the process globals could not be read" };
	}
	if (raw === undefined || raw === null) {
		return {
			status: "inert",
			reason: "code mode is not present on the registry (pi cannot say why: no extension enumeration)",
		};
	}
	const problem = shapeProblem(raw);
	if (problem) return { status: "inert", reason: `code mode's registry entry is unusable: ${problem}` };
	return { status: "found", entry: raw as RegistryEntry };
}

/**
 * Mount this session's kernel, contribute the call form, and hand back both.
 *
 * The mount is idempotent by session key, so it does not matter whether code mode's own
 * `session_start` ran first, or whether rlm or rsi mounted already: every caller gets the same handle
 * and therefore the same ledger. `contribution` is a callback because a contributor needs the handle to
 * build what it contributes.
 */
export function bindKernel(options: {
	pi: unknown;
	ctx: unknown;
	contribution: (handle: KernelHandle) => KernelContribution;
	glob?: Record<symbol, unknown>;
}): KernelBind {
	const lookup = findKernelEntry(options.glob);
	if (lookup.status !== "found") return { handle: null, receipt: null, problem: lookup.reason };
	const stale = versionProblem(lookup.entry);
	if (stale) return { handle: null, receipt: null, problem: stale };

	let handle: KernelHandle;
	try {
		handle = lookup.entry.mount(options.pi, options.ctx);
	} catch (error) {
		return {
			handle: null,
			receipt: null,
			problem: `code mode could not mount a kernel for this session: ${message(error)}`,
		};
	}
	if (!handle || typeof handle.contribute !== "function") {
		return { handle: null, receipt: null, problem: "code mode mounted something that is not a kernel handle" };
	}

	try {
		return { handle, receipt: handle.contribute(options.contribution(handle)) };
	} catch (error) {
		// The handle is still real: the session has a kernel, this package simply could not write to it.
		return { handle, receipt: null, problem: `contributing to the kernel failed: ${message(error)}` };
	}
}
