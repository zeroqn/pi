/**
 * The pass single-flight lock: `rsi/.lock`.
 *
 * Deliberately not `.ledger.lock` (phase 2): a pass holds this for as long as it
 * runs, while the ledger lock is held for milliseconds. Cross-process because pi
 * shares `~/.pi` between concurrent sessions and offers no lock of its own.
 *
 * Claimed with exclusive-create and holding pid, timestamp and a token. A lock
 * held past the stage ceiling is presumed abandoned and reclaimed; release only
 * removes a lock whose token still matches, so a process that reclaimed a stale
 * lock cannot have it deleted out from under it by the original holder.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export const PASS_LOCK_FILE_NAME = ".lock";

export interface PassLock {
	path: string;
	token: string;
	release(): void;
}

export function passLockPath(root: string): string {
	return path.join(root, PASS_LOCK_FILE_NAME);
}

/**
 * Claim the pass lock, or return `undefined` when another holder has a fresh
 * one. `staleMs` is the stage ceiling: an older lock is reclaimed.
 */
export function claimPassLock(root: string, staleMs: number): PassLock | undefined {
	fs.mkdirSync(root, { recursive: true });
	const lockPath = passLockPath(root);

	for (let attempt = 0; attempt < 2; attempt++) {
		const token = randomUUID();
		try {
			const fd = fs.openSync(lockPath, "wx");
			try {
				fs.writeSync(fd, `${process.pid} ${Date.now()} ${token}\n`);
			} finally {
				fs.closeSync(fd);
			}
			return { path: lockPath, token, release: () => releasePassLock(lockPath, token) };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		if (!reclaimIfStale(lockPath, staleMs)) return undefined;
	}
	return undefined;
}

/** Remove a lock only when it still carries this holder's token. */
export function releasePassLock(lockPath: string, token: string): void {
	try {
		if (!fs.readFileSync(lockPath, "utf8").includes(token)) return;
		fs.unlinkSync(lockPath);
	} catch {
		// Already gone, or reclaimed by someone else.
	}
}

/** True when the caller should retry: the lock is stale or has vanished. */
function reclaimIfStale(lockPath: string, staleMs: number): boolean {
	try {
		if (Date.now() - fs.statSync(lockPath).mtimeMs <= staleMs) return false;
	} catch {
		return true; // vanished between the failed create and the stat
	}
	try {
		fs.unlinkSync(lockPath);
	} catch {
		// Someone else reclaimed it first; the retry will find out.
	}
	return true;
}
