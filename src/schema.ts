/* Open in Val Town: https://www.val.town/x/c15r/agent-sync/code/schema.ts */
import { sqlite } from "https://esm.town/v/std/sqlite";
export async function migrate() {
  // Core tables
  await sqlite.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now')),
        meta TEXT DEFAULT '{}'
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL REFERENCES rooms(id),
        name TEXT NOT NULL,
        role TEXT DEFAULT 'agent',
        joined_at TEXT DEFAULT (datetime('now')),
        meta TEXT DEFAULT '{}'
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL REFERENCES rooms(id),
        from_agent TEXT REFERENCES agents(id),
        to_agent TEXT,
        kind TEXT DEFAULT 'message',
        body TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
      args: [],
    },
    {
      sql:
        `CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, id)`,
      args: [],
    },
    {
      sql:
        `CREATE INDEX IF NOT EXISTS idx_messages_room_kind ON messages(room_id, kind)`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS state (
        room_id TEXT NOT NULL REFERENCES rooms(id),
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        version INTEGER DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (room_id, scope, key)
      )`,
      args: [],
    },
  ]);
  // v2 schema additions — ALTER TABLE with try/catch for idempotency
  const addColumn = async (table, col, typedef) => {
    try {
      await sqlite.execute({
        sql: `ALTER TABLE ${table} ADD COLUMN ${col} ${typedef}`,
        args: [],
      });
    } catch (_) {
      // Column already exists — ignore
    }
  };
  // Messages: threading + claims
  await addColumn("messages", "reply_to", "INTEGER REFERENCES messages(id)");
  await addColumn("messages", "claimed_by", "TEXT");
  await addColumn("messages", "claimed_at", "TEXT");
  // Agents: presence + wait visibility
  await addColumn("agents", "last_heartbeat", "TEXT");
  await addColumn("agents", "status", "TEXT DEFAULT 'active'");
  await addColumn("agents", "waiting_on", "TEXT"); // JSON: condition they're blocking on
  // Agents: authentication
  await addColumn("agents", "token_hash", "TEXT"); // SHA-256 hash of bearer token
  // Index for unclaimed message queries
  try {
    await sqlite.execute({
      sql:
        `CREATE INDEX IF NOT EXISTS idx_messages_unclaimed ON messages(room_id, kind, claimed_by)`,
      args: [],
    });
  } catch (_) {}
  // Index for threaded message queries
  try {
    await sqlite.execute({
      sql:
        `CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to)`,
      args: [],
    });
  } catch (_) {}
  // v3: composite PK for agents (id, room_id) — fixes cross-room collision
  try {
    // Check if migration is needed by testing current PK structure
    const hasComposite = await sqlite.execute({
      sql: `SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'`,
      args: [],
    });
    const ddl = hasComposite.rows[0]?.[0] ?? "";
    if (typeof ddl === "string" && !ddl.includes("PRIMARY KEY (id, room_id)")) {
      await sqlite.batch([
        {
          sql: `CREATE TABLE IF NOT EXISTS agents_v2 (
                        id TEXT NOT NULL,
                        room_id TEXT NOT NULL REFERENCES rooms(id),
                        name TEXT NOT NULL,
                        role TEXT DEFAULT 'agent',
                        joined_at TEXT DEFAULT (datetime('now')),
                        meta TEXT DEFAULT '{}',
                        last_heartbeat TEXT,
                        status TEXT DEFAULT 'active',
                        waiting_on TEXT,
                        token_hash TEXT,
                        PRIMARY KEY (id, room_id)
                    )`,
          args: [],
        },
        {
          sql:
            `INSERT OR IGNORE INTO agents_v2 SELECT id, room_id, name, role, joined_at, meta, last_heartbeat, status, waiting_on, token_hash FROM agents`,
          args: [],
        },
        { sql: `DROP TABLE agents`, args: [] },
        { sql: `ALTER TABLE agents_v2 RENAME TO agents`, args: [] },
      ]);
    }
  } catch (_) { /* already migrated or fresh DB */ }
  // v3: per-room message sequence numbers
  await addColumn("messages", "seq", "INTEGER");
  // Backfill seq for any existing messages that lack it
  try {
    await sqlite.execute({
      sql: `UPDATE messages SET seq = (
                SELECT COUNT(*) FROM messages m2
                WHERE m2.room_id = messages.room_id AND m2.id <= messages.id
            ) WHERE seq IS NULL`,
      args: [],
    });
  } catch (_) {}
  try {
    await sqlite.execute({
      sql:
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_room_seq ON messages(room_id, seq)`,
      args: [],
    });
  } catch (_) {}

  // ============ v4: timers, enabled, actions ============

  // State: timer and enabled support
  await addColumn("state", "timer_json", "TEXT");       // JSON: { ms?, at?, ticks?, tick_on?, effect }
  await addColumn("state", "timer_expires_at", "TEXT");  // ISO datetime for wall-clock timers
  await addColumn("state", "timer_ticks_left", "INTEGER"); // remaining ticks for logical-clock timers
  await addColumn("state", "timer_tick_on", "TEXT");     // state key path to watch for logical ticks
  await addColumn("state", "timer_effect", "TEXT");      // "delete" or "enable"
  await addColumn("state", "timer_started_at", "TEXT");  // when the timer was set
  await addColumn("state", "enabled_expr", "TEXT");      // CEL expression gating existence

  // Messages: timer and enabled support
  await addColumn("messages", "timer_json", "TEXT");
  await addColumn("messages", "timer_expires_at", "TEXT");
  await addColumn("messages", "timer_ticks_left", "INTEGER");
  await addColumn("messages", "timer_tick_on", "TEXT");
  await addColumn("messages", "timer_effect", "TEXT");
  await addColumn("messages", "timer_started_at", "TEXT");
  await addColumn("messages", "enabled_expr", "TEXT");

  // Agents: enabled support
  await addColumn("agents", "enabled_expr", "TEXT");     // CEL expression gating existence

  // Actions table
  try {
    await sqlite.execute({
      sql: `CREATE TABLE IF NOT EXISTS actions (
        id TEXT NOT NULL,
        room_id TEXT NOT NULL REFERENCES rooms(id),
        if_expr TEXT,
        enabled_expr TEXT,
        writes_json TEXT NOT NULL DEFAULT '[]',
        params_json TEXT,
        timer_json TEXT,
        timer_expires_at TEXT,
        timer_ticks_left INTEGER,
        timer_tick_on TEXT,
        timer_effect TEXT,
        timer_started_at TEXT,
        on_invoke_timer_json TEXT,
        registered_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        version INTEGER DEFAULT 1,
        PRIMARY KEY (id, room_id)
      )`,
      args: [],
    });
  } catch (_) {}

  // Actions: scope for ownership
  await addColumn("actions", "scope", "TEXT DEFAULT '_shared'");

  try {
    await sqlite.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_actions_room ON actions(room_id)`,
      args: [],
    });
  } catch (_) {}

  // Index for tick_on lookups — when a state key changes, find timers watching it
  try {
    await sqlite.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_state_tick_on ON state(room_id, timer_tick_on) WHERE timer_tick_on IS NOT NULL`,
      args: [],
    });
  } catch (_) {}
  try {
    await sqlite.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_actions_tick_on ON actions(room_id, timer_tick_on) WHERE timer_tick_on IS NOT NULL`,
      args: [],
    });
  } catch (_) {}
  try {
    await sqlite.execute({
      sql: `CREATE INDEX IF NOT EXISTS idx_messages_tick_on ON messages(room_id, timer_tick_on) WHERE timer_tick_on IS NOT NULL`,
      args: [],
    });
  } catch (_) {}
}