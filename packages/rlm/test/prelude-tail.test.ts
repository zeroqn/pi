/**
 * rlm's half of the prelude (code-mode map tickets 03 C4/C5 and 05): `_Rlm`/`rlm`,
 * `agent_message`, `find_models` and the RSI seam's `skills`/`skill`, fed on their own —
 * which is how they arrive in a real kernel, appended to code mode's base prelude at
 * kernel start.
 *
 * The real-kernel half needs a worker: set `MONTY_BIN` (see README.md).
 */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRELUDE_TAIL } from "../src/prelude-rlm";

const workerPath = process.env.MONTY_BIN ?? null;
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) {
	console.warn("skipping the real-kernel tests: no runnable monty worker — set MONTY_BIN (see README.md)");
}

describe("the delegation prelude", () => {
	it("defines the delegation and skills surface, and nothing else", () => {
		for (const name of [
			"class _Rlm",
			"def spawn",
			"rlm = _Rlm()",
			"class _AgentMessage",
			"agent_message = _AgentMessage()",
			"def find_models",
			"async def skills",
			"async def skill",
		]) {
			expect(PRELUDE_TAIL).toContain(name);
		}
		// It is a tail: the base prelude's names are code mode's, not rlm's.
		for (const name of ["ROOT =", "def read_text", "async def bash", "class BgHandle"]) {
			expect(PRELUDE_TAIL).not.toContain(name);
		}
	});
});

describe.skipIf(!montyReady)("the delegation prelude in a real kernel", () => {
	const load = async () => {
		const base = mkdtempSync(join(tmpdir(), "rlm-tail-"));
		const root = join(base, "root");
		const scratch = join(base, "scratch");
		mkdirSync(root, { recursive: true });
		mkdirSync(scratch, { recursive: true });
		const monty: any = await import("@pydantic/monty/node");
		const pool = await monty.Monty.create();
		const session = await pool.checkout({ limits: { maxSuspensions: 100_000 } });
		const mounts = [
			new monty.MountDir({ hostPath: root, virtualPath: root, mode: "read-write" }),
			new monty.MountDir({ hostPath: scratch, virtualPath: scratch, mode: "read-write" }),
		];
		// `ROOT` is named by the base half in a real session; the tail never uses it, so a
		// stub keeps this test to one feed and one subject.
		await session.feedRun(`ROOT = ${JSON.stringify(root)}`, { mount: mounts });
		await session.feedRun(PRELUDE_TAIL, { mount: mounts });
		const run = (code: string, lookup: Record<string, unknown> = {}) =>
			session.feedRun(code, { mount: mounts, externalLookup: lookup });
		return { pool, run, cleanup: () => rmSync(base, { recursive: true, force: true }) };
	};

	it("routes delegation, the child message channel and the skill seam", async () => {
		const { pool, run, cleanup } = await load();
		try {
			const spawned = await run('h = await rlm.spawn("do it", name="probe")\nh["child_id"]', {
				rlm_spawn: async () => ({ child_id: "child-1", status: "running" }),
			});
			expect(spawned).toBe("child-1");

			const listed = await run("len(await rlm.list())", { rlm_list: async () => [{ child_id: "child-1" }] });
			expect(listed).toBe(1);

			const sent = await run('m = await agent_message.send("hello", receiver_role="parent")\nm["to"]', {
				agent_message_send: async () => ({ sent: true, to: "parent" }),
			});
			expect(sent).toBe("parent");

			const models = await run('len(await find_models("deepseek"))', {
				rlm_find_models: async () => [{ id: "deepseek/one" }, { id: "deepseek/two" }],
			});
			expect(models).toBe(2);

			// The RSI seam's kernel surface (RSI x RLM tickets 02, 15).
			const visible = await run('(await skills())[0]["name"]', {
				skills_host: async () => [{ name: "seeded", description: "d", location: "/x/SKILL.md", scope: "general" }],
			});
			expect(visible).toBe("seeded");
			const loaded = await run('(await skill("seeded"))["content"]', {
				skill_host: async (name: unknown) => ({ content: `body of ${name}`, files: [] }),
			});
			expect(loaded).toBe("body of seeded");
		} finally {
			await pool.close();
			cleanup();
		}
	});
});
