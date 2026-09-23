/**
 * The child seam — the generic, owner-agnostic API an adopter uses to give a *child* session what the
 * bridge's owners provide (wayfinder ticket 02, `.scratch/tool-ownership/`).
 *
 * A child loads no ambient extensions, so an owner that serves one injects an extension factory into it
 * (`childFactories`) and is told which session it now serves (`bindChild`). Neither the shapes above nor
 * this file name an owner: the owner list lives in `./owners`, and all this module knows is that a
 * descriptor may declare the three hooks.
 *
 * Deliberately **not** here: the root bridge (`./adopter`) and the surface rule (`./adapter`). They answer
 * different questions — what a *cell* can call, and what pi's active set holds — and the child path shares
 * no state with either.
 */
import { OWNERS } from "./owners";

/** What an owner may need to build a child's factories. Grows a field when an owner needs one. */
export type ChildRequest = {
	/** The spawning session's file. Provenance: owners log it, none routes by it. */
	parentSessionFile?: string;
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
