/**
 * The owner list: the one place in this package that knows an extension by name, and the files that
 * must stay owner-agnostic (`wayfinder ticket 02`, `.scratch/tool-ownership/`).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { OWNERS, childEligibleTools, nativeOnlyTools } from "../src/owners";
import { magicContext } from "../src/owners/magic-context";
import { probe } from "../src/owners/probe";

/**
 * The files that must stay owner-agnostic, and the strings that would betray an owner.
 *
 * Every file in `src/` outside `owners/`, plus the entry at the package root, belongs here: the
 * reader, the convention, the registration and the entry describe a mechanism, not an owner.
 * `owners/index.ts` is excluded because naming its owners is its whole job. (`child-seam.ts` and
 * `adopter.ts` were on this list until `.scratch/host-bridge` ticket 05 moved the generic half to
 * `pi-host-bridge`.)
 */
const GENERIC_FILES = ["src/adapter.ts", "src/convention.ts", "index.ts", "src/registration.ts"];
const OWNER_PATTERNS = [/\bmagic/i, /cortexkit/i, /\bctx_/];

describe("the owner list", () => {
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

	it("reports a child's surface from pi's own api when it is switched on", () => {
		// The instrument's own shape: it must read pi's api and write one entry, and it must not be in
		// the owner list unless something is measuring (asserted just above).
		const entries: Array<{ customType: string; data: unknown }> = [];
		const handlers: Function[] = [];
		const pi = {
			on: (_event: string, handler: Function) => handlers.push(handler),
			getActiveTools: () => ["python", "todowrite"],
			getAllTools: () => [
				{ name: "python", description: "Run Python", promptGuidelines: ["one", "two"] },
				{ name: "todowrite" },
			],
			appendEntry: (customType: string, data: unknown) => entries.push({ customType, data }),
		};
		probe.childFactories?.({})[0]?.(pi);
		for (const handler of handlers) handler({}, { sessionManager: { getSessionId: () => "child" } });
		expect(entries).toEqual([
			{
				customType: "rlm-child-probe",
				data: {
					active: ["python", "todowrite"],
					registered: ["python", "todowrite"],
					session: "child",
					python: { description: "Run Python", guidelines: ["one", "two"] },
				},
			},
		]);
	});

	it("names no owner in the owner-agnostic files", () => {
		const offenders: string[] = [];
		for (const file of GENERIC_FILES) {
			const lines = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n");
			lines.forEach((line, index) => {
				if (OWNER_PATTERNS.some((pattern) => pattern.test(line))) {
					offenders.push(`${file}:${index + 1}: ${line.trim()}`);
				}
			});
		}
		expect(offenders).toEqual([]);
	});
});
