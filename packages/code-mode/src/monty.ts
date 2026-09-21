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

/**
 * Find the platform package's `.node` without using a resolver that cannot see disk.
 *
 * This matters because the compiled pi binary's runtime resolver does not reach an on-disk
 * dependency the way bun's development resolver does, and when it fails the addon reports
 * only "Cannot find native binding". Two layouts have to be searched, both ordinary in a
 * bun workspace: the hoisted one (`<dir>/node_modules/@pydantic/monty-*`) and bun's store
 * (`<dir>/node_modules/.bun/@pydantic+monty-*\/node_modules/@pydantic/monty-*`).
 */
export function findBinding(startDir: string): string | null {
	const inScope = (scope: string): string | null => {
		if (!existsSync(scope)) return null;
		for (const entry of readdirSync(scope)) {
			if (!entry.startsWith("monty-")) continue;
			const packageDir = join(scope, entry);
			for (const file of readdirSync(packageDir)) {
				if (file.endsWith(".node")) return join(packageDir, file);
			}
		}
		return null;
	};
	const inStore = (store: string): string | null => {
		if (!existsSync(store)) return null;
		for (const entry of readdirSync(store)) {
			if (!entry.startsWith("@pydantic+monty-")) continue;
			const found = inScope(join(store, entry, "node_modules", "@pydantic"));
			if (found) return found;
		}
		return null;
	};
	let dir = startDir;
	for (let hop = 0; hop < 8; hop++) {
		const hoisted = inScope(join(dir, "node_modules", "@pydantic"));
		if (hoisted) return hoisted;
		const stored = inStore(join(dir, "node_modules", ".bun"));
		if (stored) return stored;
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
