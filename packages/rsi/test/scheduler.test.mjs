import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { readLedger, setLastPassAt } from "../ledger.ts";
import { passLockPath } from "../pass-lock.ts";
import { intervalElapsed, isQueryOnly, PassScheduler } from "../scheduler.ts";

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
		getScanMessages: options.getScanMessages ?? (() => [{ role: "user", text: "remember this" }]),
		runPass,
		clock,
		onSkip: (reason) => skips.push(reason),
		notify: options.notify,
	});
	return { root, clock, scheduler, skips, calls };
}

const lastPassAt = (root) => readLedger(root).ledger.last_pass_at;

// ---------------------------------------------------------------------------
// Pure predicates.
// ---------------------------------------------------------------------------

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
