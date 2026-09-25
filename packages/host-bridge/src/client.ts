/**
 * The client: the one place in this workspace that reads `pi-code-mode`'s registry — find the entry,
 * check it, mount this session's kernel, contribute, report (map ticket 02, `.scratch/host-bridge/`).
 *
 * It is a **client, not the publisher**. `code-mode` owns the registry and the contract it publishes;
 * this package owns what a *consumer* must do with it. So the literal below is duplicated rather than
 * imported — the rule `rlm/src/bind.ts`, `rsi/code-mode.ts` and `skill-bridge/src/kernel.ts` each
 * followed for the same reason: pi loads every extension entry through its own jiti instance with
 * `moduleCache: false`, an import would be a second module instance, and code mode is reached through
 * a `Symbol.for` rendezvous instead (`.scratch/code-mode`, ADR 0001).
 *
 * **Two halves, deliberately not merged.** {@link mountKernel} hands a consumer the session's handle;
 * the contributor registry in `./convention` is how a package host-bridge must also serve *in a child*
 * registers itself. rsi wants the handle and contributes nothing, so a seam that demanded a
 * contribution in order to hand one over would be a seam with a lie in it (ticket 01 #06).
 *
 * Everything degrades **inertly**: a missing, old or malformed code mode, a mount that throws, a
 * preflight that throws — each is a reason on the result, never an exception. A throwing extension
 * factory is a process kill at startup, so no path in this module may throw.
 */

/** Same symbol, same string: a rendezvous, not an import. Read at call time, never captured. */
export const REGISTRY_KEY = Symbol.for("pi-code-mode:registry");

/** The contract version this build needs. Code mode publishes its own; the consumer compares. */
export const REQUIRED_API_VERSION = 1;

export type KernelHostFn = (...args: unknown[]) => Promise<unknown>;

export type KernelNotice = {
	key: string;
	content: string;
	customType?: string;
	cancelled?: () => boolean;
};

/** Which journals a session replays, and which scratch to seed from. rlm owns the rule. */
export type KernelProvenance = { journals: string[]; seedScratchFrom?: string };

/**
 * What a contributor writes into a kernel. This mirrors code-mode's own `Contribution` — the fields
 * are the publisher's, and this module must not widen them (standing preference 2: no change to code
 * mode's contract). `owner`, `onNotice` and `provenance` are single-owner there: a second declarer of
 * a slot is refused whole by the ledger, not silently ignored.
 */
export type KernelContribution = {
	owner: string;
	hostFns?: Record<string, KernelHostFn>;
	prelude?: string;
	description?: string;
	snippet?: string;
	guidelines?: string[];
	onNotice?: (notice: KernelNotice) => void;
	provenance?: (
		ctx: unknown,
		own: { sessionFile?: string; firstIndex?: number },
	) => KernelProvenance;
};

export type KernelRejection = { name: string; reason: string };
export type KernelReceipt = { owner: string; accepted: string[]; rejected: KernelRejection[] };

/** What a consumer may rely on of the mounted handle. The rest is code mode's own surface. */
export type KernelHandle = {
	readonly publisher: string;
	readonly apiVersion: number;
	readonly sessionKey: string;
	readonly mounts: number;
	currentCell: () => string;
	root: () => string;
	scratch: () => string;
	progress: () => ((text: string) => void) | undefined;
	problems: () => Promise<string[]>;
	contribute: (contribution: KernelContribution) => KernelReceipt;
};

export type KernelEntry = {
	publisher: string;
	apiVersion: number;
	sessions: Map<string, KernelHandle>;
	mount: (pi: unknown, ctx: unknown) => KernelHandle;
	/** The factory a spawned child's loader loads, when the publisher offers one. */
	childExtension?: () => ((pi: unknown) => void) | undefined;
};

export type KernelLookup =
	| { status: "absent" }
	| { status: "wrong-shape"; reason: string }
	| { status: "found"; entry: KernelEntry };

export type MountResult =
	| { status: "mounted"; handle: KernelHandle }
	| { status: "inert"; reason: string };

export type ContributeReport = {
	/** Every owner whose contribution reached the ledger, in order, deduped. A refused one is absent. */
	owners: string[];
	/**
	 * Every host-function name a cell can now call.
	 *
	 * Derived from the contributions the ledger accepted, **not** from the receipt's own list: the
	 * receipt reports the contribution's *fields* (`hostFns`' names and `"guidelines"`, `"prelude"` …,
	 * `code-mode/src/contract.ts:361`), which is the ledger's vocabulary rather than a reader's. A
	 * refusal is whole, so a refused contribution installs none of its names.
	 */
	installed: string[];
	/** The contributions that reached the ledger, in order — what later facts are derived from. */
	landed: KernelContribution[];
	/** One line per refusal or throw: why a contribution did not land. Never why the session has no kernel. */
	problems: string[];
};

export type Glob = Record<symbol, unknown>;

function globals(): Glob {
	return globalThis as unknown as Glob;
}

function describe(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function shapeProblem(raw: unknown): string | null {
	if (typeof raw !== "object" || raw === null) return "the registry entry is not an object";
	const entry = raw as Partial<KernelEntry>;
	if (typeof entry.publisher !== "string") return "the entry has no publisher name";
	if (typeof entry.apiVersion !== "number") return "the entry has no numeric apiVersion";
	if (!(entry.sessions instanceof Map)) return "the entry has no sessions map";
	if (typeof entry.mount !== "function") return "the entry has no mount function";
	return null;
}

/** Find code mode's entry, or say why it cannot be used. Reading the globals cannot throw out of here. */
export function findKernel(glob: Glob = globals()): KernelLookup {
	let raw: unknown;
	try {
		raw = glob?.[REGISTRY_KEY];
	} catch {
		return { status: "absent" };
	}
	if (raw === undefined || raw === null) return { status: "absent" };
	const problem = shapeProblem(raw);
	if (problem) return { status: "wrong-shape", reason: problem };
	return { status: "found", entry: raw as KernelEntry };
}

/** An entry at least as new as this build needs. A newer entry with an unchanged shape is fine. */
export function versionProblem(
	entry: { apiVersion: number },
	minimum = REQUIRED_API_VERSION,
): string | null {
	if (typeof entry.apiVersion !== "number") return "the entry has no numeric apiVersion";
	if (entry.apiVersion >= minimum) return null;
	return `code mode's contract is version ${entry.apiVersion}, and this build needs ${minimum}`;
}

function isHandle(candidate: unknown): candidate is KernelHandle {
	if (typeof candidate !== "object" || candidate === null) return false;
	const handle = candidate as Partial<KernelHandle>;
	return (
		typeof handle.contribute === "function" &&
		typeof handle.sessionKey === "string" &&
		typeof handle.problems === "function"
	);
}

/**
 * Mount this session's kernel and hand back the handle.
 *
 * The mount is **idempotent by session key**, so it does not matter whether code mode's own
 * `session_start` handler ran first or whether another consumer asked before: every caller gets the
 * same handle, and therefore the same ledger. `problems()` is deliberately *not* awaited here (see
 * {@link kernelProblems}) — a caller that only wants the handle, like rsi, stays synchronous.
 */
export function mountKernel(input: { pi: unknown; ctx: unknown; glob?: Glob }): MountResult {
	const lookup = findKernel(input.glob ?? globals());
	if (lookup.status === "absent") {
		return {
			status: "inert",
			reason: "code mode is not present on the registry (pi cannot say why: no extension enumeration)",
		};
	}
	if (lookup.status === "wrong-shape") {
		return { status: "inert", reason: `code mode's registry entry is unusable: ${lookup.reason}` };
	}
	const stale = versionProblem(lookup.entry);
	if (stale) return { status: "inert", reason: stale };
	let handle: unknown;
	try {
		handle = lookup.entry.mount(input.pi, input.ctx);
	} catch (error) {
		return {
			status: "inert",
			reason: `code mode could not mount a kernel for this session: ${describe(error)}`,
		};
	}
	if (!isHandle(handle)) {
		return { status: "inert", reason: "code mode mounted something that is not a kernel handle" };
	}
	return { status: "mounted", handle };
}

/**
 * The kernel's own preflight, or `[]`.
 *
 * A handle that cannot answer its own preflight must not take a session down: the tool is still
 * registered by code mode and reports the failure per cell, so a caller records "no problems known"
 * rather than losing the session.
 */
export async function kernelProblems(handle: KernelHandle): Promise<string[]> {
	try {
		return (await handle.problems()) ?? [];
	} catch {
		return [];
	}
}

/**
 * Write every contribution into the kernel, collecting what the ledger did.
 *
 * A refused contribution is code mode's all-or-nothing rule doing its job, and it is *per
 * contribution*: one refusal must not stop the next contributor from being served. A `contribute`
 * that throws is recorded as a problem and the loop continues, for the same reason.
 */
export function contributeAll(
	handle: KernelHandle,
	contributions: readonly KernelContribution[],
): ContributeReport {
	const report: ContributeReport = { owners: [], installed: [], landed: [], problems: [] };
	for (const contribution of contributions) {
		let receipt: KernelReceipt;
		try {
			receipt = handle.contribute(contribution);
		} catch (error) {
			report.problems.push(
				`${contribution.owner}: contributing to the kernel failed — ${describe(error)}`,
			);
			continue;
		}
		const owner = typeof receipt?.owner === "string" ? receipt.owner : contribution.owner;
		const refused = receipt?.rejected ?? [];
		if (refused.length > 0) {
			// All-or-nothing: nothing from this contribution is in the kernel, so its owner is not an
			// owner of anything and none of its names is installed.
			report.problems.push(
				`${owner} refused whole: ${refused.map((r) => `${r.name} (${r.reason})`).join("; ")}`,
			);
			continue;
		}
		report.owners.push(owner);
		report.landed.push(contribution);
		for (const name of Object.keys(contribution.hostFns ?? {})) report.installed.push(name);
	}
	report.owners = [...new Set(report.owners)];
	report.installed = [...new Set(report.installed)];
	return report;
}

/**
 * The factory a spawned child's loader must load, or `[]`.
 *
 * A child loads no ambient extensions, so without code mode's own instance on it nothing running on
 * the child can reach the kernel its spawner mounted — no `agent_end`, no `session_shutdown`, and the
 * kernel is dumped at neither moment. The factory is the publisher's own function object, handed over
 * at runtime: this module still does not import code mode. Best effort, like every other path here —
 * a seam that throws must cost the child its lifecycle, never its session.
 */
export function childExtensionFactories(glob: Glob = globals()): Array<(pi: unknown) => void> {
	const lookup = findKernel(glob);
	if (lookup.status !== "found" || typeof lookup.entry.childExtension !== "function") return [];
	try {
		const factory = lookup.entry.childExtension();
		return typeof factory === "function" ? [factory] : [];
	} catch {
		return [];
	}
}
