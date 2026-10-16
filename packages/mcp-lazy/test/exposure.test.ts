/**
 * Exposure (tickets 01, 17): the server-level and per-tool rewrite of a disclosed `direct`, and the
 * `hidden` decision — which servers both layers are allowed to name at all.
 *
 * `hasReachableTool` is the one predicate the section and the catalogue share, so its cases are pinned
 * here rather than twice.
 */
import { describe, expect, it } from "bun:test";

import { exposureNotice, hasReachableTool, rewriteDisclosedExposure } from "../src/registrar";

describe("rewriteDisclosedExposure", () => {
	it("rewrites a server-level `direct` and reports no tools", () => {
		const { config, changed, tools } = rewriteDisclosedExposure({ command: "true", exposure: "direct" } as never);
		expect(changed).toBe(true);
		expect((config as { exposure?: string }).exposure).toBe("codemode");
		expect(tools).toEqual([]);
	});

	it("rewrites a per-tool `direct` and names the tools (ticket 17)", () => {
		const { config, changed, tools } = rewriteDisclosedExposure({
			command: "true",
			exposure: "codemode",
			toolExposure: { search: "direct", "*": "direct", fetch: "hidden" },
		} as never);
		expect(changed).toBe(true);
		expect((config as { exposure?: string }).exposure).toBe("codemode");
		expect((config as { toolExposure?: Record<string, string> }).toolExposure).toEqual({
			search: "codemode",
			"*": "codemode",
			fetch: "hidden",
		});
		expect(tools).toEqual(["search", "*"]);
	});

	it("leaves an undisclosed server alone", () => {
		const { config, changed, tools } = rewriteDisclosedExposure({
			command: "true",
			exposure: "deferred",
			toolExposure: { fetch: "hidden" },
		} as never);
		expect(changed).toBe(false);
		expect(tools).toEqual([]);
		expect((config as { exposure?: string }).exposure).toBe("deferred");
	});

	it("never produces a declared tool: no `direct` survives, at either level", () => {
		const { config } = rewriteDisclosedExposure({
			command: "true",
			exposure: "direct",
			toolExposure: { a: "direct", b: "direct" },
		} as never);
		expect((config as { exposure?: string }).exposure).toBe("codemode");
		expect(Object.values((config as { toolExposure?: Record<string, string> }).toolExposure ?? {})).not.toContain(
			"direct",
		);
	});
});

describe("exposureNotice", () => {
	it("describes a server-level rewrite", () => {
		const text = exposureNotice("docs-api");
		expect(text).toContain('"docs-api"');
		expect(text).toContain('exposure "direct"');
		expect(text).toContain("mcp.json");
	});

	it("names the tools a per-tool rewrite changed", () => {
		const text = exposureNotice("docs-api", ["search", "*"]);
		expect(text).toContain("toolExposure");
		expect(text).toContain('"search", "*"');
	});
});

describe("hasReachableTool (ticket 17's `hidden` decision)", () => {
	it("keeps the default (codemode) and every undisclosed exposure", () => {
		expect(hasReachableTool({ command: "true" } as never)).toBe(true);
		expect(hasReachableTool({ command: "true", exposure: "codemode" } as never)).toBe(true);
		expect(hasReachableTool({ command: "true", exposure: "deferred" } as never)).toBe(true);
		expect(hasReachableTool({ command: "true", exposure: "direct" } as never)).toBe(true);
	});

	it("drops a server that is hidden and hides everything else too", () => {
		expect(hasReachableTool({ command: "true", exposure: "hidden" } as never)).toBe(false);
		expect(hasReachableTool({ command: "true", exposure: "hidden", toolExposure: { "*": "hidden" } } as never)).toBe(
			false,
		);
		expect(hasReachableTool({ command: "true", exposure: "codemode", toolExposure: { "*": "hidden" } } as never)).toBe(
			false,
		);
	});

	it("keeps a hidden server whose per-tool overrides expose a few tools", () => {
		expect(hasReachableTool({ command: "true", exposure: "hidden", toolExposure: { search: "codemode" } } as never)).toBe(
			true,
		);
		expect(
			hasReachableTool({ command: "true", exposure: "hidden", toolExposure: { "*": "hidden", search: "deferred" } } as never),
		).toBe(true);
		expect(hasReachableTool({ command: "true", exposure: "codemode", toolExposure: { "*": "hidden", search: "deferred" } } as never)).toBe(
			true,
		);
	});
});
