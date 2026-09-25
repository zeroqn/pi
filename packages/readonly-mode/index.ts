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
 * Enforcement is three independent layers, because any one alone leaks:
 *
 *   - the writer tools are removed from the active set, so the model is never
 *     offered them;
 *   - a tool_call handler vetoes writers that reach the session another way: a
 *     tool registered after the mode was enabled, or a tool that activates one
 *     (pi_lens_activate_tools can activate ast_grep_replace);
 *   - a **cell** is governed where it actually acts. This extension contributes a *guard* to
 *     `pi-code-mode` (`.scratch/readonly-guard`): the session's workspace is mounted `read-only`, so
 *     monty itself refuses a sandbox write, and every host call that is not code mode's own is refused
 *     unless the exemption list below names it. Without that layer a code-mode session's `/readonly`
 *     is a prompt and a status line and nothing else — the two name-and-text layers above cannot see
 *     inside a cell.
 *
 * A guardrail against incident, not a sandbox. It reasons about tool names, command text and a
 * hand-kept list of extension capabilities, so anything it cannot reason about it blocks. See
 * bash-allowlist.ts for what that means for shell commands, and EXEMPT_HOST_CALLS for the cell lane.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { KernelGuard, KernelGuardVerdict } from "../host-bridge/src/client.ts";
import {
	API_VERSION as HOST_API_VERSION,
	registerContributor,
	sessionKey,
	type SessionInput,
} from "../host-bridge/src/convention.ts";
import { checkReadOnlyCommand } from "./bash-allowlist.ts";

const STATE_ENTRY = "readonly-mode";
const STATUS_KEY = "readonly-mode";
/** This extension's name in a kernel's receipts, records and refusals. */
const OWNER = "readonly-mode";
/** The contract version a code mode must speak for a cell to be governed: 2 added the `guard` slot. */
const GUARD_API_VERSION = 2;

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

// ---------------------------------------------------------------------------
// The cell lane: what a code mode's guard answers (`.scratch/readonly-guard`)
// ---------------------------------------------------------------------------

/** Code mode's own host calls. Never a policy question here: `bash_host` has its own rule below,
 *  and the rest are reads. A guard that also had to allow-list code mode's own surface would be
 *  claiming authority it does not have. */
const BASE_HOST_CALLS = new Set(["bash_host", "find", "grep", "read_image", "bg_poll", "bg_read", "bg_kill", "bg_list"]);

/**
 * Route host calls: a call whose *capability* is the name it carries rather than its own name.
 *
 * The tool bridge is the one route today — `await tool("ctx_search")` arrives as a single call named
 * `tool` whose first argument is the real name. Code mode hands the guard the call as the kernel makes
 * it (readonly-guard ticket 02), so the route's shape is read *here*, in the policy, and is never
 * taught to code mode.
 */
const ROUTES: Record<string, number> = { tool: 0 };

/**
 * The exemption list: what an extension may reach from a cell while the mode is on.
 *
 * Read-only mode is an **allowlist** (readonly-guard ticket 01, answer 1): every host call that is not
 * code mode's own is refused unless it is named here. So this list is the only place an extension's
 * capability is let through, and it is edited **by hand, with a reason per entry** — an extension
 * cannot add itself, which is the whole point: nothing is permitted silently, and a name that is
 * missing is refused rather than waved through.
 *
 * **A stale entry is the dangerous half.** When a contributor drops a name, delete its line: the
 * refusal is what proves the list is load-bearing (ticket 07's check). `ctx_*` are here because
 * Magic Context's own store is deliberately outside this mode (see the map's Out of scope).
 */
const EXEMPT_HOST_CALLS: Array<{ name: string; reason: string }> = [
	{ name: "rlm_spawn", reason: "delegates a child session; its own transcript is not the workspace" },
	{ name: "rlm_poll", reason: "reads a delegated child's progress" },
	{ name: "rlm_list", reason: "lists this session's delegated children" },
	{ name: "rlm_remove", reason: "disposes a child this session spawned" },
	{ name: "rlm_send", reason: "messages a child this session spawned" },
	{ name: "rlm_find_models", reason: "reads the model catalogue" },
	{ name: "rlm_tree_cost", reason: "reads token accounting" },
	{ name: "agent_message_send", reason: "messages a child, or the parent from inside one" },
	{ name: "web_search", reason: "reads the web; nothing but the session's own scratch is written" },
	{ name: "fetch_content", reason: "reads one page into the session's scratch" },
	{ name: "skills_host", reason: "lists learned skills" },
	{ name: "skill_host", reason: "reads one skill file" },
	{ name: "tool", reason: "the tool bridge's route; the capability it carries is judged below" },
	{ name: "ctx_search", reason: "reads the context store" },
	{ name: "ctx_expand", reason: "reads the context store" },
	{ name: "ctx_memory", reason: "Magic Context's own store, which this mode deliberately does not govern" },
	{ name: "ctx_note", reason: "Magic Context's own store (see ctx_memory)" },
	{ name: "ctx_reduce", reason: "Magic Context's own store (see ctx_memory)" },
];

const EXEMPT = new Set(EXEMPT_HOST_CALLS.map((entry) => entry.name));

/** Argument lookup with a trailing kwargs object removed — code mode's own calling shape, so the
 *  guard reads what the callee's `bind` will read. */
function kwargsOf(args: unknown[]): Record<string, unknown> | undefined {
	const last = args[args.length - 1];
	return last && typeof last === "object" && !Array.isArray(last) ? (last as Record<string, unknown>) : undefined;
}

/** The name a route call is really asking for, or `null` for introspection (`await tool()` lists). */
function routeName(args: unknown[], at: number): string | null {
	const kwargs = kwargsOf(args);
	const positional = kwargs ? args.slice(0, -1) : args;
	const value = positional[at] ?? kwargs?.["name"];
	return typeof value === "string" && value.length > 0 ? value : null;
}

/** The shell command a `bash_host` call would run. */
function commandOf(args: unknown[]): string {
	const kwargs = kwargsOf(args);
	const positional = kwargs ? args.slice(0, -1) : args;
	const value = positional[0] ?? kwargs?.["command"];
	return typeof value === "string" ? value : "";
}

/**
 * The refusal an unlisted capability gets. It names the *fix*, because the fix is a hand edit to the
 * list above — and in a read-only session that is a better answer than the `NameError` the tool
 * bridge would have raised for a name it does not publish.
 */
function notListed(name: string): KernelGuardVerdict {
	return {
		allow: false,
		reason:
			`read-only mode: '${name}' is not on the read-only exemption list, so it cannot be called from a cell. ` +
			`Add it to EXEMPT_HOST_CALLS in pi-readonly-mode if it is safe to run while the workspace is read-only.`,
	};
}

const READ_ONLY_PROMPT = `## Read-only mode (active)

Answer the question. Nothing on disk may change while this mode is on.

- The write tools are disabled and mutating shell commands are blocked. Do not look for a way around that, and do not ask for the mode to be turned off unless the user asks for a change.
- If the question is ambiguous, restate it in your own words and ask one clarifying question rather than guessing at intent.
- Look before you answer. Use the read, ffgrep, fffind and zvec_grep tools for code, and cite file paths with line numbers.
- Say you could not verify something instead of asserting it. If the answer needs execution, say what you would run.
- Answer what was asked: no unrequested implementation plan, no "want me to go ahead and fix it?".`;

/**
 * The half of the prompt a **code-mode** session needs, appended only when this session has a kernel.
 *
 * Without it the model reads "the write tools are disabled" and then finds `write_text` in the
 * prelude, tries it, and reports a contradiction: the block above is about pi's tools and shell
 * commands, and a cell is neither. Say what actually happens in there, and say why a refusal is
 * worth reporting rather than working around.
 */
const READ_ONLY_CELL_PROMPT = `- In a code-mode session your Python runs in one kernel whose workspace is mounted read-only: \`write_text\`, \`edit_text\`, \`mkdirp\` and \`open(..., "w")\` raise \`PermissionError\` there, and a mutating shell command run with \`await bash(...)\` is refused by the same allowlist as above.
- A few extension capabilities stay available inside a cell — delegation, web reads, the context store — because they do not write the workspace. That is a declared exception, not a licence: anything else is refused by name, and if you need a capability that is refused, say which one and stop rather than looking for another route.`;

interface ReadOnlyState {
	enabled: boolean;
	toolsBefore?: string[];
}

export default function readonlyModeExtension(pi: ExtensionAPI): void {
	let enabled = false;
	let toolsBefore: string[] | undefined;
	/**
	 * Set when this session's kernel cannot be governed — a code mode too old to know the `guard`, or a
	 * seam that would not take the registration. It is the only thing that can make a session's
	 * `/readonly` a lie, so the `python` tool is refused while it is set (ticket 01, answer 6: the
	 * floor is fail-closed, and it costs the cell rather than the workspace).
	 */
	let unenforceable: string | null = null;
	/**
	 * Whether this session actually has a governed kernel: `"mounted"` once the guard has been
	 * contributed, `"unenforceable"` when the kernel cannot be governed, `null` while nothing has asked
	 * (a session with no code mode at all). Only the first earns the cell half of the prompt.
	 */
	let cellLane: "mounted" | "unenforceable" | null = null;

	/** This session's policy, as the kernel's guard. Both answers read the live flag, so the toggle
	 *  lands on the next cell with no rebuild. */
	function guardFor(): KernelGuard {
		return {
			mountMode: () => (enabled ? "read-only" : "read-write"),
			before: (call) => {
				if (!enabled) return undefined;
				const route = ROUTES[call.name];
				if (route !== undefined) {
					// A route call with no name is introspection (`await tool()` lists what is published),
					// which asks for nothing; anything else is judged on the name it carries.
					const capability = routeName(call.args, route);
					return capability === null || EXEMPT.has(capability) ? undefined : notListed(capability);
				}
				if (BASE_HOST_CALLS.has(call.name)) {
					if (call.name !== "bash_host") return undefined;
					const verdict = checkReadOnlyCommand(commandOf(call.args));
					return verdict.ok ? undefined : { allow: false, reason: `read-only mode: ${verdict.reason}` };
				}
				return EXEMPT.has(call.name) ? undefined : notListed(call.name);
			},
		};
	}

	/**
	 * Register this session with the seam that mounts its kernel.
	 *
	 * Keyed by the session's own key, because the registry is a process-global and this factory runs
	 * once per load: a constant key would mean the last load wins, and the earlier session would then be
	 * governed by a flag that is not its own (the trap `.scratch/child-surface` ticket 03 measured on
	 * the child detector).
	 */
	function registerForSession(ctx: ExtensionContext): void {
		const key = sessionKey(ctx);
		const registered = registerContributor({
			key: `${OWNER}@${key}`,
			owner: OWNER,
			apiVersion: HOST_API_VERSION,
			session: (input: SessionInput) => {
				if (input.sessionKey !== key) return {};
				if (input.handle.apiVersion < GUARD_API_VERSION) {
					cellLane = "unenforceable";
					// A contribution is validated all-or-nothing, so an older code mode refuses the guard
					// *whole* and the session never learns: it would show the read-only prompt, the status
					// line, and a writable workspace. That is the one failure this check exists to prevent.
					unenforceable =
						`Read-only mode cannot be enforced inside a cell: this code mode speaks contract version ` +
						`${input.handle.apiVersion}, and a guard needs ${GUARD_API_VERSION}. The python tool is refused while the mode is on.`;
					return { problems: [unenforceable] };
				}
				cellLane = "mounted";
				return { contribution: { owner: OWNER, guard: guardFor() } };
			},
		});
		if (registered.registered) return;
		unenforceable = `Read-only mode cannot reach the kernel seam: ${registered.reason}. The python tool is refused while the mode is on.`;
		try {
			ctx.ui.notify(`readonly-mode: ${unenforceable}`, "warning");
		} catch {
			/* a warning must not fail a session start */
		}
	}

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

	// Layer 1's backstop, plus the bash gate, plus the cell lane's floor.
	pi.on("tool_call", async (event) => {
		if (!enabled) return undefined;

		// A cell the kernel cannot govern must not be offered at all: a session that shows the
		// read-only prompt and runs a writable kernel is worse than one that refuses.
		if (event.toolName === "python" && unenforceable) {
			return { block: true, reason: unenforceable };
		}

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
		// The cell half only where there is a governed kernel to describe. A plain pi session has no
		// cell, and telling it about a mount it does not have is how a prompt starts lying.
		const cell = cellLane === "mounted" ? `\n${READ_ONLY_CELL_PROMPT}` : "";
		return { systemPrompt: `${event.systemPrompt}\n\n${READ_ONLY_PROMPT}${cell}` };
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
		// After the state is restored and before `host-bridge` composes this session (it is declared
		// later in the manifest), so the kernel is mounted with this session's answer already in place.
		registerForSession(ctx);
		updateStatus(ctx);
	});
}
