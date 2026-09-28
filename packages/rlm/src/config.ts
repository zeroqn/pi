/**
 * `rlm.json` — the operator's say over what the environment is allowed to change.
 *
 * `RLM_CHILD_PROMPT` is the one environment variable rlm reads, and it decides what a delegated
 * child is *told* (see `childPromptFor`). An environment variable is inherited by whatever launched
 * pi and leaves no trace in a transcript, so it is honored only when a config file says so:
 *
 *   { "allowEnvironmentOverrides": true }
 *
 * Anything else — no file, no key, a non-boolean, `false` — means **off**, which is the default. An
 * override that is off is announced at session start rather than silently ignored, and its value is
 * never honored.
 *
 * Two files, global then project, so the project wins: `<agent dir>/rlm.json`, i.e.
 * `~/.pi/agent/rlm.json` (`PI_CODING_AGENT_DIR` wins — the same override pi itself honors), and
 * `<cwd>/.pi/rlm.json`. The project file is read only for a **trusted** project: it can loosen a
 * posture, and pi's own trust decision is what says whose `.pi` this is.
 *
 * `getAgentDir` and `CONFIG_DIR_NAME` exist in pi's SDK and are deliberately not imported: an
 * extension must not bundle pi (children.ts loads the host module by a variable specifier for the
 * same reason), so the two paths are spelled out here. rsi and ask-user-question keep their configs
 * under `<agent dir>/extension-configs/<name>/`; this one stays flat, beside zvec-grep's.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The file's name in either directory. */
export const RLM_CONFIG_FILE = "rlm.json";

/** pi's project-local config directory — the SDK's `CONFIG_DIR_NAME`. */
const PROJECT_CONFIG_DIR = ".pi";

export type RlmConfig = {
	/** When true, the environment may change rlm's behavior: `RLM_CHILD_PROMPT` takes effect. */
	allowEnvironmentOverrides: boolean;
};

/** pi's agent directory: the environment override first, then pi's own default. Never throws. */
export function agentDir(): string {
	const override = process.env["PI_CODING_AGENT_DIR"]?.trim();
	return override || join(homedir(), ".pi", "agent");
}

/** What one file says, or `undefined` when it says nothing usable — a missing file is not a problem. */
function allowFromFile(path: string): boolean | undefined {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
		const value = (parsed as Record<string, unknown>)["allowEnvironmentOverrides"];
		return typeof value === "boolean" ? value : undefined;
	} catch {
		// A stray comma costs the default, never a session.
		return undefined;
	}
}

/**
 * The config this session runs under: the project's answer when there is a trusted project, else the
 * global one, else off.
 */
export function loadRlmConfig(input: { cwd?: string; agentDir?: string; projectTrusted?: boolean } = {}): RlmConfig {
	const global = allowFromFile(join(input.agentDir ?? agentDir(), RLM_CONFIG_FILE));
	const project =
		input.projectTrusted && input.cwd ? allowFromFile(join(input.cwd, PROJECT_CONFIG_DIR, RLM_CONFIG_FILE)) : undefined;
	return { allowEnvironmentOverrides: project ?? global ?? false };
}
