import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
	findRsiSeam,
	publishedCapability,
	pruneRegistrations,
	registerRsiSeam,
	rsiSeamStatus,
	__resetSeamForTests,
	__seamSizeForTests,
} from "../seam.ts";

/** A stand-in instance: records what it was asked, answers from a fixed list. */
function fakeWork(skills = [{ name: "seeded", description: "d", location: "/x/SKILL.md", scope: "general" }]) {
	const calls = { usage: [], hostCalls: [], scopes: [] };
	return {
		calls,
		work: {
			skills: (scope) => {
				calls.scopes.push(scope);
				return skills;
			},
			skill: (name) => (name === "seeded" ? { content: "body", files: [] } : undefined),
			noteUsage: (usage) => calls.usage.push(usage),
			noteHostCall: (call) => calls.hostCalls.push(call),
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
	assert.equal(publishedCapability(undefined), undefined);
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

test("skills() is process-wide: any live instance answers, so a grandchild is served", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	const first = fakeWork([{ name: "one", description: "d", location: "/1/SKILL.md", scope: "general" }]);
	const second = fakeWork([{ name: "two", description: "d", location: "/2/SKILL.md", scope: "general" }]);
	const withdrawA = registerRsiSeam({ work: first.work, sessionFile: tempSessionFile(t, "a.jsonl") });
	const withdrawB = registerRsiSeam({ work: second.work, sessionFile: tempSessionFile(t, "b.jsonl") });

	// A caller no instance owns still gets an answer, because the store is global.
	const seam = findRsiSeam();
	assert.deepEqual(
		seam.skills({ sessionFile: "/nowhere/else.jsonl" }).map((skill) => skill.name),
		["one"],
	);
	assert.equal(seam.skill("seeded", { sessionFile: "/nowhere/else.jsonl" })?.content, "body");
	assert.equal(seam.skill("absent", { sessionFile: "/nowhere/else.jsonl" }), undefined);
	withdrawA();
	withdrawB();
});

test("the facade resolves the scope; a client never computes a project key", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	const { work, calls } = fakeWork();
	const withdraw = registerRsiSeam({ work, sessionFile: tempSessionFile(t) });
	const seam = findRsiSeam();

	seam.skills({ cwd: "/tmp/not-a-repo-at-all" });
	assert.equal(calls.scopes.at(-1), "general", "an unkeyable cwd resolves to general");

	withdraw();
});

test("a session-scoped report reaches its own instance, and only that one", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	const mine = fakeWork();
	const theirs = fakeWork();
	const myFile = tempSessionFile(t, "mine.jsonl");
	const theirFile = tempSessionFile(t, "theirs.jsonl");
	const withdrawMine = registerRsiSeam({ work: mine.work, sessionFile: myFile });
	const withdrawTheirs = registerRsiSeam({ work: theirs.work, sessionFile: theirFile });

	const seam = findRsiSeam();
	seam.noteUsage({ sessionFile: myFile, kind: "skill", target: "seeded" });
	seam.noteHostCall({ sessionFile: theirFile, command: "cat /x/SKILL.md" });

	assert.equal(mine.calls.usage.length, 1);
	assert.equal(mine.calls.hostCalls.length, 0);
	assert.equal(theirs.calls.usage.length, 0);
	assert.equal(theirs.calls.hostCalls.length, 1);

	withdrawMine();
	withdrawTheirs();
});

test("a capability fact is per session, so a child never inherits the root's", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	const rootFile = tempSessionFile(t, "root.jsonl");
	const childFile = tempSessionFile(t, "child.jsonl");
	const withdraw = registerRsiSeam({ work: fakeWork().work, sessionFile: rootFile });
	const seam = findRsiSeam();

	seam.capability({ sessionFile: rootFile, canWrite: true, reason: "kernel can write" });
	assert.equal(publishedCapability(rootFile), true);
	assert.equal(publishedCapability(childFile), undefined, "an unpublished session falls back to the tool heuristic");

	// A child publishing its own fact must not be mistaken for the root.
	seam.capability({ sessionFile: childFile, canWrite: false, reason: "read-only kernel" });
	assert.equal(publishedCapability(childFile), false);
	assert.equal(publishedCapability(rootFile), true);

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

test("a registration with no session file is never pruned, and still serves reads", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	const { work } = fakeWork();
	const withdraw = registerRsiSeam({ work });
	assert.equal(pruneRegistrations(1), 0, "there is no mtime to judge it by");
	assert.equal(findRsiSeam().skills({}).length, 1);
	withdraw();
});

test("a half-shaped slot is not mistaken for the seam", (t) => {
	t.after(() => __resetSeamForTests());
	__resetSeamForTests();
	(globalThis)[Symbol.for("@earendil/rsi:pi-registry")] = { skills: () => [] };
	assert.equal(findRsiSeam(), undefined, "a facade without skill() is not ours");
	__resetSeamForTests();
});
