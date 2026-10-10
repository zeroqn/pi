/**
 * rlm's entry: delegation, notices, and the seams — and no kernel of its own (map ticket 03's
 * table, ticket 01's contract).
 *
 * The kernel belongs to `pi-code-mode`. This file binds to it through the registry
 * (`bind.ts`), contributes rlm's delegation surface and the seams it owns (`contribution.ts`),
 * and keeps every handler that is about the *agent* rather than the sandbox: children and
 * their notices, the child factories its owners provide for a spawned or resumed child, the skills
 * block, the learned-skill seam, the web hook's bookkeeping and the human-facing status.
 *
 * Two rules are worth restating here because this is where they are obeyed:
 *
 *  - **Nothing here waits on the kernel, and the kernel waits on nothing here.** `session_shutdown`
 *    stops children and clears notices; code mode dumps and closes its own session in its own
 *    handler, and neither assumes it ran first (ticket 01 §6).
 *  - **Absence is loud and inert.** No code mode (or an older one) means no `python` tool, a
 *    recorded reason, one line to the model, and everything else still working (ticket 01's
 *    failure table; a throwing factory would kill the whole process — ticket 02 §1).
 */
import { bindChild, childCeiling, childFactories, childStatus } from "../host-bridge/src/compose";
import {
	type ChildCeiling,
	sessionKey,
	sessionRecord,
	setChildDetector,
} from "../host-bridge/src/convention";
import {
	createChildManager,
	flightOf,
	headerParentSession,
	modelRuntime,
	readChildProvenance,
	resolveOwnDepth,
	statusLine,
	treeTokens,
} from "./src/children";
import type { ChildKernelContext, Notice } from "./src/children";
import { loadRlmConfig } from "./src/config";
// Imported for its side effect on the seam, and for the session deps this file files with it.
import { forgetRlmSessionDeps, setRlmSessionDeps } from "./src/registration";
import { rsiBindChild, rsiChildExtensions, rsiStatus } from "./src/rsi-seam";
import { errorText, str } from "./src/util";
const MAX_DEPTH = 2;
const MAX_LIVE_CHILDREN = 8;

export default function (pi: any) {
	return createRlm(pi, null);
}

/**
 * One rlm session: the root (`childContext === null`) or a child spawned by another rlm. A
 * child gets the same surface and its delegation calls route through the spawner that made it.
 */
export function createRlm(pi: any, childContext: ChildKernelContext | null) {
	let root = "";
	let sessionCtx: any = null;
	let startReason = "startup";
	let previousSessionFile: string | undefined;
	// A fork's source as *the fork's own session records it*: pi's CLI `--fork <path>` copies
	// the history into a new session and starts it as "startup" with no `previousSessionFile`,
	// so the header is the only signal that survives (v1 ticket 13).
	let parentSessionFile: string | undefined;
	let ownDepth = childContext ? childContext.depth : 0;
	/** Why there is no kernel in this session, when there is none — read from the seam's record. */
	let toldModel = false;
	/** Once per session, so a preflight problem is reported to the human once. */
	let reportedKernel = false;
	/** Whether `rlm.json` lets the environment change this session's behavior (config.ts). */
	let envOverridesAllowed = false;
	/**
	 * The footer's own cadence (rlm-stop ticket 07). The verdict is computed at read time, so a child
	 * *becoming* stale has no event behind it — and nothing else in the session may wake: the tick is
	 * armed with the first running child, disarmed with the last, and never armed without a UI.
	 */
	let statusTick: ReturnType<typeof setInterval> | null = null;
	/** The last line written, so a tick that changes nothing writes nothing. */
	let lastStatusLine = "";
	/** The staleness threshold this session runs under, resolved with the rest of `rlm.json` below. */
	let staleAfterSeconds = 600;
	const notices: Notice[] = [];
	let parentBusy = false;

	// The bridge's entry learns that a session is a child from *this* reader, not from a marker
	// vocabulary it would have to learn (ticket 03 §5). Installed before any handler runs, so the
	// entry's own `session_start` — a resumed child's only corrector — already has it.
	setChildDetector((ctx: any) => readChildProvenance(ctx?.sessionManager) !== null);

	const manager = childContext
		? null
		: createChildManager({
				cwd: () => root || process.cwd(),
				ownSessionFile: () => sessionCtx?.sessionManager?.getSessionFile?.(),
				// A child's kernel is mounted through the registry by *this* factory, in this
				// module instance: pi calls an inline factory directly, so the child's code mode
				// is the parent's, in the parent's process (ticket 02 §3).
				kernelFactoryFor: (child) => (childPi: any) => createRlm(childPi, child),
				// The seam composes every contributor's child factories (and its own child instance),
				// and RSI offers its own through rlm's own seam; rlm names neither contributor, and a
				// seam that is absent or too old contributes nothing.
				//
				// The skills bridge is named directly, and deliberately: a spawned child loads no
				// ambient extensions, so a skills surface that existed only in the manifest would
				// vanish for exactly the sessions that delegate the most work. It is named here rather
				// than carried by RSI because a child must keep its skills surface when RSI is absent
				// — which is the whole point of the bridge (`.scratch/skill-bridge` tickets 01 #18 and
				// 07). The import is a library call, not a second kernel: the entry's state is all
				// per-session closures.
				childFactories: (request) => [
					// RSI's own child signal, named here because it is rlm's own seam. Everything else —
					// the seam's own composition, every contributor's factories (the skills bridge's
					// block installer among them) and code mode's own child instance — comes from
					// `pi-host-bridge`, which appends code mode **inside** its list so the child's
					// instance joins the kernel this factory already mounted and brings the lifecycle
					// the child otherwise has none of (`agent_end` and `session_shutdown`). Code mode is
					// still never imported (ADR 0001).
					...rsiChildExtensions(),
					...childFactories(request),
				],
			// The ceiling's first operand: this session's *live* surface, read at spawn time and never
			// read back from a record (ticket 01 §1-2). A grandchild reads its own `pi` here, which is
			// what makes "a child is a subset of its parent" transitive by construction.
			ownSurface: () => {
				try {
					return pi.getActiveTools?.() ?? [];
				} catch {
					return [];
				}
			},
			childCeiling,
				runtime: () => modelRuntime(),
				maxDepth: MAX_DEPTH,
				maxLive: MAX_LIVE_CHILDREN,
				// Read at spawn time: the config is resolved at *this* session's start (config.ts).
				allowEnvOverrides: () => envOverridesAllowed,
				// Read at verdict time, so a session that never reads it pays nothing for it.
				staleAfterSeconds: () => staleAfterSeconds,
				// The footer's count is the manager's to announce, not something to poll for: a child
				// spawned or finished mid-turn would otherwise go unsaid until the next turn boundary.
				onChange: () => {
					renderStatus(sessionCtx);
					syncStatusTick(sessionCtx);
				},
				// A stop leaves one `rlm-stop` entry in *this* transcript (ticket 03 §5); the manager
				// has no `pi` of its own, so the session that owns it supplies the writer.
				appendEntry: (customType, data) => pi.appendEntry(customType, data),
			});

	/**
	 * `RLM_CHILD_PROMPT` is set or it is not, and either way the human hears about it once: a control
	 * that only drops prompt sentences leaves no trace in a transcript, so "it is in effect" and "it is
	 * set but ignored" are both worth a line. Root sessions only — a child's prompt is its spawner's
	 * decision, and in a child this instance's `pi` is the spawner's (see the `rlm-tools` entry above).
	 */
	function reportEnvironmentOverride(ctx: any, isChild: boolean) {
		const value = process.env.RLM_CHILD_PROMPT;
		if (isChild || value === undefined) return;
		notifyHuman(
			ctx,
			envOverridesAllowed
				? `RLM_CHILD_PROMPT=${value} is in effect: delegated children get the pre-v2 prompt (rlm.json allows environment overrides)`
				: `RLM_CHILD_PROMPT=${value} is ignored: rlm.json does not allow environment overrides, so children get v2's prompt`,
			"warning",
		);
		try {
			pi.appendEntry("rlm-environment", { variable: "RLM_CHILD_PROMPT", value, honored: envOverridesAllowed });
		} catch {
			/* diagnostics must never fail a session */
		}
	}

	/** How often the footer re-reads the verdict while children are running (ticket 07 §2). */
	const STATUS_TICK_MS = 30_000;

	/**
	 * Arms the footer's tick while a UI exists — a **heartbeat**, and a deliberate supersession of
	 * `rlm-stop` ticket 07's arm-on-transition rule (`.scratch/long-work` ticket 04).
	 *
	 * That rule fit children: the manager's `changed()` is exactly the signal that something about them
	 * changed. The session's **own** work has no such signal — a background shell starting mid-cell, or a
	 * cell that runs nineteen minutes, produces no transition this instance can see (pi's
	 * `tool_execution` events are the blind spot this repo has already measured) — so a footer armed on
	 * transitions would never arm for the case it was built for. What keeps a heartbeat cheap is not
	 * arming it less often but the repaint rule in `renderStatus`: the line is written only when it
	 * changes, so a healthy session shows the same bytes and pays one function call and one registry read
	 * per tick.
	 *
	 * The tick calls `renderStatus` **directly** rather than `changed()`: no transition happened, and
	 * waking every waiter in the session to repaint a line would be the tail wagging the dog.
	 *
	 * It is armed from two places, and needs both: the manager's change signal (a child's arrival or
	 * ending, which is what `rlm-stop` 07 armed it from) and the **turn boundary** — because the root's
	 * own work produces no change signal at all, and a session that spawns no child would otherwise
	 * never arm the tick. That second call site was missing when this first shipped, and the live E1
	 * check found it: a session with a UI showed `rlm: code-mode (monty)` through a nineteen-minute-shaped
	 * cell, never a clause.
	 */
	function syncStatusTick(ctx: any) {
		const wants = Boolean(ctx?.ui);
		if (wants && !statusTick) statusTick = setInterval(() => renderStatus(ctx), STATUS_TICK_MS);
		if (!wants && statusTick) {
			clearInterval(statusTick);
			statusTick = null;
		}
	}

	/**
	 * The footer line: the kernel's state, how many children are working right now, and what this session
	 * is itself in the middle of. Written at the turn boundary — by which time the composition root's
	 * record, the seam's own `session_start`, has landed — from the manager's change signal (spawn,
	 * completion, resume, remove, teardown), and from the heartbeat above, which is the only one that
	 * repaints during a long cell. A session with no UI (print mode, a headless child) simply shows
	 * nothing.
	 */
	function renderStatus(ctx: any) {
		try {
			const record = sessionRecord(sessionKey(ctx));
			if (!record) return;
			// The tree's total is `treeTokens`, the same function `rlm.tree_cost` answers with, so the
			// footer and the tool can never disagree (rlm-wait ticket 04). A child has no manager of its
			// own, so it reads the tree from its own session file — the registry is process-wide and the
			// number is the same one its spawner's footer shows for this subtree.
			const tokens = manager
				? manager.treeCost()
				: treeTokens(ctx?.sessionManager?.getSessionFile?.() ?? undefined);
			const stale = manager?.staleChildren() ?? [];
			// The session's own work in flight (04/09): read from its own kernel through the registry, and
			// `undefined` — no clause — when that kernel publishes no reader, because unknown is not idle.
			const flight = flightOf(ctx);
			const line = statusLine(
				record.mounted,
				manager?.liveCount() ?? 0,
				tokens,
				stale[0] ? { count: stale.length, name: stale[0].name, idle_seconds: stale[0].idle_seconds } : undefined,
				flight,
			);
			if (line === lastStatusLine) return;
			lastStatusLine = line;
			ctx?.ui?.setStatus?.("rlm", line);
		} catch {
			/* no UI in this mode */
		}
	}

	/**
	 * Child notices (v1 ticket 06). pi cannot retract a delivered message, so a notice is held
	 * while the parent is mid-turn and dispatched when the agent goes idle — and dropped if a
	 * cell read the child in the meantime, which is the "read withdraws the notice" rule
	 * expressed without retraction. The kernel raises these through the contribution
	 * (`onNotice`): a finished background handle is code mode's event, reported our way.
	 */
	function dispatchNotice(notice: Notice) {
		notices.push(notice);
		trace("dispatch", { key: notice.key, busy: parentBusy, cancelled: notice.cancelled?.() === true });
		flushNotices();
	}

	function trace(stage: string, data: Record<string, unknown>) {
		try {
			pi.appendEntry("rlm-notice-trace", { stage, ...data });
		} catch {
			/* diagnostics must never break anything */
		}
	}

	function flushNotices() {
		if (parentBusy || notices.length === 0) return;
		for (const notice of notices.splice(0)) {
			if (notice.cancelled?.()) {
				trace("flush-cancelled", { key: notice.key });
				continue;
			}
			try {
				pi.sendMessage(
					{ customType: notice.customType ?? "rlm-child", content: notice.content, display: true },
					{ deliverAs: "steer", triggerTurn: true },
				);
				trace("flush-sent", { key: notice.key });
			} catch (error) {
				trace("flush-failed", { key: notice.key, error: errorText(error) });
			}
		}
	}

	/**
	 * Two things appended to the turn's system prompt: the one-line "code mode is unavailable"
	 * notice (once, when there is no kernel at all), and the web hook's untrusted-content rule
	 * (whenever this session's kernel got the web host functions — the route a spawned child has,
	 * since a child loads no ambient extensions). The skills block is RSI's own handler now.
	 *
	 * It **appends to `event.systemPrompt`** rather than replacing it, and that is the invariant the
	 * two extensions depend on: `before_agent_start` handlers chain, each seeing the previous one's
	 * result, so rlm's text (load order 2) and RSI's block (load order 3) both survive. A handler
	 * that returned a bare string would silently drop the other's text.
	 */
	/**
	 * One thing appended to the turn's system prompt: the "code mode is unavailable" notice, once per
	 * session, read from the composition root's **record** (`.scratch/host-bridge` ticket 06).
	 *
	 * rlm no longer mounts, so a mount result is not something it has: the record is written in the
	 * seam's `session_start` — later in the manifest than this entry, earlier than any turn — and the
	 * kernel's own preflight problems land there too, which is why the human notice is raised here
	 * rather than in `session_start`.
	 *
	 * It **appends to `event.systemPrompt`** rather than replacing it, and that is the invariant every
	 * other contributor depends on: `before_agent_start` handlers chain, each seeing the previous one's
	 * result, so rlm's text (load order 2), the seam's appended prompt text and skill-bridge's block all
	 * survive. A handler that returned a bare string would silently drop the others' text.
	 */
	pi.on("before_agent_start", async (event: any, ctx: any) => {
		try {
			const record = sessionRecord(sessionKey(ctx));
			if (!record) return undefined;
			if (record.problems.length > 0 && !reportedKernel) {
				reportedKernel = true;
				for (const problem of record.problems) {
					notifyHuman(ctx, `python kernel: ${problem}`);
					try {
						pi.appendEntry("rlm-preflight", { problem });
					} catch {
						/* diagnostics must never fail a session */
					}
				}
			}
			renderStatus(ctx);
			// Arm the heartbeat here, at the turn boundary, and not only from the manager's change signal
			// (`.scratch/long-work` ticket 04, found live 2026-10-10). `onChange` fires on *child*
			// transitions, so a session that spawns no child never armed the tick at all — and the tick is
			// the only thing that repaints during a cell, which is exactly when the footer's new clauses
			// exist. One line, and the paused case is a session with no UI.
			syncStatusTick(ctx);
			if (record.mounted || toldModel) return undefined;
			toldModel = true;
			const why = record.problems[0] ?? "the kernel could not be mounted";
			return {
				systemPrompt: `${event.systemPrompt}\n\n## Code mode is unavailable\n${why}\nThere is no \`python\` tool in this session.\n`,
			};
		} catch {
			// A prompt we cannot build must never take a turn down.
			return undefined;
		}
	});

	/**
	 * The last repaint of a turn (`.scratch/long-work` ticket 04, amended after the live E1 run): the
	 * heartbeat's 30 s granularity meant a stale `run: … 20s` outlived an Esc by up to a tick — the cell
	 * was gone and the line still named it. The end of the run is the moment the line can be made true
	 * without polling any faster, and `renderStatus` is repaint-on-change, so a session whose state did
	 * not move repaints nothing at all.
	 *
	 * `agent_end` rather than `agent_before_settle`/`agent_settled`: those two are about what pi will do
	 * next, and this is only about what the footer says about what has already happened.
	 */
	pi.on("agent_end", (_event: any, ctx: any) => {
		renderStatus(ctx);
	});

	pi.on("session_start", async (event: any, ctx: any) => {
		startReason = event?.reason ?? "startup";
		previousSessionFile = event?.previousSessionFile ? str(event.previousSessionFile) : undefined;
		// The header, not the event, is what a CLI `--fork <path>` leaves behind (ticket 13).
		parentSessionFile = headerParentSession(ctx?.sessionManager);
		sessionCtx = ctx;
		root = ctx?.cwd ?? process.cwd();
		// This session's own depth comes from its own artifacts — the `rlm-child` entry, or the
		// parentSession chain — so a child resumed without its spawner still knows how deep it is.
		const resolvedDepth = resolveOwnDepth({
			sessionManager: ctx?.sessionManager,
			sessionFile: ctx?.sessionManager?.getSessionFile?.(),
			maxDepth: MAX_DEPTH,
		});
		ownDepth = childContext ? childContext.depth : resolvedDepth.depth;
		// The owners are told which session they are serving **before** the bridge reads their
		// publications (ticket 02 §2): an owner's own lookup finds the instance serving a child from
		// the child's session id or file, and only falls back to "the one instance in this process"
		// otherwise — so without this, a second instance alive in one process would leave the child
		// bridged to nothing. It is also what makes the child *reduced* — membership is the binding
		// (ticket 04) — and it happens for a spawned and a resumed child alike.
		const isChild = childContext !== null || readChildProvenance(ctx?.sessionManager) !== null;
		if (isChild) {
			bindChild({
				childSessionFile: ctx?.sessionManager?.getSessionFile?.(),
				childSessionId: ctx?.sessionManager?.getSessionId?.(),
				parentSessionFile: readChildProvenance(ctx?.sessionManager)?.parentSessionFile,
				cwd: ctx?.cwd,
			});
			// RSI's own child signal, in RSI's own vocabulary: the bind carries the session file and
			// nothing else, and being built by `childExtension()` is not enough on its own — a
			// *resumed* child loads the ambient manifest and never sees that factory.
			rsiBindChild({ sessionFile: ctx?.sessionManager?.getSessionFile?.() });
		}

		// What the environment is allowed to change here is `rlm.json`'s to say (config.ts), and the
		// answer is announced rather than left to be found: `RLM_CHILD_PROMPT` only removes two prompt
		// sentences, which is exactly the switch nobody notices is on. Resolved once per session — a
		// child's spawn reads it through the manager's thunk, and it is the *spawner's* answer that
		// shapes the child's prompt.
		const config = loadRlmConfig({
			cwd: root,
			projectTrusted: ctx?.isProjectTrusted?.() === true,
		});
		envOverridesAllowed = config.allowEnvironmentOverrides;
		staleAfterSeconds = config.staleAfterSeconds;
		reportEnvironmentOverride(ctx, isChild);

		// This session's contribution is filed for the composition root, which asks every contributor in
		// its own `session_start` — later than this entry, and earlier than the first cell. The handle
		// travels the other way, in the answer, because `currentCell()` is the kernel's to know.
		setRlmSessionDeps(sessionKey(ctx), {
			manager,
			childContext,
			ownDepth,
			ownSurface: () => {
				try {
					return pi.getActiveTools?.() ?? [];
				} catch {
					return [];
				}
			},
			sessionFile: () => sessionCtx?.sessionManager?.getSessionFile?.(),
			ownerDispatch: dispatchNotice,
			provenance: { startReason, previousSessionFile, parentSessionFile, isChild },
		});

		if (!childContext) {
			// Recorded unconditionally: this entry is the durable evidence of which owners were available,
			// while the kernel's own record is the seam's `host-bridge` entry.
			try {
				pi.appendEntry("rlm-tools", { tools: childStatus(), startReason });
			} catch {
				/* diagnostics must never fail a session */
			}
		}
		try {
			pi.appendEntry("rlm-rsi", { status: rsiStatus(), startReason });
		} catch {
			/* diagnostics must never fail a session */
		}
	});

	pi.on("tool_execution_start", async () => {
		parentBusy = true;
	});

	pi.on("agent_end", async () => {
		parentBusy = false;
		flushNotices();
	});

	/**
	 * Nothing here touches the kernel: code mode dumps it, stops its own background handles
	 * and retires its own registry entry in *its* handler, and the two handlers share no state
	 * (ticket 01 §6).
	 */
	pi.on("session_shutdown", async (_event: any, ctx: any) => {
		// The footer's tick dies with the session, or it would keep painting a session that is gone.
		if (statusTick) {
			clearInterval(statusTick);
			statusTick = null;
		}
		await manager?.shutdownAll();
		notices.length = 0;
		try {
			forgetRlmSessionDeps(sessionKey(ctx));
		} catch {
			/* a session that cannot be keyed has no deps to forget */
		}
	});
}

function notifyHuman(ctx: any, text: string, level: "info" | "warning" | "error" = "error") {
	try {
		ctx?.ui?.notify?.(text, level);
	} catch {
		/* no UI in this mode */
	}
}
