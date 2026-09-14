import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { assertInside, decodeScopeKey, encodeScopeKey, expandTilde, isInside } from "../paths.ts";

// ---------------------------------------------------------------------------
// assertInside — the store's write boundary. A scope key, skill name or
// payload path that resolves outside the store must be rejected, not sanitized.
// ---------------------------------------------------------------------------

test("isInside accepts the root and descendants, rejects siblings and escapes", () => {
	const root = "/store/skills";
	assert.equal(isInside(root, "/store/skills"), true);
	assert.equal(isInside(root, "/store/skills/general/a"), true);
	assert.equal(isInside(root, "/store/skills-extra"), false);
	assert.equal(isInside(root, "/store/skills/../skills-extra/x"), false);
	assert.equal(isInside(root, "/etc/passwd"), false);
});

test("assertInside throws on traversal and accepts nested targets", () => {
	const root = path.join(os.tmpdir(), "rsi-paths-root");
	assert.doesNotThrow(() => assertInside(root, path.join(root, "skills", "general")));
	assert.throws(() => assertInside(root, path.join(root, "..", "elsewhere")));
	assert.throws(() => assertInside(root, "/etc"));
});

// ---------------------------------------------------------------------------
// encodeScopeKey — speculative: a project key must survive the round trip and
// must never contain a path separator, so remote and local keys cannot collide.
// ---------------------------------------------------------------------------

test("encodeScopeKey round-trips a remote key into one safe segment", () => {
	const key = "github.com/earendil-works/pi";
	const encoded = encodeScopeKey(key);
	assert.equal(encoded.includes("/"), false);
	assert.equal(encoded.includes("\\"), false);
	assert.equal(decodeScopeKey(encoded), key);
});

test("encodeScopeKey keeps a local git root distinct from a like-shaped remote", () => {
	const local = encodeScopeKey("/home/dev/work");
	const remote = encodeScopeKey("home/dev/work");
	assert.notEqual(local, remote);
	assert.equal(decodeScopeKey(local), "/home/dev/work");
});

test("encodeScopeKey rejects traversal, empty and degenerate keys", () => {
	assert.throws(() => encodeScopeKey(""));
	assert.throws(() => encodeScopeKey("   "));
	assert.throws(() => encodeScopeKey("owner/../other"));
	assert.throws(() => encodeScopeKey(".."));
	assert.throws(() => encodeScopeKey("."));
});

test("expandTilde expands only a leading tilde", () => {
	assert.equal(expandTilde("~/x"), path.join(os.homedir(), "x"));
	assert.equal(expandTilde("~"), os.homedir());
	assert.equal(expandTilde("~other/x"), "~other/x");
	assert.equal(expandTilde("/abs/x"), "/abs/x");
});
