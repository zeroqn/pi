/**
 * The seam's rules, from The published contract (map ticket 01) and the boundary walk
 * (ticket 03). Every rule in `src/contract.ts` is a decision, so every rule gets a test —
 * and the last block is acceptance check 10: the five violations that must **fail** a test
 * rather than reach a session.
 *
 * No pi, no monty: the contract takes a kernel factory and a base surface, so the rules can
 * be exercised without a kernel existing at all.
 */
import { describe, expect, it } from "bun:test";
import {
	API_VERSION,
	BASE_HOST_FNS,
	PUBLISHER,
	REGISTRY_KEY,
	createLedger,
	createMounter,
	createSessionKeys,
	findEntry,
	publish,
	versionProblem,
	type KernelHandleCore,
	type RegistryEntry,
} from "../src/contract";

const BASE = { description: "BASE_DESC", snippet: "BASE_SNIPPET", guidelines: ["base one"] };

function ledger() {
	return createLedger({ reserved: BASE_HOST_FNS, base: BASE });
}

function core(): KernelHandleCore & { calls: number } {
	const state = {
		calls: 0,
		currentCell: () => "cell",
		root: () => "/root",
		scratch: () => "/scratch",
		problems: () => [],
		contribute: () => ({ owner: "", accepted: [], rejected: [] }),
	};
	return state;
}

function ctxFor(file?: string) {
	return { sessionManager: { getSessionFile: () => file } };
}

describe("the registry entry (ticket 01)", () => {
	const entry: RegistryEntry = {
		publisher: PUBLISHER,
		apiVersion: API_VERSION,
		sessions: new Map(),
		mount: () => {
			throw new Error("not called");
		},
	};

	it("is first-wins, so a duplicate install cannot fork the session map", () => {
		const glob = {} as Record<symbol, unknown>;
		expect(publish(entry, glob)).toEqual({ published: true });
		const second = { ...entry, publisher: "someone-else" } as RegistryEntry;
		const result = publish(second, glob);
		expect(result.published).toBe(false);
		expect(result.reason).toContain("already published");
		expect(glob[REGISTRY_KEY]).toBe(entry);
	});

	it("is absent before anyone publishes", () => {
		expect(findEntry({} as Record<symbol, unknown>)).toEqual({ status: "absent" });
	});

	it("is found by shape, not by trust", () => {
		const glob = { [REGISTRY_KEY]: entry } as Record<symbol, unknown>;
		expect(findEntry(glob).status).toBe("found");
	});

	it("names the field when the shape is wrong", () => {
		for (const [patch, expected] of [
			[{ mount: undefined }, "mount"],
			[{ sessions: {} }, "sessions"],
			[{ apiVersion: "1" }, "apiVersion"],
			[{ publisher: undefined }, "publisher"],
		] as const) {
			const glob = { [REGISTRY_KEY]: { ...entry, ...patch } } as Record<symbol, unknown>;
			const looked = findEntry(glob);
			expect(looked.status).toBe("wrong-shape");
			expect(looked.status === "wrong-shape" ? looked.reason : "").toContain(expected);
		}
	});

	it("compares versions by a minimum, and names both sides", () => {
		expect(versionProblem({ apiVersion: API_VERSION })).toBeNull();
		expect(versionProblem({ apiVersion: API_VERSION + 1 })).toBeNull();
		const problem = versionProblem({ apiVersion: 0 });
		expect(problem).toContain("version 0");
		expect(problem).toContain(String(API_VERSION));
	});
});

describe("the session key (ticket 01, amended)", () => {
	it("is the absolute session file when there is one", () => {
		const keys = createSessionKeys();
		expect(keys.of(ctxFor("/tmp/sessions/a.jsonl"))).toBe("/tmp/sessions/a.jsonl");
	});

	it("keys an unpersisted session on its session manager, not on ctx", () => {
		const keys = createSessionKeys();
		const manager = { getSessionFile: () => undefined };
		// Two ctx objects around one session manager are one session: `createContext()` hands
		// out a fresh object per call, so ctx identity cannot be the key.
		expect(keys.of({ sessionManager: manager })).toBe(keys.of({ sessionManager: manager }));
		expect(keys.of({ sessionManager: { getSessionFile: () => undefined } })).not.toBe(
			keys.of({ sessionManager: manager }),
		);
	});
});

describe("the mounter (ticket 01: one kernel per session)", () => {
	it("creates once per key and counts every later mount", () => {
		const keys = createSessionKeys();
		let created = 0;
		const seen: number[] = [];
		const mounter = createMounter({
			keys,
			create: () => {
				created += 1;
				return core();
			},
			onExtraMount: (_key, mounts) => seen.push(mounts),
		});
		const ctx = ctxFor("/tmp/sessions/a.jsonl");
		const first = mounter.mount({}, ctx);
		const second = mounter.mount({}, ctx);
		expect(created).toBe(1);
		expect(second).toBe(first);
		expect(first.mounts).toBe(2);
		expect(seen).toEqual([2]);
		expect(first.sessionKey).toBe("/tmp/sessions/a.jsonl");
		expect(first.publisher).toBe(PUBLISHER);
	});

	it("gives a different session its own kernel, and retires on request", () => {
		const keys = createSessionKeys();
		let created = 0;
		const mounter = createMounter({
			keys,
			create: () => {
				created += 1;
				return core();
			},
		});
		const a = mounter.mount({}, ctxFor("/tmp/sessions/a.jsonl"));
		const b = mounter.mount({}, ctxFor("/tmp/sessions/b.jsonl"));
		expect(a).not.toBe(b);
		expect(created).toBe(2);
		expect(mounter.retire(ctxFor("/tmp/sessions/a.jsonl"))).toBe(true);
		expect(mounter.retire(ctxFor("/tmp/sessions/a.jsonl"))).toBe(false);
		expect(mounter.mount({}, ctxFor("/tmp/sessions/a.jsonl")).mounts).toBe(1);
	});
});

describe("contributing (tickets 01 and 03)", () => {
	it("accepts a contribution and reports what it took", () => {
		const l = ledger();
		const receipt = l.accept({
			owner: "rlm",
			hostFns: { rlm_spawn: async () => ({}) },
			prelude: "RLM_PRELUDE\n",
			description: " RLM_DESC",
			snippet: " and delegation",
			guidelines: ["rlm one"],
		});
		expect(receipt).toEqual({ owner: "rlm", accepted: ["rlm_spawn", "prelude", "description", "snippet", "guidelines"], rejected: [] });
		expect(l.owners()).toEqual(["rlm"]);
		expect(Object.keys(l.hostFns())).toEqual(["rlm_spawn"]);
		expect(l.preludeTail()).toBe("RLM_PRELUDE\n");
		expect(l.description()).toBe("BASE_DESC RLM_DESC");
		expect(l.snippet()).toBe("BASE_SNIPPET and delegation");
		expect(l.guidelines()).toEqual(["base one", "rlm one"]);
	});

	it("applies nothing when one name is rejected — all-or-nothing", () => {
		const l = ledger();
		const receipt = l.accept({
			owner: "rlm",
			hostFns: { rlm_spawn: async () => ({}), bash_host: async () => ({}) },
			description: " RLM_DESC",
		});
		expect(receipt.accepted).toEqual([]);
		expect(receipt.rejected.map((r) => r.name)).toEqual(["bash_host"]);
		expect(receipt.rejected[0]?.reason).toContain("code mode's own host function");
		// The valid half did not arrive either: a prelude line without its host function is
		// a NameError at call time, which is worse than a bare kernel.
		expect(l.description()).toBe("BASE_DESC");
		expect(Object.keys(l.hostFns())).toEqual([]);
	});

	it("refuses a name another owner already holds, and one that is not a name", () => {
		const l = ledger();
		l.accept({ owner: "rsi", hostFns: { skills_host: async () => ({}) } });
		const stolen = l.accept({ owner: "rlm", hostFns: { skills_host: async () => ({}) } });
		expect(stolen.rejected[0]?.reason).toContain("already contributed by rsi");
		const bad = l.accept({ owner: "rlm", hostFns: { "not a name": async () => ({}) } });
		expect(bad.rejected[0]?.reason).toContain("not a usable host-function name");
	});

	it("rejects an unknown field, a wrong type and a missing owner", () => {
		const l = ledger();
		expect(l.accept({ owner: "rlm", description: "x", snippet: 1 } as never).rejected.map((r) => r.name)).toEqual([
			"snippet",
		]);
		expect(l.accept({ owner: "rlm", bogus: true } as never).rejected[0]?.reason).toContain("unknown contribution field");
		expect(l.accept({ owner: "  " }).rejected[0]?.name).toBe("owner");
		expect(l.accept({ owner: "rlm", guidelines: ["ok", 2] } as never).rejected[0]?.reason).toContain("not a string");
		expect(l.accept({ owner: "rlm", provenance: 3 } as never).rejected[0]?.reason).toBe("not a function");
	});

	it("is idempotent per owner, keeping the owner's position in the order", () => {
		const l = ledger();
		l.accept({ owner: "rlm", description: " FIRST", hostFns: { rlm_spawn: async () => ({}) } });
		l.accept({ owner: "web-code", description: " WEB" });
		l.accept({ owner: "rlm", description: " SECOND", hostFns: { rlm_poll: async () => ({}) } });
		expect(l.owners()).toEqual(["rlm", "web-code"]);
		expect(l.description()).toBe("BASE_DESC SECOND WEB");
		// Replaced wholesale: the name it no longer declares is free again.
		expect(Object.keys(l.hostFns())).toEqual(["rlm_poll"]);
		expect(l.accept({ owner: "rsi", hostFns: { rlm_spawn: async () => ({}) } }).rejected).toEqual([]);
	});

	it("refuses everything once the window has closed", () => {
		const l = ledger();
		l.close();
		const receipt = l.accept({ owner: "rlm", description: " LATE" });
		expect(receipt.accepted).toEqual([]);
		expect(receipt.rejected[0]?.reason).toBe("kernel already started");
		expect(l.description()).toBe("BASE_DESC");
		expect(l.isOpen()).toBe(false);
	});

	it("routes the observers to the first owner that asked", () => {
		const l = ledger();
		const seen: string[] = [];
		const notices: string[] = [];
		l.accept({
			owner: "rsi",
			onHostCall: (name) => seen.push(`rsi:${name}`),
		});
		l.accept({
			owner: "rlm",
			onHostCall: (name) => seen.push(`rlm:${name}`),
			onNotice: (notice) => notices.push(notice.key),
			provenance: () => ({ journals: ["/tmp/a.rlm-journal.jsonl"] }),
		});
		l.hostCall("bash_host", ["ls"]);
		expect(seen).toEqual(["rsi:bash_host"]);
		expect(l.notify({ key: "bg:1", content: "done" })).toBe(true);
		expect(notices).toEqual(["bg:1"]);
		expect(l.provenance({})?.journals).toEqual(["/tmp/a.rlm-journal.jsonl"]);
	});

	it("says so when no owner wants a notice, so code mode can tell the model itself", () => {
		const l = ledger();
		l.accept({ owner: "rlm", description: " x" });
		expect(l.notify({ key: "bg:1", content: "done" })).toBe(false);
	});
});

/**
 * Acceptance check 10: the seam's tests must fail when the contract is violated. Each case
 * below is one of the five violations named there.
 */
describe("the contract's violations are caught (acceptance check 10)", () => {
	it("(a) half a contribution never reaches a kernel", () => {
		const l = ledger();
		l.accept({ owner: "rlm", hostFns: { rlm_spawn: async () => ({}), read_image: async () => ({}) } });
		expect(l.description()).toBe("BASE_DESC");
		expect(Object.keys(l.hostFns())).toEqual([]);
	});

	it("(b) a second mount never yields a second kernel", () => {
		const keys = createSessionKeys();
		let created = 0;
		const mounter = createMounter({
			keys,
			create: () => {
				created += 1;
				return core();
			},
		});
		const ctx = ctxFor("/tmp/sessions/a.jsonl");
		expect(mounter.mount({}, ctx)).toBe(mounter.mount({}, ctx));
		expect(created).toBe(1);
	});

	it("(c) a contribution after the first cell is refused whole", () => {
		const l = ledger();
		l.close();
		expect(l.accept({ owner: "rlm", hostFns: { rlm_spawn: async () => ({}) } }).accepted).toEqual([]);
	});

	it("(d) apiVersion 0 is reported as too old, with both numbers", () => {
		expect(versionProblem({ apiVersion: 0 })).toContain("needs 1");
	});

	it("(e) an entry with no sessions map is not usable", () => {
		const glob = {
			[REGISTRY_KEY]: { publisher: PUBLISHER, apiVersion: API_VERSION, mount: () => ({}) },
		} as Record<symbol, unknown>;
		const looked = findEntry(glob);
		expect(looked.status).toBe("wrong-shape");
		expect(looked.status === "wrong-shape" ? looked.reason : "").toBe("the entry has no sessions map");
	});
});
