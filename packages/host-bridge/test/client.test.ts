/**
 * The client's rules, with a fake code mode: what it refuses and how it says so, what it hands back,
 * and the one invariant that keeps a session sane — the client never caches a handle, because code
 * mode's `mount` is idempotent by session key and this module must not become a second authority on it.
 */
import { describe, expect, test } from "bun:test";
import {
	type Glob,
	type KernelContribution,
	type KernelEntry,
	type KernelHandle,
	REGISTRY_KEY,
	childExtensionFactories,
	contributeAll,
	findKernel,
	kernelProblems,
	mountKernel,
	versionProblem,
} from "../src/client";

function globalsWith(entry: unknown): Glob {
	return { [REGISTRY_KEY]: entry };
}

function fakeHandle(overrides: Partial<KernelHandle> = {}): KernelHandle {
	return {
		publisher: "pi-code-mode",
		apiVersion: 1,
		sessionKey: "/sessions/one.jsonl",
		mounts: 1,
		currentCell: () => "print(1)",
		root: () => "/root",
		scratch: () => "/scratch",
		progress: () => undefined,
		problems: async () => [],
		contribute: () => ({ owner: "someone", accepted: [], rejected: [] }),
		...overrides,
	};
}

function fakeEntry(overrides: Partial<KernelEntry> = {}): KernelEntry {
	return {
		publisher: "pi-code-mode",
		apiVersion: 1,
		sessions: new Map(),
		mount: () => fakeHandle(),
		...overrides,
	};
}

describe("findKernel", () => {
	test("says absent for an empty slot and for globals it cannot read", () => {
		expect(findKernel({})).toEqual({ status: "absent" });
		const hostile = new Proxy({}, { get: () => { throw new Error("no globals for you"); } });
		expect(findKernel(hostile as Glob)).toEqual({ status: "absent" });
	});

	test("names the field that makes an entry unusable", () => {
		expect(findKernel(globalsWith("pi-code-mode"))).toEqual({
			status: "wrong-shape",
			reason: "the registry entry is not an object",
		});
		expect(findKernel(globalsWith({}))).toEqual({
			status: "wrong-shape",
			reason: "the entry has no publisher name",
		});
		expect(findKernel(globalsWith({ publisher: "p" }))).toEqual({
			status: "wrong-shape",
			reason: "the entry has no numeric apiVersion",
		});
		expect(findKernel(globalsWith({ publisher: "p", apiVersion: 1 }))).toEqual({
			status: "wrong-shape",
			reason: "the entry has no sessions map",
		});
		expect(findKernel(globalsWith({ publisher: "p", apiVersion: 1, sessions: new Map() }))).toEqual({
			status: "wrong-shape",
			reason: "the entry has no mount function",
		});
	});

	test("finds a well-shaped entry", () => {
		const entry = fakeEntry();
		expect(findKernel(globalsWith(entry))).toEqual({ status: "found", entry });
	});
});

describe("versionProblem", () => {
	test("accepts this version or newer, and refuses an older one with both numbers", () => {
		expect(versionProblem({ apiVersion: 1 })).toBeNull();
		expect(versionProblem({ apiVersion: 7 })).toBeNull();
		expect(versionProblem({ apiVersion: 0 })).toBe(
			"code mode's contract is version 0, and this build needs 1",
		);
		expect(versionProblem({} as { apiVersion: number })).toBe("the entry has no numeric apiVersion");
	});
});

describe("mountKernel", () => {
	test("degrades inertly for every way code mode can be unavailable", () => {
		expect(mountKernel({ pi: {}, ctx: {}, glob: {} })).toEqual({
			status: "inert",
			reason: "code mode is not present on the registry (pi cannot say why: no extension enumeration)",
		});
		expect(mountKernel({ pi: {}, ctx: {}, glob: globalsWith({}) })).toEqual({
			status: "inert",
			reason: "code mode's registry entry is unusable: the entry has no publisher name",
		});
		expect(mountKernel({ pi: {}, ctx: {}, glob: globalsWith(fakeEntry({ apiVersion: 0 })) })).toEqual({
			status: "inert",
			reason: "code mode's contract is version 0, and this build needs 1",
		});
	});

	test("contains a mount that throws, and one that returns something else", () => {
		const throwing = fakeEntry({
			mount: () => {
				throw new Error("monty is not installed");
			},
		});
		expect(mountKernel({ pi: {}, ctx: {}, glob: globalsWith(throwing) })).toEqual({
			status: "inert",
			reason: "code mode could not mount a kernel for this session: Error: monty is not installed",
		});
		const wrong = fakeEntry({ mount: () => ({}) as unknown as KernelHandle });
		expect(mountKernel({ pi: {}, ctx: {}, glob: globalsWith(wrong) })).toEqual({
			status: "inert",
			reason: "code mode mounted something that is not a kernel handle",
		});
	});

	test("hands back the handle, and never caches it", () => {
		let mounts = 0;
		const handle = fakeHandle();
		const entry = fakeEntry({
			mount: () => {
				mounts += 1;
				return handle;
			},
		});
		const glob = globalsWith(entry);
		const first = mountKernel({ pi: {}, ctx: {}, glob });
		const second = mountKernel({ pi: {}, ctx: {}, glob });
		expect(first).toEqual({ status: "mounted", handle });
		expect(second).toEqual({ status: "mounted", handle });
		// Idempotency by session key is code mode's rule, and the observable is the mount count: a client
		// that cached would hide a second session's mount behind the first one's handle.
		expect(mounts).toBe(2);
	});
});

describe("kernelProblems", () => {
	test("returns the preflight, and an empty list when the preflight throws", async () => {
		await expect(kernelProblems(fakeHandle({ problems: async () => ["no monty"] }))).resolves.toEqual([
			"no monty",
		]);
		await expect(
			kernelProblems(
				fakeHandle({
					problems: async () => {
						throw new Error("the kernel is gone");
					},
				}),
			),
		).resolves.toEqual([]);
	});
});

describe("contributeAll", () => {
	test("collects a refusal without stopping the next contributor, and installs none of the refused names", () => {
		const seen: string[] = [];
		const handle = fakeHandle({
			contribute: (contribution: KernelContribution) => {
				seen.push(contribution.owner);
				if (contribution.owner === "refused") {
					return {
						owner: "refused",
						accepted: [],
						rejected: [{ name: "bash_host", reason: "code mode's own host function" }],
					};
				}
				return {
					owner: contribution.owner,
					accepted: [...Object.keys(contribution.hostFns ?? {}), "guidelines"],
					rejected: [],
				};
			},
		});
		const report = contributeAll(handle, [
			{ owner: "refused", hostFns: { bash_host: async () => null } },
			{ owner: "web-access", hostFns: { web_search: async () => null, fetch_content: async () => null } },
		]);
		expect(seen).toEqual(["refused", "web-access"]);
		// A refused contribution installs nothing, so it is not an owner and `bash_host` is not installed —
		// and the ledger's own field list ("guidelines") is not a host-function name.
		expect(report.owners).toEqual(["web-access"]);
		expect(report.installed).toEqual(["web_search", "fetch_content"]);
		expect(report.problems).toEqual([
			"refused refused whole: bash_host (code mode's own host function)",
		]);
	});

	test("records a throwing contribution and keeps going", () => {
		const handle = fakeHandle({
			contribute: (contribution: KernelContribution) => {
				if (contribution.owner === "broken") throw new Error("ledger is closed");
				return { owner: contribution.owner, accepted: ["x"], rejected: [] };
			},
		});
		const report = contributeAll(handle, [{ owner: "broken" }, { owner: "rlm", hostFns: { x: async () => 1 } }]);
		expect(report.problems).toEqual(["broken: contributing to the kernel failed — Error: ledger is closed"]);
		expect(report.owners).toEqual(["rlm"]);
		expect(report.installed).toEqual(["x"]);
	});
});

describe("childExtensionFactories", () => {
	test("offers code mode's own factory, and nothing when the entry has none or throws", () => {
		const childExtension = () => (pi: unknown) => void pi;
		expect(childExtensionFactories(globalsWith(fakeEntry({ childExtension })))).toHaveLength(1);
		expect(childExtensionFactories({})).toEqual([]);
		expect(childExtensionFactories(globalsWith({} as unknown))).toEqual([]);
		expect(
			childExtensionFactories(
				globalsWith(
					fakeEntry({
						childExtension: () => {
							throw new Error("no child for you");
						},
					}),
				),
			),
		).toEqual([]);
		expect(childExtensionFactories(globalsWith(fakeEntry({ childExtension: () => undefined })))).toEqual([]);
	});
});
