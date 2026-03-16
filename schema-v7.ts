/**
 * schema-v7.ts — Unified auth schema additions (Phase 1).
 *
 * Adds:
 * - `tokens` table: unified token storage (replaces smcp_vault, smcp_access_tokens, etc.)
 * - `device_codes` table: OAuth Device Authorization flow
 *
 * Phase 1 is additive: existing smcp_ tables and token columns are untouched.
 * Old auth paths continue to work. New tokens table operates alongside.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";

export async function migrateUnifiedAuth() {
  await sqlite.batch([
    // ── Unified tokens table ──
    // All minted credentials live here: device auth tokens, OAuth tokens,
    // delegation tokens, read-scoped tokens (view replacements).
    // Scope string determines what the token can do.
    {
      sql: `CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        refresh_hash TEXT UNIQUE,
        minted_by TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'rooms:*',
        label TEXT,
        room_id TEXT,
        agent_id TEXT,
        client_id TEXT,
        revoked INTEGER DEFAULT 0,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      args: [],
    },

    // ── Device authorization codes ──
    // RFC 8628: device_code is the secret the CLI polls with,
    // user_code is the short human-readable code shown on approval page.
    {
      sql: `CREATE TABLE IF NOT EXISTS device_codes (
        device_code TEXT PRIMARY KEY,
        user_code TEXT NOT NULL UNIQUE,
        client_id TEXT,
        scope TEXT DEFAULT 'rooms:*',
        status TEXT DEFAULT 'pending',
        approved_by TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      args: [],
    },
  ]);

  // Indexes
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_tokens_minted_by ON tokens(minted_by)`,
    `CREATE INDEX IF NOT EXISTS idx_tokens_room ON tokens(room_id) WHERE room_id IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_tokens_refresh ON tokens(refresh_hash) WHERE refresh_hash IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_device_codes_user ON device_codes(user_code)`,
  ];
  for (const sql of indexes) {
    try { await sqlite.execute({ sql, args: [] }); } catch (_) {}
  }

  // Add invited_by to user_rooms if missing
  try {
    await sqlite.execute({
      sql: `ALTER TABLE smcp_user_rooms ADD COLUMN invited_by TEXT`,
      args: [],
    });
  } catch (_) { /* already exists */ }
}
