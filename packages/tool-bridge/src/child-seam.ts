/**
 * The child seam — the generic, owner-agnostic API an adopter uses to give a *child* session what the
 * bridge's owners provide (wayfinder ticket 02, `.scratch/tool-ownership/`).
 *
 * A child loads no ambient extensions, so an owner that serves one injects an extension factory into it
 * (`childFactories`) and is told which session it now serves (`bindChild`). Neither the shapes above nor
 * this file name an owner: the owner list lives in `./owners`, and all this module knows is that a
 * descriptor may declare the four hooks.
 *
 * Since `.scratch/child-surface/` this file also owns the child's **policy** — the ceiling (`childCeiling`)
 * and the child detector (`setChildDetector`) — and appends **the bridge's own child factory** last, which
 * is what corrects a child's surface (`./adapter`). The root bridge (`./adopter`) is deliberately still not
 * here: it answers what a *cell* can call, a different question with its own state.
 */
import { type ChildCeiling, childSurfaceFactory } from "./adapter";

export type { ChildCeiling };
import { forgetSession, sessionKey } from "./convention";
import { OWNERS, childEligibleTools } from "./owners";

/**
 * The one tool code mode owns, named once and here.
 *
 * No owner can declare it: `python` is not an owner's tool, and the ceiling's whole job is to keep it —
 * a child without it has no way to work at all. Its other half is that a name can only be in the ceiling
 * if the *parent's* surface held it, so a parent that is not a code-mode session still offers a child
 * nothing.
 */
const CHILD_ALWAYS = ["python"] as const;

/**
 * The ceiling: what a child session may be offered at all (`zeroqn/pi`'s
 * `.scratch/child-surface/` ticket 03).
 *
 * `parentSurface` is the *spawning* session's live `getActiveTools()`, read at spawn time — never a
 * record, and never a walk up a chain (ticket 01). With no spawner to read (a session opened on its own,
 * resumed, or a child whose spawner is in another process) the declared list stands in: `python` plus
 * every owner's `childEligible`, intersected — later — with what the child actually registers, so an
 * absent owner removes its own name.
 *
 * `dropped` is what a reader needs to tell a *narrowed* child from a *broken* one: it names the parent's
 * tools the child was never going to hold (`ask_user_question`, for instance, which no owner declares).
 */
export function childCeiling(parentSurface?: readonly string[]): ChildCeiling {
	const eligible = [...CHILD_ALWAYS, ...childEligibleTools()];
	if (parentSurface === undefined) {
		return { ceiling: eligible, source: "fallback" };
	}
	const ceiling = parentSurface.filter((name) => eligible.includes(name));
	return {
		ceiling,
		source: "spawner",
		dropped: parentSurface.filter((name) => !eligible.includes(name)),
	};
}

/**
 * The child detector: how the bridge's *entry* learns that the session it is reconciling is a child.
 *
 * A resumed child loads the ambient manifest, so it is reconciled by the entry rather than by a factory
 * injected at spawn time — and only rlm knows what a child session looks like (`readChildProvenance`,
 * its own `rlm-child` entry). Rather than teach this package rlm's marker, rlm **installs** its reader
 * once it loads: one function, no per-session table, and no rlm loaded means no child is detected and the
 * root rule applies exactly as before (map ticket 03 §5).
 */
let childDetector: ((ctx: unknown) => boolean) | undefined;

export function setChildDetector(detector: (ctx: unknown) => boolean): void {
	childDetector = detector;
}

export function detectsChild(ctx: unknown): boolean {
	if (!childDetector) return false;
	try {
		return childDetector(ctx) === true;
	} catch {
		// A detector that throws must not take a session's start with it; an undetected child degrades to
		// the root rule, which is a state the session was already in.
		return false;
	}
}

/** Test seam: forget the installed detector. */
export function __clearChildDetectorForTests(): void {
	childDetector = undefined;
}

/** What an owner may need to build a child's factories. Grows a field when an owner needs one. */
export type ChildRequest = {
	/** The spawning session's file. Provenance: owners log it, none routes by it. */
	parentSessionFile?: string;
	/**
	 * The ceiling the spawner computed for this child (ticket 01 §2). Absent when nothing computed one —
	 * a child built by a caller that does not know about ceilings — in which case the factory's own
	 * `childCeiling()` (the declared fallback) stands in.
	 */
	ceiling?: ChildCeiling;
};

/**
 * The vocabulary of "bind a session you did not initialise": which session, its id, its parent, its cwd.
 * `childSessionFile` is the routing key, `childSessionId` the per-session policy key and `cwd` the project
 * key; the parent file is provenance.
 */
export type ChildBindInput = {
	childSessionFile?: string;
	childSessionId?: string;
	parentSessionFile?: string;
	cwd?: string;
};

/**
 * Every owner's child factories, in declaration order.
 *
 * An owner that declares none contributes none. A factory whose owner is unavailable is **kept**: it
 * no-ops when it runs, because the owner decides its own availability (and looks it up in the child's own
 * session, where its `ctx` is authentic), and dropping it here would decide that at spawn time instead.
 */
export function childFactories(request: ChildRequest): Array<(pi: any) => void> {
	const factories: Array<(pi: any) => void> = [];
	for (const owner of OWNERS) {
		if (!owner.childFactories) continue;
		factories.push(...owner.childFactories(request));
	}
	// **Last, and that is the mechanism** (ticket 02 §3): handlers run in registration order, so the
	// bridge's own session-start reconcile has to be registered after every owner's — otherwise an owner
	// that registers a tool in its own `session_start` would have it activated by pi *behind* the
	// reconcile's back, and the surface would be wrong until the next turn.
	factories.push(childSurfaceFactory(request));
	return factories;
}

/**
 * Binds a session the owners did not initialise, in declaration order.
 *
 * Best effort and contained: a throwing owner must not stop another's bind, and must not fail the session
 * that is binding — the rule that already keeps a refused tool registration from taking a child's session
 * down. **Residual, deliberate:** a throw is invisible here, because `childStatus()` reports an owner's
 * availability rather than the outcome of one bind (ticket 02).
 */
export function bindChild(input: ChildBindInput): void {
	for (const owner of OWNERS) {
		if (!owner.bindChild) continue;
		try {
			owner.bindChild(input);
		} catch {
			/* one owner cannot stop another's bind */
		}
	}
}

/**
 * One line per owner that offers child handling, joined with `; `. Owners that offer none contribute
 * nothing, so a session with no such owner records an empty field rather than a misleading line.
 *
 * A throwing owner contributes a line saying so rather than costing every other owner its status: this
 * runs inside a session-start handler whose whole purpose is to record what was available.
 */
export function childStatus(): string {
	const lines: string[] = [];
	for (const owner of OWNERS) {
		if (!owner.childStatus) continue;
		try {
			const line = owner.childStatus();
			if (line) lines.push(line);
		} catch (error) {
			lines.push(
				`${owner.name}: status threw — ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return lines.join("; ");
}
