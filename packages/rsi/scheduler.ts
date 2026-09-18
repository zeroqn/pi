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
 */

import type { RsiConfig } from "./config.ts";
import { readLedger, setLastCurateAt, setLastPassAt } from "./ledger.ts";
import { claimPassLock } from "./pass-lock.ts";
import { scanMessages, type ScanMessage } from "./prescan.ts";

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
 * This is the **fallback**: a session whose surface pi cannot describe with tool names -
 * a code-mode session, whose only tool is `python` while its kernel can write - publishes
 * a capability fact instead (RSI x RLM ticket 03), and {@link suppressedAsQueryOnly}
 * consults that first. The heuristic stays for every session that publishes nothing, so
 * nothing about RSI's existing behaviour changes when RLM is absent.
 */
export function isQueryOnly(activeTools: readonly string[]): boolean {
	return !activeTools.includes("write") && !activeTools.includes("edit");
}

/**
 * Whether this session is suppressed as query-only. A published fact wins when there is
 * one; otherwise the tool-name heuristic decides. `canWrite` is the session's own report
 * about its surface, and only the session can know it.
 */
export function suppressedAsQueryOnly(input: {
	activeTools: readonly string[];
	/** The session's published fact, or `undefined` when it published none. */
	publishedCanWrite: boolean | undefined;
}): boolean {
	if (input.publishedCanWrite !== undefined) return !input.publishedCanWrite;
	return isQueryOnly(input.activeTools);
}

/** True when `minIntervalMs` has passed since the last recorded pass. */
export function intervalElapsed(lastPassAt: string | null | undefined, minIntervalMs: number, nowMs: number): boolean {
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
	 * What this session published about its own write capability, or `undefined` when it
	 * published nothing (RSI x RLM ticket 03). Consulted before the tool-name heuristic.
	 */
	publishedCanWrite?: () => boolean | undefined;
	/** The current session's messages, reduced for the pre-scan. */
	getScanMessages: () => ScanMessage[];
	/** The learner pass. */
	runPass: (reason: LearnerReason) => Promise<PassOutcome>;
	/** The curator pass; absent disables curation entirely. */
	curate?: () => Promise<PassOutcome>;
	/** The curator's interval-or-size check. */
	curationDue?: () => boolean;
	clock?: Clock;
	/** Why an attempt was declined; for tests and diagnostics, not the user. */
	onSkip?: (reason: string) => void;
	notify?: (message: string, type?: "info" | "warning" | "error") => void;
}

export class PassScheduler {
	private readonly options: PassSchedulerOptions;
	private readonly clock: Clock;
	private timer: unknown;

	constructor(options: PassSchedulerOptions) {
		this.options = options;
		this.clock = options.clock ?? systemClock;
	}

	/** The session went quiet: (re)arm the quiet timer. */
	settled(): void {
		if (!this.options.config.enabled) return;
		this.cancel();
		const quietMs = this.options.config.quietMinutes * 60_000;
		this.timer = this.clock.setTimeout(() => {
			this.timer = undefined;
			void this.onQuiet();
		}, quietMs);
	}

	/** A run started or a turn began: the session is no longer quiet. */
	activity(): void {
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
			this.options.notify?.(`rsi: pass failed (${error instanceof Error ? error.message : String(error)})`, "error");
			return { ran: true, outcome: { ok: false, toolActions: 0 } };
		}
	}

	private async run(reason: PassReason): Promise<AttemptResult> {
		const { config, root } = this.options;
		if (!config.enabled) return this.skip("disabled");

		if (suppressedAsQueryOnly({ activeTools: this.options.getActiveTools(), publishedCanWrite: this.options.publishedCanWrite?.() })) {
			return this.skip("query-only session");
		}

		if (reason === "curate") {
			if (!this.options.curate) return this.skip("no curator configured");
		} else if (reason === "settled" && !scanMessages(this.options.getScanMessages()).learnable) {
			return this.skip("no learnable signal"); // silent, and no tokens spent
		}

		const lock = claimPassLock(root, config.stageCeilingMinutes * 60_000);
		if (!lock) return this.skip("a pass is already running");

		try {
			if (reason === "curate") return await this.runCurate();
			return await this.runLearner(reason);
		} finally {
			lock.release();
		}
	}

	private async runLearner(reason: LearnerReason): Promise<AttemptResult> {
		const { config, root } = this.options;
		const previous = readLedger(root).ledger.last_pass_at ?? null;
		if (reason === "settled" && !intervalElapsed(previous, config.minIntervalMinutes * 60_000, this.clock.now())) {
			return this.skip("within the minimum interval");
		}

		await setLastPassAt(root, this.stamp());
		const outcome = await this.outcome(() => this.options.runPass(reason));
		if (!outcome.ok && outcome.toolActions === 0) await setLastPassAt(root, previous);
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
			this.options.notify?.(`rsi: pass failed (${error instanceof Error ? error.message : String(error)})`, "error");
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
