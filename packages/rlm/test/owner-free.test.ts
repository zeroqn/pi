/**
 * rlm names no owner (wayfinder ticket 03, `.scratch/tool-ownership/`).
 *
 * The bridge's owners are reached through `pi-tool-bridge`'s generic child seam, so no source file
 * may name one: the whole point of the move was that rlm asks the seam and knows no owner.
 * This is the check that makes that more than an intention — it fails in CI if a name creeps back.
 *
 * Two properties of the check are deliberate:
 *
 *  - **Whole-file, not line by line.** A reference can be split across a line break ("the Magic\n *
 *    Context shim"), which a line-based scan misses while the claim "no references" still passes.
 *    `\bmagic` alone catches that, because the word appears on its own line.
 *  - **Code only, not prose.** The README may name the first owner — documenting who publishes is
 *    not depending on them — so the invariant is about code: everything under `src/` plus the entry
 *    at the package root.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Strings that would betray an owner. Case-insensitive; `magic` alone covers a split line. */
const OWNER_PATTERNS = [/\bmagic/i, /cortexkit/i, /\bctx_/];

function sourceFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) found.push(...sourceFiles(path));
		else if (entry.name.endsWith(".ts")) found.push(path);
	}
	return found;
}

describe("rlm names no owner", () => {
	it("has no source file that mentions one", () => {
		const offenders: string[] = [];
		const packageRoot = fileURLToPath(new URL("..", import.meta.url));
		const files = [
			...sourceFiles(fileURLToPath(new URL("../src", import.meta.url))),
			fileURLToPath(new URL("../index.ts", import.meta.url)),
		];
		for (const file of files) {
			const text = readFileSync(file, "utf8");
			for (const pattern of OWNER_PATTERNS) {
				if (pattern.test(text)) offenders.push(`${relative(packageRoot, file)} matches ${pattern}`);
			}
		}
		expect(offenders).toEqual([]);
	});

	it("would catch one if it appeared, even split across a line break", () => {
		// The patterns *are* the check, so this proves they are not vacuous.
		const splitMention = " * ...or Magic\n * Context cannot bind it...\n";
		expect(OWNER_PATTERNS.some((pattern) => pattern.test(splitMention))).toBe(true);
	});
});
