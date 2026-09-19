import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { SkillStore } from "../store.ts";
import { bashReadCandidates, formatStatus, summarizeStatus, UsageTracker } from "../telemetry.ts";

function tempStore(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-telemetry-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return new SkillStore({ root });
}

function makeSkill(store, name, options = {}) {
	const result = store.create({
		name,
		description: `${name} description`,
		scope: options.scope ?? "general",
		body: `## How\n\nDo ${name}.\n`,
		files: options.files,
	});
	assert.equal(result.ok, true, result.ok ? "" : result.reason);
	return result.skill;
}

function emptyLedger() {
	return { schema_version: 1, last_pass_at: null, skills: {} };
}

// ---------------------------------------------------------------------------
// Reads — reading a file inside a learned skill directory is usage.
// ---------------------------------------------------------------------------

test("a read inside a learned skill counts once per turn", (t) => {
	const store = tempStore(t);
	const skill = makeSkill(store, "some-skill");
	const tracker = new UsageTracker(store);
	const file = path.join(skill.dir, "SKILL.md");

	tracker.beginRun();
	const first = tracker.noteRead(file);
	assert.equal(first.skill, "some-skill");
	assert.equal(first.kind, "read");
	assert.equal(first.scope, "general");

	assert.equal(tracker.noteRead(file), undefined, "same turn is deduped");
	assert.equal(tracker.noteRead(path.join(skill.dir, "SKILL.md")), undefined);

	// The first turn keeps the pre-turn expansion window; the next clears it.
	tracker.beginTurn();
	assert.equal(tracker.noteRead(file), undefined);
	tracker.beginTurn();
	assert.equal(tracker.noteRead(file).kind, "read");
});

test("a read of a payload file also counts, and reads outside the store do not", (t) => {
	const store = tempStore(t);
	const skill = makeSkill(store, "script-skill", { files: [{ path: "scripts/run.sh", content: "x" }] });
	const tracker = new UsageTracker(store);
	tracker.beginRun();

	assert.equal(tracker.noteRead(path.join(skill.dir, "scripts", "run.sh")).skill, "script-skill");
	tracker.beginTurn();
	assert.equal(tracker.noteRead("/etc/passwd"), undefined);
	assert.equal(tracker.noteRead(path.join(store.root, "index.json")), undefined);
});

test("a project-scoped skill resolves with its project key", (t) => {
	const store = tempStore(t);
	const skill = makeSkill(store, "app-skill", { scope: { project: "github.com/acme/app" } });
	const tracker = new UsageTracker(store);
	tracker.beginRun();
	assert.equal(tracker.noteRead(path.join(skill.dir, "SKILL.md")).scope, "github.com/acme/app");
});

// ---------------------------------------------------------------------------
// Expansions — a /skill:name block is usage, and dedupes against a read of the
// same skill in the following turn.
// ---------------------------------------------------------------------------

test("an expansion counts and dedupes against the first turn's read", (t) => {
	const store = tempStore(t);
	const skill = makeSkill(store, "expanded-skill");
	const tracker = new UsageTracker(store);
	const file = path.join(skill.dir, "SKILL.md");

	tracker.beginRun();
	const expansion = tracker.noteExpansion(skill.name, file);
	assert.equal(expansion.kind, "expansion");
	assert.equal(expansion.skill, "expanded-skill");

	tracker.beginTurn();
	assert.equal(tracker.noteRead(file), undefined, "the expansion and the first turn are one consulting act");
});

test("an expansion resolves by location when the name is not a learned skill", (t) => {
	const store = tempStore(t);
	const skill = makeSkill(store, "located-skill");
	const tracker = new UsageTracker(store);
	tracker.beginRun();
	assert.equal(tracker.noteExpansion("some-human-skill", path.join(skill.dir, "SKILL.md")).skill, "located-skill");
	tracker.beginTurn();
	assert.equal(tracker.noteExpansion("unknown", "/nowhere/SKILL.md"), undefined);
});

// ---------------------------------------------------------------------------
// Bash fallback — conservative path extraction, for when read is unavailable.
// ---------------------------------------------------------------------------

test("bashReadCandidates extracts paths only from read-like commands", () => {
	assert.deepEqual(bashReadCandidates("cat /x/SKILL.md"), ["/x/SKILL.md"]);
	assert.deepEqual(bashReadCandidates("rtk read /x/SKILL.md --max-lines 20"), ["/x/SKILL.md"]);
	assert.deepEqual(bashReadCandidates("head -20 /x/SKILL.md"), ["/x/SKILL.md"]);
	assert.deepEqual(bashReadCandidates("grep -n when '/x/y/SKILL.md'"), ["/x/y/SKILL.md"]);
	assert.deepEqual(bashReadCandidates("cat a | head -1"), []);
	assert.deepEqual(bashReadCandidates("rm /x/SKILL.md"), []);
	assert.deepEqual(bashReadCandidates("echo /x/SKILL.md"), []);
	assert.deepEqual(bashReadCandidates(""), []);
});

// ---------------------------------------------------------------------------
// Status counters — skills, uses and skills never used.
// ---------------------------------------------------------------------------

test("summarizeStatus counts skills, uses and never-used skills", (t) => {
	const store = tempStore(t);
	makeSkill(store, "used-skill");
	makeSkill(store, "idle-skill");
	const ledger = emptyLedger();
	ledger.skills["used-skill"] = { use_count: 3, read_count: 2 };
	ledger.skills["archived-gone"] = { use_count: 4 };

	const summary = summarizeStatus(store, ledger);
	assert.equal(summary.skills, 2);
	assert.equal(summary.uses, 7);
	assert.equal(summary.neverUsed, 1);
});

test("formatStatus omits the delta on a first look and shows it afterwards", () => {
	const view = {
		counts: { skills: 3, uses: 9, neverUsed: 1 },
		enabled: true,
		observeOnly: true,
		lastPassAt: null,
		proposals: 0,
		storePath: "/tmp/rsi",
	};

	const first = formatStatus(view);
	assert.match(first, /^rsi: 3 skills, 9 uses \(1 never used\)/);
	assert.doesNotMatch(first, /since last look/);
	assert.match(first, /mode: enabled, observe-only/);
	assert.match(first, /last pass: never/);

	const second = formatStatus({ ...view, previous: { skills: 1, uses: 4, neverUsed: 2 } });
	assert.match(second, /since last look: \+2 skills, \+5 uses, -1 never used/);

	const disabled = formatStatus({ ...view, enabled: false, observeOnly: false, lastPassAt: "2026-09-14T00:00:00.000Z" });
	assert.match(disabled, /mode: disabled, write/);
	assert.match(disabled, /last pass: 2026-09-14T00:00:00.000Z/);
});
