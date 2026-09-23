/**
 * RSI's client for code mode's registry — the one place in this extension that knows another
 * package's shape, and deliberately the only one (map ticket 04 §2).
 *
 * RSI does not import code mode: pi loads each extension entry through its own module graph,
 * and a child session loads no ambient extensions at all, so the seam is a `Symbol.for`
 * registry published at module load. The literals below are therefore duplicated on both sides
 * rather than shared — the rule `rlm/src/bind.ts` already follows, and for the same reason.
 *
 * Everything here degrades **inertly**: a missing, old or malformed code mode means no kernel
 * and a recorded reason, never a crash. A throwing extension factory is a process kill at
 * startup, so no path in this module may throw.
 */

/** Same symbol, same string: a rendezvous, not an import. */
const REGISTRY_KEY = Symbol.for("pi-code-mode:registry");

/** The contract version this build needs. Code mode publishes its own; the consumer compares. */
export const REQUIRED_API_VERSION = 1;

export type KernelRejection = { name: string; reason: string };
export type KernelReceipt = { owner: string; accepted: string[]; rejected: KernelRejection[] };

/** What RSI needs from a mounted kernel. */
export type KernelHandle = {
	readonly publisher: string;
	readonly apiVersion: number;
	readonly sessionKey: string;
	contribute: (contribution: KernelContribution) => KernelReceipt;
};

/**
 * What RSI contributes: the learned-skill host functions and the prelude lines that name them.
 * **No text** — no description, no snippet, no guidelines — which is what keeps the
 * model-visible surface byte-identical across the move (map ticket 04 §1).
 */
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

/**
 * The outcome of trying to serve one session.
 *
 * A **refused contribution still leaves a usable handle**, and that is load-bearing rather than
 * incidental: the learner gate asks whether the session has a kernel, not whether RSI is in it
 * (map ticket 10 §1). `problem` is present exactly when there is no handle, or when the
 * contribution did not land.
 */
export type KernelBind = {
	handle: KernelHandle | null;
	receipt: KernelReceipt | null;
	problem?: string;
};

function message(error: unknown): string {
	return String((error as Error)?.message ?? error);
}

/**
 * Find code mode's entry, or say why it cannot be used. The key is the contract; the shape
 * check is what turns "something is on that slot" into a reason a human can read.
 */
export function findKernelEntry(glob: Record<symbol, unknown> = globalThis as Record<symbol, unknown>):
	| { status: "found"; entry: RegistryEntry }
	| { status: "inert"; reason: string } {
	let raw: unknown;
	try {
		raw = glob?.[REGISTRY_KEY];
	} catch {
		return { status: "inert", reason: "the process globals could not be read" };
	}
	if (raw === undefined || raw === null) {
		return { status: "inert", reason: "code mode is not present on the registry (pi cannot say why: no extension enumeration)" };
	}
	const problem = shapeProblem(raw);
	if (problem) return { status: "inert", reason: `code mode's registry entry is unusable: ${problem}` };
	return { status: "found", entry: raw as RegistryEntry };
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
	return `code mode's contract is version ${entry.apiVersion}, and this build of rsi needs ${REQUIRED_API_VERSION}`;
}

/**
 * Mount this session's kernel, contribute RSI's surface, and hand back both.
 *
 * The mount is idempotent by session key, so it does not matter whether code mode's own
 * `session_start` handler ran first, or whether rlm mounted already: every caller gets the same
 * handle object and therefore the same ledger. `contribution` is a callback because a
 * contributor needs the handle to build what it contributes.
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
		return { handle: null, receipt: null, problem: `code mode could not mount a kernel for this session: ${message(error)}` };
	}
	if (!handle || typeof handle.contribute !== "function") {
		return { handle: null, receipt: null, problem: "code mode mounted something that is not a kernel handle" };
	}

	try {
		return { handle, receipt: handle.contribute(options.contribution(handle)) };
	} catch (error) {
		// The handle is still real: the session has a kernel, RSI simply could not write to it.
		return { handle, receipt: null, problem: `contributing to the kernel failed: ${message(error)}` };
	}
}
