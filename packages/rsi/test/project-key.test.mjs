import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { normalizeRemote, projectKeyFor } from "../project-key.ts";

// ---------------------------------------------------------------------------
// normalizeRemote — the key decides which repo a skill is surfaced in, so
// every common remote spelling must collapse to the same key.
// ---------------------------------------------------------------------------

test("normalizeRemote collapses scp, https, ssh and git spellings", () => {
	const cwd = "/tmp";
	const expected = "github.com/earendil-works/pi";
	assert.equal(normalizeRemote("git@github.com:earendil-works/pi.git", cwd), expected);
	assert.equal(normalizeRemote("https://github.com/earendil-works/pi.git", cwd), expected);
	assert.equal(normalizeRemote("https://github.com/earendil-works/pi", cwd), expected);
	assert.equal(normalizeRemote("ssh://git@github.com:22/earendil-works/pi.git", cwd), expected);
	assert.equal(normalizeRemote("git://github.com/earendil-works/pi", cwd), expected);
	assert.equal(normalizeRemote("https://GitHub.com/Earendil-Works/Pi.git", cwd), "github.com/Earendil-Works/Pi");
});

test("normalizeRemote keeps local roots absolute and distinct from hosts", () => {
	assert.equal(normalizeRemote("file:///home/dev/work", "/tmp"), "/home/dev/work");
	assert.equal(normalizeRemote("/home/dev/work", "/tmp"), "/home/dev/work");
	assert.equal(normalizeRemote("../sibling", "/home/dev/work"), "/home/dev/sibling");
});

test("normalizeRemote rejects input with no usable host", () => {
	assert.equal(normalizeRemote("", "/tmp"), undefined);
	assert.equal(normalizeRemote("https://", "/tmp"), undefined);
});

// ---------------------------------------------------------------------------
// projectKeyFor — exercised against real git repos, including the documented
// fallback when a repo has no remote.
// ---------------------------------------------------------------------------

function makeRepo(remote) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-key-"));
	execFileSync("git", ["-C", dir, "init", "-q"]);
	if (remote) execFileSync("git", ["-C", dir, "remote", "add", "origin", remote]);
	return dir;
}

test("projectKeyFor uses the normalized remote of a repo", (t) => {
	const repo = makeRepo("git@github.com:earendil-works/pi.git");
	t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
	assert.equal(projectKeyFor(repo), "github.com/earendil-works/pi");
});

test("projectKeyFor scopes a subdirectory to the repo root's key", (t) => {
	const repo = makeRepo("https://github.com/earendil-works/pi.git");
	t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
	const nested = path.join(repo, "a", "b");
	fs.mkdirSync(nested, { recursive: true });
	assert.equal(projectKeyFor(nested), "github.com/earendil-works/pi");
});

test("projectKeyFor falls back to the absolute git root when there is no remote", (t) => {
	const repo = makeRepo(undefined);
	t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
	const key = projectKeyFor(repo);
	// macOS temp dirs differ from the Linux path; assert the shape instead.
	assert.equal(typeof key, "string");
	assert.equal(path.isAbsolute(key), true);
	assert.equal(fs.realpathSync(key), fs.realpathSync(repo));
});

test("projectKeyFor returns undefined outside a repository", (t) => {
	const plain = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-norepo-"));
	t.after(() => fs.rmSync(plain, { recursive: true, force: true }));
	// A temp dir can sit under a repo in odd environments; only assert when it
	// really is outside one.
	try {
		execFileSync("git", ["-C", plain, "rev-parse", "--show-toplevel"], { stdio: "ignore" });
	} catch {
		assert.equal(projectKeyFor(plain), undefined);
	}
});
