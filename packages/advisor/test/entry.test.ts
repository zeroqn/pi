/**
 * The seam contract: what this package publishes, and that the entry installs nothing but a command.
 */
import { describe, expect, it } from "bun:test";

import { API_VERSION, contributors } from "../../host-bridge/src/convention.ts";
import advisor, { advisorRegistration } from "../index.ts";

describe("the registration", () => {
	it("publishes under a pi- key, an advisor owner and the seam's version", () => {
		expect(advisorRegistration.key).toBe("pi-advisor");
		expect(advisorRegistration.owner).toBe("advisor");
		expect(advisorRegistration.apiVersion).toBe(API_VERSION);
		expect(typeof advisorRegistration.session).toBe("function");
	});

	it("is registered at module load, where the composition root can see it", () => {
		const keys = contributors().map((c) => c.key);
		expect(keys).toContain("pi-advisor");
	});

	it("answers null for a session with nothing configured, rather than an empty contribution", () => {
		expect(advisorRegistration.session({ ctx: {}, sessionKey: "s", isChild: false } as never)).toBeNull();
	});
});

describe("the entry", () => {
	it("is a factory, so pi has something to call — and it registers no tool of its own", () => {
		expect(typeof advisor).toBe("function");
		const calls: string[] = [];
		const fakePi = {
			registerCommand: (name: string) => calls.push(`command:${name}`),
			on: (event: string) => calls.push(`on:${event}`),
			registerTool: () => calls.push("tool"),
		};
		advisor(fakePi as never);
		expect(calls).toContain("command:advisor");
		expect(calls).toContain("on:session_shutdown");
		expect(calls).not.toContain("tool");
	});
});
