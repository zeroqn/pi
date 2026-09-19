import { describe, expect, it } from "bun:test";
import { DEFAULT_MAX_REDIRECTS, fetchGuarded, isBlockedAddress, parseAllowRanges, validateRemoteUrl } from "../ssrf";

const PUBLIC = "93.184.216.34";
const guard = (extra: Partial<Parameters<typeof validateRemoteUrl>[1]> = {}) => ({
	allowRanges: [] as string[],
	domainPolicy: { allow: [] as string[], deny: [] as string[] },
	lookup: async () => [PUBLIC],
	...extra,
});

/** Counts requests so a test can assert a refused hop was never fetched. */
function fakeFetch(script: Array<{ status: number; headers?: Record<string, string>; body?: string }>) {
	const calls: string[] = [];
	const impl = (async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		calls.push(url);
		const next = script.shift();
		if (!next) throw new Error(`unexpected request ${url}`);
		return new Response(next.body ?? "", { status: next.status, headers: next.headers });
	}) as unknown as typeof fetch;
	return { impl, calls };
}

describe("the guard's address tables (ticket 06, ported from upstream)", () => {
	it("blocks the IPv4 classes upstream blocks", () => {
		for (const address of ["0.0.0.0", "10.0.0.1", "127.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "198.18.0.1", "224.0.0.1", "255.255.255.255"]) {
			expect(`${address}: ${isBlockedAddress(address)}`).toBe(`${address}: true`);
		}
		expect(isBlockedAddress(PUBLIC)).toBe(false);
		expect(isBlockedAddress("1.1.1.1")).toBe(false);
	});

	it("blocks the IPv6 classes upstream blocks, plus multicast", () => {
		for (const address of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
			expect(`${address}: ${isBlockedAddress(address)}`).toBe(`${address}: true`);
		}
		expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
		expect(isBlockedAddress("::ffff:93.184.216.34")).toBe(false);
	});

	it("refuses anything that is not http(s), and internal hostnames", async () => {
		await expect(validateRemoteUrl("ftp://example.com/x", guard())).rejects.toThrow(/Only HTTP and HTTPS/);
		await expect(validateRemoteUrl("file:///etc/passwd", guard())).rejects.toThrow(/Only HTTP and HTTPS/);
		await expect(validateRemoteUrl("http://localhost/x", guard())).rejects.toThrow(/Blocked internal hostname/);
		await expect(validateRemoteUrl("http://api.localhost/x", guard())).rejects.toThrow(/Blocked internal hostname/);
		await expect(validateRemoteUrl("not a url", guard())).rejects.toThrow(/not a valid URL/);
	});

	it("checks every resolved address, not the first", async () => {
		await expect(validateRemoteUrl("http://example.com/", guard({ lookup: async () => [PUBLIC, "127.0.0.1"] }))).rejects.toThrow(/Blocked internal address/);
		await expect(validateRemoteUrl("http://example.com/", guard({ lookup: async () => [] }))).rejects.toThrow(/no addresses returned/);
		await expect(validateRemoteUrl("http://example.com/", guard({ lookup: async () => Promise.reject(new Error("ENOTFOUND")) }))).rejects.toThrow(/Failed to resolve/);
	});

	it("names the host and the offending address in a refusal", async () => {
		await expect(validateRemoteUrl("http://sneaky.example/", guard({ lookup: async () => ["169.254.169.254"] }))).rejects.toThrow(
			/Blocked internal address for sneaky\.example: 169\.254\.169\.254/,
		);
	});
});

describe("ssrf.allowRanges (ticket 06)", () => {
	it("exempts addresses, including resolved ones, but never internal hostnames", async () => {
		await expect(validateRemoteUrl("http://198.18.0.5/", guard({ allowRanges: ["198.18.0.0/15"] }))).resolves.toBeInstanceOf(URL);
		await expect(validateRemoteUrl("http://fake.example/", guard({ allowRanges: ["198.18.0.0/15"], lookup: async () => ["198.18.0.9"] }))).resolves.toBeInstanceOf(URL);
		await expect(validateRemoteUrl("http://localhost/", guard({ allowRanges: ["127.0.0.0/8"] }))).rejects.toThrow(/Blocked internal hostname/);
		await expect(validateRemoteUrl("http://10.0.0.1/", guard({ allowRanges: ["10.0.0.1"] }))).resolves.toBeInstanceOf(URL);
	});

	it("refuses a range that would exempt the world, and malformed entries", () => {
		expect(() => parseAllowRanges(["0.0.0.0/0"])).toThrow(/between 1 and 32/);
		expect(() => parseAllowRanges(["::/0"])).toThrow(/between 1 and 128/);
		expect(() => parseAllowRanges(["10.0.0.0/"])).toThrow(/empty prefix/);
		expect(() => parseAllowRanges(["nonsense"])).toThrow(/not an IP address or CIDR/);
	});
});

describe("fetchContent.domainPolicy (ticket 06)", () => {
	it("lets deny win, treats a non-empty allow as a whitelist, and matches subdomains", async () => {
		await expect(validateRemoteUrl("http://a.reddit.com/", guard({ domainPolicy: { allow: [], deny: ["reddit.com"] } }))).rejects.toThrow(/Blocked hostname by fetch_content domain policy/);
		await expect(validateRemoteUrl("http://arxiv.org/", guard({ domainPolicy: { allow: ["arxiv.org"], deny: [] } }))).resolves.toBeInstanceOf(URL);
		await expect(validateRemoteUrl("http://a.arxiv.org/", guard({ domainPolicy: { allow: ["arxiv.org"], deny: [] } }))).resolves.toBeInstanceOf(URL);
		await expect(validateRemoteUrl("http://example.com/", guard({ domainPolicy: { allow: ["arxiv.org"], deny: [] } }))).rejects.toThrow(/not allowed by fetch_content domain policy/);
		await expect(validateRemoteUrl("http://arxiv.org/", guard({ domainPolicy: { allow: ["arxiv.org"], deny: ["arxiv.org"] } }))).rejects.toThrow(/Blocked hostname/);
	});
});

describe("redirects are walked manually and re-validated (ticket 06)", () => {
	it("refuses a hop to a private address without ever requesting it", async () => {
		const { impl, calls } = fakeFetch([{ status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }]);
		await expect(fetchGuarded("http://evil.example/", { ...guard(), timeoutMs: 5_000, fetchImpl: impl })).rejects.toThrow(
			/Blocked internal address for 169\.254\.169\.254.*hop 1/,
		);
		expect(calls).toEqual(["http://evil.example/"]);
	});

	it("follows a legitimate redirect and reports the final URL", async () => {
		const { impl, calls } = fakeFetch([
			{ status: 301, headers: { location: "https://example.com/final" } },
			{ status: 200, body: "hello" },
		]);
		const result = await fetchGuarded("http://example.com/", { ...guard(), timeoutMs: 5_000, fetchImpl: impl });
		expect(result.finalUrl).toBe("https://example.com/final");
		expect(result.hops).toBe(1);
		expect(calls).toHaveLength(2);
	});

	it("applies the domain policy to each hop", async () => {
		const { impl } = fakeFetch([{ status: 302, headers: { location: "http://a.reddit.com/x" } }]);
		await expect(
			fetchGuarded("http://example.com/", { ...guard({ domainPolicy: { allow: [], deny: ["reddit.com"] } }), timeoutMs: 5_000, fetchImpl: impl }),
		).rejects.toThrow(/domain policy.*hop 1/);
	});

	it("gives up on a redirect chain longer than the cap, as RuntimeError", async () => {
		const script = Array.from({ length: DEFAULT_MAX_REDIRECTS + 2 }, (_, index) => ({
			status: 302,
			headers: { location: `http://hop${index}.example/` },
		}));
		const { impl } = fakeFetch(script);
		const error = (await fetchGuarded("http://start.example/", { ...guard(), timeoutMs: 5_000, fetchImpl: impl }).catch((caught: unknown) => caught)) as Error;
		expect(error.name).toBe("RuntimeError");
		expect(error.message).toMatch(/too many redirects/);
	});

	it("maps a non-2xx response to OSError and a timeout to TimeoutError", async () => {
		const notFound = fakeFetch([{ status: 404 }]);
		const error = (await fetchGuarded("http://example.com/", { ...guard(), timeoutMs: 5_000, fetchImpl: notFound.impl }).catch((caught: unknown) => caught)) as Error;
		expect(error.name).toBe("OSError");
		expect(error.message).toMatch(/HTTP 404/);

		const timingOut = (async () => {
			throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
		}) as unknown as typeof fetch;
		const timedOut = (await fetchGuarded("http://example.com/", { ...guard(), timeoutMs: 25, fetchImpl: timingOut }).catch((caught: unknown) => caught)) as Error;
		expect(timedOut.name).toBe("TimeoutError");
		expect(timedOut.message).toMatch(/timed out after 25 ms/);
	});
});
