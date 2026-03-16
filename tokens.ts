/**
 * tokens.ts — Token management HTTP endpoints.
 *
 * POST /tokens       — Mint a scoped token (delegation, view, agent-bound)
 * GET  /tokens       — List your minted tokens
 * DELETE /tokens/:id — Revoke a token
 * PATCH /tokens/:id  — Update a token's scope (bounded by caller's scope)
 * POST /tokens/refresh — Refresh a token (exchange refresh_token for new access_token)
 *
 * All endpoints require a valid tok_ or smcp_at_ token in Authorization header
 * (except refresh which uses the refresh_token in the body).
 *
 * SECURITY: Minted/patched tokens cannot exceed the calling token's scope.
 * A narrow token cannot mint a wide one (no privilege escalation).
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import * as db from "./mcp/db.ts";
import { hashTokenB64 } from "./auth.ts";
import {
  parseScope, serializeScope, matchRoom, roleToLevel, minLevel,
  scopeSubsumes, type ParsedScope,
} from "./mcp/scope.ts";
import { json, rows2objects } from "./utils.ts";

// ─── Caller resolution ──────────────────────────────────────────

interface CallerInfo {
  userId: string;
  /** Parsed scope of the calling token. null = unrestricted (legacy smcp_at_ or session). */
  scope: ParsedScope | null;
}

/**
 * Resolve the calling user + their token's scope from a bearer token.
 * Returns null if unauthenticated.
 */
async function resolveCaller(req: Request): Promise<CallerInfo | null> {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);

  // Check unified tokens table
  const hash = await hashTokenB64(token);
  const tok = await db.validateTokenByHash(hash);
  if (tok) {
    return { userId: tok.mintedBy, scope: parseScope(tok.scope) };
  }

  // Fallback: check smcp_access_tokens for backward compat
  // Legacy tokens have no structured scope — treat as unrestricted
  if (token.startsWith("smcp_at_")) {
    const res = await sqlite.execute({
      sql: `SELECT user_id FROM smcp_access_tokens WHERE token = ? AND expires_at > datetime('now')`,
      args: [token],
    });
    if (res.rows.length > 0) {
      return { userId: res.rows[0][0] as string, scope: null };
    }
  }

  return null;
}

// ─── Shared validation ──────────────────────────────────────────

/**
 * Validate that a requested scope is within bounds:
 * 1. User must have access to all rooms (user_rooms check)
 * 2. New scope must not exceed calling token's scope (subsumption check)
 */
async function validateScope(
  userId: string,
  callerScope: ParsedScope | null,
  requestedScope: string,
): Promise<Response | null> {
  const parsed = parseScope(requestedScope);

  // Check 1: user_rooms — user must actually have access to named rooms
  for (const [rId] of parsed.rooms) {
    const userRoom = await sqlite.execute({
      sql: `SELECT access FROM smcp_user_rooms WHERE user_id = ? AND room_id = ?`,
      args: [userId, rId],
    });
    if (userRoom.rows.length === 0) {
      return json({
        error: "scope_exceeds_access",
        message: `You don't have access to room "${rId}"`,
        room: rId,
      }, 403);
    }
  }

  // Check 2: token subsumption — new scope ≤ caller's scope
  if (callerScope) {
    const check = scopeSubsumes(callerScope, parsed);
    if (!check.ok) {
      return json({
        error: "scope_exceeds_token",
        message: check.reason,
        hint: "A token cannot grant more access than it has itself.",
      }, 403);
    }
  }
  // callerScope === null means legacy/unrestricted — skip subsumption

  return null; // all good
}

// ═══════════════════════════════════════════════════════════════════
// POST /tokens — Mint a scoped token
// ═══════════════════════════════════════════════════════════════════

export async function handleMintToken(req: Request): Promise<Response> {
  const caller = await resolveCaller(req);
  if (!caller) return json({ error: "authentication_required" }, 401);

  const body = await req.json();
  const scope = body.scope;
  if (!scope || typeof scope !== "string") {
    return json({ error: "scope is required (e.g., 'rooms:my-room:agent:alice')" }, 400);
  }

  const label = body.label ?? null;
  const expiresIn = body.expires_in ?? null;
  const roomId = body.room_id ?? null;
  const agentId = body.agent_id ?? null;

  // Validate scope against user access AND calling token
  const scopeError = await validateScope(caller.userId, caller.scope, scope);
  if (scopeError) return scopeError;

  // Validate: if agent-bound, the agent must exist
  const parsed = parseScope(scope);
  const agentBound = agentId ?? (() => {
    for (const [, rs] of parsed.rooms) {
      if (rs.agent) return rs.agent;
    }
    return null;
  })();
  if (agentBound && roomId) {
    const agentCheck = await sqlite.execute({
      sql: `SELECT id FROM agents WHERE id = ? AND room_id = ?`,
      args: [agentBound, roomId],
    });
    if (agentCheck.rows.length === 0) {
      return json({
        error: "agent_not_found",
        message: `Agent "${agentBound}" not found in room "${roomId}"`,
      }, 404);
    }
  }

  const result = await db.mintToken({
    userId: caller.userId,
    scope,
    label,
    roomId,
    agentId: agentBound,
    expiresInSec: expiresIn ?? undefined,
    withRefresh: !!body.with_refresh,
  });

  return json({
    id: result.id,
    token: result.token,
    refresh_token: result.refreshToken ?? undefined,
    scope,
    label,
    room_id: roomId,
    agent_id: agentBound,
    expires_at: result.expiresAt,
  }, 201);
}

// ═══════════════════════════════════════════════════════════════════
// GET /tokens — List your minted tokens
// ═══════════════════════════════════════════════════════════════════

export async function handleListTokens(req: Request): Promise<Response> {
  const caller = await resolveCaller(req);
  if (!caller) return json({ error: "authentication_required" }, 401);

  const tokens = await db.listUserTokens(caller.userId);

  return json({
    tokens: tokens.map(t => ({
      id: t.id,
      scope: t.scope,
      label: t.label,
      room_id: t.roomId,
      agent_id: t.agentId,
      client_id: t.clientId,
      revoked: t.revoked,
      expires_at: t.expiresAt,
      created_at: t.createdAt,
    })),
  });
}

// ═══════════════════════════════════════════════════════════════════
// DELETE /tokens/:id — Revoke a token
// ═══════════════════════════════════════════════════════════════════

export async function handleRevokeToken(req: Request, tokenId: string): Promise<Response> {
  const caller = await resolveCaller(req);
  if (!caller) return json({ error: "authentication_required" }, 401);

  const ok = await db.revokeToken(tokenId, caller.userId);
  if (!ok) return json({ error: "not_found", message: "Token not found or not owned by you" }, 404);

  return json({ revoked: true, id: tokenId });
}

// ═══════════════════════════════════════════════════════════════════
// PATCH /tokens/:id — Update a token's scope (bounded by caller's scope)
// ═══════════════════════════════════════════════════════════════════

export async function handleUpdateToken(req: Request, tokenId: string): Promise<Response> {
  const caller = await resolveCaller(req);
  if (!caller) return json({ error: "authentication_required" }, 401);

  const body = await req.json();
  const newScope = body.scope;
  if (!newScope || typeof newScope !== "string") {
    return json({ error: "scope is required" }, 400);
  }

  // Fetch the existing token — must be owned by caller
  const existing = await sqlite.execute({
    sql: `SELECT id, scope, label, minted_by, revoked FROM tokens WHERE id = ? AND minted_by = ?`,
    args: [tokenId, caller.userId],
  });
  if (existing.rows.length === 0) {
    return json({ error: "not_found", message: "Token not found or not owned by you" }, 404);
  }
  if (existing.rows[0][4] === 1) {
    return json({ error: "token_revoked", message: "Cannot update a revoked token" }, 409);
  }

  const oldScope = existing.rows[0][1] as string;

  // Validate new scope against user access AND calling token
  const scopeError = await validateScope(caller.userId, caller.scope, newScope);
  if (scopeError) return scopeError;

  // Update the scope
  await sqlite.execute({
    sql: `UPDATE tokens SET scope = ? WHERE id = ?`,
    args: [newScope, tokenId],
  });

  // Optionally update label
  if (body.label !== undefined) {
    await sqlite.execute({
      sql: `UPDATE tokens SET label = ? WHERE id = ?`,
      args: [body.label, tokenId],
    });
  }

  return json({
    id: tokenId,
    scope: newScope,
    label: body.label ?? existing.rows[0][2],
    previous_scope: oldScope,
  });
}

// ═══════════════════════════════════════════════════════════════════
// POST /tokens/refresh — Exchange refresh_token for new access_token
// ═══════════════════════════════════════════════════════════════════

export async function handleRefreshToken(req: Request): Promise<Response> {
  let body: Record<string, string>;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    body = Object.fromEntries(new URLSearchParams(text));
  } else {
    body = await req.json();
  }

  const refreshToken = body.refresh_token;
  if (!refreshToken) {
    return json({ error: "invalid_request", error_description: "refresh_token required" }, 400);
  }

  const refreshHash = await hashTokenB64(refreshToken);
  const result = await db.refreshUnifiedToken(refreshHash);
  if (!result) {
    return json({ error: "invalid_grant", error_description: "Invalid or expired refresh token" }, 400);
  }

  return json({
    access_token: result.token,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: result.refreshToken,
  });
}

// ═══════════════════════════════════════════════════════════════════
// POST /rooms/:id/invite — Invite a user to a room
// ═══════════════════════════════════════════════════════════════════

export async function handleInvite(req: Request, roomId: string, body?: any): Promise<Response> {
  const caller = await resolveCaller(req);
  if (!caller) return json({ error: "authentication_required" }, 401);

  // Check the caller is an owner
  const callerRoom = await sqlite.execute({
    sql: `SELECT access FROM smcp_user_rooms WHERE user_id = ? AND room_id = ?`,
    args: [caller.userId, roomId],
  });
  if (callerRoom.rows.length === 0 || callerRoom.rows[0][0] !== "owner") {
    return json({ error: "not_owner", message: "Only room owners can invite users" }, 403);
  }

  if (!body) body = await req.json();
  const { username, role } = body;
  if (!username) return json({ error: "username is required" }, 400);

  const validRoles = ["owner", "collaborator", "participant", "observer"];
  const targetRole = role ?? "participant";
  if (!validRoles.includes(targetRole)) {
    return json({ error: "invalid_role", valid: validRoles }, 400);
  }

  // Look up user by username
  const targetUser = await db.getUserByUsername(username);
  if (!targetUser) {
    return json({ error: "user_not_found", message: `No user with username "${username}"` }, 404);
  }

  await db.inviteUserToRoom(targetUser.id, roomId, targetRole, caller.userId, body.label);

  return json({ invited: true, username, room: roomId, role: targetRole });
}


// ═══════════════════════════════════════════════════════════════════
// POST /rooms/:id/claim — Claim an orphaned room
// ═══════════════════════════════════════════════════════════════════

/**
 * Claim a room that has no owners in user_rooms. This handles rooms
 * created via the HTTP API before unified auth existed (e.g., cartographers).
 *
 * Rules:
 * - If room has NO user_rooms entries: any authenticated user can claim as owner
 * - If room has owners but you have the room_ token: claim as owner
 * - Otherwise: denied
 */
export async function handleClaim(req: Request, roomId: string, body?: any): Promise<Response> {
  const caller = await resolveCaller(req);
  if (!caller) return json({ error: "authentication_required" }, 401);

  // Verify room exists
  const roomCheck = await sqlite.execute({
    sql: `SELECT id FROM rooms WHERE id = ?`,
    args: [roomId],
  });
  if (roomCheck.rows.length === 0) {
    return json({ error: "room_not_found" }, 404);
  }

  // Check for existing owners
  const ownerCheck = await sqlite.execute({
    sql: `SELECT user_id FROM smcp_user_rooms WHERE room_id = ?`,
    args: [roomId],
  });

  if (ownerCheck.rows.length > 0) {
    // Room already has users — check if caller has the room_ token
    if (!body) try { body = await req.json(); } catch { body = {}; }
    const roomToken = body?.room_token;
    if (!roomToken) {
      return json({
        error: "already_owned",
        message: "Room already has users. Provide room_token to claim, or ask an owner to invite you.",
        existing_users: ownerCheck.rows.length,
      }, 403);
    }
    // Verify room token
    const { hashToken } = await import("./auth.ts");
    const hash = await hashToken(roomToken);
    const tokenCheck = await sqlite.execute({
      sql: `SELECT id FROM rooms WHERE id = ? AND token_hash = ?`,
      args: [roomId, hash],
    });
    if (tokenCheck.rows.length === 0) {
      return json({ error: "invalid_room_token" }, 401);
    }
  }

  // Claim as owner
  const label = body?.label ?? `Claimed: ${roomId}`;
  await sqlite.execute({
    sql: `INSERT INTO smcp_user_rooms (user_id, room_id, access, label)
          VALUES (?, ?, 'owner', ?)
          ON CONFLICT(user_id, room_id) DO UPDATE SET access = 'owner'`,
    args: [caller.userId, roomId, label],
  });

  return json({ claimed: true, room: roomId, role: "owner" });
}
