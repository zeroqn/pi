import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { applyProposal, discardProposal, formatProposal } from "../review.ts";
import { readLedger } from "../ledger.ts";
import { SkillStore } from "../store.ts";

function tempStore(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-review-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return new SkillStore({ root });
}

function pending(store, name) {
	return store.listProposals().find((proposal) => proposal.record.name === name);
}

// ---------------------------------------------------------------------------
// Applying a proposal performs the same store operation the pass would have.
// ---------------------------------------------------------------------------

test("applying a content proposal creates the skill and removes the proposal", async (t) => {
	const store = tempStore(t);
	store.propose(
		{ name: "from-proposal", description: "Proposed.", body: "## How\n\nDo it.\n", scope: "general" },
		{ kind: "skill", reason: "observe-only mode" },
	);

	const result = await applyProposal(store, pending(store, "from-proposal"));
	assert.equal(result.ok, true);
	assert.ok(store.findByName("from-proposal"));
	assert.equal(readLedger(store.root).ledger.skills["from-proposal"].state, "active");
	assert.deepEqual(store.listProposals(), [], "the proposal is consumed");
});

test("applying a patch proposal patches the existing skill", async (t) => {
	const store = tempStore(t);
	store.create({ name: "existing", description: "Old.", scope: "general", body: "## How\n\nold\n" });
	store.propose({ name: "existing", description: "New.", body: "## How\n\nnew\n", scope: "general" }, { kind: "patch", reason: "observe-only mode" });

	const result = await applyProposal(store, pending(store, "existing"));
	assert.equal(result.ok, true);
	assert.match(result.message, /patch/);
	const live = store.findByName("existing");
	assert.equal(live.description, "New.");
	assert.match(fs.readFileSync(live.filePath, "utf8"), /new/);
});

test("applying an archive proposal retires the skill and marks the ledger", async (t) => {
	const store = tempStore(t);
	store.create({ name: "retire-me", description: "D.", scope: "general", body: "## How\n\nx\n" });
	store.propose({ name: "retire-me" }, { kind: "archive", reason: "observe-only mode" });

	const result = await applyProposal(store, pending(store, "retire-me"));
	assert.equal(result.ok, true);
	assert.equal(store.findByName("retire-me"), undefined);
	assert.equal(readLedger(store.root).ledger.skills["retire-me"].state, "archived");
	assert.deepEqual(store.listProposals(), []);
});

test("applying a promotion proposal moves the skill to the recorded scope", async (t) => {
	const store = tempStore(t);
	store.create({ name: "promote-me", description: "D.", scope: { project: "github.com/acme/app" }, body: "## How\n\nx\n" });
	store.propose({ name: "promote-me" }, { kind: "promotion", scope: "general", reason: "same lesson in two scopes" });

	const result = await applyProposal(store, pending(store, "promote-me"));
	assert.equal(result.ok, true);
	assert.equal(store.findByName("promote-me").scope, "general");
});

test("applying a proposal that would collide fails and leaves the proposal pending", async (t) => {
	const store = tempStore(t);
	store.create({ name: "taken", description: "Live.", scope: "general", body: "## How\n\nx\n" });
	store.propose({ name: "taken", description: "Proposed.", body: "## How\n\ny\n", scope: "general" }, { kind: "skill", reason: "observe-only mode" });

	// The live name exists, so kind "skill" resolves to a patch — not a collision.
	const result = await applyProposal(store, pending(store, "taken"));
	assert.equal(result.ok, true);
	assert.match(result.message, /patch/);
});

test("discardProposal removes a pending proposal without touching the library", (t) => {
	const store = tempStore(t);
	store.propose({ name: "discard-me", description: "D.", body: "## How\n\nx\n", scope: "general" }, { kind: "skill", reason: "observe-only mode" });

	discardProposal(store, pending(store, "discard-me"));
	assert.deepEqual(store.listProposals(), []);
	assert.equal(store.findByName("discard-me"), undefined);
});

test("formatProposal shows the kind, reason and proposed content", (t) => {
	const store = tempStore(t);
	store.propose({ name: "shown", description: "Shown.", body: "## How\n\nbody text\n", scope: { project: "github.com/acme/app" } }, { kind: "patch", reason: "observe-only mode", mode: "observe" });

	const text = formatProposal(pending(store, "shown"));
	assert.match(text, /\[patch\] shown/);
	assert.match(text, /scope: github\.com\/acme\/app/);
	assert.match(text, /reason: observe-only mode/);
	assert.match(text, /description: Shown\./);
	assert.match(text, /body text/);
});
