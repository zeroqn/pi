/**
 * What mcp-lazy remembers for one session, in one place.
 *
 * Two facts make a module-local store wrong. pi loads each extension entry through its own jiti
 * instance while `globalThis` survives, so the module scope that a *publication* holds is not the one
 * the *factory* later writes to. And a root and its spawned child share one process, so a bare
 * module-local would bleed the root's servers into the child. The store is therefore a `Symbol.for`
 * slot on `globalThis`, keyed by {@link sessionKey} — one entry per session, root and child alike.
 *
 * `pi` is remembered per session as well: a session's own factory knows its `pi`, and the store keeps
 * it under that session's key so the route's `execute` can register a server against the right
 * registry. A process-level `lastPi` is the fallback for the one window where a key has no `pi` yet —
 * tool-bridge gathers the catalogue during the composition root's `session_start`, which (by extension
 * load order) runs before mcp-lazy's own `session_start` has stored it.
 */
import { sessionKey } from "../../tool-bridge/src/convention";
import { type LoadedServer, type McpConfigRead, readMcpConfig } from "./config";

/** The little of pi this package touches from a cell or a session handler. Structural, for tests. */
export type StatePi = {
	getAllTools?(): { name: string }[];
	getMcpServers?(): { name: string; config: unknown }[];
	registerMcpServer?(name: string, config: unknown): void;
};

export type SessionState = {
	key: string;
	/** The session's configured servers, read once. `undefined` until the first read. */
	servers?: LoadedServer[];
	configRead: boolean;
	configErrors: string[];
	/** Server names registered or attempted this session, so neither is done twice. */
	registered: Set<string>;
	/** Notice texts already delivered, so a warning is said once. */
	notices: Set<string>;
	pi?: StatePi;
	/** Servers whose instructions fill-in the model has already read (ticket 12). */
	acceptedFills: Set<string>;
	/** Whether ticket 14's sacrifice has engaged, after which no fill-in is accepted. */
	capEngaged: boolean;
};

type Store = { sessions: Map<string, SessionState>; lastPi?: StatePi };

const SESSIONS_SYMBOL = Symbol.for("pi-mcp-lazy:sessions");

function store(): Store {
	const holder = globalThis as Record<symbol, unknown>;
	const existing = holder[SESSIONS_SYMBOL];
	if (existing && typeof existing === "object" && "sessions" in (existing as Store)) return existing as Store;
	const created: Store = { sessions: new Map() };
	holder[SESSIONS_SYMBOL] = created;
	return created;
}

/** Remember this process's pi, so a catalogue gathered before `session_start` can still read it. */
export function notePi(pi: StatePi): void {
	store().lastPi = pi;
}

export function lastPi(): StatePi | undefined {
	return store().lastPi;
}

/** The state for one session, created on first use. */
export function stateFor(ctx: unknown, pi?: StatePi): SessionState {
	const key = sessionKey(ctx);
	const sessions = store().sessions;
	let state = sessions.get(key);
	if (!state) {
		state = {
			key,
			configRead: false,
			configErrors: [],
			registered: new Set(),
			notices: new Set(),
			acceptedFills: new Set(),
			capEngaged: false,
		};
		sessions.set(key, state);
	}
	if (pi) {
		state.pi = pi;
		notePi(pi);
	}
	return state;
}

/** The project-trust and cwd a ctx can answer, without letting a disposed ctx throw. */
function contextScope(ctx: unknown): { cwd?: string; projectTrusted?: boolean } {
	if (ctx === null || ctx === undefined) return {};
	let cwd: unknown;
	let trusted: unknown;
	try {
		cwd = (ctx as { cwd?: unknown }).cwd;
	} catch {
		return {};
	}
	try {
		trusted = (ctx as { isProjectTrusted?: () => unknown }).isProjectTrusted?.();
	} catch {
		trusted = undefined;
	}
	return {
		...(typeof cwd === "string" && cwd.length > 0 ? { cwd } : {}),
		...(typeof trusted === "boolean" ? { projectTrusted: trusted } : {}),
	};
}

export type ConfigReadDeps = {
	agentDir: string;
	readConfig?: (options: { agentDir: string; cwd?: string; projectTrusted?: boolean }) => McpConfigRead;
};

/** Read and cache this session's configured servers, once. Never throws. */
export function ensureServers(state: SessionState, ctx: unknown, deps: ConfigReadDeps): void {
	if (state.configRead) return;
	const read = deps.readConfig ?? readMcpConfig;
	const scope = contextScope(ctx);
	try {
		const result = read({ agentDir: deps.agentDir, ...scope });
		state.servers = result.servers;
		state.configErrors = result.errors;
	} catch (error) {
		state.servers = [];
		state.configErrors = [`mcp-lazy: ${error instanceof Error ? error.message : String(error)}`];
	}
	state.configRead = true;
}

/** Deliver a warning to the human once per session. A UI-less or disposed ctx is not a failure. */
export function noticeOnce(state: SessionState, ctx: unknown, text: string): void {
	if (state.notices.has(text)) return;
	state.notices.add(text);
	try {
		(ctx as { ui?: { notify?: (text: string, level?: string) => void } } | null)?.ui?.notify?.(text, "warning");
	} catch {
		/* best effort by definition */
	}
}

/** Forget a session at shutdown. `globalThis` outlives `/new`, resume and fork. */
export function forgetSession(ctx: unknown): void {
	try {
		store().sessions.delete(sessionKey(ctx));
	} catch {
		/* a session that cannot be keyed has no record to forget */
	}
}

/** Test seam: drop every session this process holds. */
export function __resetMcpLazyForTests(): void {
	store().sessions.clear();
	store().lastPi = undefined;
}
