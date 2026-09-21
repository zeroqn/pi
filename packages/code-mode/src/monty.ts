/** Loading the monty napi addon inside a compiled Bun binary, and the client's version.

Code mode owns this because it owns monty (code-mode map ticket 03): rlm imports nothing
from here, and after the split it holds no monty type at all (ticket 07).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type * as MontyModule from "@pydantic/monty/node";

const HERE = dirname(fileURLToPath(import.meta.url));

// Loading the napi addon inside a compiled Bun binary
// ---------------------------------------------------------------------------

/** Find the platform package's `.node` without using a resolver that cannot see disk. */
export function findBinding(startDir: string): string | null {
	let dir = startDir;
	for (let hop = 0; hop < 8; hop++) {
		const scope = join(dir, "node_modules", "@pydantic");
		if (existsSync(scope)) {
			for (const entry of readdirSync(scope)) {
				if (!entry.startsWith("monty-")) continue;
				const packageDir = join(scope, entry);
				for (const file of readdirSync(packageDir)) {
					if (file.endsWith(".node")) return join(packageDir, file);
				}
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

let montyModule: typeof MontyModule | null = null;

/** The installed client's version, or null when it cannot be read. */
export function clientVersion(): string | null {
	let dir = HERE;
	for (let hop = 0; hop < 8; hop++) {
		const candidate = join(dir, "node_modules", "@pydantic", "monty", "package.json");
		if (existsSync(candidate)) {
			try {
				const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
				return parsed.version ?? null;
			} catch {
				return null;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

export async function loadMonty(): Promise<typeof MontyModule> {
	if (montyModule) return montyModule;
	const previous = process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
	const binding = findBinding(HERE);
	if (binding) process.env.NAPI_RS_NATIVE_LIBRARY_PATH = binding;
	try {
		// Must be dynamic: the loading assignment has to happen before the addon loads.
		const loaded: typeof MontyModule = await import("@pydantic/monty/node");
		montyModule = loaded;
	} finally {
		if (previous === undefined) delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
		else process.env.NAPI_RS_NATIVE_LIBRARY_PATH = previous;
	}
	return montyModule;
}
