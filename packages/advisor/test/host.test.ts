/**
 * `await advisor()` takes no arguments — and a keyword that would otherwise be silently ignored is a
 * `ValueError` before the reviewer is called (ticket 06).
 */
import type { Api, Model } from "@earendil-works/pi-ai";

import { describe, expect, it } from "bun:test";

import { createAdvisorHost } from "../src/host.ts";
import { __resetAdvisorStateForTests, setAdvisorModel } from "../src/state.ts";

const advisor = { provider: "anthropic", id: "opus" } as unknown as Model<Api>;

describe("createAdvisorHost", () => {
	it("refuses a keyword argument with a ValueError naming it", async () => {
		const host = createAdvisorHost({ ctx: {} });
		const error = await host({ focus: "the failing test" }).catch((e: Error) => e);
		expect((error as Error).name).toBe("ValueError");
		expect((error as Error).message).toContain("takes no arguments");
		expect((error as Error).message).toContain("focus");
	});

	it("refuses a positional argument too", async () => {
		const host = createAdvisorHost({ ctx: {} });
		const error = await host("focus").catch((e: Error) => e);
		expect((error as Error).name).toBe("ValueError");
		expect((error as Error).message).toContain("<positional>");
	});

	it("delegates an argument-free call to the side-call", async () => {
		__resetAdvisorStateForTests();
		setAdvisorModel(advisor);
		const host = createAdvisorHost({ ctx: {} });
		const error = await host().catch((e: Error) => e);
		// No registry in the ctx, so the side-call fails — which is the proof that it was reached.
		expect((error as Error).name).toBe("RuntimeError");
		expect((error as Error).message).toContain("model registry");
	});
});
