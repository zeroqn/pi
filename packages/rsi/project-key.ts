/**
 * Project key resolution.
 *
 * A learned skill's scope is a project key: the normalized git remote URL, or
 * the absolute git root when the repo has no remote. A cwd outside any repo has
 * no key and therefore resolves to the `general` scope. The key is a display
 * and config identity; `encodeScopeKey` is what makes it a directory name.
 */

import { execFileSync } from "node:child_process";
import * as path from "node:path";

function git(cwd: string, args: string[]): string | undefined {
	try {
		const out = execFileSync("git", ["-C", cwd, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return out.length > 0 ? out : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Normalize a git remote URL to `host/owner/repo` (lowercase host, no `.git`,
 * no credentials, no port). Returns `undefined` when the URL has no usable
 * host. `file://` remotes and bare paths are treated as local paths and kept
 * absolute so they cannot be confused with a remote key.
 */
export function normalizeRemote(raw: string, cwd: string): string | undefined {
	const url = raw.trim();
	if (url.length === 0) return undefined;

	if (!url.includes("://")) {
		const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(url);
		if (scp) return joinHostPath(scp[1], scp[2]);
		return normalizeLocalPath(url, cwd);
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}

	if (parsed.protocol === "file:") {
		return normalizeLocalPath(decodeURIComponent(parsed.pathname), cwd);
	}
	if (parsed.hostname.length === 0) return undefined;
	return joinHostPath(parsed.hostname, parsed.pathname);
}

/**
 * Resolve the project key for a working directory, or `undefined` when the cwd
 * is not inside a git repository (which callers treat as the `general` scope).
 */
export function projectKeyFor(cwd: string): string | undefined {
	const root = git(cwd, ["rev-parse", "--show-toplevel"]);
	if (!root) return undefined;

	const remote = git(cwd, ["remote", "get-url", "origin"]);
	if (remote) {
		const key = normalizeRemote(remote, root);
		if (key) return key;
	}
	return root;
}

function joinHostPath(host: string, rawPath: string): string | undefined {
	const normalizedHost = host.toLowerCase().replace(/\.$/, "");
	if (normalizedHost.length === 0) return undefined;
	const cleaned = stripGitSuffix(rawPath);
	return cleaned.length > 0 ? `${normalizedHost}/${cleaned}` : normalizedHost;
}

function normalizeLocalPath(rawPath: string, cwd: string): string | undefined {
	const trimmed = rawPath.trim();
	if (trimmed.length === 0) return undefined;
	const cleaned = trimmed.replace(/\/+$/, "").replace(/\.git$/, "").replace(/\/+$/, "");
	if (cleaned.length === 0) return undefined;
	// `path.resolve` keeps an absolute `cleaned` absolute and anchors a relative
	// one to the repo root.
	return path.resolve(cwd, cleaned);
}

function stripGitSuffix(rawPath: string): string {
	return rawPath
		.trim()
		.replace(/^\/+/, "")
		.replace(/\/+$/, "")
		.replace(/\.git$/, "")
		.replace(/\/+$/, "");
}
