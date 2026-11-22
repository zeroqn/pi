/**
 * The spawn-time record (`.scratch/child-record/`): who this session spawned, and where the child's
 * own transcript is.
 *
 * A child is an in-process `AgentSession` and its record lives in an in-memory `Map` (`children.ts`),
 * so both die with the pi process. Measured 2026-11-22 (`.scratch/kernel-rebuild/`): a session restarted
 * after a spawn resumed with an empty `rlm.list()` and no way to name — let alone read — the child it
 * had delegated to, even though the child's transcript was still on disk.
 *
 * The entry is written by the **spawner**, into its own transcript, at the one moment the facts exist
 * (the child's session file is known only after pi answers with the session). It is the durable half of
 * a record whose live half cannot be restored: the resumed session rehydrates each entry as a `gone`
 * child — nameable, readable, never resumeable.
 */
export const SPAWN_ENTRY_TYPE = "rlm-spawn";

export interface SpawnRecord {
	child_id: string;
	name: string;
	/** The child's own transcript — the pointer a resumed session needs. */
	session_file: string | null;
	model: string | null;
	depth: number;
	/** When the child was admitted; also the last time anything about it was certainly true. */
	at: string;
	/** The child's **direct** spawner: a grandchild's entry is filed here too, with the edge it needs. */
	parent_session_file: string | null;
}

/** Write one record, and never fail a spawn over it (`rlm-stop` ticket 05's rule for entries). */
export function appendSpawnRecord(
	write: ((customType: string, data: unknown) => void) | undefined,
	record: SpawnRecord,
): void {
	try {
		write?.(SPAWN_ENTRY_TYPE, record);
	} catch {
		/* a missing writer costs the record, never the child */
	}
}

function isRecord(data: any): data is SpawnRecord {
	return (
		typeof data?.child_id === "string" &&
		data.child_id.length > 0 &&
		typeof data?.name === "string" &&
		data.name.length > 0 &&
		typeof data?.depth === "number"
	);
}

/**
 * Every spawn record in a transcript, oldest first. A malformed or half-written entry is skipped rather
 * than refusing the rest: one torn line must not cost every child the session spawned.
 */
export function readSpawnRecords(entries: unknown[]): SpawnRecord[] {
	const out: SpawnRecord[] = [];
	for (const entry of entries as Array<{ type?: string; customType?: string; data?: any }>) {
		if (entry?.type !== "custom" || entry.customType !== SPAWN_ENTRY_TYPE) continue;
		if (!isRecord(entry.data)) continue;
		out.push({
			child_id: entry.data.child_id,
			name: entry.data.name,
			session_file: typeof entry.data.session_file === "string" ? entry.data.session_file : null,
			model: typeof entry.data.model === "string" ? entry.data.model : null,
			depth: entry.data.depth,
			at: typeof entry.data.at === "string" ? entry.data.at : "",
			parent_session_file: typeof entry.data.parent_session_file === "string" ? entry.data.parent_session_file : null,
		});
	}
	return out;
}

/** The same reader, straight from a `sessionManager` (the shape `readChildProvenance` takes). */
export function readSpawnRecordsFrom(sessionManager: any): SpawnRecord[] {
	try {
		const entries: unknown[] = sessionManager?.getEntries?.() ?? [];
		return readSpawnRecords(entries);
	} catch {
		/* an unreadable transcript names no earlier child */
	}
	return [];
}
