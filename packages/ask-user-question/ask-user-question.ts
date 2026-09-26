/**
 * The questionnaire, as a **kernel host function**.
 *
 * Upstream this file registers a pi tool: `pi.registerTool({ name: "ask_user_question", … })`, whose
 * `execute` renders the tabbed overlay through `ctx.ui.custom` and hands the model an envelope. The port
 * registers nothing with pi. It exposes one host function that a code-mode cell calls by name —
 * `await ask_user_question(questions=[…])` — which suspends the cell while the questionnaire is on
 * screen and returns a dict (`.scratch/ask-user-question` ticket 02).
 *
 * Everything below the entry point is upstream's, and deliberately so: the overlay call site and its
 * collapse handling, the lazy session load and its pre-warm, the session factory, the external-editor
 * bridge, the dialog walker for hosts without a terminal. What the port changes:
 *
 *  - **the entry point** — `createAskUserQuestionHost({ ctx })` instead of a pi tool registration;
 *  - **the branch** (ticket 04) — an RPC host with dialogs walks the questions, a host that renders
 *    nothing falls back to the walker when it can, and a host with neither raises;
 *  - **strictness** (ticket 02) — unknown keys and a `multi_select` alias, before anything reads them;
 *  - **the result** (ticket 02) — a snake_case dict rather than a tool envelope alone;
 *  - **the failures** (ticket 02) — a malformed questionnaire and a host that cannot render raise, so
 *    the cell cannot mistake "never asked" for "the user said nothing";
 *  - **no events** (ticket 05) — the `rpiv:ask-user:*` emissions are gone with `events.ts`;
 *  - **the prose** (ticket 02) — the description, snippet and guidelines are written for a cell.
 */
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, isKeyRepeat, matchesKey, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";

import {
	COLLAPSE_KEY_OFF,
	formatKeySpecForDisplay,
	resolveCollapseKey,
	type AskUserQuestionConfig,
	type GuidanceFields,
} from "./config.js";
// Static import is fine — rpc-fallback pulls only types + the i18n bridge,
// none of the ~560ms TUI render graph that QuestionnaireSession lazy-loads.
import { hasDialogUI, runRpcQuestionnaire } from "./rpc-fallback.js";
import { displayLabel, t } from "./state/i18n-bridge.js";
import { sentinelsToAppend } from "./state/row-intent.js";
import { fromMonty } from "./tool/from-monty.js";
import { normalizeParamKeys, normalizeQuestionParams, valueError } from "./tool/normalize-params.js";
import { buildQuestionnaireResponse } from "./tool/response-envelope.js";
import { formatAnswerScalar } from "./tool/format-answer.js";
import {
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MIN_OPTIONS,
	type QuestionData,
	type QuestionnaireResult,
	type QuestionParams,
	QuestionParamsSchema,
} from "./tool/types.js";
import { validateQuestionnaire } from "./tool/validate-questionnaire.js";
import type { WrappingSelectItem } from "./view/components/wrapping-select.js";

/** The name a cell calls, and the name read-only mode's exemption list has to carry. */
export const ASK_USER_QUESTION_HOST_FN = "ask_user_question";

/** Standard terminal bell — same byte rpiv-warp exports as OSC_TERMINATOR. */
export const BEL = "\x07";

/**
 * Emit one portable terminal attention signal without touching redirected output.
 * Writes to stdout rather than rpiv-warp's `/dev/tty` transport: the `isTTY` gate
 * both proves an interactive terminal owns the coming wait and keeps the byte out
 * of piped RPC transports (VS Code pendant, Zed) — a `/dev/tty` write would ring
 * even when the questionnaire renders in a remote host's own UI.
 */
function emitTerminalAttention(): void {
	try {
		if (process.stdout.isTTY) process.stdout.write(BEL);
	} catch {
		// Terminal attention is best effort; the questionnaire must still proceed.
	}
}

/** Delay before the background session-graph pre-warm; mirrors rpiv-workflow's /wf prewarm. */
export const PREWARM_DELAY_MS = 2000;

type SessionModule = typeof import("./state/questionnaire-session.js");

type SessionRef = { current: import("./state/questionnaire-session.js").QuestionnaireSession | null };
type OverlayHandleRef = { current: OverlayHandle | undefined };

const ERROR_NO_CUSTOM_UI =
	"Error: this session cannot render the questionnaire (no custom UI and no dialog primitives). The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead.";

const ERROR_SESSION_LOAD_FAILED =
	"Error: the questionnaire UI failed to load — the host's installed dependencies were likely replaced or removed on disk while Pi was running (e.g. a package-manager install touched the store). The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead, and tell the user that restoring this tool requires repairing the install if needed and restarting Pi.";

const ERROR_STALE_MODULE_CACHE =
	"Error: the questionnaire UI cannot load — the host's module cache went stale after an earlier failed load (typically dependencies replaced on disk mid-session). This is unrecoverable within the current Pi process. The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead, and tell the user to restart Pi to restore this tool.";

/**
 * A `RuntimeError` in the cell — the same `.name`-based mapping code mode's own guard relies on for
 * `PermissionError` (`code-mode/src/contract.ts`).
 */
function runtimeError(message: string): Error {
	const error = new Error(message);
	error.name = "RuntimeError";
	return error;
}

/**
 * Pull `questions` out of what monty handed over.
 *
 * monty passes a host function Python keyword arguments as one trailing plain object (whose *values* are
 * converted per its table — a Python `dict` becomes a `Map`, hence `fromMonty`), so
 * `ask_user_question(questions=[…])` arrives as `[{questions: […]}]` and a positional
 * `ask_user_question([…])` as `[[…]]`. Code mode's own `bind` (`code-mode/src/host.ts`) reads the named
 * keys and ignores the rest; this does the same *and refuses the rest*, because a stray `context=` would
 * otherwise be dropped in silence — and a caller who passed it believes it did something.
 */
function questionsFrom(args: unknown[]): unknown {
	const list = [...args];
	let kwargs: Record<string, unknown> = {};
	const last = list[list.length - 1];
	if (last && typeof last === "object" && !Array.isArray(last) && !Buffer.isBuffer(last)) {
		kwargs = list.pop() as Record<string, unknown>;
	}
	for (const key of Object.keys(kwargs)) {
		if (key !== "questions") throw valueError(`Error: unknown parameter "${key}" (expected questions)`);
	}
	if (list.length > 1) {
		throw valueError(`Error: ask_user_question takes one parameter, "questions" (got ${list.length})`);
	}
	return fromMonty(list[0] ?? kwargs["questions"]);
}

/**
 * Lazy-load the ~560ms QuestionnaireSession view/TUI render graph, guarding
 * the two failure shapes of issue #107. Pi's jiti loader registers a module in
 * its graph cache BEFORE evaluating the body and does not evict it when
 * evaluation throws (jiti 2.7.0), so one failed load — e.g. `pnpm install
 * --force` replacing the store entry mid-session — leaves every later import
 * of this specifier resolving to a namespace without the class. That state is
 * unrecoverable in-process (cache-busting specifiers fail jiti resolution);
 * both branches therefore return a message that names the restart requirement
 * instead of leaking a bare "not a constructor" TypeError.
 *
 * The port has watched this failure happen: a syntax error in a patched copy of `tab-content-strategy.ts`
 * produced exactly this message while the collapse-hint placements were being prototyped, and it poisoned
 * every later call in that process. It is the one guard whose failure mode is not hypothetical.
 */
export async function loadQuestionnaireSession(): Promise<
	{ ok: true; module: SessionModule } | { ok: false; message: string }
> {
	let mod: SessionModule;
	try {
		mod = await import("./state/questionnaire-session.js");
	} catch (e) {
		const cause = e instanceof Error ? e.message : String(e);
		return { ok: false, message: `${ERROR_SESSION_LOAD_FAILED} (cause: ${cause})` };
	}
	if (typeof mod.QuestionnaireSession !== "function") {
		const keys = JSON.stringify(Object.keys(mod));
		return { ok: false, message: `${ERROR_STALE_MODULE_CACHE} (resolved namespace keys: ${keys})` };
	}
	return { ok: true, module: mod };
}

/**
 * Register the raw terminal listener that toggles collapse while the overlay is hidden.
 * Returns the remover, or undefined when the key is off / the host has no raw input hook —
 * callers derive `canReopenWhileHidden` from that.
 */
function registerCollapseKeyListener(
	ctx: ExtensionContext,
	collapseKey: string,
	sessionRef: SessionRef,
	overlayHandleRef: OverlayHandleRef,
): (() => void) | undefined {
	if (collapseKey === COLLAPSE_KEY_OFF || typeof ctx.ui.onTerminalInput !== "function") return undefined;
	let hasAnnouncedHide = false;
	return ctx.ui.onTerminalInput((data) => {
		const handle = overlayHandleRef.current;
		if (!handle) return undefined;
		// Only act while the questionnaire is hidden (its handleInput is
		// unreachable) or actually focused. When some other overlay is on
		// top (e.g. `/btw`), leave the keystroke to that overlay instead of
		// toggling the questionnaire from underneath it.
		if (!handle.isHidden() && !handle.isFocused()) return undefined;
		if (!matchesKey(data, collapseKey as Parameters<typeof matchesKey>[1])) return undefined;
		// Kitty-protocol terminals report press, repeat, and release separately.
		// Toggle only on the initial press so a tap does not immediately reopen
		// the overlay and a held key does not toggle it repeatedly.
		if (isKeyRelease(data) || isKeyRepeat(data)) return { consume: true };
		sessionRef.current?.toggleCollapsedExternal();
		if (handle.isHidden() && !hasAnnouncedHide) {
			hasAnnouncedHide = true;
			ctx.ui.notify?.(
				`ask_user_question hidden — press ${formatKeySpecForDisplay(collapseKey)} to reopen`,
				"info",
			);
		}
		return { consume: true };
	});
}

/**
 * Build the `ctx.ui.custom` component factory: constructs the session (capturing it in
 * `sessionRef`) and exposes its component. `editInput` keeps its two dynamic imports —
 * they must stay lazy per-invocation.
 */
function makeSessionFactory(config: {
	ctx: ExtensionContext;
	typed: QuestionParams;
	itemsByTab: WrappingSelectItem[][];
	collapseKey: string;
	canReopenWhileHidden: boolean;
	sessionRef: SessionRef;
	Session: SessionModule["QuestionnaireSession"];
}) {
	const { ctx, typed, itemsByTab, collapseKey, canReopenWhileHidden, sessionRef, Session } = config;
	return (
		tui: TUI,
		theme: Theme,
		keybindings: import("./state/questionnaire-session.js").QuestionnaireSessionConfig["keybindings"],
		done: (result: QuestionnaireResult) => void,
	): import("./state/questionnaire-session.js").QuestionnaireSessionComponent => {
		const session = new Session({
			tui,
			theme,
			params: typed,
			itemsByTab,
			done,
			keybindings,
			editInput: async (value) => {
				try {
					const [{ SettingsManager }, { editWithExternalEditor }] = await Promise.all([
						import("@earendil-works/pi-coding-agent"),
						import("./state/external-editor.js"),
					]);
					const editorCommand = SettingsManager.create(ctx.cwd, undefined, {
						projectTrusted: ctx.isProjectTrusted(),
					}).getExternalEditorCommand();
					if (!editorCommand) throw new Error("No external editor command is configured");
					return await editWithExternalEditor(tui, editorCommand, value);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`${t("editor.failed", "External editor failed")}: ${message}`, "error");
					return undefined;
				}
			},
			collapseKey,
			canReopenWhileHidden,
		});
		sessionRef.current = session;
		return session.component;
	};
}

/**
 * A TUI questionnaire ALWAYS resolves a QuestionnaireResult (cancel included), so
 * `undefined` uniquely means "host cannot render", never "user declined". RPC builds
 * that predate ctx.mode land here: run the dialog walker when the host has the
 * primitives; otherwise this session cannot ask at all, which the cell sees as a fault
 * rather than as a decline.
 */
async function resolveUndefinedResult(ctx: ExtensionContext, typed: QuestionParams): Promise<QuestionnaireResult> {
	if (hasDialogUI(ctx.ui)) return runRpcQuestionnaire(ctx.ui, typed);
	throw runtimeError(ERROR_NO_CUSTOM_UI);
}

/**
 * Pre-warm the lazy session graph once startup settles (#107). A graph
 * evaluated while the paths Pi resolved at boot still exist stays in memory
 * for the process lifetime, so later on-disk dependency churn (e.g. `pnpm
 * install --force` replacing the store mid-session) can no longer poison
 * jiti's graph cache. Swallowed failure is safe: the first real call
 * re-imports and surfaces it through loadQuestionnaireSession's structured
 * message. unref keeps the timer from holding a non-TUI embedder's process
 * open.
 */
function prewarmSessionGraph(): void {
	const timer = setTimeout(() => void loadQuestionnaireSession().catch(() => undefined), PREWARM_DELAY_MS);
	timer.unref?.();
}

export function buildItemsForQuestion(question: QuestionData): WrappingSelectItem[] {
	const items: WrappingSelectItem[] = question.options.map((o) => ({
		kind: "option",
		label: o.label,
		description: o.description,
	}));
	for (const kind of sentinelsToAppend(question)) {
		items.push({ kind, label: displayLabel(kind) });
	}
	return items;
}

// ---------------------------------------------------------------------------------------------
// The cell-facing contract (ticket 02).
// ---------------------------------------------------------------------------------------------

/** One answered question, in the cell's own vocabulary. */
export interface AskUserQuestionAnswer {
	question_index: number;
	question: string;
	/** How it was answered: a picked option, a typed custom answer, or a multi-select commit. */
	kind: "option" | "custom" | "multi";
	/** Never null: a multi-select answer is its labels joined, with the list in `selected`. */
	answer: string;
	selected: string[] | null;
	preview: string | null;
	notes: string | null;
}

export interface AskUserQuestionResult {
	/** Upstream's envelope, verbatim, so a cell that only prints the result still reads the same words. */
	text: string;
	cancelled: boolean;
	answers: AskUserQuestionAnswer[];
	global_note: string | null;
}

/**
 * Project upstream's `QuestionnaireResult` into the cell's dict.
 *
 * `answer` goes through upstream's own `formatAnswerScalar` so it is never `null`: the `kind`
 * discriminator is kept (it is the only way to tell a typed answer from a picked label) while a
 * multi-select answer reads as its joined labels rather than forcing every reader to branch on `kind`
 * first.
 */
export function projectResult(
	result: QuestionnaireResult | null | undefined,
	params: QuestionParams,
): AskUserQuestionResult {
	const envelope = buildQuestionnaireResponse(result, params);
	const text = envelope.content.map((part) => part.text).join("");
	const answers: AskUserQuestionAnswer[] = (result?.answers ?? []).map((a) => ({
		question_index: a.questionIndex,
		question: a.question,
		kind: a.kind,
		answer: formatAnswerScalar(a, "envelope"),
		selected: a.selected ?? null,
		preview: a.preview ?? null,
		notes: a.notes ?? null,
	}));
	return {
		text,
		cancelled: result === null || result === undefined || Boolean(result.cancelled),
		answers,
		global_note: result?.globalNote ?? null,
	};
}

/**
 * Validate the cell's payload: the strict key pass first (the copy's typebox schemas are permissive, so
 * an unknown key would otherwise be ignored rather than refused), then the schema — the length limits
 * live only in the schema's descriptions, while `validateQuestionnaire` checks counts, duplicates and
 * reserved labels — then upstream's runtime validator.
 *
 * A failure is the calling code's bug, so it raises `ValueError` before any UI appears.
 */
export function validateParams(questions: unknown): QuestionParams {
	const typed = normalizeQuestionParams({ questions: normalizeParamKeys(questions) } as QuestionParams);
	if (!Value.Check(QuestionParamsSchema, typed)) {
		const first = Value.Errors(QuestionParamsSchema, typed)[0] as { path?: string; message?: string } | undefined;
		const at = first?.path ? first.path.replace(/^\//, "").replace(/\//g, ".") : "questions";
		throw valueError(`Error: invalid questionnaire at ${at}: ${first?.message ?? "does not match the schema"}`);
	}
	const validation = validateQuestionnaire(typed);
	if (!validation.ok) throw valueError(validation.message);
	return typed;
}

/** True when this session can show the questionnaire at all: a terminal, or a host with dialogs. */
export function canRenderQuestionnaire(ctx: ExtensionContext): boolean {
	const mode = (ctx as { mode?: string }).mode;
	return Boolean(ctx.hasUI) && (mode === "tui" || hasDialogUI(ctx.ui));
}

/**
 * Build the host function for one session. Built per session, because the ctx it renders through is the
 * session's own — and because a session that cannot render never gets one (the entry answers `null`).
 */
export function createAskUserQuestionHost(input: {
	ctx: ExtensionContext;
	config?: AskUserQuestionConfig;
}): (...args: unknown[]) => Promise<AskUserQuestionResult> {
	const { ctx } = input;
	const collapseKey = resolveCollapseKey(input.config ?? {});
	prewarmSessionGraph();

	return async (...args: unknown[]): Promise<AskUserQuestionResult> => {
		const typed = validateParams(questionsFrom(args));

		// RPC / ACP hosts: `ui.custom` cannot render there, but `select`/`input` work, so the questions
		// are walked one dialog at a time (ticket 04). Checked before the render graph is imported.
		if ((ctx as { mode?: string }).mode === "rpc" && hasDialogUI(ctx.ui)) {
			emitTerminalAttention();
			return projectResult(await runRpcQuestionnaire(ctx.ui, typed), typed);
		}

		const custom = ctx.ui.custom;
		if (typeof custom !== "function") return projectResult(await resolveUndefinedResult(ctx, typed), typed);

		const itemsByTab: WrappingSelectItem[][] = typed.questions.map((q) => buildItemsForQuestion(q));
		const sessionLoad = await loadQuestionnaireSession();
		if (!sessionLoad.ok) throw runtimeError(sessionLoad.message);
		const { QuestionnaireSession } = sessionLoad.module;

		// Capture the overlay handle so the session can call `setHidden()` when the user toggles
		// collapse, and register a raw terminal input listener for the same key so the toggle still
		// works while the overlay is hidden (pi-tui does not route input to a hidden overlay's
		// `component.handleInput`).
		const sessionRef: SessionRef = { current: null };
		const overlayHandleRef: OverlayHandleRef = { current: undefined };
		const removeOverlayInputListener = registerCollapseKeyListener(ctx, collapseKey, sessionRef, overlayHandleRef);
		// Hiding the overlay is only reversible through the raw listener above, so the session may emit
		// `setHidden` only when it was actually registered; otherwise collapse falls back to the visible
		// one-line row.
		const canReopenWhileHidden = removeOverlayInputListener !== undefined;

		try {
			emitTerminalAttention();
			const result = await ctx.ui.custom<QuestionnaireResult>(
				makeSessionFactory({
					ctx,
					typed,
					itemsByTab,
					collapseKey,
					canReopenWhileHidden,
					sessionRef,
					Session: QuestionnaireSession,
				}),
				{
					overlay: true,
					overlayOptions: {
						anchor: "bottom-center",
						width: "100%",
						maxHeight: "100%",
						margin: { left: 0, right: 0, bottom: 0 },
					},
					onHandle: (handle) => {
						overlayHandleRef.current = handle;
						sessionRef.current?.setOverlayHandle(handle);
					},
				},
			);

			if (result === undefined) return projectResult(await resolveUndefinedResult(ctx, typed), typed);
			return projectResult(result, typed);
		} finally {
			removeOverlayInputListener?.();
		}
	};
}

// ---------------------------------------------------------------------------------------------
// The prose the model is given (ticket 02).
// ---------------------------------------------------------------------------------------------

export const DEFAULT_PROMPT_SNIPPET = `await ask_user_question(questions=[…]) — up to ${MAX_QUESTIONS} structured questions, ${MIN_OPTIONS}-${MAX_OPTIONS} options each`;

export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	`Use await ask_user_question(questions=[…]) when the user's request is underspecified and you cannot proceed without concrete decisions — up to ${MAX_QUESTIONS} questions per call. It is a host function, not a tool, and the cell waits for the answer.`,
	`Each question needs ${MIN_OPTIONS}-${MAX_OPTIONS} options, each with a concise label (1-5 words) and a description of what the choice means or its trade-offs. The user can also type a custom answer through the automatically appended "Type something." row, or press Esc to decline. Do not author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.`,
	`Set multiSelect: true when several answers are valid. Add options[].preview (markdown) when an option benefits from side-by-side context (mockups, snippets, diagrams, configs) — single-select only. If you recommend an option, make it the first one and append "(Recommended)" to its label.`,
	"One questionnaire per call, not a loop: group every clarifying question into a single invocation.",
];

export const DEFAULT_DESCRIPTION = `Ask the user one or more structured questions and wait for the answers.

This is a host function, not a tool: await ask_user_question(questions=[…]) suspends the cell while the questionnaire is on screen, and returns a dict — text (the answers, in prose), cancelled, answers, and global_note. Use it when the request is underspecified and you cannot proceed without concrete decisions.

r = await ask_user_question(questions=[
    {"question": "Which storage engine?", "header": "Storage",
     "options": [
         {"label": "SQLite (Recommended)", "description": "One file, no server."},
         {"label": "Postgres", "description": "A real server."},
     ]},
])
if not r["cancelled"]:
    engine = r["answers"][0]["answer"]`;

/** The prose with the config's overrides applied, per field. */
export function askUserQuestionProse(config: AskUserQuestionConfig = {}): {
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
} {
	const guidance: GuidanceFields = config.guidance ?? {};
	return {
		description: guidance.description ?? DEFAULT_DESCRIPTION,
		promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
	};
}

export { buildQuestionnaireResponse, buildToolResult } from "./tool/response-envelope.js";
