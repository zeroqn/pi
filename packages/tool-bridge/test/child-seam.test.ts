/**
 * The child seam and its first owner (wayfinder ticket 05, `.scratch/tool-ownership/`; reworked by
 * `.scratch/child-surface/` tickets 03-06).
 *
 * What changed, and why this file no longer pins three tool definitions: a child no longer holds
 * `ctx_search`/`ctx_reduce`/`ctx_expand` as proxies — it reaches them from its own cell through the tool
 * bridge, whose generated line states how — and the *only* tool the shim registers is the one value the
 * registry hands over, `childTodo()`. The pin that replaced check 3b asserts *that*: which names the shim
 * registers, that the definition is the instance's own object rather than a copy, that the capture rides
 * the `message_end` hook the bridge already has, and that a registry offering no capability registers
 * nothing at all.
 *
 * The last two describe blocks are ticket 02's decisions: the owner list is unique, and the
 * owner-agnostic files name no owner.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
	__clearChildDetectorForTests,
	bindChild,
	childCeiling,
	childFactories,
	childStatus,
	detectsChild,
	setChildDetector,
} from "../src/child-seam";
import { OWNERS, childEligibleTools, nativeOnlyTools } from "../src/owners";
import { magicContext } from "../src/owners/magic-context";

const REGISTRY_KEY = Symbol.for("@cortexkit/magic-context:pi-registry");

/**
 * The files that must stay owner-agnostic, and the strings that would betray an owner.
 *
 * Every file in `src/` outside `owners/` belongs here: the seam, the reader, the convention, the
 * entry and the adopter describe a mechanism, not an owner. `owners/index.ts` is excluded because
 * naming its owners is its whole job.
 */
const GENERIC_FILES = ["child-seam.ts", "adapter.ts", "adopter.ts", "convention.ts", "index.ts"];
const OWNER_PATTERNS = [/\bmagic/i, /cortexkit/i, /\bctx_/];

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
	/** Handlers run in registration order, which is the whole mechanism (ticket 02 §3). */
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

describe("the child's tools (child-surface ticket 06 — what replaced acceptance check 3b)", () => {
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
			// The file is the binding's key: clearing only the id was a silent no-op (ticket 04).
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

describe("the ceiling (child-surface ticket 03)", () => {
	it("narrows the spawning session's surface to what a child may hold", () => {
		const { ceiling, source, dropped } = childCeiling([
			"python",
			"ask_user_question",
			"todowrite",
		]);
		expect(ceiling).toEqual(["python", "todowrite"]);
		expect(source).toBe("spawner");
		// Neither of these is declared child-eligible by any owner — `ask_user_question` needs a UI a
		// child does not have — and naming what was excluded is what tells a narrowed child from a
		// broken one.
		expect(dropped).toEqual(["ask_user_question"]);
	});

	it("names code mode's own tool once, and no owner has to declare it", () => {
		// `python` is in the seam's own `CHILD_ALWAYS`, not in any owner's declaration — and it still has
		// to be in the *parent's* surface to survive the intersection, so a parent that is not a
		// code-mode session offers a child nothing.
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

describe("the child detector (child-surface ticket 03 §5)", () => {
	it("detects nothing until rlm installs its reader", () => {
		__clearChildDetectorForTests();
		expect(detectsChild(childCtx())).toBe(false);
	});

	it("answers from the installed reader, and contains a throwing one", () => {
		setChildDetector((ctx: any) => ctx?.sessionManager?.getSessionId?.() === "child");
		try {
			expect(detectsChild(childCtx("child"))).toBe(true);
			expect(detectsChild(childCtx("root"))).toBe(false);
			setChildDetector(() => {
				throw new Error("boom");
			});
			// An undetected child degrades to the root rule, which is a state the session was already in.
			expect(detectsChild(childCtx("child"))).toBe(false);
		} finally {
			__clearChildDetectorForTests();
		}
	});
});

describe("degradation is loud and inert (ticket 02)", () => {
	it("keeps a no-op factory and reports the absence when there is no registry", () => {
		clearRegistry();
		const { pi, handlers, tools } = childSurface();
		applyFactories(pi);
		expect(handlers.size).toBe(3); // the bridge's own three, and the owner's none
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

describe("the owner list (ticket 02)", () => {
	it("has one entry per owner, with unique names", () => {
		const names = OWNERS.map((owner) => owner.name);
		expect(new Set(names).size).toBe(names.length);
		expect(names).toContain("magic-context");
	});

	it("unions native-only names without duplicates", () => {
		const names = nativeOnlyTools();
		expect(names).toContain("todowrite");
		expect(new Set(names).size).toBe(names.length);
		expect(magicContext.nativeOnly).toEqual(["todowrite"]);
	});

	it("declares child eligibility as its own list, equal to native-only today", () => {
		// Two lists answering two questions (`nativeOnly`: a *root* must keep it a pi tool;
		// `childEligible`: a *child* may hold it). Equal today, and pinned so a divergence is a decision
		// someone made rather than a drift nobody noticed.
		expect(magicContext.childEligible).toEqual(magicContext.nativeOnly);
		expect(childEligibleTools()).toContain("todowrite");
	});

	it("keeps the acceptance probe out of the list unless something is measuring", () => {
		// The instrument reads pi's own api, so it is the bar's independent half — and it must cost
		// nothing to a session that is not being measured.
		expect(OWNERS.map((owner) => owner.name)).not.toContain("probe");
	});

	it("names no owner in the owner-agnostic files", () => {
		const offenders: string[] = [];
		for (const file of GENERIC_FILES) {
			const lines = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8").split("\n");
			lines.forEach((line, index) => {
				if (OWNER_PATTERNS.some((pattern) => pattern.test(line))) {
					offenders.push(`${file}:${index + 1}: ${line.trim()}`);
				}
			});
		}
		expect(offenders).toEqual([]);
	});
});
