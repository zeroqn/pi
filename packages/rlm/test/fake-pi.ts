/**
 * One fake `pi` for this package's tests.
 *
 * `spawn` reaches pi through a dynamic import, which is the only thing standing between these tests
 * and a real child session. Mocking it lets the delegation paths be exercised for real — statuses,
 * withdrawal, `send`, the child's own build options — instead of only through the extracted pieces.
 *
 * It lives in one module because `mock.module` replaces a module for the whole process and bun
 * resolves a specifier to a single factory no matter which test file registered it: two files that
 * each install their own fake do not coexist, and the loser fails on whatever its rival omitted
 * (measured: the entry's child spawn reaching `ModelRuntime`, which only the manager's fake carried).
 * One factory, installed by every file that needs it, with the seams they need between them.
 */
import { mock } from "bun:test";

/** Every option bag the manager handed pi, so a test can read what a child was actually built with. */
export const capturedSessionOptions: any[] = [];

let releaseTurn: (() => void) | null = null;

/** A turn that blocks until `releaseTurnNow()`, so "still running" is controllable. */
function hold(): Promise<void> {
	return new Promise<void>((resolve) => {
		releaseTurn = resolve;
	});
}

let turnBehavior: () => Promise<void> = hold;

/** The next turn blocks until released — the default. */
export function holdTurn(): void {
	turnBehavior = hold;
	releaseTurn = null;
}

/** The next turn finishes on its own. */
export function completeTurn(): void {
	turnBehavior = async () => {};
	releaseTurn = null;
}

/** The next turn does whatever the test needs (a failure, a no-op, a hold of its own). */
export function setTurnBehavior(behavior: () => Promise<void>): void {
	turnBehavior = behavior;
	releaseTurn = null;
}

/** Let the blocked turn finish. */
export function releaseTurnNow(): void {
	releaseTurn?.();
	releaseTurn = null;
}

export function installFakePi(): void {
	mock.module("@earendil-works/pi-coding-agent", () => ({
		SettingsManager: { create: () => ({}) },
		ModelRuntime: { create: () => ({}) },
		DefaultResourceLoader: class {
			async reload() {}
		},
		SessionManager: { create: () => ({ appendCustomEntry() {} }) },
		createAgentSession: async (options: any) => {
			capturedSessionOptions.push(options);
			return {
				session: {
					sessionFile: "/tmp/child.jsonl",
					model: null,
					bindExtensions: async () => {},
					prompt: () => turnBehavior(),
					followUp: async () => {},
					abort: async () => {},
					dispose: () => {},
				},
			};
		},
	}));
}
