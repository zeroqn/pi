/**
 * The entry's mount, for a session that is not the instance that published.
 *
 * An RLM child mounts through the registry from the *root's* code-mode instance: the mounter's
 * `create` receives the child's own api as `sessionPi`, while the factory closure holds the
 * spawner's. Registering the tool on the closure left a child with no `python` tool at all, and
 * its `setActiveTools(["python"])` then silently emptied its active set. The fix is that the api
 * travels with the mount.
 *
 * The same shape is why the kernel travels on the handle: a child loads no code-mode entry of its
 * own, and a `/new` or `/reload` re-imports this one, so the instance that *creates* a kernel and
 * the instance that later handles its ctx are two different objects. A per-instance kernel map
 * could not see across that gap, which left a child's kernel undumped and unclosed for as long as
 * the process lived (and, after a `/new`, unreachable even in principle).
 *
 * No monty: `createKernel` only builds the object here; the pool opens on the first cell.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { REGISTRY_KEY, type RegistryEntry } from "../src/contract";
import codeMode from "../index";

type Handler = (event: unknown, ctx: unknown) => unknown;

type FakePi = {
	registered: string[];
	active: string[];
	entries: { type: string; payload: unknown }[];
	handlers: Map<string, Handler[]>;
	registerTool(tool: { name: string }): void;
	setActiveTools(names: string[]): void;
	getActiveTools(): string[];
	getAllTools(): { name: string }[];
	on(event: string, handler: Handler): void;
	appendEntry(type: string, payload: unknown): void;
	sendMessage(...args: unknown[]): void;
	/** Fire one of the entry's handlers, the way pi would. */
	emit(event: string, ctx: unknown): Promise<void>;
};

function fakePi(): FakePi {
	const registered: string[] = [];
	const active: string[] = [];
	const entries: { type: string; payload: unknown }[] = [];
	const handlers = new Map<string, Handler[]>();
	return {
		registered,
		active,
		entries,
		handlers,
		registerTool(tool) {
			if (!registered.includes(tool.name)) registered.push(tool.name);
		},
		setActiveTools(names) {
			active.splice(0, active.length, ...names);
		},
		getActiveTools: () => [...active],
		getAllTools: () => registered.map((name) => ({ name })),
		on(event, handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		appendEntry(type, payload) {
			entries.push({ type, payload });
		},
		sendMessage() {},
		async emit(event, ctx) {
			for (const handler of handlers.get(event) ?? []) await handler({ type: event }, ctx);
		},
	};
}

function ctxFor(file: string) {
	return { sessionManager: { getSessionFile: () => file } };
}

/**
 * A ctx whose session can be ended the way pi ends one: the runner is invalidated, and from then on
 * *every* property of the ctx throws. `sessionIsAlive` is what tells this apart from an idle session.
 */
function disposableCtx(file: string) {
	const state = { alive: true };
	return {
		state,
		ctx: {
			get sessionManager() {
				if (!state.alive) throw new Error("This extension ctx is stale after session replacement or reload.");
				return { getSessionFile: () => file };
			},
		} as unknown,
	};
}

/** Replace a kernel's `shutdown` so a test can see that it was reached and closed. */
function spyShutdown(entry: RegistryEntry, key: string, closed: string[]): void {
	const handle = entry.sessions.get(key);
	if (!handle) throw new Error(`no kernel mounted for ${key}`);
	(handle.kernel as { shutdown: () => Promise<void> }).shutdown = async () => {
		closed.push(key);
	};
}

const glob = globalThis as Record<symbol, unknown>;
const saved = glob[REGISTRY_KEY];

afterAll(() => {
	if (saved === undefined) delete glob[REGISTRY_KEY];
	else glob[REGISTRY_KEY] = saved;
});

describe("mounting a second session through the published entry", () => {
	beforeEach(() => {
		delete glob[REGISTRY_KEY];
	});

	it("registers `python` on the mounting session's api, not the publisher's", () => {
		const spawner = fakePi();
		codeMode(spawner as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;
		const child = fakePi();
		entry.mount(child as never, ctxFor("/sessions/child.jsonl"));
		expect(child.registered).toEqual(["python"]);
		// The empty active set was the old symptom: pi ignores an unknown name, so the child
		// was left with nothing callable.
		expect(child.active).toEqual(["python"]);
		expect(spawner.registered).toEqual([]);
	});

	it("registers `python` on the spawner's own api", () => {
		const spawner = fakePi();
		codeMode(spawner as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;
		entry.mount(spawner as never, ctxFor("/sessions/root.jsonl"));
		expect(spawner.registered).toEqual(["python"]);
		expect(spawner.active).toEqual(["python"]);
	});

	it("shuts down a kernel a different instance mounted (the `/reload` shape)", async () => {
		// `/reload` re-imports this entry while the session keeps its kernel. The instance that ends
		// up handling the shutdown is therefore *not* the one whose `create` ran, and with a local map
		// it found nothing: no dump, no closed checkout, no closed pool — and no way for anything else
		// to find it either.
		const spawner = fakePi();
		codeMode(spawner as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;
		const root = ctxFor("/sessions/root.jsonl");
		entry.mount(spawner as never, root);
		const closed: string[] = [];
		spyShutdown(entry, "/sessions/root.jsonl", closed);

		const reloaded = fakePi();
		codeMode(reloaded as never);
		await reloaded.emit("session_shutdown", root);

		expect(closed).toEqual(["/sessions/root.jsonl"]);
		expect(entry.sessions.has("/sessions/root.jsonl")).toBe(false);
	});

	it("publishes the child instance, and the child instance does not take the entry over", () => {
		// A spawned child loads no ambient extensions, so its loader is handed the factory from the
		// published entry instead of importing this module. What it builds is a code-mode instance on
		// the child's own runner — the one that emits `agent_end` and `session_shutdown` — and it must
		// be a *joiner*: the entry live consumers hold has to keep pointing at the instance whose
		// handlers serve their sessions.
		const spawner = fakePi();
		codeMode(spawner as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;
		const mount = entry.mount;
		expect(typeof entry.childExtension).toBe("function");

		const child = fakePi();
		const childInstance = entry.childExtension?.();
		if (!childInstance) throw new Error("the entry published no child extension");
		childInstance(child as never);

		expect(glob[REGISTRY_KEY]).toBe(entry);
		expect((glob[REGISTRY_KEY] as RegistryEntry).mount).toBe(mount);
		// The lifecycle, and nothing else: these are the events the child's runner emits, and without
		// an instance on it no `agent_end` and no `session_shutdown` ever reached the child's kernel.
		expect([...child.handlers.keys()].sort()).toEqual(["agent_end", "session_shutdown", "session_start"]);
	});

	it("joins the spawner's kernel — one kernel per session, whoever asks first", async () => {
		const spawner = fakePi();
		codeMode(spawner as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;
		const childCtx = ctxFor("/sessions/child.jsonl");
		// The spawner mounted this child's kernel through the registry (rlm's bind), so the child's own
		// instance has to find it in the shared map rather than create a second one.
		const mounted = entry.mount(spawner as never, childCtx);
		let started = 0;
		(mounted.kernel as { startSession: () => Promise<string[]> }).startSession = async () => {
			started += 1;
			return [];
		};

		const child = fakePi();
		const childInstance = entry.childExtension?.();
		if (!childInstance) throw new Error("the entry published no child extension");
		childInstance(child as never);
		await child.emit("session_start", childCtx);

		expect(entry.sessions.get("/sessions/child.jsonl")).toBe(mounted);
		expect(started).toBe(1);
		// `create` never ran for the child's instance, so it registers nothing: the tool lives on the
		// api the spawner's `create` was handed.
		expect(child.registered).toEqual([]);
		expect(child.entries.filter((recorded) => recorded.type === "code-mode-mount")).toEqual([
			{ type: "code-mode-mount", payload: { sessionKey: "/sessions/child.jsonl", mounts: 2 } },
		]);
	});

	it("reaps the kernels of sessions that are gone, and only those", async () => {
		// The child case. RLM disposes a child through the *child's* runner, and the child loads no
		// code-mode entry, so the kernel its spawner mounted is never told and never closed; the same
		// goes for a `/new`, after which the instance that mounted the outgoing session's kernels is
		// gone with its map. `session_start` is the first moment both are provably dead: pi tears the
		// outgoing session down before it builds the incoming one.
		const spawner = fakePi();
		codeMode(spawner as never);
		const entry = glob[REGISTRY_KEY] as RegistryEntry;

		const gone = disposableCtx("/sessions/child-gone.jsonl");
		entry.mount(spawner as never, gone.ctx);
		const idle = disposableCtx("/sessions/child-idle.jsonl");
		entry.mount(spawner as never, idle.ctx);
		// The child was disposed: its session is gone, while the idle sibling is a finished child that
		// `send` can still resume — a session that is *gone* is not the same as one that is idle.
		gone.state.alive = false;
		const closed: string[] = [];
		spyShutdown(entry, "/sessions/child-gone.jsonl", closed);
		spyShutdown(entry, "/sessions/child-idle.jsonl", closed);

		const next = fakePi();
		codeMode(next as never);
		// The incoming session's kernel is mounted first so that this test stays about the reap: the
		// handler then joins it instead of calling `create` + `startSession`, and the preflight — which
		// loads monty — never runs.
		const ownCtx = ctxFor("/sessions/root2.jsonl");
		entry.mount(next as never, ownCtx);
		const own = entry.sessions.get("/sessions/root2.jsonl")!.kernel as { startSession: () => Promise<string[]> };
		own.startSession = async () => [];
		await next.emit("session_start", ownCtx);

		expect(closed).toEqual(["/sessions/child-gone.jsonl"]);
		expect(entry.sessions.has("/sessions/child-gone.jsonl")).toBe(false);
		expect(entry.sessions.has("/sessions/child-idle.jsonl")).toBe(true);
		expect(next.entries.filter((recorded) => recorded.type === "code-mode-reaped")).toEqual([
			{ type: "code-mode-reaped", payload: { sessionKey: "/sessions/child-gone.jsonl" } },
		]);
	});
});
