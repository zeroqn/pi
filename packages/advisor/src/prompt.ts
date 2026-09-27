/**
 * prompt — the reviewer's system prompt, read once at module load from `prompts/advisor-system.txt`.
 *
 * The URL is anchored one level up (`../prompts/`) because this module sits in `src/` while the asset
 * ships at the package root. ESM-safe and cache-stable: the reviewer's system prompt is the first thing a
 * provider's prompt cache covers, so it must not vary per call.
 *
 * Ticket 05 reworded one sentence of it: its `## Available Executor Surface` block replaces upstream's
 * `pi.getAllTools()` dump, so the prompt says host *surface* rather than tool inventory.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ADVISOR_SYSTEM_PROMPT = readFileSync(
	fileURLToPath(new URL("../prompts/advisor-system.txt", import.meta.url)),
	"utf-8",
).trimEnd();
