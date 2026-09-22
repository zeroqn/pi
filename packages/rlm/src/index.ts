/**
 * rlm's entry: delegation, notices, and the seams — and no kernel of its own (map ticket 03's
 * table, ticket 01's contract).
 *
 * The kernel belongs to `pi-code-mode`. This file binds to it through the registry
 * (`bind.ts`), contributes rlm's delegation surface and the seams it owns (`contribution.ts`),
 * and keeps every handler that is about the *agent* rather than the sandbox: children and
 * their notices, the Magic Context shim for a spawned or resumed child, the skills block, the
 * learned-skill seam, the web hook's bookkeeping and the human-facing status.
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
import { type BridgeReport, adoptToolBridge, bridgeStatusLine } from "./tool-bridge";
import { createChildManager, headerParentSession, modelRuntime, readChildProvenance, resolveOwnDepth } from "./children";
import type { ChildKernelContext, Notice } from "./children";
import { rlmContribution, webCodeContribution } from "./contribution";
import { delegationHostFns } from "./delegation";
import { bindToParentInstance, magicContextChildShim, magicContextStatus } from "./magic-context";
import { reportCapability, reportHostCall, rsiChildFactory, rsiStatus } from "./rsi-seam";
import { beforeAgentStartResult } from "./skills-block";
import { errorText, str } from "./util";
import { resolveWebHook } from "./web-hook";

const MAX_DEPTH = 2;
const MAX_LIVE_CHILDREN = 8;

/**
 * The web hook is resolved once, at load time, so nothing is ever promised that cannot be
 * called. Top-level await is accepted by pi's loader, and the environment cannot change under
 * a running session.
 */
const webHook = await resolveWebHook();

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
	const notices: Notice[] = [];
	let parentBusy = false;

	/** Every seam report carries this identity, as a closure over *this* session — never a
	 * module-level ref, which in a process with several kernels is whoever bound last
	 * (ticket 03, C6). */
	const seamCaller = () => ({ sessionFile: sessionCtx?.sessionManager?.getSessionFile?.(), cwd: sessionCtx?.cwd ?? root });

	const manager = childContext
		? null
		: createChildManager({
				cwd: () => root || process.cwd(),
				ownSessionFile: () => sessionCtx?.sessionManager?.getSessionFile?.(),
				// A child's kernel is mounted through the registry by *this* factory, in this
				// module instance: pi calls an inline factory directly, so the child's code mode
				// is the parent's, in the parent's process (ticket 02 §3).
				kernelFactoryFor: (child) => (childPi: any) => createRlm(childPi, child),
				// RSI offers its child factory through the seam; rlm never names RSI, and an RSI
				// that is absent or too old contributes nothing.
				childFactories: (request) => [magicContextChildShim(request.parentSessionFile), ...rsiChildFactory(request)],
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
	 * The code-mode skills block: pi renders no skills for a session whose active tools are
	 * `["python"]`, so rlm appends the block itself — the human tier from the event plus the
	 * learned store from the seam. In any other session this returns `undefined` and pi's
	 * prompt is untouched. When there is no kernel at all, one line says so, once.
	 */
	pi.on("before_agent_start", async (event: any) => {
		try {
			const base = await beforeAgentStartResult(event, seamCaller());
			if (!inertReason || toldModel) return base;
			toldModel = true;
			const line = `\n\n## Code mode is unavailable\n${inertReason}\nThere is no \`python\` tool in this session.\n`;
			return { systemPrompt: `${base?.systemPrompt ?? event.systemPrompt}${line}` };
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
		if (!childContext && resolvedDepth.depth > 0) {
			const provenance = readChildProvenance(ctx?.sessionManager);
			bindToParentInstance({
				childSessionFile: ctx?.sessionManager?.getSessionFile?.(),
				parentSessionFile: provenance?.parentSessionFile,
				cwd: ctx?.cwd,
			});
		}

		// The capability fact (RSI x RLM ticket 03): RSI's gate suppresses a session whose
		// active tools lack `write`/`edit`, which is every code-mode session — the kernel can
		// write, but not through a pi tool. The surface is fixed by this point.
		reportCapability({
			sessionFile: ctx?.sessionManager?.getSessionFile?.(),
			canWrite: true,
			reason: "code-mode kernel: write_text/edit_text/bash host functions exist",
		});

		// A resumed child is a child even though no `childContext` is in play; computed once, since
		// both the provenance rule and the bridge's child exclusion read it.
		const isChild = childContext !== null || readChildProvenance(ctx?.sessionManager) !== null;
		const problems: string[] = [];
		let bridge: BridgeReport | undefined;
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
							ownerDispatch: dispatchNotice,
						}),
						caller: seamCaller,
						// The one observer hook: `bash_host` reports every command, and RSI's counted
						// backstop owns the matching (ticket 03, C1).
						onHostCall: (name, args) => {
							if (name === "bash_host") reportHostCall(str(args[0]), seamCaller());
						},
						onNotice: dispatchNotice,
						provenance: {
							startReason,
							previousSessionFile,
							parentSessionFile,
							isChild,
						},
					}),
				];
				const web = webCodeContribution({
					hook: webHook,
					cwd: ctx?.cwd ?? root,
					sessionFile: ctx?.sessionManager?.getSessionFile?.(),
					// A fetch reports into the running cell, unchanged: the handle owns the sink
					// because the cell's `onUpdate` is code mode's to know.
					progress: (text) => handle.progress()?.(text),
				});
				if (web.contribution) contributions.push(web.contribution);
				if (web.reason) webReason = web.reason;
				return contributions;
			},
		});

		if (bound.status === "bound") {
			codeMode = bound.handle;
			// The tool bridge (ticket 06), after the bind and before the first cell: an owner's
			// published pi tools become host functions a cell can call, and the names that became
			// reachable are recorded for the surface entry to strip. Contributed here rather than
			// through `bindCodeMode` because the bridge has to see its own receipt, and a session
			// whose contribution was refused records nothing and keeps the pi tools it had.
			//
			// Not in a child. What a child's kernel may reach is Magic Context's child allowlist
			// (`ctx_search`, `ctx_reduce`, `ctx_expand`), and a *published* tool set is chosen by the
			// owner's session policy rather than by that allowlist — so adopting here would widen the
			// child's bound, which is the one thing this seam must not do. A child has its own
			// `python` tool again, so a child *could* call a bridge; the narrowing belongs in Magic
			// Context's own `publishableNames`, which already carries `isReducedSession` for exactly
			// this kind of session-scoped decision, and the map's fog records it.
			if (!isChild) {
				bridge = adoptToolBridge({ contribute: bound.handle.contribute, ctx });
			}
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
			// durable evidence of whether the kernel and Magic Context were available.
			try {
				pi.appendEntry("rlm-magic-context", { status: magicContextStatus(), bridge: bridgeStatusLine(bridge), problems, startReason });
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
