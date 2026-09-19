/**
 * Configuration for the RSI extension.
 *
 * Config lives at `<agentDir>/extension-configs/rsi/rsi.jsonc`, matching the
 * convention the other pi extensions use. It is JSON with comments and trailing
 * commas; only the knobs below are read, and an unreadable or invalid value is
 * reported as a warning and falls back to its default rather than failing the
 * extension.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { expandTilde } from "./paths.ts";

export interface RsiConfig {
	enabled: boolean;
	observeOnly: boolean;
	quietMinutes: number;
	/**
	 * How long a quiet period is for a **child** session, which lives for one delegated task
	 * rather than an interactive session (RSI x RLM ticket 13). Shorter by default, because a
	 * five-minute wait would usually outlive the child.
	 */
	childQuietMinutes: number;
	/** How often **this session** may run a learner pass (RSI x RLM ticket 12). */
	minIntervalMinutes: number;
	/**
	 * How often **any** session may run a learner pass — the tree-wide floor. Bounds how fast a
	 * tree of independent learners can fork reviewers; set below `minIntervalMinutes` because it
	 * is a rate limit rather than a per-session interval.
	 */
	treeFloorMinutes: number;
	stageCeilingMinutes: number;
	disuseWeeks: number;
	consolidateEveryWeeks: number;
	maxActiveSkills: number;
	reviewModel?: string;
	curatorModel?: string;
	thinking?: string;
	disabledProjects: string[];
	storePath: string;
}

export interface LoadedConfig {
	config: RsiConfig;
	warnings: string[];
}

/** Path of the RSI config file inside an agent directory. */
export function configPathFor(agentDir: string): string {
	return path.join(agentDir, "extension-configs", "rsi", "rsi.jsonc");
}

/** Default store location inside an agent directory. */
export function defaultStorePath(agentDir: string): string {
	return path.join(agentDir, "rsi");
}

/**
 * Read the config, merging it over the defaults. Never throws: a missing file
 * is a first run, and bad content produces a warning plus the default.
 */
export function loadConfig(options: { agentDir: string; file?: string }): LoadedConfig {
	const warnings: string[] = [];
	const config: RsiConfig = {
		enabled: true,
		observeOnly: true,
		quietMinutes: 5,
		childQuietMinutes: 1,
		minIntervalMinutes: 15,
		treeFloorMinutes: 2,
		stageCeilingMinutes: 10,
		disuseWeeks: 6,
		consolidateEveryWeeks: 4,
		maxActiveSkills: 25,
		disabledProjects: [],
		storePath: defaultStorePath(options.agentDir),
	};

	const file = options.file ?? configPathFor(options.agentDir);
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch {
		return { config, warnings };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(stripJsonc(raw));
	} catch (error) {
		warnings.push(`rsi: ignoring ${file} (invalid JSONC: ${error instanceof Error ? error.message : String(error)})`);
		return { config, warnings };
	}
	if (!isPlainObject(parsed)) {
		warnings.push(`rsi: ignoring ${file} (expected a JSON object)`);
		return { config, warnings };
	}

	readBoolean(parsed, "enabled", config, warnings);
	readBoolean(parsed, "observeOnly", config, warnings);
	readPositiveNumber(parsed, "quietMinutes", config, warnings);
	readPositiveNumber(parsed, "minIntervalMinutes", config, warnings);
	readPositiveNumber(parsed, "stageCeilingMinutes", config, warnings);
	readPositiveNumber(parsed, "disuseWeeks", config, warnings);
	readPositiveNumber(parsed, "consolidateEveryWeeks", config, warnings);
	readPositiveNumber(parsed, "maxActiveSkills", config, warnings);
	readString(parsed, "reviewModel", config, warnings);
	readString(parsed, "curatorModel", config, warnings);
	readString(parsed, "thinking", config, warnings);
	readStringArray(parsed, "disabledProjects", config, warnings);

	if ("storePath" in parsed) {
		const value = parsed.storePath;
		if (typeof value === "string" && value.trim().length > 0) {
			const expanded = expandTilde(value.trim());
			if (path.isAbsolute(expanded)) {
				config.storePath = expanded;
			} else {
				warnings.push(`rsi: ignoring storePath "${value}" (must be absolute)`);
			}
		} else {
			warnings.push(`rsi: ignoring storePath (expected a string)`);
		}
	}

	return { config, warnings };
}

type BooleanConfigKey = "enabled" | "observeOnly";
type NumberConfigKey =
	| "quietMinutes"
	| "childQuietMinutes"
	| "minIntervalMinutes"
	| "treeFloorMinutes"
	| "stageCeilingMinutes"
	| "disuseWeeks"
	| "consolidateEveryWeeks"
	| "maxActiveSkills";
type StringConfigKey = "reviewModel" | "curatorModel" | "thinking";

/**
 * Merge a patch into the config file and write it back atomically. Comments and
 * formatting are not preserved: the file is rewritten as plain JSON, which the
 * JSONC reader and every other pi config reader accept.
 */
export function saveConfig(options: { agentDir: string; file?: string }, patch: Record<string, unknown>): { ok: boolean; warning?: string } {
	const file = options.file ?? configPathFor(options.agentDir);

	let current: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(stripJsonc(fs.readFileSync(file, "utf8")));
		if (isPlainObject(parsed)) current = parsed;
	} catch {
		// Missing or malformed config is replaced rather than propagated.
	}

	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const temp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(temp, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`);
		fs.renameSync(temp, file);
	} catch (error) {
		return { ok: false, warning: `rsi: could not write ${file} (${error instanceof Error ? error.message : String(error)})` };
	}
	return { ok: true };
}

function readBoolean(source: Record<string, unknown>, key: BooleanConfigKey, config: RsiConfig, warnings: string[]): void {
	if (!(key in source)) return;
	const value = source[key];
	if (typeof value === "boolean") {
		config[key] = value;
	} else {
		warnings.push(`rsi: ignoring ${key} (expected a boolean)`);
	}
}

function readPositiveNumber(source: Record<string, unknown>, key: NumberConfigKey, config: RsiConfig, warnings: string[]): void {
	if (!(key in source)) return;
	const value = source[key];
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		config[key] = value;
	} else {
		warnings.push(`rsi: ignoring ${key} (expected a positive number)`);
	}
}

function readString(source: Record<string, unknown>, key: StringConfigKey, config: RsiConfig, warnings: string[]): void {
	if (!(key in source)) return;
	const value = source[key];
	if (typeof value === "string" && value.trim().length > 0) {
		config[key] = value.trim();
	} else {
		warnings.push(`rsi: ignoring ${key} (expected a non-empty string)`);
	}
}

function readStringArray(source: Record<string, unknown>, key: "disabledProjects", config: RsiConfig, warnings: string[]): void {
	if (!(key in source)) return;
	const value = source[key];
	if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
		config[key] = [...value];
	} else {
		warnings.push(`rsi: ignoring ${key} (expected an array of strings)`);
	}
}

/**
 * Strip `//` and `/* *\/` comments and trailing commas from JSONC. String
 * literals are tracked so comment and comma syntax inside a value is left
 * alone; whitespace after a comma that is followed by `}` or `]` is dropped
 * along with the comma.
 */
function stripJsonc(text: string): string {
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
		if (ch === ",") {
			pendingComma = true;
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
		out += ch;
	}

	return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
