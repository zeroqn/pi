/**
 * pi-fff-search — FFF's index behind code mode's `grep`/`find`.
 *
 * A cell's search primitives are code mode's own (`BASE_HOST_FNS`), so this package does not add a host
 * function and does not add a pi tool: it takes the one `search` slot the contract leaves open and
 * answers from [FFF](https://github.com/dmtrKovalenko/fff)'s index — the finder published by the
 * `pi-fff` prebuilt this repo carries (`packages/pi-fff`, the `zeroqn/fff` fork's `pi` branch).
 *
 * **Only when a cell asks for it.** `grep`/`find` reach the index when the call passes `fuzzy=True`, and
 * rg/fd answer otherwise: the index does not cover dot-paths, so a silent swap would quietly narrow every
 * answer that touched `.scratch/`, `.github/` or `.env`. The reason, measured, is in `src/engine.ts`.
 *
 * Nothing is contributed when `pi-fff` is not loaded — the engine is, and throws when called, which is
 * how code mode's fallback is reached. Contributing it unconditionally is deliberate: host-bridge
 * composes a session before `pi-fff`'s own `session_start` publishes its slot, so a contributor that
 * looked at the slot now would contribute nothing, every time.
 */
import {
	registerContributor,
	type ContributorAnswer,
	type SessionInput,
} from "../host-bridge/src/convention.ts";

import { createSearchEngine } from "./src/engine.ts";

/** This package's name in a kernel's receipts, records and refusals. */
export const OWNER = "fff-search";

/** The contributor registration's version. */
export const API_VERSION = 1;

/** Appended to the `python` tool's description; the contributor owns its own separators. */
export const DESCRIPTION =
	"\n\n`grep`/`find` with `fuzzy=True` answer from the workspace's FFF index instead of rg/fd: FFF's own" +
	" fuzzy matching, frecency order, and a scan that does not walk the tree. That index does not cover" +
	" dot-paths (`.scratch/`, `.github/`, `.env`) or files a `.gitignore` excludes; without `fuzzy=True`" +
	" the two primitives use rg/fd, which do cover dot-paths.";

export const GUIDELINES = [
	"`await grep(…, fuzzy=True)` and `await find(…, fuzzy=True)` answer from the workspace's FFF index: faster and frecency-ranked, but blind to dot-paths (`.scratch/`, `.github/`, `.env`) and to gitignored files. Do not use them for an exhaustive audit, a rename sweep or any search that must include a dot-directory — the default (no `fuzzy=`) is rg/fd, which covers those.",
	"In the index lane `find` takes `type=\"file\"` or `type=\"directory\"` and no `max_depth`; any other type or a depth bound is answered by fd instead.",
];

/**
 * What this package contributes to one session: the engine, its prose, and whether it has an index.
 *
 * Both a root session and a child get it. A child runs in this process, so it reads the same
 * process-global slot its spawner published — the parent's warm finder, not a second index. A child
 * whose cwd differs from its spawner's routes through the publisher's auxiliary pool, which is where a
 * second root belongs.
 */
export function fffSearchAnswer(input: SessionInput): ContributorAnswer {
	return {
		contribution: {
			owner: OWNER,
			search: createSearchEngine({ cwd: input.cwd }),
			description: DESCRIPTION,
			guidelines: GUIDELINES,
		},
		// No `reaches`: the slot backs the primitives that already exist, so it puts no new name on pi's
		// tool surface and nothing has to be stripped from it.
	};
}

export const fffSearchRegistration = {
	key: "pi-fff-search",
	owner: OWNER,
	apiVersion: API_VERSION,
	session: (input: SessionInput) => fffSearchAnswer(input),
};

registerContributor(fffSearchRegistration);

export default function fffSearch(_pi: unknown): void {
	// Nothing to install: the registration above is the whole of it, and it happened at module load.
	// This factory exists because every manifest entry is loaded as one.
}
