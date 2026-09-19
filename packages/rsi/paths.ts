/**
 * Filesystem path helpers for the learned store.
 *
 * Every path the store writes is derived from operator config, git output, or
 * model output, so none of it is trusted. These helpers are the single place
 * that turns such input into a path and asserts it stays inside the store.
 */

import * as os from "node:os";
import * as path from "node:path";

/** True when `child` resolves to `parent` itself or to something beneath it. */
export function isInside(parent: string, child: string): boolean {
	const base = path.resolve(parent);
	const target = path.resolve(child);
	return target === base || target.startsWith(base + path.sep);
}

/**
 * Throw unless `child` lives inside `parent`. This is the trust boundary for
 * every store write: a scope key, skill name or payload path that resolves
 * outside the store is rejected here rather than sanitized elsewhere.
 */
export function assertInside(parent: string, child: string): void {
	if (!isInside(parent, child)) {
		throw new Error(`refusing path outside store: ${child}`);
	}
}

/**
 * Characters `encodeURIComponent` leaves unescaped that are nonetheless safe in
 * a filesystem segment. Everything else must arrive as a `%XX` escape.
 */
const SAFE_ENCODED = /^[A-Za-z0-9\-_.!~*'()%]+$/;

/**
 * Turn a project key (`github.com/owner/repo`, or an absolute git root) into a
 * single filesystem-safe directory segment.
 *
 * One segment, not nested directories, so that a remote key and a local git
 * root can never collide on disk and so scope validation is a single regex
 * check. The encoding is reversible (`decodeScopeKey`), and `/` becomes `%2F`.
 */
export function encodeScopeKey(key: string): string {
	const trimmed = key.trim();
	if (trimmed.length === 0) {
		throw new Error("empty project key");
	}
	if (trimmed.split("/").some((segment) => segment === "..")) {
		throw new Error(`project key contains a traversal segment: ${key}`);
	}

	const encoded = encodeURIComponent(trimmed);
	if (encoded === "." || encoded === ".." || !SAFE_ENCODED.test(encoded)) {
		throw new Error(`project key is not a safe directory name: ${key}`);
	}
	return encoded;
}

/** Inverse of {@link encodeScopeKey}. Throws on malformed input. */
export function decodeScopeKey(segment: string): string {
	return decodeURIComponent(segment);
}

/** Expand a leading `~` to the current user's home directory. */
export function expandTilde(input: string): string {
	if (input === "~") return os.homedir();
	if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
	return input;
}
