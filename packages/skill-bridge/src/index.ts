/**
 * The entry: contribute the call form, render the block, forget the session
 * (`.scratch/skill-bridge/`, re-homed by `.scratch/host-bridge` ticket 08).
 *
 * Three moments, in the order the facts arrive:
 *
 *   - `session_start` — remember this session's newest ctx and prune what is stale. The *mount and the
 *     contribution* are no longer here: `pi-host-bridge` composes the session in its own handler and
 *     asks this package through its registration, which is also what serves a **spawned child** (a
 *     child loads no ambient extension, so an entry that mounted for itself left the child with no call
 *     form unless rlm named it).
 *   - `before_agent_start` — render. The gate is the composition root's record for this session
 *     (`mounted`, and `skills_host` among the installed names), which exists by now because every
 *     `session_start` handler has run; the block itself is built from the event's own loaded skills plus
 *     the providers' answers.
 *   - `session_shutdown` — forget this session's providers and this package's own per-session state.
 *     `globalThis` outlives `/new`, resume and fork, and a **child never reaches a shutdown hook at
 *     all**, which is why the provider registry is additionally pruned by age.
 *
 * Nothing here reads a store. The providers are asked; this package never looks behind one.
 */
import {
	type ProviderListing,
	READER,
	type SkillEntry,
	forgetSession,
	listings,
	pruneProviders,
	providersFor,
	sessionKey,
} from "./convention";
import {
	API_VERSION as HOST_API_VERSION,
	type ContributorRegistration,
	type SessionInput,
	registerContributor,
	sessionRecord,
} from "../../host-bridge/src/convention";
import { skillHostFns } from "./call";
import { SKILL_PRELUDE } from "./prelude";
import { beforeAgentStartResult, eventSkills } from "./render";

/**
 * A week. Pruning is hygiene, not correctness: a record is keyed by session file, so a stale one
 * cannot answer for another session, and the only thing at stake is the memory of a process that has
 * served thousands of sessions. A live session is never near this age — it rewrites its transcript
 * every turn.
 */
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

type ExtensionSurface = {
	on(event: string, handler: (event: any, ctx: any) => unknown): void;
	appendEntry?(customType: string, data: unknown): unknown;
};

type BridgeState = {
	/** The newest ctx each session was handed, keyed by the session key. */
	ctxBySession: Map<string, unknown>;
	/** The last `event.systemPromptOptions.skills` each session reported, for a ctx that cannot answer. */
	loadedBySession: Map<string, readonly SkillEntry[]>;
	/** Once per session: the durable record, and the one human warning. */
	recordedSessions: Set<string>;
	warnedSessions: Set<string>;
	/** Which surfaces already have the block installed — see {@link installSkillBlock}. */
	installedSurfaces: WeakSet<object>;
};

/**
 * The per-session state, on a **process-global** rather than in this module's scope.
 *
 * Two facts force it. The registration is one object per module instance, while a surface exists per
 * session; and pi loads each extension entry through its own jiti instance (`moduleCache: false`), so
 * *this file has several instances in one process* — rlm's import of the entry, the ambient entry pi
 * loaded at startup, and the one a spawned child's factory reaches. Module scope would mean each
 * instance kept its own idea of which surfaces are installed and which session a cell belongs to, and
 * the first live run of a spawned child measured exactly that: **two `skill-bridge-kernel` entries**,
 * because the child's surface was installed once by rlm's instance and once by the ambient one's
 * registration.
 *
 * A session that never reaches a shutdown hook (a child) leaves one entry per map, which is the same
 * bounded leak the provider registry already tolerates.
 */
const STATE_SYMBOL = Symbol.for("pi-skill-bridge:state");

function state(): BridgeState {
	const holder = globalThis as Record<symbol, unknown>;
	const existing = holder[STATE_SYMBOL];
	if (existing !== null && typeof existing === "object") return existing as BridgeState;
	const created: BridgeState = {
		ctxBySession: new Map(),
		loadedBySession: new Map(),
		recordedSessions: new Set(),
		warnedSessions: new Set(),
		installedSurfaces: new WeakSet(),
	};
	holder[STATE_SYMBOL] = created;
	return created;
}

/** Test seam: forget every per-session fact this process holds. */
export function __resetBridgeStateForTests(): void {
	state().ctxBySession.clear();
	state().loadedBySession.clear();
	state().recordedSessions.clear();
	state().warnedSessions.clear();
}

function keyOf(ctx: unknown): string {
	return sessionKey(ctx);
}

function ctxFor(key: string, fallback: unknown): unknown {
	const ctx = state().ctxBySession.get(key);
	return ctx === undefined || ctx === null ? fallback : ctx;
}

/** pi's loaded skills, live from the session's ctx, with the last turn's snapshot as the fallback. */
function piLoadedFor(key: string, fallback: unknown): readonly SkillEntry[] {
	const ctx = ctxFor(key, fallback);
	try {
		const options = (ctx as { getSystemPromptOptions?: () => unknown })?.getSystemPromptOptions?.();
		if (options && typeof options === "object") {
			return eventSkills({ systemPrompt: "", systemPromptOptions: options as never });
		}
	} catch {
		/* a ctx that cannot answer falls back to what the last turn reported */
	}
	return state().loadedBySession.get(key) ?? [];
}

/** What this package contributes to one session: the two call-form host functions and the prelude. */
export function skillBridgeAnswer(input: SessionInput) {
	return {
		contribution: {
			owner: READER,
			hostFns: skillHostFns({
				ctx: () => ctxFor(input.sessionKey, input.ctx),
				piLoaded: () => piLoadedFor(input.sessionKey, input.ctx),
			}),
			prelude: SKILL_PRELUDE,
		},
	};
}

/**
 * The registration, published at module load: the composition root asks it for every session, root or
 * child, and this package is what renders for the child because `childFactories` says so.
 */
export const skillBridgeRegistration: ContributorRegistration = {
	key: "pi-skill-bridge",
	owner: READER,
	apiVersion: HOST_API_VERSION,
	session: (input) => skillBridgeAnswer(input),
	childFactories: () => [(pi: unknown) => installSkillBlock(pi as ExtensionSurface)],
};

registerContributor(skillBridgeRegistration);

/**
 * Install the block's three handlers on one surface — the root manifest's entry, or the factory a
 * spawned child's loader was handed.
 *
 * **Once per surface, whoever asks.** Two paths can deliver this package to the same child (rlm names
 * it, and the seam's composition carries it as a contributor), and installing twice would append the
 * block twice: the fold hands each handler the previous one's prompt, so the second would see the block
 * already there and add another copy. The guard is the invariant — one surface, one block — rather than
 * an ordering hope.
 */
export function installSkillBlock(pi: ExtensionSurface): void {
	if (state().installedSurfaces.has(pi as object)) return;
	state().installedSurfaces.add(pi as object);

	pi.on("session_start", (_event: unknown, ctx: unknown) => {
		const key = keyOf(ctx);
		state().ctxBySession.set(key, ctx);
		// Hygiene first: a record whose session is long gone must not answer for this one.
		try {
			pruneProviders(PRUNE_AFTER_MS);
		} catch {
			/* pruning must never fail a session start */
		}
		return undefined;
	});

	pi.on("before_agent_start", async (event: any, ctx: unknown) => {
		const key = keyOf(ctx);
		state().ctxBySession.set(key, ctx);
		const loaded = eventSkills(event);
		if (loaded.length > 0) state().loadedBySession.set(key, loaded);

		// The composition root's record, written in its own `session_start` — later than this entry in
		// the manifest, and earlier than any turn.
		const record = sessionRecord(key);
		const mounted = record?.mounted === true;
		const contributed = record?.installed.includes("skills_host") === true;

		if (!state().recordedSessions.has(key)) {
			state().recordedSessions.add(key);
			try {
				pi.appendEntry?.("skill-bridge-kernel", {
					mounted,
					contributed,
					problem: record?.problems[0] ?? (mounted ? null : "no kernel for this session"),
				});
			} catch {
				/* the record is best effort */
			}
		}

		// Loud once to the human, silent to the model: with no call form the block falls back to pi's
		// own sentence, which the kernel's bash makes true, so there is nothing the model needs to know.
		if ((!mounted || !contributed) && !state().warnedSessions.has(key)) {
			state().warnedSessions.add(key);
			try {
				(ctx as { ui?: { notify?: (text: string, type?: string) => void } })?.ui?.notify?.(
					`skill-bridge: ${record?.problems[0] ?? (mounted ? "the call form was not accepted" : "no kernel for this session")}`,
					"warning",
				);
			} catch {
				/* a notice must never fail a session start */
			}
		}

		let answers: ProviderListing[] = [];
		try {
			answers = await listings(providersFor(key));
		} catch {
			// A provider registry that cannot be read is a session with no providers, not a prompt that
			// fails to build.
			answers = [];
		}
		return beforeAgentStartResult(event, { mounted, contributed, answers });
	});

	pi.on("session_shutdown", async (_event: unknown, ctx: unknown) => {
		let key: string;
		try {
			key = keyOf(ctx);
		} catch {
			return;
		}
		try {
			forgetSession(key);
		} catch {
			/* the session is going away either way */
		}
		state().ctxBySession.delete(key);
		state().loadedBySession.delete(key);
		state().recordedSessions.delete(key);
		state().warnedSessions.delete(key);
	});
}

export default function skillBridge(pi: ExtensionSurface): void {
	installSkillBlock(pi);
}
