/**
 * The RSI side of the seam — the facade other extensions reach RSI through.
 *
 * RLM turns a session into a Python kernel, and in code-mode pi renders no skills block
 * at all: its `<available_skills>` gate is a name check on the active tool set
 * (`core/system-prompt.js`), and the kernel's only tool is `python`. The learned store is
 * also unreachable from the kernel, because RLM mounts only the cwd and its scratch. So
 * RLM asks this facade for the skills and renders them itself, and reports what it
 * consulted back here, where the matching, resolving and counting live.
 *
 * The shape is Magic Context's (`magic-context/packages/pi-plugin/src/pi-registry.ts`),
 * for the same reason: pi's jiti loader re-imports modules per session
 * (`moduleCache: false`), so module-level state does not survive across sessions within
 * one process. One `Symbol.for` slot holds a **facade of methods, never state**;
 * instances register into a module-level set; the facade serves by the caller's session
 * file.
 *
 * Two rules the design settled and this file must keep (tickets 11 and 15):
 *   - **Process-wide reads.** Every instance serves the same global store, so `skills()`
 *     and `skill()` answer correctly even when the caller is a grandchild whose parent
 *     instance is gone. Only session-scoped facts resolve to a particular instance.
 *   - **Resolvable, never released.** A child session never emits `session_shutdown`
 *     (ticket 09), so nothing may depend on a release hook. Registrations are dropped
 *     only as hygiene, by session-file mtime, which cannot take a live session down.
 *
 * Degradation is symmetric: with RSI absent the lookup misses and the client behaves as
 * it did before; with RLM absent nothing calls in.
 */

import * as fs from "node:fs";
import { projectKeyFor } from "./project-key.ts";
import type { Scope, SkillStore } from "./store.ts";

export const RSI_REGISTRY_KEY = Symbol.for("@earendil/rsi:pi-registry");

/** One learned skill, in the shape pi itself lists them. */
export interface SeamSkill {
	name: string;
	description: string;
	/** Absolute path of the SKILL.md, so a bash-capable kernel can read it. */
	location: string;
	/** `"general"` or the project key, so a consumer can tell them apart. */
	scope: string;
}

export interface SeamSkillContent {
	content: string;
	/** Payload files relative to the skill directory. */
	files: string[];
}

/** The caller's identity and context. Both optional: a caller that knows neither still gets the union of what exists. */
export interface SeamCaller {
	sessionFile?: string;
	cwd?: string;
}

/** RLM's own knowledge of this session's surface (ticket 03). */
export interface SeamCapability {
	sessionFile?: string;
	/** True when the session's kernel can write files — `write_text`/`edit_text`/`bash` exist. */
	canWrite: boolean;
	/** Why, for the log and for `/rsi status`. */
	reason?: string;
}

/** A consultation reported live (ticket 15). */
export interface SeamUsage {
	sessionFile?: string;
	cwd?: string;
	/**
	 * How the consultation happened. `"skill"` is an explicit `skill(name)` call, counted
	 * like a `/skill:name` expansion; `"read"` is content read from a path, counted as a
	 * read. Both move the use count, which is what the lifecycle turns on.
	 */
	kind: "skill" | "read";
	/** The skill name for kind `"skill"`, or the absolute path for kind `"read"`. */
	target: string;
}

/** A bash host call, whose command RSI matches against the store (ticket 02's backstop). */
export interface SeamHostCall {
	sessionFile?: string;
	cwd?: string;
	command: string;
}

/** What an instance supplies. The facade adds the dispatch and the process-wide reads. */
export interface RsiSeamWork {
	/** The union for a scope: `general` always, plus the project scope when the cwd resolves to one. */
	skills(scope: Scope): SeamSkill[];
	skill(name: string, scope: Scope): SeamSkillContent | undefined;
	/** Record one consultation. Fire-and-forget: a lost count must never surface as an error. */
	noteUsage(usage: SeamUsage, scope: Scope): void;
	/** Offer one bash command's path-looking tokens as candidate reads. */
	noteHostCall(call: SeamHostCall, scope: Scope): void;
}

export interface RsiSeam extends RsiSeamWork {
	/**
	 * Register a session's facts. Published by the client at `session_start`, so a child's
	 * fact is its own and the root's is never inherited.
	 */
	capability(fact: SeamCapability): void;
	/**
	 * The factory a child session is given, when RLM asks for one (ticket 11). Optional:
	 * a client that finds it missing runs children without RSI, as today.
	 */
	childFactory?(pi: unknown, request: unknown): (pi: unknown) => void;
}

interface Registration {
	work: RsiSeamWork;
	/** This instance's own session file; the key the facade serves by. */
	sessionFile?: string;
	/** Per-session facts this instance published, keyed by session file. */
	facts: Map<string, SeamCapability>;
	registeredAt: number;
}

/** Live instances, in registration order. Insertion order is what a fallback resolves to. */
const registrations = new Set<Registration>();

/** The fact a session with no file publishes under, so a session-less client is still served. */
const NO_FILE = "(no session file)";

function keyFor(sessionFile: string | undefined): string {
	return sessionFile && sessionFile.length > 0 ? sessionFile : NO_FILE;
}

/**
 * The instance that owns this caller, or the single one when there is only one. `undefined`
 * when several are registered and none owns the caller — only session-scoped facts care.
 */
function resolve(caller: SeamCaller | undefined): Registration | undefined {
	const file = caller?.sessionFile;
	if (file && file.length > 0) {
		for (const registration of registrations) {
			if (registration.sessionFile === file) return registration;
		}
	}
	return registrations.size === 1 ? [...registrations][0] : undefined;
}

/**
 * Any live instance, for a process-wide read. Every instance serves the same global store,
 * so which one answers `skills()` is immaterial — which is what makes a grandchild work.
 */
function any(): Registration | undefined {
	return registrations.values().next().value;
}

/** The scope a caller resolves to. RSI owns this policy; a client never computes a key. */
function scopeFor(caller: SeamCaller | undefined): Scope {
	const project = projectKeyFor(caller?.cwd ?? process.cwd());
	return project ? { project } : "general";
}

/**
 * Drop registrations whose session file has not been written for longer than `maxAgeMs`.
 * Hygiene, not correctness: a session that is doing anything keeps a fresh mtime, and a
 * session that is not is already served by any other instance. Returns how many went.
 */
export function pruneRegistrations(maxAgeMs: number): number {
	const now = Date.now();
	let removed = 0;
	for (const registration of [...registrations]) {
		const file = registration.sessionFile;
		if (!file || file.length === 0) continue;
		let mtime: number;
		try {
			mtime = fs.statSync(file).mtimeMs;
		} catch {
			// The file is gone; nothing can be waiting on this registration's facts.
			registrations.delete(registration);
			removed++;
			continue;
		}
		if (now - mtime > maxAgeMs) {
			registrations.delete(registration);
			removed++;
		}
	}
	return removed;
}

/**
 * Publish an instance and return the function that withdraws it. Idempotent, because
 * shutdown paths can run more than once.
 */
export function registerRsiSeam(options: { work: RsiSeamWork; sessionFile?: string; maxAgeMs?: number }): () => void {
	const registration: Registration = {
		work: options.work,
		sessionFile: options.sessionFile,
		facts: new Map(),
		registeredAt: Date.now(),
	};
	registrations.add(registration);

	const facade: RsiSeam = {
		// Process-wide reads: any instance answers, because the store is global.
		skills: (caller) => any()?.work.skills(scopeFor(caller)) ?? [],
		skill: (name, caller) => any()?.work.skill(name, scopeFor(caller)),
		noteUsage: (usage) => {
			resolve(usage)?.work.noteUsage(usage, scopeFor(usage));
		},
		noteHostCall: (call) => {
			resolve(call)?.work.noteHostCall(call, scopeFor(call));
		},
		capability: (fact) => {
			// The fact belongs to the session that published it, on the instance that owns
			// that session — a child's own instance, never its parent's.
			const owner = resolve({ sessionFile: fact.sessionFile }) ?? registration;
			owner.facts.set(keyFor(fact.sessionFile), fact);
		},
	};

	(globalThis as Record<symbol, unknown>)[RSI_REGISTRY_KEY] = facade;

	return () => {
		registrations.delete(registration);
		if (registrations.size === 0) delete (globalThis as Record<symbol, unknown>)[RSI_REGISTRY_KEY];
	};
}

/** The published facade, or `undefined` when no RSI instance is live. */
export function findRsiSeam(): RsiSeam | undefined {
	const candidate = (globalThis as Record<symbol, unknown>)[RSI_REGISTRY_KEY];
	if (!candidate) return undefined;
	const shaped = candidate as Partial<RsiSeam>;
	return typeof shaped.skills === "function" && typeof shaped.skill === "function" ? (candidate as RsiSeam) : undefined;
}

/**
 * The capability a session published, or `undefined` when it published none — which is the
 * signal for the gate to fall back to its tool-name heuristic.
 */
export function publishedCapability(sessionFile: string | undefined): boolean | undefined {
	const key = keyFor(sessionFile);
	for (const registration of registrations) {
		const fact = registration.facts.get(key);
		if (fact) return fact.canWrite;
	}
	return undefined;
}

/** One line for the session log, so a missing seam is visible rather than mysterious. */
export function rsiSeamStatus(): string {
	if (registrations.size === 0) return "rsi seam: no instance published";
	return `rsi seam: ${registrations.size} instance(s) published`;
}

/** Test seam: the number of live registrations. */
export function __seamSizeForTests(): number {
	return registrations.size;
}

/** Test seam: forget every registration, so one test cannot leak into the next. */
export function __resetSeamForTests(): void {
	registrations.clear();
	delete (globalThis as Record<symbol, unknown>)[RSI_REGISTRY_KEY];
}
