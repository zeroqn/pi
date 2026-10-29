import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

/** A response the server sent with no `Content-Type` at all (the spec gives a string body a
 *  default, so it is deleted): `fetchContent` then assumes octet-stream. */
function respondBare(body: string | Uint8Array, status = 200) {
	const impl = (async () => {
		const response = new Response(body as BodyInit, { status });
		response.headers.delete("content-type");
		return response;
	}) as unknown as typeof fetch;
	return { impl };
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

	it("refuses a declared binary, and names the route that keeps its bytes", async () => {
		const dir = scratch();
		const error = (await fetchContent("http://example.com/pic.png", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respond("binary", "image/png").impl }).catch((caught: unknown) => caught)) as Error;
		expect(error.name).toBe("ValueError");
		expect(error.message).toMatch(/unsupported content type image\/png/);
		// The remedy is `mode="raw"`, not the shell hatch: `via="shell"` feeds the same pipeline and
		// would refuse with these very words, so naming it sent a session round a loop.
		expect(error.message).toContain('use mode="raw"');
		expect(error.message).not.toContain('via="shell"');
	});

	it("raw mode keeps the bytes of a declared binary, with a usable extension", async () => {
		const dir = scratch();
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
		const result = await fetchContent("http://example.com/pic.png", { mode: "raw", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respond(bytes, "image/png").impl });
		if (!("bytes" in result)) throw new Error("expected a raw envelope");
		expect(result.content_type).toBe("image/png");
		expect(result.path.endsWith(".png")).toBe(true);
		expect([...readFileSync(result.path)]).toEqual([...bytes]);
	});

	it("reports an empty HTML body as empty rather than as a library failure", async () => {
		const dir = scratch();
		// A 204, or a challenge page with no body: Readability used to throw on the empty document,
		// and the throw escaped as a bare `Error` naming no URL, no status and no type.
		const empty = respond("", "text/html").impl;
		// A 204 cannot be built with a body, so its response is spelled out.
		const noContent = (async () => new Response(null, { status: 204, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
		for (const impl of [empty, noContent]) {
			const result = await fetchContent("http://example.com/gone", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: impl });
			if (!("chars" in result)) throw new Error("expected a markdown envelope");
			expect(result.chars).toBe(0);
			expect(result.note ?? "").toContain("the response was empty");
			expect(readFileSync(result.path, "utf8")).toBe("");
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

describe("fetch_content, an undeclared content type (sniffed, not refused)", () => {
	const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03]);

	it("delivers an octet-stream text body as text, and says where the type came from", async () => {
		const dir = scratch();
		const result = await fetchContent("http://example.com/notes", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respond("plain body", "application/octet-stream").impl });
		if (!("chars" in result)) throw new Error("expected a markdown envelope");
		expect(result.path.endsWith(".txt")).toBe(true);
		expect(result.chars).toBe(10);
		expect(result.head).toBe("plain body");
		expect(result.note).toMatch(/server declared application\/octet-stream; the body decodes as text/);
		expect(readFileSync(result.path, "utf8")).toBe(fenceText("plain body"));
	});

	it("does the same when the server sends no content type at all", async () => {
		const dir = scratch();
		const result = await fetchContent("http://example.com/notes", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respondBare("plain body").impl });
		if (!("chars" in result)) throw new Error("expected a markdown envelope");
		expect(result.path.endsWith(".txt")).toBe(true);
		expect(result.chars).toBe(10);
		expect(readFileSync(result.path, "utf8")).toBe(fenceText("plain body"));
	});

	it("extracts an undeclared HTML body instead of handing back raw markup", async () => {
		const dir = scratch();
		const result = await fetchContent("http://example.com/post", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respondBare(article).impl });
		if (!("chars" in result)) throw new Error("expected a markdown envelope");
		expect(result.path.endsWith(".md")).toBe(true);
		expect(result.title).toBe("Monty notes");
		const spilled = readFileSync(result.path, "utf8");
		expect(spilled).toContain("sandboxed Python subset written in Rust");
		expect(spilled).not.toContain("Cookie policy");
		expect(result.chars).toBe(plain(spilled).length);
		expect(result.note).toMatch(/the body decodes as HTML/);
	});

	it("spills an octet-stream body that is not text, with a note rather than a decode", async () => {
		const dir = scratch();
		const result = await fetchContent("http://example.com/blob", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respond(bytes, "application/octet-stream").impl });
		if (!("chars" in result)) throw new Error("expected a markdown envelope");
		expect(result.chars).toBe(0);
		expect(result.note).toMatch(/not text despite the application\/octet-stream declaration/);
		expect(readFileSync(result.path).equals(Buffer.from(bytes))).toBe(true);
	});

	it("raw mode writes the bytes of an octet-stream response, as it always did", async () => {
		const dir = scratch();
		const result = await fetchContent("http://example.com/blob", { mode: "raw", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: respond("plain body", "application/octet-stream").impl });
		if (!("bytes" in result)) throw new Error("expected a raw envelope");
		expect(result.content_type).toBe("application/octet-stream");
		expect(result.path.endsWith(".bin")).toBe(true);
		expect(readFileSync(result.path, "utf8")).toBe("plain body");
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

// ---------------------------------------------------------------------------
// via="shell": the escape hatch. The hatch exists because a refusal here does not stop a session
// that needs the page — it sends it to `bash` and `curl`, and that text arrives with no fence on it
// at all. So the fetch is done by the package, on the same pipeline, and fenced the same way.
// ---------------------------------------------------------------------------

/** A stand-in for the curl child process, not for the hatch: it reads the argv the hatch built,
 *  writes the body where `-o` points, and answers the `-w` line curl would print on stdout. */
function curlStub(
	body: string | Uint8Array,
	contentType: string,
	options: { status?: number; url?: string; code?: number; stderr?: string; throws?: string } = {},
) {
	const calls: Array<{ args: string[]; timeoutMs: number }> = [];
	const shellExec = async (args: string[], opts: { timeoutMs: number }) => {
		calls.push({ args, timeoutMs: opts.timeoutMs });
		if (options.throws !== undefined) throw new Error(options.throws);
		if (options.code !== undefined && options.code !== 0) {
			return { code: options.code, stdout: Buffer.from(""), stderr: Buffer.from(options.stderr ?? "") };
		}
		const outIndex = args.indexOf("-o");
		writeFileSync(args[outIndex + 1]!, body);
		const url = args[args.length - 1]!;
		return { code: 0, stdout: Buffer.from(`${contentType}\t${options.url ?? url}\t${options.status ?? 200}`), stderr: Buffer.from("") };
	};
	return { shellExec, calls };
}

describe('fetch_content via="shell" — the escape hatch', () => {
	it("fetches with curl and fences what it returns, exactly as the guarded route does", async () => {
		const dir = scratch();
		const { shellExec, calls } = curlStub(article, "text/html");
		const result = await fetchContent("http://localhost:3000/draft", {
			mode: "markdown",
			scratchDir: dir,
			timeoutMs: 5_000,
			guard,
			via: "shell",
			shellExec,
		});
		if (!("chars" in result)) throw new Error("expected a markdown envelope");
		// The envelope says which route ran, and the note says it in words.
		expect(result.via).toBe("shell");
		expect(result.note ?? "").toContain('via="shell"');
		// The spill is fenced, and it is the *article*, not the nav or the footer.
		const spilled = readFileSync(result.path, "utf8");
		expect(spilled.startsWith(`${OPEN_MARKER}${PREAMBLE}`)).toBe(true);
		expect(spilled.endsWith(CLOSE_MARKER)).toBe(true);
		expect(spilled).toContain("sandboxed Python subset written in Rust");
		expect(result.chars).toBe(plain(spilled).length);
		expect(calls.length).toBe(1);
	});

	it("reaches an address the guarded client refuses, which is the whole point", async () => {
		const dir = scratch();
		const { shellExec, calls } = curlStub("plain body", "text/plain");
		// The guarded route refuses this host before DNS (`Blocked internal hostname`); the hatch
		// must not, because a server on localhost is a legitimate reason to have one.
		const result = await fetchContent("http://localhost:3000/a.txt", {
			mode: "markdown",
			scratchDir: dir,
			timeoutMs: 5_000,
			guard: { ...guard, lookup: async () => ["127.0.0.1"] },
			via: "shell",
			shellExec,
		});
		expect(calls.length).toBe(1);
		expect(plain(readFileSync(result.path, "utf8"))).toBe("plain body");
	});

	it("keeps the operator's domain policy: the hatch is not a way around a configured decision", async () => {
		const dir = scratch();
		const { shellExec, calls } = curlStub(article, "text/html");
		const denied = { ...guard, domainPolicy: { allow: [], deny: ["reddit.com"] } };
		await expect(
			fetchContent("https://www.reddit.com/r/x", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard: denied, via: "shell", shellExec }),
		).rejects.toThrow(/domain policy/);
		expect(calls.length).toBe(0);
	});

	it("passes the caller's flags through, puts the URL last, and owns the output file", async () => {
		const dir = scratch();
		const { shellExec, calls } = curlStub('{"ok":true}', "application/json");
		const result = await fetchContent("https://api.example.com/v1/thing", {
			mode: "markdown",
			scratchDir: dir,
			timeoutMs: 7_000,
			guard,
			via: "shell",
			shellArgs: ["-H", "Authorization: Bearer t", "-X", "POST", "--data", "{}"],
			shellExec,
		});
		const { args, timeoutMs } = calls[0]!;
		expect(args.slice(0, 2)).toEqual(["-sS", "-L"]);
		expect(args).toContain("Authorization: Bearer t");
		expect(args[args.length - 1]).toBe("https://api.example.com/v1/thing");
		// Ours come after theirs, so our `-o` is the one that decides where the body lands.
		expect(args[args.indexOf("-o") + 1]).toContain(".curl-");
		expect(timeoutMs).toBe(7_000);
		expect(plain(readFileSync(result.path, "utf8"))).toBe('{"ok":true}');
	});

	it("says so when the response was not a success, rather than pretending it fetched a page", async () => {
		const dir = scratch();
		const { shellExec } = curlStub("<html><body>nope</body></html>", "text/html", { status: 403 });
		const result = await fetchContent("https://example.com/private", {
			mode: "markdown",
			scratchDir: dir,
			timeoutMs: 5_000,
			guard,
			via: "shell",
			shellExec,
		});
		if (!("chars" in result)) throw new Error("expected a markdown envelope");
		expect(result.note ?? "").toContain("HTTP 403");
	});

	it("raw mode keeps its bytes, and still says the shell route produced them", async () => {
		const dir = scratch();
		// An undeclared type is the one raw mode accepts without an extraction attempt — and what
		// curl reports when the server sends no `Content-Type` at all.
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		const { shellExec } = curlStub(bytes, "application/octet-stream");
		const result = await fetchContent("https://example.com/i.png", { mode: "raw", scratchDir: dir, timeoutMs: 5_000, guard, via: "shell", shellExec });
		if (!("bytes" in result)) throw new Error("expected a raw envelope");
		expect(result.via).toBe("shell");
		expect([...readFileSync(result.path)]).toEqual([...bytes]);
	});

	it("reads the -w line field by field, so a response with no Content-Type keeps its type empty", async () => {
		const dir = scratch();
		// curl prints `\t<url>\t<status>` when the server sends no Content-Type. Trimming the line
		// before splitting it dropped that empty field: the URL became the "content type" and the
		// status became the URL, so the model was told its own URL was an unsupported media type.
		const { shellExec } = curlStub("plain body", "");
		const result = await fetchContent("http://localhost:3000/a.txt", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, via: "shell", shellExec });
		if (!("chars" in result)) throw new Error("expected a markdown envelope");
		// An undeclared body is sniffed, exactly as the guarded route does: text, delivered as text.
		expect(plain(readFileSync(result.path, "utf8"))).toBe("plain body");
		expect(result.url).toBe("http://localhost:3000/a.txt");
		expect(result.note ?? "").toContain("the server declared application/octet-stream");
	});

	it("reports a curl timeout as a timeout, not as a curl that would not start", async () => {
		const dir = scratch();
		// `execFile` kills the child at `timeout` and answers an error with `killed: true`: curl ran
		// fine and was killed, so "could not run curl" is the wrong story and sends a session hunting
		// for a missing binary.
		const shellExec = async () => {
			throw Object.assign(new Error("Command failed: curl -sS -L -o /x/.curl-1.body -w …"), { killed: true, signal: "SIGTERM", code: null });
		};
		const error = (await fetchContent("https://example.com/slow", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, via: "shell", shellExec }).catch((caught: unknown) => caught)) as Error;
		expect(error.name).toBe("TimeoutError");
		expect(error.message).toContain("timed out after 5000 ms");
		expect(error.message).not.toContain("could not run curl");
	});

	it("raises OSError naming curl's own exit and stderr, and one when curl cannot run at all", async () => {
		const dir = scratch();
		const failing = curlStub("", "", { code: 6, stderr: "Could not resolve host: nope.invalid" });
		await expect(
			fetchContent("https://nope.invalid/", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, via: "shell", shellExec: failing.shellExec }),
		).rejects.toThrow(/curl exited 6 .*Could not resolve host/);
		const missing = curlStub("", "", { throws: "spawn curl ENOENT" });
		await expect(
			fetchContent("https://example.com/", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, via: "shell", shellExec: missing.shellExec }),
		).rejects.toThrow(/could not run curl.*ENOENT/);
	});

	it("refuses the args that would stop it being a fetch, and names the route that keeps the bytes", async () => {
		const dir = scratch();
		const { shellExec, calls } = curlStub("x", "text/plain");
		// The flags that name an output file steer to the route that keeps the bytes on disk.
		for (const arg of ["-o", "--output=f.md", "-O", "--remote-name", "-J", "--output-dir", "--create-dirs"]) {
			await expect(
				fetchContent("https://example.com/x", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, via: "shell", shellArgs: [arg, "value"], shellExec }),
			).rejects.toThrow(/args must not .*mode="raw"/);
		}
		// A URL belongs in `url`, not in args: a second one takes curl's output-file mapping with it.
		await expect(
			fetchContent("https://example.com/x", {
				mode: "markdown",
				scratchDir: dir,
				timeoutMs: 5_000,
				guard,
				via: "shell",
				shellArgs: ["https://other.example/"],
				shellExec,
			}),
		).rejects.toThrow(/args must not contain a URL.*pass it as url/);

		// The rest are refused for their own reason, each named in the message.
		for (const [arg, why] of [
			["-Tf.zip", /args must not upload a local file/],
			["--upload-file", /args must not upload a local file/],
			["--config", /args must not take further curl options from a file/],
			["-K=g", /args must not take further curl options from a file/],
			["-cJar", /args must not write a cookie jar file/],
			["-D", /args must not write the response headers to a file/],
		] as const) {
			await expect(
				fetchContent("https://example.com/x", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, via: "shell", shellArgs: [arg, "value"], shellExec }),
			).rejects.toThrow(why);
		}
		// Nothing was ever run: the refusal is before the child process, not after it.
		expect(calls.length).toBe(0);
		// The flags a fetch actually needs still pass.
		await fetchContent("https://example.com/x", {
			mode: "markdown",
			scratchDir: dir,
			timeoutMs: 5_000,
			guard,
			via: "shell",
			shellArgs: ["-H", "Accept: text/plain", "-X", "POST", "--data", "{}", "-k", "--compressed"],
			shellExec,
		});
		expect(calls.length).toBe(1);
	});

	it("leaves no body file behind, on either outcome", async () => {
		const dir = scratch();
		const ok = curlStub(article, "text/html");
		await fetchContent("https://example.com/one", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, via: "shell", shellExec: ok.shellExec });
		const failed = curlStub("", "", { code: 7 });
		await fetchContent("https://example.com/two", { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, via: "shell", shellExec: failed.shellExec }).catch(() => {});
		expect(readdirSync(join(dir, "web")).filter((name) => name.startsWith(".curl-"))).toEqual([]);
	});

	it("each refusal names the route that actually gets past it", async () => {
		const dir = scratch();
		const fetchWith = async (url: string, impl: typeof fetch) =>
			(await fetchContent(url, { mode: "markdown", scratchDir: dir, timeoutMs: 5_000, guard, fetchImpl: impl }).catch((caught: unknown) => caught)) as Error;

		// A non-2xx is what the hatch is for: a 403 to our request shape, an authenticated API.
		const forbidden = await fetchWith("https://example.com/private", (async () => new Response("no", { status: 403 })) as unknown as typeof fetch);
		expect(forbidden.message).toContain("HTTP 403");
		expect(forbidden.message).toContain('via="shell"');

		// A content type is not: the hatch runs this same pipeline, so the refusal names mode="raw".
		const zip = await fetchWith("https://example.com/a.zip", (async () => new Response("x", { status: 200, headers: { "content-type": "application/zip" } })) as unknown as typeof fetch);
		expect(zip.message).toContain("unsupported content type");
		expect(zip.message).toContain('use mode="raw"');
		expect(zip.message).not.toContain('via="shell"');
	});
});
