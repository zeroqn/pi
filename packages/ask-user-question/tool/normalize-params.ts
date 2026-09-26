import type { QuestionParams } from "./types.js";

/**
 * Normalize line terminators in one model-supplied text field (#192).
 *
 * Some models serialize a bare carriage return inside tool-call string
 * arguments at token boundaries where the text was meant to be contiguous
 * (`GEMBA\r_LOG\r_FILE` for `GEMBA_LOG_FILE`). A raw CR is a cursor-control
 * byte, not text: pi-tui ≤0.80 writes it straight into the row, so the
 * terminal returns to column 0 and later text overwrites the pointer and
 * number; pi-tui ≥0.84 splits `wrapTextWithAnsi` on `\r`, so one option
 * fragments into stacked rows. Both symptoms have the same fix at our
 * boundary:
 *
 * - `\r\n` → `\n` keeps genuine multi-line content (preview markdown) intact.
 * - a lone `\r` is deleted — never a space (phantom gaps inside words) and
 *   never `\n` (reintroduces the vertical fragmentation). This matches
 *   pi-coding-agent's own display normalization (`normalizeDisplayText`).
 */
export function normalizeLineTerminators(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "");
}

/**
 * Copy `obj`, normalizing the listed keys that hold strings. Keys absent from
 * `obj` (e.g. an omitted `preview`) stay absent so `"preview" in option`
 * checks and `hasPreview` derivations are unchanged.
 */
function normalizeStringFields<T extends object>(obj: T, keys: readonly (keyof T)[]): T {
	const out = { ...obj };
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === "string") out[key] = normalizeLineTerminators(value) as T[typeof key];
	}
	return out;
}

/**
 * Return a copy of the tool params with every user-facing string field
 * (`question`, `header`, `options[].label`, `options[].description`,
 * `options[].preview`) line-terminator-normalized. Runs once at tool entry,
 * BEFORE `validateQuestionnaire`, so the reserved-label and duplicate-label
 * guards compare the text the user will actually see (`"Other\r"` must not
 * slip past `reserved_label`), and so the TUI, the RPC dialog walker, the
 * envelope echo, and the prompt payload all carry the same clean text. Pure:
 * the input object is never mutated.
 */
export function normalizeQuestionParams(params: QuestionParams): QuestionParams {
	return {
		...params,
		questions: params.questions.map((q) => ({
			...normalizeStringFields(q, ["question", "header"]),
			options: q.options.map((o) => normalizeStringFields(o, ["label", "description", "preview"])),
		})),
	};
}

// ---------------------------------------------------------------------------------------------
// The port's own additions: one alias, and a strictness the copy cannot supply.
// ---------------------------------------------------------------------------------------------

/** The one multi-word key in the schema, in the spelling a Python author reaches for first. */
const KEY_ALIASES: Record<string, string> = { multi_select: "multiSelect" };

const QUESTION_KEYS = new Set(["question", "header", "options", "multiSelect"]);
const OPTION_KEYS = new Set(["label", "description", "preview"]);

/**
 * A `ValueError` in the cell. monty maps a thrown JS error onto a Python exception **by `.name`**
 * (`@pydantic/monty` `dist/session.js`), which is how code mode's own guard raises `PermissionError`.
 */
export function valueError(message: string): Error {
	const error = new Error(message);
	error.name = "ValueError";
	return error;
}

/**
 * Rename aliased keys and refuse keys the schema does not know.
 *
 * The schema is permissive by construction — `Type.Object` with no `additionalProperties: false`
 * (`tool/types.ts`) — so `multiSelect` misspelled as `multiselect` would be *ignored*, and a questionnaire
 * the model asked to be multi-select would quietly open as single-select. Two rules fix that, and they
 * are the port's, not the copy's (`.scratch/ask-user-question` ticket 02):
 *
 *  - `multi_select` is accepted, because it is what a Python author types;
 *  - anything else unknown is a `ValueError` naming the key, so the mistake lands on the first attempt.
 *
 * Runs before `normalizeQuestionParams`, so the alias is in place before anything reads it.
 */
export function normalizeParamKeys(input: unknown): unknown[] {
	if (!Array.isArray(input)) {
		throw valueError("Error: questions must be a list of question objects");
	}
	const questions = input;

	const mapped = questions.map((raw, index) => {
		if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
			throw valueError(`Error: question ${index + 1} must be an object`);
		}
		const question = { ...(raw as Record<string, unknown>) };
		for (const [alias, canonical] of Object.entries(KEY_ALIASES)) {
			if (alias in question) {
				if (canonical in question) {
					throw valueError(`Error: question ${index + 1} sets both "${alias}" and "${canonical}"`);
				}
				question[canonical] = question[alias];
				delete question[alias];
			}
		}
		for (const key of Object.keys(question)) {
			if (!QUESTION_KEYS.has(key)) {
				throw valueError(`Error: unknown key "${key}" on question ${index + 1}`);
			}
		}
		if (Array.isArray(question["options"])) {
			question["options"] = (question["options"] as unknown[]).map((option, optionIndex) => {
				if (typeof option !== "object" || option === null || Array.isArray(option)) {
					throw valueError(`Error: option ${optionIndex + 1} of question ${index + 1} must be an object`);
				}
				for (const key of Object.keys(option as Record<string, unknown>)) {
					if (!OPTION_KEYS.has(key)) {
						throw valueError(`Error: unknown key "${key}" on option ${optionIndex + 1} of question ${index + 1}`);
					}
				}
				return option;
			});
		}
		return question;
	});

	return mapped;
}
