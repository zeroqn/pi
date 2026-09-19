/**
 * The RLM side of the RSI seam — tickets 02, 03, 04, 15 and 16 of the RSI x RLM map.
 *
 * RSI learns skills and surfaces them to pi through `resources_discover`. In code-mode
 * neither half of that works: pi renders no `<available_skills>` block at all unless
 * `read` or `bash` is active (the block is a name check on the active tool set), and the
 * learned store sits outside the kernel's mounts, so `open()` cannot reach it. RSI
 * therefore publishes a facade on `globalThis`, and this module is the client:
 *
 *   - **`skills()` / `skill(name)`** as *kernel host functions*. They must be host
 *     functions rather than registered tools: `registerTool` produces a model-callable
 *     pi tool, while the kernel's surface is the fixed set RLM builds (RSI x RLM ticket
 *     08 measured this).
 *   - **live usage reporting**: every `skill()` call and every `bash` host call is
 *     reported as it happens, and *RSI* does the matching, resolving and per-turn
 *     dedupe. Policy stays in RSI; RLM reports facts.
 *
 * The shape is the one Magic Context uses (`magic-context.ts`), for the same reason: pi's
 * jiti loader re-imports modules per session (`moduleCache: false`), so module-level state
 * does not survive across sessions in one process. Resolution happens at call time, not
 * at load, so an RSI that appears later is found and an RSI that is absent is a
 * degradation rather than a failure.
 *
 * **With RSI absent every function here is inert** and RLM behaves exactly as it did
 * before: no skills block, no reports, no error. That is the symmetric-degradation rule
 * (ticket 15), and it is why nothing in this file throws into a cell.
 */

const REGISTRY_KEY = Symbol.for("@earendil/rsi:pi-registry");

/** One learned skill, as RSI lists it. */
export interface SeamSkill {
	name: string;
	description: string;
	location: string;
	scope: string;
}

export interface SeamSkillContent {
	content: string;
	files: string[];
}

/** The caller's identity: which session is asking, and where it is. */
export interface SeamCaller {
	sessionFile?: string;
	cwd?: string;
}

interface RsiFacade {
	skills(caller?: SeamCaller): SeamSkill[];
	skill(name: string, caller?: SeamCaller): SeamSkillContent | undefined;
	noteUsage?(usage: { sessionFile?: string; cwd?: string; kind: "skill" | "read"; target: string }): void;
	noteHostCall?(call: { sessionFile?: string; cwd?: string; command: string }): void;
	capability?(fact: { sessionFile?: string; canWrite: boolean; reason?: string }): void;
	childFactory?(pi: unknown, request: unknown): (pi: unknown) => void;
}

/**
 * Finds RSI's facade. The key is part of the interface RSI agrees to; the fallback scan
 * exists so a differently-named registry with the right shape still works rather than
 * silently degrading.
 */
export function findRsiSeam(): RsiFacade | null {
	const direct = (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
	if (isFacade(direct)) return direct;
	for (const symbol of Object.getOwnPropertySymbols(globalThis)) {
		if (!/rsi/i.test(String(symbol.description ?? ""))) continue;
		const candidate = (globalThis as Record<symbol, unknown>)[symbol];
		if (isFacade(candidate)) return candidate;
	}
	return null;
}

function isFacade(value: unknown): value is RsiFacade {
	return Boolean(value) && typeof (value as RsiFacade).skills === "function" && typeof (value as RsiFacade).skill === "function";
}

/** Logged once per session, so a missing RSI is visible without being noisy. */
export function rsiStatus(): string {
	const facade = findRsiSeam();
	if (!facade) return "rsi: no registry — code-mode sessions see no learned skills (degradation, not failure)";
	const count = safe(() => facade.skills({}).length) ?? 0;
	return `rsi: registry found — ${count} learned skill(s) visible in code-mode`;
}

/** Reads the store's list for a caller. `[]` when RSI is absent or the read fails. */
export function seamSkills(caller: SeamCaller): SeamSkill[] {
	const facade = findRsiSeam();
	if (!facade) return [];
	return safe(() => facade.skills(caller)) ?? [];
}

/** Reads one skill's content. `undefined` when RSI is absent, or the name is unknown. */
export function seamSkill(name: string, caller: SeamCaller): SeamSkillContent | undefined {
	const facade = findRsiSeam();
	if (!facade) return undefined;
	return safe(() => facade.skill(name, caller));
}

/** Reports one consultation. Fire-and-forget: a lost count must never fail a cell. */
export function reportUsage(input: { kind: "skill" | "read"; target: string; caller: SeamCaller }): void {
	const facade = findRsiSeam();
	if (!facade?.noteUsage) return;
	try {
		facade.noteUsage({ ...input.caller, kind: input.kind, target: input.target });
	} catch {
		/* a report must never surface as an error */
	}
}

/** Offers one bash command's path-looking tokens to RSI, which owns the matching. */
export function reportHostCall(command: string, caller: SeamCaller): void {
	const facade = findRsiSeam();
	if (!facade?.noteHostCall) return;
	try {
		facade.noteHostCall({ ...caller, command });
	} catch {
		/* see above */
	}
}

/** Publishes this session's write capability, so RSI's gate can admit a code-mode session. */
export function reportCapability(fact: { sessionFile?: string; canWrite: boolean; reason?: string }): void {
	const facade = findRsiSeam();
	if (!facade?.capability) return;
	try {
		facade.capability(fact);
	} catch {
		/* see above */
	}
}

/**
 * The factory a child session is given, when RSI offers one (ticket 11). `undefined` when
 * RSI is absent or too old, which leaves a child running without RSI exactly as today.
 */
export function rsiChildFactory(request: unknown): Array<(pi: unknown) => void> {
	const facade = findRsiSeam();
	if (!facade?.childFactory) return [];
	try {
		const factory = facade.childFactory(undefined, request);
		return typeof factory === "function" ? [factory] : [];
	} catch {
		return [];
	}
}

function safe<T>(fn: () => T): T | undefined {
	try {
		return fn();
	} catch {
		return undefined;
	}
}
