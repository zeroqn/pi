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
import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	capturedSessionOptions,
	completeTurn,
	holdTurn,
	installFakePi,
	releaseTurnNow,
	setChildEntries,
	setShutdownBehavior,
	setTurnBehavior,
	disposedSessions,
	resetFakeSessions,
	shutdownReasons,
} from "./fake-pi";
import {
	CHILD_ENTRY_TYPE,
	type CostTotals,
	disposeChildSession,
	type Notice,
	createChildManager,
	deriveDepth,
	foldSessionCost,
	forgetManagerViews,
	answerOf,
	markNoticeReadIfFinished,
	readChildProvenance,
	childPromptFor,
	cleanReason,
	registerManagerView,
	resolveOwnDepth,
	ageText,
	flightOf,
	staleReason,
	statusLine,
	treeTokens,
} from "../src/children";
import { sessionKey } from "../../host-bridge/src/convention";

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

	it("tells a child to declare long work, and why (rlm-stop ticket 10)", () => {
		delete process.env.RLM_CHILD_PROMPT;
		const prompt = childPromptFor({ name: "c", depth: 1 }, 2).join(" ");
		expect(prompt).toContain("await rlm.note(text, expect_seconds=...)");
		expect(prompt).toContain("pass a timeout to bash");
		// The consequence is the part a child can act on, and it has to be the true one.
		expect(prompt).toContain("a parent that hears nothing may decide you are stuck and stop you");
	});

	it("drops the added sentences under the A/B control, when rlm.json allows it", () => {
		process.env.RLM_CHILD_PROMPT = "none";
		try {
			const control = childPromptFor({ name: "c", depth: 1 }, 2, true).join(" ");
			expect(control).not.toContain("persistent Python kernel");
			expect(control).not.toContain("rlm.note");
			expect(control).toContain('You are "c", a delegated child session (depth 1)');
			expect(control).toContain("agent_message.send");
		} finally {
			delete process.env.RLM_CHILD_PROMPT;
		}
	});

	it("ignores the A/B control when rlm.json does not allow environment overrides", () => {
		process.env.RLM_CHILD_PROMPT = "none";
		try {
			const prompt = childPromptFor({ name: "c", depth: 1 }, 2).join(" ");
			expect(prompt).toContain("You may delegate with rlm.spawn");
			expect(childPromptFor({ name: "c", depth: 1 }, 2, false).join(" ")).toBe(prompt);
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

installFakePi();

function managerHarness(onChange?: () => void, staleAfterSeconds = 600) {
	const notices: Notice[] = [];
	// The child's own kernel context, captured as a spawn builds it: it is the channel the child's
	// kernel reaches its parent through — `agent_message.send`, and the stop/remove verbs, whose
	// authority is the asker's own position in the tree (ticket 04).
	let childContext: any = null;
	const contexts = new Map<string, any>();
	/** Every custom entry the manager wrote into this session's transcript (`rlm-stop`, ticket 03 §5). */
	const entries: Array<{ customType: string; data: any }> = [];
	const manager = createChildManager({
		cwd: () => "/tmp/work",
		ownSessionFile: () => "/tmp/parent.jsonl",
		kernelFactoryFor: (child) => {
			childContext = child;
			contexts.set(child.id, child);
			return () => {};
		},
		runtime: async () => ({}),
		maxDepth: 2,
		maxLive: 8,
		onChange,
		staleAfterSeconds: () => staleAfterSeconds,
		appendEntry: (customType, data) => entries.push({ customType, data }),
	});
	const spawn = (name = "probe") =>
		manager.spawn({
			prompt: "go",
			name,
			depth: 1,
			spawnCell: "",
			parentSessionFile: "/tmp/parent.jsonl",
			ownerDispatch: (notice) => notices.push(notice),
		});
	return {
		manager,
		notices,
		entries,
		child: () => childContext,
		/** The context of one specific child, for the authority cases (a sibling, a grandchild). */
		contextOf: (childId: string) => contexts.get(childId),
		spawn,
		/** Spawn a grandchild the way a child's own cell does: through its context, one level deeper. */
		grandchild: (parentChildId: string, parentSessionFile: string, name = "grand") =>
			contexts
				.get(parentChildId)
				.spawn({ prompt: "go", name, spawnCell: "", parentSessionFile, surface: ["python"] }),
		release: () => {
			releaseTurnNow();
		},
	};
}

/** Let the child turn's fire-and-forget continuation run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("the manager's notices (ticket 06)", () => {
	beforeEach(() => {
		holdTurn();
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

	it("names the join as the read, and the stored transcript only as its fallback", async () => {
		const h = managerHarness();
		const handle = await h.spawn();
		h.release();
		await settle();

		// The read the kernel can make (rlm-wait ticket 01) is the primary one, and it keeps the answer
		// out of the transcript. Measured 2026-10-10: this sentence used to name only the stored
		// transcript, read through `cat` — and a child's session file is 160-249 KB in the delegation
		// A/B, which `bash` truncates at 50 KB, a quarter of a root's context in one message.
		const content = h.notices[0]!.content;
		expect(content).toContain(`await rlm.wait(["${handle.child_id}"])`);
		expect(content).toContain("does not block on a child that has already finished");
		expect(content).toContain("status and usage only");
		expect(content.indexOf("await rlm.wait(")).toBeLessThan(content.indexOf('await bash("cat'));
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
		setTurnBehavior(async () => {
			throw new Error("boom");
		});
		const handle = await h.spawn();
		await settle();
		expect(h.notices[0]!.content).toContain("boom");

		// Resuming clears the previous ending, so a success must not repeat the old failure.
		holdTurn();
		await h.manager.send(handle.child_id, "again");
		h.release();
		await settle();
		expect(h.notices).toHaveLength(2);
		expect(h.notices[1]!.content).not.toContain("boom");
		expect(h.notices[1]!.content).toContain("finished: done");
	});
});

describe("a turn that ends unfinished (2026-09-30)", () => {
	beforeEach(() => {
		holdTurn();
		setChildEntries([]);
	});

	it("reports an aborted turn as failed, not done", async () => {
		const h = managerHarness();
		// pi resolves `prompt()` on an abort instead of throwing, and the aborted assistant message
		// is all the turn leaves behind — so the ending has to read the stop reason.
		setChildEntries([
			{
				id: "a",
				type: "message",
				message: { role: "assistant", stopReason: "aborted", errorMessage: "Request aborted", content: [] },
			},
		]);
		completeTurn();
		const handle = await h.spawn();
		await settle();

		expect(h.manager.poll(handle.child_id).status).toBe("failed");
		expect(h.notices).toHaveLength(1);
		expect(h.notices[0]!.content).toContain("finished: failed");
		expect(h.notices[0]!.content).toContain("aborted");
	});

	it("keeps a teardown's stopped ending against the turn's late resolution", async () => {
		const h = managerHarness();
		const handle = await h.spawn();
		expect(h.manager.poll(handle.child_id).status).toBe("running");

		// The parent shuts down while the turn is in flight. The abort makes `prompt()` resolve
		// afterwards, and that resolution must not rewrite the teardown's `stopped` as `done`.
		await h.manager.shutdownAll();
		h.release();
		await settle();

		expect(h.manager.poll(handle.child_id).status).toBe("stopped");
	});
});

/* ------------------------------------------------------------------ *
 * The verdict on a read (`.scratch/rlm-stop` ticket 06)
 * ------------------------------------------------------------------ */

describe("the verdict a read carries (rlm-stop ticket 06)", () => {
	beforeEach(() => {
		holdTurn();
		setChildEntries([]);
		resetFakeSessions();
	});

	it("marks a quiet running child on every read, and stops marking it once it ends", async () => {
		const h = managerHarness(undefined, 0.05);
		const handle = await h.spawn();
		await new Promise((resolve) => setTimeout(resolve, 120));

		const polled = h.manager.poll(handle.child_id);
		expect(polled.stale).toBe(true);
		expect(polled.idle_seconds).toBeGreaterThanOrEqual(0);
		// No kernel reader is reachable for this child (the fake mounts none), which means *unknown*:
		// the floor decides alone and the phase is absent rather than guessed (ticket 06).
		expect(polled.phase).toBeUndefined();

		const listed = h.manager.list()[0]!;
		expect(listed.stale).toBe(true);
		const joined = await h.manager.wait([handle.child_id], 0.05);
		expect(joined[0]!.stale).toBe(true);
		expect(joined[0]!.status).toBe("running");

		// A terminal child has no clock to read: the fields are absent, not `false`.
		await h.manager.stop(handle.child_id);
		const stopped = h.manager.poll(handle.child_id);
		expect(stopped.status).toBe("stopped");
		expect(stopped.stale).toBeUndefined();
		expect(stopped.idle_seconds).toBeUndefined();
	});

	it("gives a stale child's stop the reason that says what was known", async () => {
		const h = managerHarness(undefined, 0.05);
		const stale = await h.spawn("quiet-one");
		await new Promise((resolve) => setTimeout(resolve, 120));
		const stopped = await h.manager.stop(stale.child_id);
		expect(stopped.reason).toMatch(/^stale: no progress for \d+s$/);
		expect(h.entries.map((entry) => entry.data.reason)).toEqual([stopped.reason]);

		// A child the model stopped for its own reasons keeps those words.
		const healthy = managerHarness(undefined, 600);
		const child = await healthy.spawn("busy-one");
		expect((await healthy.manager.stop(child.child_id, "the task went away")).reason).toBe("the task went away");
		expect((await healthy.manager.stop(child.child_id)).reason).toBe("the task went away");
	});

	it("leaves a working child alone, and lists the stale ones worst first", async () => {
		const h = managerHarness(undefined, 0.05);
		const first = await h.spawn("first");
		await new Promise((resolve) => setTimeout(resolve, 120));
		const second = await h.spawn("second");
		// A child that was spawned a moment ago is not stale yet: the threshold applies to it too.
		expect(h.manager.staleChildren().map((child) => child.name)).toEqual(["first"]);
		await new Promise((resolve) => setTimeout(resolve, 120));

		// Both are quiet now, and `first` has been quiet for longer, so it comes first.
		const stale = h.manager.staleChildren();
		expect(stale.map((child) => child.name)).toEqual(["first", "second"]);
		expect(stale[0]!.idle_seconds).toBeGreaterThanOrEqual(stale[1]!.idle_seconds);
		expect(h.manager.list().map((child) => child.stale)).toEqual([true, true]);
		expect(first.status).toBe("running");
	});

	it("agrees with the handle a stop returns, and with a threshold of zero", async () => {
		const never = managerHarness(undefined, 0);
		const child = await never.spawn();
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(never.manager.poll(child.child_id).stale).toBe(false);
		expect(never.manager.staleChildren()).toEqual([]);
	});
});

/* ------------------------------------------------------------------ *
 * The child's own declaration (`.scratch/rlm-stop` ticket 10)
 * ------------------------------------------------------------------ */

describe("what a child may declare about itself (rlm-stop ticket 10)", () => {
	beforeEach(() => {
		holdTurn();
		setChildEntries([]);
		resetFakeSessions();
	});

	it("lands on the child's own record and rides every read, as a declaration and not a notice", async () => {
		const changes: number[] = [];
		const h = managerHarness(() => changes.push(Date.now()));
		const child = await h.spawn();
		const before = changes.length;

		const receipt = (h.child() as any).note("fitting the model on 40k rows", 1800);
		expect(receipt.ok).toBe(true);
		expect(receipt.expect_seconds).toBe(1800);
		// Nothing was dispatched: state is not a message and not a notice (the ticket's own test).
		expect(h.notices).toHaveLength(0);

		const polled = h.manager.poll(child.child_id);
		expect(polled.progress_note?.text).toBe("fitting the model on 40k rows");
		expect(polled.progress_note?.expect_seconds).toBe(1800);
		expect(h.manager.list()[0]!.progress_note?.text).toBe("fitting the model on 40k rows");
		// And it woke the fanout once, which is what the footer and any waiter ride.
		expect(changes.length).toBe(before + 1);
		// It is not an answer and not a status: the record is still `running`.
		expect(polled.status).toBe("running");
	});

	it("buys patience for work with no host call in flight, and stops once it expires", async () => {
		const h = managerHarness(undefined, 0.05);
		const child = await h.spawn();
		(h.child() as any).note("compiling, honestly", 1800);
		await new Promise((resolve) => setTimeout(resolve, 120));
		const declared = h.manager.poll(child.child_id);
		expect(declared.stale).toBe(false);
		expect(declared.expectation_seconds).toBeGreaterThan(1700);

		// The same declaration, an instant from expiry: nothing has moved, so now it is stale — and the
		// expectation is gone from the report, which is how a reader sees patience run out.
		(h.child() as any).note("compiling, honestly", 0.01);
		await new Promise((resolve) => setTimeout(resolve, 120));
		const expired = h.manager.poll(child.child_id);
		expect(expired.stale).toBe(true);
		expect(expired.expectation_seconds).toBeUndefined();
	});

	it("keeps the newest note, truncates a long one, and refuses a value nothing can be inferred from", async () => {
		const h = managerHarness();
		const child = await h.spawn();
		const note = (text: string, expectSeconds?: number) => (h.child() as any).note(text, expectSeconds);
		note("first");
		note("second");
		expect(h.manager.poll(child.child_id).progress_note?.text).toBe("second");
		expect(h.manager.poll(child.child_id).progress_note?.expect_seconds).toBeNull();

		note("x".repeat(1000));
		expect(h.manager.poll(child.child_id).progress_note?.text).toHaveLength(512);

		expect(() => note("bad", -1)).toThrow(/expect_seconds must be a positive number/);
		expect(() => note("   ")).toThrow(/requires some text/);
		// A refusal changes nothing: the previous note stands.
		expect(h.manager.poll(child.child_id).progress_note?.text).toHaveLength(512);
	});

	it("puts a grandchild's note on the grandchild's own record", async () => {
		const h = managerHarness();
		const child = await h.spawn("parent-child");
		const grand = await h.grandchild(child.child_id, "/tmp/child-1.jsonl", "grand");
		(h.contextOf(grand.child_id) as any).note("deep in the tree", 60);

		const seen = h.manager.list();
		expect(seen.map((record) => record.name)).toEqual(["parent-child", "grand"]);
		expect(seen.find((record) => record.name === "grand")?.progress_note?.text).toBe("deep in the tree");
		expect(seen.find((record) => record.name === "parent-child")?.progress_note).toBeUndefined();
	});

	it("throttles the fanout a chatty child causes, while keeping the newest text", async () => {
		const changes: number[] = [];
		const h = managerHarness(() => changes.push(1));
		const child = await h.spawn();
		const before = changes.length;
		for (let index = 0; index < 5; index += 1) (h.child() as any).note(`step ${index}`);
		// Five notes, one wake: the text is current, the parent's session did not churn.
		expect(changes.length).toBe(before + 1);
		expect(h.manager.poll(child.child_id).progress_note?.text).toBe("step 4");
	});
});

/* ------------------------------------------------------------------ *
 * The status line's count
 * ------------------------------------------------------------------ */

describe("the working count the status line reads", () => {
	beforeEach(() => {
		holdTurn();
	});

	it("announces every transition that changes how many children are working", async () => {
		let changes = 0;
		const h = managerHarness(() => {
			changes++;
		});

		const handle = await h.spawn();
		expect(changes).toBe(1);
		expect(h.manager.liveCount()).toBe(1);

		h.release();
		await settle();
		expect(changes).toBe(2);
		expect(h.manager.liveCount()).toBe(0);

		// Resuming a finished child puts it back to work, so it counts again...
		await h.manager.send(handle.child_id, "again");
		expect(changes).toBe(3);
		expect(h.manager.liveCount()).toBe(1);

		// ...and removing it stops it, so the count falls without a turn ever finishing.
		await h.manager.remove(handle.child_id);
		expect(changes).toBe(4);
		expect(h.manager.liveCount()).toBe(0);
	});

	it("falls to zero when the session tears its children down", async () => {
		let changes = 0;
		const h = managerHarness(() => {
			changes++;
		});
		await h.spawn("one");
		await h.spawn("two");
		expect(h.manager.liveCount()).toBe(2);

		await h.manager.shutdownAll();
		expect(h.manager.liveCount()).toBe(0);
		expect(changes).toBe(3);
	});

	it("names the kernel, and says nothing about zero children", () => {
		expect(statusLine(true, 0)).toBe("rlm: code-mode (monty)");
		expect(statusLine(true, 2)).toBe("rlm: code-mode (monty) ch: 2 running");
		expect(statusLine(false, 0)).toBe("rlm: kernel unavailable");
	});
});

/* ------------------------------------------------------------------ *
 * The ceiling (child-surface tickets 01, 03)
 * ------------------------------------------------------------------ */

describe("the ceiling a child is built with", () => {
	beforeEach(() => {
		capturedSessionOptions.length = 0;
		completeTurn();
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

/* ------------------------------------------------------------------ *
 * The join (rlm-wait tickets 01-04)
 * ------------------------------------------------------------------ */

describe("the answer a join reads (rlm-wait ticket 01)", () => {
	const session = (entries: unknown[]) => ({ sessionManager: managerWithEntries(entries) });

	it("takes the last assistant text, without its thinking or its tool calls", () => {
		const found = answerOf(
			session([
				{ id: "a", type: "message", message: { role: "assistant", content: [{ type: "text", text: "first" }] } },
				{ id: "b", type: "message", message: { role: "user", content: [{ type: "text", text: "again" }] } },
				{
					id: "c",
					type: "message",
					message: {
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "hmm" },
							{ type: "toolCall", name: "bash", arguments: {} },
							{ type: "text", text: "the " },
							{ type: "text", text: "answer" },
						],
					},
				},
			]),
		);
		expect(found).toBe("the answer");
	});

	it("walks back past an assistant turn that said nothing", () => {
		// A child can end a turn on a tool call with no prose; the answer is then whatever it said
		// last, which is not the same as no answer.
		expect(
			answerOf(
				session([
					{ id: "a", type: "message", message: { role: "assistant", content: [{ type: "text", text: "spoke" }] } },
					{ id: "b", type: "message", message: { role: "assistant", content: [{ type: "toolCall", name: "x" }] } },
				]),
			),
		).toBe("spoke");
	});

	it("returns nothing when the child never spoke, or has no session", () => {
		expect(answerOf(session([{ id: "a", type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } }]))).toBeUndefined();
		expect(answerOf(session([]))).toBeUndefined();
		expect(answerOf(null)).toBeUndefined();
	});
});

describe("the join (rlm-wait tickets 01-03)", () => {
	beforeEach(() => {
		holdTurn();
		setChildEntries([]);
	});

	it("returns a finished child's answer, its usage and its status", async () => {
		const h = managerHarness();
		setChildEntries([
			{
				id: "a",
				type: "message",
				message: { role: "assistant", content: [{ type: "thinking", thinking: "…" }], usage: { input: 10, output: 5, total: 15 } },
			},
			{ id: "b", type: "message", message: { role: "assistant", content: [{ type: "text", text: "the answer" }] } },
		]);
		const handle = await h.spawn();
		h.release();
		await settle();

		const records = await h.manager.wait([handle.child_id], 5);
		expect(records).toHaveLength(1);
		expect(records[0]!.child_id).toBe(handle.child_id);
		expect(records[0]!.name).toBe("probe");
		expect(records[0]!.status).toBe("done");
		expect(records[0]!.answer).toBe("the answer");
		expect(records[0]!.usage?.total_tokens).toBe(15);
		// The join read the child, so the completion notice it would have sent is withdrawn...
		expect(h.notices).toHaveLength(1);
		expect(h.notices[0]!.cancelled?.()).toBe(true);
	});

	it("wakes on the transition, not on its deadline", async () => {
		const h = managerHarness();
		const handle = await h.spawn();
		const started = Date.now();
		const waiting = h.manager.wait([handle.child_id], 30);
		setTimeout(() => h.release(), 20);
		const records = await waiting;
		expect(records[0]!.status).toBe("done");
		expect(Date.now() - started).toBeLessThan(5_000);
	});

	it("returns a running child with no answer when the patience runs out, and leaves its notice alone", async () => {
		const h = managerHarness();
		const handle = await h.spawn();
		const started = Date.now();
		const records = await h.manager.wait([handle.child_id], 0.05);
		expect(Date.now() - started).toBeGreaterThanOrEqual(40);
		expect(records[0]!.status).toBe("running");
		expect(records[0]!.answer).toBeUndefined();

		// A timed-out join is a status read: the child that finishes afterwards still notifies.
		h.release();
		await settle();
		expect(h.notices).toHaveLength(1);
		expect(h.notices[0]!.cancelled?.()).toBe(false);
	});

	it("refuses the call when a selector matches nothing, rather than returning a shorter list", async () => {
		const h = managerHarness();
		await expect(h.manager.wait(["child-9"], 1)).rejects.toThrow(/no child matches "child-9"/);
	});

	it("never withdraws a child's own message, even after the child was read", async () => {
		const h = managerHarness();
		const handle = await h.spawn();
		h.child().onMessage("a progress note");
		h.release();
		await settle();
		const message = h.notices.find((notice) => notice.key.startsWith("msg:"));
		const completed = h.notices.find((notice) => notice.key.startsWith("done:"));
		expect(message).toBeDefined();
		expect(completed).toBeDefined();

		// Reading the child — a poll or a join, the same flag either way — withdraws its *status*
		// notice. What it sent is content, and content is never withdrawn (ticket 02).
		h.manager.poll(handle.child_id);
		expect(completed!.cancelled?.()).toBe(true);
		expect(message!.cancelled).toBeUndefined();
	});
});

/* ------------------------------------------------------------------ *
 * The stop verb, and the tree it walks (`.scratch/rlm-stop` tickets 03/04)
 * ------------------------------------------------------------------ */

describe("the stop verb (rlm-stop ticket 03)", () => {
	beforeEach(() => {
		holdTurn();
		setChildEntries([]);
		resetFakeSessions();
	});

	it("marks the record stopped, keeps it listed, and stops counting it as working", async () => {
		const h = managerHarness();
		const handle = await h.spawn();
		expect(h.manager.liveCount()).toBe(1);

		const stopped = await h.manager.stop(handle.child_id);
		expect(stopped.status).toBe("stopped");
		expect(stopped.ended_at).toBeTruthy();
		expect(stopped.reason).toBe("stopped by parent");
		expect(h.manager.liveCount()).toBe(0);

		// The evidence stays: a stopped record is still readable, and its name is still reserved.
		expect(h.manager.list().map((child) => child.child_id)).toEqual([handle.child_id]);
		expect(h.manager.poll(handle.child_id).status).toBe("stopped");
	});

	it("returns before the teardown, which then disposes the child's session", async () => {
		const h = managerHarness();
		const handle = await h.spawn();
		// The teardown's only unbounded step is the child's own `session_shutdown` handler — the shape a
		// monty-spinning child never lets finish. A stop that waited for it would hang on exactly the
		// child the verb exists for (ticket 03 §3), so hold it and assert the stop still returns.
		let releaseShutdown: (() => void) | null = null;
		setShutdownBehavior(() => new Promise<void>((resolve) => (releaseShutdown = resolve)));

		const stopped = await h.manager.stop(handle.child_id, "no progress for 12m");
		expect(stopped.status).toBe("stopped");
		expect(disposedSessions).toHaveLength(0);

		releaseShutdown!();
		await settle();
		expect(shutdownReasons).toEqual(["quit"]);
		expect(disposedSessions).toEqual([handle.session_file!]);
	});

	it("writes one rlm-stop entry and sends no notice", async () => {
		const h = managerHarness();
		const handle = await h.spawn();
		await h.manager.stop(handle.child_id, "no progress for 12m");

		expect(h.entries).toHaveLength(1);
		expect(h.entries[0]!.customType).toBe("rlm-stop");
		expect(h.entries[0]!.data).toEqual({
			child_id: handle.child_id,
			reason: "no progress for 12m",
			stopped_ids: [handle.child_id],
		});
		// The model caused this ending: it is not told about it (ticket 03 §5).
		await settle();
		expect(h.notices).toHaveLength(0);
	});

	it("bounds and trims the reason, and defaults an empty one", async () => {
		const h = managerHarness();
		const first = await h.spawn("one");
		await h.manager.stop(first.child_id, `  ${"x".repeat(300)}  `);
		expect(h.entries[0]!.data.reason).toHaveLength(200);

		const second = await h.spawn("two");
		await h.manager.stop(second.child_id, "   ");
		expect(h.entries[1]!.data.reason).toBe("stopped by parent");

		expect(cleanReason(undefined)).toBeUndefined();
		expect(cleanReason("  spaced  ")).toBe("spaced");
	});

	it("refuses send to a stopped child, and says what to do instead", async () => {
		const h = managerHarness();
		const handle = await h.spawn();
		await h.manager.stop(handle.child_id, "no progress for 12m");

		await expect(h.manager.send(handle.child_id, "again")).rejects.toThrow(
			/rlm\.send: child-1 is not resumable \(stopped: no progress for 12m\); spawn a new child instead of resuming it\./,
		);
		expect(h.manager.poll(handle.child_id).status).toBe("stopped");
	});

	it("keeps the stopped ending against the turn's late resolution", async () => {
		const h = managerHarness();
		const handle = await h.spawn();
		await h.manager.stop(handle.child_id);
		// The child's own turn resolves afterwards (pi resolves `prompt()` on an abort); the ending
		// belongs to whoever got there first (the rule `shutdownAll` already relied on).
		h.release();
		await settle();
		expect(h.manager.poll(handle.child_id).status).toBe("stopped");
	});

	it("is idempotent on a child that already ended, and writes no entry for it", async () => {
		const h = managerHarness();
		const handle = await h.spawn();
		h.release();
		await settle();
		expect(h.manager.poll(handle.child_id).status).toBe("done");

		const again = await h.manager.stop(handle.child_id);
		expect(again.status).toBe("done");
		expect(again.ended_at).toBeTruthy();
		expect(h.entries).toHaveLength(0);
	});
});

describe("the tree a stop walks (rlm-stop ticket 04)", () => {
	beforeEach(() => {
		holdTurn();
		setChildEntries([]);
		resetFakeSessions();
	});

	it("cascades into the child's own descendants, naming the author on each", async () => {
		const h = managerHarness();
		const child = await h.spawn("parent");
		const grand = await h.grandchild(child.child_id, child.session_file!, "grand");
		expect(grand.status).toBe("running");

		await h.manager.stop(child.child_id, "no progress for 12m");

		const records = h.manager.list();
		expect(records.map((record) => record.status)).toEqual(["stopped", "stopped"]);
		expect(h.manager.poll(child.child_id).reason).toBe("no progress for 12m");
		expect(h.manager.poll(grand.child_id).reason).toBe(`stopped with ${child.child_id} (no progress for 12m)`);
		// Parent first, then depth-first: the order the walk stopped them in.
		expect(h.entries[0]!.data.stopped_ids).toEqual([child.child_id, grand.child_id]);

		await settle();
		expect(disposedSessions).toEqual([child.session_file, grand.session_file]);
	});

	it("still cascades when the named child had already finished", async () => {
		const h = managerHarness();
		const child = await h.spawn("parent");
		h.release();
		await settle();
		expect(h.manager.poll(child.child_id).status).toBe("done");

		// A grandchild spawned after its parent's turn ended is still running, and the line of work is
		// what the model asked to end.
		const grand = await h.grandchild(child.child_id, child.session_file!, "grand");
		await h.manager.stop(child.child_id);

		expect(h.manager.poll(child.child_id).status).toBe("done");
		expect(h.manager.poll(grand.child_id).status).toBe("stopped");
	});

	it("bounds a child to itself and below: a sibling, a parent and itself are refused", async () => {
		const h = managerHarness();
		const first = await h.spawn("first");
		const second = await h.spawn("second");
		const grand = await h.grandchild(first.child_id, first.session_file!, "grand");

		const context = h.contextOf(first.child_id);
		// A sibling is not below it, and the refusal names the verb the caller used.
		await expect(context.stop(second.child_id)).rejects.toThrow(/rlm\.stop: child-2 is not below this session\./);
		await expect(context.remove(second.child_id)).rejects.toThrow(/rlm\.remove: child-2 is not below this session\./);
		// Nor is itself: the cascade would dispose the session running the cell that asked.
		await expect(context.stop(first.child_id)).rejects.toThrow(/rlm\.stop: a session cannot stop itself\./);
		// What *is* below it works, and so does the root's own reach over anything.
		await expect(context.stop(grand.child_id)).resolves.toMatchObject({ status: "stopped" });
		expect(second.status).toBe("running");
	});

	it("remove stops first, then forgets the named record and only that one", async () => {
		const h = managerHarness();
		const child = await h.spawn("parent");
		const grand = await h.grandchild(child.child_id, child.session_file!, "grand");

		const forgotten = await h.manager.remove(child.child_id);
		expect(forgotten.status).toBe("stopped");

		// The named record is gone from every read; its descendant stays, with its reason.
		expect(h.manager.list().map((record) => record.child_id)).toEqual([grand.child_id]);
		// `poll` is synchronous, so its refusal is a throw rather than a rejection.
		expect(() => h.manager.poll(child.child_id)).toThrow(/no child matches/);
		expect(h.manager.poll(grand.child_id).status).toBe("stopped");
	});
});

describe("the footer's tree total (rlm-wait ticket 04)", () => {
	it("appends the tokens when there are any, and leaves the line alone when there are none", () => {
		expect(statusLine(true, 0, 0)).toBe("rlm: code-mode (monty)");
		expect(statusLine(true, 0, undefined)).toBe("rlm: code-mode (monty)");
		expect(statusLine(true, 2, 141_400)).toBe("rlm: code-mode (monty) ch: 2 running · 141k tok");
		expect(statusLine(true, 0, 2_381)).toBe("rlm: code-mode (monty) · 2k tok");
		expect(statusLine(true, 0, 999)).toBe("rlm: code-mode (monty) · 999 tok");
		expect(statusLine(false, 1, 400)).toBe("rlm: kernel unavailable ch: 1 running · 400 tok");
	});

	it("appends the stale clause only when there is one (rlm-stop ticket 07)", () => {
		// The regression guard this ticket was written around: a healthy line must not move a byte.
		expect(statusLine(true, 2, 141_400, undefined)).toBe("rlm: code-mode (monty) ch: 2 running · 141k tok");
		expect(statusLine(true, 2, undefined, { count: 0, name: "x", idle_seconds: 60 })).toBe(
			"rlm: code-mode (monty) ch: 2 running",
		);
		// One stale child, named, with the age the stop's own reason would print.
		expect(statusLine(true, 2, 141_400, { count: 1, name: "ship-mesa-verify", idle_seconds: 68_400 })).toBe(
			"rlm: code-mode (monty) ch: 2 running · 1 stale: ship-mesa-verify 19h · 141k tok",
		);
		// More than one: the worst is named (the list is sorted worst-first) and the rest counted.
		expect(statusLine(true, 3, undefined, { count: 2, name: "worst", idle_seconds: 720 })).toBe(
			"rlm: code-mode (monty) ch: 3 running · 2 stale: worst 12m (+1 more)",
		);
		// A model-chosen name is bounded: the line is read every turn.
		expect(statusLine(true, 1, undefined, { count: 1, name: "a".repeat(40), idle_seconds: 45 })).toBe(
			`rlm: code-mode (monty) ch: 1 running · 1 stale: ${"a".repeat(24)} 45s`,
		);
	});

	it("prints every age the same way the stop reason does (one formatter)", () => {
		expect(ageText(0)).toBe("0s");
		expect(ageText(45)).toBe("45s");
		expect(ageText(59)).toBe("59s");
		expect(ageText(60)).toBe("1m");
		expect(ageText(720)).toBe("12m");
		expect(ageText(3599)).toBe("60m");
		expect(ageText(3600)).toBe("1h");
		expect(ageText(68_400)).toBe("19h");
		expect(ageText(-5)).toBe("0s");
	});
});


describe("the footer's own work in flight (long-work tickets 04 and 09)", () => {
	it("adds a clause per thing in flight, and adds nothing when there is nothing", () => {
		// Nothing in flight — and no reader — leaves the line exactly as it was.
		expect(statusLine(true, 1, 141_400, undefined, undefined)).toBe("rlm: code-mode (monty) ch: 1 running · 141k tok");
		expect(statusLine(true, 0, undefined, undefined, {})).toBe("rlm: code-mode (monty)");

		// The session's own call, with the bound it will be killed at — the denominator is the point:
		// "4m" is only an age, "4m/10m" is nearly out of time.
		expect(statusLine(true, 0, undefined, undefined, { call: { detail: "bun test", age_ms: 240_000, timeout_s: 600 } })).toBe(
			"rlm: code-mode (monty) · run: bun test 4m/10m",
		);
		// Unbounded is the default, so it prints no denominator.
		expect(statusLine(true, 0, undefined, undefined, { call: { detail: "bun test", age_ms: 240_000, timeout_s: null } })).toBe(
			"rlm: code-mode (monty) · run: bun test 4m",
		);

		// A cell with nothing to name: the spin, which `calls` cannot see (09).
		expect(statusLine(true, 0, undefined, undefined, { cell: { age_ms: 3_060_000, budget_s: 3600 } })).toBe(
			"rlm: code-mode (monty) · cell: 51m/1h",
		);

		// One shell names itself; several name the worst and count the rest, like the stale clause.
		expect(
			statusLine(true, 0, undefined, undefined, { backgrounds: [{ command: "bun test", age_ms: 1_140_000, timeout_s: null }] }),
		).toBe("rlm: code-mode (monty) · bg: bun test 19m");
		expect(
			statusLine(true, 0, undefined, undefined, {
				backgrounds: [
					{ command: "fast", age_ms: 60_000, timeout_s: null },
					{ command: "slow", age_ms: 1_140_000, timeout_s: null },
					{ command: "mid", age_ms: 300_000, timeout_s: null },
				],
			}),
		).toBe("rlm: code-mode (monty) · bg: 3 running · worst slow 19m");
		// A shell whose age this process cannot vouch for (a restore, or a handle that ended elsewhere)
		// prints without one rather than as `0s`, which would be a false answer.
		expect(statusLine(true, 0, undefined, undefined, { backgrounds: [{ command: "restored", age_ms: null, timeout_s: null }] })).toBe(
			"rlm: code-mode (monty) · bg: restored",
		);
	});

	it("keeps one order, and a long command short", () => {
		const line = statusLine(true, 2, 141_400, { count: 1, name: "worst", idle_seconds: 68_400 }, {
			cell: { age_ms: 120_000, budget_s: 3600 },
			backgrounds: [{ command: "b".repeat(50), age_ms: 3_600_000, timeout_s: 7200 }],
		});
		expect(line).toBe(
			`rlm: code-mode (monty) ch: 2 running · cell: 2m/1h · bg: ${"b".repeat(32)}… 1h/2h · 1 stale: worst 19h · 141k tok`,
		);
	});
});

describe("reading the session's own kernel for the footer (long-work ticket 04)", () => {
	const REGISTRY = Symbol.for("pi-code-mode:registry");
	const ctx = { sessionManager: { getSessionFile: () => "/tmp/long-work/footer.jsonl" } };

	/** Put a kernel entry where `findKernel` looks, and hand back the undo. */
	function withKernel(handle: unknown | null): () => void {
		const glob = globalThis as Record<symbol, unknown>;
		const saved = glob[REGISTRY];
		if (handle !== null) {
			glob[REGISTRY] = {
				publisher: "pi-code-mode",
				apiVersion: 1,
				sessions: new Map([[sessionKey(ctx), handle]]),
				mount: () => {},
			};
		} else {
			delete glob[REGISTRY];
		}
		return () => {
			if (saved === undefined) delete glob[REGISTRY];
			else glob[REGISTRY] = saved;
		};
	}

	it("answers nothing at all without a kernel, and nothing that reads as idle", () => {
		const restore = withKernel(null);
		try {
			expect(flightOf(ctx)).toBeUndefined();
		} finally {
			restore();
		}
		// A kernel that publishes no readers (an older code mode): still nothing, never a fake idle line.
		// A kernel that publishes no readers (an older code mode): still nothing, never a fake idle line.
		const restore2 = withKernel({ sessionKey: sessionKey(ctx), problems: () => [] });
		try {
			expect(flightOf(ctx)).toBeUndefined();
		} finally {
			restore2();
		}
	});

	it("reads a call in flight, a cell with none, and only the shells still running", () => {
		const activity = {
			cell_running: true,
			calls: [{ name: "bash_host", detail: "bun test", started_at: "2026-10-10T00:00:00.000Z", age_ms: 240_000, timeout_s: 600 }],
			cell_age_ms: 300_000,
			cell_budget_s: 3600,
		};
		const restore = withKernel({
			sessionKey: sessionKey(ctx),
			problems: () => [],
			activity: () => activity,
			backgrounds: () => [
				{ id: "bg-1", command: "bun test", status: "running", started_at: "", age_ms: 1_140_000, timeout_s: null },
				{ id: "bg-2", command: "done already", status: "done", started_at: "", age_ms: null, timeout_s: null },
			],
		});
		try {
			expect(flightOf(ctx)).toEqual({
				call: { detail: "bun test", age_ms: 240_000, timeout_s: 600 },
				backgrounds: [{ id: "bg-1", command: "bun test", status: "running", started_at: "", age_ms: 1_140_000, timeout_s: null }],
			});
			// With a call to name, the cell's own age adds nothing: `call` and `cell` do not both appear.
			expect(flightOf(ctx)?.cell).toBeUndefined();
		} finally {
			restore();
		}
	});

	it("names the cell when it has no call to name, which is the shape a spin has", () => {
		const restore = withKernel({
			sessionKey: sessionKey(ctx),
			problems: () => [],
			activity: () => ({ cell_running: true, calls: [], cell_age_ms: 5_000, cell_budget_s: 3600 }),
		});
		try {
			expect(flightOf(ctx)).toEqual({ cell: { age_ms: 5_000, budget_s: 3600 } });
		} finally {
			restore();
		}
	});
});
