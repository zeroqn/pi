/**
 * rsi — learned skills for pi.
 *
 * A background loop learns reusable skills from sessions and maintains them
 * over time, in an agent-owned store surfaced to pi only by this extension's
 * `resources_discover` handler. Phase 1 built the store, config and surfacing;
 * phase 2 telemetry; phase 3 the trigger, gate and pass lock; phase 4 the pass
 * itself; phase 5 the curator; phase 6 the operator surface: `/rsi review`,
 * pin/unpin, archive/restore/discard, promote, observe/write and off/on.
 *
 * Spec: `~/.pi/.scratch/rsi/spec.md` (§3 flow, §4.2 evidence, §4.3 the pass,
 * §4.4 content standard, §4.5 invariants). The store and `skill-actions.ts`
 * enforce the governance invariants; nothing here writes outside the store.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildSessionContext, convertToLlm, getAgentDir, parseSkillBlock, serializeConversation } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveConfig } from "./config.ts";
import { buildCandidates, buildCurationReport, buildCuratorPrompt, curationDueForSession, isCurationDue, retirementCandidates } from "./curation.ts";
import { buildDigest } from "./digest.ts";
import { buildJournalDigest, journalPathFor, kernelActivity, readJournal } from "./journal.ts";
import { runLearningFork, type ForkSession } from "./fork.ts";
import { discoverSkillNames } from "./frontmatter.ts";
import { readLedger, recordUsage, setSkillState, takeStatusSnapshot } from "./ledger.ts";
import { buildReport, emptyTally, formatPassNotification, tallyChanged } from "./pass.ts";
import { projectKeyFor } from "./project-key.ts";
import { lastTurnWasAborted, toScanMessages } from "./prescan.ts";
import { buildReviewPrompt } from "./prompt.ts";
import type { LearnerReason, PassOutcome } from "./scheduler.ts";
import { PassScheduler } from "./scheduler.ts";
import { applyProposal, discardProposal, formatProposal } from "./review.ts";
import type { SkillActionDeps } from "./skill-actions.ts";
import { publishedCapability, registerRsiSeam, type RsiSeamWork, type SeamHostCall, type SeamSkill, type SeamSkillContent, type SeamUsage } from "./seam.ts";
import { SkillStore, treeWrittenSkills, type Scope, type SkillProvenance } from "./store.ts";
import { bashReadCandidates, formatStatus, scopeKey, summarizeStatus, UsageTracker } from "./telemetry.ts";

/** Bound on the rendered transcript, so one huge session cannot blow the fork's budget. */
const MAX_TRANSCRIPT_CHARS = 120_000;

/**
 * What a child session's instance knows about itself (RSI x RLM ticket 11). RLM builds the
 * factory per child at spawn time, so this is available before the child's session starts.
 */
export interface RsiChildDescriptor {
	/** The child's name, as its spawner gave it. */
	name?: string;
	/** How deep it is: 1 for a direct child of the root. */
	depth?: number;
	/** The session file of the session that spawned it. */
	parentSessionFile?: string;
}

export default function rsiExtension(pi: ExtensionAPI, child?: RsiChildDescriptor): void {
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
	// The running fork, so a session shutdown can abort it.
	let activeFork: ForkSession | undefined;

	const scheduler = new PassScheduler({
		root: store.root,
		config,
		/**
		 * A pass that fails must say so. This was never wired, so a throwing pass advanced the
		 * tree-wide floor and left no trace anywhere — the worst kind of silent absence.
		 */
		notify: (line, type) => {
			if (child) {
				try {
					pi.appendEntry("rsi-pass", { line, level: type ?? "info", failed: true });
				} catch {
					/* the record is best effort */
				}
				return;
			}
			currentCtx?.ui?.notify?.(line, type);
		},
		getActiveTools: () => pi.getActiveTools(),
		// A code-mode session's surface is `["python"]`, which the tool-name heuristic reads
		// as query-only — but its kernel can write. RLM publishes that fact (ticket 03) and
		// the gate consults it first; with RLM absent the fact is absent and the heuristic
		// decides, exactly as before.
		publishedCanWrite: () => publishedCapability(sessionFileOf(currentCtx)),
		// The per-session interval is keyed by session file (ticket 12), so a child's pass does
		// not consume the root's.
		getSessionFile: () => sessionFileOf(currentCtx),
		// A lost lock race must not mean this session never learns: an answered child may never
		// settle again, so re-arm its quiet timer and let it try again (ticket 12).
		onLockContention: () => scheduler.settled(),
		// A child lives for one delegated task, so its quiet period is shorter (ticket 13).
		quietMinutes: () => (child ? config.childQuietMinutes : config.quietMinutes),
		// A child killed mid-task still settles, which would otherwise run a pass over a
		// deliberately truncated session (ticket 13).
		lastTurnWasAborted: () =>
			currentCtx ? lastTurnWasAborted(currentCtx.sessionManager.getEntries()) : false,
		getScanMessages: () => (currentCtx ? toScanMessages(currentCtx.sessionManager.getEntries()) : []),
		// The code-mode half of the pre-scan (ticket 04): `["python"]` alone never reaches the
		// pi-tool size threshold, so the kernel journal supplies the equivalent evidence.
		getKernelSignal: () => kernelActivity(readJournal(journalPathFor(sessionFileOf(currentCtx)))),
		runPass: async (reason) => {
			if (!currentCtx) return { ok: false, toolActions: 0 };
			return executePass(reason, currentCtx);
		},
		curationDue: () =>
			curationDueForSession({
				isChild: child !== undefined,
				lastCurateAt: readLedger(store.root).ledger.last_curate_at,
				activeCount: store.listSkills().length,
				config,
				now: Date.now(),
			}),
		curate: async () => {
			if (!currentCtx) return { ok: false, toolActions: 0 };
			return executeCuration(currentCtx);
		},
	});

	// -- the seam (RSI x RLM, tickets 07, 15) -----------------------------------

	/**
	 * RSI's half of the seam. The store is global and every instance serves the same one,
	 * so reads answer process-wide; only session-scoped facts (a capability, a usage
	 * report) resolve to a particular instance. Each session publishes its own - the
	 * root's and a child's are separate instances, and a child's fact is never inherited.
	 *
	 * Nothing here runs unless another extension calls in: with RLM absent the facade is
	 * published and never used.
	 */
	const seamWork: RsiSeamWork = {
		skills: (scope) => listForSeam(scope),
		skill: (name, scope) => contentForSeam(name, scope),
		/**
		 * The factory RLM spreads into a child's loader (ticket 11). One implementation with a
		 * descriptor, not a reduced child module: the store, config, gate and pass wiring are
		 * exactly the parts that must not drift between root and child. The descriptor's only
		 * effects are that a child does not curate, and that its provenance is its own.
		 */
		childFactory: (_childPi, request) => (childPi) => {
			rsiExtension(childPi as ExtensionAPI, descriptorFrom(request));
		},
		noteUsage: (usage, scope) => {
			void recordSeamUsage(usage);
		},
		noteHostCall: (call, scope) => {
			void recordSeamHostCall(call);
		},
	};

	/**
	 * The instance registers at **load time**, not at `session_start`. Another extension's
	 * `session_start` handler may run before ours - the load order decides - and RLM publishes
	 * its capability there, so a facade that appeared later would miss it and the session would
	 * silently never be learned from. The session file is passed as a getter instead, so the
	 * registration is keyed correctly once the session actually starts.
	 */
	const withdrawSeam = registerRsiSeam({ work: seamWork, sessionFile: () => sessionFileOf(currentCtx) });

	/** The learned skills a scope resolves to, in pi's own skill shape. */
	function listForSeam(scope: Scope): SeamSkill[] {
		const shape = (skill: { name: string; description: string; filePath: string; scope: Scope }): SeamSkill => ({
			name: skill.name,
			description: skill.description,
			location: skill.filePath,
			scope: scopeKey(skill.scope),
		});
		try {
			return store.listSkills(scope).map(shape);
		} catch {
			// An unencodable project key must not take the caller down; general alone.
			return store.listSkills("general").map(shape);
		}
	}

	/** One skill's content, resolved in the caller's scope union - never another project's. */
	function contentForSeam(name: string, scope: Scope): SeamSkillContent | undefined {
		try {
			if (!listForSeam(scope).some((skill) => skill.name === name)) return undefined;
			const found = store.readSkillContent(name);
			return found ? { content: found.content, files: found.files } : undefined;
		} catch {
			return undefined;
		}
	}

	/**
	 * One consultation, counted once. The tracker owns the per-turn dedupe and the
	 * path-to-skill resolution, so a `skill()` call and a bash read of the same skill in
	 * the same turn are one act, exactly as an expansion and a read already are.
	 */
	async function recordSeamUsage(usage: SeamUsage): Promise<void> {
		if (!config.enabled) return;
		const event = usage.kind === "skill" ? tracker.noteExpansion(usage.target) : tracker.noteRead(usage.target);
		if (event) await recordUsage(store.root, event);
	}

	/** A bash host call's path-looking tokens, matched exactly as a `bash` tool call is. */
	async function recordSeamHostCall(call: SeamHostCall): Promise<void> {
		if (!config.enabled) return;
		for (const candidate of bashReadCandidates(call.command)) {
			const event = tracker.noteRead(absoluteAgainst(candidate, call.cwd ?? currentCwd));
			if (event) await recordUsage(store.root, event);
		}
	}

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
			ctx.ui.notify(`rsi: store unavailable at ${config.storePath} (${message(error)})`, "warning");
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
		// Withdraw before anything else: a withdrawn instance must not serve a session that is
		// going away. A child never reaches this handler (ticket 09), which is why the
		// registration is also pruned by session-file mtime rather than only released here.
		withdrawSeam();
		scheduler.shutdown();
		const fork = activeFork;
		activeFork = undefined;
		if (fork) {
			try {
				await fork.abort();
			} catch {
				// The fork is going away with the process either way.
			}
		}
		// Aborting can strand a staged write; the next session sweeps it.
		try {
			store.sweepStaging();
		} catch {
			// Best effort, as on session start.
		}
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

	// -- operator surface (status and learn until phase 6) ---------------------

	pi.registerCommand("rsi", {
		description: "RSI: learned-skill status and control",
		handler: async (args, ctx) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const subcommand = tokens[0] ?? "status";
			const rest = tokens.slice(1);

			switch (subcommand) {
				case "status":
					await showStatus(ctx);
					return;
				case "learn": {
					const result = await scheduler.learnNow();
					// A ran pass reports its own outcome; only a skip needs saying here.
					if (!result.ran) ctx.ui.notify(`rsi: learn skipped (${result.skipped})`, "info");
					return;
				}
				case "curate": {
					const result = await scheduler.curateNow();
					if (!result.ran) ctx.ui.notify(`rsi: curate skipped (${result.skipped})`, "info");
					return;
				}
				case "review":
					await runReview(ctx);
					return;
				case "pin":
					await setPinned(rest[0], true, ctx);
					return;
				case "unpin":
					await setPinned(rest[0], false, ctx);
					return;
				case "archive":
				case "discard":
					await archiveSkill(rest[0], ctx);
					return;
				case "restore":
					await restoreSkill(rest[0], ctx);
					return;
				case "promote":
					await promoteSkill(rest[0], rest[1], ctx);
					return;
				case "off":
				case "on":
					await setEnabled(subcommand === "on", rest.includes("--project"), ctx);
					return;
				case "observe":
				case "write":
					await setObserveOnly(subcommand === "observe", ctx);
					return;
				default:
					ctx.ui.notify(
						`rsi: unknown subcommand "${subcommand}". Try: status, learn, curate, review, pin/unpin <name>, archive/discard <name>, restore <name>, promote <name> [--general|--human], observe|write, off|on [--project]`,
						"warning",
					);
			}
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

	// -- operator actions (spec §4.8) ------------------------------------------

	function persistConfig(patch: Record<string, unknown>, ctx: ExtensionCommandContext): boolean {
		const result = saveConfig({ agentDir }, patch);
		if (!result.ok) {
			ctx.ui.notify(result.warning ?? "rsi: could not write the config", "error");
			return false;
		}
		return true;
	}

	async function runReview(ctx: ExtensionCommandContext): Promise<void> {
		const pending = store.listProposals();
		if (pending.length === 0) {
			ctx.ui.notify("rsi: no pending proposals", "info");
			return;
		}
		if (!ctx.hasUI) {
			ctx.ui.notify(`rsi: ${pending.length} pending proposal(s): ${pending.map((p) => `[${p.record.kind}] ${p.record.name}`).join(", ")}`, "info");
			return;
		}

		const labels = pending.map((p) => `[${p.record.kind}] ${p.record.name}${p.record.scope ? ` (${p.record.scope})` : ""}`);
		const choice = await ctx.ui.select(`rsi: ${pending.length} pending proposal(s)`, labels);
		if (!choice) return;
		const selected = pending[labels.indexOf(choice)];

		if (await ctx.ui.confirm(`Apply "${selected.record.name}"?`, formatProposal(selected))) {
			const result = await applyProposal(store, selected);
			ctx.ui.notify(`rsi: ${result.message}`, result.ok ? "info" : "warning");
			if (result.ok) await ctx.reload();
			return;
		}

		if (await ctx.ui.confirm(`Discard "${selected.record.name}"?`, "The proposal is removed; the library is untouched.")) {
			discardProposal(store, selected);
			ctx.ui.notify("rsi: proposal discarded", "info");
		}
	}

	async function setPinned(name: string | undefined, pinned: boolean, ctx: ExtensionCommandContext): Promise<void> {
		if (!name) {
			ctx.ui.notify(`rsi: ${pinned ? "pin" : "unpin"} requires a skill name`, "warning");
			return;
		}
		const result = store.setPinned(name, pinned);
		if (!result.ok) {
			ctx.ui.notify(`rsi: ${result.reason}`, "warning");
			return;
		}
		ctx.ui.notify(`rsi: ${pinned ? "pinned" : "unpinned"} ${name}`, "info");
	}

	async function archiveSkill(name: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
		if (!name) {
			ctx.ui.notify("rsi: archive requires a skill name", "warning");
			return;
		}
		const result = store.archive(name);
		if (!result.ok) {
			ctx.ui.notify(`rsi: ${result.reason}`, "warning");
			return;
		}
		await setSkillState(store.root, name, "archived");
		ctx.ui.notify(`rsi: archived ${name} (restorable with /rsi restore ${name})`, "info");
		await ctx.reload();
	}

	async function restoreSkill(name: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
		if (!name) {
			ctx.ui.notify("rsi: restore requires a skill name", "warning");
			return;
		}
		const result = store.restore(name);
		if (!result.ok) {
			ctx.ui.notify(`rsi: ${result.reason}`, "warning");
			return;
		}
		await setSkillState(store.root, name, "active");
		ctx.ui.notify(`rsi: restored ${name}`, "info");
		await ctx.reload();
	}

	async function promoteSkill(name: string | undefined, flag: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
		if (!name) {
			ctx.ui.notify("rsi: promote requires a skill name and --general or --human", "warning");
			return;
		}

		if (flag === "--human") {
			const exported = store.exportToHuman(name, path.join(agentDir, "skills"));
			if (!exported.ok) {
				ctx.ui.notify(`rsi: ${exported.reason}`, "warning");
				return;
			}
			// Move, not copy: the learned original is archived so it cannot be curated again.
			if (store.archive(name).ok) await setSkillState(store.root, name, "archived");
			ctx.ui.notify(`rsi: promoted ${name} to the human tier`, "info");
			await ctx.reload();
			return;
		}

		const result = store.moveToScope(name, "general");
		if (!result.ok) {
			ctx.ui.notify(`rsi: ${result.reason}`, "warning");
			return;
		}
		ctx.ui.notify(`rsi: promoted ${name} to general`, "info");
		await ctx.reload();
	}

	async function setEnabled(enabled: boolean, project: boolean, ctx: ExtensionCommandContext): Promise<void> {
		if (project) {
			const key = projectKeyFor(ctx.cwd);
			if (!key) {
				ctx.ui.notify("rsi: the working directory is not in a git repo, so there is no project key", "warning");
				return;
			}
			const next = enabled ? config.disabledProjects.filter((k) => k !== key) : [...new Set([...config.disabledProjects, key])];
			config.disabledProjects = next;
			if (!persistConfig({ disabledProjects: next }, ctx)) return;
			ctx.ui.notify(`rsi: learning ${enabled ? "enabled" : "disabled"} for ${key}`, "info");
		} else {
			config.enabled = enabled;
			if (!persistConfig({ enabled }, ctx)) return;
			ctx.ui.notify(`rsi: ${enabled ? "enabled" : "disabled"}`, "info");
		}
		await ctx.reload();
	}

	async function setObserveOnly(observe: boolean, ctx: ExtensionCommandContext): Promise<void> {
		config.observeOnly = observe;
		if (!persistConfig({ observeOnly: observe }, ctx)) return;
		ctx.ui.notify(`rsi: ${observe ? "observe-only" : "write"} mode`, "info");
	}

	// -- the pass (spec §4.2–§4.4) ---------------------------------------------

	async function executePass(reason: LearnerReason, ctx: ExtensionContext): Promise<PassOutcome> {
		const entries = ctx.sessionManager.getEntries();

		let transcript: string;
		try {
			const context = buildSessionContext(entries, ctx.sessionManager.getLeafId());
			transcript = serializeConversation(convertToLlm(context.messages)).slice(0, MAX_TRANSCRIPT_CHARS);
		} catch (error) {
			transcript = `(transcript unavailable: ${message(error)})`;
		}

		// The code-mode half (ticket 04): a session whose only tool is `python` has an empty
		// pi-tool digest, so the kernel journal is read by path and appended. Missing, torn or
		// absent is simply no addition — the pi-tool digest stands as it did.
		const cells = readJournal(journalPathFor(sessionFileOf(ctx)));
		const journalDigest = buildJournalDigest(cells);
		const digest = [buildDigest(toScanMessages(entries), { gitStat: gitDiffStat(ctx.cwd) }), journalDigest]
			.filter((section): section is string => typeof section === "string" && section.length > 0)
			.join("\n\n");
		const projectKey = projectKeyFor(ctx.cwd);
		const scope: Scope = projectKey ? { project: projectKey } : "general";
		const mode = config.observeOnly ? "observe" : "write";

		const tally = emptyTally();
		const softAttempts = new Map<string, number>();
		// Provenance (ticket 14): the session this pass is learning from, and its parent when it
		// is itself a child. Recorded durably so a later pass can tell what its tree wrote.
		const sessionFile = sessionFileOf(ctx);
		const provenance: SkillProvenance = {
			session: sessionFile,
			parentSession: headerParentSession(ctx?.sessionManager),
		};
		const deps: SkillActionDeps = {
			store,
			root: store.root,
			scope,
			mode,
			provenance,
			softAttempts,
			onAction: (action, _name, held) => {
				if (held) tally.proposed++;
				else if (action === "create") tally.created++;
				else if (action === "patch") tally.patched++;
				else if (action === "archive") tally.archived++;
			},
			onHardHit: (hits) => {
				tally.hardHits.push(...hits);
			},
			now: () => new Date(),
		};

		const prompt = buildReviewPrompt({
			scope: scopeKey(scope),
			mode,
			digest,
			transcript,
			treeWrote: treeWrittenSkills(store, sessionFile).map((skill) => ({
				name: skill.name,
				description: skill.description,
			})),
		});
		const outcome = await runLearningFork({
			cwd: ctx.cwd,
			agentDir,
			config,
			prompt,
			deps,
			fallbackModel: ctx.model,
			onSession: (session) => {
				activeFork = session;
			},
		});
		activeFork = undefined;
		tally.error = outcome.error;

		let reportNote = "";
		if (tallyChanged(tally) > 0 || tally.hardHits.length > 0 || outcome.error) {
			try {
				const dir = store.writeReport(
					buildReport(tally, {
						at: new Date().toISOString(),
						reason,
						scope: scopeKey(scope),
						mode,
						model: outcome.modelLabel,
					}),
				);
				reportNote = ` (${path.relative(store.root, dir)})`;
			} catch {
				// The report is best effort; a pass never fails over its audit record.
			}
		}

		const notification = formatPassNotification(tally);
		if (notification) {
			const line = `${notification.line}${reportNote}`;
			if (child) {
				// A child's `ctx.ui` is a no-op in print mode, so the notify would vanish. Its
				// transcript entry is durable and visible when the child's session is read, and
				// the root still sees the skill through `/rsi status` (ticket 12).
				try {
					pi.appendEntry("rsi-pass", { line, reason, scope: scopeKey(scope), mode });
				} catch {
					// The transcript entry is bookkeeping; its absence must not fail a pass.
				}
			} else {
				ctx.ui.notify(line, notification.type);
			}
		}

		return { ok: outcome.ok, toolActions: outcome.toolActions };
	}

	// -- the curator (spec §4.6) ------------------------------------------------

	async function executeCuration(ctx: ExtensionContext): Promise<PassOutcome> {
		const startLedger = readLedger(store.root).ledger;
		const now = Date.now();
		const candidates = buildCandidates(store, startLedger, now);
		const beforeCount = candidates.length;
		const due = isCurationDue({ lastCurateAt: startLedger.last_curate_at, activeCount: beforeCount, config, now });

		const tally = emptyTally();
		const retired: string[] = [];
		let toolActions = 0;

		// Retirement is deterministic, and runs before the model looks at anything.
		for (const candidate of retirementCandidates(candidates, { disuseWeeks: config.disuseWeeks })) {
			if (store.archive(candidate.name).ok) {
				await setSkillState(store.root, candidate.name, "archived");
				retired.push(candidate.name);
				tally.archived++;
				toolActions++;
			}
		}

		const reportDir = store.newReportDir();
		const mode = config.observeOnly ? "observe" : "write";
		let modelLabel: string | undefined;
		let error: string | undefined;

		const remaining = buildCandidates(store, readLedger(store.root).ledger, Date.now());
		if (remaining.length >= 2) {
			const deps: SkillActionDeps = {
				store,
				root: store.root,
				scope: scopeFor(ctx.cwd),
				mode,
				softAttempts: new Map<string, number>(),
				onAction: (action, _name, held) => {
					if (held) tally.proposed++;
					else if (action === "create") tally.created++;
					else if (action === "patch") tally.patched++;
					else if (action === "archive") tally.archived++;
				},
				onHardHit: (hits) => {
					tally.hardHits.push(...hits);
				},
				// A merge rewrites a skill in place; snapshot it first so it reverts exactly.
				snapshot: (name) => {
					store.snapshot(name, path.join(reportDir, "snapshots"));
				},
				now: () => new Date(),
			};

			const outcome = await runLearningFork({
				cwd: ctx.cwd,
				agentDir,
				config,
				deps,
				prompt: buildCuratorPrompt({ candidates: remaining, humanTier: store.humanTierNames(), mode }),
				fallbackModel: ctx.model,
				onSession: (session) => {
					activeFork = session;
				},
			});
			activeFork = undefined;
			modelLabel = outcome.modelLabel;
			error = outcome.error;
			toolActions += outcome.toolActions;
		}

		tally.error = error;
		const afterCount = store.listSkills().length;
		try {
			fs.writeFileSync(
				path.join(reportDir, "REPORT.md"),
				buildCurationReport({
					at: new Date().toISOString(),
					mode,
					model: modelLabel,
					dueReason: due.reason,
					beforeCount,
					afterCount,
					retired,
					created: tally.created,
					proposed: tally.proposed,
					patched: tally.patched,
					archived: tally.archived,
					hardHits: tally.hardHits.length,
					error,
					snapshotDir: tally.patched > 0 ? path.join(reportDir, "snapshots") : undefined,
				}),
			);
		} catch {
			// The report is best effort; curation never fails over its audit record.
		}

		const notification = formatPassNotification(tally);
		if (notification) {
			ctx.ui.notify(`${notification.line} (${path.relative(store.root, reportDir)})`, notification.type);
		} else if (error) {
			ctx.ui.notify(`rsi: curation failed (${error})`, "error");
		}

		return { ok: error === undefined, toolActions };
	}
}

function scopeFor(cwd: string): Scope {
	const key = projectKeyFor(cwd);
	return key ? { project: key } : "general";
}

/**
 * The session this one was spawned from, from pi's own session header.
 *
 * A child session records its parent here, so this is provenance rather than a binding: a
 * `/fork` also writes it, and for "which tree wrote this skill" that is the right answer
 * either way (RSI x RLM ticket 14).
 */
function headerParentSession(sessionManager: unknown): string | undefined {
	try {
		const parent = (sessionManager as { getHeader?: () => { parentSession?: unknown } } | undefined)?.getHeader?.()
			?.parentSession;
		return typeof parent === "string" && parent.length > 0 ? path.resolve(parent) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Read a child descriptor out of RLM's spawn request. Only these three fields are taken, and
 * anything else is ignored, so the request's shape can grow without this breaking.
 */
function descriptorFrom(request: unknown): RsiChildDescriptor {
	const source = (request ?? {}) as Record<string, unknown>;
	return {
		name: typeof source.name === "string" ? source.name : undefined,
		depth: typeof source.depth === "number" ? source.depth : undefined,
		parentSessionFile: typeof source.parentSessionFile === "string" ? source.parentSessionFile : undefined,
	};
}

/** The session file pi recorded, or `undefined` for an in-memory session. */
function sessionFileOf(ctx: ExtensionContext | undefined): string | undefined {
	try {
		const file = ctx?.sessionManager?.getSessionFile?.();
		return typeof file === "string" && file.length > 0 ? file : undefined;
	} catch {
		return undefined;
	}
}

function absoluteAgainst(target: string, cwd: string): string {
	if (target.length === 0) return "";
	return path.isAbsolute(target) ? target : path.resolve(cwd, target);
}

function gitDiffStat(cwd: string): string | undefined {
	try {
		const out = execFileSync("git", ["-C", cwd, "diff", "--stat"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return out.length > 0 ? out.slice(0, 4_000) : undefined;
	} catch {
		return undefined;
	}
}

function countEntries(dir: string): number {
	try {
		return fs.readdirSync(dir).length;
	} catch {
		return 0;
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
