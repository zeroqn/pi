/**
 * readonly-mode — a query-only mode for pi.
 *
 * pi ships the blunt version of this already: `pi --tools read,grep,find,ls`
 * starts a session with no writer tools, `--exclude-tools` prunes a denylist,
 * and `--no-builtin-tools` empties the set. What flags cannot do is what this
 * extension adds:
 *
 *   - a toggle you can hit mid-session (/readonly, Ctrl+Alt+R) or set at launch
 *     (--readonly), persisted in the session so a resume keeps the guard;
 *   - an ambient read-only prompt, so the agent answers the question instead of
 *     drifting into edits;
 *   - a gate on bash's *contents*, not just on bash's presence, which is the
 *     load-bearing part: bash is otherwise a writer with extra steps.
 *
 * Enforcement is two independent layers, because either one alone leaks:
 *
 *   - the writer tools are removed from the active set, so the model is never
 *     offered them;
 *   - a tool_call handler vetoes writers that reach the session another way: a
 *     tool registered after the mode was enabled, or a tool that activates one
 *     (pi_lens_activate_tools can activate ast_grep_replace).
 *
 * A guardrail against incident, not a sandbox. It reasons about tool names and
 * command text, so anything it cannot reason about it blocks. See
 * bash-allowlist.ts for what that means for shell commands.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { checkReadOnlyCommand } from "./bash-allowlist.ts";

const STATE_ENTRY = "readonly-mode";
const STATUS_KEY = "readonly-mode";

/** Tools known to modify the workspace. Kept exact for the active-set filter. */
const WRITER_TOOLS = new Set(["edit", "write", "apply_patch", "ast_grep_replace", "ast_grep_rewrite"]);

/**
 * Fail-closed name heuristic for the tool_call veto. The active-set filter can
 * only remove writers it was told about, so a writer registered later (or one
 * that only becomes active mid-session) is caught here by name. A false
 * positive costs one tool for the length of the mode, and the block reason says
 * which tool and why.
 */
const WRITER_NAME = /(^|_)(write|edit|replace|patch|delete|rename|move|create|apply)(_|$)/;

function isWriterTool(name: string): boolean {
	return WRITER_TOOLS.has(name) || WRITER_NAME.test(name);
}

const READ_ONLY_PROMPT = `## Read-only mode (active)

Answer the question. Nothing on disk may change while this mode is on.

- The write tools are disabled and mutating shell commands are blocked. Do not look for a way around that, and do not ask for the mode to be turned off unless the user asks for a change.
- If the question is ambiguous, restate it in your own words and ask one clarifying question rather than guessing at intent.
- Look before you answer. Use the read, ffgrep, fffind and zvec_grep tools for code, and cite file paths with line numbers.
- Say you could not verify something instead of asserting it. If the answer needs execution, say what you would run.
- Answer what was asked: no unrequested implementation plan, no "want me to go ahead and fix it?".`;

interface ReadOnlyState {
	enabled: boolean;
	toolsBefore?: string[];
}

export default function readonlyModeExtension(pi: ExtensionAPI): void {
	let enabled = false;
	let toolsBefore: string[] | undefined;

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(STATUS_KEY, enabled ? ctx.ui.theme.fg("warning", "🔒 read-only") : undefined);
	}

	function persist(): void {
		pi.appendEntry<ReadOnlyState>(STATE_ENTRY, { enabled, toolsBefore });
	}

	function applyReadOnlyTools(): void {
		const active = pi.getActiveTools();
		if (toolsBefore === undefined) toolsBefore = active;
		pi.setActiveTools(active.filter((name) => !isWriterTool(name)));
	}

	function setEnabled(next: boolean, ctx: ExtensionContext): void {
		if (next === enabled) return;
		enabled = next;

		if (enabled) {
			applyReadOnlyTools();
			ctx.ui.notify("Read-only mode on: write tools disabled, shell commands gated.");
		} else {
			if (toolsBefore !== undefined) pi.setActiveTools(toolsBefore);
			toolsBefore = undefined;
			ctx.ui.notify("Read-only mode off: full access restored.");
		}

		updateStatus(ctx);
		persist();
	}

	pi.registerFlag("readonly", {
		description: "Start in read-only mode (no file modifications)",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("readonly", {
		description: "Toggle read-only mode (no file modifications)",
		handler: async (_args, ctx) => setEnabled(!enabled, ctx),
	});

	pi.registerShortcut("ctrl+alt+r", {
		description: "Toggle read-only mode",
		handler: async (ctx) => setEnabled(!enabled, ctx),
	});

	// Layer 1's backstop, plus the bash gate.
	pi.on("tool_call", async (event) => {
		if (!enabled) return undefined;

		if (isWriterTool(event.toolName)) {
			return {
				block: true,
				reason: `Read-only mode: ${event.toolName} can modify the workspace. Run /readonly to leave the mode first.`,
			};
		}

		if (event.toolName === "pi_lens_activate_tools") {
			const requested = (event.input as { tools?: unknown }).tools;
			const writers = (Array.isArray(requested) ? requested : []).map(String).filter(isWriterTool);
			if (writers.length > 0) {
				return {
					block: true,
					reason: `Read-only mode: refusing to activate writer tool(s): ${writers.join(", ")}.`,
				};
			}
		}

		if (event.toolName === "bash") {
			const verdict = checkReadOnlyCommand((event.input as { command?: string }).command ?? "");
			if (!verdict.ok) {
				return { block: true, reason: `Read-only mode: ${verdict.reason}` };
			}
		}

		return undefined;
	});

	// Layer 1's instruction half: ambient, per turn, so it costs nothing to
	// leave the transcript clean when the mode goes off.
	pi.on("before_agent_start", async (event) => {
		if (!enabled) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${READ_ONLY_PROMPT}` };
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("readonly") === true) enabled = true;

		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i] as { type?: string; customType?: string; data?: ReadOnlyState };
			if (entry.type === "custom" && entry.customType === STATE_ENTRY) {
				enabled = entry.data?.enabled ?? enabled;
				toolsBefore = entry.data?.toolsBefore ?? toolsBefore;
				break;
			}
		}

		if (enabled) applyReadOnlyTools();
		updateStatus(ctx);
	});
}
