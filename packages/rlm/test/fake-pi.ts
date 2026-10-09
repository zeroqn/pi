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

/** Every option bag given to `DefaultResourceLoader` — where a child's appended prompt is decided. */
export const capturedLoaderOptions: any[] = [];

/**
 * What a spawned child's session reports as its entries. A child's *answer* is read from exactly this
 * source (rlm-wait ticket 01), so a test that wants a join to find one seeds it here.
 */
export let childEntries: unknown[] = [];

/** Seed the entries the next spawned child's session reports. */
export function setChildEntries(entries: unknown[]): void {
	childEntries = entries;
}

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

/** Every child session `dispose()`d, by its session file — what a stop's teardown must reach. */
export const disposedSessions: string[] = [];

/** Every `session_shutdown` a disposed session emitted, by reason. */
export const shutdownReasons: string[] = [];

let shutdownBehavior: () => Promise<void> = async () => {};

/**
 * What a disposed session's `session_shutdown` emit does. A held emit is how a test proves a stop is
 * **detached**: the teardown's only unbounded step is the child's own handler, and a stop must not wait
 * for it (`.scratch/rlm-stop` ticket 03; a monty-spinning child never lets `abort()` resolve at all).
 */
export function setShutdownBehavior(behavior: () => Promise<void>): void {
	shutdownBehavior = behavior;
}

let sessionCounter = 0;

/**
 * Each spawned child gets its own session file. The tree rlm now walks is made of these strings, so a
 * constant would collapse every child onto one node (`parent_session_file`, ticket 04).
 */
export function resetFakeSessions(): void {
	disposedSessions.length = 0;
	shutdownReasons.length = 0;
	sessionCounter = 0;
	shutdownBehavior = async () => {};
}

export function installFakePi(): void {
	mock.module("@earendil-works/pi-coding-agent", () => ({
		SettingsManager: { create: () => ({}) },
		ModelRuntime: { create: () => ({}) },
		DefaultResourceLoader: class {
			constructor(options: any) {
				capturedLoaderOptions.push(options);
			}
			async reload() {}
		},
		SessionManager: { create: () => ({ appendCustomEntry() {} }) },
		createAgentSession: async (options: any) => {
			capturedSessionOptions.push(options);
			const sessionFile = `/tmp/child-${++sessionCounter}.jsonl`;
			// pi's `AgentSession.messages` is a live array of the child's **model** messages, each with an
			// epoch-ms `timestamp` — what the staleness floor reads. A spawned child always has at least
			// its prompt, and a held turn adds nothing.
			const messages: Array<Record<string, unknown>> = [{ role: "user", timestamp: Date.now() }];
			return {
				session: {
					sessionFile,
					messages,
					model: null,
					sessionManager: { getEntries: () => childEntries },
					bindExtensions: async () => {},
					prompt: () => turnBehavior(),
					followUp: async () => {},
					abort: async () => {},
					// `disposeChildSession` tells the child's own extensions first, through exactly this
					// property (pi does not export the emitter).
					extensionRunner: {
						hasHandlers: () => true,
						emit: async (event: any) => {
							shutdownReasons.push(String(event?.reason));
							await shutdownBehavior();
						},
					},
					dispose: () => {
						disposedSessions.push(sessionFile);
					},
				},
			};
		},
	}));
}
