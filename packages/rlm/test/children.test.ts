/**
 * v2's additions to the child manager — tickets 07 (cost), 09 (re-serve) and 10
 * (durable depth).
 *
 * Ticket 02's granted tool surface moved to `packages/tool-bridge/test/child-seam.test.ts`
 * with the shim itself (`.scratch/tool-ownership/` ticket 05): the child seam is the
 * bridge's now, so its tests are the bridge's.
 *
 * These are the parts that can be tested without spawning a real child session, so
 * they are the parts that should never regress silently: a depth that reads as zero
 * would hand a child a root's spawning authority, and a cost that double-counts would
 * misreport what a tree spent.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CHILD_ENTRY_TYPE,
	type CostTotals,
	disposeChildSession,
	type Notice,
	createChildManager,
	deriveDepth,
	foldSessionCost,
	forgetManagerViews,
	markNoticeReadIfFinished,
	readChildProvenance,
	childPromptFor,
	registerManagerView,
	resolveOwnDepth,
	treeTokens,
} from "../src/children";

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "rlm-children-"));
}

function writeSession(file: string, header: Record<string, unknown>, entries: unknown[] = []): void {
	mkdirSync(join(file, ".."), { recursive: true });
	const lines = [JSON.stringify({ type: "session", version: 3, ...header }), ...entries.map((e) => JSON.stringify(e))];
	writeFileSync(file, `${lines.join("\n")}\n`);
}

function managerWithEntries(entries: unknown[]): { getEntries: () => unknown[] } {
	return { getEntries: () => entries };
}

describe("durable depth (v2 ticket 10)", () => {
	it("prefers the child entry over anything derived", () => {
		const manager = managerWithEntries([
			{ type: "custom", customType: CHILD_ENTRY_TYPE, data: { depth: 1, parentSessionFile: "/tmp/parent.jsonl", maxDepth: 2 } },
		]);
		expect(readChildProvenance(manager)).toEqual({ depth: 1, parentSessionFile: "/tmp/parent.jsonl", maxDepth: 2 });
		expect(resolveOwnDepth({ sessionManager: manager, sessionFile: "/tmp/child.jsonl", maxDepth: 2 })).toEqual({
			depth: 1,
			source: "entry",
		});
	});

	it("derives depth from the parentSession chain when no entry exists", () => {
		const dir = scratch();
		try {
			const root = join(dir, "root.jsonl");
			const child = join(dir, "child.jsonl");
			const grand = join(dir, "grand.jsonl");
			writeSession(root, { id: "root" });
			writeSession(child, { id: "child", parentSession: root });
			writeSession(grand, { id: "grand", parentSession: child });

			expect(deriveDepth({ sessionFile: root })).toBe(0);
			expect(deriveDepth({ sessionFile: child })).toBe(1);
			expect(deriveDepth({ sessionFile: grand })).toBe(2);
			expect(resolveOwnDepth({ sessionManager: managerWithEntries([]), sessionFile: grand, maxDepth: 2 })).toEqual({
				depth: 2,
				source: "chain",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reads a session with no parent as a root", () => {
		const dir = scratch();
		try {
			const root = join(dir, "root.jsonl");
			writeSession(root, { id: "root" });
			expect(resolveOwnDepth({ sessionManager: managerWithEntries([]), sessionFile: root, maxDepth: 2 })).toEqual({
				depth: 0,
				source: "root",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reads an unprovable depth as the maximum, never zero", () => {
		const dir = scratch();
		try {
			// A parent that exists but whose own header is missing: the chain cannot be
			// walked, so the depth is unknowable. Treating that as 0 would grant a child
			// a root's spawning authority.
			const child = join(dir, "child.jsonl");
			writeSession(child, { id: "child", parentSession: join(dir, "missing-parent.jsonl") });
			const resolved = resolveOwnDepth({ sessionManager: managerWithEntries([]), sessionFile: child, maxDepth: 2 });
			expect(resolved.source).toBe("chain");
			expect(resolved.depth).toBe(1);
			expect(
				resolveOwnDepth({
					sessionManager: managerWithEntries([]),
					sessionFile: join(dir, "gone.jsonl"),
					maxDepth: 2,
				}).depth,
			).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("session cost (v2 ticket 07)", () => {
	const entries = [
		{ id: "a", type: "message", message: { role: "assistant", usage: { input: 100, output: 20, total: 120 } } },
		{ id: "b", type: "message", message: { role: "user" } },
		{ id: "c", type: "compaction", usage: { input: 50, output: 10, total: 60 } },
		{ id: "d", type: "branch_summary", usage: { input: 5, output: 5 } },
	];

	it("sums usage from messages, compactions and branch summaries", () => {
		const totals: CostTotals = { input: 0, output: 0, total: 0, entries: 0 };
		foldSessionCost({ sessionManager: managerWithEntries(entries) }, totals, new Set());
		expect(totals).toEqual({ input: 155, output: 35, total: 190, entries: 3 });
	});

	it("is incremental: a second call counts only new entries", () => {
		const counted = new Set<string>();
		const totals: CostTotals = { input: 0, output: 0, total: 0, entries: 0 };
		const session = { sessionManager: managerWithEntries(entries) };
		foldSessionCost(session, totals, counted);
		foldSessionCost(session, totals, counted);
		expect(totals.total).toBe(190);
		expect(totals.entries).toBe(3);

		entries.push({ id: "e", type: "message", message: { role: "assistant", usage: { input: 10, output: 0, total: 10 } } });
		foldSessionCost(session, totals, counted);
		expect(totals.total).toBe(200);
	});

	it("treats an entry with no usage as free rather than unknown", () => {
		const totals: CostTotals = { input: 0, output: 0, total: 0, entries: 0 };
		foldSessionCost({ sessionManager: managerWithEntries([{ id: "z", type: "message", message: { role: "user" } }]) }, totals, new Set());
		expect(totals.entries).toBe(0);
	});
});

describe("tree cost (v2 ticket 07)", () => {
	it("walks descendants recursively and survives a cycle", () => {
		forgetManagerViews();
		registerManagerView("/root.jsonl", () => [{ session_file: "/child.jsonl", tokens: 100 }]);
		registerManagerView("/child.jsonl", () => [{ session_file: "/grand.jsonl", tokens: 40 }]);
		registerManagerView("/grand.jsonl", () => []);
		expect(treeTokens("/root.jsonl")).toBe(140);
		expect(treeTokens(undefined)).toBe(0);

		// A cycle must not hang or double-count.
		forgetManagerViews();
		registerManagerView("/a.jsonl", () => [{ session_file: "/b.jsonl", tokens: 1 }]);
		registerManagerView("/b.jsonl", () => [{ session_file: "/a.jsonl", tokens: 1 }]);
		expect(treeTokens("/a.jsonl")).toBe(2);
	});
});

describe("the child prompt (v2 ticket 05)", () => {
	it("keeps the delegation sentence parent-only", async () => {
		const source = await Bun.file(join(import.meta.dir, "..", "src", "children.ts")).text();
		expect(source).toContain("results arrive as messages, never as the call's return value");
		expect(source).toContain("child session (depth");
		// A child is told where its results go, not that it may have children of its own.
		expect(source).not.toContain("your own children");
	});
});

describe("the child prompt's shapes (v2 ticket 05)", () => {
	it("states delegation below the cap, and its refusal at the cap", () => {
		delete process.env.RLM_CHILD_PROMPT;
		const below = childPromptFor({ name: "c", depth: 1 }, 2).join(" ");
		const atCap = childPromptFor({ name: "c", depth: 2 }, 2).join(" ");
		expect(below).toContain("You may delegate with rlm.spawn");
		expect(atCap).toContain("at the delegation limit");
		expect(atCap).not.toContain("You may delegate with rlm.spawn");
		// Parent-only: neither shape describes its own future children.
		expect(below).not.toContain("your own children");
	});

	it("drops the added sentences under the A/B control", () => {
		process.env.RLM_CHILD_PROMPT = "none";
		try {
			const control = childPromptFor({ name: "c", depth: 1 }, 2).join(" ");
			expect(control).not.toContain("persistent Python kernel");
			expect(control).toContain('You are "c", a delegated child session (depth 1)');
			expect(control).toContain("agent_message.send");
		} finally {
			delete process.env.RLM_CHILD_PROMPT;
		}
	});
});

describe("the read rule (ticket 06)", () => {
	it("withdraws a completion notice only once the child has a result to read", () => {
		// A status check on a running child must not kill the notice its completion sends.
		const running = { status: "running" as const, noticeRead: false };
		markNoticeReadIfFinished(running);
		expect(running.noticeRead).toBe(false);

		// Reading a finished child is reading its result, so the notice is withdrawn.
		for (const status of ["done", "failed", "stopped"] as const) {
			const finished = { status, noticeRead: false };
			markNoticeReadIfFinished(finished);
			expect(finished.noticeRead).toBe(true);
		}
	});
});

/* ------------------------------------------------------------------ *
 * The manager, driven end-to-end with pi mocked
 * ------------------------------------------------------------------ */

/**
 * `spawn` reaches pi through a dynamic import, which is the only thing standing between
 * these tests and a real child session. Mocking it lets the notice path be exercised for
 * real — statuses, withdrawal, `send` — instead of only through the extracted pieces. The
 * child's turn blocks until the test releases it, so "still running" is controllable.
 */
let releaseTurn: (() => void) | null = null;
let turnBehavior: () => Promise<void> = () =>
	new Promise<void>((resolve) => {
		releaseTurn = resolve;
	});

/** Every option bag the manager handed pi, so a test can read what a child was actually built with. */
const capturedSessionOptions: any[] = [];

mock.module("@earendil-works/pi-coding-agent", () => ({
	SettingsManager: { create: () => ({}) },
	DefaultResourceLoader: class {
		async reload() {}
	},
	SessionManager: { create: () => ({ appendCustomEntry() {} }) },
	createAgentSession: async (options: any) => {
		capturedSessionOptions.push(options);
		return {
			session: {
				sessionFile: "/tmp/child.jsonl",
				model: null,
				bindExtensions: async () => {},
				prompt: () => turnBehavior(),
				followUp: async () => {},
				abort: async () => {},
				dispose: () => {},
			},
		};
	},
}));

function managerHarness() {
	const notices: Notice[] = [];
	const manager = createChildManager({
		cwd: () => "/tmp/work",
		ownSessionFile: () => "/tmp/parent.jsonl",
		kernelFactoryFor: () => () => {},
		runtime: async () => ({}),
		maxDepth: 2,
		maxLive: 8,
	});
	return {
		manager,
		notices,
		spawn: (name = "probe") =>
			manager.spawn({
				prompt: "go",
				name,
				depth: 1,
				spawnCell: "",
				parentSessionFile: "/tmp/parent.jsonl",
				ownerDispatch: (notice) => notices.push(notice),
			}),
		release: () => {
			releaseTurn?.();
			releaseTurn = null;
		},
	};
}

/** Let the child turn's fire-and-forget continuation run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the manager's notices (ticket 06)", () => {
	beforeEach(() => {
		releaseTurn = null;
		turnBehavior = () =>
			new Promise<void>((resolve) => {
				releaseTurn = resolve;
			});
	});

	it("a status check on a running child leaves its completion notice standing", async () => {
		const h = managerHarness();
		const handle = await h.spawn();

		// The original bug: polling a child that had not finished cancelled the notice it
		// would send when it did, so the parent had to be prompted by hand to hear back.
		h.manager.poll(handle.child_id);
		expect(h.notices).toHaveLength(0);

		h.release();
		await settle();
		expect(h.notices).toHaveLength(1);
		expect(h.notices[0]!.cancelled?.()).toBe(false);
		expect(h.manager.poll(handle.child_id).status).toBe("done");
	});

	it("reading a finished child withdraws its notice", async () => {
		const h = managerHarness();
		const handle = await h.spawn();
		h.release();
		await settle();
		expect(h.notices).toHaveLength(1);

		h.manager.poll(handle.child_id);
		expect(h.notices[0]!.cancelled?.()).toBe(true);
	});

	it("notifies again when a finished child is resumed with send", async () => {
		const h = managerHarness();
		const handle = await h.spawn();
		h.release();
		await settle();
		expect(h.notices).toHaveLength(1);
		expect(h.notices[0]!.content).toContain("finished: done");

		// `send` to a finished child was the silent path: it ran a fresh turn and dispatched
		// nothing, so the parent waited for a completion message that never came.
		await h.manager.send(handle.child_id, "again");
		expect(h.manager.poll(handle.child_id).status).toBe("running");
		h.release();
		await settle();
		expect(h.notices).toHaveLength(2);
		expect(h.notices[1]!.content).toContain("finished: done");
	});

	it("carries a failure's reason, and a later success does not restate it", async () => {
		const h = managerHarness();
		turnBehavior = async () => {
			throw new Error("boom");
		};
		const handle = await h.spawn();
		await settle();
		expect(h.notices[0]!.content).toContain("boom");

		// Resuming clears the previous ending, so a success must not repeat the old failure.
		turnBehavior = () =>
			new Promise<void>((resolve) => {
				releaseTurn = resolve;
			});
		await h.manager.send(handle.child_id, "again");
		h.release();
		await settle();
		expect(h.notices).toHaveLength(2);
		expect(h.notices[1]!.content).not.toContain("boom");
		expect(h.notices[1]!.content).toContain("finished: done");
	});
});

/* ------------------------------------------------------------------ *
 * The ceiling (child-surface tickets 01, 03)
 * ------------------------------------------------------------------ */

describe("the ceiling a child is built with", () => {
	beforeEach(() => {
		capturedSessionOptions.length = 0;
		releaseTurn = null;
		turnBehavior = async () => {};
	});

	function harnessWith(overrides: Record<string, unknown> = {}) {
		const requests: any[] = [];
		const manager = createChildManager({
			cwd: () => "/tmp/work",
			ownSessionFile: () => "/tmp/parent.jsonl",
			kernelFactoryFor: () => () => {},
			childFactories: (request) => {
				requests.push(request);
				return [];
			},
			childCeiling: (parentSurface) => ({
				ceiling: (parentSurface ?? []).filter(
					(name) => name === "python" || name === "todowrite",
				),
				source: "spawner",
				dropped: (parentSurface ?? []).filter(
					(name) => name !== "python" && name !== "todowrite",
				),
			}),
			ownSurface: () => ["python", "ask_user_question", "todowrite"],
			runtime: async () => ({}),
			maxDepth: 2,
			maxLive: 8,
			...overrides,
		});
		return { manager, requests };
	}

	it("hands pi the ceiling, and carries it into the child's factories", async () => {
		const { manager, requests } = harnessWith();
		await manager.spawn({
			prompt: "go",
			name: "ceiling",
			depth: 1,
			spawnCell: "",
			parentSessionFile: "/tmp/parent.jsonl",
			ownerDispatch: () => {},
		});

		// The hard half: pi turns this into `allowedToolNames` and filters the tool *registry* by it, so
		// nothing outside the ceiling is merely inactive in the child — it is unregistered.
		expect(capturedSessionOptions.at(-1)?.tools).toEqual(["python", "todowrite"]);
		// The soft half: the child's own factory reconciles against the same value and records it.
		expect(requests.at(-1)?.ceiling).toEqual({
			ceiling: ["python", "todowrite"],
			source: "spawner",
			dropped: ["ask_user_question"],
		});
	});

	it("reads the surface the request carries, not this manager's own", async () => {
		// A grandchild is spawned through the *root's* manager, so the ceiling has to come from the
		// spawning session's own instance or it would be computed from the wrong session (ticket 01 §3).
		const { manager } = harnessWith();
		await manager.spawn({
			prompt: "go",
			name: "grandchild",
			depth: 2,
			spawnCell: "",
			parentSessionFile: "/tmp/child.jsonl",
			ownerDispatch: () => {},
			surface: ["python"],
		});
		expect(capturedSessionOptions.at(-1)?.tools).toEqual(["python"]);
	});

	it("falls back to this manager's own surface when a request carries none", async () => {
		const { manager } = harnessWith();
		await manager.spawn({
			prompt: "go",
			name: "legacy",
			depth: 1,
			spawnCell: "",
			parentSessionFile: "/tmp/parent.jsonl",
			ownerDispatch: () => {},
		});
		expect(capturedSessionOptions.at(-1)?.tools).toEqual(["python", "todowrite"]);
	});

	it("builds a child with no tools at all when no ceiling policy is installed", async () => {
		// Degradation, not failure: with no seam there is nothing that may be held, and the child's own
		// entry records an empty surface rather than the child quietly keeping whatever it registered.
		const { manager } = harnessWith({ childCeiling: undefined });
		await manager.spawn({
			prompt: "go",
			name: "no-seam",
			depth: 1,
			spawnCell: "",
			parentSessionFile: "/tmp/parent.jsonl",
			ownerDispatch: () => {},
		});
		expect(capturedSessionOptions.at(-1)?.tools).toEqual([]);
	});
});

describe("disposing a child session", () => {
	/** A stand-in for `AgentSession`: records what happened, in order. */
	function fakeSession(input: { handlers?: boolean; emitThrows?: boolean; disposeThrows?: boolean } = {}) {
		const order: string[] = [];
		const events: unknown[] = [];
		const session = {
			extensionRunner: {
				hasHandlers: (event: string) => {
					order.push(`hasHandlers:${event}`);
					return input.handlers ?? true;
				},
				emit: async (event: unknown) => {
					order.push("emit");
					if (input.emitThrows) throw new Error("a handler threw");
					events.push(event);
					return true;
				},
			},
			dispose: () => {
				order.push("dispose");
				if (input.disposeThrows) throw new Error("dispose threw");
			},
		};
		return { session, order, events };
	}

	it("tells the child's extensions before the runner is invalidated", async () => {
		// `AgentSession.dispose()` invalidates the child's extension runner silently, and a child
		// built through `createAgentSession` never goes through pi's runtime wrapper, which is the
		// only thing that emits `session_shutdown`. Without this the child's extensions keep their
		// timers armed and their resources open: measured 2026-09-24, a child's RSI quiet timer
		// fired 60s into the disposed session and killed the run.
		const { session, order, events } = fakeSession();
		await disposeChildSession(session);
		expect(order).toEqual(["hasHandlers:session_shutdown", "emit", "dispose"]);
		expect(events).toEqual([{ type: "session_shutdown", reason: "quit" }]);
	});

	it("disposes even when nothing handles the event, and asks first", async () => {
		const { session, order, events } = fakeSession({ handlers: false });
		await disposeChildSession(session);
		expect(order).toEqual(["hasHandlers:session_shutdown", "dispose"]);
		expect(events).toEqual([]);
	});

	it("is best effort: a throwing handler or a throwing dispose still ends in dispose", async () => {
		const throwing = fakeSession({ emitThrows: true });
		await disposeChildSession(throwing.session);
		expect(throwing.order).toEqual(["hasHandlers:session_shutdown", "emit", "dispose"]);

		const disposeThrows = fakeSession({ disposeThrows: true });
		await disposeChildSession(disposeThrows.session);
		expect(disposeThrows.order.at(-1)).toBe("dispose");
	});

	it("tolerates a session with no extension runner at all", async () => {
		const disposed: string[] = [];
		await disposeChildSession({ dispose: () => disposed.push("disposed") });
		expect(disposed).toEqual(["disposed"]);
		await disposeChildSession(undefined);
	});
});
