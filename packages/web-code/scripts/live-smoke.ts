/**
 * Live smoke — the network-touching check, gated so `bun test` stays offline.
 *
 *     RLM_WEB_SMOKE=1 bun run smoke
 *
 * It exercises what fixtures cannot: the real DuckDuckGo page shape, the real AnySearch
 * API with the real key, HTML extraction on a real article, the PDF path, and the guard
 * refusing a loopback URL.
 */

import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHost } from "../host";

if (process.env.RLM_WEB_SMOKE !== "1") {
	console.log("live smoke is gated: run it with RLM_WEB_SMOKE=1 bun run smoke");
	process.exit(0);
}

const scratchDir = mkdtempSync(join(tmpdir(), "pi-web-code-smoke-"));
const host = createHost({ cwd: process.cwd(), sessionFile: join(scratchDir, "smoke.jsonl"), progress: (text) => console.log("  ·", text) });

function line(label: string, value: unknown): void {
	console.log(label, typeof value === "string" ? value : JSON.stringify(value));
}

console.log("scratch:", scratchDir);

// 1. search, provider chosen by the shared config's order
const search = await host.web_search("pydantic monty sandboxed python subset", 3);
line("search: provider =", search.provider);
line("search: results  =", search.results.map((result) => `${result.title.slice(0, 45)} — ${result.url}`));
line("search: errors   =", search.errors);

// 2. one provider each, explicitly
for (const name of ["duckduckgo", "anysearch"] as const) {
	try {
		const only = await host.web_search("pydantic monty", 2, [name]);
		line(`search(${name}):`, `${only.results.length} results, provider=${only.provider}`);
	} catch (error) {
		line(`search(${name}) FAILED:`, error instanceof Error ? error.message : String(error));
	}
}

// 3. a real article, extracted and spilled
const page = await host.fetch_content("https://docs.python.org/3/library/asyncio-task.html");
if ("chars" in page) {
	line("fetch(markdown):", `${page.chars} chars -> ${page.path} (${statSync(page.path).size} bytes on disk)`);
	line("  head:", JSON.stringify(page.head.slice(0, 120)));
	line("  file agrees:", readFileSync(page.path, "utf8").length === page.chars);
}

// 4. a PDF, extracted
try {
	const pdf = await host.fetch_content("https://arxiv.org/pdf/1706.03762");
	if ("chars" in pdf) line("fetch(pdf):", `${pdf.chars} chars -> ${pdf.path}`);
} catch (error) {
	line("fetch(pdf) FAILED:", error instanceof Error ? error.message : String(error));
}

// 5. raw mode: the bytes, on disk
const raw = await host.fetch_content("https://raw.githubusercontent.com/pydantic/monty/main/README.md", "raw");
if ("bytes" in raw) line("fetch(raw):", `${raw.bytes} bytes of ${raw.content_type} -> ${raw.path}`);

// 6. the guard, which must refuse before any request
try {
	await host.fetch_content("http://127.0.0.1:8080/");
	line("fetch(loopback):", "NOT REFUSED — that is a bug");
} catch (error) {
	line("fetch(loopback):", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
}
