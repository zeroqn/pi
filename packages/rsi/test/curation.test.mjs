import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { buildCandidates, buildCurationReport, buildCuratorPrompt, isCurationDue, retirementCandidates } from "../curation.ts";
import { SkillStore } from "../store.ts";
import { curationDueForSession } from "../curation.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-14T12:00:00.000Z");
const daysAgo = (days) => new Date(NOW - days * DAY).toISOString();

function tempStore(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-curation-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return new SkillStore({ root });
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

function emptyLedger() {
	return { schema_version: 1, last_pass_at: null, skills: {} };
}

// ---------------------------------------------------------------------------
// Candidates and retirement.
// ---------------------------------------------------------------------------

test("buildCandidates joins the skill with its ledger counters", (t) => {
	const store = tempStore(t);
	store.create({ name: "old-skill", description: "Old.", scope: "general", body: "## How\n\nx\n", metadata: { created_at: daysAgo(60) } });
	const ledger = emptyLedger();
	ledger.skills["old-skill"] = { use_count: 3, last_used_at: daysAgo(50) };

	const [candidate] = buildCandidates(store, ledger, NOW);
	assert.equal(candidate.name, "old-skill");
	assert.equal(candidate.scope, "general");
	assert.equal(candidate.useCount, 3);
	assert.ok(Math.round(candidate.ageDays) === 60);
	assert.ok(Math.round(candidate.idleDays) === 50);
	assert.equal(candidate.pinned, false);
});

test("retirement exempts pinned and young skills, and targets idle ones", (t) => {
	const store = tempStore(t);
	store.create({ name: "idle-skill", description: "Idle.", scope: "general", body: "## How\n\nx\n", metadata: { created_at: daysAgo(60) } });
	store.create({ name: "young-skill", description: "Young.", scope: "general", body: "## How\n\nx\n", metadata: { created_at: daysAgo(2) } });
	store.create({ name: "pinned-skill", description: "Pinned.", scope: "general", body: "## How\n\nx\n", metadata: { created_at: daysAgo(60), pinned: true } });

	const candidates = buildCandidates(store, emptyLedger(), NOW);
	const retired = retirementCandidates(candidates, { disuseWeeks: 6 }).map((candidate) => candidate.name);
	assert.deepEqual(retired, ["idle-skill"], "young and pinned are exempt, idle is not");
});

test("a recent use resets the disuse clock", (t) => {
	const store = tempStore(t);
	store.create({ name: "used-skill", description: "Used.", scope: "general", body: "## How\n\nx\n", metadata: { created_at: daysAgo(60) } });
	const ledger = emptyLedger();
	ledger.skills["used-skill"] = { use_count: 1, last_used_at: daysAgo(1) };
	assert.deepEqual(retirementCandidates(buildCandidates(store, ledger, NOW), { disuseWeeks: 6 }), []);
});

// ---------------------------------------------------------------------------
// Cadence.
// ---------------------------------------------------------------------------

test("curation is not due until something has been learned", () => {
	assert.equal(isCurationDue({ lastCurateAt: null, activeCount: 0, config: makeConfig(), now: NOW }).due, false);
});

test("curation is due on the first run with a library, on size, or on interval", () => {
	assert.equal(isCurationDue({ lastCurateAt: null, activeCount: 3, config: makeConfig(), now: NOW }).due, true);
	assert.equal(isCurationDue({ lastCurateAt: daysAgo(1), activeCount: 30, config: makeConfig(), now: NOW }).due, true);
	assert.equal(isCurationDue({ lastCurateAt: daysAgo(30), activeCount: 3, config: makeConfig(), now: NOW }).due, true);
	assert.equal(isCurationDue({ lastCurateAt: daysAgo(1), activeCount: 3, config: makeConfig(), now: NOW }).due, false);
});

// ---------------------------------------------------------------------------
// Prompt and report.
// ---------------------------------------------------------------------------

test("the curator prompt shows the catalog, pins, human names and the mode", () => {
	const prompt = buildCuratorPrompt({
		candidates: [
			{ name: "alpha", scope: "general", description: "Alpha.", pinned: false, useCount: 2, readCount: 1, ageDays: 10, idleDays: 3 },
			{ name: "beta", scope: "general", description: "Beta.", pinned: true, useCount: 0, readCount: 0, ageDays: 40, idleDays: 40 },
			{ name: "gamma", scope: "github.com/acme/app", description: "Gamma.", pinned: false, useCount: 5, readCount: 2, ageDays: 5, idleDays: 1 },
		],
		humanTier: ["tdd", "code-review"],
		mode: "observe",
	});

	assert.match(prompt, /### Scope general/);
	assert.match(prompt, /### Scope github\.com\/acme\/app/);
	assert.match(prompt, /alpha \(2 uses, idle 3d; age 10d\)/);
	assert.match(prompt, /beta \[PINNED\] \(never used/);
	assert.match(prompt, /human-authored tier: tdd, code-review/);
	assert.match(prompt, /observe-only/);
	assert.match(prompt, /Never merge across scopes/);
});

test("the curation report records the before/after delta and retirement", () => {
	const report = buildCurationReport({
		at: "2026-09-14T12:00:00.000Z",
		mode: "write",
		model: "small/model",
		dueReason: "30 days since the last curation",
		beforeCount: 5,
		afterCount: 3,
		retired: ["stale-a", "stale-b"],
		created: 1,
		proposed: 0,
		patched: 2,
		archived: 3,
		hardHits: 0,
		snapshotDir: "/store/reports/x/snapshots",
	});
	assert.match(report, /- before: 5 active/);
	assert.match(report, /- after: 3 active/);
	assert.match(report, /## Retired for disuse\n\n- stale-a\n- stale-b/);
	assert.match(report, /Snapshots: \/store\/reports\/x\/snapshots/);
	assert.match(report, /- patched: 2/);
});

// ---------------------------------------------------------------------------
// Curation ownership (RSI x RLM ticket 11): it is a library-wide operation, so a child
// never curates whatever the library looks like.
// ---------------------------------------------------------------------------

test("a child never curates, however overdue the library is", () => {
	const input = {
		lastCurateAt: null,
		activeCount: 400,
		config: { consolidateEveryWeeks: 4, maxActiveSkills: 25 },
		now: Date.parse("2026-09-18T00:00:00.000Z"),
	};
	assert.equal(curationDueForSession({ ...input, isChild: false }), true, "the control: a root is due");
	assert.equal(curationDueForSession({ ...input, isChild: true }), false, "a child is never due");
});

test("a root is not due on a small, recently curated library", () => {
	const now = Date.parse("2026-09-18T00:00:00.000Z");
	assert.equal(curationDueForSession({
		isChild: false,
		lastCurateAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
		activeCount: 3,
		config: { consolidateEveryWeeks: 4, maxActiveSkills: 25 },
		now,
	}), false);
});
