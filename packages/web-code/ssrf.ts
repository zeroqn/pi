/**
 * The SSRF guard — ported from `pi-web-access/ssrf-protection.ts` (v0.29.0) under map
 * ticket 06, which decided what to take and what to leave:
 *
 *   taken:     scheme check, `localhost`/`*.localhost`, the IPv4 and IPv6 address tables,
 *              `ssrf.allowRanges` (addresses only, consulted before the blocklist),
 *              `fetchContent.domainPolicy` (deny wins, a non-empty allow is a whitelist,
 *              exact-or-subdomain, re-checked on every hop), manual redirects, cap 5
 *   left out:  `allowLoopback`, the `onRedirect` hook, authenticated fetch,
 *              `ssrf.trustEnvProxy` and `proxy` (no proxy transport to honour them with)
 *   added:     IPv6 multicast (`ff00::/8`) to the blocklist — two lines, and a multicast
 *              address is never a legitimate fetch target
 *
 * It is a **preflight, not a connection pin**: validation resolves DNS and checks every
 * address, then the request resolves again to connect, so a DNS-rebinding attacker can win
 * that race. Deliberately inherited and documented (ticket 06); `bash` in the kernel
 * already reaches anything the process can, so this is depth against the easy mistake.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { webError } from "./errors";
import type { DomainPolicy } from "./config";

export const DEFAULT_MAX_REDIRECTS = 5;

type ParsedRange = { family: 4 | 6; bytes: Uint8Array; prefix: number };

export function normalizeHostname(value: string): string {
	return value.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

/** CIDR or bare host. `/0` is refused rather than silently exempting the world. */
export function parseAllowRanges(entries: string[] | undefined): ParsedRange[] {
	const ranges: ParsedRange[] = [];
	for (const entry of entries ?? []) {
		if (typeof entry !== "string") throw webError("ValueError", "ssrf.allowRanges entries must be strings");
		const text = entry.trim();
		if (!text) continue;
		const slash = text.indexOf("/");
		if (slash >= 0 && text.slice(slash + 1).trim() === "") {
			throw webError("ValueError", `ssrf.allowRanges entry "${entry}" has an empty prefix`);
		}
		const host = normalizeHostname(slash >= 0 ? text.slice(0, slash) : text);
		const address = parseAddress(host);
		if (!address) throw webError("ValueError", `ssrf.allowRanges entry "${entry}" is not an IP address or CIDR`);
		const bits = address.family === 4 ? 32 : 128;
		let prefix = bits;
		if (slash >= 0) {
			const parsed = Number(text.slice(slash + 1).trim());
			if (!Number.isInteger(parsed) || parsed < 1 || parsed > bits) {
				throw webError("ValueError", `ssrf.allowRanges entry "${entry}" must use a prefix between 1 and ${bits}`);
			}
			prefix = parsed;
		}
		ranges.push({ family: address.family, bytes: address.bytes, prefix });
	}
	return ranges;
}

function isInRange(address: { family: 4 | 6; bytes: Uint8Array }, range: ParsedRange): boolean {
	if (address.family !== range.family) return false;
	for (let bit = 0; bit < range.prefix; bit += 1) {
		const byte = bit >> 3;
		const mask = 0x80 >> bit % 8;
		if ((address.bytes[byte]! & mask) !== (range.bytes[byte]! & mask)) return false;
	}
	return true;
}

export function parseAddress(host: string): { family: 4 | 6; bytes: Uint8Array } | null {
	const version = isIP(host);
	if (version === 4) return { family: 4, bytes: new Uint8Array(host.split(".").map(Number)) };
	if (version === 6) {
		const groups = parseIPv6Groups(host);
		if (!groups) return null;
		const bytes = new Uint8Array(16);
		groups.forEach((group, index) => {
			bytes[index * 2] = group >> 8;
			bytes[index * 2 + 1] = group & 0xff;
		});
		return { family: 6, bytes };
	}
	return null;
}

function parseIPv6Groups(input: string): number[] | null {
	let host = normalizeHostname(input);
	const zone = host.indexOf("%");
	if (zone >= 0) host = host.slice(0, zone);
	let embedded: number[] | null = null;
	const lastColon = host.lastIndexOf(":");
	const tail = host.slice(lastColon + 1);
	if (tail.includes(".")) {
		const v4 = parseAddress(tail);
		if (!v4 || v4.family !== 4) return null;
		embedded = [((v4.bytes[0]! << 8) | v4.bytes[1]!), ((v4.bytes[2]! << 8) | v4.bytes[3]!)];
		host = host.slice(0, lastColon + 1) + "0:0";
	}
	const halves = host.split("::");
	if (halves.length > 2) return null;
	const parseSide = (side: string): number[] | null => {
		if (!side) return [];
		const out: number[] = [];
		for (const part of side.split(":")) {
			if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
			out.push(parseInt(part, 16));
		}
		return out;
	};
	const head = parseSide(halves[0] ?? "");
	const tailGroups = halves.length === 2 ? parseSide(halves[1] ?? "") : null;
	if (!head || (halves.length === 2 && !tailGroups)) return null;
	let groups: number[];
	if (halves.length === 2) {
		const fill = 8 - head.length - tailGroups!.length;
		if (fill < 1) return null;
		groups = [...head, ...new Array(fill).fill(0), ...tailGroups!];
	} else {
		groups = head;
	}
	if (groups.length !== 8) return null;
	if (embedded) {
		groups[6] = embedded[0];
		groups[7] = embedded[1];
	}
	return groups;
}

function isFakeIpProxyAddress(address: string): boolean {
	const [a, b] = address.split(".").map(Number);
	return a === 198 && (b === 18 || b === 19);
}

export function isBlockedIPv4(address: string): boolean {
	const parts = address.split(".").map(Number);
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
	const [a, b] = parts as [number, number, number, number];
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
		(a === 169 && b === 254) || // link-local, cloud metadata
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		isFakeIpProxyAddress(address) || // 198.18/15, TUN/fake-IP proxies
		a >= 224 // multicast and reserved
	);
}

export function isBlockedIPv6(address: string): boolean {
	const groups = parseIPv6Groups(address);
	if (!groups) return true;
	const first = groups[0]!;
	if (groups.every((group) => group === 0)) return true; // ::
	if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1
	if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
	if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
	if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast — our addition
	const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
	if (mapped) return isBlockedIPv4([groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join("."));
	return false;
}

export function isBlockedAddress(address: string): boolean {
	const version = isIP(normalizeHostname(address));
	if (version === 4) return isBlockedIPv4(normalizeHostname(address));
	if (version === 6) return isBlockedIPv6(normalizeHostname(address));
	return true;
}

function assertPublicAddress(address: string, hostname: string, ranges: ParsedRange[], hop?: number): void {
	const at = hop === undefined ? "" : ` (hop ${hop})`;
	const parsed = parseAddress(normalizeHostname(address));
	if (!parsed) throw webError("ValueError", `Blocked non-IP address for ${hostname}: ${address}${at}`);
	if (ranges.some((range) => isInRange(parsed, range))) return;
	const blocked = parsed.family === 4 ? isBlockedIPv4(normalizeHostname(address)) : isBlockedIPv6(normalizeHostname(address));
	if (!blocked) return;
	const hint = parsed.family === 4 && isFakeIpProxyAddress(normalizeHostname(address))
		? '. This address is in 198.18.0.0/15, commonly used by TUN/fake-IP proxies. Configure ssrf.allowRanges with ["198.18.0.0/15"] in web-search.json if that matches your setup.'
		: "";
	throw webError("ValueError", `Blocked internal address for ${hostname}: ${normalizeHostname(address)}${at}${hint}`);
}

function domainMatches(hostname: string, entry: string): boolean {
	const domain = normalizeHostname(entry);
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function assertDomainPolicy(hostname: string, policy: DomainPolicy | undefined, hop?: number): void {
	if (!policy) return;
	const at = hop === undefined ? "" : ` (hop ${hop})`;
	if (policy.deny.some((entry) => domainMatches(hostname, entry))) {
		throw webError("ValueError", `Blocked hostname by fetch_content domain policy: ${hostname}${at}`);
	}
	if (policy.allow.length > 0 && !policy.allow.some((entry) => domainMatches(hostname, entry))) {
		throw webError("ValueError", `Hostname not allowed by fetch_content domain policy: ${hostname}${at}`);
	}
}

export type GuardOptions = {
	allowRanges: string[];
	domainPolicy: DomainPolicy;
	/** Injected for tests: resolve a hostname to every address it owns. */
	lookup?: (hostname: string) => Promise<string[]>;
	hop?: number;
};

/** Validate one URL: scheme, hostname, domain policy, then every address it resolves to. */
export async function validateRemoteUrl(rawUrl: string, options: GuardOptions): Promise<URL> {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw webError("ValueError", `not a valid URL: ${rawUrl}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw webError("ValueError", `Only HTTP and HTTPS URLs can be fetched: ${url.protocol}`);
	}
	const hostname = normalizeHostname(url.hostname);
	if (!hostname) throw webError("ValueError", `URL must include a hostname: ${rawUrl}`);
	if (hostname === "localhost" || hostname.endsWith(".localhost")) {
		throw webError("ValueError", `Blocked internal hostname: ${hostname}${options.hop === undefined ? "" : ` (hop ${options.hop})`}`);
	}
	const ranges = parseAllowRanges(options.allowRanges);
	assertDomainPolicy(hostname, options.domainPolicy, options.hop);

	if (isIP(hostname)) {
		assertPublicAddress(hostname, hostname, ranges, options.hop);
		return url;
	}

	const lookup = options.lookup ?? defaultLookup;
	let addresses: string[];
	try {
		addresses = await lookup(hostname);
	} catch (error) {
		throw webError("OSError", `Failed to resolve ${hostname}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (addresses.length === 0) throw webError("OSError", `Failed to resolve ${hostname}: no addresses returned`);
	for (const address of addresses) assertPublicAddress(address, hostname, ranges, options.hop);
	return url;
}

async function defaultLookup(hostname: string): Promise<string[]> {
	const records = await dnsLookup(hostname, { all: true, verbatim: true });
	return records.map((record) => record.address);
}

export type GuardedFetchOptions = GuardOptions & {
	maxRedirects?: number;
	timeoutMs: number;
	headers?: Record<string, string>;
	signal?: AbortSignal;
	/** Injected in tests so redirect behaviour can be driven without the network. */
	fetchImpl?: typeof fetch;
};

/**
 * Fetch with the guard applied to the URL and to **every** redirect hop, walked manually.
 * A refusal raises `ValueError` naming host, address and hop and the refused hop is never
 * requested; exceeding the cap is `RuntimeError`; a non-2xx response is `OSError`.
 */
export async function fetchGuarded(url: string, options: GuardedFetchOptions): Promise<{ response: Response; finalUrl: string; hops: number }> {
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	const deadline = AbortSignal.timeout(options.timeoutMs);
	const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
	let current = await validateRemoteUrl(url, { ...options, hop: undefined });
	for (let hop = 0; hop <= maxRedirects; hop += 1) {
		let response: Response;
		try {
			response = await (options.fetchImpl ?? fetch)(current, {
				redirect: "manual",
				signal,
				headers: { "user-agent": "pi-web-code/0.1 (+rlm kernel host function)", accept: "*/*", ...options.headers },
			});
		} catch (error) {
			if (deadline.aborted) throw webError("TimeoutError", `fetch timed out after ${options.timeoutMs} ms: ${current.href}`);
			if (error instanceof Error && error.name === "TimeoutError") throw webError("TimeoutError", `fetch timed out after ${options.timeoutMs} ms: ${current.href}`);
			if (error instanceof Error && error.name === "ValueError") throw error;
			throw webError("OSError", `fetch failed for ${current.href}: ${error instanceof Error ? error.message : String(error)}`);
		}
		const location = response.headers.get("location");
		const redirecting = response.status >= 300 && response.status < 400 && location;
		if (!redirecting) {
			if (!response.ok) throw webError("OSError", `HTTP ${response.status} for ${current.href}`);
			return { response, finalUrl: current.href, hops: hop };
		}
		if (hop === maxRedirects) throw webError("RuntimeError", `too many redirects fetching ${url} (cap ${maxRedirects})`);
		let next: URL;
		try {
			next = new URL(location!, current);
		} catch {
			throw webError("ValueError", `redirect to an invalid URL from ${current.href}: ${location}`);
		}
		current = await validateRemoteUrl(next.href, { ...options, hop: hop + 1 });
	}
	throw webError("RuntimeError", `too many redirects fetching ${url} (cap ${maxRedirects})`);
}
