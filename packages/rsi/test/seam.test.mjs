import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
	findRsiSeam,
	isChildSession,
	pruneRegistrations,
	registerRsiSeam,
	rsiSeamStatus,
	__resetSeamForTests,
	__seamSizeForTests,
} from "../seam.ts";

/** A stand-in instance: records how often its factory was handed out, and what it built. */
function fakeWork() {
	const calls = { handed: 0, built: [] };
	return {
		calls,
		work: {
			childExtension: () => {
				calls.handed += 1;
				return (pi) => calls.built.push(pi);
			},
		},
	};
}

function tempSessionFile(t, name = "s.jsonl") {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-seam-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const file = path.join(dir, name);
	fs.writeFileSync(file, "{}\n");
	return file;
}

test("nothing is published until an instance registers, and the status says so", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	assert.equal(findRsiSeam(), undefined);
	assert.equal(rsiSeamStatus(), "rsi seam: no instance published");
	assert.equal(isChildSession(undefined), false);
});

test("publishing makes the facade findable, and withdrawing it removes it", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	const { work } = fakeWork();
	const withdraw = registerRsiSeam({ work, sessionFile: tempSessionFile(t) });
	assert.equal(__seamSizeForTests(), 1);
	assert.ok(findRsiSeam());
	assert.equal(rsiSeamStatus(), "rsi seam: 1 instance(s) published");

	withdraw();
	assert.equal(findRsiSeam(), undefined, "the slot is cleared when the last instance goes");

	// Withdrawing twice must not throw, because shutdown paths can run more than once.
	withdraw();
	assert.equal(__seamSizeForTests(), 0);
});

test("childExtension() is process-wide: any live instance answers, so a grandchild is served", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	const first = fakeWork();
	const second = fakeWork();
	const withdrawA = registerRsiSeam({ work: first.work, sessionFile: tempSessionFile(t, "a.jsonl") });
	const withdrawB = registerRsiSeam({ work: second.work, sessionFile: tempSessionFile(t, "b.jsonl") });

	// Every instance would build the same factory, so which one answers is immaterial - which is
	// what makes a grandchild, whose parent instance is gone, still work.
	const factory = findRsiSeam().childExtension();
	assert.equal(typeof factory, "function");
	factory({ marker: "childPi" });
	// `any()` is the first registered instance; which one answers is immaterial in production,
	// because every instance builds the same factory.
	assert.deepEqual(first.calls.built, [{ marker: "childPi" }]);
	assert.equal(second.calls.handed, 0);

	withdrawA();
	withdrawB();
});

test("a facade whose work omits the child factory returns undefined rather than throwing", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	// An older RSI, or a partial instance: rlm must run the child without RSI rather than fail.
	registerRsiSeam({ work: {}, sessionFile: tempSessionFile(t) });
	assert.equal(findRsiSeam().childExtension(), undefined);
});

test("a bind marks its own session, and no other", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	const mine = tempSessionFile(t, "mine.jsonl");
	const theirs = tempSessionFile(t, "theirs.jsonl");
	const third = tempSessionFile(t, "third.jsonl");
	const withdrawA = registerRsiSeam({ work: fakeWork().work, sessionFile: mine });
	const withdrawB = registerRsiSeam({ work: fakeWork().work, sessionFile: theirs });

	findRsiSeam().bindChild({ sessionFile: mine });
	assert.equal(isChildSession(mine), true);
	assert.equal(isChildSession(theirs), false, "the sibling instance is not a child");
	assert.equal(isChildSession(third), false, "a session nobody bound is not a child");
	assert.equal(isChildSession(undefined), false);

	// Binding twice is idempotent: the same fact set twice is the same fact.
	findRsiSeam().bindChild({ sessionFile: mine });
	assert.equal(isChildSession(mine), true);

	withdrawA();
	withdrawB();
});

test("a bind that arrives before the session file is known still lands, and is readable", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	// The load-order case: rlm's `session_start` runs before RSI's (the manifest loads rlm first),
	// so at bind time `resolve()` cannot find RSI's instance - `currentCtx` is still unset - and the
	// write falls back to the publishing registration. The read scans every registration, so where
	// the write landed does not matter. This is the failure the rsi-rlm acceptance check caught for
	// the capability fact, and the shape here is deliberately the same.
	let file;
	const withdraw = registerRsiSeam({ work: fakeWork().work, sessionFile: () => file });
	const seam = findRsiSeam();

	seam.bindChild({ sessionFile: undefined });
	assert.equal(isChildSession(undefined), true, "the session-less key is bound");

	file = tempSessionFile(t, "late.jsonl");
	seam.bindChild({ sessionFile: file });
	assert.equal(isChildSession(file), true);

	withdraw();
});

test("pruning drops registrations by session-file mtime, never a fresh one", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	const fresh = tempSessionFile(t, "fresh.jsonl");
	const stale = tempSessionFile(t, "stale.jsonl");
	const withdrawA = registerRsiSeam({ work: fakeWork().work, sessionFile: fresh });
	const withdrawB = registerRsiSeam({ work: fakeWork().work, sessionFile: stale });
	assert.equal(__seamSizeForTests(), 2);

	// Backdate one file well past the window.
	const old = new Date(Date.now() - 60 * 60 * 1000);
	fs.utimesSync(stale, old, old);

	assert.equal(pruneRegistrations(30 * 60 * 1000), 1);
	assert.equal(__seamSizeForTests(), 1);
	assert.equal(rsiSeamStatus(), "rsi seam: 1 instance(s) published");

	// A vanished session file is also dropped: nothing can be waiting on its facts.
	fs.rmSync(fresh);
	assert.equal(pruneRegistrations(30 * 60 * 1000), 1);
	assert.equal(__seamSizeForTests(), 0);
	withdrawA();
	withdrawB();
});

test("a registration with no session file is never pruned, and still offers its factory", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	const { work } = fakeWork();
	const withdraw = registerRsiSeam({ work });
	assert.equal(pruneRegistrations(1), 0, "there is no mtime to judge it by");
	assert.equal(typeof findRsiSeam().childExtension(), "function");
	withdraw();
});

test("a half-shaped slot is not mistaken for the seam", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	globalThis[Symbol.for("@earendil/rsi:pi-registry")] = { childExtension: () => undefined };
	assert.equal(findRsiSeam(), undefined, "a facade without bindChild() is not ours");
	__resetSeamForTests();
});
