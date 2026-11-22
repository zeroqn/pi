/**
 * The claims the base surface makes about what monty refuses, pinned to the worker.
 *
 * The description and guideline 5 name the language's limits, and prose cannot be tested
 * against prose: at monty 1.6.0 "no class inheritance" was true, and at 1.7.0-beta.1 it is
 * false — subclassing runs, `super()` raises a NameError, and only metaclasses and method
 * decorators are still refused. This file feeds each claim to the pinned worker and fails
 * when one of them moves, which is the signal to edit `surface.ts` in the same change.
 *
 * Needs a worker, like every real-kernel test here:
 *
 *   MONTY_BIN=<monty>/bin/monty bun test test/surface-claims.test.ts
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The worker is a host prerequisite, so its absence is a skip rather than a failure. */
function resolveWorker(): string | null {
	const fromEnv = process.env.MONTY_BIN;
	if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
	for (let hop = 0, dir = HERE; hop < 8; hop += 1, dir = dirname(dir)) {
		const scope = join(dir, "node_modules", "@pydantic");
		if (!existsSync(scope)) continue;
		for (const entry of readdirSync(scope)) {
			if (!entry.startsWith("monty-")) continue;
			const bundled = join(scope, entry, "monty");
			if (existsSync(bundled)) return bundled;
		}
	}
	return null;
}

const workerPath = resolveWorker();
const montyReady = workerPath !== null && spawnSync(workerPath, ["--version"], { timeout: 5_000 }).status === 0;
if (!montyReady) console.warn("skipping the surface claims: no runnable monty worker — set MONTY_BIN (see README.md)");

/** A refusal is the NotImplementedError the parser raises; a claim is the value it printed. */
async function feed(code: string): Promise<{ ok: true; out: string } | { ok: false; error: string }> {
	const monty: any = await import("@pydantic/monty/node");
	const pool = await monty.Monty.create({ maxCheckoutsPerWorker: null });
	const session = await pool.checkout({ limits: { maxSuspensions: 100_000 } });
	const lines: string[] = [];
	const printCallback = (_stream: string, text: string) => lines.push(text);
	try {
		await session.feedRun(code, {
			printCallback,
			externalLookup: { ping: async (x: unknown) => `pong:${x}` },
		});
		return { ok: true, out: lines.join("").trim() };
	} catch (error) {
		return { ok: false, error: String((error as Error)?.message ?? error) };
	} finally {
		await pool.close?.();
	}
}

describe.skipIf(!montyReady)("the language claims the base surface makes", () => {
	// Guideline 5: "subclassing works — inherited methods, __init__, overrides and multiple
	// bases". At 1.6.0 this sentence was "no class inheritance" and every case below was
	// refused with NotImplementedError.
	it("subclasses: inherited dispatch, inherited __init__, overrides, multiple bases", async () => {
		const base = await feed(`
class A:
  def __init__(self):
    self.v = 1
  def m(self):
    return 'from-A'
class B(A):
  pass
class C(A):
  def m(self):
    return 'from-C'
class D(A, object):
  pass
print(B().m(), B().v, C().m(), isinstance(D(), A))
`);
		expect(base).toEqual({ ok: true, out: "from-A 1 from-C True" });
	});

	// The half that is still refused, and the one that replaced "no inheritance": `super()`
	// is an undefined name rather than a parse error, so the guideline has to say so by name.
	it("refuses super(), metaclasses and method decorators, and prints nothing for them", async () => {
		for (const [label, code, pattern] of [
			["super()", "class A:\n  pass\nclass B(A):\n  def m(self):\n    return super().m()\nprint(B().m())", /NameError: name 'super' is not defined/],
			["metaclass", "class A(metaclass=type):\n  pass", /metaclasses/],
			["method decorator", "class A:\n  @property\n  def v(self):\n    return 1", /method decorators/],
			["yield", "def g():\n  yield 1", /yield expressions/],
		] as const) {
			const run = await feed(code);
			expect({ label, ...run } as { label: string; ok: boolean; error?: string }).toMatchObject({ label, ok: false });
			if (!run.ok) expect(run.error).toMatch(pattern as RegExp);
		}
	});

	// Guideline 5's other two claims: `await` in a plain `def` resolves, and a host call
	// taken without `await` is an unfinished object rather than a result.
	it("keeps await-in-a-plain-def and the unfinished-object rule", async () => {
		expect(await feed("def f():\n  return await ping(1)\nprint(f())")).toEqual({ ok: true, out: "pong:1" });
		const unawaited = await feed("x = ping(3)\nprint(type(x).__name__, str(x)[:22])");
		expect(unawaited.ok).toBe(true);
		if (unawaited.ok) expect(unawaited.out).toStartWith("coroutine");
	});
});
