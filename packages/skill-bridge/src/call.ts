/**
 * The call form: `skills()` and `skill(name)`, and the two routes a name can be read by.
 *
 * `skills()` answers from the providers — the learned tier's catalogue, whose `scope` field is the
 * provider's own vocabulary. The human tier is not listed: the block is its catalogue, and a human
 * skill has no `scope` to report.
 *
 * `skill(name)` answers for **both** tiers, in one shape (`{ content, files }`), and which route it
 * takes is `./convention`'s decision, not this module's:
 *
 *   - a name a provider claims is read through that provider's `read(name)` — and *only* there, so
 *     this package never touches a store's files, layout or payload declaration;
 *   - every other name is read from the file its `location` names, which is what pi's own `/skill:`
 *     expansion does (content minus frontmatter).
 *
 * Both tiers therefore hand the model a skill's **body**: a provider is expected to return the body
 * too, because the alternative — one tier with frontmatter, one without — is the asymmetry the one
 * call form exists to remove.
 */
import { readFileSync } from "node:fs";
import {
	type SkillContent,
	type SkillEntry,
	type SkillProvider,
	composeSkills,
	listings,
	providersFor,
	sessionKey,
} from "./convention";

/** What the host functions need at call time — never at contribution time. */
export type SkillCallDeps = {
	/** The session context, as the entry last saw it. The session key is derived from it per call. */
	ctx: () => unknown;
	/** pi's own loaded skills, read at call time: the prompt options are refreshed every turn. */
	piLoaded: () => readonly SkillEntry[];
};

/** The call-form host functions, ready to contribute. */
export type SkillHostFns = {
	skills_host: () => Promise<SkillEntry[]>;
	skill_host: (...args: unknown[]) => Promise<SkillContent>;
};

/**
 * A SKILL.md's body: the file without its frontmatter, normalised the way pi's own reader does.
 * Exported because the human route and any provider that wants the same rule should share one
 * implementation rather than agree by convention.
 */
export function stripFrontmatter(content: string): string {
	const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
	if (!normalized.startsWith("---\n")) return normalized;
	const end = normalized.indexOf("\n---", 3);
	if (end === -1) return normalized;
	return normalized.slice(end + 4).trim();
}

/** The body of the file at `location`, or `undefined` when it cannot be read. */
export function bodyAt(location: string): string | undefined {
	if (location.length === 0) return undefined;
	try {
		return stripFrontmatter(readFileSync(location, "utf8"));
	} catch {
		return undefined;
	}
}

function providersOf(deps: SkillCallDeps): SkillProvider[] {
	try {
		return providersFor(sessionKey(deps.ctx()));
	} catch {
		// A context that cannot be read is a session with no providers, not a cell that fails.
		return [];
	}
}

function loadedOf(deps: SkillCallDeps): readonly SkillEntry[] {
	try {
		return deps.piLoaded() ?? [];
	} catch {
		return [];
	}
}

export function skillHostFns(deps: SkillCallDeps): SkillHostFns {
	return {
		async skills_host() {
			const answers = await listings(providersOf(deps));
			// The catalogue is the union, first-wins by name — the same rule the block composes by, so
			// a name `skills()` lists is a name `skill()` can resolve.
			return composeSkills([], answers).map(({ entry }) => ({
				name: entry.name,
				description: entry.description,
				location: entry.location,
				scope: entry.scope,
			}));
		},

		async skill_host(...args: unknown[]) {
			const wanted = String(args[0] ?? "").trim();
			if (!wanted) throw new Error("skill(name) requires a name");

			const providers = providersOf(deps);
			const answers = await listings(providers);
			const composed = composeSkills(loadedOf(deps), answers);
			const found = composed.find((candidate) => candidate.entry.name === wanted);
			if (!found) {
				throw new Error(
					`no skill named "${wanted}" — call skills() for the ones this session can see`,
				);
			}

			const route = found.route;
			if (route.kind === "provider") {
				// Destructured before the closure: TypeScript does not carry the narrowing of
				// `route.kind` into a callback body.
				const owner = route.owner;
				const provider = providers.find((candidate) => candidate.owner === owner);
				const content = provider ? await provider.read(wanted) : undefined;
				if (!content) {
					// The provider owns the name and could not answer. Reading its file here would put a
					// store's layout in this package, which is the one thing it must never learn.
					throw new Error(`skill "${wanted}" is supplied by ${owner}, which could not read it`);
				}
				return { content: String(content.content ?? ""), files: [...(content.files ?? [])] };
			}

			const content = bodyAt(found.entry.location);
			if (content === undefined) {
				throw new Error(
					`skill "${wanted}" is listed at ${found.entry.location || "(no location)"} but could not be read`,
				);
			}
			return { content, files: [] };
		},
	};
}
