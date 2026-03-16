import { sqlite } from "https://esm.town/v/std/sqlite";

/**
 * Schema migration chain.
 *
 * v8: Two primitives — state + log. All domain entities (actions, views, agents)
 * live in state table scopes (_actions, _views, _agents). Legacy entity tables
 * (actions, views, agents) are created for backward compat with existing installs,
 * then dropped after v8 migration runs.
 *
 * Core tables that remain:
 *   rooms    — room identity + admin/view token hashes
 *   state    — the substrate (all scopes: _shared, _actions, _views, _agents, _messages, _audit, ...)
 *   tokens   — unified credential store (room tokens, agent tokens, MCP tokens)
 *   smcp_*   — MCP auth infrastructure (users, credentials, sessions, etc.)
 *   log_index — temporal query index over state audit entries
 */

export async function migrate() {
  await sqlite.batch([
    // ============ Rooms ============
    {
      sql: `CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now')),
        meta TEXT DEFAULT '{}',
        token_hash TEXT,
        view_token_hash TEXT
      )`,
      args: [],
    },

    // ============ Agents ============
    {
      sql: `CREATE TABLE IF NOT EXISTS agents (
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
        grants TEXT DEFAULT '[]',
        last_seen_seq INTEGER DEFAULT 0,
        enabled_expr TEXT,
        PRIMARY KEY (id, room_id)
      )`,
      args: [],
    },

    // ============ Unified State ============
    {
      sql: `CREATE TABLE IF NOT EXISTS state (
        room_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        sort_key INTEGER,
        value TEXT NOT NULL,
        version TEXT DEFAULT '',
        revision INTEGER DEFAULT 1,
        updated_at TEXT DEFAULT (datetime('now')),
        timer_json TEXT,
        timer_expires_at TEXT,
        timer_ticks_left INTEGER,
        timer_tick_on TEXT,
        timer_effect TEXT,
        timer_started_at TEXT,
        enabled_expr TEXT,
        PRIMARY KEY (room_id, scope, key)
      )`,
      args: [],
    },

    // ============ Actions ============
    {
      sql: `CREATE TABLE IF NOT EXISTS actions (
        id TEXT NOT NULL,
        room_id TEXT NOT NULL REFERENCES rooms(id),
        scope TEXT DEFAULT '_shared',
        description TEXT,
        if_expr TEXT,
        enabled_expr TEXT,
        result_expr TEXT,
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
    },

    // ============ Views ============
    {
      sql: `CREATE TABLE IF NOT EXISTS views (
        id TEXT NOT NULL,
        room_id TEXT NOT NULL REFERENCES rooms(id),
        scope TEXT DEFAULT '_shared',
        description TEXT,
        expr TEXT NOT NULL,
        enabled_expr TEXT,
        render_json TEXT,
        timer_json TEXT,
        timer_expires_at TEXT,
        timer_ticks_left INTEGER,
        timer_tick_on TEXT,
        timer_effect TEXT,
        timer_started_at TEXT,
        registered_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        version INTEGER DEFAULT 1,
        PRIMARY KEY (id, room_id)
      )`,
      args: [],
    },
  ]);

  // ============ Indexes ============
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_state_scope_sort ON state(room_id, scope, sort_key) WHERE sort_key IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_state_scope ON state(room_id, scope)`,
    `CREATE INDEX IF NOT EXISTS idx_state_tick_on ON state(room_id, timer_tick_on) WHERE timer_tick_on IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_actions_room ON actions(room_id)`,
    `CREATE INDEX IF NOT EXISTS idx_actions_tick_on ON actions(room_id, timer_tick_on) WHERE timer_tick_on IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_views_room ON views(room_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agents_room ON agents(room_id)`,
  ];
  for (const sql of indexes) {
    try { await sqlite.execute({ sql, args: [] }); } catch (_) {}
  }

  // ============ v4→v5 migration helpers ============
  // Add new columns to existing tables if upgrading from v4
  const addColumn = async (table: string, col: string, typedef: string) => {
    try {
      await sqlite.execute({ sql: `ALTER TABLE ${table} ADD COLUMN ${col} ${typedef}`, args: [] });
    } catch (_) { /* already exists */ }
  };

  // Rooms: add token_hash and view_token_hash if missing
  await addColumn("rooms", "token_hash", "TEXT");
  await addColumn("rooms", "view_token_hash", "TEXT");

  // Agents: add grants and last_seen_seq if missing
  await addColumn("agents", "grants", "TEXT DEFAULT '[]'");
  await addColumn("agents", "last_seen_seq", "INTEGER DEFAULT 0");
  await addColumn("agents", "enabled_expr", "TEXT");

  // State: add sort_key if missing
  await addColumn("state", "sort_key", "INTEGER");
  await addColumn("state", "timer_json", "TEXT");
  await addColumn("state", "timer_expires_at", "TEXT");
  await addColumn("state", "timer_ticks_left", "INTEGER");
  await addColumn("state", "timer_tick_on", "TEXT");
  await addColumn("state", "timer_effect", "TEXT");
  await addColumn("state", "timer_started_at", "TEXT");
  await addColumn("state", "enabled_expr", "TEXT");

  // Actions: add description, scope if missing
  await addColumn("actions", "scope", "TEXT DEFAULT '_shared'");
  await addColumn("actions", "description", "TEXT");
  await addColumn("actions", "result_expr", "TEXT");

  // Views table is new — created above. No migration needed.

  // ============ v5→v6 migration helpers ============
  // state.version becomes a content hash (TEXT). Add state.revision as sequential integer.
  // The addColumn approach silently fails if version already exists as INTEGER (from v5).
  // Use RENAME COLUMN to fix the affinity on production databases.
  try {
    // If this succeeds, the column was still INTEGER — rename it, add TEXT version, backfill revision
    await sqlite.execute({ sql: `ALTER TABLE state RENAME COLUMN version TO version_v5`, args: [] });
    await sqlite.execute({ sql: `ALTER TABLE state ADD COLUMN version TEXT DEFAULT ''`, args: [] });
    await sqlite.execute({ sql: `ALTER TABLE state ADD COLUMN revision INTEGER DEFAULT 1`, args: [] });
    // Migrate: copy integer version into revision, clear version hash (will be recomputed on next write)
    await sqlite.execute({
      sql: `UPDATE state SET revision = CAST(version_v5 AS INTEGER), version = ''
            WHERE revision IS NULL OR revision <= 1`,
      args: [],
    });
  } catch (_) {
    // Rename failed — either already migrated (version_v5 exists) or fresh install (version TEXT already set).
    // Ensure revision column exists and backfill any stragglers.
    await addColumn("state", "revision", "INTEGER DEFAULT 1");
    try {
      await sqlite.execute({
        sql: `UPDATE state SET revision = 1, version = ''
              WHERE revision IS NULL OR revision = 0`,
        args: [],
      });
    } catch (_) { /* best-effort */ }
  }

  // views.render_json: render hint for surfaces-as-views
  await addColumn("views", "render_json", "TEXT");

  // ============ MCP auth tables (smcp_ prefix) ============
  // v7: Only tables still actively needed. Deprecated tables (smcp_access_tokens,
  // smcp_refresh_tokens, smcp_vault, smcp_user_sessions) are no longer created.
  // They still exist in production for backward compat with active sessions.
  await sqlite.batch([
    { sql: `CREATE TABLE IF NOT EXISTS smcp_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_credentials (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES smcp_users(id),
      public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      device_type TEXT,
      backed_up INTEGER DEFAULT 0,
      rp_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_challenges (
      id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      user_id TEXT,
      type TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_secret TEXT,
      redirect_uris TEXT NOT NULL,
      client_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_auth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      code_challenge TEXT NOT NULL,
      code_challenge_method TEXT NOT NULL DEFAULT 'S256',
      scope TEXT,
      resource TEXT,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      scope TEXT DEFAULT 'consent',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_recovery_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES smcp_users(id),
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`, args: [] },
  ]);

  // smcp_ column migrations (for existing installs from separate sync-mcp val)
  await addColumn("smcp_credentials", "rp_id", "TEXT");
  await addColumn("smcp_sessions", "scope", "TEXT DEFAULT 'consent'");

  // ============ Agency & Identity tables ============
  // These support the user→room→agent identity model for MCP clients.
  // See docs/agency-and-identity.md for the design.
  await sqlite.batch([
    { sql: `CREATE TABLE IF NOT EXISTS smcp_user_rooms (
      user_id TEXT NOT NULL REFERENCES smcp_users(id),
      room_id TEXT NOT NULL,
      access TEXT NOT NULL DEFAULT 'participant',
      is_default INTEGER DEFAULT 0,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, room_id)
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_embodiments (
      session_hash TEXT NOT NULL,
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      embodied_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_hash, room_id)
    )`, args: [] },
  ]);

  const agencyIndexes = [
    `CREATE INDEX IF NOT EXISTS idx_smcp_user_rooms_user ON smcp_user_rooms(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_smcp_embodiments_session ON smcp_embodiments(session_hash)`,
  ];
  for (const sql of agencyIndexes) {
    try { await sqlite.execute({ sql, args: [] }); } catch (_) {}
  }

  // ============ v8: log_index + backfill ============
  const { migrateV8 } = await import("./schema-v8.ts");
  await migrateV8();

  // ============ v8: tokens.last_used_at ============
  await addColumn("tokens", "last_used_at", "TEXT");

  // ============ v8: Drop legacy entity tables ============
  // All domain data migrated to state table scopes (_actions, _views, _agents).
  // Agent tokens migrated to unified tokens table.
  // These tables are no longer read or written by any code path.
  const legacyDrops = [
    `DROP TABLE IF EXISTS views`,
    `DROP TABLE IF EXISTS actions`,
    `DROP TABLE IF EXISTS agents`,
  ];
  for (const sql of legacyDrops) {
    try { await sqlite.execute({ sql, args: [] }); } catch (_) {}
  }

  // Drop orphaned indexes on dropped tables
  const legacyIndexDrops = [
    `DROP INDEX IF EXISTS idx_actions_room`,
    `DROP INDEX IF EXISTS idx_actions_tick_on`,
    `DROP INDEX IF EXISTS idx_views_room`,
    `DROP INDEX IF EXISTS idx_agents_room`,
  ];
  for (const sql of legacyIndexDrops) {
    try { await sqlite.execute({ sql, args: [] }); } catch (_) {}
  }

}