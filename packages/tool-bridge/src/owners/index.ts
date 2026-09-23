/**
 * The owner list — the one place in the bridge that knows an extension by name (wayfinder ticket 02,
 * `.scratch/tool-ownership/`).
 *
 * Every other module in `src/` is owner-agnostic and consumes this list rather than an owner: the child
 * seam aggregates the hooks below, and the entry passes `nativeOnlyTools()` to the surface rule. Adding an
 * owner is a module plus one line here.
 */
import type { ChildBindInput, ChildRequest } from "../child-seam";
import { magicContext } from "./magic-context";

/**
 * What an owner declares to the bridge. Every field but `name` is optional: an owner that serves no child
 * declares neither `childFactories` nor `bindChild`, and one that publishes no native-only tool declares
 * no `nativeOnly`.
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
	/** Extra extension factories for a child session. Absent means this owner serves no child. */
	childFactories?: (request: ChildRequest) => Array<(pi: any) => void>;
	/** Binds a session this owner did not initialise. A throw is contained by the seam. */
	bindChild?: (input: ChildBindInput) => void;
	/** One line for a session's record: what this owner provides, or why it does not. */
	childStatus?: () => string;
};

/** Declaration order is the order: statuses are joined, and factories concatenated, in this order. */
export const OWNERS: readonly OwnerModule[] = [magicContext];

/** The union of every owner's native-only names, in declaration order and without duplicates. */
export function nativeOnlyTools(): string[] {
	const names: string[] = [];
	for (const owner of OWNERS) {
		for (const name of owner.nativeOnly ?? []) if (!names.includes(name)) names.push(name);
	}
	return names;
}
