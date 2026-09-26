/**
 * The port's own contract (`.scratch/ask-user-question` ticket 02).
 *
 * Upstream's tests prove the questionnaire; these prove the seam between it and a Python cell: what the
 * cell may pass, what comes back, and what happens when either side is wrong. They need no pi/ctx mock —
 * every function here is pure, or takes a plain object standing in for a context.
 */
import { describe, expect, it } from "bun:test";

import {
	askUserQuestionProse,
	canRenderQuestionnaire,
	createAskUserQuestionHost,
	DEFAULT_DESCRIPTION,
	DEFAULT_PROMPT_GUIDELINES,
	projectResult,
	validateParams,
} from "./ask-user-question.js";
import {
	COLLAPSE_KEY_OFF,
	configPathFor,
	DEFAULT_COLLAPSE_KEY,
	formatKeySpecForDisplay,
	loadConfig,
	resolveCollapseKey,
	stripJsonc,
} from "./config.js";
import { fromMonty } from "./tool/from-monty.js";
import type { QuestionnaireResult } from "./tool/types.js";
import { makeQuestion } from "./test/test-fixtures.js";

const question = () => ({
	question: "Which storage engine?",
	header: "Storage",
	options: [
		{ label: "SQLite", description: "One file, no server." },
		{ label: "Postgres", description: "A real server." },
	],
});

/** The name monty maps onto a Python exception, which is what the cell actually sees. */
function errorName(run: () => unknown): string {
	try {
		run();
	} catch (error) {
		return (error as Error).name;
	}
	return "(no error)";
}

describe("validateParams — what a cell may pass", () => {
	it("accepts the schema verbatim, camelCase included", () => {
		const typed = validateParams([{ ...question(), multiSelect: true }]);
		expect(typed.questions[0]!.multiSelect).toBe(true);
	});

	it("accepts multi_select as an alias for multiSelect", () => {
		const typed = validateParams([{ ...question(), multi_select: true }]);
		expect(typed.questions[0]!.multiSelect).toBe(true);
	});

	it("refuses both spellings at once rather than guessing", () => {
		const run = () => validateParams([{ ...question(), multiSelect: true, multi_select: false }]);
		expect(errorName(run)).toBe("ValueError");
		expect(run).toThrow(/both "multi_select" and "multiSelect"/);
	});

	it("refuses a misspelled key instead of silently ignoring it", () => {
		// The schema is permissive (`Type.Object` with no `additionalProperties: false`), so without this
		// pass `multiselect` would be dropped and the questionnaire would open single-select.
		const run = () => validateParams([{ ...question(), multiselect: true }]);
		expect(errorName(run)).toBe("ValueError");
		expect(run).toThrow(/unknown key "multiselect"/);
	});

	it("refuses an unknown key on an option, and on the params themselves", async () => {
		const onOption = () =>
			validateParams([{ ...question(), options: [{ label: "A", description: "a", notes: "no" }] }]);
		expect(errorName(onOption)).toBe("ValueError");
		expect(onOption).toThrow(/unknown key "notes" on option 1/);

		// An unknown *parameter* is invisible to `validateParams` (it takes the questions list), so it is
		// checked where the arguments arrive: the host function refuses it before anything renders.
		const host = createAskUserQuestionHost({ ctx: { hasUI: false, mode: "print", ui: {} } as never });
		await expect(host([question()], { context: "extra" })).rejects.toThrow(/unknown parameter "context"/);
	});

	it("runs the schema, so the length limits the runtime validator does not check still apply", () => {
		const longHeader = () => validateParams([{ ...question(), header: "x".repeat(17) }]);
		expect(errorName(longHeader)).toBe("ValueError");

		const tooMany = () => validateParams(Array.from({ length: 5 }, () => question()));
		expect(errorName(tooMany)).toBe("ValueError");
		// The schema's wording, not upstream's: the schema runs first, so its message is the one the cell
		// sees for anything it can already see. Upstream's friendlier messages surface for the checks the
		// schema cannot make — duplicate text, duplicate labels, reserved labels.
		expect(tooMany).toThrow(/more than 4 items/);

		const tooFewOptions = () =>
			validateParams([{ ...question(), options: [{ label: "A", description: "a" }] }]);
		expect(errorName(tooFewOptions)).toBe("ValueError");
		expect(tooFewOptions).toThrow(/fewer than 2 items/);
	});

	it("runs upstream's runtime validator too, reserved labels included", () => {
		const reserved = () =>
			validateParams([
				{
					...question(),
					options: [
						{ label: "Other", description: "d" },
						{ label: "Fine", description: "f" },
					],
				},
			]);
		expect(errorName(reserved)).toBe("ValueError");
		expect(reserved).toThrow(/reserved/);

		const duplicateLabel = () =>
			validateParams([
				{
					...question(),
					options: [
						{ label: "Same", description: "a" },
						{ label: "Same", description: "b" },
					],
				},
			]);
		expect(errorName(duplicateLabel)).toBe("ValueError");
		expect(duplicateLabel).toThrow(/unique within a question/);
	});
});

describe("projectResult — what comes back", () => {
	const params = { questions: [makeQuestion()] };

	it("carries upstream's envelope as text alongside the data", () => {
		const result: QuestionnaireResult = {
			answers: [{ questionIndex: 0, question: "Pick one", kind: "option", answer: "A" }],
			cancelled: false,
		};
		const projected = projectResult(result, params);
		expect(projected.cancelled).toBe(false);
		expect(projected.text).toContain("User has answered your questions:");
		expect(projected.text).toContain('"Pick one"="A"');
		expect(projected.answers).toEqual([
			{
				question_index: 0,
				question: "Pick one",
				kind: "option",
				answer: "A",
				selected: null,
				preview: null,
				notes: null,
			},
		]);
	});

	it("never leaves `answer` null: a multi-select answer reads as its labels", () => {
		const result: QuestionnaireResult = {
			answers: [
				{ questionIndex: 0, question: "Pick some", kind: "multi", answer: null, selected: ["A", "B"] },
			],
			cancelled: false,
		};
		const [first] = projectResult(result, params).answers;
		expect(first!.answer).toBe("A, B");
		expect(first!.selected).toEqual(["A", "B"]);
	});

	it("keeps the partial answers when the user stopped mid-questionnaire", () => {
		const result: QuestionnaireResult = {
			answers: [{ questionIndex: 0, question: "Pick one", kind: "option", answer: "A" }],
			cancelled: true,
		};
		const projected = projectResult(result, params);
		expect(projected.cancelled).toBe(true);
		expect(projected.text).toBe("User declined to answer questions");
		expect(projected.answers).toHaveLength(1);
	});

	it("treats a missing result as a decline rather than as data", () => {
		const projected = projectResult(undefined, params);
		expect(projected.cancelled).toBe(true);
		expect(projected.answers).toEqual([]);
	});
});

describe("canRenderQuestionnaire — where the capability exists", () => {
	const dialogs = { select: () => Promise.resolve(undefined), input: () => Promise.resolve(undefined) };
	const bare = {};

	it("is true on a terminal and on a host with dialog primitives", () => {
		expect(canRenderQuestionnaire({ hasUI: true, mode: "tui", ui: bare } as never)).toBe(true);
		expect(canRenderQuestionnaire({ hasUI: true, mode: "rpc", ui: dialogs } as never)).toBe(true);
	});

	it("is false without a UI, and on a host with neither custom UI nor dialogs", () => {
		expect(canRenderQuestionnaire({ hasUI: false, mode: "print", ui: bare } as never)).toBe(false);
		expect(canRenderQuestionnaire({ hasUI: true, mode: "rpc", ui: bare } as never)).toBe(false);
	});
});

describe("the contributed prose", () => {
	it("is the cell-shaped default, and its guidelines name the host-function shape", () => {
		const prose = askUserQuestionProse();
		expect(prose.description).toBe(DEFAULT_DESCRIPTION);
		expect(prose.promptGuidelines).toBe(DEFAULT_PROMPT_GUIDELINES);
		expect(prose.description).toContain("await ask_user_question(questions=[…])");
		expect(prose.promptSnippet).toContain("ask_user_question");
	});

	it("takes per-field overrides from the config", () => {
		const prose = askUserQuestionProse({ guidance: { description: "mine", promptGuidelines: ["one"] } });
		expect(prose.description).toBe("mine");
		expect(prose.promptGuidelines).toEqual(["one"]);
		// Untouched fields keep their defaults.
		expect(prose.promptSnippet).toContain("structured questions");
	});
});

describe("config", () => {
	it("reads JSONC, comments and trailing commas included", () => {
		const raw = `{
			// the key that hides the dialog
			"collapseKey": "alt+o",
			"guidance": { "description": "hi", },
		}`;
		expect(JSON.parse(stripJsonc(raw))).toEqual({
			collapseKey: "alt+o",
			guidance: { description: "hi" },
		});
	});

	it("leaves the default alone when the file is missing, and warns when it is malformed", () => {
		const missing = loadConfig("/nonexistent-agent-dir");
		expect(missing.config).toEqual({});
		expect(missing.warnings).toEqual([]);

		const dir = `${process.env["TMPDIR"] ?? "/tmp"}/pi-auq-config-${process.pid}`;
		const file = configPathFor(dir);
		require("node:fs").mkdirSync(require("node:path").dirname(file), { recursive: true });
		require("node:fs").writeFileSync(file, '{ "collapseKey": 7, "guidance": "no" }');
		const loaded = loadConfig(dir);
		expect(loaded.config.collapseKey).toBeUndefined();
		expect(loaded.warnings.join(" ")).toContain("collapseKey");
		expect(loaded.warnings.join(" ")).toContain("guidance");
	});

	it("resolves the collapse key: default, a remap, and the off sentinel", () => {
		expect(resolveCollapseKey({})).toBe(DEFAULT_COLLAPSE_KEY);
		expect(resolveCollapseKey({ collapseKey: "alt+o" })).toBe("alt+o");
		expect(resolveCollapseKey({ collapseKey: COLLAPSE_KEY_OFF })).toBe(COLLAPSE_KEY_OFF);
		// A typo must not become a key that silently matches every bare `]`.
		expect(resolveCollapseKey({ collapseKey: "ctr+]" })).toBe(DEFAULT_COLLAPSE_KEY);
		expect(formatKeySpecForDisplay("ctrl+pagedown")).toBe("Ctrl+PageDown");
	});
});

describe("fromMonty — the boundary monty hands us", () => {
	it("turns the Map a Python dict becomes back into a plain object, deeply", () => {
		// The measured shape: `{ questions: [Map{…}] }`, where reading `question["options"]` is undefined and
		// `JSON.stringify(question)` is "{}". See `tool/from-monty.ts`.
		const asMontyDelivers = {
			questions: [
				new Map<string, unknown>([
					["question", "Which storage engine?"],
					[
						"options",
						[
							new Map<string, unknown>([
								["label", "SQLite"],
								["description", "One file, no server."],
							]),
						],
					],
				]),
			],
		};
		expect(fromMonty(asMontyDelivers)).toEqual({
			questions: [
				{
					question: "Which storage engine?",
					options: [{ label: "SQLite", description: "One file, no server." }],
				},
			],
		});
	});

	it("passes primitives, arrays and Buffers through", () => {
		const buffer = Buffer.from("x");
		expect(fromMonty("a")).toBe("a");
		expect(fromMonty(1)).toBe(1);
		expect(fromMonty(null)).toBe(null);
		expect(fromMonty([1, new Map([["a", 2]])])).toEqual([1, { a: 2 }]);
		expect(fromMonty(buffer)).toBe(buffer);
	});
});
