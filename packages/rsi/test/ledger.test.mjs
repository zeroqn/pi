import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { ensureLedger, ledgerPath, readLedger, writeLedger } from "../ledger.ts";

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
