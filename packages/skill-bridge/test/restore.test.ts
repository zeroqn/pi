/**
 * Check 7 of `.scratch/skill-bridge/acceptance.md`: a restored kernel still resolves the call form.
 *
 * The four names are frozen for exactly this reason. Both of code mode's restore paths hand a kernel
 * back **without re-feeding the prelude** — the dump fast path (`session.loadSession`, taken between
 * feeds) and mid-feed rotation (`snap.dump()` -> `next.loadSnapshot`, taken at a suspension). The
 * dump carries the two `async def`s; what makes the restored session answer is monty resolving
 * `skill_host` / `skills_host` per feed through `externalLookup`. A rename, or a contribution that
 * stopped naming the host functions in the same call, would therefore be silent until a session was
 * resumed days later.
 *
 * Driven against a real worker in the shape `packages/code-mode/test/rotation.test.ts` uses, gated on
 * `MONTY_BIN` (see README.md). Like `rlm/test/prelude-tail.test.ts`, this file imports monty from the
 * workspace root rather than declaring it: the pin belongs to the package that ships the worker.
 *
 * The host functions are the **real** ones, over a human-tier entry (read from the file at its
 * `location`) and a fixture provider (read through its `read(name)`), so the two routes are
 * distinguishable in one cell rather than both being a stub.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillHostFns } from "../src/call";
import { API_VERSION, __resetSkillBridgeForTests, registerProvider } from "../src/convention";
import { SKILL_PRELUDE } from "../src/prelude";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) {
	console.warn("skipping the restored-kernel tests: no runnable monty worker — set MONTY_BIN (see README.md)");
}

const LIMITS = { maxSuspensions: 100_000 };
/**
 * The body the file route must return. The file keeps a frontmatter block, and `stripFrontmatter`
 * trims what it returns — so this has no trailing newline while the *provider's* answer does, which is
 * how the two routes stay tellable apart.
 */
const HUMAN_BODY = "# A pi-loaded skill\n\nThis line came from the file the restore did not re-read.";
/** The provider's answer, so the two routes are distinguishable. */
const STORE_BODY = "# A stored skill\n\nThis line came from the provider.\n";
/** Written *before* the dump and read back *in* the restored session. */
const PRE_RESTORE_STATE = 'kept = "set before the restore"';

let dir = "";
let payload = "";
let hostFns: ReturnType<typeof skillHostFns>;

/** `feedRun` answers with the last expression, so every cell ends in the list worth asserting. */
function cellBody(pingLoop: string): string {
	return `
human = (await skill("human-probe"))["content"]
${pingLoop}stored = await skill("stored-probe")
catalogue = await skills()
[human, stored["content"], stored["files"], [entry["name"] for entry in catalogue], kept]
`;
}

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "sb-restore-"));
	const sessionFile = join(dir, "session.jsonl");
	writeFileSync(sessionFile, "{}\n");
	const humanFile = join(dir, "human", "SKILL.md");
	payload = join(dir, "stored", "payload.md");
	mkdirSync(join(dir, "human"), { recursive: true });
	writeFileSync(humanFile, `---\nname: human-probe\ndescription: a fixture\n---\n${HUMAN_BODY}`);

	__resetSkillBridgeForTests();
	registerProvider({
		sessionKey: sessionFile,
		provider: {
			owner: "fixture-store",
			apiVersion: API_VERSION,
			list: () => [{ name: "stored-probe", description: "a fixture", location: payload, scope: "general" }],
			read: (name: string) => (name === "stored-probe" ? { content: STORE_BODY, files: [payload] } : undefined),
		},
	});
	const ctx = { sessionManager: { getSessionFile: () => sessionFile } };
	hostFns = skillHostFns({
		ctx: () => ctx,
		piLoaded: () => [{ name: "human-probe", description: "a fixture", location: humanFile, scope: "general" }],
	});
});

afterAll(() => {
	__resetSkillBridgeForTests();
	rmSync(dir, { recursive: true, force: true });
});

function expected(kept: string) {
	return [HUMAN_BODY, STORE_BODY, [payload], ["stored-probe"], kept];
}

describe.skipIf(!montyReady)("a kernel restored from a dump", () => {
	it("answers skills() and skill() without the prelude being re-fed", async () => {
		const monty: any = await import("@pydantic/monty/node");
		const pool = await monty.Monty.create();
		try {
			const first = await pool.checkout({ limits: LIMITS });
			await first.feedRun(SKILL_PRELUDE, { externalLookup: hostFns });
			await first.feedRun(PRE_RESTORE_STATE, { externalLookup: hostFns });
			const bytes: Uint8Array = await first.dump();

			// A *fresh* checkout: nothing has been fed to it, so the restored state is all it holds.
			const restored = await pool.checkout({ limits: LIMITS });
			await restored.loadSession(bytes);
			const out = await restored.feedRun(cellBody(""), { externalLookup: hostFns });
			expect(out).toEqual(expected("set before the restore"));
		} finally {
			await pool.close();
		}
	});

	it("answers from a snapshot restored mid-cell, the prelude never re-fed", async () => {
		const monty: any = await import("@pydantic/monty/node");
		const pool = await monty.Monty.create();
		try {
			const session = await pool.checkout({ limits: LIMITS });
			await session.feedRun(SKILL_PRELUDE, { externalLookup: hostFns });
			await session.feedRun(PRE_RESTORE_STATE, { externalLookup: hostFns });

			// One host call is answered before the rotation and one after it, so both sides of the
			// restore have to reach the call form. `ping` is the cheap suspension to rotate at.
			const feed = { externalLookup: { ...hostFns, ping: async () => ({ ok: true }) } };
			const suspended = await session.feedStart(cellBody("for i in range(3):\n    await ping()\n"), feed);
			expect(suspended instanceof monty.MontyComplete).toBe(false);

			// The production shape: dump the snapshot in hand, load it into a fresh checkout on the
			// same pool, and let the *new* session's externalLookup answer the outstanding calls.
			const bytes: Uint8Array = await suspended.dump();
			const next = await pool.checkout({ limits: LIMITS });
			let resumed: any = await next.loadSnapshot(bytes, feed);
			let guard = 0;
			while (!(resumed instanceof monty.MontyComplete)) {
				expect(guard++).toBeLessThan(100);
				resumed = await resumed.resumeAuto();
			}
			expect(resumed.output).toEqual(expected("set before the restore"));
		} finally {
			await pool.close();
		}
	});
});
