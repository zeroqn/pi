import { expect, test } from "bun:test";
import { contributors, registerContributor } from "../../host-bridge/src/convention.ts";
import { OWNER, ZVEC_GREP_GUIDELINES, zvecGrepAnswer, zvecGrepRegistration } from "../index.ts";

test("the seam accepts what the entry publishes", () => {
	expect(registerContributor(zvecGrepRegistration)).toEqual({ registered: true });
});

test("importing the entry is what registers it", () => {
	const mine = contributors().filter((registration) => registration.owner === OWNER);
	expect(mine).toHaveLength(1);
	expect(mine[0]!.key).toBe("pi-zvec-grep");
	// 1 is the version this build of host-bridge speaks; a contributor older than it is refused whole.
	expect(mine[0]!.apiVersion).toBe(1);
});

test("the offer is both host functions, their prose, and a session prompt that stays empty", () => {
	const answer = zvecGrepAnswer({ cwd: "/workspace/pi" } as never);
	const contribution = answer.contribution!;
	expect(contribution.owner).toBe(OWNER);
	expect(Object.keys(contribution.hostFns ?? {}).sort()).toEqual(["zvec_grep_rg", "zvec_grep_search"]);
	expect(contribution.description).toContain("zvec_grep_search");
	expect(contribution.description).toContain("zvec_grep_rg");
	expect(contribution.description).toContain("Read-only mode permits both");
	expect(contribution.guidelines).toEqual([...ZVEC_GREP_GUIDELINES]);
	// The sentences land in the `python` tool's description through the ledger, for a child as much as
	// a root, so a system-prompt copy would only be a copy.
	expect(answer.systemPrompt).toBeUndefined();
	// Nothing here reaches a *pi tool*; `reaches` is the tool bridge's field.
	expect(answer.reaches).toBeUndefined();
});

test("a child is served exactly as a root is", () => {
	const root = zvecGrepAnswer({ cwd: "/workspace/pi", isChild: false } as never);
	const child = zvecGrepAnswer({ cwd: "/workspace/pi", isChild: true } as never);
	expect(Object.keys(child.contribution!.hostFns ?? {})).toEqual(Object.keys(root.contribution!.hostFns ?? {}));
	expect(child.contribution!.description).toBe(root.contribution!.description);
});
