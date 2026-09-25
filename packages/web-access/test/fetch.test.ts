import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchContent, spillPath } from "../fetch";
import { CLOSE_MARKER, fenceText, OPEN_MARKER, PREAMBLE } from "../guard";

const PUBLIC = "93.184.216.34";
const guard = { allowRanges: [] as string[], domainPolicy: { allow: [] as string[], deny: [] as string[] }, lookup: async () => [PUBLIC] };

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "pi-web-access-fetch-"));
}

/** Strip the fence a spilled text file carries, so a page-text comparison is still readable. */
function plain(text: string): string {
	const prefix = `${OPEN_MARKER}${PREAMBLE}\n`;
	const suffix = `\n${CLOSE_MARKER}`;
	return text.startsWith(prefix) && text.endsWith(suffix) ? text.slice(prefix.length, -suffix.length) : text;
}

function respond(body: string | Uint8Array, contentType: string, status = 200) {
	const calls: string[] = [];
	const impl = (async (input: RequestInfo | URL) => {
		calls.push(String(input));
		return new Response(body as BodyInit, { status, headers: { "content-type": contentType } });
	}) as unknown as typeof fetch;
	return { impl, calls };
}

const article = `<!doctype html><html><head><title>Monty notes</title></head><body>
  <nav><a href="/">Home</a> · Cookie policy · Subscribe to our newsletter</nav>
  <article><h1>Monty notes</h1>
    <p>Monty is a sandboxed Python subset written in Rust, and this paragraph is the article body that must survive extraction with enough words to score above any threshold a reader-mode heuristic applies to a page.</p>
    <p>A second paragraph, so the extraction has structure to work with rather than a single lonely node in the document tree.</p>
  </article>
  <footer>All rights reserved</footer>
</body></html>`;

describe("fetch_content, markdown mode (tickets 04 and 05)", () => {
	it("extracts the article, spills it, and reports a head", async () => {
		const dir = scratch();
		const { impl } = respond(article, "text/html");
		const result = await fetchContent("http://example.com/post", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: impl });
		expect(result.path.endsWith(".md")).toBe(true);
		const spilled = readFileSync(result.path, "utf8");
		if (!("chars" in result)) throw new Error("expected a markdown envelope");
		// The file is fenced, and `chars`/`head` still describe the *page text*, not the wrapper.
		expect(spilled.startsWith(`${OPEN_MARKER}${PREAMBLE}`)).toBe(true);
		expect(spilled.endsWith(CLOSE_MARKER)).toBe(true);
		expect(result.chars).toBe(plain(spilled).length);
		expect(spilled).toContain("sandboxed Python subset written in Rust");
		expect(spilled).toContain("second paragraph");
		expect(spilled).not.toContain("Cookie policy");
		expect(spilled).not.toContain("All rights reserved");
		expect(result.head).toBe(plain(spilled).slice(0, 2000));
		expect(result.head.length).toBeLessThanOrEqual(2000);
	});

	it("gives the same URL the same file, so a path means the most recent fetch", async () => {
		const dir = scratch();
		const first = await fetchContent("http://example.com/post", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respond(article, "text/html").impl });
		const second = await fetchContent("http://example.com/post", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respond(article, "text/html").impl });
		expect(second.path).toBe(first.path);
		expect(readdirSync(join(dir, "web"))).toHaveLength(1);
		const other = await fetchContent("http://example.com/other", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respond(article, "text/html").impl });
		expect(other.path).not.toBe(first.path);
	});

	it("passes text-ish bodies through, fenced on disk, with the type's extension", async () => {
		const dir = scratch();
		const text = await fetchContent("http://example.com/a.txt", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respond("plain body", "text/plain; charset=utf-8").impl });
		expect(text.path.endsWith(".txt")).toBe(true);
		if (!("chars" in text)) throw new Error("expected a markdown envelope");
		expect(text.chars).toBe(10);
		expect(text.head).toBe("plain body");
		expect(text.title).toBe("");
		expect(readFileSync(text.path, "utf8")).toBe(fenceText("plain body"));

		const json = await fetchContent("http://example.com/a.json", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respond('{"a":1}', "application/json").impl });
		expect(json.path.endsWith(".json")).toBe(true);
	});

	it("falls back to the raw body and says so when nothing is extractable", async () => {
		const dir = scratch();
		const { impl } = respond("", "text/plain");
		const result = await fetchContent("http://example.com/empty", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: impl });
		if (!("chars" in result)) throw new Error("expected a markdown envelope");
		expect(result.chars).toBe(0);
		expect(result.note).toMatch(/the response was empty/);
		expect(readFileSync(result.path, "utf8")).toBe("");
	});

	it("spills a JavaScript shell as its raw HTML rather than an empty file", async () => {
		const dir = scratch();
		const shell = `<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script>window.boot()</script></body></html>`;
		const result = await fetchContent("http://spa.example/", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respond(shell, "text/html").impl });
		if (!("chars" in result)) throw new Error("expected a markdown envelope");
		// Readability returns null for a shell with no article, which is the signal the
		// contract is built on (ticket 05): chars 0, a note, and the raw HTML on disk.
		expect(result.chars).toBe(0);
		expect(result.note).toMatch(/no readable content/);
		// A text-ish raw fallback is fenced too: the HTML is page text a cell may read.
		expect(result.note).toMatch(/fenced/);
		expect(readFileSync(result.path, "utf8").startsWith(OPEN_MARKER)).toBe(true);
		expect(readFileSync(result.path, "utf8")).toContain("window.boot()");
	});

	it("refuses content types it cannot honestly deliver, in both modes", async () => {
		const dir = scratch();
		for (const mode of ["markdown", "raw"] as const) {
			const error = (await fetchContent("http://example.com/pic.png", { mode, scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respond("binary", "image/png").impl }).catch((caught: unknown) => caught)) as Error;
			expect(`${mode}: ${error.name}`).toBe(`${mode}: ValueError`);
			expect(error.message).toMatch(/unsupported content type image\/png/);
		}
	});

	it("reports an unreadable PDF as OSError", async () => {
		const dir = scratch();
		const error = (await fetchContent("http://example.com/paper.pdf", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respond("not really a pdf", "application/pdf").impl }).catch((caught: unknown) => caught)) as Error;
		expect(error.name).toBe("OSError");
		expect(error.message).toMatch(/could not read the PDF/);
	});
});

describe("fetch_content, raw mode (ticket 05: the bytes, on disk)", () => {
	it("writes the bytes and returns only a path, size and type", async () => {
		const dir = scratch();
		const { impl } = respond(article, "text/html");
		const result = await fetchContent("http://example.com/post", { mode: "raw", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: impl });
		if (!("bytes" in result)) throw new Error("expected a raw envelope");
		expect(Object.keys(result).sort()).toEqual(["bytes", "content_type", "path", "url"]);
		expect(result.content_type).toBe("text/html");
		expect(result.path.endsWith(".html")).toBe(true);
		expect(readFileSync(result.path, "utf8")).toBe(article);
		expect(result.bytes).toBe(Buffer.byteLength(article));
	});
});

describe("the guard runs inside fetch_content", () => {
	it("refuses a loopback URL before any request is made", async () => {
		const dir = scratch();
		const { impl, calls } = respond("should not be fetched", "text/html");
		const error = (await fetchContent("http://127.0.0.1/", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: impl }).catch((caught: unknown) => caught)) as Error;
		expect(error.name).toBe("ValueError");
		expect(error.message).toMatch(/Blocked internal address/);
		expect(calls).toEqual([]);
	});
});

describe("spill naming", () => {
	it("is derived from the URL, readable, and stable", () => {
		const dir = "/tmp/scratch";
		const path = spillPath(dir, "https://simonwillison.net/2026/Feb/6/pydantic-monty/?utm=1", "md");
		expect(path.startsWith(`${dir}/web/simonwillison.net-2026-Feb-6-pydantic-monty-`)).toBe(true);
		expect(path.endsWith(".md")).toBe(true);
		expect(spillPath(dir, "https://simonwillison.net/2026/Feb/6/pydantic-monty/?utm=1", "md")).toBe(path);
	});
});
