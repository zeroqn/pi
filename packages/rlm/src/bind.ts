/**
 * The registry client: how rlm reaches code mode.
 *
 * rlm does not import code mode (map ticket 01, ADR 0001) — pi loads each extension entry
 * through its own module graph, and a child session loads no ambient extensions at all — so
 * the seam is a `Symbol.for` registry published at module load. This file is the only place
 * that knows the shape of what is there, and it is deliberately the only place: a consumer
 * that invents its own reading of the entry is a consumer that breaks when the contract moves.
 *
 * Everything here degrades **loudly and inertly** (ticket 01's failure table): a missing, old
 * or malformed code mode means no `python` tool and a recorded reason, never a crash. A
 * throwing extension factory is a process kill at startup (measured in ticket 02 §1), so no
 * path in this module may throw.
 */
import { str } from "./util";

/** Same symbol, same string: a rendezvous, not an import. */
const REGISTRY_KEY = Symbol.for("pi-code-mode:registry");
/** The contract version this build needs. Code mode publishes its own; the consumer compares. */
export const REQUIRED_API_VERSION = 1;
const PUBLISHER = "pi-code-mode";

export type Rejection = { name: string; reason: string };
export type Receipt = { owner: string; accepted: string[]; rejected: Rejection[] };

export type CodeModeHandle = {
	readonly publisher: string;
	readonly apiVersion: number;
	readonly sessionKey: string;
	readonly mounts: number;
	currentCell: () => string;
	root: () => string;
	scratch: () => string;
	progress: () => ((text: string) => void) | undefined;
	problems: () => Promise<string[]>;
	contribute: (contribution: CodeModeContribution) => Receipt;
};

export type CodeModeContribution = {
	owner: string;
	hostFns?: Record<string, (...args: unknown[]) => Promise<unknown>>;
	prelude?: string;
	description?: string;
	snippet?: string;
	guidelines?: string[];
	onHostCall?: (name: string, args: unknown[]) => void;
	onNotice?: (notice: { key: string; content: string; customType?: string; cancelled?: () => boolean }) => void;
	provenance?: (
		ctx: unknown,
		own: { sessionFile?: string; firstIndex?: number },
	) => { journals: string[]; seedScratchFrom?: string } | undefined;
};

export type CodeModeEntry = {
	publisher: string;
	apiVersion: number;
	sessions: Map<string, CodeModeHandle>;
	mount: (pi: unknown, ctx: unknown) => CodeModeHandle;
	/** The factory a spawned child's loader loads, when this entry offers one. Optional, and its
	 * absence costs the child nothing but its lifecycle (see {@link codeModeChildExtensions}). */
	childExtension?: () => ((pi: unknown) => void) | undefined;
};

export type BindResult =
	| { status: "bound"; handle: CodeModeHandle; problems: string[]; rejections: { owner: string; rejected: Rejection[] }[] }
	| { status: "inert"; reason: string };

/** What a consumer needs to explain itself, so a human gets a reason and not a shrug. */
export type Lookup =
	| { status: "absent" }
	| { status: "wrong-shape"; reason: string }
	| { status: "found"; entry: CodeModeEntry };

export function findCodeMode(glob: Record<symbol, unknown> = globalThis as never): Lookup {
	let raw: unknown;
	try {
		raw = glob?.[REGISTRY_KEY];
	} catch {
		return { status: "absent" };
	}
	if (raw === undefined || raw === null) return { status: "absent" };
	const problem = shapeProblem(raw);
	if (problem) return { status: "wrong-shape", reason: problem };
	return { status: "found", entry: raw as CodeModeEntry };
}

function shapeProblem(raw: unknown): string | null {
	if (typeof raw !== "object" || raw === null) return "the registry entry is not an object";
	const entry = raw as Partial<CodeModeEntry>;
	if (typeof entry.publisher !== "string") return "the entry has no publisher name";
	if (typeof entry.apiVersion !== "number") return "the entry has no numeric apiVersion";
	if (!(entry.sessions instanceof Map)) return "the entry has no sessions map";
	if (typeof entry.mount !== "function") return "the entry has no mount function";
	return null;
}

export function versionProblem(entry: { apiVersion: number }): string | null {
	if (typeof entry.apiVersion !== "number") return "the entry has no numeric apiVersion";
	if (entry.apiVersion >= REQUIRED_API_VERSION) return null;
	return `code mode's contract is version ${entry.apiVersion}, and this build of rlm needs ${REQUIRED_API_VERSION}`;
}

/**
 * The extension factories a spawned child's loader is given, or `[]` when code mode is absent, lacks
 * the member, or throws.
 *
 * This is what gives a spawned child a code-mode instance of its own, and with it a **lifecycle**: the
 * child's runner is the one that emits `agent_end` and `session_shutdown`, so its kernel is dumped at
 * the end of each of its turns and closed when the child is disposed. Without the instance, nothing
 * running on the child can reach the kernel its spawner mounted, so it is dumped at neither moment
 * and only reaped at a later `session_start` in the parent's process.
 *
 * The factory is code mode's own function object, handed over at runtime: rlm still does not import
 * code mode (ADR 0001), it asks the entry it already binds. Best effort, like every other path in
 * this module — a seam that throws must cost the child its lifecycle, never its session.
 */
export function codeModeChildExtensions(): Array<(pi: unknown) => void> {
	const lookup = findCodeMode();
	if (lookup.status !== "found" || typeof lookup.entry.childExtension !== "function") return [];
	try {
		const factory = lookup.entry.childExtension();
		return typeof factory === "function" ? [factory] : [];
	} catch {
		return [];
	}
}

/**
 * Find code mode, mount this session's kernel, contribute, and hand back the handle.
 *
 * The mount is idempotent by session key, so it does not matter whether code mode's own
 * `session_start` handler ran first — and if rlm's runs first, rlm is the one that mounts.
 * `contributions` is a callback rather than a value because a contributor needs the handle
 * (the current cell, the scratch directory) to build what it contributes.
 */
export async function bindCodeMode(options: {
	pi: any;
	ctx: unknown;
	contributions: (handle: CodeModeHandle) => CodeModeContribution[];
	glob?: Record<symbol, unknown>;
}): Promise<BindResult> {
	const lookup = findCodeMode(options.glob ?? (globalThis as never));
	if (lookup.status === "absent") {
		return { status: "inert", reason: "code mode is not present on the registry (pi cannot say why: no extension enumeration, 02 §5)" };
	}
	if (lookup.status === "wrong-shape") return { status: "inert", reason: `code mode's registry entry is unusable: ${lookup.reason}` };
	const stale = versionProblem(lookup.entry);
	if (stale) return { status: "inert", reason: stale };

	let handle: CodeModeHandle;
	try {
		handle = lookup.entry.mount(options.pi, options.ctx);
	} catch (error) {
		return { status: "inert", reason: `code mode could not mount a kernel for this session: ${str((error as Error)?.message ?? error)}` };
	}
	if (!handle || typeof handle.contribute !== "function") {
		return { status: "inert", reason: "code mode mounted something that is not a kernel handle" };
	}

	const rejections: { owner: string; rejected: Rejection[] }[] = [];
	try {
		for (const contribution of options.contributions(handle)) {
			const receipt = handle.contribute(contribution);
			if (receipt?.rejected?.length) rejections.push({ owner: receipt.owner, rejected: receipt.rejected });
		}
	} catch (error) {
		return { status: "inert", reason: `contributing to the kernel failed: ${str((error as Error)?.message ?? error)}` };
	}

	let problems: string[] = [];
	try {
		problems = (await handle.problems()) ?? [];
	} catch {
		// A handle that cannot answer its own preflight must not take the session down; the
		// tool is still registered by code mode and will report the failure per cell.
		problems = [];
	}
	return { status: "bound", handle, problems, rejections };
}
