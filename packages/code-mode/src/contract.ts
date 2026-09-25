/**
 * The seam between `pi-code-mode` and a package that contributes to a kernel it does not
 * own — the whole contract from The published contract (map ticket 01), recorded as
 * `docs/adr/0001-code-mode-registry-seam.md`.
 *
 * Nothing here imports pi or monty. `mount` is handed a kernel factory, and the ledger is
 * handed a base surface, so every rule in this file is testable with no kernel at all —
 * which is what makes `test/contract.test.ts` a test of the rules rather than of monty.
 *
 * Three rules are worth restating where they are enforced, because each one is a decision
 * and not a convenience:
 *
 *  - **Published at module load, first wins.** Discovery must not depend on which
 *    extension pi loaded first (02 measured that both modules exist before any handler
 *    runs), and a consumer must never capture `mount` — read it off the registry.
 *  - **Validation is all-or-nothing.** One rejected name means nothing from that call is
 *    applied. A half-contributed kernel is worse than a bare one: a prelude line whose
 *    host function was rejected is a `NameError` at call time.
 *  - **`mount` is idempotent by session key.** pi will happily host two kernels behind one
 *    session and never say a word (02 §2), so the rule has to live here, and the mount
 *    count is the observable that proves it.
 */
import { resolve } from "node:path";

/** The rendezvous. Read off `globalThis` at call time, never captured (ticket 01). */
export const REGISTRY_KEY = Symbol.for("pi-code-mode:registry");
export const PUBLISHER = "pi-code-mode";
/** An integer, bumped on any breaking change to this file's surface. pi has no version
 * query of its own, so this field is the only way a consumer can tell an old code mode
 * from an absent one (02 §5). */
export const API_VERSION = 1;

export type HostFn = (...args: unknown[]) => Promise<unknown>;

export type Notice = {
	key: string;
	content: string;
	customType?: string;
	/** A notice is dropped when this says the reader already knows — the read rule. */
	cancelled?: () => boolean;
};

/** Which journals a session replays, and which scratch to seed from. rlm owns the rule
 * (provenance, v1 ticket 13); code mode only asks (ticket 03, C4). */
export type Provenance = {
	journals: string[];
	seedScratchFrom?: string;
};

/** The one fact the provenance rule needs from code mode: this session's own file, and the
 * index of its first journaled cell. Reading journals is code mode's; the rule is rlm's. */
export type OwnSession = {
	sessionFile?: string;
	firstIndex?: number;
};

export type Contribution = {
	owner: string;
	hostFns?: Record<string, HostFn>;
	/** Appended after the base prelude, verbatim. */
	prelude?: string;
	/** Appended after the base description, verbatim — the contributor owns its separators. */
	description?: string;
	/** Appended after the base snippet, verbatim, for the same reason. */
	snippet?: string;
	/** Appended to the base guidelines, in owner order. */
	guidelines?: string[];
	/**
	 * How a kernel that has no rlm tells the model something.
	 *
	 * **One owner only.** A second declarer is refused, in the same shape and with the same severity
	 * a *malformed* slot already gets — see the slot check in `accept`. Silently ignoring the second
	 * declaration is the failure this rule exists to prevent; an owner may replace its own.
	 */
	onNotice?: (notice: Notice) => void;
	/** Which journals this session replays, and what to seed its scratch from. One owner only. */
	provenance?: (ctx: unknown, own: OwnSession) => Provenance;
};

export type Rejection = { name: string; reason: string };
export type Receipt = { owner: string; accepted: string[]; rejected: Rejection[] };

/** What a kernel must provide for the mounter to wrap it into a handle. */
export type KernelHandleCore = {
	currentCell: () => string;
	root: () => string;
	scratch: () => string;
	/** The running cell's progress sink, for a contributor that has something to say while it
	 * works (web-code's fetches do). Undefined between cells. */
	progress: () => ((text: string) => void) | undefined;
	/** The preflight's answer. Async because the checks are: a caller that needs them (rlm,
	 * to report them on its own surface) awaits, and the answer is memoised. */
	problems: () => Promise<string[]>;
	contribute: (contribution: Contribution) => Receipt;
};

export type KernelHandle = KernelHandleCore & {
	readonly publisher: string;
	readonly apiVersion: number;
	readonly sessionKey: string;
	/** 1 = the one kernel for this session; >1 = the idempotency rule doing its job. */
	readonly mounts: number;
	/**
	 * The object `create` returned — the kernel itself.
	 *
	 * It rides on the handle so that **any** code-mode instance in this process can reach a
	 * session's kernel, not only the one that created it. A child's kernel is mounted through the
	 * registry by whichever instance published it (the child loads no code-mode entry of its own),
	 * and a `/reload` or `/new` re-imports this entry, so the instance holding a kernel in a local
	 * map is not the instance that later handles that session's ctx.
	 */
	readonly kernel: KernelHandleCore;
	/**
	 * The ctx the kernel was mounted for, kept for one purpose: {@link sessionIsAlive} asks whether
	 * that session still exists. A session whose ctx has been invalidated is gone — its kernel has to
	 * be dumped and closed — while a session that is merely idle (a finished child, which `send` can
	 * still resume) must be left exactly as it is.
	 */
	readonly ctx: unknown;
};

export type RegistryEntry = {
	publisher: string;
	apiVersion: number;
	sessions: Map<string, KernelHandle>;
	mount: (pi: unknown, ctx: unknown) => KernelHandle;
	/**
	 * The factory a **spawned child** loads, when its loader can name one.
	 *
	 * A spawned child loads no ambient extensions, so without this its runner carries no code-mode
	 * instance at all: nothing running on the child can reach the kernel its spawner mounted, so no
	 * `agent_end` and no `session_shutdown` ever fires for it — the kernel is dumped neither at the
	 * end of a turn nor at its own disposal. The factory is the publisher's **own function object**,
	 * so the child's instance runs in this module instance and joins the sessions map this entry
	 * already published. Optional on purpose: an older code mode has none, and a child is then served
	 * exactly as it was before — mounted through the registry, dumped late.
	 */
	childExtension?: () => ((pi: unknown) => void) | undefined;
};

/** The names code mode's own kernel answers. No contribution may take one. */
export const BASE_HOST_FNS = [
	"bash_host",
	"find",
	"grep",
	"read_image",
	"bg_poll",
	"bg_read",
	"bg_kill",
	"bg_list",
];

/** The exact surface of a contribution: an unknown field is a typo, and a typo is loud. */
const CONTRIBUTION_FIELDS = [
	"owner",
	"hostFns",
	"prelude",
	"description",
	"snippet",
	"guidelines",
	"onNotice",
	"provenance",
];

/** The static half of what the model and the kernel see. The *prelude's* base is not here:
 * it is a function of `ROOT` and `SCRATCH`, so the kernel builds it and the ledger only
 * appends (`preludeTail`). */
export type BaseSurface = {
	description: string;
	snippet: string;
	guidelines: string[];
};

export type SessionKeys = { of: (ctx: unknown) => string };

export type EntryLookup =
	| { status: "absent" }
	| { status: "wrong-shape"; reason: string }
	| { status: "found"; entry: RegistryEntry };

export type Mounter = {
	mount: (pi: unknown, ctx: unknown) => KernelHandle;
	retire: (ctx: unknown) => boolean;
	/** Retire by key. `retire` cannot be used on a session that is already gone: `keys.of` reads
	 * the ctx, and reading a disposed ctx throws. */
	retireKey: (key: string) => boolean;
	sessions: Map<string, KernelHandle>;
};

/**
 * The session key, resolved from `ctx.sessionManager` and never from the `ctx` object:
 * `createContext()` hands out a fresh object per call (pi's `runner.js:503-560`), so ctx
 * identity is not stable — not across the double `session_start` an RPC replacement fires,
 * and not between two handlers in one bind. An unpersisted session keys on the session
 * manager's identity instead, so it stays shareable in-process without a second kernel.
 */
export function createSessionKeys(): SessionKeys {
	const unpersisted = new WeakMap<object, string>();
	let next = 0;
	return {
		of(ctx: unknown) {
			const anyCtx = ctx as { sessionManager?: { getSessionFile?: () => string | undefined } } | null;
			const file = anyCtx?.sessionManager?.getSessionFile?.();
			if (file) return resolve(file);
			const anchor: object = (anyCtx?.sessionManager as object) ?? (ctx as object) ?? {};
			let key = unpersisted.get(anchor);
			if (!key) {
				next += 1;
				key = `unpersisted#${next}`;
				unpersisted.set(anchor, key);
			}
			return key;
		},
	};
}

/**
 * Whether a ctx is still usable. pi invalidates a disposed session's runner, after which **every**
 * property of that ctx throws — `sessionManager` included — so touching one is the only probe there
 * is. It is what tells a kernel whose session is gone (reap it) from one that is merely idle (leave
 * it: a finished child is still resumable).
 */
export function sessionIsAlive(ctx: unknown): boolean {
	if (ctx === undefined || ctx === null) return false;
	try {
		void (ctx as { sessionManager?: unknown }).sessionManager;
		return true;
	} catch {
		return false;
	}
}

/** Publish, first wins. A second publisher joins the first entry rather than replacing it,
 * so a duplicate install cannot fork the session map. */
/**
 * The sessions map both the publisher and its consumers must use. Read it *before* building
 * the mounter: a second code-mode instance in one process (pi's `/reload` re-imports the
 * entry) must join the existing map rather than start a second one, or the reloaded entry
 * would mount kernels nobody can see.
 */
export function registrySessions(glob: Record<symbol, unknown> = globalThis as never): Map<string, KernelHandle> {
	const existing = glob?.[REGISTRY_KEY] as RegistryEntry | undefined;
	return existing?.sessions instanceof Map ? existing.sessions : new Map<string, KernelHandle>();
}

/**
 * Publish. A different publisher is refused outright — that is a duplicate install, and it
 * must not fork the map. The *same* publisher republishing is a reload: the fresh `mount`
 * takes over (it is the one whose handlers are live) while the sessions map, which the
 * caller obtained from `registrySessions`, is carried across untouched.
 */
export function publish(entry: RegistryEntry, glob: Record<symbol, unknown> = globalThis as never): {
	published: boolean;
	reason?: string;
} {
	const existing = glob?.[REGISTRY_KEY] as RegistryEntry | undefined;
	if (existing !== undefined && existing !== null) {
		if (existing.publisher !== entry.publisher) {
			return { published: false, reason: `already published by ${String(existing.publisher)}` };
		}
		if (existing.sessions instanceof Map && existing.sessions !== entry.sessions) {
			entry.sessions = existing.sessions;
		}
	}
	glob[REGISTRY_KEY] = entry;
	return { published: true };
}

export function findEntry(glob: Record<symbol, unknown> = globalThis as never): EntryLookup {
	const raw = glob?.[REGISTRY_KEY];
	if (raw === undefined || raw === null) return { status: "absent" };
	const problem = shapeProblem(raw);
	if (problem) return { status: "wrong-shape", reason: problem };
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

/** The consumer's version check: the entry must be at least as new as what this build
 * needs. A newer entry with an unchanged shape is fine — the shape check is the guard. */
export function versionProblem(entry: { apiVersion: number }, minimum = API_VERSION): string | null {
	if (typeof entry.apiVersion !== "number") return "the entry has no numeric apiVersion";
	if (entry.apiVersion >= minimum) return null;
	return `code mode's contract is version ${entry.apiVersion}, and this build needs ${minimum}`;
}

/**
 * The mounter: one kernel per session key, whoever asks first. `create` is called at most
 * once per key; every later call returns the same handle and counts itself.
 */
export function createMounter(options: {
	keys: SessionKeys;
	create: (pi: unknown, ctx: unknown, sessionKey: string) => KernelHandleCore;
	onExtraMount?: (sessionKey: string, mounts: number) => void;
	sessions?: Map<string, KernelHandle>;
}): Mounter {
	const sessions = options.sessions ?? new Map<string, KernelHandle>();
	const counts = new Map<string, number>();
	const wrap = (core: KernelHandleCore, key: string, ctx: unknown): KernelHandle => ({
		...core,
		// Both of these are the handle's reason to exist rather than bookkeeping: `kernel` is how an
		// instance reaches a session it did not mount, and `ctx` is how it tells a gone session from
		// an idle one (see the type).
		kernel: core,
		ctx,
		publisher: PUBLISHER,
		apiVersion: API_VERSION,
		sessionKey: key,
		get mounts() {
			return counts.get(key) ?? 1;
		},
	});
	const retireKey = (key: string): boolean => {
		counts.delete(key);
		return sessions.delete(key);
	};
	return {
		sessions,
		mount(pi: unknown, ctx: unknown) {
			const key = options.keys.of(ctx);
			const existing = sessions.get(key);
			if (existing) {
				const mounts = (counts.get(key) ?? 1) + 1;
				counts.set(key, mounts);
				options.onExtraMount?.(key, mounts);
				return existing;
			}
			counts.set(key, 1);
			const handle = wrap(options.create(pi, ctx, key), key, ctx);
			sessions.set(key, handle);
			return handle;
		},
		retire: (ctx: unknown) => retireKey(options.keys.of(ctx)),
		retireKey,
	};
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The contribution ledger: what has been contributed, and the composed surface it adds up
 * to. Owner order is the order of first acceptance, so the composed description and
 * guidelines are deterministic across runs — which is what makes the byte-identical check
 * in `acceptance.md` mean something.
 */
export function createLedger(spec: { reserved: string[]; base: BaseSurface; onChange?: () => void }) {
	const accepted = new Map<string, Contribution>();
	let closed: string | null = null;

	const fieldsOf = (contribution: Contribution): string[] => {
		const names = Object.keys(contribution.hostFns ?? {});
		for (const field of CONTRIBUTION_FIELDS) {
			if (field === "owner" || field === "hostFns") continue;
			if (contribution[field as keyof Contribution] !== undefined) names.push(field);
		}
		return names;
	};

	const refuse = (owner: string, rejected: Rejection[]): Receipt => ({ owner, accepted: [], rejected });

	return {
		/** The window closes at the first cell: the prelude is fed once, so a late
		 * contribution could only half-arrive. */
		close(reason = "kernel already started") {
			closed ??= reason;
		},
		isOpen() {
			return closed === null;
		},
		owners(): string[] {
			return [...accepted.keys()];
		},
		accept(contribution: Contribution): Receipt {
			const owner = typeof contribution?.owner === "string" ? contribution.owner.trim() : "";
			if (!owner) return refuse(String(contribution?.owner ?? ""), [{ name: "owner", reason: "a contribution needs a non-empty owner" }]);
			if (closed) return refuse(owner, [{ name: "<contribution>", reason: closed }]);

			const rejected: Rejection[] = [];
			for (const key of Object.keys(contribution)) {
				if (!CONTRIBUTION_FIELDS.includes(key)) rejected.push({ name: key, reason: "unknown contribution field" });
			}
			for (const field of ["prelude", "description", "snippet"]) {
				const value = contribution[field as "prelude" | "description" | "snippet"];
				if (value !== undefined && typeof value !== "string") rejected.push({ name: field, reason: "not a string" });
			}
			if (contribution.guidelines !== undefined) {
				if (!Array.isArray(contribution.guidelines)) rejected.push({ name: "guidelines", reason: "not an array" });
				else if (contribution.guidelines.some((line) => typeof line !== "string"))
					rejected.push({ name: "guidelines", reason: "an entry is not a string" });
			}
			for (const field of ["onNotice", "provenance"]) {
				const value = contribution[field as "onNotice" | "provenance"];
				if (value !== undefined && typeof value !== "function") rejected.push({ name: field, reason: "not a function" });
			}
			// Names other owners already hold: an owner may replace its own, never steal.
			const taken = new Map<string, string>();
			for (const [otherOwner, other] of accepted) {
				if (otherOwner === owner) continue;
				for (const name of Object.keys(other.hostFns ?? {})) taken.set(name, otherOwner);
			}
			for (const [name, fn] of Object.entries(contribution.hostFns ?? {})) {
				if (!NAME_RE.test(name)) rejected.push({ name, reason: "not a usable host-function name" });
				else if (spec.reserved.includes(name)) rejected.push({ name, reason: "code mode's own host function" });
				else if (taken.has(name)) rejected.push({ name, reason: `already contributed by ${taken.get(name)}` });
				else if (typeof fn !== "function") rejected.push({ name, reason: "not a function" });
			}
			// The observer slots are single-owner as well, and the check is deliberately the same
			// shape: a second declarer is **refused** rather than silently ignored, which is what a
			// slot dispatched first-owner-wins would otherwise do. An owner may still replace its own,
			// which is what keeps a second `session_start` free.
			for (const field of ["onNotice", "provenance"] as const) {
				if (contribution[field] === undefined) continue;
				for (const [otherOwner, other] of accepted) {
					if (otherOwner === owner) continue;
					if (other[field] !== undefined) {
						rejected.push({ name: field, reason: `already declared by ${otherOwner}` });
						break;
					}
				}
			}
			if (rejected.length > 0) return refuse(owner, rejected);
			// Replace wholesale, keeping the owner's position: a second `session_start` costs nothing.
			accepted.set(owner, contribution);
			// The tool's description is composed from this ledger, so an accepted contribution
			// means the registration has to be re-made (ticket 01 §4).
			try {
				spec.onChange?.();
			} catch {
				/* a registration that fails must not fail the contribution */
			}
			return { owner, accepted: fieldsOf(contribution), rejected: [] };
		},
		hostFns(): Record<string, HostFn> {
			const merged: Record<string, HostFn> = {};
			for (const contribution of accepted.values()) Object.assign(merged, contribution.hostFns ?? {});
			return merged;
		},
		/** Only the contributed half: the base prelude is built from `ROOT`/`SCRATCH` at kernel
		 * start, and the kernel prepends it. */
		preludeTail(): string {
			return [...accepted.values()].map((c) => c.prelude ?? "").join("");
		},
		description(): string {
			return spec.base.description + [...accepted.values()].map((c) => c.description ?? "").join("");
		},
		snippet(): string {
			return spec.base.snippet + [...accepted.values()].map((c) => c.snippet ?? "").join("");
		},
		guidelines(): string[] {
			const lines = [...spec.base.guidelines];
			for (const contribution of accepted.values()) lines.push(...(contribution.guidelines ?? []));
			return lines;
		},
		/** How a kernel with no rlm reaches the model. */
		notify(notice: Notice): boolean {
			for (const contribution of accepted.values()) {
				if (contribution.onNotice) {
					contribution.onNotice(notice);
					return true;
				}
			}
			return false;
		},
		provenance(ctx: unknown, own: OwnSession = {}): Provenance | undefined {
			for (const contribution of accepted.values()) {
				if (contribution.provenance) return contribution.provenance(ctx, own);
			}
			return undefined;
		},
	};
}

export type Ledger = ReturnType<typeof createLedger>;
