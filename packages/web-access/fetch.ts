/**
 * `fetch_content`'s engine: the guard (ticket 06), the extraction stack (ticket 05), the
 * spill files and the content-type policy. Both delivery modes are decided here, and the
 * envelopes are exactly the ones map tickets 04 and 05 fixed:
 *
 *   markdown -> { url, title, path, chars, head }            head = first 2000 chars
 *               plus `note` when nothing was extractable (the raw body is spilled instead)
 *   raw      -> { url, path, bytes, content_type }           the bytes, on disk, whatever the type
 *
 * A declared type that is not text, HTML or PDF raises `ValueError` in **markdown** mode only: that
 * mode promises text, so extraction has to be honest about what it delivers. `mode="raw"` promises
 * bytes and keeps any type. `application/octet-stream` is not
 * one of those — it is the server declining to say, and it is also what a missing header becomes
 * — so there the bytes decide: HTML and text are delivered as if the type had been declared, and
 * a body that is not text spills raw with a `note`.
 *
 * **Every text spilled to disk is fenced** (`fenceText`): the model reads these files with
 * `read_text`/`grep`, so the file itself must say the content is untrusted, not only the envelope
 * that points at it. Byte spills (raw mode, a PDF with no text, an empty body) stay bytes.
 *
 * ## `via="shell"` — the escape hatch, and why it is here
 *
 * The guarded HTTP client refuses what it is designed to refuse: internal addresses (`localhost`
 * and friends), non-http(s) schemes, and content types the extraction stack does not handle. Those
 * refusals are right for an *automatic* fetch and wrong for a deliberate one — a development server
 * on `localhost:3000`, an authenticated API behind a POST, a page that answers 403 to our client's
 * request shape, a body nothing can extract. A session that needs one of those and cannot get it
 * does not stop: it reaches for `bash` and `curl`, and the text arrives with no
 * `<untrusted_web_content>` marker on it at all. That is the bypass this package's rule, its fence
 * and the kernel's `egress` policy (`egress.ts`) all exist to close, and closing it by refusing the
 * shell fetch outright would trade a real injection risk for a real work stoppage.
 *
 * So the fetch itself is the hatch: `via="shell"` runs `curl` **on this host** and feeds the body
 * back through the *same* pipeline below — same extraction, same spill, same fence. Nothing about
 * the envelope changes but a `via` field and a note saying which route ran.
 *
 * The split of what it skips is deliberate:
 *
 *   - **Skipped:** the address checks (internal hosts, redirect hops, DNS) and the scheme check.
 *     Reaching those is the point of the hatch.
 *   - **Kept:** the operator's `domainPolicy`. That is a decision somebody made in
 *     `web-search.json`, not a safety default, and an escape hatch is not the place to overrule it.
 *     It is checked against the URL asked for, not against a redirect curl followed on its own.
 *   - **Refused, in `args`:** the flags that would stop it being a fetch — anything naming a file for
 *     curl to write or upload, and `--config` (`NON_FETCH_FLAGS`). The hatch fetches into the
 *     envelope; `mode="raw"` is the route that keeps a copy of the bytes.
 *
 * The **content-type policy** is not on that list, because it is not about where the body came from:
 * markdown mode promises text, and both routes keep that promise or refuse. The route for a
 * declared binary is `mode="raw"`, which keeps any type's bytes — so no refusal names the hatch when
 * the hatch would answer with the same refusal.
 */

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { extractText, getDocumentProxy } from "unpdf";
import { webError } from "./errors";
import { assertDomainPolicy, fetchGuarded, type GuardOptions } from "./ssrf";
import { fenceText } from "./guard";

export const HEAD_CHARS = 2000;

export type FetchMode = "markdown" | "raw";

/** Which route obtained the body: the guarded HTTP client (`http`, the default), or `curl` on this
 *  host (`shell`, the escape hatch). Both deliver and fence identically. */
export type FetchVia = "http" | "shell";

export type MarkdownEnvelope = {
	url: string;
	title: string;
	path: string;
	chars: number;
	head: string;
	note?: string;
	/** Present only on the `via="shell"` route, so the model knows a shell fetch produced this. */
	via?: "shell";
};
export type RawEnvelope = { url: string; path: string; bytes: number; content_type: string; via?: "shell" };
export type FetchEnvelope = MarkdownEnvelope | RawEnvelope;

/** Runs `curl` with these argv entries and answers its streams. The default spawns the process;
 *  tests inject one, which is the only reason it is a seam — the hatch is real, not simulated. */
export type ShellExec = (
	args: string[],
	options: { timeoutMs: number },
) => Promise<{ code: number; stdout: Buffer; stderr: Buffer }>;

export type FetchOptions = {
	mode: FetchMode;
	scratchDir: string;
	timeoutMs: number;
	guard: GuardOptions;
	/** How to obtain the body. `shell` is the escape hatch (see the header); default `http`. */
	via?: FetchVia;
	/** Extra `curl` argv, before the URL, for the `shell` route only: `-H`, `-X POST`, `-d`, `-k`. */
	shellArgs?: string[];
	signal?: AbortSignal;
	progress?: (text: string) => void;
	/** Injected in tests. */
	fetchImpl?: typeof fetch;
	shellExec?: ShellExec;
};

/** Declared types whose byte spill is worth naming for the tools that read it back: `read_image`
 *  picks its mime type from the extension, and an archive is opened by its own name. */
const BINARY_EXTENSIONS: Record<string, string> = {
	"application/zip": "zip",
	"application/gzip": "gz",
	"application/x-gzip": "gz",
	"application/x-tar": "tar",
	"application/x-7z-compressed": "7z",
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};

function extensionFor(contentType: string): string {
	const type = contentType.toLowerCase();
	const named = BINARY_EXTENSIONS[type];
	if (named !== undefined) return named;
	if (type.includes("html")) return "html";
	if (type.includes("json")) return "json";
	if (type.includes("xml")) return "xml";
	if (type.includes("pdf")) return "pdf";
	if (type.includes("markdown")) return "md";
	if (type.startsWith("text/")) return "txt";
	return "bin";
}

function isTextish(contentType: string): boolean {
	const type = contentType.toLowerCase();
	return (
		type.startsWith("text/") ||
		type.includes("json") ||
		type.includes("xml") ||
		type.includes("javascript") ||
		type.includes("x-yaml")
	);
}

function isHtml(contentType: string): boolean {
	const type = contentType.toLowerCase();
	return type.includes("text/html") || type.includes("application/xhtml");
}

/** `application/octet-stream` is what a server sends when it does not know the type, and what
 *  `fetchContent` assumes when the header is missing entirely — so it is not a refusal, it is an
 *  invitation to read the bytes (sniffBody). A *declared* non-text type still refuses. */
function isUnknownType(contentType: string): boolean {
	const type = contentType.toLowerCase();
	return type === "application/octet-stream" || type === "binary/octet-stream";
}

const SNIFF_BYTES = 8192;

/** What an undeclared body actually is, read from the bytes. A NUL byte, or any control byte
 *  outside tab/newline/form-feed/carriage-return, is enough to call it binary; a UTF-8 sample
 *  that opens as HTML is HTML, and anything else that decodes is text. */
function sniffBody(buffer: Uint8Array): "html" | "text" | "binary" {
	const sample = buffer.subarray(0, SNIFF_BYTES);
	for (const byte of sample) {
		if (byte === 0) return "binary";
		if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) return "binary";
	}
	const head = new TextDecoder("utf-8").decode(sample);
	return /^\s*(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>])/i.test(head) ? "html" : "text";
}

function decodeBody(buffer: Uint8Array, contentType: string): string {
	const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
	try {
		return new TextDecoder(charset).decode(buffer);
	} catch {
		return new TextDecoder("utf-8").decode(buffer);
	}
}

function slugFor(url: string): string {
	const parsed = new URL(url);
	const path = parsed.pathname.replace(/\/+$/, "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
	const base = `${parsed.hostname}${path ? `-${path}` : ""}`.slice(0, 80).replace(/^-+|-+$/g, "");
	return base || "page";
}

/** `SCRATCH/web/<slug>-<hash>.<ext>`: the same URL always lands in the same file, so a
 *  path means "the most recent fetch of that URL" (ticket 04). */
export function spillPath(scratchDir: string, url: string, extension: string): string {
	const hash = createHash("sha1").update(new URL(url).href).digest("hex").slice(0, 8);
	const dir = `${scratchDir}/web`;
	mkdirSync(dir, { recursive: true });
	return `${dir}/${slugFor(url)}-${hash}.${extension}`;
}

export function extractMarkdown(html: string, url: string): { title: string; markdown: string } | null {
	const { document } = parseHTML(html);
	const article = new Readability(document as unknown as Document, { charThreshold: 0 }).parse();
	if (!article || typeof article.content !== "string") return null;
	const service = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
	const markdown = service.turndown(article.content).trim();
	if (!markdown) return null;
	return { title: article.title ?? "", markdown };
}

export async function fetchContent(url: string, options: FetchOptions): Promise<FetchEnvelope> {
	// The hatch first: everything below this line assumes the guarded client, and the shell route
	// rejoins it at `deliver`, so both routes share the policy, the extraction and the fence.
	if (options.via === "shell") return fetchViaShell(url, options);
	options.progress?.(`fetch_content: ${url.slice(0, 120)} — fetching`);
	const { response, finalUrl } = await fetchGuarded(url, { ...options.guard, timeoutMs: options.timeoutMs, signal: options.signal, fetchImpl: options.fetchImpl });
	const buffer = new Uint8Array(await response.arrayBuffer());
	return deliver(buffer, response.headers.get("content-type") ?? "", finalUrl, options, null);
}

/** The delivery pipeline both routes share: the content-type policy, the extraction stack, the
 *  spill and the fence. `extraNote` carries whatever the route itself has to say (the shell route's
 *  "fetched with curl", a non-2xx status); the envelope's own notes are added here. */
async function deliver(
	buffer: Uint8Array,
	rawContentType: string,
	finalUrl: string,
	options: FetchOptions,
	extraNote: string | null,
): Promise<FetchEnvelope> {
	const via = options.via === "shell" ? ({ via: "shell" } as const) : {};
	const contentType = rawContentType.split(";")[0]!.trim() || "application/octet-stream";

	// Raw mode hands back the bytes, whatever the server declared: the type policy below exists
	// because markdown mode promises *text*, and a file on disk promises nothing of the kind.
	if (options.mode === "raw") {
		const path = spillPath(options.scratchDir, finalUrl, extensionFor(contentType));
		writeFileSync(path, buffer);
		options.progress?.(`fetch_content: wrote ${buffer.length} bytes to ${path}`);
		return { url: finalUrl, path, bytes: buffer.length, content_type: contentType, ...via };
	}

	// The remedy for a type markdown mode cannot deliver is `mode="raw"`, never the shell hatch:
	// `via="shell"` feeds this same function, so it would refuse with these very words.
	const supported = isTextish(contentType) || isHtml(contentType) || contentType.toLowerCase().includes("pdf");
	if (!supported && !isUnknownType(contentType)) {
		throw webError(
			"ValueError",
			`unsupported content type ${contentType} at ${finalUrl} (text, HTML, PDF and undeclared bodies only); use mode="raw" to keep the bytes of anything else`,
		);
	}

	// markdown mode. A declared type we cannot deliver refused above; an undeclared one is decided
	// here, by the bytes.
	const sniff = supported ? null : sniffBody(buffer);
	if (sniff === "binary") {
		return spillRawBody(buffer, finalUrl, contentType, `the body is not text despite the ${contentType} declaration`, options, extraNote);
	}
	// Sniffed HTML and text are delivered as if the server had said so; the note records that the
	// type was a non-answer rather than an extraction guess.
	const type = sniff === "html" ? "text/html" : sniff === "text" ? "text/plain" : contentType;
	const note = joinNotes(
		sniff ? `the server declared ${contentType}; the body decodes as ${sniff === "html" ? "HTML" : "text"}` : null,
		extraNote,
	);

	if (contentType.toLowerCase().includes("pdf")) {
		let text: string;
		try {
			const pdf = await getDocumentProxy(buffer);
			const extracted = await extractText(pdf, { mergePages: true });
			text = (Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text).trim();
		} catch (error) {
			throw webError("OSError", `could not read the PDF at ${finalUrl}: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!text) return spillRawBody(buffer, finalUrl, contentType, "the PDF yielded no text", options, extraNote);
		const path = spillPath(options.scratchDir, finalUrl, "txt");
		writeFileSync(path, fenceText(text));
		options.progress?.(`fetch_content: ${text.length} chars of PDF text to ${path}`);
		return { url: finalUrl, title: "", path, chars: text.length, head: text.slice(0, HEAD_CHARS), ...(note ? { note } : {}), ...via };
	}

	const body = decodeBody(buffer, rawContentType);
	// An empty body is nothing to extract whatever the declared type is. This guard used to live in
	// the non-HTML branch only, so an empty `text/html` response (a 204, a challenge page with no
	// body) reached Readability, which threw a bare library `Error` naming no URL and no status.
	if (!body.trim()) return spillRawBody(buffer, finalUrl, contentType, "the response was empty", options, extraNote);
	if (!isHtml(type)) {
		const path = spillPath(options.scratchDir, finalUrl, extensionFor(type));
		writeFileSync(path, fenceText(body));
		options.progress?.(`fetch_content: ${body.length} chars (${contentType}) to ${path}`);
		return { url: finalUrl, title: "", path, chars: body.length, head: body.slice(0, HEAD_CHARS), ...(note ? { note } : {}), ...via };
	}

	let extracted: { title: string; markdown: string } | null = null;
	try {
		extracted = extractMarkdown(body, finalUrl);
	} catch {
		// The extraction stack is third-party. A body it cannot parse is "nothing extractable",
		// which already has a contract — spill the raw body and say so — not an unlabelled `Error`.
	}
	if (!extracted) {
		return spillRawBody(buffer, finalUrl, type, "no readable content", options, extraNote);
	}
	const path = spillPath(options.scratchDir, finalUrl, "md");
	writeFileSync(path, fenceText(extracted.markdown));
	options.progress?.(`fetch_content: ${extracted.markdown.length} chars of markdown to ${path}`);
	return {
		url: finalUrl,
		title: extracted.title,
		path,
		chars: extracted.markdown.length,
		head: extracted.markdown.slice(0, HEAD_CHARS),
		...(note ? { note } : {}),
		...via,
	};
}

/** The envelope's `note` is one string: the parts join with `; `, and nothing joins to nothing. */
function joinNotes(...parts: (string | null)[]): string | undefined {
	const kept = parts.filter((part): part is string => part !== null && part !== "");
	return kept.length === 0 ? undefined : kept.join("; ");
}

function safeUnlink(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// The body file is scratch; a missing one is not an error worth failing a fetch over.
	}
}

/** `-w` is how curl tells us what the response *was*; the body itself goes to a file so that a
 *  binary body, and a body that is not UTF-8, survive being read back. */
const CURL_WRITE_OUT = "%{content_type}\t%{url_effective}\t%{http_code}";

/** The default {@link ShellExec}: `curl` as a real child process, argv-only — no shell string is
 *  ever built, so `args` cannot smuggle shell syntax and the hatch stays a *fetch* rather than a
 *  second way to run commands. */
const defaultShellExec: ShellExec = (args, options) =>
	new Promise((resolve, reject) => {
		execFile("curl", args, { timeout: options.timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
			const code = (error as { code?: unknown } | null)?.code;
			// A numeric `code` is curl's own exit status; anything else (ENOENT, EACCES) is a failure
			// to run it at all, and the caller's message has to say which.
			if (error !== null && typeof code !== "number") return reject(error);
			resolve({ code: error === null ? 0 : (code as number), stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });
		});
	});

/**
 * `curl` flags that stop `via="shell"` being a **fetch** — the ones that name a file for curl to write
 * or upload, and the one that takes further options from a file this hatch cannot see. The hatch's
 * promise is that it fetches into the envelope and writes nothing but its own scratch body, so the
 * flags that would break that promise are refused rather than silently reshaped.
 *
 * `-o`/`--output` is on the list because *our* `-o` has to be the one that decides where the body
 * lands — a caller's would take the first URL and leave us reading a file nobody wrote — and because a
 * copy of the bytes is already a first-class thing this tool does: `mode="raw"`.
 */
const NON_FETCH_FLAGS = new Map<string, string>([
	["-o", 'name an output file for curl — use mode="raw" to keep the bytes on disk'],
	["--output", 'name an output file for curl — use mode="raw" to keep the bytes on disk'],
	["--output-dir", 'name an output directory for curl — use mode="raw" to keep the bytes on disk'],
	["-O", 'tell curl to name the output file itself — use mode="raw" to keep the bytes on disk'],
	["--remote-name", 'tell curl to name the output file itself — use mode="raw" to keep the bytes on disk'],
	["-J", 'tell curl to name the output file itself — use mode="raw" to keep the bytes on disk'],
	["--remote-header-name", 'tell curl to name the output file itself — use mode="raw" to keep the bytes on disk'],
	["--create-dirs", 'create directories for an output file — use mode="raw" to keep the bytes on disk'],
	["-D", "write the response headers to a file — fetch and read them instead"],
	["--dump-header", "write the response headers to a file — fetch and read them instead"],
	["-c", "write a cookie jar file — this is a fetch, not an interactive client"],
	["--cookie-jar", "write a cookie jar file — this is a fetch, not an interactive client"],
	["-T", "upload a local file — the hatch fetches; a POST body goes in --data"],
	["--upload-file", "upload a local file — the hatch fetches; a POST body goes in --data"],
	["-K", "take further curl options from a file — pass them in args directly"],
	["--config", "take further curl options from a file — pass them in args directly"],
]);

function assertFetchOnlyArgs(args: string[]): void {
	for (const arg of args) {
		// One URL, and it is the `url` parameter: a second one in `args` would take our `-o` (curl maps
		// output files to URLs in order) and leave the caller reading a body nobody asked for.
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) {
			throw webError("ValueError", `fetch_content via="shell": args must not contain a URL (${arg}) — pass it as url`);
		}
		// `-o file`, `-ofile` and `--output=file` are all the same option to curl, so all three are
		// looked for: the exact flag, its `=`-form, and a short flag's attached value.
		const short = arg.length > 2 && !arg.startsWith("--") ? arg.slice(0, 2) : undefined;
		const flag = NON_FETCH_FLAGS.get(arg) ?? NON_FETCH_FLAGS.get(arg.split("=")[0] ?? "") ?? (short ? NON_FETCH_FLAGS.get(short) : undefined);
		if (flag === undefined) continue;
		throw webError("ValueError", `fetch_content via="shell": args must not ${flag} (${arg})`);
	}
}

/** The escape hatch: `curl` on this host, then the same pipeline the guarded client feeds. See the
 *  header for what it skips (the address and scheme checks) and what it keeps (the domain policy). */
async function fetchViaShell(url: string, options: FetchOptions): Promise<FetchEnvelope> {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		throw webError("ValueError", `not a valid URL: ${url}`);
	}
	assertDomainPolicy(hostname, options.guard.domainPolicy);

	const dir = `${options.scratchDir}/web`;
	mkdirSync(dir, { recursive: true });
	const bodyPath = `${dir}/.curl-${randomUUID()}.body`;
	options.progress?.(`fetch_content: ${url.slice(0, 120)} — fetching with curl`);
	assertFetchOnlyArgs(options.shellArgs ?? []);

	let result: { code: number; stdout: Buffer; stderr: Buffer };
	try {
		result = await (options.shellExec ?? defaultShellExec)(["-sS", "-L", ...(options.shellArgs ?? []), "-o", bodyPath, "-w", CURL_WRITE_OUT, url], {
			timeoutMs: options.timeoutMs,
		});
	} catch (error) {
		// `execFile` kills the child at `timeout` and answers an error whose `code` is not a number.
		// That is curl's own budget running out, not a binary that would not start — and saying
		// "could not run curl" for it sends a session looking for a missing curl.
		const killed = error as { killed?: boolean; signal?: string } | null;
		if (killed?.killed === true || killed?.signal !== undefined) {
			throw webError("TimeoutError", `fetch_content via="shell": curl timed out after ${options.timeoutMs} ms for ${url}`);
		}
		throw webError("OSError", `fetch_content via="shell": could not run curl: ${error instanceof Error ? error.message : String(error)}`);
	}

	// The `-w` line is `content_type \t url \t status`, and a server that sends no Content-Type makes
	// the first field empty: the line then *starts* with a tab. Trimming the line before splitting it
	// dropped that field, so the URL was reported as the content type and the status as the URL.
	const lastLine = result.stdout
		.toString("utf-8")
		.split("\n")
		.map((line) => line.replace(/\r$/, ""))
		.filter((line) => line !== "")
		.slice(-1)[0] ?? "";
	const [contentType = "", finalUrl = "", httpStatus = "0"] = lastLine.split("\t");

	if (result.code !== 0) {
		safeUnlink(bodyPath);
		const why = result.stderr.toString("utf-8").trim().slice(0, 300);
		throw webError("OSError", `fetch_content via="shell": curl exited ${result.code} for ${url}${why ? `: ${why}` : ""}`);
	}

	let buffer = new Uint8Array();
	try {
		buffer = new Uint8Array(readFileSync(bodyPath));
	} catch {
		// `--head`, or a body curl declined to write: an empty body, which `deliver` reports as such.
	} finally {
		safeUnlink(bodyPath);
	}

	const status = Number(httpStatus);
	const extraNote = joinNotes(
		'fetched with curl on this host (via="shell")',
		status > 0 && (status < 200 || status >= 300) ? `the response was HTTP ${status}` : null,
	);
	return deliver(buffer, contentType, finalUrl || url, options, extraNote ?? null);
}

/** Nothing readable came out: spill the raw body and say so rather than returning a
 *  silently empty page (ticket 05). */
function spillRawBody(
	buffer: Uint8Array,
	url: string,
	contentType: string,
	why: string,
	options: FetchOptions,
	extraNote: string | null = null,
): MarkdownEnvelope {
	const path = spillPath(options.scratchDir, url, extensionFor(contentType));
	// A text-ish raw body is still page text a cell may read, so it is fenced. A binary body (a PDF
	// with no extractable text) cannot be, and the note says what the file holds.
	const text = isTextish(contentType) || isHtml(contentType) ? decodeBody(buffer, contentType) : "";
	const textish = text.trim().length > 0;
	writeFileSync(path, textish ? fenceText(text) : buffer);
	options.progress?.(`fetch_content: ${why}; the raw response is at ${path}`);
	const note = joinNotes(`${why}; the file holds the raw response (${contentType}, ${buffer.length} bytes)${textish ? ", fenced" : ""}`, extraNote);
	return {
		url,
		title: "",
		path,
		chars: 0,
		head: "",
		...(note ? { note } : {}),
		...(options.via === "shell" ? { via: "shell" as const } : {}),
	};
}

/** Kept for the extension's own README and tests: the extensions we can write. */
export function extensionForType(contentType: string): string {
	return extensionFor(contentType);
}
