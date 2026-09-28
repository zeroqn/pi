/**
 * The entry: one registration, one slot, no pi tool.
 *
 * The receipt is asserted against **code mode's own ledger**, not a copy of its shape, because the
 * failure this guards is a contribution that this package believes it made and the publisher refused.
 */
import { describe, expect, it } from "bun:test";

import { BASE_HOST_FNS, createLedger } from "../../code-mode/src/contract.ts";
import { contributors } from "../../host-bridge/src/convention.ts";
import {
	OWNER,
	fffSearchAnswer,
	fffSearchRegistration,
} from "../index.ts";
import type { KernelContribution } from "../../host-bridge/src/client.ts";
import type { ContributorAnswer } from "../../host-bridge/src/convention.ts";

const base = { description: "BASE", snippet: "SNIPPET", guidelines: ["base one"] };

/** An answer this package always makes, so a missing one is a test bug rather than a case to handle. */
function contributionOf(answer: ContributorAnswer): KernelContribution {
	if (!answer.contribution) throw new Error("fff-search answered without a contribution");
	return answer.contribution;
}

describe("the contribution", () => {
	it("is accepted by code mode's ledger, and its engine is the session's", () => {
		const ledger = createLedger({ reserved: BASE_HOST_FNS, base });
		const contribution = contributionOf(fffSearchAnswer({ cwd: "/root" } as never));

		const receipt = ledger.accept(contribution);

		expect(receipt.rejected).toEqual([]);
		expect(receipt.accepted).toContain("search");
		expect(ledger.search()).toBe(contribution.search);
		// The slot backs names that already exist, so it adds none: nothing for the active-set rule to
		// strip, and nothing for the ledger to install.
		expect(ledger.hostFns()).toEqual({});
		expect(fffSearchAnswer({ cwd: "/root" } as never).reaches).toBeUndefined();
	});

	it("carries the prose that tells the model what the index costs", () => {
		const { description, guidelines } = contributionOf(fffSearchAnswer({ cwd: "/root" } as never));
		expect(description).toContain("fuzzy=True");
		expect(guidelines?.join(" ")).toContain(".scratch/");
	});

	it("registers under its own key at module load", () => {
		const mine = contributors().filter((entry) => entry.owner === OWNER);
		expect(mine).toHaveLength(1);
		expect(mine[0]?.key).toBe(fffSearchRegistration.key);
		expect(typeof mine[0]?.session).toBe("function");
	});

	it("serves a child too — it reads the same process-global slot", () => {
		const asChild = contributionOf(fffSearchAnswer({ cwd: "/root", isChild: true } as never));
		expect(asChild.search).toBeDefined();
	});
});
