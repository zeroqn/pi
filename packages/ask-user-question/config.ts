/**
 * Configuration for the questionnaire, read from pi's own config tree.
 *
 * `<agentDir>/extension-configs/ask-user-question/ask-user-question.jsonc` — the convention the other
 * pi extensions follow (`rsi/config.ts` is the pattern) — with two knobs:
 *
 *   collapseKey   the key that hides the dialog so the transcript underneath can be read; `"off"`
 *                 disables the shortcut entirely.
 *   guidance      overrides for the prose the model is given: the contributed description, its snippet
 *                 and its guidelines array.
 *
 * Upstream read its config through `@juicesharp/rpiv-config` (XDG-aware,
 * `~/.config/rpiv-ask-user-question/`). The port drops that dependency and owns the two things it
 * provided: this path resolution and a validator for `guidance`. Everything from `AskUserQuestionConfig`
 * down to `formatKeySpecForDisplay` is upstream's, unchanged — the key-spec grammar is load-bearing (a
 * loose check lets `ctr+]` silently match every bare `]` press), so it is not the port's to rewrite.
 *
 * Never throws: a missing file is a first run, and unreadable or malformed content is a warning plus the
 * default. A questionnaire that refuses to open over a stray comma is worse than one with a default key.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Key spec for the overlay collapse/expand shortcut, e.g. `"ctrl+]"` or `"alt+o"`. */
export type CollapseKeySpec = string;

export const DEFAULT_COLLAPSE_KEY: CollapseKeySpec = "ctrl+]";
export const COLLAPSE_KEY_OFF: CollapseKeySpec = "off";

/** The prose the model is given, overridable per field. */
export interface GuidanceFields {
	description?: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
}

export interface AskUserQuestionConfig {
	guidance?: GuidanceFields;
	/**
	 * Key spec for the collapse/expand shortcut, in the same format as pi-coding-agent keybinding ids
	 * (`modifier+key`, e.g. `ctrl+]`, `alt+o`, `ctrl+shift+h`). Defaults to `"ctrl+]"`. Set this to a key
	 * that is reachable on your keyboard layout — Latin American layouts (where `]` is on the shifted
	 * layer) often want `"ctrl+}"` instead. Pass `"off"` to disable the collapse shortcut entirely.
	 */
	collapseKey?: CollapseKeySpec;
}

export interface LoadedConfig {
	config: AskUserQuestionConfig;
	warnings: string[];
}

const CONFIG_DIR_NAME = "ask-user-question";
const CONFIG_FILE_NAME = "ask-user-question.jsonc";
const WARN_PREFIX = "ask-user-question:";

/** Path of the config file inside an agent directory. */
export function configPathFor(agentDir: string): string {
	return path.join(agentDir, "extension-configs", CONFIG_DIR_NAME, CONFIG_FILE_NAME);
}

/**
 * pi's own agent directory, with an environment override for tests and for a session that was launched
 * with one (`PI_CODING_AGENT_DIR`, the same variable pi itself honours).
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
 * Read the config, merging it over the defaults. Never throws.
 */
export function loadConfig(agentDirPath: string = agentDir()): LoadedConfig {
	const warnings: string[] = [];
	const config: AskUserQuestionConfig = {};
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
	if ("collapseKey" in source) {
		const value = source["collapseKey"];
		if (typeof value === "string") {
			config.collapseKey = value;
		} else {
			warnings.push(`${WARN_PREFIX} ignoring collapseKey (expected a string)`);
		}
	}
	if ("guidance" in source) {
		const guidance = validateGuidanceFields(source["guidance"]);
		if (Object.keys(guidance).length > 0) config.guidance = guidance;
		if (typeof source["guidance"] !== "object" || source["guidance"] === null) {
			warnings.push(`${WARN_PREFIX} ignoring guidance (expected an object)`);
		}
	}

	return { config, warnings };
}

/**
 * Keep the guidance fields that are the right shape and drop the rest, per field — a bad `description`
 * must not cost the guidelines their override. Upstream delegated this to `@juicesharp/rpiv-config`;
 * the port owns it because it owns the config.
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

// ---------------------------------------------------------------------------------------------
// Upstream, unchanged from here down.
// ---------------------------------------------------------------------------------------------

// Named keys accepted by pi-tui's `matchesKey` (keys.js switch on the parsed base key).
// parseKeyId lowercases the id before matching, so lowercase spellings are canonical.
const SPECIAL_KEYS = new Set([
	"escape",
	"esc",
	"enter",
	"return",
	"tab",
	"space",
	"backspace",
	"delete",
	"insert",
	"clear",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
	...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);

function isValidCollapseKeySpec(spec: string): boolean {
	// Mirror pi-tui's KeyId grammar strictly: zero or more distinct modifiers, then a
	// base key that is a single printable character or a named special key. A loose
	// check is not enough — pi-tui's `parseKeyId` takes the LAST `+`-part as the key
	// and ignores unknown parts, so a typo like `ctr+]` would silently match every
	// bare `]` keypress (and the raw terminal listener would consume them globally).
	if (!spec) return false;
	if (spec.startsWith("+") || spec.endsWith("+") || spec.includes("++")) return false;
	const parts = spec.split("+");
	const base = parts[parts.length - 1] ?? "";
	const modifiers = parts.slice(0, -1);
	if (modifiers.length !== new Set(modifiers).size) return false;
	if (!modifiers.every((m) => MODIFIERS.has(m))) return false;
	return base.length === 1 ? /[a-z0-9_\-!@#$%^&*()|~`'":;,./<>?[\]{}=\\]/.test(base) : SPECIAL_KEYS.has(base);
}

export function resolveCollapseKey(config: Pick<AskUserQuestionConfig, "collapseKey">): CollapseKeySpec {
	const raw = config.collapseKey?.trim().toLowerCase();
	if (raw === undefined || raw === "") return DEFAULT_COLLAPSE_KEY;
	if (raw === COLLAPSE_KEY_OFF) return COLLAPSE_KEY_OFF;
	return isValidCollapseKeySpec(raw) ? raw : DEFAULT_COLLAPSE_KEY;
}

// The only compound-word names in SPECIAL_KEYS — first-letter capitalization
// alone would render them "Pageup"/"Pagedown".
const COMPOUND_KEY_DISPLAY: Record<string, string> = {
	pageup: "PageUp",
	pagedown: "PageDown",
};

/**
 * Pretty-print a resolved key spec for UI copy: each `+`-part gets its first
 * character uppercased (`"ctrl+]"` → `"Ctrl+]"`, `"alt+o"` → `"Alt+O"`,
 * `"f9"` → `"F9"`, `"ctrl+pagedown"` → `"Ctrl+PageDown"`). Display-only — key
 * matching always uses the raw lowercase spec (`matchesKey` lowercases ids),
 * so never feed the result back into it.
 */
export function formatKeySpecForDisplay(spec: CollapseKeySpec): string {
	return spec
		.split("+")
		.map(
			(part) =>
				COMPOUND_KEY_DISPLAY[part] ??
				(part.length <= 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)),
		)
		.join("+");
}

/**
 * JSON with comments and trailing commas → JSON. String-aware, so `//` and `,}` inside a string survive.
 * Copied from `rsi/config.ts`, which is the other package reading a `.jsonc` out of pi's tree.
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
