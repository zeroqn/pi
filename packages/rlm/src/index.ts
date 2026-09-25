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
import { bindCodeMode, type CodeModeHandle } from "./bind";
import { bindChild, childCeiling, childFactories, childStatus } from "../../host-bridge/src/compose";
import { type ChildCeiling, setChildDetector } from "../../host-bridge/src/convention";
import { createChildManager, headerParentSession, modelRuntime, readChildProvenance, resolveOwnDepth } from "./children";
import type { ChildKernelContext, Notice } from "./children";
import { rlmContribution, webAccessContribution } from "./contribution";
import { delegationHostFns } from "./delegation";
import { rsiBindChild, rsiChildExtensions, rsiStatus } from "./rsi-seam";
import skillBridge from "../../skill-bridge/src/index";
import { errorText, str } from "./util";
import { resolveWebHook, webSystemPrompt, webSystemPromptTail } from "./web-hook";

const MAX_DEPTH = 2;
const MAX_LIVE_CHILDREN = 8;

/**
 * The web hook is resolved once, at load time, so nothing is ever promised that cannot be
 * called. Top-level await is accepted by pi's loader, and the environment cannot change under
 * a running session.
 */
const webHook = await resolveWebHook();
/** The hook's system-prompt rule, if the module carries one. Empty for an absent or older hook. */
const webRule = webSystemPrompt(webHook);

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
	let codeMode: CodeModeHandle | null = null;
	/** Why there is no kernel in this session, when there is none. */
	let inertReason: string | null = null;
	let toldModel = false;
	let webReason: string | null = null;
	let webNotified = false;
	/** True once this session's kernel got the web host functions (so the rule is not a promise). */
	let webContributed = false;
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
					// RSI's own child signal, and the skills bridge while it still mounts itself: both are
					// named by this module only because a child loads no ambient extensions. Everything
					// else — the seam's own composition, every contributor's factories and code mode's own
					// child instance — comes from `pi-host-bridge`, which appends code mode **inside** its
					// list so the child's instance joins the kernel this factory already mounted and
					// brings the lifecycle the child otherwise has none of (`agent_end` and
					// `session_shutdown`). Code mode is still never imported (ADR 0001).
					...rsiChildExtensions(),
					skillBridge,
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
			});

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
	pi.on("before_agent_start", async (event: any) => {
		try {
			let prompt: string = event.systemPrompt;
			let changed = false;
			if (inertReason && !toldModel) {
				toldModel = true;
				prompt += `\n\n## Code mode is unavailable\n${inertReason}\nThere is no \`python\` tool in this session.\n`;
				changed = true;
			}
			// The web hook's untrusted-content rule, appended whenever this session's kernel got the
			// web host functions. It is appended here and not only by web-access's own entry because a
			// **spawned child loads no ambient extensions**: this handler is the only one that runs
			// for a child, and a cell that can fetch a page must have the rule. The `includes` check
			// keeps a root session — where web-access's entry appends the same text later in load
			// order — from carrying it twice.
			if (webContributed) {
				const tail = webSystemPromptTail(webRule, prompt);
				if (tail) {
					prompt += tail;
					changed = true;
				}
			}
			return changed ? { systemPrompt: prompt } : undefined;
		} catch {
			// A prompt we cannot build must never take a turn down.
			return undefined;
		}
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

		const problems: string[] = [];
			const bound = await bindCodeMode({
			pi,
			ctx,
			contributions: (handle) => {
				const contributions = [
					rlmContribution({
						hostFns: delegationHostFns({
							manager,
							childContext,
							ownDepth,
							sessionFile: () => sessionCtx?.sessionManager?.getSessionFile?.(),
							currentCell: () => handle.currentCell(),
							// This session's own surface, whichever instance this is: at the root it is the root's, in
							// a child it is that child's — which is what makes the ceiling transitive (ticket 01 §3).
							ownSurface: () => {
								try {
									return pi.getActiveTools?.() ?? [];
								} catch {
									return [];
								}
							},
							ownerDispatch: dispatchNotice,
						}),
						onNotice: dispatchNotice,
						provenance: {
							startReason,
							previousSessionFile,
							parentSessionFile,
							isChild,
						},
					}),
				];
				const web = webAccessContribution({
					hook: webHook,
					cwd: ctx?.cwd ?? root,
					sessionFile: ctx?.sessionManager?.getSessionFile?.(),
					// A fetch reports into the running cell, unchanged: the handle owns the sink
					// because the cell's `onUpdate` is code mode's to know.
					progress: (text) => handle.progress()?.(text),
				});
				if (web.contribution) {
					contributions.push(web.contribution);
					webContributed = true;
				}
				if (web.reason) webReason = web.reason;
				return contributions;
			},
		});

		if (bound.status === "bound") {
			codeMode = bound.handle;
			// The tool bridge is **not** adopted here any more (`.scratch/host-bridge` ticket 05): the
			// composition root asks every contributor for this session in its own `session_start`,
			// which runs after this one, and writes the record the surface entry reads. What rlm still
			// does is bind the session's *owners* to a child before that happens, and report the
			// kernel's own preflight.
			problems.push(...bound.problems);
			for (const rejection of bound.rejections) {
				const names = rejection.rejected.map((r) => r.name).join(", ");
				problems.push(`${rejection.owner}'s contribution was refused whole: ${names} (${rejection.rejected[0]?.reason ?? ""})`);
			}
		} else {
			inertReason = bound.reason;
			problems.push(bound.reason);
		}

		if (!childContext) {
			// Recorded unconditionally — including on failure — because this entry is the only
			// durable evidence of whether the kernel and the session's owners were available.
			try {
				pi.appendEntry("rlm-tools", { tools: childStatus(), problems, startReason });
			} catch {
				/* diagnostics must never fail a session */
			}
		}
		try {
			pi.appendEntry("rlm-rsi", { status: rsiStatus(), startReason });
		} catch {
			/* diagnostics must never fail a session */
		}
		// Web bookkeeping: unset is silent and normal; configured is recorded always; broken is
		// recorded, told to the human, and told to the model once at the first cell.
		if (webHook.status === "loaded") {
			try {
				pi.appendEntry("rlm-web", { module: webHook.module, status: "loaded", contract: ["web_search", "fetch_content"] });
			} catch {
				/* see above */
			}
		} else if (webHook.status === "error") {
			try {
				pi.appendEntry("rlm-web", { module: webHook.module, status: "error", reason: webHook.reason });
			} catch {
				/* see above */
			}
			notifyHuman(ctx, `web host functions unavailable: ${webHook.reason}`);
		} else if (webReason) {
			// Configured, resolved, but the module failed the per-kernel contract check.
			try {
				pi.appendEntry("rlm-web", { module: "RLM_WEB_MODULE", status: "error", reason: webReason });
			} catch {
				/* see above */
			}
			if (!webNotified) {
				webNotified = true;
				notifyHuman(ctx, `web host functions unavailable: ${webReason}`);
			}
		}

		if (problems.length === 0) {
			try {
				ctx.ui?.setStatus?.("rlm", "code-mode (monty)");
			} catch {
				/* no UI in this mode */
			}
			return;
		}
		try {
			ctx.ui?.setStatus?.("rlm", "kernel unavailable");
		} catch {
			/* no UI in this mode */
		}
		for (const problem of problems) {
			notifyHuman(ctx, `python kernel: ${problem}`);
			try {
				pi.appendEntry("rlm-preflight", { problem });
			} catch {
				/* see above */
			}
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
	pi.on("session_shutdown", async () => {
		await manager?.shutdownAll();
		notices.length = 0;
	});
}

function notifyHuman(ctx: any, text: string) {
	try {
		ctx?.ui?.notify?.(text, "error");
	} catch {
		/* no UI in this mode */
	}
}
