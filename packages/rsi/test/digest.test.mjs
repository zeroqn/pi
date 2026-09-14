import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDigest } from "../digest.ts";

const assistant = (toolCalls) => ({ role: "assistant", toolCalls });
const result = (toolName, isError, text) => ({ role: "toolResult", toolResult: { toolName, isError, text } });

test("the digest lists changed files, commands, errors and outcomes in order", () => {
	const messages = [
		{ role: "user", text: "fix the parser" },
		assistant([
			{ name: "read", input: { path: "/src/parse.ts" } },
			{ name: "bash", input: { command: "npm test" } },
		]),
		result("bash", true, "Error: 2 tests failed at parse.spec.ts:10. More detail."),
		assistant([{ name: "edit", input: { path: "/src/parse.ts" } }]),
		result("edit", false, ""),
		assistant([{ name: "bash", input: { command: "npm test" } }]),
		result("bash", false, ""),
	];

	const digest = buildDigest(messages);
	assert.match(digest, /Tool calls: 4/);
	assert.match(digest, /## Files changed\n- \/src\/parse\.ts/);
	assert.match(digest, /## Files read\n- \/src\/parse\.ts/);
	assert.match(digest, /## Commands run\n- npm test\n- npm test/);
	assert.match(digest, /## Errors\n- bash: Error: 2 tests failed at parse\.spec\.ts:10\./);
	assert.match(digest, /## Outcomes\n- bash: 1 ok, 1 error\n- edit: 1 ok, 0 error/);
});

test("the digest includes a git diff stat when given one", () => {
	const digest = buildDigest([], { gitStat: " src/a.ts | 2 ++\n 1 file changed" });
	assert.match(digest, /## git diff --stat/);
	assert.match(digest, /src\/a\.ts \| 2 \+\+/);
});

test("an empty session still yields a deterministic digest", () => {
	assert.equal(buildDigest([]), "Tool calls: 0");
});

test("long lists are capped", () => {
	const calls = Array.from({ length: 60 }, (_, i) => assistant([{ name: "read", input: { path: `/f${i}.ts` } }]));
	const digest = buildDigest(calls);
	assert.match(digest, /- \.\.\.and 20 more/);
});
