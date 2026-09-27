/**
 * The blocklist, ported from upstream's `advisor.policy.test.ts` — the table is the interesting part: it
 * is what an *executor's* level is compared against, and it is now read once at the mount (ticket 03)
 * rather than re-evaluated mid-session.
 */
import type { Api, Model } from "@earendil-works/pi-ai";

import { beforeEach, describe, expect, it } from "bun:test";

import { __resetPolicyForTests, isModelBlocked, setDisabledForModels } from "../src/policy.ts";

const opus = { provider: "anthropic", id: "opus", name: "Opus" } as unknown as Model<Api>;
const sonnet = { provider: "anthropic", id: "sonnet", name: "Sonnet" } as unknown as Model<Api>;

beforeEach(() => {
	__resetPolicyForTests();
});

describe("isModelBlocked", () => {
	it("never blocks an unknown model, whatever the list says", () => {
		setDisabledForModels(["anthropic/sonnet"]);
		expect(isModelBlocked(undefined)).toBe(false);
	});

	it("does not block when the list is empty", () => {
		expect(isModelBlocked(sonnet)).toBe(false);
	});

	it("blocks an exact key", () => {
		setDisabledForModels(["anthropic/sonnet"]);
		expect(isModelBlocked(sonnet)).toBe(true);
		expect(isModelBlocked(opus)).toBe(false);
	});

	it("still blocks a legacy colon-form entry, so an unsaved file keeps working", () => {
		setDisabledForModels(["anthropic:sonnet"]);
		expect(isModelBlocked(sonnet)).toBe(true);
	});

	it("blocks a {model} entry with no threshold, at any level", () => {
		setDisabledForModels([{ model: "anthropic/sonnet" }]);
		expect(isModelBlocked(sonnet, "minimal")).toBe(true);
	});

	it("blocks at and above a minEffort threshold, and not below", () => {
		setDisabledForModels([{ model: "anthropic/sonnet", minEffort: "high" }]);
		expect(isModelBlocked(sonnet, "high")).toBe(true);
		expect(isModelBlocked(sonnet, "max")).toBe(true);
		expect(isModelBlocked(sonnet, "medium")).toBe(false);
	});

	it("never blocks an unset, off or unknown executor level", () => {
		setDisabledForModels([{ model: "anthropic/sonnet", minEffort: "minimal" }]);
		expect(isModelBlocked(sonnet, undefined)).toBe(false);
		expect(isModelBlocked(sonnet, "off")).toBe(false);
		expect(isModelBlocked(sonnet, "enormous")).toBe(false);
	});

	it("skips an unrankable threshold rather than letting two unknowns match", () => {
		setDisabledForModels([{ model: "anthropic/sonnet", minEffort: "enormous" as never }]);
		expect(isModelBlocked(sonnet, "enormous")).toBe(false);
	});
});
