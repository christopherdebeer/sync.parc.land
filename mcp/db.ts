/**
 * db.ts — SQLite helpers for sync-mcp OAuth/WebAuthn/Vault
 *
 * Schema is managed by the parent ../schema.ts (unified migration).
 * This file provides CRUD helpers + ensures smcp_ tables exist.
 */
import { sqlite } from "https://esm.town/v/std/sqlite";
import { migrate } from "../schema.ts";

// Re-export scope types and functions for backward compatibility
export {
  type ParsedScope,
  type RoomScope,
  parseScope,
  serializeScope,
  checkRoomInScope,
} from "./scope.ts";

// ─── Schema migration (delegates to unified schema + ensures smcp_ tables) ──

export async function ensureSchema() {
  // Run the unified migration (creates all tables including smcp_)
  await migrate();

  // Belt-and-suspenders: ensure smcp_ tables exist even if parent
  // schema.ts is cached at an older version without them.
  await sqlite.batch([
    { sql: `CREATE TABLE IF NOT EXISTS smcp_users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_credentials (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, public_key BLOB NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT, device_type TEXT, backed_up INTEGER DEFAULT 0, rp_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_challenges (id TEXT PRIMARY KEY, challenge TEXT NOT NULL, user_id TEXT, type TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_oauth_clients (client_id TEXT PRIMARY KEY, client_secret TEXT, redirect_uris TEXT NOT NULL, client_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_auth_codes (code TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, code_challenge TEXT NOT NULL, code_challenge_method TEXT NOT NULL DEFAULT 'S256', scope TEXT, resource TEXT, expires_at TEXT NOT NULL, used INTEGER DEFAULT 0)`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_access_tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL, scope TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_refresh_tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL, scope TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_vault (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, room_id TEXT NOT NULL, token TEXT NOT NULL, token_type TEXT NOT NULL, label TEXT, is_default INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, scope TEXT DEFAULT 'consent', created_at TEXT NOT NULL DEFAULT (datetime('now')))`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS smcp_recovery_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, used INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`, args: [] },
  ]);
}

// ─── Helpers ─────────────────────────────────────────────────────

export function generateId(): string {
  return crypto.randomUUID();
}

export async function generateToken(prefix = ""): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return prefix ? `${prefix}_${b64}` : b64;
}

// Base64url encode/decode
export function b64urlEncode(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function b64urlDecode(str: string): Uint8Array {
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// SHA-256 for PKCE
export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return b64urlEncode(new Uint8Array(hash));
}

// ─── User CRUD ───────────────────────────────────────────────────

export async function createUser(id: string, username: string) {
  await sqlite.execute({
    sql: "INSERT INTO smcp_users (id, username) VALUES (?, ?)",
    args: [id, username],
  });
}

export async function getUserByUsername(username: string) {
  const res = await sqlite.execute({
    sql: "SELECT * FROM smcp_users WHERE username = ?",
    args: [username],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r[0] as string,
    username: r[1] as string,
    created_at: r[2] as string,
  };
}

export async function getUserById(id: string) {
  const res = await sqlite.execute({
    sql: "SELECT * FROM smcp_users WHERE id = ?",
    args: [id],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r[0] as string,
    username: r[1] as string,
    created_at: r[2] as string,
  };
}

// ─── Credential CRUD ────────────────────────────────────────────

export async function saveCredential(cred: {
  id: string;
  userId: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
  deviceType?: string;
  backedUp?: boolean;
  rpId?: string;
}) {
  await sqlite.execute({
    sql:
      `INSERT INTO smcp_credentials (id, user_id, public_key, counter, transports, device_type, backed_up, rp_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      cred.id,
      cred.userId,
      b64urlEncode(cred.publicKey),
      cred.counter,
      cred.transports ? JSON.stringify(cred.transports) : null,
      cred.deviceType ?? null,
      cred.backedUp ? 1 : 0,
      cred.rpId ?? null,
    ],
  });
}

export async function getCredentialsByUserId(userId: string, rpId?: string) {
  let sql = "SELECT * FROM smcp_credentials WHERE user_id = ?";
  const args: any[] = [userId];
  if (rpId) {
    sql += " AND (rp_id = ? OR rp_id IS NULL)";
    args.push(rpId);
  }
  const res = await sqlite.execute({ sql, args });
  return res.rows.map((r) => ({
    id: r[0] as string,
    userId: r[1] as string,
    publicKey: b64urlDecode(r[2] as string),
    counter: r[3] as number,
    transports: r[4] ? JSON.parse(r[4] as string) : undefined,
    deviceType: r[5] as string | null,
    backedUp: r[6] === 1,
    rpId: r[7] as string | null,
  }));
}

export async function getCredentialById(credId: string) {
  const res = await sqlite.execute({
    sql: "SELECT * FROM smcp_credentials WHERE id = ?",
    args: [credId],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r[0] as string,
    userId: r[1] as string,
    publicKey: b64urlDecode(r[2] as string),
    counter: r[3] as number,
    transports: r[4] ? JSON.parse(r[4] as string) : undefined,
    deviceType: r[5] as string | null,
    backedUp: r[6] === 1,
    rpId: r[7] as string | null,
  };
}

export async function updateCredentialCounter(
  credId: string,
  newCounter: number,
) {
  await sqlite.execute({
    sql: "UPDATE smcp_credentials SET counter = ? WHERE id = ?",
    args: [newCounter, credId],
  });
}

// ─── Challenge CRUD ─────────────────────────────────────────────

export async function saveChallenge(
  id: string,
  challenge: string,
  type: string,
  userId?: string,
) {
  const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min
  await sqlite.execute({
    sql:
      "INSERT INTO smcp_challenges (id, challenge, user_id, type, expires_at) VALUES (?, ?, ?, ?, ?)",
    args: [id, challenge, userId ?? null, type, expires],
  });
}

export async function getChallenge(id: string) {
  const res = await sqlite.execute({
    sql:
      "SELECT * FROM smcp_challenges WHERE id = ? AND expires_at > datetime('now')",
    args: [id],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r[0] as string,
    challenge: r[1] as string,
    userId: r[2] as string | null,
    type: r[3] as string,
  };
}

export async function deleteChallenge(id: string) {
  await sqlite.execute({
    sql: "DELETE FROM smcp_challenges WHERE id = ?",
    args: [id],
  });
}

// ─── OAuth Client CRUD ──────────────────────────────────────────

export async function saveOAuthClient(client: {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  clientName?: string;
}) {
  await sqlite.execute({
    sql:
      `INSERT OR REPLACE INTO smcp_oauth_clients (client_id, client_secret, redirect_uris, client_name)
          VALUES (?, ?, ?, ?)`,
    args: [
      client.clientId,
      client.clientSecret ?? null,
      JSON.stringify(client.redirectUris),
      client.clientName ?? null,
    ],
  });
}

export async function getOAuthClient(clientId: string) {
  const res = await sqlite.execute({
    sql: "SELECT * FROM smcp_oauth_clients WHERE client_id = ?",
    args: [clientId],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    clientId: r[0] as string,
    clientSecret: r[1] as string | null,
    redirectUris: JSON.parse(r[2] as string) as string[],
    clientName: r[3] as string | null,
  };
}

// ─── Auth Code CRUD ─────────────────────────────────────────────

export async function saveAuthCode(code: {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
  resource?: string;
}) {
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
  await sqlite.execute({
    sql:
      `INSERT INTO smcp_auth_codes (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, resource, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      code.code,
      code.clientId,
      code.userId,
      code.redirectUri,
      code.codeChallenge,
      code.codeChallengeMethod,
      code.scope ?? null,
      code.resource ?? null,
      expires,
    ],
  });
}

export async function consumeAuthCode(code: string) {
  const res = await sqlite.execute({
    sql:
      "SELECT * FROM smcp_auth_codes WHERE code = ? AND used = 0 AND expires_at > datetime('now')",
    args: [code],
  });
  if (res.rows.length === 0) return null;
  await sqlite.execute({
    sql: "UPDATE smcp_auth_codes SET used = 1 WHERE code = ?",
    args: [code],
  });
  const r = res.rows[0];
  return {
    code: r[0] as string,
    clientId: r[1] as string,
    userId: r[2] as string,
    redirectUri: r[3] as string,
    codeChallenge: r[4] as string,
    codeChallengeMethod: r[5] as string,
    scope: r[6] as string | null,
    resource: r[7] as string | null,
  };
}

// ─── Token CRUD ─────────────────────────────────────────────────

export async function saveAccessToken(t: {
  token: string;
  userId: string;
  clientId: string;
  scope?: string;
  expiresInSec?: number;
}) {
  const expires = new Date(Date.now() + (t.expiresInSec ?? 3600) * 1000)
    .toISOString();
  await sqlite.execute({
    sql:
      `INSERT INTO smcp_access_tokens (token, user_id, client_id, scope, expires_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [t.token, t.userId, t.clientId, t.scope ?? null, expires],
  });
}

export async function validateAccessToken(token: string) {
  const res = await sqlite.execute({
    sql:
      "SELECT * FROM smcp_access_tokens WHERE token = ? AND expires_at > datetime('now')",
    args: [token],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    token: r[0] as string,
    userId: r[1] as string,
    clientId: r[2] as string,
    scope: r[3] as string | null,
    expiresAt: r[4] as string,
  };
}

export async function saveRefreshToken(t: {
  token: string;
  userId: string;
  clientId: string;
  scope?: string;
}) {
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(); // 30 days
  await sqlite.execute({
    sql:
      `INSERT INTO smcp_refresh_tokens (token, user_id, client_id, scope, expires_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [t.token, t.userId, t.clientId, t.scope ?? null, expires],
  });
}

export async function consumeRefreshToken(token: string) {
  const res = await sqlite.execute({
    sql:
      "SELECT * FROM smcp_refresh_tokens WHERE token = ? AND expires_at > datetime('now')",
    args: [token],
  });
  if (res.rows.length === 0) return null;
  await sqlite.execute({
    sql: "DELETE FROM smcp_refresh_tokens WHERE token = ?",
    args: [token],
  });
  const r = res.rows[0];
  return {
    token: r[0] as string,
    userId: r[1] as string,
    clientId: r[2] as string,
    scope: r[3] as string | null,
  };
}

// ─── Session CRUD ───────────────────────────────────────────────

export async function createSession(
  userId: string,
  scope: string = "consent",
): Promise<string> {
  const id = await generateToken("sess");
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min
  await sqlite.execute({
    sql:
      "INSERT INTO smcp_sessions (id, user_id, expires_at, scope) VALUES (?, ?, ?, ?)",
    args: [id, userId, expires, scope],
  });
  return id;
}

export async function validateSession(sessionId: string) {
  const res = await sqlite.execute({
    sql:
      "SELECT id, user_id, scope FROM smcp_sessions WHERE id = ? AND expires_at > datetime('now')",
    args: [sessionId],
  });
  if (res.rows.length === 0) return null;
  return {
    userId: res.rows[0][1] as string,
    scope: (res.rows[0][2] as string) ?? "consent",
  };
}

export async function deleteSession(sessionId: string) {
  await sqlite.execute({
    sql: "DELETE FROM smcp_sessions WHERE id = ?",
    args: [sessionId],
  });
}

// ─── Recovery Token CRUD ─────────────────────────────────────────

const RECOVERY_EXPIRY_DAYS = 90;
const MAX_ACTIVE_RECOVERY_TOKENS = 3;

export async function createRecoveryToken(
  userId: string,
): Promise<{ token: string; expiresAt: string } | { error: string }> {
  const countRes = await sqlite.execute({
    sql:
      "SELECT COUNT(*) FROM smcp_recovery_tokens WHERE user_id = ? AND used = 0 AND expires_at > datetime('now')",
    args: [userId],
  });
  const activeCount = Number(countRes.rows[0][0]);
  if (activeCount >= MAX_ACTIVE_RECOVERY_TOKENS) {
    return {
      error:
        `Maximum ${MAX_ACTIVE_RECOVERY_TOKENS} active recovery tokens. Revoke one first.`,
    };
  }

  const token = await generateToken("recover");
  const tokenHash = await sha256(token);
  const id = generateId();
  const expiresAt = new Date(
    Date.now() + RECOVERY_EXPIRY_DAYS * 24 * 3600 * 1000,
  ).toISOString();

  await sqlite.execute({
    sql:
      "INSERT INTO smcp_recovery_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
    args: [id, userId, tokenHash, expiresAt],
  });

  return { token, expiresAt };
}

export async function validateRecoveryToken(
  token: string,
): Promise<{ userId: string; tokenId: string } | null> {
  const tokenHash = await sha256(token);
  const res = await sqlite.execute({
    sql:
      "SELECT id, user_id FROM smcp_recovery_tokens WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')",
    args: [tokenHash],
  });
  if (res.rows.length === 0) return null;
  return {
    tokenId: res.rows[0][0] as string,
    userId: res.rows[0][1] as string,
  };
}

export async function consumeRecoveryToken(tokenId: string) {
  await sqlite.execute({
    sql: "UPDATE smcp_recovery_tokens SET used = 1 WHERE id = ?",
    args: [tokenId],
  });
}

export async function listRecoveryTokens(userId: string) {
  const res = await sqlite.execute({
    sql:
      "SELECT id, expires_at, used, created_at FROM smcp_recovery_tokens WHERE user_id = ? ORDER BY created_at DESC",
    args: [userId],
  });
  return res.rows.map((r) => ({
    id: r[0] as string,
    expiresAt: r[1] as string,
    used: r[2] === 1,
    createdAt: r[3] as string,
  }));
}

export async function revokeRecoveryToken(userId: string, tokenId: string) {
  await sqlite.execute({
    sql: "DELETE FROM smcp_recovery_tokens WHERE id = ? AND user_id = ?",
    args: [tokenId, userId],
  });
}

// ─── Cleanup ────────────────────────────────────────────────────

export async function cleanupExpired() {
  await sqlite.batch([
    {
      sql: "DELETE FROM smcp_challenges WHERE expires_at < datetime('now')",
      args: [],
    },
    {
      sql: "DELETE FROM smcp_auth_codes WHERE expires_at < datetime('now')",
      args: [],
    },
    {
      sql: "DELETE FROM smcp_sessions WHERE expires_at < datetime('now')",
      args: [],
    },
    {
      sql:
        "DELETE FROM smcp_recovery_tokens WHERE expires_at < datetime('now') OR used = 1",
      args: [],
    },
  ]);
}

// ─── User-Room CRUD ─────────────────────────────────────────────

export async function upsertUserRoom(
  userId: string, roomId: string, access: string,
  label?: string, isDefault?: boolean,
) {
  if (isDefault) {
    await sqlite.execute({
      sql: "UPDATE smcp_user_rooms SET is_default = 0 WHERE user_id = ?",
      args: [userId],
    });
  }
  await sqlite.execute({
    sql: `INSERT INTO smcp_user_rooms (user_id, room_id, access, label, is_default)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, room_id) DO UPDATE SET
            access = excluded.access,
            label = COALESCE(excluded.label, smcp_user_rooms.label),
            is_default = COALESCE(excluded.is_default, smcp_user_rooms.is_default)`,
    args: [userId, roomId, access, label ?? null, isDefault ? 1 : 0],
  });
}

export async function getUserRoom(userId: string, roomId: string) {
  const res = await sqlite.execute({
    sql: "SELECT user_id, room_id, access, is_default, label, created_at FROM smcp_user_rooms WHERE user_id = ? AND room_id = ?",
    args: [userId, roomId],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    userId: r[0] as string, roomId: r[1] as string,
    access: r[2] as string, isDefault: r[3] === 1,
    label: r[4] as string | null, createdAt: r[5] as string,
  };
}

export async function listUserRooms(userId: string) {
  const res = await sqlite.execute({
    sql: `SELECT user_id, room_id, access, is_default, label, created_at
          FROM smcp_user_rooms WHERE user_id = ?
          ORDER BY is_default DESC, created_at DESC`,
    args: [userId],
  });
  return res.rows.map((r) => ({
    userId: r[0] as string, roomId: r[1] as string,
    access: r[2] as string, isDefault: r[3] === 1,
    label: r[4] as string | null, createdAt: r[5] as string,
  }));
}

export async function deleteUserRoom(userId: string, roomId: string) {
  await sqlite.execute({
    sql: "DELETE FROM smcp_user_rooms WHERE user_id = ? AND room_id = ?",
    args: [userId, roomId],
  });
}

// ─── User Session CRUD (OAuth-token-level) ──────────────────────

export async function createUserSession(params: {
  tokenHash: string; userId: string; clientId: string;
  scope: string; expiresAt: string;
}) {
  await sqlite.execute({
    sql: `INSERT INTO smcp_user_sessions
            (token_hash, user_id, client_id, scope, expires_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [params.tokenHash, params.userId, params.clientId,
           params.scope, params.expiresAt],
  });
}

export async function getUserSession(tokenHash: string) {
  const res = await sqlite.execute({
    sql: `SELECT token_hash, user_id, client_id, scope, created_at, expires_at
          FROM smcp_user_sessions
          WHERE token_hash = ? AND expires_at > datetime('now')`,
    args: [tokenHash],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    tokenHash: r[0] as string, userId: r[1] as string,
    clientId: r[2] as string, scope: r[3] as string,
    createdAt: r[4] as string, expiresAt: r[5] as string,
  };
}

export async function updateSessionScope(tokenHash: string, scope: string) {
  await sqlite.execute({
    sql: `UPDATE smcp_user_sessions SET scope = ? WHERE token_hash = ?`,
    args: [scope, tokenHash],
  });
}

export async function deleteUserSession(tokenHash: string) {
  await sqlite.execute({
    sql: "DELETE FROM smcp_embodiments WHERE session_hash = ?",
    args: [tokenHash],
  });
  await sqlite.execute({
    sql: "DELETE FROM smcp_user_sessions WHERE token_hash = ?",
    args: [tokenHash],
  });
}

export async function transferEmbodiments(
  oldTokenHash: string, newTokenHash: string,
) {
  const res = await sqlite.execute({
    sql: "SELECT room_id, agent_id FROM smcp_embodiments WHERE session_hash = ?",
    args: [oldTokenHash],
  });
  if (res.rows.length === 0) return;
  const stmts = res.rows.map((r) => ({
    sql: `INSERT OR IGNORE INTO smcp_embodiments
            (session_hash, room_id, agent_id, embodied_at)
          VALUES (?, ?, ?, datetime('now'))`,
    args: [newTokenHash, r[0] as string, r[1] as string],
  }));
  await sqlite.batch(stmts);
  await sqlite.execute({
    sql: "DELETE FROM smcp_embodiments WHERE session_hash = ?",
    args: [oldTokenHash],
  });
}

// ─── Embodiment CRUD ────────────────────────────────────────────

export async function setEmbodiment(
  sessionHash: string, roomId: string, agentId: string,
) {
  await sqlite.execute({
    sql: `INSERT INTO smcp_embodiments (session_hash, room_id, agent_id)
          VALUES (?, ?, ?)
          ON CONFLICT(session_hash, room_id) DO UPDATE SET
            agent_id = excluded.agent_id,
            embodied_at = datetime('now')`,
    args: [sessionHash, roomId, agentId],
  });
}

export async function getEmbodiment(sessionHash: string, roomId: string) {
  const res = await sqlite.execute({
    sql: `SELECT agent_id FROM smcp_embodiments
          WHERE session_hash = ? AND room_id = ?`,
    args: [sessionHash, roomId],
  });
  if (res.rows.length === 0) return null;
  return res.rows[0][0] as string;
}

export async function listEmbodiments(sessionHash: string) {
  const res = await sqlite.execute({
    sql: `SELECT room_id, agent_id, embodied_at FROM smcp_embodiments
          WHERE session_hash = ? ORDER BY embodied_at DESC`,
    args: [sessionHash],
  });
  return res.rows.map((r) => ({
    roomId: r[0] as string, agentId: r[1] as string,
    embodiedAt: r[2] as string,
  }));
}

export async function removeEmbodiment(sessionHash: string, roomId: string) {
  await sqlite.execute({
    sql: "DELETE FROM smcp_embodiments WHERE session_hash = ? AND room_id = ?",
    args: [sessionHash, roomId],
  });
}

export async function removeAllEmbodiments(sessionHash: string) {
  await sqlite.execute({
    sql: "DELETE FROM smcp_embodiments WHERE session_hash = ?",
    args: [sessionHash],
  });
}

export async function findSessionsByUserClient(
  userId: string, clientId: string, excludeHash?: string,
) {
  let sql = `SELECT token_hash FROM smcp_user_sessions
             WHERE user_id = ? AND client_id = ? AND expires_at > datetime('now')`;
  const args: any[] = [userId, clientId];
  if (excludeHash) {
    sql += ` AND token_hash != ?`;
    args.push(excludeHash);
  }
  const res = await sqlite.execute({ sql, args });
  return res.rows.map(r => r[0] as string);
}


// ═══════════════════════════════════════════════════════════════════
// Unified Tokens (Phase 1 — v7 auth model)
// ═══════════════════════════════════════════════════════════════════

export async function mintToken(params: {
  userId: string;
  scope: string;
  label?: string;
  roomId?: string;
  agentId?: string;
  clientId?: string;
  expiresInSec?: number;
  withRefresh?: boolean;
}): Promise<{ id: string; token: string; refreshToken?: string; expiresAt: string | null }> {
  const id = generateId();
  const token = await generateToken("tok");
  const tokenHash = await sha256(token);
  const expiresAt = params.expiresInSec
    ? new Date(Date.now() + params.expiresInSec * 1000).toISOString()
    : null;

  let refreshToken: string | undefined;
  let refreshHash: string | null = null;
  if (params.withRefresh) {
    refreshToken = await generateToken("ref");
    refreshHash = await sha256(refreshToken);
  }

  await sqlite.execute({
    sql: `INSERT INTO tokens (id, token_hash, refresh_hash, minted_by, scope, label,
            room_id, agent_id, client_id, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, tokenHash, refreshHash, params.userId, params.scope,
           params.label ?? null, params.roomId ?? null, params.agentId ?? null,
           params.clientId ?? null, expiresAt],
  });

  return { id, token, refreshToken, expiresAt };
}

export async function validateTokenByHash(hash: string): Promise<{
  id: string; mintedBy: string; scope: string; label: string | null;
  roomId: string | null; agentId: string | null; clientId: string | null;
  expiresAt: string | null; createdAt: string;
} | null> {
  const res = await sqlite.execute({
    sql: `SELECT id, minted_by, scope, label, room_id, agent_id, client_id,
            expires_at, created_at
          FROM tokens
          WHERE token_hash = ? AND revoked = 0
            AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    args: [hash],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r[0] as string, mintedBy: r[1] as string, scope: r[2] as string,
    label: r[3] as string | null, roomId: r[4] as string | null,
    agentId: r[5] as string | null, clientId: r[6] as string | null,
    expiresAt: r[7] as string | null, createdAt: r[8] as string,
  };
}

export async function validateRefreshByHash(hash: string): Promise<{
  id: string; mintedBy: string; scope: string; clientId: string | null;
} | null> {
  const res = await sqlite.execute({
    sql: `SELECT id, minted_by, scope, client_id
          FROM tokens
          WHERE refresh_hash = ? AND revoked = 0
            AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    args: [hash],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r[0] as string, mintedBy: r[1] as string,
    scope: r[2] as string, clientId: r[3] as string | null,
  };
}

export async function refreshUnifiedToken(oldRefreshHash: string, newExpiresInSec = 3600): Promise<{
  id: string; token: string; refreshToken: string; expiresAt: string;
} | null> {
  const old = await validateRefreshByHash(oldRefreshHash);
  if (!old) return null;

  // Revoke old token
  await sqlite.execute({
    sql: `UPDATE tokens SET revoked = 1 WHERE id = ?`,
    args: [old.id],
  });

  // Mint new with same scope
  const result = await mintToken({
    userId: old.mintedBy,
    scope: old.scope,
    clientId: old.clientId ?? undefined,
    expiresInSec: newExpiresInSec,
    withRefresh: true,
  });

  // Transfer embodiments from old token to new
  await sqlite.execute({
    sql: `UPDATE smcp_embodiments SET session_hash = ?
          WHERE session_hash = (SELECT token_hash FROM tokens WHERE id = ?)`,
    args: [await sha256(result.token), old.id],
  }).catch(() => {});

  return {
    id: result.id,
    token: result.token,
    refreshToken: result.refreshToken!,
    expiresAt: result.expiresAt!,
  };
}

export async function revokeToken(tokenId: string, userId: string): Promise<boolean> {
  const res = await sqlite.execute({
    sql: `UPDATE tokens SET revoked = 1 WHERE id = ? AND minted_by = ?`,
    args: [tokenId, userId],
  });
  return (res.rowsAffected ?? 0) > 0;
}

export async function listUserTokens(userId: string): Promise<Array<{
  id: string; scope: string; label: string | null; roomId: string | null;
  agentId: string | null; clientId: string | null; revoked: boolean;
  expiresAt: string | null; createdAt: string;
}>> {
  const res = await sqlite.execute({
    sql: `SELECT id, scope, label, room_id, agent_id, client_id, revoked,
            expires_at, created_at
          FROM tokens WHERE minted_by = ?
          ORDER BY created_at DESC LIMIT 100`,
    args: [userId],
  });
  return res.rows.map((r: any[]) => ({
    id: r[0] as string, scope: r[1] as string, label: r[2] as string | null,
    roomId: r[3] as string | null, agentId: r[4] as string | null,
    clientId: r[5] as string | null, revoked: r[6] === 1,
    expiresAt: r[7] as string | null, createdAt: r[8] as string,
  }));
}

// ═══════════════════════════════════════════════════════════════════
// Device Authorization Codes
// ═══════════════════════════════════════════════════════════════════

function generateUserCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  const left = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const right = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `${left}-${right}`;
}

export async function createDeviceCode(scope: string, clientId?: string): Promise<{
  deviceCode: string; userCode: string; expiresAt: string;
}> {
  const deviceCode = await generateToken("dev");
  let userCode = generateUserCode();

  // Ensure unique user_code (unlikely collision but be safe)
  for (let i = 0; i < 5; i++) {
    try {
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 min
      await sqlite.execute({
        sql: `INSERT INTO device_codes (device_code, user_code, client_id, scope, expires_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [deviceCode, userCode, clientId ?? "cli", scope, expiresAt],
      });
      return { deviceCode, userCode, expiresAt };
    } catch (e: any) {
      if (e.message?.includes("UNIQUE") && e.message?.includes("user_code")) {
        userCode = generateUserCode();
        continue;
      }
      throw e;
    }
  }
  throw new Error("Failed to generate unique user code");
}

export async function getDeviceCode(deviceCode: string): Promise<{
  deviceCode: string; userCode: string; scope: string; status: string;
  approvedBy: string | null; expiresAt: string;
} | null> {
  const res = await sqlite.execute({
    sql: `SELECT device_code, user_code, scope, status, approved_by, expires_at
          FROM device_codes WHERE device_code = ?`,
    args: [deviceCode],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    deviceCode: r[0] as string, userCode: r[1] as string,
    scope: r[2] as string, status: r[3] as string,
    approvedBy: r[4] as string | null, expiresAt: r[5] as string,
  };
}

export async function getDeviceCodeByUserCode(userCode: string): Promise<{
  deviceCode: string; userCode: string; scope: string; status: string;
  approvedBy: string | null; expiresAt: string;
} | null> {
  const res = await sqlite.execute({
    sql: `SELECT device_code, user_code, scope, status, approved_by, expires_at
          FROM device_codes
          WHERE user_code = ? AND expires_at > datetime('now')`,
    args: [userCode],
  });
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    deviceCode: r[0] as string, userCode: r[1] as string,
    scope: r[2] as string, status: r[3] as string,
    approvedBy: r[4] as string | null, expiresAt: r[5] as string,
  };
}

export async function approveDeviceCode(deviceCode: string, userId: string): Promise<boolean> {
  const res = await sqlite.execute({
    sql: `UPDATE device_codes SET status = 'approved', approved_by = ?
          WHERE device_code = ? AND status = 'pending'
          AND expires_at > datetime('now')`,
    args: [userId, deviceCode],
  });
  return (res.rowsAffected ?? 0) > 0;
}

export async function denyDeviceCode(deviceCode: string): Promise<boolean> {
  const res = await sqlite.execute({
    sql: `UPDATE device_codes SET status = 'denied'
          WHERE device_code = ? AND status = 'pending'`,
    args: [deviceCode],
  });
  return (res.rowsAffected ?? 0) > 0;
}

export async function consumeDeviceCode(deviceCode: string): Promise<{
  scope: string; approvedBy: string;
} | null> {
  const dc = await getDeviceCode(deviceCode);
  if (!dc || dc.status !== "approved" || !dc.approvedBy) return null;
  if (new Date(dc.expiresAt) < new Date()) return null;
  // Mark consumed by setting status
  await sqlite.execute({
    sql: `UPDATE device_codes SET status = 'consumed' WHERE device_code = ?`,
    args: [deviceCode],
  });
  return { scope: dc.scope, approvedBy: dc.approvedBy };
}

export async function cleanupDeviceCodes() {
  await sqlite.execute({
    sql: `DELETE FROM device_codes WHERE expires_at < datetime('now')`,
    args: [],
  });
}

// ─── Room invitation ─────────────────────────────────────────────

export async function inviteUserToRoom(
  userId: string, roomId: string, role: string, invitedBy: string, label?: string,
) {
  await sqlite.execute({
    sql: `INSERT INTO smcp_user_rooms (user_id, room_id, access, invited_by, label)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, room_id) DO UPDATE SET
            access = excluded.access, invited_by = excluded.invited_by`,
    args: [userId, roomId, role, invitedBy, label ?? null],
  });
}


export async function updateDeviceCodeScope(deviceCode: string, scope: string) {
  await sqlite.execute({
    sql: `UPDATE device_codes SET scope = ? WHERE device_code = ?`,
    args: [scope, deviceCode],
  });
}
