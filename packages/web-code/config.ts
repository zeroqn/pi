/**
 * Read-only view of `web-search.json` — the same file the installed `pi-web-access`
 * uses (map ticket 03: shared, read-only, one credential store).
 *
 * We read four things and write nothing:
 *   - `provider`                  the search order (ticket 04's default when omitted)
 *   - `anysearchApiKey`           sent as `X-API-Key` (verified: `Bearer` returns 401)
 *   - `ssrf.allowRanges`          address ranges exempt from the guard (ticket 06)
 *   - `fetchContent.domainPolicy` `{ allow, deny }` hostnames for fetches (ticket 06)
 *
 * `ssrf.trustEnvProxy` and the top-level `proxy` are deliberately **not read**: both only
 * mean something alongside a proxy transport, and inert config that looks live is worse
 * than config that is absent.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type DomainPolicy = { allow: string[]; deny: string[] };

export type WebConfig = {
	path: string;
	/** Present only when the file exists and parsed; null means "no config", not "empty". */
	raw: Record<string, unknown> | null;
	providers: string[];
	anysearchApiKey: string | null;
	allowRanges: string[];
	domainPolicy: DomainPolicy;
};

/**
 * Where the config lives: `PI_CODING_AGENT_DIR`, then `$XDG_CONFIG_HOME/pi`, then
 * upstream's `~/.pi`, then — our one deliberate addition — `~/.pi/agent`, the directory pi
 * itself uses when `PI_CODING_AGENT_DIR` is unset (`extensions/rlm/src/children.ts`
 * agrees).
 *
 * The addition is not cosmetic. Upstream's order consults `~/.pi/agent` only when
 * `XDG_CONFIG_HOME` is unset, and on this host it is set: both extensions resolved to
 * `$XDG_CONFIG_HOME/pi/web-search.json`, which does not exist, so the configured provider
 * order and the AnySearch key were both silently missed. Verified inside a live pi session
 * against upstream's own `getWebSearchConfigPath()` and against this function.
 */
export function resolveConfigDir(env: NodeJS.ProcessEnv, exists: (path: string) => boolean, home: string): string {
	const explicit = env.PI_CODING_AGENT_DIR?.trim();
	if (explicit) return explicit;
	const xdg = env.XDG_CONFIG_HOME?.trim();
	const candidates: string[] = [];
	if (xdg) candidates.push(join(xdg, "pi"));
	candidates.push(join(home, ".pi"), join(home, ".pi", "agent"));
	for (const candidate of candidates) {
		if (exists(join(candidate, "web-search.json"))) return candidate;
	}
	// Nothing exists yet: name the place it should be created - XDG when the environment
	// asks for XDG, otherwise pi's own agent directory.
	return xdg ? join(xdg, "pi") : join(home, ".pi", "agent");
}

let cachedDir: string | undefined;

export function configDir(): string {
	if (cachedDir) return cachedDir;
	return (cachedDir = resolveConfigDir(process.env, existsSync, homedir()));
}

export function configPath(): string {
	return join(configDir(), "web-search.json");
}

function fail(path: string, message: string): never {
	throw new Error(`${path}: ${message}`);
}

function stringList(value: unknown, path: string, key: string): string[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) fail(path, `${key} must be an array of strings`);
	return value.map((entry, index) => {
		if (typeof entry !== "string") fail(path, `${key}[${index}] must be a string`);
		return entry;
	});
}

/** Parse the shared config. A malformed file fails loudly: silently ignoring it would mean
 *  searching with no key, or fetching without the guard the user configured. */
export function loadConfig(path: string = configPath()): WebConfig {
	if (!existsSync(path)) {
		return { path, raw: null, providers: [], anysearchApiKey: null, allowRanges: [], domainPolicy: { allow: [], deny: [] } };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		fail(path, `not valid JSON (${error instanceof Error ? error.message : String(error)})`);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) fail(path, "expected a JSON object");
	const raw = parsed as Record<string, unknown>;

	const providerValue = raw.provider;
	let providers: string[] = [];
	if (typeof providerValue === "string") providers = providerValue.trim() ? [providerValue.trim()] : [];
	else if (Array.isArray(providerValue)) providers = stringList(providerValue, path, "provider");
	else if (providerValue !== undefined && providerValue !== null) fail(path, "provider must be a string or an array of strings");

	const key = raw.anysearchApiKey;
	if (key !== undefined && key !== null && typeof key !== "string") fail(path, "anysearchApiKey must be a string");

	const ssrf = raw.ssrf;
	let allowRanges: string[] = [];
	if (ssrf !== undefined && ssrf !== null) {
		if (typeof ssrf !== "object" || Array.isArray(ssrf)) fail(path, "ssrf must be an object");
		allowRanges = stringList((ssrf as Record<string, unknown>).allowRanges, path, "ssrf.allowRanges");
	}

	const policy = (raw.fetchContent as Record<string, unknown> | undefined)?.domainPolicy;
	let domainPolicy: DomainPolicy = { allow: [], deny: [] };
	if (policy !== undefined && policy !== null) {
		if (typeof policy !== "object" || Array.isArray(policy)) fail(path, "fetchContent.domainPolicy must be an object");
		const fields = policy as Record<string, unknown>;
		domainPolicy = {
			allow: stringList(fields.allow, path, "fetchContent.domainPolicy.allow"),
			deny: stringList(fields.deny, path, "fetchContent.domainPolicy.deny"),
		};
	}

	return {
		path,
		raw,
		providers,
		anysearchApiKey: typeof key === "string" && key.trim() ? key.trim() : null,
		allowRanges,
		domainPolicy,
	};
}

/** The provider order, defaulted to the two we support (ticket 04). */
export const DEFAULT_PROVIDERS = ["duckduckgo", "anysearch"] as const;

export function providerOrder(configured: string[]): string[] {
	const known = configured.filter((name) => (DEFAULT_PROVIDERS as readonly string[]).includes(name));
	if (known.length > 0) return known;
	return [...DEFAULT_PROVIDERS];
}
