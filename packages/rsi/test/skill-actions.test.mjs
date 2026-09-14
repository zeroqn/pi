import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { readLedger } from "../ledger.ts";
import { runSkillAction } from "../skill-actions.ts";
import { SkillStore } from "../store.ts";

function tempStore(t, options = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-actions-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return new SkillStore({ root, ...options });
}

function makeDeps(store, overrides = {}) {
	const actions = [];
	const hard = [];
	const deps = {
		store,
		root: store.root,
		scope: "general",
		mode: "write",
		softAttempts: new Map(),
		onAction: (action, name, held) => actions.push({ action, name, held }),
		onHardHit: (hits) => hard.push(...hits),
		...overrides,
	};
	return { deps, actions, hard };
}

const create = (overrides = {}) => ({
	action: "create",
	name: "some-skill",
	description: "Does a useful thing for the manual check.",
	body: "## When this applies\n\nWhenever.\n\n## How\n\nDo it.\n",
	...overrides,
});

// ---------------------------------------------------------------------------
// list / read
// ---------------------------------------------------------------------------

test("list reports an empty store and the library once it has skills", async (t) => {
	const store = tempStore(t);
	const { deps } = makeDeps(store);
	assert.match((await runSkillAction({ action: "list" }, deps)).text, /empty/);

	store.create({ name: "existing-skill", description: "Already here.", scope: "general", body: "## How\n\nx\n" });
	const listed = await runSkillAction({ action: "list" }, deps);
	assert.match(listed.text, /- existing-skill \[general\]: Already here\./);
});

test("read returns the document and rejects an unknown name", async (t) => {
	const store = tempStore(t);
	const { deps } = makeDeps(store);
	store.create({ name: "known-skill", description: "Known.", scope: "general", body: "## How\n\nx\n", files: [{ path: "references/a.md", content: "a" }] });

	const read = await runSkillAction({ action: "read", name: "known-skill" }, deps);
	assert.match(read.text, /name: "known-skill"/);
	assert.match(read.text, /Files shipped: references\/a\.md/);

	const missing = await runSkillAction({ action: "read", name: "nope" }, deps);
	assert.equal(missing.isError, true);
});

// ---------------------------------------------------------------------------
// create — live, obseve-only, script-bearing, scans
// ---------------------------------------------------------------------------

test("create in write mode publishes and records the skill", async (t) => {
	const store = tempStore(t);
	const { deps, actions } = makeDeps(store);

	const result = await runSkillAction(create(), deps);
	assert.equal(result.isError, undefined);
	assert.ok(store.findByName("some-skill"));
	assert.deepEqual(actions, [{ action: "create", name: "some-skill", held: false }]);
	const entry = readLedger(store.root).ledger.skills["some-skill"];
	assert.equal(entry.state, "active");
	assert.equal(entry.scope, "general");
	assert.equal(entry.use_count, undefined, "existing does not count as a use");
});

test("create in observe-only mode becomes a proposal", async (t) => {
	const store = tempStore(t);
	const { deps, actions } = makeDeps(store, { mode: "observe" });

	const result = await runSkillAction(create({ name: "observed-skill" }), deps);
	assert.equal(result.isError, undefined);
	assert.equal(store.findByName("observed-skill"), undefined);
	assert.equal(fs.readdirSync(path.join(store.root, "proposals")).length, 1);
	assert.deepEqual(actions, [{ action: "create", name: "observed-skill", held: true }]);
});

test("a script-bearing skill is held even in write mode", async (t) => {
	const store = tempStore(t);
	const { deps } = makeDeps(store);
	const result = await runSkillAction(create({ name: "script-skill", files: [{ path: "scripts/run.sh", content: "#!/bin/sh\ntrue\n" }] }), deps);
	assert.equal(result.isError, undefined);
	assert.equal(store.findByName("script-skill"), undefined);
	assert.match(result.text, /held as a proposal/);
});

test("a hard scan hit is refused and surfaced", async (t) => {
	const store = tempStore(t);
	const { deps, hard } = makeDeps(store);
	const result = await runSkillAction(create({ name: "leaky-skill", body: "## How\n\nUse api_key = 'abcdefghijklmnopqrstuvwx'.\n" }), deps);

	assert.equal(result.isError, true);
	assert.match(result.text, /refused/);
	assert.equal(store.findByName("leaky-skill"), undefined);
	assert.equal(hard.length, 1);
	assert.equal(hard[0].kind, "hard");
});

test("a soft hit is refused once with a retry, then accepted clean", async (t) => {
	const store = tempStore(t);
	const { deps } = makeDeps(store);
	const dirty = create({ name: "path-skill", body: "## How\n\nRun it from /home/dev/project.\n" });

	const first = await runSkillAction(dirty, deps);
	assert.equal(first.isError, true);
	assert.match(first.text, /retry once/);
	assert.equal(store.findByName("path-skill"), undefined);

	const second = await runSkillAction(create({ name: "path-skill" }), deps);
	assert.equal(second.isError, undefined);
	assert.ok(store.findByName("path-skill"));
});

test("a second soft hit for the same name is final", async (t) => {
	const store = tempStore(t);
	const { deps } = makeDeps(store);
	const dirty = create({ name: "path-skill", body: "## How\n\nRun it from /home/dev/project.\n" });
	await runSkillAction(dirty, deps);
	const result = await runSkillAction(dirty, deps);
	assert.match(result.text, /This was the retry/);
	assert.equal(store.findByName("path-skill"), undefined);
});

test("a name colliding with the human tier is refused", async (t) => {
	const store = tempStore(t, { reservedNames: ["tdd"] });
	const { deps } = makeDeps(store);
	const result = await runSkillAction(create({ name: "tdd" }), deps);
	assert.equal(result.isError, true);
	assert.match(result.text, /human skill tier/);
});

test("an out-of-whitelist payload is held as a proposal rather than refused", async (t) => {
	const store = tempStore(t);
	const { deps, actions } = makeDeps(store);
	const result = await runSkillAction(create({ name: "binary-skill", files: [{ path: "bin/tool", content: "x" }] }), deps);

	assert.equal(result.isError, undefined);
	assert.equal(store.findByName("binary-skill"), undefined);
	assert.match(result.text, /held as a proposal/);
	assert.deepEqual(actions, [{ action: "create", name: "binary-skill", held: true }]);
	const record = JSON.parse(fs.readFileSync(path.join(store.root, "proposals", "binary-skill", "proposal.json"), "utf8"));
	assert.match(record.reason, /out-of-whitelist payload: bin\/tool/);
});

// ---------------------------------------------------------------------------
// propose / patch / archive
// ---------------------------------------------------------------------------

test("the propose action always writes a proposal", async (t) => {
	const store = tempStore(t);
	const { deps } = makeDeps(store);
	const result = await runSkillAction({ action: "propose", name: "human-edit", description: "Improve the human skill.", body: "## How\n\nBetter.\n", reason: "belongs in the human-tier skill" }, deps);
	assert.equal(result.isError, undefined);
	assert.equal(fs.readdirSync(path.join(store.root, "proposals")).length, 1);
});

test("patch updates a skill and archive retires it", async (t) => {
	const store = tempStore(t);
	const { deps, actions } = makeDeps(store);
	store.create({ name: "lifecycle-skill", description: "First.", scope: "general", body: "## How\n\nold\n" });

	const patched = await runSkillAction({ action: "patch", name: "lifecycle-skill", body: "## How\n\nnew\n" }, deps);
	assert.equal(patched.isError, undefined);
	assert.match(fs.readFileSync(store.findByName("lifecycle-skill").filePath, "utf8"), /new/);

	const archived = await runSkillAction({ action: "archive", name: "lifecycle-skill" }, deps);
	assert.equal(archived.isError, undefined);
	assert.equal(store.findByName("lifecycle-skill"), undefined);
	assert.equal(readLedger(store.root).ledger.skills["lifecycle-skill"].state, "archived");
	assert.deepEqual(actions.map((a) => a.action), ["patch", "archive"]);
});

test("observe mode holds patches and archives as proposals instead of applying them", async (t) => {
	const store = tempStore(t);
	const { deps } = makeDeps(store, { mode: "observe" });
	store.create({ name: "observe-lifecycle", description: "First.", scope: "general", body: "## How\n\nold\n" });

	const patched = await runSkillAction({ action: "patch", name: "observe-lifecycle", body: "## How\n\nnew\n" }, deps);
	assert.equal(patched.isError, undefined);
	assert.match(fs.readFileSync(store.findByName("observe-lifecycle").filePath, "utf8"), /old/, "the live skill is untouched");
	const patchRecord = JSON.parse(fs.readFileSync(path.join(store.root, "proposals", "observe-lifecycle", "proposal.json"), "utf8"));
	assert.equal(patchRecord.kind, "patch");
	assert.equal(patchRecord.name, "observe-lifecycle");

	const archived = await runSkillAction({ action: "archive", name: "observe-lifecycle" }, deps);
	assert.equal(archived.isError, undefined);
	assert.ok(store.findByName("observe-lifecycle"), "nothing was moved");
	assert.equal(fs.readdirSync(path.join(store.root, "proposals")).length, 2);
});

test("propose carries its kind and reason", async (t) => {
	const store = tempStore(t);
	const { deps } = makeDeps(store);
	const result = await runSkillAction({ action: "propose", name: "promo", kind: "promotion", reason: "the same lesson in two scopes" }, deps);
	assert.equal(result.isError, undefined);
	const record = JSON.parse(fs.readFileSync(path.join(store.root, "proposals", "promo", "proposal.json"), "utf8"));
	assert.equal(record.kind, "promotion");
	assert.equal(record.reason, "the same lesson in two scopes");
});

test("an unknown action returns usage", async (t) => {
	const store = tempStore(t);
	const { deps } = makeDeps(store);
	const result = await runSkillAction({ action: "explode" }, deps);
	assert.equal(result.isError, true);
	assert.match(result.text, /skill_store actions/);
});
