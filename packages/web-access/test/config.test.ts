import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROVIDERS, loadConfig, providerOrder } from "../config";

function configFile(body: string): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-web-access-config-"));
	const file = join(dir, "web-search.json");
	writeFileSync(file, body);
	return file;
}

describe("the shared web-search.json (ticket 03)", () => {
	it("reads the provider order, the key and the guard settings, and writes nothing", () => {
		const path = configFile(JSON.stringify({
			provider: ["duckduckgo", "anysearch"],
			anysearchApiKey: "  key-from-file  ",
			ssrf: { allowRanges: ["198.18.0.0/15"] },
			fetchContent: { domainPolicy: { allow: ["arxiv.org"], deny: ["reddit.com"] } },
		}));
		const config = loadConfig(path);
		expect(config.providers).toEqual(["duckduckgo", "anysearch"]);
		expect(config.anysearchApiKey).toBe("key-from-file");
		expect(config.allowRanges).toEqual(["198.18.0.0/15"]);
		expect(config.domainPolicy).toEqual({ allow: ["arxiv.org"], deny: ["reddit.com"] });
	});

	it("treats a missing file as no configuration rather than an empty one", () => {
		const config = loadConfig(join(mkdtempSync(join(tmpdir(), "pi-web-access-none-")), "web-search.json"));
		expect(config.raw).toBeNull();
		expect(config.providers).toEqual([]);
		expect(config.anysearchApiKey).toBeNull();
		expect(providerOrder(config.providers)).toEqual([...DEFAULT_PROVIDERS]);
	});

	it("fails loudly on a malformed file, naming it", () => {
		const path = configFile("{ not json");
		expect(() => loadConfig(path)).toThrow(/not valid JSON/);
		expect(() => loadConfig(path)).toThrow(path);
	});

	it("fails loudly on a wrong type rather than guessing", () => {
		expect(() => loadConfig(configFile(JSON.stringify({ provider: 7 })))).toThrow(/provider must be a string or an array/);
		expect(() => loadConfig(configFile(JSON.stringify({ provider: [7] })))).toThrow(/provider\[0\] must be a string/);
		expect(() => loadConfig(configFile(JSON.stringify({ anysearchApiKey: 7 })))).toThrow(/anysearchApiKey must be a string/);
		expect(() => loadConfig(configFile(JSON.stringify({ ssrf: { allowRanges: "198.18.0.0/15" } })))).toThrow(/ssrf.allowRanges must be an array/);
		expect(() => loadConfig(configFile(JSON.stringify({ fetchContent: { domainPolicy: { deny: "x" } } })))).toThrow(/domainPolicy.deny must be an array/);
	});

	it("accepts a single provider name as well as a list", () => {
		expect(loadConfig(configFile(JSON.stringify({ provider: "anysearch" }))).providers).toEqual(["anysearch"]);
	});

	it("keeps only providers we actually have, and falls back to both", () => {
		expect(providerOrder(["exa", "anysearch"])).toEqual(["anysearch"]);
		expect(providerOrder(["exa"])).toEqual([...DEFAULT_PROVIDERS]);
		expect(providerOrder([])).toEqual([...DEFAULT_PROVIDERS]);
	});
});
