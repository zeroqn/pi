/**
 * Code mode's entry: publish the registry entry, mount one kernel per session, register the
 * one tool, and own the kernel's lifecycle.
 *
 * Ticket 01's two sequences live here and in `contract.ts`. Nothing in this file waits on
 * rlm: if rlm is loaded it mounts first (or second — the mounter does not care), contributes,
 * and gets the same handle back. If it is not loaded, this still works and the kernel simply
 * has fewer names in it.
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

export default function codeMode(pi: any) {
	const keys = createSessionKeys();
	// Read the sessions map off the registry *before* publishing: a `/reload` re-imports this
	// entry, and the reloaded instance has to join the map the live consumers already hold.
	const sessions = registrySessions();
	const kernels = new Map<string, Kernel>();

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
				const kernel = kernels.get(keys.of(ctx));
				if (!kernel) {
					const problems = await mounter.sessions.get(keys.of(ctx))?.problems().catch(() => []);
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
			kernels.set(sessionKey, kernel);
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

	publish({ publisher: PUBLISHER, apiVersion: API_VERSION, sessions, mount: mounter.mount });

	pi.on("session_start", async (_event: any, ctx: any) => {
		try {
			const handle = mounter.mount(pi, ctx);
			const kernel = kernels.get(handle.sessionKey);
			const problems = kernel ? await kernel.startSession(ctx) : [];
			reportProblems(ctx, problems);
		} catch (error) {
			// A mount that threw leaves this session without a kernel. Say so, and record it:
			// a tool that exists but cannot work is worse than one that is absent (ticket 01's
			// failure table, and the web hook's rule).
			reportProblems(ctx, [errorText(error)]);
		}
	});

	pi.on("agent_end", async (_event: any, ctx: any) => {
		await kernels.get(keys.of(ctx))?.endTurn();
	});

	pi.on("session_shutdown", async (_event: any, ctx: any) => {
		const key = keys.of(ctx);
		const kernel = kernels.get(key);
		if (kernel) {
			kernels.delete(key);
			try {
				await kernel.shutdown();
			} catch {
				/* the kernel may already be gone */
			}
		}
		mounter.retire(ctx);
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
