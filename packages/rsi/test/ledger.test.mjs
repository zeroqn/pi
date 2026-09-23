import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { ensureLedger, ensureSkillEntry, ledgerLockPath, ledgerPath, readLedger, recordCountedUsage, recordUsage, sessionCountedAt, sessionPassAt, setLastCurateAt, setLastPassAt, setSessionPassAt, setSkillState, takeStatusSnapshot, withLedgerLock, writeLedger } from "../ledger.ts";

function tempRoot(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-ledger-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return root;
}

test("a missing ledger reads as empty without a warning", (t) => {
	const root = tempRoot(t);
	const { ledger, warning } = readLedger(root);
	assert.equal(warning, undefined);
	assert.equal(ledger.schema_version, 1);
	assert.equal(ledger.last_pass_at, null);
	assert.deepEqual(ledger.skills, {});
});

test("ensureLedger creates the file once and is idempotent", (t) => {
	const root = tempRoot(t);
	assert.equal(ensureLedger(root), true);
	assert.equal(fs.existsSync(ledgerPath(root)), true);
	assert.equal(ensureLedger(root), false);
});

test("writeLedger round-trips state and replaces the previous file", (t) => {
	const root = tempRoot(t);
	writeLedger(root, {
		schema_version: 1,
		last_pass_at: "2026-09-14T12:00:00.000Z",
		skills: { "some-skill": { use_count: 2, pinned: true, scope: "general" } },
	});

	const { ledger, warning } = readLedger(root);
	assert.equal(warning, undefined);
	assert.equal(ledger.last_pass_at, "2026-09-14T12:00:00.000Z");
	assert.equal(ledger.skills["some-skill"].use_count, 2);
	assert.equal(ledger.skills["some-skill"].pinned, true);

	writeLedger(root, { schema_version: 1, last_pass_at: null, skills: {} });
	assert.deepEqual(readLedger(root).ledger.skills, {});
});

test("writeLedger leaves no temp sibling behind", (t) => {
	const root = tempRoot(t);
	writeLedger(root, { schema_version: 1, last_pass_at: null, skills: {} });
	assert.deepEqual(fs.readdirSync(root), ["index.json"]);
});

test("a corrupt ledger reads as empty with a warning naming the file", (t) => {
	const root = tempRoot(t);
	fs.writeFileSync(ledgerPath(root), "{ not json");
	const { ledger, warning } = readLedger(root);
	assert.deepEqual(ledger.skills, {});
	assert.match(warning, /corrupt ledger/);
	assert.match(warning, /index\.json/);
});

// ---------------------------------------------------------------------------
// recordUsage — the counters /rsi status reports. A read moves both counters,
// an expansion moves only use_count, and every use resets the disuse clock.
// ---------------------------------------------------------------------------

test("recordUsage counts reads and expansions and preserves other state", async (t) => {
	const root = tempRoot(t);
	writeLedger(root, {
		schema_version: 1,
		last_pass_at: null,
		skills: { "some-skill": { pinned: true, patch_count: 3 } },
	});

	assert.equal(await recordUsage(root, { skill: "some-skill", scope: "general", kind: "read", at: "2026-09-01T00:00:00.000Z" }), true);
	assert.equal(await recordUsage(root, { skill: "some-skill", scope: "general", kind: "read", at: "2026-09-02T00:00:00.000Z" }), true);
	assert.equal(await recordUsage(root, { skill: "some-skill", scope: "general", kind: "expansion", at: "2026-09-03T00:00:00.000Z" }), true);

	const entry = readLedger(root).ledger.skills["some-skill"];
	assert.equal(entry.use_count, 3);
	assert.equal(entry.read_count, 2);
	assert.equal(entry.first_seen_at, "2026-09-01T00:00:00.000Z");
	assert.equal(entry.last_used_at, "2026-09-03T00:00:00.000Z");
	assert.equal(entry.pinned, true);
	assert.equal(entry.patch_count, 3);
	assert.equal(entry.scope, "general");
	assert.equal(entry.state, "active");
});

test("recordUsage waits for a contended lock and leaves it released", async (t) => {
	const root = tempRoot(t);
	const lock = ledgerLockPath(root);
	fs.writeFileSync(lock, "held by another process");

	const pending = recordUsage(root, { skill: "waited", scope: "github.com/acme/app", kind: "read" });
	setTimeout(() => fs.unlinkSync(lock), 30);
	assert.equal(await pending, true);

	assert.equal(readLedger(root).ledger.skills.waited.use_count, 1);
	assert.equal(fs.existsSync(lock), false);
});

test("withLedgerLock reclaims a stale lock", async (t) => {
	const root = tempRoot(t);
	const lock = ledgerLockPath(root);
	fs.writeFileSync(lock, "abandoned");
	const old = new Date(Date.now() - 60_000);
	fs.utimesSync(lock, old, old);

	assert.equal(await withLedgerLock(root, () => "ran"), "ran");
	assert.equal(fs.existsSync(lock), false);
});

test("takeStatusSnapshot stores the look and returns the previous one", async (t) => {
	const root = tempRoot(t);
	const first = await takeStatusSnapshot(root, { skills: 2, uses: 5, neverUsed: 1 }, "2026-09-01T00:00:00.000Z");
	assert.equal(first.previous, undefined);

	const second = await takeStatusSnapshot(root, { skills: 3, uses: 9, neverUsed: 1 }, "2026-09-02T00:00:00.000Z");
	assert.deepEqual(second.previous, { skills: 2, uses: 5, neverUsed: 1 });
	assert.equal(second.lastStatusAt, "2026-09-01T00:00:00.000Z");

	const { ledger } = readLedger(root);
	assert.deepEqual(ledger.last_status, { skills: 3, uses: 9, neverUsed: 1 });
	assert.equal(ledger.last_status_at, "2026-09-02T00:00:00.000Z");
});

test("setLastPassAt advances and restores the interval clock", async (t) => {
	const root = tempRoot(t);
	assert.equal(await setLastPassAt(root, "2026-09-14T12:00:00.000Z"), true);
	assert.equal(readLedger(root).ledger.last_pass_at, "2026-09-14T12:00:00.000Z");

	assert.equal(await setLastPassAt(root, null), true);
	assert.equal(readLedger(root).ledger.last_pass_at, null);
});

test("ensureSkillEntry records a skill without counting a use", async (t) => {
	const root = tempRoot(t);
	await ensureSkillEntry(root, { name: "fresh", scope: "github.com/acme/app", at: "2026-09-14T00:00:00.000Z" });
	const entry = readLedger(root).ledger.skills.fresh;
	assert.equal(entry.first_seen_at, "2026-09-14T00:00:00.000Z");
	assert.equal(entry.scope, "github.com/acme/app");
	assert.equal(entry.state, "active");
	assert.equal(entry.use_count, undefined);

	await ensureSkillEntry(root, { name: "fresh", scope: "general", at: "2027-01-01T00:00:00.000Z" });
	assert.equal(readLedger(root).ledger.skills.fresh.first_seen_at, "2026-09-14T00:00:00.000Z", "first_seen_at is not rewritten");
});

test("setSkillState flips the lifecycle state", async (t) => {
	const root = tempRoot(t);
	await setSkillState(root, "retired", "archived");
	assert.equal(readLedger(root).ledger.skills.retired.state, "archived");
});

test("setLastCurateAt advances and clears the curation clock", async (t) => {
	const root = tempRoot(t);
	await setLastCurateAt(root, "2026-09-14T12:00:00.000Z");
	assert.equal(readLedger(root).ledger.last_curate_at, "2026-09-14T12:00:00.000Z");
	await setLastCurateAt(root, null);
	assert.equal(readLedger(root).ledger.last_curate_at, undefined);
});

// ---------------------------------------------------------------------------
// The counting cursor (one-way map ticket 11).
// ---------------------------------------------------------------------------

test("recordCountedUsage writes the counts and the cursor together", async (t) => {
	const root = tempRoot(t);
	const at = "2026-09-18T00:00:01.000Z";
	const written = await recordCountedUsage(root, {
		sessionFile: "/tmp/s.jsonl",
		at,
		usages: [
			{ skill: "one", scope: "general", kind: "read" },
			{ skill: "two", scope: "general", kind: "expansion" },
		],
	});
	assert.equal(written, true);
	const { ledger } = readLedger(root);
	assert.equal(sessionCountedAt(ledger, "/tmp/s.jsonl"), at);
	// The same counters `recordUsage` writes: a read moves both, an expansion moves the use count.
	assert.equal(ledger.skills.one.use_count, 1);
	assert.equal(ledger.skills.one.read_count, 1);
	assert.equal(ledger.skills.two.use_count, 1);
	assert.equal(ledger.skills.two.read_count, undefined);
});

test("recordCountedUsage advances the cursor even with nothing to count", async (t) => {
	// A cell that consulted nothing has still been seen. Without this, every settle would re-read it
	// and the pull would never make progress.
	const root = tempRoot(t);
	const at = "2026-09-18T00:00:02.000Z";
	await recordCountedUsage(root, { sessionFile: "/tmp/s.jsonl", at, usages: [] });
	assert.equal(sessionCountedAt(readLedger(root).ledger, "/tmp/s.jsonl"), at);
	assert.deepEqual(readLedger(root).ledger.skills, {});
});

test("the counting cursor is not the interval clock", async (t) => {
	// Two fields on purpose: counting runs at every settle, a pass runs on its own schedule, and a
	// pass that fails rolls its stamp back. If they shared a field, a failed pass would re-count.
	const root = tempRoot(t);
	await setSessionPassAt(root, "/tmp/s.jsonl", "2026-09-18T00:00:00.000Z");
	assert.equal(sessionCountedAt(readLedger(root).ledger, "/tmp/s.jsonl"), null, "a pass is not a count");

	await recordCountedUsage(root, { sessionFile: "/tmp/s.jsonl", at: "2026-09-18T00:00:03.000Z", usages: [] });
	const { ledger } = readLedger(root);
	assert.equal(sessionCountedAt(ledger, "/tmp/s.jsonl"), "2026-09-18T00:00:03.000Z");
	assert.equal(sessionPassAt(ledger, "/tmp/s.jsonl"), "2026-09-18T00:00:00.000Z", "counting does not move the pass stamp");
});

test("sessionCountedAt is null without a session file, and null before anything is counted", (t) => {
	const root = tempRoot(t);
	assert.equal(sessionCountedAt(readLedger(root).ledger, undefined), null);
	assert.equal(sessionCountedAt(readLedger(root).ledger, "/tmp/never.jsonl"), null);
});
