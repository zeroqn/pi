/**
 * The live-work rendezvous: what host-bridge publishes for a reader that does not import it (Magic
 * Context's todo refresh), and what it aggregates to answer.
 *
 * Three rules are pinned here, because each is a way for the answer to be wrong in a direction nobody
 * sees: the reader is a *function on the symbol* taking pi's ctx (a reader cannot import this package);
 * the aggregate is the contributors' work **plus** the kernel's own running background shells; and a
 * session that ended takes its answer with it, or a later reader is told about a kernel that is gone.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type KernelHandle, REGISTRY_KEY } from "../src/client";
import { composeSession, installHandlers } from "../src/compose";
import {
	LIVE_WORK_SYMBOL,
	__resetHostBridgeForTests,
	forgetSession,
	pruneSessions,
	registerContributor,
	sessionKey,
} from "../src/convention";

type Handler = (event: any, ctx: any) => unknown;

function fakePi() {
	const handlers: Record<string, Handler[]> = {};
	return {
		pi: {
			on(event: string, handler: Handler) {
				(handlers[event] ??= []).push(handler);
			},
			appendEntry() {},
		},
		async emit(event: string, ev: any, ctx: any): Promise<unknown[]> {
			const out: unknown[] = [];
			for (const handler of handlers[event] ?? []) out.push(await handler(ev, ctx));
			return out;
		},
	};
}

function fakeKernel(overrides: Partial<KernelHandle> = {}): KernelHandle {
	return {
		publisher: "pi-code-mode",
		apiVersion: 1,
		sessionKey: "/tmp/sessions/a.jsonl",
		mounts: 1,
		currentCell: () => "",
		root: () => "/tmp/project",
		scratch: () => "/tmp/scratch",
		progress: () => undefined,
		problems: async () => [],
		contribute: (contribution) => ({
			owner: contribution.owner,
			accepted: Object.keys(contribution.hostFns ?? {}),
			rejected: [],
		}),
		...overrides,
	};
}

function installRegistry(handle: KernelHandle) {
	(globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = {
		publisher: "pi-code-mode",
		apiVersion: 1,
		sessions: new Map([[handle.sessionKey, handle]]),
		mount: () => handle,
	};
}

function sessionCtx(file = "/tmp/sessions/a.jsonl") {
	return { cwd: "/tmp/project", sessionManager: { getSessionFile: () => file } };
}

/** The reader as an outside extension sees it: no import, just the symbol. */
function readLiveWork(ctx: unknown): { count: number; names: string[] } | null {
	const reader = (globalThis as Record<symbol, unknown>)[LIVE_WORK_SYMBOL];
	expect(typeof reader).toBe("function");
	return (reader as (ctx: unknown) => { count: number; names: string[] } | null)(ctx);
}

function shell(id: string, status: string) {
	return {
		id,
		command: `run ${id}`,
		status,
		started_at: "2026-10-16T00:00:00.000Z",
		age_ms: 1000,
		timeout_s: null,
	};
}

async function composeWith(
	answer: Record<string, unknown>,
	handle: KernelHandle = fakeKernel(),
): Promise<void> {
	installRegistry(handle);
	registerContributor({ key: "pi-rlm@1", owner: "rlm", apiVersion: 1, session: () => answer });
	const { pi } = fakePi();
	installHandlers(pi);
	await composeSession({ pi, ctx: sessionCtx() });
}

beforeEach(() => {
	__resetHostBridgeForTests();
	delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
});

afterEach(() => {
	delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
});

describe("the published reader", () => {
	test("takes pi's ctx, keys the session itself, and answers a session it never composed with null", async () => {
		await composeWith({ liveWork: () => ({ count: 2, names: ["a", "b"] }) });
		expect(readLiveWork(sessionCtx())).toEqual({ count: 2, names: ["a", "b"] });
		// A session this process has no answer for: `null`, which a reader must read as "nothing known
		// here" rather than as zero.
		expect(readLiveWork(sessionCtx("/tmp/sessions/other.jsonl"))).toBeNull();
		expect(readLiveWork(null)).toBeNull();
	});
});

describe("what the answer aggregates", () => {
	test("counts the running background shells the kernel holds, and only those", async () => {
		await composeWith(
			{},
			fakeKernel({
				backgrounds: () => [shell("bg-1", "running"), shell("bg-2", "done"), shell("bg-3", "running")],
			}),
		);
		expect(readLiveWork(sessionCtx())).toEqual({
			count: 2,
			names: ["bg-1 (run bg-1)", "bg-3 (run bg-3)"],
		});
	});

	test("adds a contributor's answer to the kernel's, in that order", async () => {
		await composeWith(
			{ liveWork: () => ({ count: 1, names: ["kernel7210-lto"] }) },
			fakeKernel({ backgrounds: () => [shell("bg-7", "running")] }),
		);
		expect(readLiveWork(sessionCtx())).toEqual({
			count: 2,
			names: ["kernel7210-lto", "bg-7 (run bg-7)"],
		});
	});

	test("answers zero for a session whose work has all ended, not null", async () => {
		await composeWith({ liveWork: () => ({ count: 0, names: [] }) });
		expect(readLiveWork(sessionCtx())).toEqual({ count: 0, names: [] });
	});

	test("tolerates a missing backgrounds() on an older code mode, and a contributor with no answer", async () => {
		await composeWith({ liveWork: () => ({ count: 3, names: ["x"] }) }, fakeKernel());
		expect(readLiveWork(sessionCtx())).toEqual({ count: 3, names: ["x"] });
	});

	test("drops a contributor that throws or answers nonsense, and keeps the rest", async () => {
		installRegistry(fakeKernel({ backgrounds: () => [shell("bg-9", "running")] }));
		registerContributor({
			key: "pi-broken@1",
			owner: "broken",
			apiVersion: 1,
			session: () => ({
				liveWork: () => {
					throw new Error("the manager is gone");
				},
			}),
		});
		registerContributor({
			key: "pi-nonsense@1",
			owner: "nonsense",
			apiVersion: 1,
			session: () => ({
				liveWork: () => ({ count: Number.NaN, names: ["ok", 7 as unknown as string] }),
			}),
		});
		const { pi } = fakePi();
		installHandlers(pi);
		await composeSession({ pi, ctx: sessionCtx() });
		expect(readLiveWork(sessionCtx())).toEqual({ count: 1, names: ["ok", "bg-9 (run bg-9)"] });
	});

	test("is live: a contributor's thunk is asked on every read", async () => {
		let running = 2;
		await composeWith({ liveWork: () => ({ count: running, names: ["a", "b"].slice(0, running) }) });
		expect(readLiveWork(sessionCtx())?.count).toBe(2);
		running = 0;
		expect(readLiveWork(sessionCtx())).toEqual({ count: 0, names: [] });
	});
});

describe("a session that ends", () => {
	test("takes its answer with it — shutdown, forget and prune each clear it", async () => {
		const key = sessionKey(sessionCtx());
		await composeWith({ liveWork: () => ({ count: 1, names: ["a"] }) });
		expect(readLiveWork(sessionCtx())?.count).toBe(1);
		forgetSession(key);
		expect(readLiveWork(sessionCtx())).toBeNull();

		await composeWith({ liveWork: () => ({ count: 1, names: ["a"] }) });
		pruneSessions(() => true);
		expect(readLiveWork(sessionCtx())).toBeNull();
	});
});
