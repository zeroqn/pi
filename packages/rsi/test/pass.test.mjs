import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, emptyTally, formatPassNotification, tallyChanged } from "../pass.ts";

const hit = { path: "SKILL.md", kind: "hard", label: "assigned secret", excerpt: "api_key = ..." };

test("nothing changed means no notification at all", () => {
	assert.equal(formatPassNotification(emptyTally()), undefined);
	assert.equal(tallyChanged(emptyTally()), 0);
});

test("a changed pass produces one summary line", () => {
	const tally = { ...emptyTally(), created: 2, proposed: 1 };
	const notification = formatPassNotification(tally);
	assert.deepEqual(notification, { line: "rsi: +2 skills, 1 proposal", type: "info" });
	assert.equal(tallyChanged(tally), 3);
});

test("singular counts read correctly", () => {
	assert.deepEqual(formatPassNotification({ ...emptyTally(), created: 1 }), { line: "rsi: +1 skill", type: "info" });
});

test("a hard scan hit surfaces immediately and outranks the summary", () => {
	const notification = formatPassNotification({ ...emptyTally(), created: 1, hardHits: [hit, { ...hit, label: "instruction override" }] });
	assert.equal(notification.type, "error");
	assert.match(notification.line, /content scan rejected 2 item/);
	assert.match(notification.line, /assigned secret, instruction override/);
});

test("a failed pass reports the error", () => {
	assert.deepEqual(formatPassNotification({ ...emptyTally(), error: "provider unavailable" }), {
		line: "rsi: pass failed (provider unavailable)",
		type: "error",
	});
});

test("the report records metadata, the histogram and scan hits", () => {
	const report = buildReport({ ...emptyTally(), created: 1, proposed: 2, hardHits: [hit] }, {
		at: "2026-09-14T12:00:00.000Z",
		reason: "settled",
		scope: "general",
		mode: "observe",
		model: "small/model",
	});
	assert.match(report, /# RSI pass report/);
	assert.match(report, /- trigger: settled/);
	assert.match(report, /- model: small\/model/);
	assert.match(report, /- created: 1/);
	assert.match(report, /- proposed: 2/);
	assert.match(report, /## Content scan hits/);
	assert.match(report, /assigned secret/);
});
