/**
 * rsi — learned skills for pi.
 *
 * A background loop learns reusable skills from sessions and maintains them
 * over time, in an agent-owned store surfaced to pi only by this extension's
 * `resources_discover` handler. Phase 1 built the store, config and surfacing;
 * phase 2 adds telemetry: usage is observed from skill reads and `/skill:name`
 * expansions, recorded in the ledger under a short lock, and shown by
 * `/rsi status`.
 *
 * Spec: `~/.pi/.scratch/rsi/spec.md` (§2 shape, §4.7 telemetry, §4.8 config,
 * §7 acceptance). The store's governance invariants (§4.5) are enforced by
 * `store.ts`; nothing here writes outside the configured store root.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir, parseSkillBlock } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { discoverSkillNames } from "./frontmatter.ts";
import { readLedger, recordUsage, takeStatusSnapshot } from "./ledger.ts";
import { projectKeyFor } from "./project-key.ts";
import { toScanMessages } from "./prescan.ts";
import { PassScheduler } from "./scheduler.ts";
import { SkillStore, type Scope } from "./store.ts";
import { bashReadCandidates, formatStatus, summarizeStatus, UsageTracker } from "./telemetry.ts";

export default function rsiExtension(pi: ExtensionAPI): void {
	const agentDir = getAgentDir();
	const { config, warnings } = loadConfig({ agentDir });

	// Human-authored names are reserved once at load: pi resolves skills by name
	// first-wins and appends learned paths last, so a collision would load the
	// human skill and silently drop the learned one.
	const reservedNames = discoverSkillNames(path.join(agentDir, "skills"));
	const store = new SkillStore({ root: config.storePath, reservedNames });
	const tracker = new UsageTracker(store);

	// Bash gives no cwd, so relative paths are resolved against the session's.
	let currentCwd = process.cwd();
	// The pass fires on a timer, outside any handler, so it needs a live ctx.
	let currentCtx: ExtensionContext | undefined;

	const scheduler = new PassScheduler({
		root: store.root,
		config,
		getActiveTools: () => pi.getActiveTools(),
		getScanMessages: () => (currentCtx ? toScanMessages(currentCtx.sessionManager.getEntries()) : []),
		runPass: async (reason) => {
			// Phase 4 replaces this with the in-process learner fork.
			if (reason === "learn") currentCtx?.ui.notify("rsi: the learner lands in phase 4; the trigger chain ran", "info");
			return { ok: true, toolActions: 0 };
		},
	});

	pi.on("resources_discover", async (event) => {
		currentCwd = event.cwd;
		if (!config.enabled) return {};

		const projectKey = projectKeyFor(event.cwd);
		if (projectKey && config.disabledProjects.includes(projectKey)) return {};

		const scope: Scope = projectKey ? { project: projectKey } : "general";
		try {
			return { skillPaths: store.skillPaths(scope) };
		} catch {
			// An unencodable key must not take down resource discovery; the
			// session proceeds with general skills only rather than none.
			return { skillPaths: store.skillPaths("general") };
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		currentCtx = ctx;
		if (!config.enabled) return;
		for (const warning of warnings) {
			ctx.ui.notify(warning, "warning");
		}
		try {
			store.ensureLayout();
			store.sweepStaging();
		} catch (error) {
			ctx.ui.notify(`rsi: store unavailable at ${config.storePath} (${error instanceof Error ? error.message : String(error)})`, "warning");
		}
	});

	// -- telemetry (spec §4.7) -------------------------------------------------

	pi.on("before_agent_start", async (event) => {
		if (!config.enabled) return undefined;
		tracker.beginRun();
		const block = parseSkillBlock(event.prompt);
		if (block) {
			const usage = tracker.noteExpansion(block.name, block.location);
			if (usage) await recordUsage(store.root, usage);
		}
		return undefined;
	});

	pi.on("turn_start", async () => {
		scheduler.activity();
		if (config.enabled) tracker.beginTurn();
		return undefined;
	});

	pi.on("agent_start", async () => {
		scheduler.activity();
		return undefined;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		currentCtx = ctx;
		scheduler.settled();
		return undefined;
	});

	pi.on("session_shutdown", async () => {
		scheduler.shutdown();
		return undefined;
	});

	pi.on("tool_result", async (event) => {
		if (!config.enabled || event.isError) return undefined;

		if (event.toolName === "read") {
			const target = typeof event.input.path === "string" ? event.input.path : "";
			const usage = tracker.noteRead(absoluteAgainst(target, currentCwd));
			if (usage) await recordUsage(store.root, usage);
			return undefined;
		}

		if (event.toolName === "bash") {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			for (const candidate of bashReadCandidates(command)) {
				const usage = tracker.noteRead(absoluteAgainst(candidate, currentCwd));
				if (usage) await recordUsage(store.root, usage);
			}
		}
		return undefined;
	});

	// -- operator surface (only `status` exists until phase 6) -----------------

	pi.registerCommand("rsi", {
		description: "RSI: learned-skill status",
		handler: async (args, ctx) => {
			const subcommand = args.trim();
			if (subcommand.length === 0 || subcommand === "status") {
				await showStatus(ctx);
				return;
			}
			if (subcommand === "learn") {
				const result = await scheduler.learnNow();
				if (!result.ran) {
					ctx.ui.notify(`rsi: learn skipped (${result.skipped})`, "info");
				} else {
					ctx.ui.notify(result.outcome.ok ? "rsi: learn pass complete" : "rsi: learn pass failed", result.outcome.ok ? "info" : "warning");
				}
				return;
			}
			ctx.ui.notify(`rsi: unknown subcommand "${subcommand}"; phases 1–3 implement /rsi status and /rsi learn`, "warning");
		},
	});

	async function showStatus(ctx: ExtensionCommandContext): Promise<void> {
		const { ledger, warning } = readLedger(store.root);
		if (warning) ctx.ui.notify(warning, "warning");

		const counts = summarizeStatus(store, ledger);
		const snapshot = await takeStatusSnapshot(store.root, counts);
		ctx.ui.notify(
			formatStatus({
				counts,
				previous: snapshot?.previous,
				enabled: config.enabled,
				observeOnly: config.observeOnly,
				lastPassAt: ledger.last_pass_at,
				proposals: countEntries(path.join(store.root, "proposals")),
				storePath: config.storePath,
			}),
			"info",
		);
	}
}

function absoluteAgainst(target: string, cwd: string): string {
	if (target.length === 0) return "";
	return path.isAbsolute(target) ? target : path.resolve(cwd, target);
}

function countEntries(dir: string): number {
	try {
		return fs.readdirSync(dir).length;
	} catch {
		return 0;
	}
}
