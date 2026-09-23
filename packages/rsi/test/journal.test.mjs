import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { buildJournalDigest, journalPathFor, kernelActivity, readJournal } from "../journal.ts";

function tempDir(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-journal-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function cell(index, overrides = {}) {
	return {
		index,
		code: `print(${index})`,
		hostCalls: [],
		durationMs: 100,
		at: "2026-09-18T00:00:00.000Z",
		...overrides,
	};
}

function writeJournal(dir, records, name = "session.jsonl.rlm-journal.jsonl") {
	const file = path.join(dir, name);
	fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
	return file;
}

test("journalPathFor derives RLM's path from a session file", () => {
	assert.equal(journalPathFor("/tmp/s.jsonl"), "/tmp/s.jsonl.rlm-journal.jsonl");
	assert.equal(journalPathFor(undefined), undefined);
	assert.equal(journalPathFor(""), undefined);
});

test("a missing journal is no records, not an error", (t) => {
	const dir = tempDir(t);
	assert.deepEqual(readJournal(path.join(dir, "nope.jsonl")), []);
	assert.deepEqual(readJournal(undefined), []);
});

test("a torn line is skipped and the rest of the journal survives", (t) => {
	const dir = tempDir(t);
	const file = path.join(dir, "s.jsonl.rlm-journal.jsonl");
	fs.writeFileSync(file, `${JSON.stringify(cell(0))}\n{"index":1,"code":"half\n${JSON.stringify(cell(2))}\n`);
	const records = readJournal(file);
	assert.deepEqual(records.map((r) => r.index), [0, 2]);
});

test("records come back in cell order, whatever order they were written", (t) => {
	const dir = tempDir(t);
	const file = writeJournal(dir, [cell(2), cell(0), cell(1)]);
	assert.deepEqual(readJournal(file).map((r) => r.index), [0, 1, 2]);
});

// ---------------------------------------------------------------------------
// Activity — the code-mode replacement for "5+ pi tool calls".
// ---------------------------------------------------------------------------

test("kernelActivity counts cells and host calls", () => {
	const activity = kernelActivity([
		cell(0, { hostCalls: [{ name: "bash_host", args: ["ls"], result: { exit_code: 0 } }] }),
		cell(1, { hostCalls: [{ name: "bash_host", args: ["cat x"], result: { exit_code: 0 } }, { name: "find", args: [], result: {} }] }),
	]);
	assert.equal(activity.cells, 2);
	assert.equal(activity.hostCalls, 3);
	assert.equal(activity.errorThenSuccess, false);
});

test("kernelActivity sees an error followed by a success to the same host function", () => {
	const activity = kernelActivity([
		cell(0, { hostCalls: [{ name: "bash_host", args: ["cat nope"], result: { exit_code: 1, stderr: "no such file" } }] }),
		cell(1, { hostCalls: [{ name: "bash_host", args: ["cat yes"], result: { exit_code: 0 } }] }),
	]);
	assert.equal(activity.errorThenSuccess, true);
});

test("a failure with no later success is not error-then-success", () => {
	const activity = kernelActivity([
		cell(0, { hostCalls: [{ name: "bash_host", args: ["cat nope"], result: { exit_code: 1 } }] }),
	]);
	assert.equal(activity.errorThenSuccess, false);
});

test("a cell that ran no code and made no call is not a cell", () => {
	assert.equal(kernelActivity([cell(0, { code: "  " })]).cells, 0);
});

// ---------------------------------------------------------------------------
// The digest — kernel-side evidence for a session whose pi tools say nothing.
// ---------------------------------------------------------------------------

test("no records means no digest section, so the pi-tool digest stands alone", () => {
	assert.equal(buildJournalDigest([]), undefined);
});

test("the digest reports cells, host calls and the commands they ran", () => {
	const digest = buildJournalDigest([
		cell(0, { hostCalls: [{ name: "bash_host", args: ["ls /workspace"], result: { exit_code: 0 } }] }),
		cell(1, { hostCalls: [{ name: "bash_host", args: ["cat package.json"], result: { exit_code: 0 } }] }),
	]);
	assert.ok(digest);
	assert.match(digest, /Kernel cells: 2/);
	assert.match(digest, /Kernel host calls: 2/);
	assert.match(digest, /## Commands run in the kernel/);
	assert.match(digest, /- ls \/workspace/);
	assert.match(digest, /- cat package\.json/);
});

test("the digest names a failed bash call with its exit code", () => {
	const digest = buildJournalDigest([
		cell(0, { hostCalls: [{ name: "bash_host", args: ["cat nope"], result: { exit_code: 2, stderr: "no such file\n" } }] }),
	]);
	assert.ok(digest);
	assert.match(digest, /## Kernel errors/);
	assert.match(digest, /exit 2: no such file/);
});

test("the digest lists the learned skills consulted, which is evidence the ledger shares", () => {
	const digest = buildJournalDigest([
		cell(0, { hostCalls: [{ name: "skill_host", args: ["monty-python-subset"], result: { content: "..." } }] }),
	]);
	assert.ok(digest);
	assert.match(digest, /## Learned skills consulted/);
	assert.match(digest, /- monty-python-subset/);
});

test("the digest carries the cell code, because in-kernel file writes are invisible otherwise", () => {
	const digest = buildJournalDigest([cell(0, { code: "write_text('a.txt', 'hello')" })]);
	assert.ok(digest);
	assert.match(digest, /record of intent for in-kernel file writes/);
	assert.match(digest, /# cell 0/);
	assert.match(digest, /write_text\('a\.txt', 'hello'\)/);
});

test("the digest stays bounded when a session ran many cells", () => {
	const many = Array.from({ length: 200 }, (_, index) => cell(index, { code: `x = ${index}\n`.repeat(50) }));
	const digest = buildJournalDigest(many);
	assert.ok(digest);
	assert.ok(digest.length < 12_000, `digest was ${digest.length} chars`);
	assert.match(digest, /omitted for length/);
});

test("long output in a command is excerpted rather than dumped", () => {
	const long = `echo ${"x".repeat(5_000)}`;
	const digest = buildJournalDigest([cell(0, { hostCalls: [{ name: "bash_host", args: [long], result: { exit_code: 0 } }] })]);
	assert.ok(digest);
	assert.ok(!digest.includes("x".repeat(300)));
});

// ---------------------------------------------------------------------------
// Bridged pi tools — the `tool(...)` host call (ticket 12). A bridged call is evidence,
// never a consultation, so it gets a named section and its failures go with bash's.
// ---------------------------------------------------------------------------

test("a successful bridged call renders the pi tool reached and its kwargs", () => {
	const digest = buildJournalDigest([
		cell(0, {
			hostCalls: [
				{ name: "tool", args: ["ctx_search", { query: "how does the drop window work" }], result: "…" },
			],
		}),
	]);
	assert.ok(digest);
	assert.match(digest, /## Bridged pi tools called/);
	assert.match(digest, /- ctx_search \{"query":"how does the drop window work"\}/);
});

test("a bridged call with no kwargs renders as the tool name alone", () => {
	const digest = buildJournalDigest([
		cell(0, { hostCalls: [{ name: "tool", args: ["ctx_search"], result: "…" }] }),
	]);
	assert.ok(digest);
	assert.match(digest, /## Bridged pi tools called\n- ctx_search\n/);
});

test("a bridged refusal renders as 'answered with an error', not as a throw", () => {
	const digest = buildJournalDigest([
		cell(0, {
			hostCalls: [
				{
					name: "tool",
					args: ["ctx_memory", { action: "update", id: 9 }],
					result: "Error: 'ids' must contain exactly one integer memory ID when action is 'update'.",
				},
			],
		}),
	]);
	assert.ok(digest);
	assert.match(digest, /## Kernel errors/);
	assert.match(digest, /tool: ctx_memory answered with an error: Error: 'ids' must contain/);
	assert.doesNotMatch(digest, /threw/);
});

test("a bridged throw renders as 'threw' with the message, never as an answer", () => {
	const digest = buildJournalDigest([
		cell(0, {
			hostCalls: [
				{
					name: "tool",
					args: ["nope", {}],
					error: { name: "NameError", message: "no tool named 'nope'. Nothing is published in this session." },
				},
			],
		}),
	]);
	assert.ok(digest);
	assert.match(digest, /tool: nope threw — no tool named 'nope'\./);
	assert.doesNotMatch(digest, /answered with an error/);
});

test("the bridged section sits between the commands and the skills", () => {
	const digest = buildJournalDigest([
		cell(0, {
			hostCalls: [
				{ name: "bash_host", args: ["ls"], result: { exit_code: 0 } },
				{ name: "tool", args: ["ctx_search", { query: "x" }], result: "…" },
				{ name: "skill_host", args: ["research"], result: { content: "…" } },
			],
		}),
	]);
	assert.ok(digest);
	const commands = digest.indexOf("## Commands run in the kernel");
	const bridged = digest.indexOf("## Bridged pi tools called");
	const skills = digest.indexOf("## Learned skills consulted");
	assert.ok(commands >= 0 && bridged > commands && skills > bridged, digest);
});

test("long bridged arguments are excerpted rather than dumped", () => {
	const digest = buildJournalDigest([
		cell(0, { hostCalls: [{ name: "tool", args: ["ctx_search", { query: "x".repeat(5_000) }], result: "…" }] }),
	]);
	assert.ok(digest);
	assert.ok(!digest.includes("x".repeat(300)));
	assert.match(digest, /\.\.\./);
});

test("a throw the HostCallRecord used to hide is visible to errorThenSuccess", () => {
	const activity = kernelActivity([
		cell(0, {
			hostCalls: [
				{ name: "skill_host", args: ["grilling"], error: { name: "Error", message: 'no learned skill named "grilling"' } },
			],
		}),
		cell(1, { hostCalls: [{ name: "skill_host", args: ["research"], result: { content: "…" } }] }),
	]);
	assert.equal(activity.errorThenSuccess, true);
});

test("a bridged refusal is an answer, so it is not error-then-success", () => {
	const activity = kernelActivity([
		cell(0, { hostCalls: [{ name: "tool", args: ["ctx_memory", {}], result: "Error: no." }] }),
		cell(1, { hostCalls: [{ name: "tool", args: ["ctx_memory", {}], result: "ok" }] }),
	]);
	assert.equal(activity.errorThenSuccess, false);
});

test("a bridged tool call counts toward kernelActivity().hostCalls", () => {
	const activity = kernelActivity([
		cell(0, { hostCalls: [{ name: "tool", args: ["ctx_search", { query: "x" }], result: "…" }] }),
		cell(1, { hostCalls: [{ name: "bash_host", args: ["ls"], result: { exit_code: 0 } }] }),
	]);
	assert.equal(activity.hostCalls, 2);
});
