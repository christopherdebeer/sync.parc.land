/**
 * schema-v8.ts — Two Primitives: state + log.
 *
 * v8 unifies actions, views, and agents into state with reserved scope prefixes.
 * The log (formerly _audit) becomes a first-class table with a key-based index.
 *
 * This migration is additive: existing tables are untouched. The compatibility
 * layer in context assembly reads from scope-based entries when present, falls
 * back to legacy tables when absent. Rooms migrate incrementally.
 *
 * New tables:
 *   log_index — key-based index into the audit trail, enabling:
 *     - "what happened to key X?" queries (temporal projection)
 *     - provenance tracing (which agent/action wrote key X?)
 *     - dependency-scoped replay (only replay entries touching keys a view depends on)
 *
 * New scope conventions (data in existing `state` table):
 *   _actions.{id}  — action definitions (replaces `actions` table)
 *   _views.{id}    — view definitions (replaces `views` table)
 *   _agents.{id}   — agent presence (replaces semantic cols in `agents` table)
 *   _config.{key}  — room configuration (replaces _shared._dashboard, etc.)
 */

import { sqlite } from "https://esm.town/v/std/sqlite";

export async function migrateV8() {
  // ── Log index table ──────────────────────────────────────────────────
  // Maps (room, scope, key) → list of audit sequence numbers that affected that key.
  // Populated on every audit/log append. Enables key-level temporal queries.
  await sqlite.execute({
    sql: `CREATE TABLE IF NOT EXISTS log_index (
      room_id TEXT NOT NULL,
      seq     INTEGER NOT NULL,
      scope   TEXT NOT NULL,
      key     TEXT NOT NULL,
      UNIQUE(room_id, seq, scope, key)
    )`,
    args: [],
  });

  const indexes = [
    // Primary lookup: "what happened to this key?"
    `CREATE INDEX IF NOT EXISTS idx_li_key ON log_index(room_id, scope, key, seq)`,
    // Secondary: "what keys were affected at this seq?"
    `CREATE INDEX IF NOT EXISTS idx_li_seq ON log_index(room_id, seq)`,
    // Prefix queries: "all events touching _shared.concepts.*"
    `CREATE INDEX IF NOT EXISTS idx_li_scope ON log_index(room_id, scope)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_li_uniq ON log_index(room_id, seq, scope, key)`,
  ];
  for (const sql of indexes) {
    try { await sqlite.execute({ sql, args: [] }); } catch (_) {}
  }

  // ── Deduplicate log_index (needed if backfill ran before unique index) ──
  try {
    await sqlite.execute({
      sql: `DELETE FROM log_index WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM log_index GROUP BY room_id, seq, scope, key
      )`,
      args: [],
    });
  } catch { /* best-effort */ }

  // ── Backfill log_index from existing _audit entries ──────────────────
  // Walk existing audit entries and populate the index for rooms that
  // already have history. This is idempotent — INSERT OR IGNORE.
  try {
    const auditRows = await sqlite.execute({
      sql: `SELECT room_id, sort_key, value FROM state WHERE scope = '_audit' ORDER BY room_id, sort_key ASC`,
      args: [],
    });

    const batch: { sql: string; args: any[] }[] = [];
    for (const row of auditRows.rows) {
      const [roomId, seq, rawValue] = row;
      try {
        const entry = JSON.parse(rawValue as string);
        const writes: Array<{ scope: string; key: string }> = entry.effect?.writes ?? [];

        // For structural events, index the target entity
        if (entry.kind === "register_action" || entry.kind === "register_view" ||
            entry.kind === "delete_action" || entry.kind === "delete_view") {
          const schema = entry.schema ?? {};
          if (schema.id) {
            const scope = entry.kind.includes("action") ? "_actions" : "_views";
            batch.push({
              sql: `INSERT OR IGNORE INTO log_index (room_id, seq, scope, key) VALUES (?, ?, ?, ?)`,
              args: [roomId, seq, scope, schema.id],
            });
          }
        }

        // For invocations, index each affected key
        for (const w of writes) {
          if (w.scope && w.key) {
            batch.push({
              sql: `INSERT OR IGNORE INTO log_index (room_id, seq, scope, key) VALUES (?, ?, ?, ?)`,
              args: [roomId, seq, w.scope, w.key],
            });
          }
        }

        // For agent events, index the agent
        if (entry.kind === "agent_join" || entry.kind === "agent_update") {
          const schema = entry.schema ?? {};
          if (schema.id) {
            batch.push({
              sql: `INSERT OR IGNORE INTO log_index (room_id, seq, scope, key) VALUES (?, ?, ?, ?)`,
              args: [roomId, seq, "_agents", schema.id],
            });
          }
        }
      } catch { /* malformed entry, skip */ }
    }

    // Execute in chunks to avoid enormous batch sizes
    const CHUNK = 200;
    for (let i = 0; i < batch.length; i += CHUNK) {
      await sqlite.batch(batch.slice(i, i + CHUNK));
    }
  } catch (e) {
    console.error("[v8 migration] backfill error (non-fatal):", e);
  }
}

/**
 * Append to the log index. Called from audit.ts on every log entry.
 * Fire-and-forget, never throws.
 */
export async function indexLogEntry(
  roomId: string,
  seq: number,
  affectedKeys: Array<{ scope: string; key: string }>,
) {
  if (affectedKeys.length === 0) return;
  try {
    const batch = affectedKeys.map(({ scope, key }) => ({
      sql: `INSERT OR IGNORE INTO log_index (room_id, seq, scope, key) VALUES (?, ?, ?, ?)`,
      args: [roomId, seq, scope, key] as any[],
    }));
    await sqlite.batch(batch);
  } catch { /* fire and forget */ }
}

/**
 * Query key history from the log index.
 * Returns audit entries that affected the given key, ordered chronologically.
 */
export async function queryKeyHistory(
  roomId: string,
  scope: string,
  key: string,
  opts: { limit?: number; after?: number } = {},
): Promise<Array<{ seq: number; entry: any }>> {
  const limit = opts.limit ?? 100;
  let sql = `
    SELECT DISTINCT li.seq, s.value
    FROM log_index li
    JOIN state s ON s.room_id = li.room_id
      AND s.scope = '_audit'
      AND s.sort_key = li.seq
    WHERE li.room_id = ? AND li.scope = ? AND li.key = ?
  `;
  const args: any[] = [roomId, scope, key];

  if (opts.after) {
    sql += ` AND li.seq > ?`;
    args.push(opts.after);
  }

  sql += ` ORDER BY li.seq ASC LIMIT ?`;
  args.push(limit);

  const result = await sqlite.execute({ sql, args });
  return result.rows.map(([seq, rawValue]) => {
    let entry: any = {};
    try { entry = JSON.parse(rawValue as string); } catch {}
    return { seq: seq as number, entry };
  });
}

/**
 * Query key history by prefix (e.g. all keys matching "concepts.*" in _shared).
 * Used for views with prefix-level dependencies.
 */
export async function queryPrefixHistory(
  roomId: string,
  scope: string,
  prefix: string,
  opts: { limit?: number; after?: number } = {},
): Promise<Array<{ seq: number; key: string; entry: any }>> {
  const limit = opts.limit ?? 200;
  let sql = `
    SELECT DISTINCT li.seq, li.key, s.value
    FROM log_index li
    JOIN state s ON s.room_id = li.room_id
      AND s.scope = '_audit'
      AND s.sort_key = li.seq
    WHERE li.room_id = ? AND li.scope = ? AND li.key LIKE ? ESCAPE '\'
  `;
  const args: any[] = [roomId, scope, prefix.replace(/%/g, '\\%').replace(/_/g, '\\_') + '%'];

  if (opts.after) {
    sql += ` AND li.seq > ?`;
    args.push(opts.after);
  }

  sql += ` ORDER BY li.seq ASC LIMIT ?`;
  args.push(limit);

  const result = await sqlite.execute({ sql, args });
  return result.rows.map(([seq, key, rawValue]) => {
    let entry: any = {};
    try { entry = JSON.parse(rawValue as string); } catch {}
    return { seq: seq as number, key: key as string, entry };
  });
}
