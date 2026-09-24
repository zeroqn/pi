/**
 * The learn trigger: a quiet-period timer plus the admission chain, and the
 * curator's own cadence on the same timer.
 *
 * `agent_settled` starts or resets the timer; `agent_start`/`turn_start` cancel
 * it; `session_shutdown` cancels it and never learns (it also fires on `/new`,
 * `/resume` and `/fork`, while the user is mid-flow). When the timer fires the
 * learner chain is: query-only suppression, the model-free pre-scan, the
 * single-flight `.lock`, then the minimum interval — and the interval is checked
 * inside the lock, because the lock is the slot. A pass that errored without
 * doing any work rolls `last_pass_at` back so the next settle can retry.
 *
 * Curation shares the lock and the suppression but has its own cadence check
 * (`curationDue`): it is interval-or-size gated, so it runs rarely.
 *
 * `/rsi learn` bypasses the pre-scan and the interval but still respects the
 * lock and query-only suppression; `/rsi curate` forces the curator.
 *
 * Everything time-related goes through an injectable {@link Clock}, so the whole
 * chain is testable with a fake clock and fake passes.
 *
 * Two invariants this file owes the process rather than the store:
 *
 *   - **A timer never outlives its session.** pi invalidates a disposed session's ctx, and a timer
 *     armed a minute earlier keeps firing afterwards, so every entry point asks
 *     {@link PassSchedulerOptions.sessionAlive} first and a session that is gone is skipped without
 *     touching the ctx it no longer has.
 *   - **A failure report cannot fail.** `notify` runs inside the catches below; a throw from there
 *     escapes the catch, then the timer callback, and a rejection nobody awaits ends a headless run
 *     (measured 2026-09-24 — the pass-failure path read `ctx.ui` on a disposed session's ctx).
 */

import type { RsiConfig } from "./config.ts";
import { readLedger, sessionPassAt, setLastCurateAt, setLastPassAt, setSessionPassAt } from "./ledger.ts";
import { claimPassLock } from "./pass-lock.ts";
import { scanMessages, type KernelSignal, type ScanMessage } from "./prescan.ts";

/** What a learner pass was triggered by. */
export type LearnerReason = "settled" | "learn";
export type PassReason = LearnerReason | "curate";

export interface PassOutcome {
	ok: boolean;
	/** How many tool actions the pass took; a failed pass with none is rolled back. */
	toolActions: number;
}

/** What an attempt did: either it ran, or it declined for a named reason. */
export type AttemptResult = { ran: true; outcome: PassOutcome } | { ran: false; skipped: string };

export interface Clock {
	now(): number;
	setTimeout(handler: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
	now: () => Date.now(),
	setTimeout: (handler, ms) => setTimeout(handler, ms),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * A query-only session has neither writer tool, so there is nothing to learn
 * from and the learner suppresses itself. This also covers `readonly-mode`.
 *
 * This is the **fallback**: a session whose surface pi cannot describe with tool names - a
 * code-mode session, whose only tool is `python` while its kernel can write - reports its
 * kernel instead, and {@link suppressedAsQueryOnly} consults that first. The heuristic
 * stays for every session with no kernel, so nothing about RSI's existing behaviour changes
 * where there is no code mode.
 */
export function isQueryOnly(activeTools: readonly string[]): boolean {
	return !activeTools.includes("write") && !activeTools.includes("edit");
}

/**
 * Whether this session is suppressed as query-only. A reported kernel wins when there is
 * one; otherwise the tool-name heuristic decides. Only the session can know whether it has
 * a kernel, and the kernel is the answer rather than RSI's standing in it: a mount that
 * succeeded while RSI's contribution was refused still leaves a kernel that can write, and
 * a journal worth learning from.
 */
export function suppressedAsQueryOnly(input: {
	activeTools: readonly string[];
	/** The session's own report, or `undefined` when it has no kernel. */
	kernelCanWrite: boolean | undefined;
}): boolean {
	if (input.kernelCanWrite !== undefined) return !input.kernelCanWrite;
	return isQueryOnly(input.activeTools);
}

/**
 * True when `minIntervalMs` has passed since the last recorded pass. A missing, unparseable or
 * non-finite interval means **no constraint** — an absent knob must never wedge every pass shut,
 * which a NaN comparison would do silently.
 */
export function intervalElapsed(lastPassAt: string | null | undefined, minIntervalMs: number, nowMs: number): boolean {
	if (!Number.isFinite(minIntervalMs)) return true;
	if (!lastPassAt) return true;
	const parsed = Date.parse(lastPassAt);
	if (Number.isNaN(parsed)) return true;
	return nowMs - parsed >= minIntervalMs;
}

export interface PassSchedulerOptions {
	root: string;
	config: RsiConfig;
	/** The live active-tool set, for query-only detection. */
	getActiveTools: () => string[];
	/**
	 * Whether this session has a kernel that can write, or `undefined` when it has none.
	 * Consulted before the tool-name heuristic. Supplied locally from the handle RSI holds,
	 * so nothing crosses a process boundary and no load order can affect it.
	 */
	kernelCanWrite?: () => boolean | undefined;
	/** The current session's messages, reduced for the pre-scan. */
	getScanMessages: () => ScanMessage[];
	/**
	 * Kernel-side evidence for a code-mode session, or `undefined` for a session with no
	 * kernel (RSI x RLM ticket 04). Absent means the pre-scan behaves exactly as before.
	 */
	getKernelSignal?: () => KernelSignal | undefined;
	/**
	 * Whether the session's last turn was aborted (RSI x RLM ticket 13). A child killed mid-task
	 * still settles, which would otherwise run a pass over a deliberately truncated session.
	 * Absent means never aborted, which is every session that does not report otherwise.
	 */
	lastTurnWasAborted?: () => boolean;
	/** The learner pass. */
	runPass: (reason: LearnerReason) => Promise<PassOutcome>;
	/** The curator pass; absent disables curation entirely. */
	curate?: () => Promise<PassOutcome>;
	/** The curator's interval-or-size check. */
	curationDue?: () => boolean;
	/**
	 * This session's identity for the per-session interval (RSI x RLM ticket 12). Absent means
	 * the interval cannot be attributed to a session, and the tree-wide floor alone applies.
	 */
	getSessionFile?: () => string | undefined;
	/**
	 * Called when a pass was skipped because another pass held the lock. A session that has
	 * already produced its final answer may never settle again — a child that has answered is
	 * the case that matters — so a lost race must not mean that session never learns.
	 */
	onLockContention?: () => void;
	/**
	 * How long a quiet period is for this session. Defaults to `quietMinutes`; a child passes
	 * its shorter `childQuietMinutes`, because a child lives for one delegated task (ticket 13).
	 */
	quietMinutes?: () => number;
	/**
	 * Whether this session still exists. Required, because a scheduler whose timer can fire into a
	 * disposed session is the bug this gate exists to prevent: pi invalidates the ctx, and nothing
	 * else cancels the timer (a spawner-disposed child never receives `session_shutdown` unless its
	 * spawner emits it).
	 */
	sessionAlive: () => boolean;
	clock?: Clock;
	/** Why an attempt was declined; for tests and diagnostics, not the user. */
	onSkip?: (reason: string) => void;
	notify?: (message: string, type?: "info" | "warning" | "error") => void;
}

export class PassScheduler {
	private readonly options: PassSchedulerOptions;
	private readonly clock: Clock;
	private timer: unknown;
	/**
	 * How many times this session has re-armed after losing the pass lock, and the bound on it
	 * (ticket 12). A permanently contended store must degrade to the old skip behaviour rather
	 * than retry forever; a session that has genuinely finished retries only a few times.
	 */
	private lockRetries = 0;
	private static readonly MAX_LOCK_RETRIES = 3;

	constructor(options: PassSchedulerOptions) {
		this.options = options;
		this.clock = options.clock ?? systemClock;
	}

	/** The session went quiet: (re)arm the quiet timer. */
	settled(): void {
		if (!this.options.config.enabled) return;
		// A session that is already gone must not arm a timer at all: nothing would ever cancel it,
		// and the pass it triggers could only report that it has no session to work from.
		if (!this.options.sessionAlive()) return;
		// Deliberately does *not* reset the retry budget: the re-arm path calls `settled()`
		// again, so resetting here would let a contended store loop forever. A real turn
		// (`activity`) or a pass that actually runs is what earns a fresh budget.
		this.cancel();
		const quietMs = (this.options.quietMinutes?.() ?? this.options.config.quietMinutes) * 60_000;
		this.timer = this.clock.setTimeout(() => {
			this.timer = undefined;
			// `onQuiet` contains its own failures; this is the last line of defence, because a
			// rejection here has no awaiter and takes the process with it.
			void this.onQuiet().catch((error) => this.report(error));
		}, quietMs);
	}

	/** A run started or a turn began: the session is no longer quiet, and this is a fresh chance. */
	activity(): void {
		this.lockRetries = 0;
		this.cancel();
	}

	/** The session is going away. Cancels only; it must never learn. */
	shutdown(): void {
		this.cancel();
	}

	/** `/rsi learn`: bypass the pre-scan and the interval, respect the lock. */
	async learnNow(): Promise<AttemptResult> {
		return this.attempt("learn");
	}

	/** `/rsi curate`: force curation, bypassing its cadence. */
	async curateNow(): Promise<AttemptResult> {
		return this.attempt("curate");
	}
	/** True while a quiet timer is armed; for tests. */
	get pending(): boolean {
		return this.timer !== undefined;
	}

	private async onQuiet(): Promise<void> {
		await this.attempt("settled");
		const due = this.options.curate !== undefined && (this.options.curationDue?.() ?? true);
		if (due) await this.attempt("curate");
	}

	private cancel(): void {
		if (this.timer === undefined) return;
		this.clock.clearTimeout(this.timer);
		this.timer = undefined;
	}

	private async attempt(reason: PassReason): Promise<AttemptResult> {
		try {
			return await this.run(reason);
		} catch (error) {
			this.report(error);
			return { ran: true, outcome: { ok: false, toolActions: 0 } };
		}
	}

	/**
	 * Report a failed pass, and never throw. This runs inside a catch, so a throw from the reporter
	 * escapes the catch, then the timer callback, and the unhandled rejection ends the process —
	 * which is exactly how a disposed session's pass took a headless run down. A diagnostic that
	 * cannot speak is still better than a dead session.
	 */
	private report(error: unknown): void {
		try {
			this.options.notify?.(`rsi: pass failed (${error instanceof Error ? error.message : String(error)})`, "error");
		} catch {
			/* nothing left to report with */
		}
	}

	private async run(reason: PassReason): Promise<AttemptResult> {
		const { config, root } = this.options;
		if (!config.enabled) return this.skip("disabled");
		// First, before any ctx or `pi` read below: a session that is gone is not a session with
		// nothing to learn, and every accessor behind this line belongs to it.
		if (!this.options.sessionAlive()) return this.skip("the session is gone");

		if (suppressedAsQueryOnly({ activeTools: this.options.getActiveTools(), kernelCanWrite: this.options.kernelCanWrite?.() })) {
			return this.skip("query-only session");
		}

		if (reason === "curate") {
			if (!this.options.curate) return this.skip("no curator configured");
		} else if (reason === "settled") {
			// A session whose last turn was aborted is a deliberately truncated one: the digest
			// would be model-free truth about work that was cut off. Low value for a full fork.
			if (this.options.lastTurnWasAborted?.() === true) return this.skip("the last turn was aborted");
			if (!scanMessages(this.options.getScanMessages(), this.options.getKernelSignal?.()).learnable) {
				return this.skip("no learnable signal"); // silent, and no tokens spent
			}
		}

		const lock = claimPassLock(root, config.stageCeilingMinutes * 60_000);
		if (!lock) {
			// Someone else holds the slot. Re-arm so this session gets another chance — an
			// answered child may never settle again — but only a bounded number of times, so a
			// permanently contended store degrades to the old skip rather than a retry loop.
			if (this.lockRetries < PassScheduler.MAX_LOCK_RETRIES) {
				this.lockRetries++;
				this.options.onLockContention?.();
			}
			return this.skip("a pass is already running");
		}
		this.lockRetries = 0;

		try {
			if (reason === "curate") return await this.runCurate();
			return await this.runLearner(reason);
		} finally {
			lock.release();
		}
	}

	private async runLearner(reason: LearnerReason): Promise<AttemptResult> {
		const { config, root } = this.options;
		const sessionFile = this.options.getSessionFile?.();
		const { ledger } = readLedger(root);

		// Two clocks, doing two jobs (ticket 12):
		//   - this session's own interval, so a child's pass does not consume the root's;
		//   - the tree-wide floor, so a tree of N learners cannot spend N forks at once.
		//
		// With no session identity there is no per-session clock to apply, so the global stamp
		// *is* the interval — exactly the single-learner behaviour this replaces.
		const previousFloor = ledger.last_pass_at ?? null;
		const previousSession = sessionFile ? sessionPassAt(ledger, sessionFile) : previousFloor;
		if (reason === "settled") {
			if (!intervalElapsed(previousSession, config.minIntervalMinutes * 60_000, this.clock.now())) {
				return this.skip("within the minimum interval");
			}
			// The floor only adds a constraint when it is a *different* clock from the above.
			if (sessionFile && !intervalElapsed(previousFloor, config.treeFloorMinutes * 60_000, this.clock.now())) {
				return this.skip("within the tree-wide floor");
			}
		}

		const stamp = this.stamp();
		await setLastPassAt(root, stamp);
		if (sessionFile) await setSessionPassAt(root, sessionFile, stamp);

		const outcome = await this.outcome(() => this.options.runPass(reason));

		// Rollback follows the *session's* stamp: one session's transient failure must not
		// license every other learner in the tree to retry at once. The floor stays advanced,
		// because a pass did run — unless there is no session stamp, in which case the floor is
		// the only clock there is.
		if (!outcome.ok && outcome.toolActions === 0) {
			if (sessionFile) await setSessionPassAt(root, sessionFile, previousSession);
			else await setLastPassAt(root, previousFloor);
		}
		return { ran: true, outcome };
	}

	private async runCurate(): Promise<AttemptResult> {
		const { root } = this.options;
		const previous = readLedger(root).ledger.last_curate_at ?? null;
		await setLastCurateAt(root, this.stamp());
		const outcome = await this.outcome(() => this.options.curate?.() ?? Promise.resolve({ ok: true, toolActions: 0 }));
		if (!outcome.ok && outcome.toolActions === 0) await setLastCurateAt(root, previous);
		return { ran: true, outcome };
	}

	private async outcome(run: () => Promise<PassOutcome>): Promise<PassOutcome> {
		try {
			return await run();
		} catch (error) {
			this.report(error);
			return { ok: false, toolActions: 0 };
		}
	}

	private stamp(): string {
		return new Date(this.clock.now()).toISOString();
	}

	private skip(reason: string): AttemptResult {
		this.options.onSkip?.(reason);
		return { ran: false, skipped: reason };
	}
}
