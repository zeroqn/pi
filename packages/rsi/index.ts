/**
 * rsi — learned skills for pi.
 *
 * A background loop learns reusable skills from sessions and maintains them
 * over time, in an agent-owned store surfaced to pi only by this extension's
 * `resources_discover` handler. Phase 1 is the store, config and surfacing: no
 * model calls and no learner. A skill placed in the store by hand shows up in
 * its scope and nowhere else, a colliding name is refused, and disabling the
 * extension stops every learned skill influencing a session without touching a
 * file on disk.
 *
 * Spec: `~/.pi/.scratch/rsi/spec.md` (§2 shape, §4.8 config, §7 acceptance).
 * The store's governance invariants (§4.5) are enforced by `store.ts`; nothing
 * here writes outside the configured store root.
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { discoverSkillNames } from "./frontmatter.ts";
import { projectKeyFor } from "./project-key.ts";
import { SkillStore, type Scope } from "./store.ts";

export default function rsiExtension(pi: ExtensionAPI): void {
	const agentDir = getAgentDir();
	const { config, warnings } = loadConfig({ agentDir });

	// Human-authored names are reserved once at load: pi resolves skills by name
	// first-wins and appends learned paths last, so a collision would load the
	// human skill and silently drop the learned one.
	const reservedNames = discoverSkillNames(path.join(agentDir, "skills"));
	const store = new SkillStore({ root: config.storePath, reservedNames });

	pi.on("resources_discover", async (event) => {
		if (!config.enabled) return {};

		const projectKey = projectKeyFor(event.cwd);
		if (projectKey && config.disabledProjects.includes(projectKey)) return {};

		const scope: Scope = projectKey ? { project: projectKey } : "general";
		try {
			return { skillPaths: store.skillPaths(scope) };
		} catch {
			// An unencodable key must not take down resource discovery; the
			// session proceeds with general skills only rather than none.
			return { skillPaths: store.skillPaths("general") };
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!config.enabled) return;
		for (const warning of warnings) {
			ctx.ui.notify(warning, "warning");
		}
		try {
			store.ensureLayout();
			store.sweepStaging();
		} catch (error) {
			ctx.ui.notify(`rsi: store unavailable at ${config.storePath} (${error instanceof Error ? error.message : String(error)})`, "warning");
		}
	});
}
