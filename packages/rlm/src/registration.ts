/**
 * rlm's registration with the host bridge (`.scratch/host-bridge` ticket 06).
 *
 * Before this, rlm mounted the kernel itself (`bindCodeMode`) and handed the ledger its delegation
 * surface in the same call. Now the composition root mounts, contributes and records, and this module
 * is what it asks — which is what lets rlm stop importing code mode altogether and stop naming code
 * mode's child instance in its own child factory list.
 *
 * The registration is one module-level object while rlm's session state is per session (a root's
 * manager, or a child's `childContext`), so the deps are filed under the session key by the instance
 * that owns the session and read back when the composition asks. The slot is a **process-global**, like
 * every other seam here: pi loads each extension entry through its own jiti instance, so this file has
 * several instances in one process.
 *
 * The handle is a parameter of the answer, not of the registration: `currentCell()` is how a spawn at
 * depth >= 2 records which cell spawned it, and it is the kernel's to know.
 */
import {
	API_VERSION,
	type ContributorAnswer,
	type ContributorRegistration,
	type SessionInput,
	registerContributor,
} from "../../host-bridge/src/convention";
import type { ChildKernelContext, Notice } from "./children";
import { rlmContribution } from "./contribution";
import type { ProvenanceInputs } from "./contribution";
import { delegationHostFns } from "./delegation";

/** What one session's contribution needs, filed when that session's instance starts. */
export type RlmSessionDeps = {
	manager: Parameters<typeof delegationHostFns>[0]["manager"];
	childContext: ChildKernelContext | null;
	ownDepth: number;
	ownSurface: () => string[];
	sessionFile: () => string | undefined;
	ownerDispatch: (notice: Notice) => void;
	provenance: ProvenanceInputs;
};

const DEPS_SYMBOL = Symbol.for("pi-rlm:session-deps");

function depsSlot(): Map<string, RlmSessionDeps> {
	const holder = globalThis as Record<symbol, unknown>;
	const existing = holder[DEPS_SYMBOL];
	if (existing instanceof Map) return existing as Map<string, RlmSessionDeps>;
	const created = new Map<string, RlmSessionDeps>();
	holder[DEPS_SYMBOL] = created;
	return created;
}

/** Filed by rlm's own `session_start`, which is declared before the composition root's. */
export function setRlmSessionDeps(key: string, deps: RlmSessionDeps): void {
	depsSlot().set(key, deps);
}

export function forgetRlmSessionDeps(key: string): void {
	depsSlot().delete(key);
}

/** Test seam. */
export function __clearRlmSessionDepsForTests(): void {
	depsSlot().clear();
}

/**
 * What rlm contributes to one session: the delegation surface, rlm's notices, and rlm's provenance
 * rule. `null` when this process knows nothing about the session — a session the composition is asked
 * about while no rlm instance is serving it.
 */
export function rlmAnswer(input: SessionInput): ContributorAnswer | null {
	const deps = depsSlot().get(input.sessionKey);
	if (!deps) return null;
	return {
		contribution: rlmContribution({
			hostFns: delegationHostFns({
				manager: deps.manager,
				childContext: deps.childContext,
				ownDepth: deps.ownDepth,
				sessionFile: deps.sessionFile,
				currentCell: () => input.handle.currentCell(),
				ownSurface: deps.ownSurface,
				ownerDispatch: deps.ownerDispatch,
			}),
			onNotice: deps.ownerDispatch,
			provenance: deps.provenance,
		}),
	};
}

export const rlmRegistration: ContributorRegistration = {
	key: "pi-rlm",
	owner: "rlm",
	apiVersion: API_VERSION,
	session: (input) => rlmAnswer(input),
};

registerContributor(rlmRegistration);
