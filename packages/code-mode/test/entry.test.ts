/**
 * The entry's mount, for a session that is not the instance that published.
 *
 * An RLM child mounts through the registry from the *root's* code-mode instance: the mounter's
 * `create` receives the child's own api as `sessionPi`, while the factory closure holds the
 * spawner's. Registering the tool on the closure left a child with no `python` tool at all, and
 * its `setActiveTools(["python"])` then silently emptied its active set. The fix is that the api
 * travels with the mount.
 *
 * No monty: `createKernel` only builds the object here; the pool opens on the first cell.
 */
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { REGISTRY_KEY, type RegistryEntry } from "../src/contract";
import codeMode from "../src/index";

type FakePi = {
	registered: string[];
	active: string[];
	registerTool(tool: { name: string }): void;
	setActiveTools(names: string[]): void;
	getActiveTools(): string[];
	getAllTools(): { name: string }[];
	on(event: string, handler: (...args: unknown[]) => unknown): void;
	appendEntry(type: string, payload: unknown): void;
	sendMessage(...args: unknown[]): void;
};

function fakePi(): FakePi {
	const registered: string[] = [];
	const active: string[] = [];
	return {
		registered,
		active,
		registerTool(tool) {
			if (!registered.includes(tool.name)) registered.push(tool.name);
		},
		setActiveTools(names) {
			active.splice(0, active.length, ...names);
		},
		getActiveTools: () => [...active],
		getAllTools: () => registered.map((name) => ({ name })),
		on() {},
		appendEntry() {},
		sendMessage() {},
	};
}

function ctxFor(file: string) {
	return { sessionManager: { getSessionFile: () => file } };
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
});
