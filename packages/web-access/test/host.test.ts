import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHost, type HostDeps } from "../host";
import piWebAccess, { webAccessAnswer } from "../host";
import { CLOSE_MARKER, OPEN_MARKER, PREAMBLE } from "../guard";
import type { WebConfig } from "../config";
import type { SessionInput } from "../../host-bridge/src/convention";

/** The fence's inverse, for the assertions that predate it: strip the markers a fenced field carries. */
function plain(text: string): string {
	const prefix = `${OPEN_MARKER}${PREAMBLE}\n`;
	const suffix = `\n${CLOSE_MARKER}`;
	return text.startsWith(prefix) && text.endsWith(suffix) ? text.slice(prefix.length, -suffix.length) : text;
}

const config: WebConfig = {
	path: "(test)",
	raw: null,
	providers: ["duckduckgo", "anysearch"],
	anysearchApiKey: "test-key",
	allowRanges: [],
	domainPolicy: { allow: [], deny: [] },
};

function ddgPage(results: Array<{ title: string; url: string; snippet?: string }>): string {
	return `<html><body>${results
		.map(
			(result) =>
				`<div class="result"><a class="result__a" href="${result.url}">${result.title}</a><a class="result__snippet">${result.snippet ?? ""}</a></div>`,
		)
		.join("")}</body></html>`;
}

const anysearchBody = {
	code: 0,
	message: "success",
	data: { results: [{ title: "Any result", url: "https://any.example/", snippet: "from anysearch", content: "extract" }], metadata: {} },
};

/** A fetch that answers by host, and records every URL it was asked for. */
function router(handlers: Record<string, () => Response>) {
	const calls: Array<{ url: string; maxResults?: number }> = [];
	const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const body = init?.body ? String(init.body) : "";
		calls.push({ url, maxResults: body ? (JSON.parse(body) as { max_results?: number }).max_results : undefined });
		for (const [host, handler] of Object.entries(handlers)) {
			if (url.includes(host)) return handler();
		}
		throw new Error(`no handler for ${url}`);
	}) as unknown as typeof fetch;
	return { impl, calls };
}

function makeHost(handlers: Record<string, () => Response>, sessionFile?: string, extraDeps: Partial<HostDeps> = {}) {
	const { impl, calls } = router(handlers);
	const host = createHost({ cwd: "/tmp", sessionFile, progress: () => {} }, { config, fetchImpl: impl, ...extraDeps });
	return { host, calls };
}

describe("web_search's arguments (ticket 04)", () => {
	const { host } = makeHost({});

	it("rejects the wrong types as TypeError", async () => {
		await expect(host.web_search(123)).rejects.toThrow(/query must be a string/);
		await expect(host.web_search("q", "5")).rejects.toThrow(/num_results must be a number/);
		await expect(host.web_search("q", 5, 7)).rejects.toThrow(/provider must be a name or a list/);
		await expect(host.web_search("q", 5, ["duckduckgo", 7])).rejects.toThrow(/provider names must be strings/);
		await expect(host.web_search("q", 5, null, "example.com")).rejects.toThrow(/domain_filter must be a list/);
	});

	it("rejects bad values as ValueError, naming what is wrong", async () => {
		await expect(host.web_search("   ")).rejects.toThrow(/query must not be empty/);
		await expect(host.web_search("q", 5, "google")).rejects.toThrow(/unknown provider "google"/);
		await expect(host.web_search("q", 5, [])).rejects.toThrow(/provider list is empty/);
		await expect(host.web_search("q", 5, null, ["nope"])).rejects.toThrow(/not a hostname/);
	});
});

describe("monty's calling convention (found by the first live integration run)", () => {
	it("accepts Python keyword arguments as a trailing object", async () => {
		const { host, calls } = makeHost({ "api.anysearch.com": () => Response.json(anysearchBody) });
		// Exactly what `await web_search("q", num_results=3, provider=["anysearch"])` looks like from JS.
		const byKeyword = await host.web_search("q", { num_results: 3, provider: ["anysearch"] });
		expect(byKeyword.provider).toBe("anysearch");
		expect(calls[0]!.maxResults).toBe(3);
	});

	it("still accepts positionals, and a mix of both", async () => {
		const { host, calls } = makeHost({ "api.anysearch.com": () => Response.json(anysearchBody) });
		await host.web_search("q", 4, ["anysearch"]);
		expect(calls[0]!.maxResults).toBe(4);
		const { host: host2, calls: calls2 } = makeHost({ "api.anysearch.com": () => Response.json(anysearchBody) });
		await host2.web_search("q", { provider: ["anysearch"] });
		expect(calls2[0]!.maxResults).toBe(5);
	});

	it("applies the same convention to fetch_content's mode", async () => {
		const sessionFile = join(mkdtempSync(join(tmpdir(), "pi-web-access-kwargs-")), "session.jsonl");
		const { host } = makeHost({ "example.com": () => new Response("body", { status: 200, headers: { "content-type": "text/plain" } }) }, sessionFile);
		const byKeyword = await host.fetch_content("http://example.com/a.txt", { mode: "raw" });
		expect("bytes" in byKeyword).toBe(true);
		const positional = await host.fetch_content("http://example.com/a.txt", "raw");
		expect("bytes" in positional).toBe(true);
		const defaulted = await host.fetch_content("http://example.com/a.txt");
		expect("chars" in defaulted).toBe(true);
	});
});
describe("provider order and fallback (ticket 04)", () => {
	it("falls through a failing provider and reports it as data, not as an exception", async () => {
		const { host, calls } = makeHost({
			"html.duckduckgo.com": () => new Response("rate limited", { status: 429 }),
			"api.anysearch.com": () => Response.json(anysearchBody),
		});
		const result = await host.web_search("monty python subset");
		expect(result.provider).toBe("anysearch");
		expect(result.results).toHaveLength(1);
		expect(plain(result.results[0]!.content)).toBe("extract");
		expect(result.errors.duckduckgo).toMatch(/HTTP 429/);
		expect(calls.map((call) => call.url.split("/")[2])).toEqual(["html.duckduckgo.com", "api.anysearch.com"]);
	});

	it("honours an explicit provider list and does not call the others", async () => {
		const { host, calls } = makeHost({
			"html.duckduckgo.com": () => new Response(ddgPage([{ title: "DDG", url: "https://ddg.example/" }])),
			"api.anysearch.com": () => Response.json(anysearchBody),
		});
		const result = await host.web_search("q", 5, ["anysearch"]);
		expect(result.provider).toBe("anysearch");
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toContain("api.anysearch.com");
	});

	it("raises RuntimeError only when every provider failed, listing each failure", async () => {
		const { host } = makeHost({
			"html.duckduckgo.com": () => new Response("nope", { status: 500 }),
			"api.anysearch.com": () => new Response("nope", { status: 500 }),
		});
		const error = (await host.web_search("q").catch((caught: unknown) => caught)) as Error;
		expect(error.name).toBe("RuntimeError");
		expect(error.message).toMatch(/every provider failed for "q"/);
		expect(error.message).toMatch(/duckduckgo: .*HTTP 500/);
		expect(error.message).toMatch(/anysearch: .*HTTP 500/);
	});

	it("clamps num_results rather than refusing it, and asks AnySearch for the clamped number", async () => {
		const { host, calls } = makeHost({ "api.anysearch.com": () => Response.json(anysearchBody) });
		await host.web_search("q", 100, ["anysearch"]);
		expect(calls[0]!.maxResults).toBe(20);
		const { host: host2, calls: calls2 } = makeHost({ "api.anysearch.com": () => Response.json(anysearchBody) });
		await host2.web_search("q", 0, ["anysearch"]);
		expect(calls2[0]!.maxResults).toBe(1);
	});
});

describe("domain_filter is applied by us, identically for both providers (ticket 04)", () => {
	const page = ddgPage([
		{ title: "A", url: "https://a.example.com/1" },
		{ title: "B", url: "https://b.example.com/2" },
		{ title: "C", url: "https://other.example/3" },
	]);

	it("keeps only allowed hosts, subdomains included", async () => {
		const { host, calls } = makeHost({ "html.duckduckgo.com": () => new Response(page) });
		const result = await host.web_search("q", 5, null, ["example.com"]);
		expect(result.results.map((entry) => plain(entry.title))).toEqual(["A", "B"]);
		expect(result.errors).toEqual({});
		// Over-fetched, because filtering happens after the provider answers.
		expect(calls[0]!.url).toContain("html.duckduckgo.com");
	});

	it("drops denied hosts, with the - prefix", async () => {
		const { host } = makeHost({ "html.duckduckgo.com": () => new Response(page) });
		const result = await host.web_search("q", 5, null, ["-example.com"]);
		expect(result.results.map((entry) => plain(entry.title))).toEqual(["C"]);
	});

	it("returns a short list rather than an error when nothing survives", async () => {
		const { host } = makeHost({
			"html.duckduckgo.com": () => new Response(page),
			"api.anysearch.com": () => Response.json(anysearchBody),
		});
		const result = await host.web_search("q", 5, null, ["nothing.example"]);
		// both providers were tried, both had nothing that survived, and the answer is empty
		expect(result.results).toEqual([]);
		expect(Object.keys(result.errors).sort()).toEqual(["anysearch", "duckduckgo"]);
		expect(result.errors.duckduckgo).toMatch(/none survived domain_filter/);
	});
});

describe("fetch_content's arguments and scratch (tickets 04 and 05)", () => {
	it("validates url and mode", async () => {
		const { host } = makeHost({});
		await expect(host.fetch_content(7)).rejects.toThrow(/url must be a string/);
		await expect(host.fetch_content("  ")).rejects.toThrow(/url must not be empty/);
		await expect(host.fetch_content("http://example.com/", "text")).rejects.toThrow(/mode must be "markdown" or "raw"/);
	});

	it("spills under the kernel's own scratch, which is what the sandbox mounts", async () => {
		const sessionFile = join(mkdtempSync(join(tmpdir(), "pi-web-access-session-")), "session.jsonl");
		const { host } = makeHost({ "example.com": () => new Response("<html><body><p>hello</p></body></html>", { status: 200, headers: { "content-type": "text/html" } }) }, sessionFile);
		const result = await host.fetch_content("http://example.com/page", "raw");
		if (!("bytes" in result)) throw new Error("expected a raw envelope");
		expect(result.path.startsWith(`${sessionFile}.scratch/web/`)).toBe(true);
	});
});

describe("the kernel route's fence (web-access's own output)", () => {
	it("fences a search result's title, snippet and content, and the error strings", async () => {
		const { host } = makeHost({
			"html.duckduckgo.com": () => new Response("rate limited", { status: 429 }),
			"api.anysearch.com": () => Response.json(anysearchBody),
		});
		const result = await host.web_search("q");
		expect(result.results[0]!.content.startsWith(OPEN_MARKER)).toBe(true);
		expect(result.results[0]!.snippet.startsWith(OPEN_MARKER)).toBe(true);
		expect(result.results[0]!.title.startsWith(OPEN_MARKER)).toBe(true);
		expect(plain(result.results[0]!.content)).toBe("extract");
		expect(result.errors.duckduckgo!.startsWith(OPEN_MARKER)).toBe(true);
		// The caller's own text is not fenced.
		expect(result.query).toBe("q");
	});

	it("fences a fetched page's title and head, leaving path and counts intact", async () => {
		const sessionFile = join(mkdtempSync(join(tmpdir(), "pi-web-access-fence-")), "session.jsonl");
		const { host } = makeHost(
			{
				"example.com": () =>
					new Response("<html><head><title>Hi</title></head><body><p>hello</p></body></html>", {
						status: 200,
						headers: { "content-type": "text/html" },
					}),
			},
			sessionFile,
		);
		const result = await host.fetch_content("http://example.com/page");
		if (!("head" in result)) throw new Error("expected a markdown envelope");
		expect(result.head.startsWith(OPEN_MARKER)).toBe(true);
		expect(result.head).toContain("hello");
		expect(result.title.startsWith(OPEN_MARKER)).toBe(true);
		expect(result.chars).toBeGreaterThan(0);
		expect(result.path.endsWith(".md")).toBe(true);
		// The spill file itself is fenced: the model reads it with read_text/grep, not the envelope.
		expect(readFileSync(result.path, "utf8").startsWith(OPEN_MARKER)).toBe(true);
	});

	it("leaves a raw fetch envelope alone (its bytes carry no text field)", async () => {
		const sessionFile = join(mkdtempSync(join(tmpdir(), "pi-web-access-raw-")), "session.jsonl");
		const { host } = makeHost(
			{ "example.com": () => new Response("body", { status: 200, headers: { "content-type": "text/plain" } }) },
			sessionFile,
		);
		const result = await host.fetch_content("http://example.com/a.txt", "raw");
		if (!("bytes" in result)) throw new Error("expected a raw envelope");
		expect(result.bytes).toBe(4);
		expect(JSON.stringify(result)).not.toContain(OPEN_MARKER);
	});
});

describe('fetch_content\'s escape hatch (via="shell")', () => {
	/** The curl stand-in: writes the body where the hatch's own `-o` points. */
	function curlStub(body: string, contentType: string) {
		const calls: string[][] = [];
		const shellExec = async (args: string[]) => {
			calls.push(args);
			writeFileSync(args[args.indexOf("-o") + 1]!, body);
			return { code: 0, stdout: Buffer.from(`${contentType}\t${args[args.length - 1]}\t200`), stderr: Buffer.from("") };
		};
		return { shellExec, calls };
	}

	it("binds via and args, positionally and by keyword, and runs curl for via=shell", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-web-access-hatch-"));
		const { shellExec, calls } = curlStub("plain body", "text/plain");
		const { host } = makeHost({}, join(dir, "session.jsonl"), { shellExec });

		const positional = await host.fetch_content("http://localhost:3000/a.txt", "markdown", "shell", ["-H", "X: 1"]);
		if (!("chars" in positional)) throw new Error("expected a markdown envelope");
		expect(positional.via).toBe("shell");
		expect(plain(readFileSync(positional.path, "utf8"))).toBe("plain body");
		expect(calls[0]).toContain("X: 1");

		const byKeyword = await host.fetch_content("http://localhost:3000/a.txt", { via: "shell" });
		expect(byKeyword.via).toBe("shell");
		expect(calls.length).toBe(2);

		// The default route is still the guarded one, and it does not run curl.
		await host.fetch_content("http://example.com/a.txt").catch(() => {});
		expect(calls.length).toBe(2);
	});

	it("rejects a bad via as ValueError, and args that is not a list of strings as TypeError", async () => {
		const { host } = makeHost({});
		await expect(host.fetch_content("http://example.com/", "markdown", "curl")).rejects.toThrow(/via must be "http" or "shell"/);
		await expect(host.fetch_content("http://example.com/", { via: "shell", args: "-H x" })).rejects.toThrow(/args must be a list of curl flags/);
		await expect(host.fetch_content("http://example.com/", { via: "shell", args: ["-H", 7] })).rejects.toThrow(/args must be a list of curl flags/);
	});
});

describe("the egress policy this package contributes", () => {
	/** The answer for one session, asked exactly as the composition root asks it. */
	function answer(apiVersion: number) {
		return webAccessAnswer({
			cwd: "/tmp",
			sessionKey: "s",
			ctx: {},
			isChild: false,
			progress: () => {},
			handle: { apiVersion },
		} as unknown as SessionInput);
	}
	const call = (name: string, args: unknown[]) => ({ name, args }) as never;

	it("at contract 5, declares one with no problems and refuses a fetch-shaped call", async () => {
		const verdicts = answer(5);
		expect(verdicts.problems).toEqual([]);
		const before = verdicts.contribution?.egress?.before;
		if (before === undefined) throw new Error("expected an egress policy");
		const refused = await before(call("bash_host", ["curl -s https://example.com"]));
		expect(refused).toEqual({ allow: false, reason: expect.stringContaining("fetch_content") });
		// Its own two functions are the sanctioned route, a local command is not its subject, and a
		// name it does not know is not its business either — the slot is one policy, not a censor.
		expect(await before(call("fetch_content", ["https://example.com"]))).toBeUndefined();
		expect(await before(call("bash_host", ["ls -la"]))).toBeUndefined();
		expect(await before(call("someones_else_fetch", ["https://example.com"]))).toBeUndefined();
	});

	it("below 5 keeps the refusal but drops the grant, and says so", async () => {
		const older = answer(4);
		const before = older.contribution?.egress?.before;
		if (before === undefined) throw new Error("expected an egress policy");
		// The fetch refusal is unchanged...
		const fetched = await before(call("bash_host", ["curl -s https://example.com"]));
		expect(fetched).toEqual({ allow: false, reason: expect.stringContaining("fetch_content") });
		// ...and an otherwise-grantable target is refused with the code mode's version named.
		const refused = await before(call("bash_host", ["ssh dev@build-box"]));
		expect(refused).toEqual({ allow: false, reason: expect.stringContaining("contract version 4") });
		const problems = (older.problems ?? []).join(" ");
		expect(problems).toContain("granting a target needs 5");
		expect(problems).toContain("/ssh-grant is unavailable");
	});

	it("omits it below version 4 and says so, instead of the session believing itself guarded", () => {
		const tooOld = answer(3);
		expect(tooOld.contribution?.egress).toBeUndefined();
		// It degrades loud and *not* closed: the host functions and the rule are still contributed.
		expect(tooOld.contribution?.hostFns).toBeDefined();
		expect(tooOld.contribution?.description ?? "").toContain("fetch_content");
		const problems = (tooOld.problems ?? []).join(" ");
		expect(problems).toContain("contract version 3");
		expect(problems).toContain("NOT refused");
		// A second sentence, beside the existing one: the grant route is unavailable too.
		expect(problems).toContain("granting a target needs 5");
	});
});

describe("pi install loads the guard too", () => {
	it("registers both guard layers and the /ssh-grant session read on the extension api", () => {
		const events: string[] = [];
		piWebAccess({ on: (event: string) => events.push(event) } as never);
		expect(events).toEqual(["before_agent_start", "tool_result", "session_start", "session_shutdown"]);
	});
});

describe("the shell guideline keeps its ban and gains the ask route", () => {
	/** The answer for one session, asked exactly as the composition root asks it. */
	function answer() {
		return webAccessAnswer({
			cwd: "/tmp",
			sessionKey: "s",
			ctx: {},
			isChild: false,
			progress: () => {},
			handle: { apiVersion: 4 },
		} as unknown as SessionInput);
	}

	const shellGuideline = () =>
		(answer().contribution?.guidelines ?? []).find((line) =>
			line.startsWith("Do not fetch a page with a shell command"),
		) ?? "";

	it("still refuses a shell fetch, and still calls it unfenced", () => {
		expect(shellGuideline()).toContain("use await fetch_content(url)");
		expect(shellGuideline()).toContain("a shell fetch does not");
		expect(shellGuideline()).toContain("the session may refuse one outright");
	});

	it("names the granted route and, now that it exists, the /ssh-grant command", () => {
		// The route is described by what happens, and the up-front command is named now that ticket 06
		// built it — ticket 08 deliberately left it out while a session could not yet run it. What the
		// line must still say is that a grant is a human's to give.
		expect(shellGuideline()).toContain("a target only an ssh connection reaches");
		expect(shellGuideline()).toContain("a human is asked for one if a dialog can appear");
		expect(shellGuideline()).toContain("/ssh-grant <key>");
		expect(shellGuideline()).toContain("do not read a refusal as an invitation to route around it");
		expect(shellGuideline()).toContain("No grant exists until a human gives one");
	});
});
