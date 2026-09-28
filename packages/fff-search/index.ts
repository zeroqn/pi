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
	"\n\n`grep`/`find` answer from the workspace's FFF index instead of rg/fd when the call asks them to:" +
	" `index=True` searches the index with rg's own matcher (the same matches, much faster, ordered by path" +
	" and line), and `fuzzy=True` uses FFF's fuzzy matching and frecency order. Both lanes see what the" +
	" index sees: it covers neither dot-paths (`.scratch/`, `.github/`, `.env`) nor files a `.gitignore`" +
	" excludes, so they answer with fewer matches than rg over a workspace root; without either flag the" +
	" two primitives use rg/fd, which do cover those.";

/**
 * The prose about the *primitive*, not about which route to take: the routing rule *between* code
 * mode's own lanes, the index lanes and `zvec_grep_*` is the user's and lives in the prompt — the
 * split `zvec-grep` states for its own prose. What is left here is the shape of the index lane's
 * `find`, which the caller cannot read off the description.
 */
export const GUIDELINES = [
	"In the index lanes `find` takes `type=\"file\"` or `type=\"directory\"` and no `max_depth`; an exact directory listing, a request for files and directories together, and fd's other types are answered by fd instead.",
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
