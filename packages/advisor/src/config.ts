/**
 * config — the advisor's persisted selection, read from pi's own config tree.
 *
 * `<agentDir>/extension-configs/advisor/advisor.jsonc` — the convention the other pi-native extensions
 * follow (`rsi/config.ts`, `packages/ask-user-question/config.ts`) — with four keys:
 *
 *   modelKey            the reviewer, `"<provider>/<modelId>"` (the colon form is still read, and is
 *                       rewritten to the slash form by the next save)
 *   effort              the reasoning level sent as `reasoning`; absent means the model's default
 *   guidance            overrides for the prose the model is given — the contributed description, its
 *                       snippet and its guidelines array
 *   disabledForModels   the blocklist the mount-time gate owns: a model key, or
 *                       `{model, minEffort}` meaning "blocked at this executor level and above"
 *
 * Upstream read all of this through `@juicesharp/rpiv-config` (XDG-aware, `~/.config/rpiv-advisor/`). The
 * port drops that dependency and owns the three things it provided: the path, the JSON-with-comments
 * reader, and the `modelKey`/`parseModelKey` codec. What it keeps verbatim is the **write semantics**,
 * because a hand-edited file depends on them: `/advisor` rewrites only `modelKey` and `effort`, a cleared
 * field is deleted rather than written as `null`, and the file is created `0600`.
 *
 * Never throws: a missing file is a first run, and malformed content is a warning plus the default — with
 * the warnings reported through the host-bridge seam's `problems`, so a broken knob is loud in the
 * session record rather than swallowed.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { EFFORT_ORDINAL, type GradedEffort } from "./messages.ts";

/** One blocked executor: a bare model key, or a model key with a level threshold. */
export type DisabledForModelsEntry = string | { model: string; minEffort?: GradedEffort };

/** The prose the model is given, overridable per field. Same three fields as the contribution carries. */
export interface GuidanceFields {
	description?: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
}

export interface AdvisorConfig {
	modelKey?: string;
	effort?: GradedEffort;
	guidance?: GuidanceFields;
	disabledForModels?: DisabledForModelsEntry[];
}

export interface LoadedConfig {
	config: AdvisorConfig;
	warnings: string[];
}

const CONFIG_DIR_NAME = "advisor";
const CONFIG_FILE_NAME = "advisor.jsonc";
const WARN_PREFIX = "advisor:";
/** User read/write only — upstream's mode, kept because the file names a model and a token budget. */
const CONFIG_FILE_MODE = 0o600;

/** Path of the config file inside an agent directory. */
export function configPathFor(agentDirPath: string): string {
	return path.join(agentDirPath, "extension-configs", CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

/**
 * pi's own agent directory, with an environment override for tests and for a session launched with one
 * (`PI_CODING_AGENT_DIR`, the same variable pi itself honours).
 */
export function agentDir(): string {
	const override = process.env["PI_CODING_AGENT_DIR"]?.trim();
	if (override) return override;
	try {
		return getAgentDir();
	} catch {
		return path.join(os.homedir(), ".pi", "agent");
	}
}

/**
 * The codec. Slash is canonical; the colon form is still *read* — upstream persisted `provider:id` before
 * its migration, and a hand-edited file may hold either. Slash wins when both appear, so a key like
 * `provider:foo/bar` splits at the slash rather than re-introducing the legacy reading.
 */
export function modelKey(m: { provider: string; id: string }): string {
	return `${m.provider}/${m.id}`;
}

export function parseModelKey(key: string): { provider: string; modelId: string } | undefined {
	const slashIdx = key.indexOf("/");
	if (slashIdx >= 1) return { provider: key.slice(0, slashIdx), modelId: key.slice(slashIdx + 1) };
	const colonIdx = key.indexOf(":");
	if (colonIdx >= 1) return { provider: key.slice(0, colonIdx), modelId: key.slice(colonIdx + 1) };
	return undefined;
}

/**
 * Keep the guidance fields that are the right shape and drop the rest, per field — a bad `description`
 * must not cost the guidelines their override. Upstream delegated this to `@juicesharp/rpiv-config`.
 */
export function validateGuidanceFields(guidance: unknown): GuidanceFields {
	if (typeof guidance !== "object" || guidance === null || Array.isArray(guidance)) return {};
	const source = guidance as Record<string, unknown>;
	const out: GuidanceFields = {};
	const description = source["description"];
	if (typeof description === "string" && description.trim().length > 0) out.description = description;
	const snippet = source["promptSnippet"];
	if (typeof snippet === "string" && snippet.trim().length > 0) out.promptSnippet = snippet;
	const guidelines = source["promptGuidelines"];
	if (Array.isArray(guidelines)) {
		const lines = guidelines.filter((line): line is string => typeof line === "string" && line.trim().length > 0);
		if (lines.length > 0) out.promptGuidelines = lines;
	}
	return out;
}

/**
 * Keep the blocklist entries that can be ranked, and warn about the ones that cannot.
 *
 * A bad `minEffort` discards the entry's model identity with it (upstream's posture, warning included)
 * because a threshold the ordinal cannot rank would otherwise block every level or none.
 */
export function validateDisabledForModels(value: unknown, warnings: string[] = []): DisabledForModelsEntry[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is DisabledForModelsEntry => {
		if (typeof entry === "string") return entry.length > 0;
		if (typeof entry !== "object" || entry === null) return false;
		const obj = entry as Record<string, unknown>;
		if (typeof obj.model !== "string" || obj.model.length === 0) return false;
		if (obj.minEffort !== undefined && !EFFORT_ORDINAL.includes(obj.minEffort as GradedEffort)) {
			warnings.push(
				`${WARN_PREFIX} ignoring disabledForModels entry for "${obj.model}" (unknown minEffort "${String(obj.minEffort)}"; valid: ${EFFORT_ORDINAL.join(", ")})`,
			);
			return false;
		}
		return true;
	});
}

/** Read the config. Never throws; a malformed file is a warning and the defaults. */
export function loadConfig(agentDirPath: string = agentDir()): LoadedConfig {
	const warnings: string[] = [];
	const config: AdvisorConfig = {};
	const file = configPathFor(agentDirPath);

	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch {
		return { config, warnings }; // a missing file is a first run, not a problem
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(stripJsonc(raw));
	} catch (error) {
		warnings.push(
			`${WARN_PREFIX} ignoring ${file} (invalid JSONC: ${error instanceof Error ? error.message : String(error)})`,
		);
		return { config, warnings };
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		warnings.push(`${WARN_PREFIX} ignoring ${file} (expected a JSON object)`);
		return { config, warnings };
	}

	const source = parsed as Record<string, unknown>;
	if ("modelKey" in source) {
		const value = source["modelKey"];
		if (typeof value === "string" && value.trim().length > 0) config.modelKey = value.trim();
		else warnings.push(`${WARN_PREFIX} ignoring modelKey (expected a non-empty string)`);
	}
	if ("effort" in source) {
		const value = source["effort"];
		if (value === undefined || value === null) {
			// "model present, effort absent" is a first-class persisted state, not a fault
		} else if (EFFORT_ORDINAL.includes(value as GradedEffort)) {
			config.effort = value as GradedEffort;
		} else {
			warnings.push(
				`${WARN_PREFIX} ignoring effort "${String(value)}" (valid: ${EFFORT_ORDINAL.join(", ")}; omit the key to use the model default)`,
			);
		}
	}
	if ("guidance" in source) {
		const guidance = validateGuidanceFields(source["guidance"]);
		if (Object.keys(guidance).length > 0) config.guidance = guidance;
		if (typeof source["guidance"] !== "object" || source["guidance"] === null) {
			warnings.push(`${WARN_PREFIX} ignoring guidance (expected an object)`);
		}
	}
	if ("disabledForModels" in source) {
		const entries = validateDisabledForModels(source["disabledForModels"], warnings);
		if (entries.length > 0) config.disabledForModels = entries;
		if (!Array.isArray(source["disabledForModels"])) {
			warnings.push(`${WARN_PREFIX} ignoring disabledForModels (expected an array)`);
		}
	}

	return { config, warnings };
}

/**
 * Persist a selection over whatever the file already holds.
 *
 * `delete` rather than `undefined` for a cleared field: the spread above carries the previous read, and
 * `JSON.stringify` drops `undefined` values anyway — but a `null` would round-trip into a *present*
 * key, which is exactly the state this avoids.
 */
export function saveAdvisorConfig(
	key: string | undefined,
	effort: GradedEffort | undefined,
	agentDirPath: string = agentDir(),
): boolean {
	const file = configPathFor(agentDirPath);
	const existing = loadConfig(agentDirPath).config;
	const config: AdvisorConfig = { ...existing };
	if (key) config.modelKey = key;
	else delete config.modelKey;
	if (effort) config.effort = effort;
	else delete config.effort;
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	} catch {
		return false;
	}
	try {
		fs.chmodSync(file, CONFIG_FILE_MODE);
	} catch {
		// Some filesystems ignore chmod; there is no portable way to enforce 0600. Best effort only.
	}
	return true;
}

/**
 * JSON with comments and trailing commas → JSON. String-aware, so `//` and `,}` inside a string survive.
 * Copied from `packages/ask-user-question/config.ts`, which is the other package reading a `.jsonc` out
 * of pi's tree.
 */
export function stripJsonc(text: string): string {
	let out = "";
	let inString = false;
	let pendingComma = false;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];

		if (inString) {
			out += ch;
			if (ch === "\\") {
				out += text[i + 1] ?? "";
				i++;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}

		if (pendingComma) {
			if (ch === "}" || ch === "]") {
				pendingComma = false;
				out += ch;
				continue;
			}
			if (/\s/.test(ch)) continue;
			out += ",";
			pendingComma = false;
		}

		if (ch === '"') {
			inString = true;
			out += ch;
			continue;
		}

		if (ch === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			out += "\n";
			continue;
		}

		if (ch === "/" && text[i + 1] === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
			i++;
			continue;
		}

		if (ch === ",") {
			pendingComma = true;
			continue;
		}

		out += ch;
	}

	return out;
}
