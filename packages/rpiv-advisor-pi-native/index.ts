/**
 * rpiv-advisor-pi-native — persist rpiv-advisor config in pi-native paths.
 *
 * rpiv-advisor stores its config at the XDG-aware rpiv path
 * (<XDG_CONFIG_HOME or ~/.config>/rpiv-advisor/advisor.json), separate from
 * pi's own config tree (~/.pi/agent/...). This extension makes the pi-native
 * file the real storage by placing a symlink at the rpiv path.
 *
 * Safe because @juicesharp/rpiv-config saves with writeFileSync + chmodSync
 * (in-place, follows symlinks — no temp-file+rename that would clobber the
 * link). Load paths (existsSync/readFileSync) follow symlinks too.
 *
 * Idempotent: run at extension load (before session_start handlers, so
 * rpiv-advisor's restore reads through the link) and again on every
 * session_start. Handles first-run migration, dangling links, and links
 * pointing at a stale target.
 */

import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readlinkSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PI_NATIVE_PATH = join(homedir(), ".pi", "agent", "extension-configs", "rpiv-advisor", "advisor.json");

/** Pre-`extension-configs` pi-native location (v1 of this extension). */
const LEGACY_PI_NATIVE_PATH = join(homedir(), ".pi", "agent", "rpiv-advisor", "advisor.json");

/** Mirrors @juicesharp/rpiv-config resolveConfigDir(): XDG only when absolute. */
function rpivConfigDir(): string {
	const raw = process.env.XDG_CONFIG_HOME?.trim();
	if (!raw) return join(homedir(), ".config");
	const expanded =
		raw === "~" ? homedir() : raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
	return isAbsolute(expanded) ? expanded : join(homedir(), ".config");
}

function isSymlink(path: string): boolean {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

function pointsAt(path: string, target: string): boolean {
	try {
		return readlinkSync(path) === target;
	} catch {
		return false;
	}
}

/** rename that works across filesystems (EXDEV -> copy + delete). */
function moveFile(from: string, to: string): void {
	try {
		renameSync(from, to);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
		copyFileSync(from, to);
		rmSync(from);
	}
}

function ensureLink(): void {
	const rpivPath = join(rpivConfigDir(), "rpiv-advisor", "advisor.json");

	// Target directory must exist: writes through a dangling symlink create
	// the target file, but not its parent directory.
	mkdirSync(dirname(PI_NATIVE_PATH), { recursive: true });

	// Migrate the old pi-native location if present.
	if (existsSync(LEGACY_PI_NATIVE_PATH) && !existsSync(PI_NATIVE_PATH)) {
		moveFile(LEGACY_PI_NATIVE_PATH, PI_NATIVE_PATH);
		try {
			rmSync(dirname(LEGACY_PI_NATIVE_PATH), { recursive: true });
		} catch {
			// non-empty or already gone — leave it
		}
	}

	if (isSymlink(rpivPath)) {
		if (pointsAt(rpivPath, PI_NATIVE_PATH)) return; // already correct
		rmSync(rpivPath); // dangling or stale target — relink below
	} else if (existsSync(rpivPath)) {
		// Regular file at the rpiv path: migrate it into pi-native.
		if (existsSync(PI_NATIVE_PATH)) {
			// Both sides exist — pi-native wins, keep the old file as backup.
			moveFile(rpivPath, `${rpivPath}.pre-symlink`);
		} else {
			moveFile(rpivPath, PI_NATIVE_PATH);
		}
	}

	if (!existsSync(PI_NATIVE_PATH)) {
		// Seed an empty config so the link is never dangling.
		writeFileSync(PI_NATIVE_PATH, "{}\n", "utf-8");
	}

	mkdirSync(dirname(rpivPath), { recursive: true });
	symlinkSync(PI_NATIVE_PATH, rpivPath);
}

export default function (pi: ExtensionAPI): void {
	ensureLink();
	pi.on("session_start", () => {
		ensureLink();
	});
}
