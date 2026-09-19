/**
 * The Python prelude — ticket 05's contract, in the language the model actually writes.
 *
 * The first half is a structural check (cheap, no worker). The second half feeds the
 * prelude into a real monty session and asserts the semantics, which is the only way to
 * catch a prelude that parses but behaves differently. That half needs a worker:
 *
 *   MONTY_BIN=$(nix build --no-link --print-out-paths /workspace/pi/monty#monty-bin)/bin/monty bun test
 */
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prelude } from "../src/prelude";

const HERE = dirname(fileURLToPath(import.meta.url));

function findBinding(startDir: string): string | null {
	let dir = startDir;
	for (let hop = 0; hop < 8; hop += 1) {
		const scope = join(dir, "node_modules", "@pydantic");
		if (existsSync(scope)) {
			for (const entry of readdirSync(scope)) {
				if (!entry.startsWith("monty-")) continue;
				const packageDir = join(scope, entry);
				for (const file of readdirSync(packageDir)) if (file.endsWith(".node")) return join(packageDir, file);
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/** The worker is a host prerequisite, so its absence is a skip rather than a failure. */
function resolveWorker(): string | null {
	const fromEnv = process.env.MONTY_BIN;
	if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
	const binding = findBinding(HERE);
	if (!binding) return null;
	const bundled = join(dirname(binding), "monty");
	return existsSync(bundled) ? bundled : null;
}

/**
 * A present worker is not necessarily a runnable one. On this Nix host the bundled
 * binary exists but its PT_INTERP (/lib64/ld-linux-x86-64.so.2) does not, and monty
 * surfaces that as a spawn ENOENT against a file that is plainly there. Probe it, so
 * the real-kernel tests skip with a reason instead of failing misleadingly.
 */
const workerPath = resolveWorker();
const montyReady =
	workerPath !== null &&
	spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) {
	console.warn("skipping the real-kernel tests: no runnable monty worker — set MONTY_BIN (see README.md)");
}

describe("the prelude source", () => {
	it("quotes the workspace and scratch paths rather than interpolating them raw", () => {
		const source = prelude("/tmp/has space/root", "/tmp/has space/scratch");
		expect(source).toContain(`ROOT = ${JSON.stringify("/tmp/has space/root")}`);
		expect(source).toContain(`SCRATCH = ${JSON.stringify("/tmp/has space/scratch")}`);
	});

	it("defines everything the contract promises the model", () => {
		const source = prelude("/root", "/scratch");
		for (const name of [
			"def read_text",
			"def write_text",
			"def edit_text",
			"def walk",
			"def read_json",
			"def write_json",
			"def exists",
			"def mkdirp",
			"async def bash",
			"class BgHandle",
			"class _Rlm",
			"class _AgentMessage",
			"def find_models",
			"async def skills",
			"async def skill",
			"rlm = _Rlm()",
			"agent_message = _AgentMessage()",
		]) {
			expect(source).toContain(name);
		}
	});
});

describe.skipIf(!montyReady)("the prelude in a real kernel", () => {
	const load = async () => {
		const binding = findBinding(HERE);
		if (binding) process.env.NAPI_RS_NATIVE_LIBRARY_PATH = binding;
		const base = mkdtempSync(join(tmpdir(), "rlm-prelude-"));
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
		await session.feedRun(prelude(root, scratch), { mount: mounts });
		const run = (code: string, lookup: Record<string, unknown> = {}) =>
			session.feedRun(code, { mount: mounts, externalLookup: lookup });
		return {
			pool,
			run,
			root,
			scratch,
			cleanup: () => rmSync(base, { recursive: true, force: true }),
		};
	};

	it("exposes the paths and the synchronous file helpers", async () => {
		const { pool, run, root, scratch, cleanup } = await load();
		try {
			expect(await run("ROOT")).toBe(root);
			expect(await run("SCRATCH")).toBe(scratch);
			expect(await run('write_text(SCRATCH + "/probe.txt", "hello")')).toBe(5);
			expect(await run('read_text(SCRATCH + "/probe.txt")')).toBe("hello");
			expect(await run('exists(SCRATCH + "/probe.txt")')).toBe(true);
			expect(await run('mkdirp(SCRATCH + "/nested")')).toBe(`${scratch}/nested`);
			expect(await run('exists(SCRATCH + "/nested")')).toBe(true);
			expect(await run('edit_text(SCRATCH + "/probe.txt", "hello", "world")')).toBe("ok");
			expect(await run('read_text(SCRATCH + "/probe.txt")')).toBe("world");
			// `walk` marks directories with a trailing slash, which is worth pinning down.
			expect(await run("SCRATCH + '/nested/' in walk(SCRATCH)")).toBe(true);
			expect(await run("SCRATCH + '/probe.txt' in walk(SCRATCH)")).toBe(true);
		} finally {
			await pool.close();
			cleanup();
		}
	});

	it("returns a plain result for a foreground bash and a handle for a background one", async () => {
		const { pool, run, cleanup } = await load();
		try {
			const foreground = await run('await bash("echo hi")', {
				bash_host: async () => ({ exit_code: 0, stdout: "hi" }),
			});
			// monty hands a Python dict back as a JS Map — the reason render.ts exists.
			expect(foreground).toBeInstanceOf(Map);
			expect(Object.fromEntries(foreground)).toEqual({ exit_code: 0, stdout: "hi" });

			const background = await run('h = await bash("sleep 99", background=True)\nh.id', {
				bash_host: async () => ({ id: "bg-1", status: "running" }),
			});
			expect(background).toBe("bg-1");
		} finally {
			await pool.close();
			cleanup();
		}
	});

	it("routes delegation and background calls to the host functions", async () => {
		const { pool, run, cleanup } = await load();
		try {
			const spawned = await run('h = await rlm.spawn("do it", name="probe")\nh["child_id"]', {
				rlm_spawn: async () => ({ child_id: "child-1", status: "running" }),
			});
			expect(spawned).toBe("child-1");

			const listed = await run("len(await rlm.list())", { rlm_list: async () => [{ child_id: "child-1" }] });

		// The RSI seam's kernel surface (RSI x RLM tickets 02, 15): a read and a load, both
		// host-bridged, with the load raising on an unknown name rather than returning junk.
		const visible = await run('(await skills())[0]["name"]', {
			skills_host: async () => [{ name: "seeded", description: "d", location: "/x/SKILL.md", scope: "general" }],
		});
		expect(visible).toBe("seeded");
		const loaded = await run('(await skill("seeded"))["content"]', {
			skills_host: async () => [{ name: "seeded", description: "d", location: "/x/SKILL.md", scope: "general" }],
			skill_host: async (name: unknown) => ({ content: `body of ${name}`, files: [] }),
		});
		expect(loaded).toBe("body of seeded");
			expect(listed).toBe(1);

			const sent = await run('m = await agent_message.send("hello", receiver_role="parent")\nm["to"]', {
				agent_message_send: async () => ({ sent: true, to: "parent" }),
			});
			expect(sent).toBe("parent");

			const models = await run('len(await find_models("deepseek"))', {
				rlm_find_models: async () => [{ id: "deepseek/one" }, { id: "deepseek/two" }],
			});
			expect(models).toBe(2);

			const bgStatus = await run("h = await bash(\"sleep 99\", background=True)\n(await h.poll())['status']", {
				bash_host: async () => ({ id: "bg-9", status: "running" }),
				bg_poll: async () => ({ status: "done" }),
			});
			expect(bgStatus).toBe("done");
		} finally {
			await pool.close();
			cleanup();
		}
	});
});
