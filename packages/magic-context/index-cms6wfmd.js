import {
  withMessageFtsSessionFilter
} from "./index-1cvyaw9a.js";
import {
  estimateTokens
} from "./index-my0dn413.js";
import {
  readRawSessionMessageIdOrdinalsForRange2
} from "./index-cm9e52mb.js";

// ../plugin/src/tools/ctx-expand/search-archive.ts
var archiveReadsOnThisThread = 0;
function renderSearchArchive2(db, sessionId, start, end, tokenBudget, archiveOnly = false, readRawIds = () => readRawSessionMessageIdOrdinalsForRange2(sessionId, start, end)) {
  archiveReadsOnThisThread += 1;
  return withMessageFtsSessionFilter(db, sessionId, (sessionFirst) => {
    let rawIds;
    const rows = db.prepare(sessionFirst ? `SELECT f.message_ordinal AS ordinal, f.message_id AS id, f.role, f.content
                   FROM message_fts_rowid_map AS m
                   JOIN message_history_fts AS f ON f.rowid = m.fts_rowid
                   WHERE m.session_id = ?1 AND m.message_ordinal BETWEEN ?2 AND ?3
                     AND f.session_id = ?1 AND f.message_ordinal BETWEEN ?2 AND ?3
                   ORDER BY m.message_ordinal` : `SELECT message_ordinal AS ordinal, message_id AS id, role, content
                   FROM message_history_fts
                   WHERE session_id = ?1 AND message_ordinal BETWEEN ?2 AND ?3
                   ORDER BY CAST(message_ordinal AS INTEGER)`);
    const blocks = [];
    let tokens = 0;
    let lastOrdinal = start - 1;
    let truncated = false;
    for (const row of rows.iterate(sessionId, start, end)) {
      if (!row.content)
        continue;
      if (!archiveOnly) {
        rawIds ??= readRawIds();
        if (rawIds.get(row.id) === row.ordinal)
          continue;
      }
      const block = `[${row.ordinal}] ${row.role === "user" ? "U" : "A"}: ${row.content}`;
      const cost = estimateTokens(block);
      if (blocks.length > 0 && tokens + cost > tokenBudget) {
        truncated = true;
        break;
      }
      blocks.push(block);
      tokens += cost;
      lastOrdinal = row.ordinal;
    }
    if (blocks.length === 0)
      return null;
    const text = [
      "From the search archive: indexed text only; no surrounding messages or tool output.",
      "",
      ...blocks
    ];
    if (truncated) {
      text.push("", `Truncated at message ${lastOrdinal} (budget: ~${tokenBudget} tokens). Call ctx_expand(start=${lastOrdinal + 1}, end=${end}) for more archived text.`);
    }
    return text.join(`
`);
  });
}
export { renderSearchArchive2 };
