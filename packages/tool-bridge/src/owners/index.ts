/**
 * The owner list — the one place in the bridge that knows an extension by name (wayfinder ticket 02,
 * `.scratch/tool-ownership/`).
 *
 * Every other module in `src/` is owner-agnostic and consumes this list rather than an owner: the
 * registration aggregates the hooks below, and the entry passes `nativeOnlyTools()` to the surface
 * rule. Adding an owner is a module plus one line here.
 */
import type { ChildBindInput, ChildRequest } from "../../../host-bridge/src/convention";
import { magicContext } from "./magic-context";
import { probe } from "./probe";

/**
 * What an owner declares to the bridge. Every field but `name` is optional: an owner that serves no child
 * declares neither `childFactories` nor `bindChild`, and one that publishes no native-only tool declares
 * neither `nativeOnly` nor `childEligible`.
 *
 * The descriptor carries **no publication**. An owner publishes its root-session tools from its own bundle
 * on the `pi-tool-bridge:owners` slot; this is only how the bridge serves a child session.
 */
export type OwnerModule = {
	/** The owner's name in the bridge's vocabulary. Unique across `OWNERS`; a test asserts it. */
	name: string;
	/**
	 * Tools the convention forbids publishing, so a bridged session keeps them as real pi tools. Their
	 * effect is pi's dispatch rather than their own `execute`, so a call routed through a cell would
	 * appear to succeed and record nothing.
	 */
	nativeOnly?: readonly string[];
	/**
	 * Tools a **child** session may hold, in the owner's own judgement. Absent means this owner offers a
	 * child nothing.
	 *
	 * A second list beside `nativeOnly`, deliberately (map ticket 03, `.scratch/child-surface/`):
	 * `nativeOnly` answers "must this stay a real pi tool in a *root*?" and `childEligible` answers "may a
	 * *child* hold it?", so a divergence between them is a decision someone made rather than a drift
	 * nobody noticed. They are equal today — a tool whose effect is pi's dispatch needs to stay a real pi
	 * tool in a child for exactly the reason it does in a root — and a test pins that.
	 *
	 * A name declared here that is *not* `nativeOnly` is inert: it is cell-reachable in the parent, so it
	 * is stripped from the parent's surface and cannot survive the ceiling's intersection.
	 */
	childEligible?: readonly string[];
	/** Extra extension factories for a child session. Absent means this owner serves no child. */
	childFactories?: (request: ChildRequest) => Array<(pi: any) => void>;
	/** Binds a session this owner did not initialise. A throw is contained by the seam. */
	bindChild?: (input: ChildBindInput) => void;
	/** One line for a session's record: what this owner provides, or why it does not. */
	childStatus?: () => string;
};

/** Declaration order is the order: statuses are joined, and factories concatenated, in this order. */
export const OWNERS: readonly OwnerModule[] = [
	magicContext,
	// The acceptance instrument, and the only entry here that is not a capability: it reports what a
	// child was actually offered, read from pi's own api, so the bar's equality claim is not the code
	// under test marking its own homework. Env-gated, so it is inert unless something is measuring.
	...(process.env.PI_TOOL_BRIDGE_PROBE ? [probe] : []),
];

/** The union of every owner's native-only names, in declaration order and without duplicates. */
export function nativeOnlyTools(): string[] {
	const names: string[] = [];
	for (const owner of OWNERS) {
		for (const name of owner.nativeOnly ?? []) if (!names.includes(name)) names.push(name);
	}
	return names;
}

/**
 * The union of every owner's child-eligible names, in declaration order and without duplicates.
 *
 * Separate from `nativeOnlyTools()` on purpose: the two answer different questions (see
 * `OwnerModule.childEligible`), and an owner may answer them differently.
 */
export function childEligibleTools(): string[] {
	const names: string[] = [];
	for (const owner of OWNERS) {
		for (const name of owner.childEligible ?? []) if (!names.includes(name)) names.push(name);
	}
	return names;
}
