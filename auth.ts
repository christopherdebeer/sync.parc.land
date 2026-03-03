import { sqlite } from "https://esm.town/v/std/sqlite";

/**
 * Auth module for agent-sync v5.
 *
 * Three identity layers:
 * - Room token: returned at room creation, `*` scope authority (admin)
 * - View token: returned at room creation, read-all authority (observer)
 * - Agent token: returned at agent join, own-scope authority
 * - Scope grants: additional scopes granted by room token holder
 *
 * Token prefixes: `room_` for room tokens, `view_` for view tokens, `as_` for agent tokens.
 */

// ============ Token generation and hashing ============

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
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
}

const UNAUTH: AuthResult = { authenticated: false, kind: null, agentId: null, roomId: null, grants: [] };

/**
 * Resolve auth from request headers. Returns AuthResult or a Response (error).
 *
 * Room tokens get `*` grants. Agent tokens get own scope + explicit grants.
 */
export async function resolveAuth(req: Request, roomId: string): Promise<AuthResult | Response> {
  const header = req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return UNAUTH;
  }
  const token = header.slice(7);
  const hash = await hashToken(token);

  // Check room token first
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

  // Check agent token
  const agentResult = await sqlite.execute({
    sql: `SELECT id, grants FROM agents WHERE token_hash = ? AND room_id = ?`,
    args: [hash, roomId],
  });
  if (agentResult.rows.length === 0) {
    return json({ error: "invalid_token", message: "bearer token does not match any agent in this room" }, 401);
  }
  const agentId = agentResult.rows[0][0] as string;
  const grantsJson = agentResult.rows[0][1] as string;
  let grants: string[] = [];
  try { grants = JSON.parse(grantsJson); } catch { grants = []; }
  // Agent always has own scope
  if (!grants.includes(agentId)) grants = [agentId, ...grants];

  return { authenticated: true, kind: "agent", agentId, roomId, grants };
}

// ============ Authorization checks ============

/**
 * Check if auth identity can direct-write to a given scope.
 * Returns null if allowed, or a Response (403) if denied.
 */
export function checkScopeAuthority(auth: AuthResult, scope: string): Response | null {
  if (!auth.authenticated) {
    return json({ error: "authentication_required", message: "include Authorization: Bearer <token>" }, 401);
  }
  // `*` grant = admin
  if (auth.grants.includes("*")) return null;
  // Direct scope match
  if (auth.grants.includes(scope)) return null;
  // _shared is not writable by default agents (must have explicit grant)
  // Agent's own scope is always in grants
  return json({
    error: "scope_denied",
    message: `no authority over scope "${scope}"`,
    grants: auth.grants,
    scope,
  }, 403);
}

/**
 * Assert that a token holder matches a claimed agent identity.
 * Returns null if OK, or a Response (403) if mismatch.
 * Skips check if not authenticated (for backward compat during migration).
 */
export function assertIdentity(auth: AuthResult, claimedAgent: string | null): Response | null {
  if (!auth.authenticated) return null;
  if (!claimedAgent) return null;
  if (auth.kind === "room") return null; // room tokens can act as any agent
  if (auth.agentId === claimedAgent) return null;
  return json({
    error: "identity_mismatch",
    message: `token belongs to "${auth.agentId}" but request claims "${claimedAgent}"`,
    authenticated_as: auth.agentId,
    claimed: claimedAgent,
  }, 403);
}

/**
 * Require authentication. Returns null if OK, or 401 Response.
 */
export function requireAuth(auth: AuthResult): Response | null {
  if (!auth.authenticated) {
    return json({ error: "authentication_required", message: "include Authorization: Bearer <token>" }, 401);
  }
  return null;
}

/**
 * Require room token. Returns null if OK, or 403 Response.
 */
export function requireRoomToken(auth: AuthResult): Response | null {
  if (!auth.authenticated) {
    return json({ error: "authentication_required", message: "room token required" }, 401);
  }
  if (auth.kind !== "room" && !auth.grants.includes("*")) {
    return json({ error: "room_token_required", message: "this operation requires a room token or admin grants" }, 403);
  }
  return null;
}

/**
 * Require write-capable auth (room or agent token). Blocks view tokens.
 * Returns null if OK, or a Response (401/403).
 */
export function requireWriteAuth(auth: AuthResult): Response | null {
  if (!auth.authenticated) {
    return json({ error: "authentication_required", message: "include Authorization: Bearer <token>" }, 401);
  }
  if (auth.kind === "view") {
    return json({ error: "read_only_token", message: "view tokens cannot perform mutations" }, 403);
  }
  return null;
}

/**
 * Check if auth has full read access (admin or view token).
 */
export function hasFullReadAccess(auth: AuthResult): boolean {
  return auth.grants.includes("*") || auth.kind === "view";
}

// ============ Auto-heartbeat ============

export function touchAgent(roomId: string, agentId: string | null | undefined): void {
  if (!agentId) return;
  sqlite.execute({
    sql: `UPDATE agents SET last_heartbeat = datetime('now')
          WHERE id = ? AND room_id = ? AND status != 'done'`,
    args: [agentId, roomId],
  }).catch(() => {});
}

// ============ Helpers ============

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
