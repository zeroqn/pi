import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { claimPassLock, passLockPath, releasePassLock } from "../pass-lock.ts";

function tempRoot(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsi-passlock-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	return root;
}

test("a fresh lock blocks a second claim until released", (t) => {
	const root = tempRoot(t);
	const first = claimPassLock(root, 600_000);
	assert.ok(first);
	assert.equal(fs.existsSync(passLockPath(root)), true);

	assert.equal(claimPassLock(root, 600_000), undefined, "held and fresh means skip");

	first.release();
	assert.equal(fs.existsSync(passLockPath(root)), false);
	const second = claimPassLock(root, 600_000);
	assert.ok(second);
	second.release();
});

test("a lock older than the stage ceiling is reclaimed", (t) => {
	const root = tempRoot(t);
	const lockPath = passLockPath(root);
	fs.writeFileSync(lockPath, "1 0 abandoned\n");
	const old = new Date(Date.now() - 60 * 60 * 1000);
	fs.utimesSync(lockPath, old, old);

	const lock = claimPassLock(root, 600_000);
	assert.ok(lock, "a stale lock must not block the pass");
	lock.release();
});

test("release only removes a lock that still carries its token", (t) => {
	const root = tempRoot(t);
	const lock = claimPassLock(root, 600_000);
	assert.ok(lock);

	// Another holder reclaimed the stale lock and wrote its own token.
	fs.writeFileSync(passLockPath(root), `999 ${Date.now()} someone-else\n`);
	lock.release();
	assert.equal(fs.existsSync(passLockPath(root)), true, "must not delete another holder's lock");

	releasePassLock(passLockPath(root), "someone-else");
	assert.equal(fs.existsSync(passLockPath(root)), false);
});

test("releasing twice and releasing a vanished lock are safe", (t) => {
	const root = tempRoot(t);
	const lock = claimPassLock(root, 600_000);
	assert.ok(lock);
	lock.release();
	assert.doesNotThrow(() => lock.release());
});
