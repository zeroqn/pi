/**
 * `fetch_content`'s engine: the guard (ticket 06), the extraction stack (ticket 05), the
 * spill files and the content-type policy. Both delivery modes are decided here, and the
 * envelopes are exactly the ones map tickets 04 and 05 fixed:
 *
 *   markdown -> { url, title, path, chars, head }            head = first 2000 chars
 *               plus `note` when nothing was extractable (the raw body is spilled instead)
 *   raw      -> { url, path, bytes, content_type }           the bytes, on disk
 *
 * Unsupported content types raise `ValueError` in **both** modes: scope decides what is
 * acceptable, mode decides how it is delivered.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { extractText, getDocumentProxy } from "unpdf";
import { webError } from "./errors";
import { fetchGuarded, type GuardOptions } from "./ssrf";

export const HEAD_CHARS = 2000;

export type FetchMode = "markdown" | "raw";

export type MarkdownEnvelope = { url: string; title: string; path: string; chars: number; head: string; note?: string };
export type RawEnvelope = { url: string; path: string; bytes: number; content_type: string };
export type FetchEnvelope = MarkdownEnvelope | RawEnvelope;

export type FetchOptions = {
	mode: FetchMode;
	scratchDir: string;
	timeoutMs: number;
	guard: GuardOptions;
	signal?: AbortSignal;
	progress?: (text: string) => void;
	/** Injected in tests. */
	fetchImpl?: typeof fetch;
};

function extensionFor(contentType: string): string {
	const type = contentType.toLowerCase();
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
	options.progress?.(`fetch_content: ${url.slice(0, 120)} — fetching`);
	const { response, finalUrl } = await fetchGuarded(url, { ...options.guard, timeoutMs: options.timeoutMs, signal: options.signal, fetchImpl: options.fetchImpl });
	const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim() || "application/octet-stream";
	const buffer = new Uint8Array(await response.arrayBuffer());

	const supported = isTextish(contentType) || isHtml(contentType) || contentType.toLowerCase().includes("pdf");
	if (!supported) {
		throw webError("ValueError", `unsupported content type ${contentType} at ${finalUrl} (raw returns the bytes of text, HTML and PDF responses only)`);
	}

	if (options.mode === "raw") {
		const path = spillPath(options.scratchDir, finalUrl, extensionFor(contentType));
		writeFileSync(path, buffer);
		options.progress?.(`fetch_content: wrote ${buffer.length} bytes to ${path}`);
		return { url: finalUrl, path, bytes: buffer.length, content_type: contentType };
	}

	// markdown mode
	if (contentType.toLowerCase().includes("pdf")) {
		let text: string;
		try {
			const pdf = await getDocumentProxy(buffer);
			const extracted = await extractText(pdf, { mergePages: true });
			text = (Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text).trim();
		} catch (error) {
			throw webError("OSError", `could not read the PDF at ${finalUrl}: ${error instanceof Error ? error.message : String(error)}`);
		}
		if (!text) return spillRawBody(buffer, finalUrl, contentType, "the PDF yielded no text", options);
		const path = spillPath(options.scratchDir, finalUrl, "txt");
		writeFileSync(path, text);
		options.progress?.(`fetch_content: ${text.length} chars of PDF text to ${path}`);
		return { url: finalUrl, title: "", path, chars: text.length, head: text.slice(0, HEAD_CHARS) };
	}

	const body = decodeBody(buffer, response.headers.get("content-type") ?? "");
	if (!isHtml(contentType)) {
		if (!body.trim()) return spillRawBody(buffer, finalUrl, contentType, "the response was empty", options);
		const path = spillPath(options.scratchDir, finalUrl, extensionFor(contentType));
		writeFileSync(path, body);
		options.progress?.(`fetch_content: ${body.length} chars (${contentType}) to ${path}`);
		return { url: finalUrl, title: "", path, chars: body.length, head: body.slice(0, HEAD_CHARS) };
	}

	const extracted = extractMarkdown(body, finalUrl);
	if (!extracted) {
		return spillRawBody(buffer, finalUrl, contentType, "no readable content", options);
	}
	const path = spillPath(options.scratchDir, finalUrl, "md");
	writeFileSync(path, extracted.markdown);
	options.progress?.(`fetch_content: ${extracted.markdown.length} chars of markdown to ${path}`);
	return {
		url: finalUrl,
		title: extracted.title,
		path,
		chars: extracted.markdown.length,
		head: extracted.markdown.slice(0, HEAD_CHARS),
	};
}

/** Nothing readable came out: spill the raw body and say so rather than returning a
 *  silently empty page (ticket 05). */
function spillRawBody(buffer: Uint8Array, url: string, contentType: string, why: string, options: FetchOptions): MarkdownEnvelope {
	const path = spillPath(options.scratchDir, url, extensionFor(contentType));
	writeFileSync(path, buffer);
	options.progress?.(`fetch_content: ${why}; the raw response is at ${path}`);
	return {
		url,
		title: "",
		path,
		chars: 0,
		head: "",
		note: `${why}; the file holds the raw response (${contentType}, ${buffer.length} bytes)`,
	};
}

/** Kept for the extension's own README and tests: the extensions we can write. */
export function extensionForType(contentType: string): string {
	return extensionFor(contentType);
}
