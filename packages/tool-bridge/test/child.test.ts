/**
 * The child path, end to end through the seam: the first owner's child shim, the ceiling's policy, and
 * the containment the seam owes every contributor (`.scratch/tool-ownership` ticket 05,
 * `.scratch/child-surface` tickets 03-06; re-homed by `.scratch/host-bridge` ticket 05).
 *
 * What this file is *not*: a test of the composition. The seam's own order, its detector, its factory
 * list and its bind dispatch are `pi-host-bridge`'s, tested there. What is left here is what is
 * genuinely this package's — the owner's child behaviour, the child-eligibility policy that feeds the
 * ceiling, and the fact that both are actually wired into the registration a live process reads.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import { bindChild, childCeiling, childFactories, childStatus } from "../../host-bridge/src/compose";
import { __resetHostBridgeForTests, registerContributor } from "../../host-bridge/src/convention";
import { __resetToolBridgeForTests } from "../src/convention";
import { toolBridgeRegistration } from "../src/registration";
import { childEligibleTools } from "../src/owners";

const REGISTRY_KEY = Symbol.for("@cortexkit/magic-context:pi-registry");

/** A registry that answers the shape the owner looks for, with per-test overrides. */
function installRegistry(overrides: Record<string, unknown> = {}): void {
	(globalThis as Record<symbol, unknown>)[REGISTRY_KEY] = {
		transformContext: async () => undefined,
		compact: async () => undefined,
		scrubMessage: () => {},
		bindChild: () => {},
		...overrides,
	};
}

function clearRegistry(): void {
	delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
}

/** The child's own `pi`, recording what a factory registers and which handlers it installs. */
function childSurface(): {
	pi: any;
	handlers: Map<string, Function[]>;
	tools: Map<string, any>;
	active: string[];
	run: (event: string, ...args: unknown[]) => Promise<void>;
} {
	const handlers = new Map<string, Function[]>();
	const tools = new Map<string, any>();
	const active: string[] = [];
	const pi = {
		on: (event: string, handler: Function) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerTool: (definition: any) => tools.set(definition.name, definition),
		appendEntry: () => undefined,
		getActiveTools: () => [...active],
		getAllTools: () => [...tools.values()].map((tool) => ({ name: tool.name })),
		setActiveTools: (names: string[]) => {
			active.length = 0;
			active.push(...names);
		},
	};
	/** Handlers run in registration order, which is the whole mechanism. */
	const run = async (event: string, ...args: unknown[]) => {
		for (const handler of handlers.get(event) ?? []) await handler(...args);
	};
	return { pi, handlers, tools, active, run };
}

/** Every factory a child is given, applied to a recording `pi`. */
function applyFactories(pi: any): void {
	for (const factory of childFactories({
		parentSessionFile: "/parent.jsonl",
		ceiling: { ceiling: ["python", "todowrite"], source: "spawner", dropped: [] },
	})) {
		factory(pi);
	}
}

function childCtx(id = "child", file = "/child.jsonl") {
	return { sessionManager: { getSessionId: () => id, getSessionFile: () => file }, cwd: "/w" };
}

const TODO = {
	name: "todowrite",
	label: "Todos",
	description: "Manage the session task list.",
	parameters: { type: "object", properties: {} },
	execute: () => undefined,
};

beforeEach(() => {
	__resetToolBridgeForTests();
	__resetHostBridgeForTests();
	// The seam serves contributors, and this package is one: without this, none of the child
	// declarations below is read at all.
	registerContributor(toolBridgeRegistration);
});

describe("the child's tools (child-surface ticket 06)", () => {
	it("registers the capability's definition and no proxy of its own", async () => {
		installRegistry({ childTodo: () => ({ definition: TODO, capture: () => {} }) });
		try {
			const { pi, tools, run } = childSurface();
			applyFactories(pi);

			expect(tools.size).toBe(0); // nothing registers before the session starts
			await run("session_start", {}, childCtx());
			// `todowrite`, and nothing else: the three tools a child used to hold as proxies are reached
			// from its own cell now.
			expect([...tools.keys()]).toEqual(["todowrite"]);
			expect([...tools.keys()].filter((name) => name.startsWith("ctx_"))).toEqual([]);
		} finally {
			clearRegistry();
		}
	});

	it("registers the instance's own definition, not a copy", async () => {
		installRegistry({ childTodo: () => ({ definition: TODO, capture: () => {} }) });
		try {
			const { pi, tools, run } = childSurface();
			applyFactories(pi);
			await run("session_start", {}, childCtx());
			// Identity: a child's tool *is* the object the instance registered for a root, so the two can
			// never drift and no drift pin is needed.
			expect(tools.get("todowrite")).toBe(TODO);
		} finally {
			clearRegistry();
		}
	});

	it("forwards message_end to the capture, with the child's own ctx", async () => {
		const seen: Array<{ message: unknown; ctx: unknown }> = [];
		installRegistry({
			childTodo: () => ({
				definition: TODO,
				capture: (message: unknown, ctx: unknown) => seen.push({ message, ctx }),
			}),
		});
		try {
			const { pi, run } = childSurface();
			applyFactories(pi);
			const ctx = childCtx();
			await run("session_start", {}, ctx);
			const message = { role: "assistant", content: [] };
			await run("message_end", { message }, ctx);
			// The capture rides the hook the bridge already has for scrubbing — the one that catches a
			// todowrite-shaped call even when pi could not execute it.
			expect(seen).toEqual([{ message, ctx }]);
		} finally {
			clearRegistry();
		}
	});

	it("registers nothing when the instance offers no capability at all", async () => {
		installRegistry(); // no childTodo — an older Magic Context, or todowrite disabled
		try {
			const { pi, tools, run } = childSurface();
			applyFactories(pi);
			await run("session_start", {}, childCtx());
			expect(tools.size).toBe(0);
			expect(childStatus()).toContain("no childTodo");
		} finally {
			clearRegistry();
		}
	});

	it("releases the child's session state *and its binding* when the child ends", async () => {
		const cleared: Array<[string, string | undefined]> = [];
		installRegistry({
			childTodo: () => ({ definition: TODO, capture: () => {} }),
			clearSession: (id: string, file?: string) => cleared.push([id, file]),
		});
		try {
			const { pi, run } = childSurface();
			applyFactories(pi);
			await run("session_shutdown", {}, childCtx());
			// The file is the binding's key: clearing only the id was a silent no-op.
			expect(cleared).toEqual([["child", "/child.jsonl"]]);
		} finally {
			clearRegistry();
		}
	});

	it("binds on session_start, and reports a serving instance", async () => {
		const bound: unknown[] = [];
		installRegistry({
			bindChild: (input: unknown) => bound.push(input),
			childTodo: () => ({ definition: TODO, capture: () => {} }),
		});
		try {
			const { pi, run } = childSurface();
			applyFactories(pi);
			await run("session_start", {}, childCtx());
			expect(bound).toEqual([
				{
					childSessionFile: "/child.jsonl",
					childSessionId: "child",
					parentSessionFile: "/parent.jsonl",
					cwd: "/w",
				},
			]);
			expect(childStatus()).toContain("registry found");
		} finally {
			clearRegistry();
		}
	});
});

describe("the ceiling's policy half (child-surface ticket 03)", () => {
	it("narrows the spawning session's surface to what a child may hold", () => {
		const { ceiling, source, dropped } = childCeiling(["python", "ask_user_question", "todowrite"]);
		expect(ceiling).toEqual(["python", "todowrite"]);
		expect(source).toBe("spawner");
		// Neither of these is declared child-eligible by any owner — `ask_user_question` needs a UI a
		// child does not have — and naming what was excluded is what tells a narrowed child from a
		// broken one.
		expect(dropped).toEqual(["ask_user_question"]);
	});

	it("names code mode's own tool once, and no owner has to declare it", () => {
		// `python` is the seam's own constant, not an owner's declaration — and it still has to be in
		// the *parent's* surface to survive the intersection, so a parent that is not a code-mode
		// session offers a child nothing.
		expect(childCeiling(["python", "read"]).ceiling).toEqual(["python"]);
		expect(childCeiling(["read", "bash"]).ceiling).toEqual([]);
		expect(childEligibleTools()).not.toContain("python");
	});

	it("falls back to the declared list when there is no spawner to read", () => {
		const fallback = childCeiling();
		expect(fallback.source).toBe("fallback");
		expect(fallback.ceiling).toEqual(["python", ...childEligibleTools()]);
		expect(fallback.dropped).toBeUndefined();
	});

	it("is a subset of the surface it was given, for every surface", () => {
		for (const surface of [
			["python", "ask_user_question", "todowrite"],
			["python"],
			["read", "bash", "edit", "write"],
			[],
		]) {
			const { ceiling } = childCeiling(surface);
			expect(surface).toEqual(expect.arrayContaining(ceiling));
		}
	});
});

describe("degradation is loud and inert", () => {
	it("registers nothing and reports the absence when there is no registry", async () => {
		clearRegistry();
		const { pi, tools, run } = childSurface();
		applyFactories(pi);
		expect(tools.size).toBe(0);
		await run("session_start", {}, childCtx());
		expect(tools.size).toBe(0);
		expect(childStatus()).toContain("no registry");
		expect(() => bindChild({ childSessionFile: "/child.jsonl" })).not.toThrow();
	});

	it("contains a throwing owner, so one bind cannot stop another", () => {
		installRegistry({
			bindChild: () => {
				throw new Error("boom");
			},
		});
		try {
			expect(() => bindChild({ childSessionFile: "/child.jsonl" })).not.toThrow();
		} finally {
			clearRegistry();
		}
	});
});
