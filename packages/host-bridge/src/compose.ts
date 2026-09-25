/**
 * The composition: what this package does for one session — mount the kernel, ask every contributor,
 * write what they offer into the ledger, and remember what it did (map ticket 03,
 * `.scratch/host-bridge/`).
 *
 * Three moments, and each one is a decision rather than a convenience:
 *
 *  - **`session_start` — compose.** The contribution window closes at the kernel's first cell, and a
 *    cell cannot run before pi finishes awaiting this emission, so this is provably in time. It asks
 *    with the *session's own* `ctx`, because the tools a contributor builds resolve their session
 *    from it.
 *  - **`before_agent_start` — append the prompt text.** A contributor's text is not a kernel field
 *    (code mode's contract is not touched, standing preference 2); it is appended here, once per
 *    session, deduped by text, exactly as web-access's guard rule is today. A child loads no ambient
 *    extension, so this package is the only thing that can append it there.
 *  - **`session_shutdown` — forget the record.** `globalThis` outlives `/new`, resume and fork, so a
 *    session that ends must take its record with it. A *child* never reaches a shutdown hook, which is
 *    why the record is keyed by the session's file and prunable rather than merely tidy.
 *
 * **A session with no contributor registered is left entirely alone** — no mount, no record, no
 * prompt text. That is the honest reading of the composition root's job (there is nothing to compose),
 * and it is also what keeps the mount observable meaningful: `code-mode-mount` counts every ask, and an
 * inert package must not add one.
 */
import {
	type KernelContribution,
	type KernelHandle,
	childExtensionFactories,
	contributeAll,
	kernelProblems,
	mountKernel,
} from "./client";
import {
	type ChildBindInput,
	type ChildCeiling,
	type ChildRequest,
	type ContributorAnswer,
	type ContributorRegistration,
	type SessionInput,
	type SessionRecord,
	contributors,
	detectsChild,
	forgetSession,
	recordSession,
	sessionKey,
	sessionRecord,
} from "./convention";

/** The child shapes live with the registration they belong to; re-exported for the entry's callers. */
export type { ChildCeiling, ChildRequest } from "./convention";

/** The pi surface this package needs. Structural, so a test can pass a stub. */
export type BridgeSurface = {
	on(event: string, handler: (event: any, ctx: any) => unknown): void;
	appendEntry?(customType: string, data: unknown): unknown;
};

export type ComposeOutcome = {
	status: "idle" | "inert" | "composed";
	record?: SessionRecord;
	reason?: string;
};

function describe(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function sessionFileOf(ctx: unknown): string | undefined {
	try {
		const file = (ctx as { sessionManager?: { getSessionFile?: () => string | undefined } } | null)
			?.sessionManager?.getSessionFile?.();
		return typeof file === "string" && file.length > 0 ? file : undefined;
	} catch {
		return undefined;
	}
}

function cwdOf(ctx: unknown): string {
	try {
		const cwd = (ctx as { cwd?: unknown } | null)?.cwd;
		if (typeof cwd === "string" && cwd.length > 0) return cwd;
	} catch {
		/* a ctx that cannot be read falls back to the process */
	}
	return process.cwd();
}

/**
 * Compose one session. Never throws: a contributor that throws is one `problem` in the record, and a
 * kernel that cannot mount is a record saying so — the session keeps running either way.
 */
export async function composeSession(input: {
	pi: unknown;
	ctx: unknown;
	/** True for a child composed by this package's own factory; absent means "ask the detector". */
	isChild?: boolean;
}): Promise<ComposeOutcome> {
	const registered = contributors();
	if (registered.length === 0) {
		return { status: "idle", reason: "no contributor is registered" };
	}
	const key = sessionKey(input.ctx);
	const mounted = mountKernel({ pi: input.pi, ctx: input.ctx });
	if (mounted.status === "inert") {
		const record: SessionRecord = {
			mounted: false,
			owners: [],
			installed: [],
			reaches: [],
			promptTexts: [],
			problems: [mounted.reason],
		};
		recordSession(key, record);
		return { status: "inert", record, reason: mounted.reason };
	}
	const handle: KernelHandle = mounted.handle;
	const session: SessionInput = {
		ctx: input.ctx,
		// The kernel's own key, which is what a contributor comparing sessions should use; this package
		// files its records under `sessionKey(ctx)` and ticket 02's test is what keeps the two one string.
		sessionKey: handle.sessionKey,
		handle,
		isChild: input.isChild ?? detectsChild(input.ctx),
		cwd: cwdOf(input.ctx),
		sessionFile: sessionFileOf(input.ctx),
		// A forwarder, not the sink: `progress()` answers only while a cell is running.
		progress: (text: string) => {
			try {
				handle.progress()?.(text);
			} catch {
				/* a progress sink must never fail a session */
			}
		},
	};

	const problems: string[] = [];
	const answers: ContributorAnswer[] = [];
	const promptTexts: string[] = [];
	for (const registration of registered) {
		if (!registration.session) continue;
		let answer: ContributorAnswer | null = null;
		try {
			answer = registration.session(session);
		} catch (error) {
			problems.push(`${registration.owner}: session() threw — ${describe(error)}`);
			continue;
		}
		if (!answer) continue;
		answers.push(answer);
		for (const problem of answer.problems ?? []) {
			if (typeof problem === "string" && problem.length > 0) problems.push(problem);
		}
		const text = answer.systemPrompt;
		if (typeof text === "string" && text.trim().length > 0) promptTexts.push(text);
	}

	const report = contributeAll(
		handle,
		answers.map((answer) => answer.contribution).filter((c): c is KernelContribution => Boolean(c)),
	);
	problems.push(...report.problems);
	problems.push(...(await kernelProblems(handle)));

	// A cell can reach a name **only** through a contribution that landed: a refused contribution is
	// refused whole, so asking the ledger first is what keeps a name out of the record (and therefore
	// out of the active-set strip) when its route never appeared.
	const landed = new Set(report.landed);
	const reaches = answers
		.filter((answer) => answer.contribution !== undefined && landed.has(answer.contribution))
		.flatMap((answer) => answer.reaches ?? []);

	const record: SessionRecord = {
		mounted: true,
		owners: report.owners,
		installed: report.installed,
		reaches,
		promptTexts,
		problems,
	};
	recordSession(key, record);
	return { status: "composed", record };
}

/**
 * `prompt` with every text appended once.
 *
 * Deduped by text rather than by contributor, because two appenders are real: a contributor's own
 * extension entry appends the same words in a root session (web-access does), and this package appends
 * them in a child, where no ambient entry ran. Whichever goes first wins and the other recognises it.
 */
export function appendPromptTexts(prompt: string, texts: readonly string[]): string {
	let result = prompt;
	for (const text of texts) {
		if (typeof text !== "string" || text.trim().length === 0) continue;
		if (result.includes(text)) continue;
		result = `${result}\n\n${text}`;
	}
	return result;
}

/** Where a session's prompt texts are read from on the turn that needs them. */
function promptTextsFor(ctx: unknown): string[] {
	try {
		return sessionRecord(sessionKey(ctx))?.promptTexts ?? [];
	} catch {
		return [];
	}
}

/**
 * The three handlers, on whichever surface is running this package — the root manifest's entry, or the
 * factory a spawned child's loader was handed.
 *
 * `child` is `true` only on the factory path. A **resumed** child loads the ambient manifest instead,
 * so the entry runs for it — and the detector is what tells that path it is a child (ticket 03 §5 of
 * `.scratch/child-surface`).
 */
export function installHandlers(pi: BridgeSurface, options: { child?: boolean } = {}): void {
	pi.on("session_start", async (_event: unknown, ctx: unknown) => {
		const outcome = await composeSession({
			pi,
			ctx,
			...(options.child ? { isChild: true } : {}),
		});
		recordOutcome(pi, outcome);
		return undefined;
	});

	pi.on("before_agent_start", async (event: any, ctx: unknown) => {
		const prompt = typeof event?.systemPrompt === "string" ? event.systemPrompt : "";
		const appended = appendPromptTexts(prompt, promptTextsFor(ctx));
		if (appended === prompt) return undefined;
		return { systemPrompt: appended };
	});

	pi.on("session_shutdown", (_event: unknown, ctx: unknown) => {
		try {
			forgetSession(sessionKey(ctx));
		} catch {
			/* a session that cannot be keyed has no record to forget */
		}
		return undefined;
	});
}

/**
 * One session entry, and only when something actually happened.
 *
 * An `idle` outcome records nothing: a process with no contributor in it must leave a session's
 * transcript exactly as it found it.
 */
function recordOutcome(pi: BridgeSurface, outcome: ComposeOutcome): void {
	if (outcome.status === "idle") return;
	const record = outcome.record;
	try {
		pi.appendEntry?.("host-bridge", {
			status: outcome.status,
			mounted: record?.mounted ?? false,
			owners: record?.owners ?? [],
			installed: record?.installed ?? [],
			reaches: record?.reaches ?? [],
			promptTexts: record?.promptTexts.length ?? 0,
			problems: record?.problems ?? [],
			...(outcome.reason ? { reason: outcome.reason } : {}),
		});
	} catch {
		/* diagnostics must never fail a session */
	}
}

/**
 * The kernel's own tool, named once.
 *
 * A child without it has no way to work at all, and no contributor can declare it: `python` is not an
 * owner's tool. It is here rather than in a contributor because the ceiling is now this package's
 * mechanism — which names a *child may hold at all* — and the kernel's own tool is a fact about the
 * kernel (ticket 04).
 */
const KERNEL_TOOL = "python";

/**
 * What a child may hold at all: the kernel's tool plus every contributor's `childEligible`, narrowed
 * to the spawning session's own live surface when there is one.
 *
 * `parentSurface` is read at spawn time and never from a record (`../child-surface` ticket 01), so a
 * grandchild's ceiling is the child's surface by construction. With no spawner to read — a session
 * opened on its own, a resumed child, a caller that does not know about ceilings — the declared list
 * stands and `source` says so, which is what lets a reader tell a *narrowed* child from a *broken* one.
 */
export function childCeiling(parentSurface?: readonly string[]): ChildCeiling {
	const eligible = [KERNEL_TOOL];
	for (const registration of contributors()) {
		if (!registration.childEligible) continue;
		try {
			eligible.push(...registration.childEligible());
		} catch {
			// A contributor whose policy throws narrows the ceiling by its own names and nothing else.
		}
	}
	const declared = [...new Set(eligible)];
	if (parentSurface === undefined) return { ceiling: declared, source: "fallback" };
	return {
		ceiling: parentSurface.filter((name) => declared.includes(name)),
		source: "spawner",
		dropped: parentSurface.filter((name) => !declared.includes(name)),
	};
}

/** The single contributor that gets the last word on a child's active set, in key order (ticket 04). */
function surfaceClaimant(): ContributorRegistration | undefined {
	return contributors().find((registration) => registration.childSurface !== undefined);
}

/**
 * The extension factories a spawned child's loader is given.
 *
 * **This package's own factory is first**, so a child's session is composed before a contributor's own
 * factory runs on it; then each contributor's, in contributor order; then **code mode's own**, last —
 * the order `.scratch/code-mode` ADR 0001 describes (the child's code-mode instance is a *joiner*: it
 * mounts through the registry, so it must come after the factory that already mounted, and it is what
 * gives the child its lifecycle — `agent_end` and `session_shutdown`).
 *
 * A contributor whose `childFactories` throws contributes none of them rather than costing every other
 * contributor its own — the rule `pi-tool-bridge`'s `bindChild` already follows.
 */
export function childFactories(request: ChildRequest = {}): Array<(pi: unknown) => void> {
	// The ceiling is computed here when the caller did not compute one: a spawner that filters pi's own
	// registry at spawn time already has the value and passes it in, and everyone else gets the
	// declared fallback.
	const full: ChildRequest = { ...request, ceiling: request.ceiling ?? childCeiling() };
	const factories: Array<(pi: unknown) => void> = [
		(pi: unknown) => installHandlers(pi as BridgeSurface, { child: true }),
	];
	for (const registration of contributors()) {
		if (!registration.childFactories) continue;
		try {
			factories.push(...registration.childFactories(full));
		} catch {
			/* one contributor's factories must not cost another's */
		}
	}
	// The surface rule's turn, after every contributor that registers a tool, and before code mode —
	// whose child instance is what keeps a child's kernel alive at all.
	const claimant = surfaceClaimant();
	if (claimant?.childSurface) {
		try {
			const factory = claimant.childSurface(full);
			if (typeof factory === "function") factories.push(factory);
		} catch {
			/* a surface rule that cannot be built costs the child its correction, not its session */
		}
	}
	factories.push(...childExtensionFactories());
	return factories;
}

/**
 * Told every contributor which session it is serving, in contributor order.
 *
 * **Contained, deliberately**: one contributor that throws must not stop another's bind (the rule
 * `pi-tool-bridge`'s seam already followed), and it must not fail the session that is binding. The
 * throw is invisible here on purpose — {@link childStatus} reports a contributor's availability, not
 * the outcome of one bind, and a bind that failed shows up as the child's own narrow behaviour.
 */
export function bindChild(input: ChildBindInput): void {
	for (const registration of contributors()) {
		if (!registration.bindChild) continue;
		try {
			registration.bindChild(input);
		} catch {
			/* one contributor cannot stop another's bind */
		}
	}
}

/**
 * One line per contributor that reports on children, joined with `; `.
 *
 * A throwing contributor contributes a line saying so rather than costing every other contributor its
 * status: this runs inside a session-start handler whose whole purpose is to record what was available.
 */
export function childStatus(): string {
	const lines: string[] = [];
	for (const registration of contributors()) {
		if (!registration.childStatus) continue;
		try {
			const line = registration.childStatus();
			if (line) lines.push(line);
		} catch (error) {
			lines.push(`${registration.owner}: status threw — ${describe(error)}`);
		}
	}
	return lines.join("; ");
}
