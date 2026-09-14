/**
 * The learn trigger: a quiet-period timer plus the admission chain.
 *
 * `agent_settled` starts or resets the timer; `agent_start`/`turn_start` cancel
 * it; `session_shutdown` cancels it and never learns (it also fires on `/new`,
 * `/resume` and `/fork`, while the user is mid-flow). When the timer fires the
 * chain is: query-only suppression, the model-free pre-scan, the single-flight
 * `.lock`, then the minimum interval — and the interval is checked inside the
 * lock, because the lock is the slot. A pass that errored without doing any
 * work rolls `last_pass_at` back so the next settle can retry.
 *
 * `/rsi learn` bypasses the pre-scan and the interval but still respects the
 * lock and query-only suppression.
 *
 * Everything time-related goes through an injectable {@link Clock}, so the whole
 * chain is testable with a fake clock and a fake pass.
 */

import type { RsiConfig } from "./config.ts";
import { readLedger, setLastPassAt } from "./ledger.ts";
import { claimPassLock } from "./pass-lock.ts";
import { scanMessages, type ScanMessage } from "./prescan.ts";

export type PassReason = "settled" | "learn";

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
 */
export function isQueryOnly(activeTools: readonly string[]): boolean {
	return !activeTools.includes("write") && !activeTools.includes("edit");
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
	/** The current session's messages, reduced for the pre-scan. */
	getScanMessages: () => ScanMessage[];
	/** The pass itself. Phase 3 supplies a stub; phase 4 supplies the fork. */
	runPass: (reason: PassReason) => Promise<PassOutcome>;
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
			void this.attempt("settled");
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

	/** True while a quiet timer is armed; for tests. */
	get pending(): boolean {
		return this.timer !== undefined;
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

		if (isQueryOnly(this.options.getActiveTools())) {
			return this.skip("query-only session");
		}

		if (reason === "settled" && !scanMessages(this.options.getScanMessages()).learnable) {
			return this.skip("no learnable signal"); // silent, and no tokens spent
		}

		const lock = claimPassLock(root, config.stageCeilingMinutes * 60_000);
		if (!lock) return this.skip("a pass is already running");

		try {
			const previous = readLedger(root).ledger.last_pass_at ?? null;
			if (reason === "settled" && !intervalElapsed(previous, config.minIntervalMinutes * 60_000, this.clock.now())) {
				return this.skip("within the minimum interval");
			}

			await setLastPassAt(root, new Date(this.clock.now()).toISOString());

			let outcome: PassOutcome;
			try {
				outcome = await this.options.runPass(reason);
			} catch (error) {
				outcome = { ok: false, toolActions: 0 };
				this.options.notify?.(`rsi: pass failed (${error instanceof Error ? error.message : String(error)})`, "error");
			}

			if (!outcome.ok && outcome.toolActions === 0) {
				await setLastPassAt(root, previous);
			}
			return { ran: true, outcome };
		} finally {
			lock.release();
		}
	}

	private skip(reason: string): AttemptResult {
		this.options.onSkip?.(reason);
		return { ran: false, skipped: reason };
	}
}
