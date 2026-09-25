/**
 * Code mode's entry: publish the registry entry, mount one kernel per session, register the
 * one tool, and own the kernel's lifecycle.
 *
 * Ticket 01's two sequences live here and in `contract.ts`. Nothing in this file waits on
 * rlm: if rlm is loaded it mounts first (or second — the mounter does not care), contributes,
 * and gets the same handle back. If it is not loaded, this still works and the kernel simply
 * has fewer names in it.
 *
 * The entry has a **second shape** — `codeModeChild`, published as `childExtension` — which a spawned
 * child's loader takes instead of importing this module: the same instance, without the publish, so
 * the child's own runner carries code mode's per-session handlers.
 */
import {
	API_VERSION,
	BASE_HOST_FNS,
	PUBLISHER,
	createLedger,
	createMounter,
	createSessionKeys,
	publish,
	registrySessions,
	sessionIsAlive,
	type Ledger,
} from "./contract";
import { createKernel, type Kernel } from "./kernel";
import { BASE_DESCRIPTION, BASE_GUIDELINES, BASE_SNIPPET } from "./surface";
import { errorText, str } from "./util";

/** What a cell gets when the session has no kernel at all — said plainly, never a stub. */
function noKernelText(problems: string[]): string {
	const why = problems.length > 0 ? problems.join("; ") : "the kernel never mounted in this session";
	return `# the python kernel is not running: ${why}`;
}

export default function codeMode(pi: any): void {
	createInstance(pi, true);
}

/**
 * The instance a **spawned child** loads — the other half of `childExtension` on the registry entry.
 *
 * A child's loader takes the factory from the published entry rather than importing this module, so
 * the function object is the publisher's own and the instance it builds runs in the publisher's
 * module graph (`.scratch/code-mode` ticket 02 §3). It is the same instance code mode always had,
 * with one difference: it does **not** publish. The entry on the registry is what live consumers
 * hold, and a child is a joiner — republishing would hand them the child's mounter for no gain.
 *
 * What the instance buys is the child's *lifecycle*. Its runner is the one that emits `agent_end`
 * and `session_shutdown`, so a child's kernel is now dumped at the end of each of its own turns and
 * closed when the child is disposed, instead of outliving both until a later `session_start` reaps
 * it; and `startSession` runs for the child, which is what restores a resumed child's background
 * records. It reaches the kernel through the shared map, because the child's kernel was created by
 * the *spawner's* instance (`mount` joins rather than creating a second one).
 */
export function codeModeChild(pi: any): void {
	createInstance(pi, false);
}

function createInstance(pi: any, publishEntry: boolean) {
	const keys = createSessionKeys();
	// Read the sessions map off the registry *before* publishing: a `/reload` re-imports this
	// entry, and the reloaded instance has to join the map the live consumers already hold.
	const sessions = registrySessions();

	/**
	 * The kernel for a session, from the **shared** map rather than a per-instance one.
	 *
	 * A session's kernel is not always created by the instance that later handles its ctx. An RLM
	 * child mounts through the registry, which reaches the instance that published it — the child
	 * loads no code-mode entry at all — and a `/reload` or `/new` re-imports this entry, so the
	 * instance that created a kernel is not the one that ends up serving it. A per-instance map
	 * therefore could not see a child's kernel: it was never dumped, never closed, and the map was
	 * orphaned with the kernels still inside it.
	 */
	const kernelFor = (ctx: unknown): Kernel | undefined => sessions.get(keys.of(ctx))?.kernel as Kernel | undefined;

	// The api is a parameter, not the closure's `pi`: a child mounts through the registry from
	// *this* instance, so its `sessionPi` is the child's own registry while `pi` is the spawner's.
	// Registering on the closure would leave the child with no `python` tool at all, and its
	// `setActiveTools(["python"])` would silently empty its active set.
	function registerPythonTool(
		api: any,
		surface: { description: string; snippet: string; guidelines: string[] },
	) {
		// Re-registering the same name from the same extension replaces it silently (measured
		// in ticket 02 §2) — which is exactly what an accepted contribution needs (ticket 01 §4).
		api.registerTool({
			name: "python",
			label: "Python",
			description: surface.description,
			promptSnippet: surface.snippet,
			promptGuidelines: surface.guidelines,
			parameters: {
				type: "object",
				properties: { code: { type: "string", description: "Python to run in the persistent kernel" } },
				required: ["code"],
			},
			async execute(_toolCallId: unknown, params: { code: string }, _signal: unknown, onUpdate: any, ctx: any) {
				const kernel = kernelFor(ctx);
				if (!kernel) {
					const problems = await sessions.get(keys.of(ctx))?.problems().catch(() => []);
					return { content: [{ type: "text", text: noKernelText(problems ?? []) }], details: { failed: true } };
				}
				return kernel.execute(params, onUpdate, ctx);
			},
		});
	}

	const mounter = createMounter({
		keys,
		sessions,
		create: (sessionPi: any, _ctx: unknown, sessionKey: string) => {
			// The ledger is per kernel, because the surface it composes is per kernel: a child's
			// web hook, for instance, resolves against the child's own cwd and session file.
			const ledger: Ledger = createLedger({
				reserved: [...BASE_HOST_FNS],
				base: { description: BASE_DESCRIPTION, snippet: BASE_SNIPPET, guidelines: BASE_GUIDELINES },
				onChange: () =>
					registerPythonTool(sessionPi, {
						description: ledger.description(),
						snippet: ledger.snippet(),
						guidelines: ledger.guidelines(),
					}),
			});
			const kernel = createKernel({ pi: sessionPi, sessionKey, ledger });
			registerPythonTool(sessionPi, {
				description: ledger.description(),
				snippet: ledger.snippet(),
				guidelines: ledger.guidelines(),
			});
			// Code mode owns the only tool, so it owns the surface being just that tool.
			try {
				sessionPi.setActiveTools?.(["python"]);
			} catch {
				/* no tool registry in this mode */
			}
			return kernel;
		},
		// Ticket 01's double-mount rule, made observable: pi will not notice two kernels behind
		// one session, so every mount past the first leaves a trace of itself.
		onExtraMount: (sessionKey: string, mounts: number) => {
			try {
				pi.appendEntry("code-mode-mount", { sessionKey, mounts });
			} catch {
				/* diagnostics only */
			}
		},
	});

	// A child instance joins the entry instead of replacing it (see `codeModeChild`): the entry live
	// consumers hold has to keep pointing at the instance whose handlers serve *their* sessions. A
	// publisher always publishes — the `/reload` case depends on the fresh mount taking over.
	if (publishEntry) {
		publish({
			publisher: PUBLISHER,
			apiVersion: API_VERSION,
			sessions,
			mount: mounter.mount,
			childExtension: () => codeModeChild,
		});
	}

	/**
	 * Dump and close every kernel whose session no longer exists.
	 *
	 * A session does not always end where its kernel was mounted. RLM disposes a child through the
	 * *child's* runner, and a child loads no code-mode entry, so nothing on that runner can reach the
	 * kernel the publishing instance holds — and a `/new`, `/resume` or `/fork` re-imports this entry,
	 * so the instance that mounted the outgoing session's kernels is gone and its local map with it.
	 * Either way the kernel (and its monty worker) is only visible through the shared map, and
	 * `session_start` is the first moment it is provably dead: pi tears the outgoing session down
	 * *before* it builds the incoming one, and RLM kills every descendant of the parent it is leaving.
	 *
	 * Liveness, not the key's absence, is the test, because a session that is merely idle is not a
	 * session that is gone: a finished child is still resumable, and `send` runs its next turn on the
	 * kernel it already has.
	 */
	async function reapDeadKernels(own: string): Promise<void> {
		for (const [key, handle] of [...sessions]) {
			if (key === own) continue;
			if (sessionIsAlive(handle.ctx)) continue;
			try {
				await (handle.kernel as Kernel).shutdown();
			} catch {
				/* a kernel that cannot close must still not hold the session open */
			}
			mounter.retireKey(key);
			try {
				pi.appendEntry("code-mode-reaped", { sessionKey: key });
			} catch {
				/* diagnostics only */
			}
		}
	}

	pi.on("session_start", async (_event: any, ctx: any) => {
		await reapDeadKernels(keys.of(ctx));
		try {
			const handle = mounter.mount(pi, ctx);
			// `startSession` is re-run for a kernel this instance joined rather than created (a
			// reload, or a second consumer's mount): restoring the background records is keyed by id,
			// and the preflight is memoised, so the second call costs nothing and cannot double up.
			const problems = await (handle.kernel as Kernel).startSession(ctx);
			reportProblems(ctx, problems);
		} catch (error) {
			// A mount that threw leaves this session without a kernel. Say so, and record it:
			// a tool that exists but cannot work is worse than one that is absent (ticket 01's
			// failure table, and the web hook's rule).
			reportProblems(ctx, [errorText(error)]);
		}
	});

	pi.on("agent_end", async (_event: any, ctx: any) => {
		await kernelFor(ctx)?.endTurn();
	});

	pi.on("session_shutdown", async (_event: any, ctx: any) => {
		const key = keys.of(ctx);
		// The shared map, not a local one: a session replaced by `/new` or `/reload` is shut down by
		// an instance that did not mount its kernel, and a kernel nobody shuts down is a kernel nobody
		// dumps — its monty worker and its checkout outlive the session for the rest of the process.
		const kernel = kernelFor(ctx);
		if (kernel) {
			try {
				await kernel.shutdown();
			} catch {
				/* the kernel may already be gone */
			}
		}
		mounter.retireKey(key);
	});

	/**
	 * Code mode reports its own problems durably and tells the human, but deliberately leaves
	 * the *status line* to rlm when rlm is there (ticket 03, C7): one surface per session, and
	 * two status keys would be noise. With no rlm, the notification is what makes it loud.
	 */
	function reportProblems(ctx: any, problems: string[]) {
		if (problems.length === 0) return;
		for (const problem of problems) {
			try {
				ctx?.ui?.notify?.(`python kernel: ${problem}`, "error");
			} catch {
				/* no UI in this mode */
			}
			try {
				pi.appendEntry("code-mode-preflight", { problem, session: str((ctx as any)?.sessionManager?.getSessionFile?.()) });
			} catch {
				/* diagnostics must never fail a session */
			}
		}
	}
}
