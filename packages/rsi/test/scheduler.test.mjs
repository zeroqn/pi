import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { readLedger, sessionPassAt, setLastCurateAt, setLastPassAt, setSessionPassAt } from "../ledger.ts";
import { passLockPath } from "../pass-lock.ts";
import { intervalElapsed, isQueryOnly, PassScheduler, suppressedAsQueryOnly } from "../scheduler.ts";

const EPOCH = Date.parse("2026-09-14T12:00:00.000Z");
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));

/** A hand-cranked clock, so no test ever waits on a real timer. */
class FakeClock {
	constructor() {
		this.time = EPOCH;
		this.timers = new Map();
		this.seq = 0;
	}
	now() {
		return this.time;
	}
	setTimeout(handler, ms) {
		const id = ++this.seq;
		this.timers.set(id, { handler, at: this.time + ms });
		return id;
	}
	clearTimeout(id) {
		this.timers.delete(id);
	}
	advance(ms) {
		this.time += ms;
		for (const [id, timer] of [...this.timers]) {
			if (timer.at <= this.time) {
				this.timers.delete(id);
				timer.handler();
			}
		}
	}
	get pending() {
		return this.timers.size;
	}
}

function makeConfig(overrides = {}) {
	return {
		enabled: true,
		observeOnly: true,
		quietMinutes: 5,
		minIntervalMinutes: 15,
		treeFloorMinutes: 2,
		stageCeilingMinutes: 10,
		disuseWeeks: 6,
		consolidateEveryWeeks: 4,
		maxActiveSkills: 25,
		disabledProjects: [],
		storePath: "/unused",
		...overrides,
	};
}

function makeScheduler(t, options = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-sched-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const clock = new FakeClock();
	const skips = [];
	const calls = [];
	const runPass = options.runPass ?? (async (reason) => {
		calls.push(reason);
		return { ok: true, toolActions: 1 };
	});
	const scheduler = new PassScheduler({
		root,
		config: makeConfig(options.config),
		getActiveTools: options.getActiveTools ?? (() => ["read", "write", "edit"]),
		kernelCanWrite: options.kernelCanWrite,
		getScanMessages: options.getScanMessages ?? (() => [{ role: "user", text: "remember this" }]),
		getKernelSignal: options.getKernelSignal,
		getSessionFile: options.getSessionFile,
		onLockContention: options.onLockContention,
		quietMinutes: options.quietMinutes,
		lastTurnWasAborted: options.lastTurnWasAborted,
		runPass,
		curate: options.curate,
		curationDue: options.curationDue,
		clock,
		onSkip: (reason) => skips.push(reason),
		notify: options.notify,
	});
	return { root, clock, scheduler, skips, calls };
}

const lastPassAt = (root) => readLedger(root).ledger.last_pass_at;

/** A scheduler bound to an existing store root and clock, for cross-session cases. */
function makeSchedulerAt(t, root, clock, options = {}) {
	const skips = [];
	const calls = [];
	const scheduler = new PassScheduler({
		root,
		config: makeConfig(options.config),
		getActiveTools: options.getActiveTools ?? (() => ["read", "write", "edit"]),
		kernelCanWrite: options.kernelCanWrite,
		getScanMessages: options.getScanMessages ?? (() => [{ role: "user", text: "remember this" }]),
		getKernelSignal: options.getKernelSignal,
		getSessionFile: options.getSessionFile,
		onLockContention: options.onLockContention,
		quietMinutes: options.quietMinutes,
		lastTurnWasAborted: options.lastTurnWasAborted,
		runPass: options.runPass ?? (async (reason) => {
			calls.push(reason);
			return { ok: true, toolActions: 1 };
		}),
		curate: options.curate,
		curationDue: options.curationDue,
		clock,
		onSkip: (reason) => skips.push(reason),
		notify: options.notify,
	});
	return { root, clock, scheduler, skips, calls };
}
const sessionAt = (root, file) => sessionPassAt(readLedger(root).ledger, file);

// ---------------------------------------------------------------------------
// Pure predicates.
// ---------------------------------------------------------------------------

test("a reported kernel wins over the tool-name heuristic", () => {
	// The code-mode case: the tool set looks query-only, but the session has a kernel.
	assert.equal(suppressedAsQueryOnly({ activeTools: ["python"], kernelCanWrite: true }), false);
	// And the reverse: a session that reports a kernel which cannot write is suppressed even
	// if a writer tool happens to be active.
	assert.equal(suppressedAsQueryOnly({ activeTools: ["read", "write"], kernelCanWrite: false }), true);
});

test("with no kernel reported, the tool-name heuristic decides", () => {
	assert.equal(suppressedAsQueryOnly({ activeTools: ["python"], kernelCanWrite: undefined }), true);
	assert.equal(suppressedAsQueryOnly({ activeTools: ["read", "write"], kernelCanWrite: undefined }), false);
});

test("isQueryOnly is true when neither writer tool is active", () => {
	assert.equal(isQueryOnly(["read", "bash", "ffgrep"]), true);
	assert.equal(isQueryOnly(["read", "write"]), false);
	assert.equal(isQueryOnly(["read", "edit", "write"]), false);
});

test("intervalElapsed handles null, bad and real timestamps", () => {
	assert.equal(intervalElapsed(null, 900_000, EPOCH), true);
	assert.equal(intervalElapsed("not a date", 900_000, EPOCH), true);
	assert.equal(intervalElapsed(new Date(EPOCH).toISOString(), 900_000, EPOCH), false);
	assert.equal(intervalElapsed(new Date(EPOCH - 1_000_000).toISOString(), 900_000, EPOCH), true);
});

// ---------------------------------------------------------------------------
// Quiet timer — armed on settle, cancelled by activity and by shutdown.
// ---------------------------------------------------------------------------

test("settled arms the quiet timer and activity or shutdown cancels it", (t) => {
	const { clock, scheduler } = makeScheduler(t);
	assert.equal(scheduler.pending, false);

	scheduler.settled();
	assert.equal(scheduler.pending, true);
	assert.equal(clock.pending, 1);

	scheduler.activity();
	assert.equal(scheduler.pending, false);

	scheduler.settled();
	scheduler.settled(); // reset, not a second timer
	assert.equal(clock.pending, 1);

	scheduler.shutdown();
	assert.equal(scheduler.pending, false);
});

test("the timer fires a pass after the quiet period and the lock is released", (t) => {
	const { root, clock, scheduler, calls } = makeScheduler(t);
	scheduler.settled();
	clock.advance(4 * 60_000);
	assert.deepEqual(calls, [], "must not fire early");
	clock.advance(60_000);

	return flush().then(() => {
		assert.deepEqual(calls, ["settled"]);
		assert.equal(lastPassAt(root), new Date(EPOCH + 5 * 60_000).toISOString());
		assert.equal(fs.existsSync(passLockPath(root)), false);
		assert.equal(scheduler.pending, false);
	});
});

// ---------------------------------------------------------------------------
// Admission chain — each decline has a named reason and spends nothing.
// ---------------------------------------------------------------------------

test("a query-only session is suppressed for both trigger kinds", async (t) => {
	const { scheduler, skips, calls } = makeScheduler(t, { getActiveTools: () => ["read", "bash"] });
	const direct = await scheduler.learnNow();
	assert.deepEqual(direct, { ran: false, skipped: "query-only session" });
	assert.deepEqual(calls, []);
	assert.ok(skips.includes("query-only session"));
});

test("a code-mode session with a kernel is admitted", async (t) => {
	// The whole point: `["python"]` reads as query-only, so without the kernel report this
	// session would be skipped and code-mode sessions would never be learned from.
	const { scheduler, calls, skips } = makeScheduler(t, {
		getActiveTools: () => ["python"],
		kernelCanWrite: () => true,
	});
	const result = await scheduler.learnNow();
	assert.equal(result.ran, true);
	assert.deepEqual(calls, ["learn"]);
	assert.equal(skips.includes("query-only session"), false);
});

test("a session reporting canWrite false stays suppressed", async (t) => {
	const { scheduler, calls } = makeScheduler(t, {
		getActiveTools: () => ["read", "write"],
		kernelCanWrite: () => false,
	});
	assert.deepEqual(await scheduler.learnNow(), { ran: false, skipped: "query-only session" });
	assert.deepEqual(calls, []);
});

test("a code-mode session with no kernel is still suppressed", async (t) => {
	// No code mode: nothing is reported, and the heuristic must keep working as it did.
	const { scheduler, calls } = makeScheduler(t, { getActiveTools: () => ["python"] });
	assert.deepEqual(await scheduler.learnNow(), { ran: false, skipped: "query-only session" });
	assert.deepEqual(calls, []);
});

test("settled without a learnable signal spends nothing", async (t) => {
	const { clock, scheduler, skips, calls } = makeScheduler(t, { getScanMessages: () => [{ role: "user", text: "hello" }] });
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.deepEqual(calls, []);
	assert.ok(skips.includes("no learnable signal"));
});

test("a pass inside the minimum interval is skipped", async (t) => {
	const { root, clock, scheduler, skips, calls } = makeScheduler(t);
	await setLastPassAt(root, new Date(EPOCH - 60_000).toISOString());
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.deepEqual(calls, []);
	assert.ok(skips.includes("within the minimum interval"));
});

test("a held pass lock is skipped rather than queued", async (t) => {
	const { root, clock, scheduler, skips, calls } = makeScheduler(t);
	fs.writeFileSync(passLockPath(root), `1 ${Date.now()} held\n`);
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.deepEqual(calls, []);
	assert.ok(skips.includes("a pass is already running"));
	assert.equal(fs.existsSync(passLockPath(root)), true, "the other holder's lock is untouched");
});

test("a disabled extension never runs or arms a timer", async (t) => {
	const { scheduler, calls } = makeScheduler(t, { config: { enabled: false } });
	scheduler.settled();
	assert.equal(scheduler.pending, false);
	assert.equal((await scheduler.learnNow()).ran, false);
	assert.deepEqual(calls, []);
});

// ---------------------------------------------------------------------------
// Interval, rollback and /rsi learn bypass.
// ---------------------------------------------------------------------------

test("a signal fires a pass once the interval has elapsed", async (t) => {
	const { root, clock, scheduler, calls } = makeScheduler(t);
	await setLastPassAt(root, new Date(EPOCH - 60 * 60_000).toISOString());
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.deepEqual(calls, ["settled"]);
	assert.equal(lastPassAt(root), new Date(EPOCH + 5 * 60_000).toISOString());
});

test("a failed pass with no tool actions rolls the clock back", async (t) => {
	const previous = new Date(EPOCH - 60 * 60_000).toISOString();
	const { root, scheduler } = makeScheduler(t, {
		runPass: async () => {
			throw new Error("provider unavailable");
		},
	});
	await setLastPassAt(root, previous);
	const result = await scheduler.learnNow();
	assert.equal(result.ran, true);
	assert.equal(result.outcome.ok, false);
	assert.equal(lastPassAt(root), previous, "a wasted call must not consume the slot");
});

test("a failed pass that did work keeps the advanced clock", async (t) => {
	const { root, scheduler } = makeScheduler(t, { runPass: async () => ({ ok: false, toolActions: 2 }) });
	await setLastPassAt(root, new Date(EPOCH - 60 * 60_000).toISOString());
	const result = await scheduler.learnNow();
	assert.equal(result.outcome.toolActions, 2);
	assert.equal(lastPassAt(root), new Date(EPOCH).toISOString());
});

test("learnNow bypasses the pre-scan and the interval but not the lock", async (t) => {
	const { root, clock, scheduler, calls } = makeScheduler(t, {
		getScanMessages: () => [{ role: "user", text: "nothing learnable here" }],
	});
	await setLastPassAt(root, new Date(EPOCH - 60_000).toISOString());

	const result = await scheduler.learnNow();
	assert.deepEqual(result, { ran: true, outcome: { ok: true, toolActions: 1 } });
	assert.deepEqual(calls, ["learn"]);
	assert.equal(lastPassAt(root), new Date(clock.now()).toISOString());
});

// ---------------------------------------------------------------------------
// Curation — its own cadence on the same lock, with its own clock.
// ---------------------------------------------------------------------------

test("curateNow respects the cadence and records last_curate_at", async (t) => {
	const { root, scheduler } = makeScheduler(t, { curate: async () => ({ ok: true, toolActions: 1 }), curationDue: () => true });
	assert.deepEqual(await scheduler.curateNow(), { ran: true, outcome: { ok: true, toolActions: 1 } });
	assert.equal(readLedger(root).ledger.last_curate_at, new Date(EPOCH).toISOString());
});

test("curateNow forces curation past the cadence, but needs a curator", async (t) => {
	const forced = makeScheduler(t, { curate: async () => ({ ok: true, toolActions: 1 }), curationDue: () => false });
	assert.deepEqual(await forced.scheduler.curateNow(), { ran: true, outcome: { ok: true, toolActions: 1 } });

	const none = makeScheduler(t);
	assert.deepEqual(await none.scheduler.curateNow(), { ran: false, skipped: "no curator configured" });
});

test("the quiet timer does not curate when it is not due", async (t) => {
	let curated = 0;
	const { clock, scheduler } = makeScheduler(t, {
		curate: async () => {
			curated++;
			return { ok: true, toolActions: 1 };
		},
		curationDue: () => false,
	});
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.equal(curated, 0);
});

test("a failed curation with no actions rolls the cadence clock back", async (t) => {
	const { root, scheduler } = makeScheduler(t, {
		curate: async () => {
			throw new Error("boom");
		},
		curationDue: () => true,
	});
	await setLastCurateAt(root, "2026-01-01T00:00:00.000Z");
	const result = await scheduler.curateNow();
	assert.equal(result.outcome.ok, false);
	assert.equal(readLedger(root).ledger.last_curate_at, "2026-01-01T00:00:00.000Z");
});

test("a query-only session suppresses curation too", async (t) => {
	const { scheduler, skips } = makeScheduler(t, { curate: async () => ({ ok: true, toolActions: 1 }), curationDue: () => true, getActiveTools: () => ["read"] });
	assert.deepEqual(await scheduler.curateNow(), { ran: false, skipped: "query-only session" });
	assert.ok(skips.includes("query-only session"));
});

test("the quiet timer runs curation when it is due", async (t) => {
	let curated = 0;
	const { clock, scheduler } = makeScheduler(t, {
		getScanMessages: () => [{ role: "user", text: "nothing learnable" }],
		curate: async () => {
			curated++;
			return { ok: true, toolActions: 1 };
		},
		curationDue: () => true,
	});
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.equal(curated, 1);
});

// ---------------------------------------------------------------------------
// Per-session interval and the tree-wide floor (RSI x RLM ticket 12).
//
// As shipped, one global stamp meant a tree of N learners got one pass per interval in
// total — a child's pass consumed the root's. These pin the two-clock behaviour.
// ---------------------------------------------------------------------------

test("a session's pass does not consume another session's interval", async (t) => {
	const a = "/sessions/a.jsonl";
	const b = "/sessions/b.jsonl";
	const { root, clock, scheduler, calls } = makeScheduler(t, { getSessionFile: () => a });

	// Session A runs a pass and stamps only itself.
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.deepEqual(calls, ["settled"]);
	assert.equal(sessionAt(root, a), new Date(EPOCH + 5 * 60_000).toISOString());
	assert.equal(sessionAt(root, b), null, "B was never stamped");

	// A second scheduler standing in for session B is due immediately: its own clock is unset,
	// and the floor is short enough to have elapsed.
	const second = makeScheduler(t, { getSessionFile: () => b });
	await setLastPassAt(second.root, new Date(EPOCH).toISOString());
	const { scheduler: bScheduler, calls: bCalls } = makeScheduler(t, { getSessionFile: () => b });
	await setSessionPassAt(root, b, null);
	assert.equal(sessionAt(root, b), null);
	// The same session, however, is still inside its own interval.
	const { scheduler: sameAgain, calls: sameCalls } = makeScheduler(t, { getSessionFile: () => a });
	await setLastPassAt(root, new Date(EPOCH + 5 * 60_000).toISOString());
	sameAgain.settled();
	clock.advance(60_000);
	await flush();
	assert.deepEqual(sameCalls, [], "A is inside its own interval");
});

test("the tree-wide floor caps how often any session may pass", async (t) => {
	// A different session, with its own interval long elapsed, is still held back by the floor.
	// The floor only bites when it is *longer* than the wait, which is exactly when a tree of
	// learners would otherwise fire together.
	const { root, clock, scheduler, skips, calls } = makeScheduler(t, {
		config: { treeFloorMinutes: 60 },
		getSessionFile: () => "/sessions/b.jsonl",
	});
	await setLastPassAt(root, new Date(EPOCH - 60_000).toISOString()); // 1 minute ago, well inside a 60-minute floor
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.deepEqual(calls, []);
	assert.ok(skips.includes("within the tree-wide floor"));
});

test("the floor does not constrain a session once it has elapsed", async (t) => {
	const { root, clock, scheduler, calls } = makeScheduler(t, { getSessionFile: () => "/sessions/b.jsonl" });
	await setLastPassAt(root, new Date(EPOCH - 10 * 60_000).toISOString());
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	// The pass ran, so both clocks advanced: this session's own, and the floor.
	assert.deepEqual(calls, ["settled"]);
	assert.equal(sessionAt(root, "/sessions/b.jsonl"), new Date(EPOCH + 5 * 60_000).toISOString());
	assert.equal(lastPassAt(root), new Date(EPOCH + 5 * 60_000).toISOString());
});

test("a failed pass rolls back its own session's stamp, not the floor", async (t) => {
	const file = "/sessions/a.jsonl";
	const previous = new Date(EPOCH - 60 * 60_000).toISOString();
	const { root, scheduler } = makeScheduler(t, {
		getSessionFile: () => file,
		runPass: async () => {
			throw new Error("provider unavailable");
		},
	});
	await setSessionPassAt(root, file, previous);
	const result = await scheduler.learnNow();
	assert.equal(result.outcome.ok, false);
	assert.equal(sessionAt(root, file), previous, "this session may retry");
	assert.notEqual(lastPassAt(root), previous, "the floor records that a pass ran");
});

test("a failed pass in one session does not license another to retry", async (t) => {
	const file = "/sessions/a.jsonl";
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-sched-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const clock = new FakeClock();

	// A's pass fails with no work: A's own stamp rolls back, but the floor stays advanced.
	const a = makeSchedulerAt(t, root, clock, {
		getSessionFile: () => file,
		runPass: async () => {
			throw new Error("boom");
		},
	});
	await setSessionPassAt(root, file, new Date(EPOCH - 60 * 60_000).toISOString());
	await a.scheduler.learnNow();
	assert.equal(sessionAt(root, file), new Date(EPOCH - 60 * 60_000).toISOString(), "A may retry");
	assert.equal(lastPassAt(root), new Date(EPOCH).toISOString(), "the floor records that a pass ran");

	// B is a different session with its own interval long elapsed, but the floor holds it back.
	const b = makeSchedulerAt(t, root, clock, {
		config: { treeFloorMinutes: 60 },
		getSessionFile: () => "/sessions/b.jsonl",
	});
	b.scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.deepEqual(b.calls, [], "B was not licensed by A's failure");
});

test("with no session file, the global stamp is the interval — the single-learner behaviour", async (t) => {
	const { root, clock, scheduler, calls, skips } = makeScheduler(t);
	await setLastPassAt(root, new Date(EPOCH - 60_000).toISOString());
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.deepEqual(calls, []);
	assert.ok(skips.includes("within the minimum interval"));
});

// ---------------------------------------------------------------------------
// Losing the lock (ticket 12): an answered child may never settle again, so a lost
// race must re-arm rather than silently ending that session's chance to learn.
// ---------------------------------------------------------------------------

test("losing the lock asks the caller to re-arm", async (t) => {
	let rearmed = 0;
	const { root, clock, scheduler, skips, calls } = makeScheduler(t, { onLockContention: () => { rearmed++; } });
	fs.writeFileSync(passLockPath(root), `1 ${Date.now()} held\n`);
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.equal(rearmed, 1);
	assert.ok(skips.includes("a pass is already running"));
	assert.deepEqual(calls, []);
});

test("the re-arm is bounded, so a contended store does not retry forever", async (t) => {
	let rearmed = 0;
	const { root, clock, scheduler } = makeScheduler(t, { onLockContention: () => { rearmed++; } });
	fs.writeFileSync(passLockPath(root), `1 ${Date.now()} held\n`);
	// Every attempt finds the lock held, so without a bound this would re-arm indefinitely.
	for (let attempt = 0; attempt < 10; attempt++) {
		scheduler.settled();
		clock.advance(5 * 60_000);
		await flush();
	}
	assert.equal(rearmed, 3, "bounded to MAX_LOCK_RETRIES consecutive re-arms");
});

test("winning the lock resets the retry budget", async (t) => {
	let rearmed = 0;
	const { root, clock, scheduler } = makeScheduler(t, { onLockContention: () => { rearmed++; } });
	fs.writeFileSync(passLockPath(root), `1 ${Date.now()} held\n`);
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.equal(rearmed, 1);

	// The holder releases; the next attempt runs and clears the budget.
	fs.rmSync(passLockPath(root));
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();

	// Now it may be re-armed again from a fresh budget.
	fs.writeFileSync(passLockPath(root), `1 ${Date.now()} held\n`);
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.equal(rearmed, 2);
});

// ---------------------------------------------------------------------------
// The child's pass (RSI x RLM ticket 13): a shorter quiet period, and a guard for a
// session that was aborted — an aborted run still settles, which would otherwise run a
// pass over a deliberately truncated session.
// ---------------------------------------------------------------------------

test("a session's own quiet period is used when one is supplied", async (t) => {
	const { clock, scheduler, calls } = makeScheduler(t, { quietMinutes: () => 1 });
	scheduler.settled();
	clock.advance(60_000);
	await flush();
	assert.deepEqual(calls, ["settled"], "one minute is enough for this session");
});

test("without one, the config's quietMinutes applies", async (t) => {
	const { clock, scheduler, calls } = makeScheduler(t);
	scheduler.settled();
	clock.advance(60_000);
	await flush();
	assert.deepEqual(calls, [], "still quiet: the config says five minutes");
	clock.advance(4 * 60_000);
	await flush();
	assert.deepEqual(calls, ["settled"]);
});

test("a session whose last turn was aborted is skipped", async (t) => {
	const { clock, scheduler, skips, calls } = makeScheduler(t, { lastTurnWasAborted: () => true });
	scheduler.settled();
	clock.advance(5 * 60_000);
	await flush();
	assert.deepEqual(calls, [], "no fork over a truncated session");
	assert.ok(skips.includes("the last turn was aborted"));
});

test("an explicit learn still runs on an aborted session", async (t) => {
	// The guard is an admission heuristic, not a prohibition: `/rsi learn` is the human saying
	// "learn from this anyway".
	const { scheduler, calls } = makeScheduler(t, { lastTurnWasAborted: () => true });
	const result = await scheduler.learnNow();
	assert.equal(result.ran, true);
	assert.deepEqual(calls, ["learn"]);
});

test("a pass that throws reports through notify instead of failing silently", async (t) => {
	// The gap that let a broken pass go unnoticed: the throw was contained (correctly), but
	// nothing was wired to `notify`, so the tree-wide floor advanced and left no trace.
	const notices = [];
	const { scheduler } = makeScheduler(t, {
		runPass: async () => {
			throw new Error("Cannot access 'provenance' before initialization");
		},
		notify: (line, type) => notices.push({ line, type }),
	});
	const result = await scheduler.learnNow();
	assert.equal(result.ran, true);
	assert.equal(result.outcome.ok, false);
	assert.equal(notices.length, 1);
	assert.match(notices[0].line, /rsi: pass failed/);
	assert.match(notices[0].line, /before initialization/);
	assert.equal(notices[0].type, "error");
});
