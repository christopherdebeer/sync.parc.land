import { sqlite } from "https://esm.town/v/std/sqlite";
import { json, rows2objects } from "./utils.ts";
import {
  parseScope, matchRoom, roleToLevel, minLevel, canWrite as scopeCanWrite,
  canAdmin as scopeCanAdmin, type ScopeLevel,
} from "./mcp/scope.ts";

/**
 * Auth module — unified auth model (v7 Phase 1).
 *
 * Supports BOTH legacy tokens (room_, view_, as_) and unified tokens (tok_).
 * Legacy tokens resolve through rooms/agents tables (unchanged).
 * Unified tokens resolve through the `tokens` table + `smcp_user_rooms`.
 *
 * AuthResult is backward-compatible: existing checks on kind/grants continue to work.
 * New fields (userId, role) are available for new code.
 */

// ============ Token generation and hashing ============

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 as base64url (used by mcp/db.ts for tokens table). */
export async function hashTokenB64(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function generateToken(prefix: "room" | "view" | "as" = "as"): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `${prefix}_` + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============ Auth resolution ============

export interface AuthResult {
  authenticated: boolean;
  kind: "room" | "view" | "agent" | null;
  agentId: string | null;
  roomId: string | null;
  grants: string[];  // scopes this identity can direct-write

  // ── v7 unified auth fields (null for legacy tokens) ──
  userId?: string | null;
  tokenId?: string | null;
  role?: ScopeLevel | null;
}

const UNAUTH: AuthResult = { authenticated: false, kind: null, agentId: null, roomId: null, grants: [] };

/**
 * Resolve auth from request headers. Returns AuthResult or a Response (error).
 */
export async function resolveAuth(req: Request, roomId: string): Promise<AuthResult | Response> {
  const header = req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return UNAUTH;
  }
  return resolveAuthFromToken(header.slice(7), roomId);
}

/**
 * Resolve auth from a raw token string (no HTTP request needed).
 * Handles both legacy tokens (room_, view_, as_) and unified tokens (tok_).
 */
export async function resolveAuthFromToken(token: string, roomId: string): Promise<AuthResult | Response> {
  // ── Unified token path (tok_ prefix) ──
  if (token.startsWith("tok_") || token.startsWith("smcp_at_")) {
    return resolveUnifiedToken(token, roomId);
  }

  // ── Legacy paths (unchanged) ──
  const hash = await hashToken(token);

  // Check room token
  if (token.startsWith("room_")) {
    const roomResult = await sqlite.execute({
      sql: `SELECT id FROM rooms WHERE id = ? AND token_hash = ?`,
      args: [roomId, hash],
    });
    if (roomResult.rows.length > 0) {
      return { authenticated: true, kind: "room", agentId: null, roomId, grants: ["*"] };
    }
    return json({ error: "invalid_token", message: "room token does not match" }, 401);
  }

  // Check view token
  if (token.startsWith("view_")) {
    const roomResult = await sqlite.execute({
      sql: `SELECT id FROM rooms WHERE id = ? AND view_token_hash = ?`,
      args: [roomId, hash],
    });
    if (roomResult.rows.length > 0) {
      return { authenticated: true, kind: "view", agentId: null, roomId, grants: [] };
    }
    return json({ error: "invalid_token", message: "view token does not match" }, 401);
  }

  // Check agent token (as_ or any unknown prefix) — v8: tokens table
  const agentResult = await sqlite.execute({
    sql: `SELECT agent_id, scope, room_id FROM tokens WHERE token_hash = ? AND room_id = ? AND revoked = 0`,
    args: [hash, roomId],
  });
  if (agentResult.rows.length === 0) {
    return json({ error: "invalid_token", message: "bearer token does not match any agent in this room" }, 401);
  }
  const agentId = agentResult.rows[0][0] as string;
  // Derive grants from scope + agent_id
  let grants: string[] = [agentId];
  // Legacy compatibility: check if _agents scope has explicit grants
  try {
    const scopeResult = await sqlite.execute({
      sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_agents' AND key = ?`,
      args: [roomId, agentId],
    });
    if (scopeResult.rows.length > 0) {
      const def = JSON.parse(scopeResult.rows[0][0] as string);
      if (Array.isArray(def.grants) && def.grants.length > 0) {
        grants = [agentId, ...def.grants.filter((g: string) => g !== agentId)];
      }
    }
  } catch {}

  return { authenticated: true, kind: "agent", agentId, roomId, grants };
}

// ============ Unified token resolution (v7) ============

/**
 * Resolve a unified token (tok_ or smcp_at_) against the tokens table.
 *
 * Flow: token → tokens table → user_rooms → scope intersection → embodiment check.
 * Returns backward-compatible AuthResult with v7 extensions.
 */
async function resolveUnifiedToken(token: string, roomId: string): Promise<AuthResult | Response> {
  // Hash with the same algorithm mcp/db.ts uses (base64url SHA-256)
  const hash = await hashTokenB64(token);

  // 1. Token lookup
  const tokenResult = await sqlite.execute({
    sql: `SELECT id, minted_by, scope, room_id, agent_id
          FROM tokens
          WHERE token_hash = ? AND revoked = 0
            AND (expires_at IS NULL OR expires_at > datetime('now'))`,
    args: [hash],
  });

  // Also check legacy smcp_access_tokens for smcp_at_ backward compat
  if (tokenResult.rows.length === 0 && token.startsWith("smcp_at_")) {
    return resolveSmcpAccessToken(token, roomId, hash);
  }

  if (tokenResult.rows.length === 0) {
    return json({ error: "invalid_token", message: "token not found, expired, or revoked" }, 401);
  }

  const tok = {
    id: tokenResult.rows[0][0] as string,
    mintedBy: tokenResult.rows[0][1] as string,
    scope: tokenResult.rows[0][2] as string,
    roomId: tokenResult.rows[0][3] as string | null,
    agentId: tokenResult.rows[0][4] as string | null,
  };

  // 2. Scope check: does this token grant access to the requested room?
  const parsed = parseScope(tok.scope);
  const roomMatch = matchRoom(parsed, roomId);
  if (!roomMatch) {
    // Build stateless elevation URL for the agent to present to the user
    const elevateUrl = `https://sync.parc.land/auth/elevate?token_id=${encodeURIComponent(tok.id)}&room=${encodeURIComponent(roomId)}`;
    return json({
      error: "scope_denied",
      message: `Token scope does not include room "${roomId}"`,
      room: roomId,
      elevate: elevateUrl,
      hint: "Present the elevate URL to the user to request access, then retry.",
    }, 403);
  }

  // 3. User's actual room role
  const userRoomResult = await sqlite.execute({
    sql: `SELECT access FROM smcp_user_rooms WHERE user_id = ? AND room_id = ?`,
    args: [tok.mintedBy, roomId],
  });

  let userRole: ScopeLevel = "read"; // default if no user_rooms entry
  if (userRoomResult.rows.length > 0) {
    userRole = roleToLevel(userRoomResult.rows[0][0] as string);
  }

  // 4. Intersect scope with user's actual role
  const effectiveLevel = minLevel(roomMatch.level, userRole);

  // 5. Agent resolution
  let agentId = roomMatch.agentId ?? tok.agentId ?? null;

  // If no agent from scope, check embodiment
  if (!agentId) {
    const embodimentResult = await sqlite.execute({
      sql: `SELECT agent_id FROM smcp_embodiments
            WHERE session_hash = ? AND room_id = ?`,
      args: [hash, roomId],
    });
    if (embodimentResult.rows.length > 0) {
      agentId = embodimentResult.rows[0][0] as string;
    }
  }

  // 6. Map to backward-compatible AuthResult
  const isAdmin = scopeCanAdmin(effectiveLevel);
  const isWrite = scopeCanWrite(effectiveLevel);
  const isReadOnly = !isWrite;

  let kind: "room" | "view" | "agent";
  let grants: string[];

  if (isAdmin) {
    kind = "room";
    grants = ["*"];
  } else if (isReadOnly) {
    kind = "view";
    grants = [];
  } else if (agentId) {
    kind = "agent";
    grants = [agentId, "_shared"];
  } else {
    // Write-capable but no agent — treat as view until embodied
    kind = "view";
    grants = [];
  }

  return {
    authenticated: true,
    kind,
    agentId,
    roomId,
    grants,
    // v7 extensions
    userId: tok.mintedBy,
    tokenId: tok.id,
    role: effectiveLevel,
  };
}

/**
 * Backward-compat fallback: resolve smcp_at_ tokens from old smcp_access_tokens table.
 * This path exists so existing MCP sessions don't break during Phase 1.
 */
async function resolveSmcpAccessToken(token: string, roomId: string, _hash: string): Promise<AuthResult | Response> {
  // Delegate to the old MCP path — return as view-level (observe) for safety
  // The MCP handler will resolve embodiment separately
  const result = await sqlite.execute({
    sql: `SELECT user_id FROM smcp_access_tokens WHERE token = ? AND expires_at > datetime('now')`,
    args: [token],
  });
  if (result.rows.length === 0) {
    return json({ error: "invalid_token", message: "token not found or expired" }, 401);
  }
  const userId = result.rows[0][0] as string;

  // Check user_rooms
  const userRoomResult = await sqlite.execute({
    sql: `SELECT access FROM smcp_user_rooms WHERE user_id = ? AND room_id = ?`,
    args: [userId, roomId],
  });
  if (userRoomResult.rows.length === 0) {
    return { authenticated: true, kind: "view", agentId: null, roomId, grants: [], userId };
  }
  const role = userRoomResult.rows[0][0] as string;
  const level = roleToLevel(role);

  if (scopeCanAdmin(level)) {
    return { authenticated: true, kind: "room", agentId: null, roomId, grants: ["*"], userId };
  }
  return { authenticated: true, kind: "view", agentId: null, roomId, grants: [], userId };
}

// ============ Authorization checks ============

export function checkScopeAuthority(auth: AuthResult, scope: string): Response | null {
  if (!auth.authenticated) {
    return json({ error: "authentication_required", message: "include Authorization: Bearer <token>" }, 401);
  }
  if (auth.grants.includes("*")) return null;
  if (auth.grants.includes(scope)) return null;
  return json({
    error: "scope_denied",
    message: `no authority over scope "${scope}"`,
    grants: auth.grants,
    scope,
  }, 403);
}

export function assertIdentity(auth: AuthResult, claimedAgent: string | null): Response | null {
  if (!auth.authenticated) return null;
  if (!claimedAgent) return null;
  if (auth.kind === "room") return null;
  if (auth.agentId === claimedAgent) return null;
  return json({
    error: "identity_mismatch",
    message: `token belongs to "${auth.agentId}" but request claims "${claimedAgent}"`,
    authenticated_as: auth.agentId,
    claimed: claimedAgent,
  }, 403);
}

export function requireAuth(auth: AuthResult): Response | null {
  if (!auth.authenticated) {
    return json({ error: "authentication_required", message: "include Authorization: Bearer <token>" }, 401);
  }
  return null;
}

export function requireRoomToken(auth: AuthResult): Response | null {
  if (!auth.authenticated) {
    return json({ error: "authentication_required", message: "room token required" }, 401);
  }
  if (auth.kind !== "room" && !auth.grants.includes("*")) {
    return json({ error: "room_token_required", message: "this operation requires a room token or admin grants" }, 403);
  }
  return null;
}

export function requireWriteAuth(auth: AuthResult): Response | null {
  if (!auth.authenticated) {
    return json({ error: "authentication_required", message: "include Authorization: Bearer <token>" }, 401);
  }
  if (auth.kind === "view") {
    return json({ error: "read_only_token", message: "view tokens cannot perform mutations" }, 403);
  }
  return null;
}

export function hasFullReadAccess(auth: AuthResult): boolean {
  return auth.grants.includes("*") || auth.kind === "view";
}

// ============ Auto-heartbeat ============

export function touchAgent(roomId: string, agentId: string | null | undefined): void {
  if (!agentId) return;
  const now = new Date().toISOString();
  // Update token liveness (applies to all token types)
  sqlite.execute({
    sql: `UPDATE tokens SET last_used_at = ? WHERE room_id = ? AND agent_id = ? AND revoked = 0`,
    args: [now, roomId, agentId],
  }).catch(() => {});
  // Update _agents scope heartbeat
  sqlite.execute({
    sql: `UPDATE state SET
            value = json_set(value, '$.last_heartbeat', ?),
            revision = revision + 1, updated_at = ?
          WHERE room_id = ? AND scope = '_agents' AND key = ?`,
    args: [now, now, roomId, agentId],
  }).catch(() => {});
}

// ============ Direct agent auth (no token required) ============

export async function resolveAgentAuth(
  roomId: string, agentId: string,
): Promise<AuthResult | null> {
  // v8: Read grants from _agents scope
  const result = await sqlite.execute({
    sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_agents' AND key = ?`,
    args: [roomId, agentId],
  });
  if (result.rows.length === 0) return null;
  let grants: string[] = [agentId];
  try {
    const def = JSON.parse(result.rows[0][0] as string);
    if (Array.isArray(def.grants) && def.grants.length > 0) {
      grants = [agentId, ...def.grants.filter((g: string) => g !== agentId)];
    }
  } catch {}
  return {
    authenticated: true,
    kind: "agent",
    agentId,
    roomId,
    grants,
  };
}
