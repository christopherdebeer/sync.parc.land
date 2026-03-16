/**
 * agents.ts — Agent lifecycle management.
 *
 * v8: Agent presence in _agents scope, auth tokens in tokens table.
 * Legacy agents table removed from write path.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { json, rows2objects } from "./utils.ts";
import { generateToken, hashToken } from "./auth.ts";
import { validateCel } from "./cel.ts";
import { appendStructuralEvent } from "./audit.ts";

export async function joinRoom(roomId: string, body: any, req: Request) {
  const id = body.id ?? crypto.randomUUID();
  const name = body.name ?? "anonymous";
  const role = body.role ?? "agent";
  const meta = body.meta ?? {};
  const enabled_expr = body.enabled ?? null;
  const token = generateToken("as");
  const hash = await hashToken(token);

  if (enabled_expr) {
    const v = validateCel(enabled_expr);
    if (!v.valid) return json({ error: "invalid_cel", field: "enabled", detail: v.error }, 400);
  }

  // Check for existing agent — re-join requires matching token
  const existingToken = await sqlite.execute({
    sql: `SELECT token_hash FROM tokens WHERE room_id = ? AND agent_id = ? AND revoked = 0 LIMIT 1`,
    args: [roomId, id],
  });
  if (existingToken.rows.length > 0) {
    const existingHash = existingToken.rows[0][0] as string;
    const header = req.headers.get("Authorization");
    if (!header || !header.startsWith("Bearer ")) {
      return json({ error: "agent_exists", message: `agent "${id}" already registered — include Authorization: Bearer <token> to re-join`, agent: id }, 409);
    }
    const callerToken = header.slice(7);
    const callerHash = await hashToken(callerToken);
    if (callerHash !== existingHash) {
      // Check if it's a room token
      const roomCheck = await sqlite.execute({
        sql: `SELECT id FROM rooms WHERE id = ? AND token_hash = ?`,
        args: [roomId, callerHash],
      });
      if (roomCheck.rows.length === 0) {
        return json({ error: "invalid_token", message: `token does not match agent "${id}" — cannot re-join`, agent: id }, 401);
      }
    }
    // Re-join: revoke old token, mint new one
    await sqlite.execute({
      sql: `UPDATE tokens SET revoked = 1 WHERE room_id = ? AND agent_id = ? AND revoked = 0`,
      args: [roomId, id],
    });
  }

  // Create token in tokens table
  const tokenId = `agent_${roomId}_${id}_${Date.now()}`;
  const scope = `rooms:${roomId}:agent:${id}:write`;
  await sqlite.execute({
    sql: `INSERT INTO tokens (id, token_hash, minted_by, scope, room_id, agent_id, label, last_used_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    args: [tokenId, hash, "agent_join", scope, roomId, id, `Agent ${name}`],
  });

  const now = new Date().toISOString();

  // Write to _agents scope (single source of truth for presence)
  const agentDef = {
    name, role, status: "active",
    grants: [], last_heartbeat: now,
    joined_at: now, token_id: tokenId,
    last_seen_seq: 0,
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
          VALUES (?, '_agents', ?, ?, '', 1, datetime('now'))
          ON CONFLICT(room_id, scope, key) DO UPDATE SET
            value = excluded.value, revision = state.revision + 1, updated_at = datetime('now')`,
    args: [roomId, id, JSON.stringify(agentDef)],
  });

  // Inline initial state
  if (body.state && typeof body.state === "object") {
    const statements: any[] = [];
    for (const [key, value] of Object.entries(body.state)) {
      const strValue = typeof value === "string" ? value : JSON.stringify(value);
      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, value, version, updated_at)
              VALUES (?, ?, ?, ?, 1, datetime('now'))
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = version + 1, updated_at = datetime('now')`,
        args: [roomId, id, key, strValue],
      });
      if (body.public_keys?.includes(key)) {
        const viewId = `${id}.${key}`;
        const expr = `state["${id}"]["${key}"]`;
        const viewDef = JSON.stringify({
          expr, description: `auto: ${id}.${key}`, scope: id,
          registered_by: id, deps: [], render: null, enabled: null, timer: null,
        });
        statements.push({
          sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
                VALUES (?, '_views', ?, ?, '', 1, datetime('now'))
                ON CONFLICT(room_id, scope, key) DO UPDATE SET
                  value = excluded.value, revision = state.revision + 1, updated_at = datetime('now')`,
          args: [roomId, viewId, viewDef],
        });
      }
    }
    if (statements.length > 0) await sqlite.batch(statements);
  }

  // Inline views (v8: _views scope only)
  if (Array.isArray(body.views)) {
    const viewStatements: any[] = [];
    for (const v of body.views) {
      if (!v.id || !v.expr) continue;
      const vv = validateCel(v.expr);
      if (!vv.valid) continue;
      const viewDef = JSON.stringify({
        expr: v.expr, description: v.description ?? null, scope: id,
        registered_by: id, deps: [], render: null, enabled: null, timer: null,
      });
      viewStatements.push({
        sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
              VALUES (?, '_views', ?, ?, '', 1, datetime('now'))
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, revision = state.revision + 1, updated_at = datetime('now')`,
        args: [roomId, v.id, viewDef],
      });
    }
    if (viewStatements.length > 0) await sqlite.batch(viewStatements);
  }

  appendStructuralEvent(roomId, "agent_join", id, {
    id, name, role, grants: [],
    state: body.state && typeof body.state === "object" ? body.state : undefined,
  }).catch(() => {});

  return json({
    id, room_id: roomId, name, role, joined_at: now,
    meta: JSON.stringify(meta), last_heartbeat: now,
    status: "active", waiting_on: null, enabled_expr: null,
    grants: "[]", last_seen_seq: 0, token,
  }, 201);
}

/** Create or re-activate an agent without HTTP request auth.
 *  Trust boundary: caller is responsible for authorization.
 *  Used by MCP embodiment where trust source is smcp_user_rooms, not a room token. */
export async function insertAgentDirect(
  roomId: string,
  params: {
    id: string;
    name: string;
    role?: string;
    meta?: Record<string, any>;
    grants?: string[];
    state?: Record<string, any>;
    publicKeys?: string[];
    views?: Array<{ id: string; expr: string; description?: string }>;
  },
): Promise<{ agentId: string; token: string }> {
  const id = params.id;
  const name = params.name;
  const role = params.role ?? "agent";
  const meta = params.meta ?? {};
  const grants = params.grants ?? [];
  const token = generateToken("as");
  const hash = await hashToken(token);

  // Revoke existing tokens for this agent
  await sqlite.execute({
    sql: `UPDATE tokens SET revoked = 1 WHERE room_id = ? AND agent_id = ? AND revoked = 0`,
    args: [roomId, id],
  });

  // Create token
  const tokenId = `agent_${roomId}_${id}_${Date.now()}`;
  const scope = `rooms:${roomId}:agent:${id}:write`;
  await sqlite.execute({
    sql: `INSERT INTO tokens (id, token_hash, minted_by, scope, room_id, agent_id, label, last_used_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    args: [tokenId, hash, "mcp_embody", scope, roomId, id, `Agent ${name}`],
  });

  const now = new Date().toISOString();

  // Write to _agents scope
  const agentDef = {
    name, role, status: "active",
    grants, last_heartbeat: now,
    joined_at: now, token_id: tokenId,
    last_seen_seq: 0,
    ...(Object.keys(meta).length > 0 ? { meta } : {}),
  };
  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
          VALUES (?, '_agents', ?, ?, '', 1, datetime('now'))
          ON CONFLICT(room_id, scope, key) DO UPDATE SET
            value = excluded.value, revision = state.revision + 1, updated_at = datetime('now')`,
    args: [roomId, id, JSON.stringify(agentDef)],
  });

  // Inline initial state
  if (params.state && typeof params.state === "object") {
    const stmts: any[] = [];
    for (const [key, value] of Object.entries(params.state)) {
      const strValue = typeof value === "string" ? value : JSON.stringify(value);
      stmts.push({
        sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
              VALUES (?, ?, ?, ?, '', 1, datetime('now'))
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, revision = state.revision + 1, updated_at = datetime('now')`,
        args: [roomId, id, key, strValue],
      });
      if (params.publicKeys?.includes(key)) {
        const viewId = `${id}.${key}`;
        const expr = `state["${id}"]["${key}"]`;
        const viewDef = JSON.stringify({
          expr, description: `auto: ${id}.${key}`, scope: id,
          registered_by: id, deps: [], render: null, enabled: null, timer: null,
        });
        stmts.push({
          sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
                VALUES (?, '_views', ?, ?, '', 1, datetime('now'))
                ON CONFLICT(room_id, scope, key) DO UPDATE SET
                  value = excluded.value, revision = state.revision + 1, updated_at = datetime('now')`,
          args: [roomId, viewId, viewDef],
        });
      }
    }
    if (stmts.length > 0) await sqlite.batch(stmts);
  }

  // Inline views (v8: _views scope only)
  if (Array.isArray(params.views)) {
    const stmts: any[] = [];
    for (const v of params.views) {
      if (!v.id || !v.expr) continue;
      const viewDef = JSON.stringify({
        expr: v.expr, description: v.description ?? null, scope: id,
        registered_by: id, deps: [], render: null, enabled: null, timer: null,
      });
      stmts.push({
        sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
              VALUES (?, '_views', ?, ?, '', 1, datetime('now'))
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, revision = state.revision + 1, updated_at = datetime('now')`,
        args: [roomId, v.id, viewDef],
      });
    }
    if (stmts.length > 0) await sqlite.batch(stmts);
  }

  return { agentId: id, token };
}

export async function updateAgent(roomId: string, agentId: string, body: any) {
  // Read current _agents scope entry
  const existing = await sqlite.execute({
    sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_agents' AND key = ?`,
    args: [roomId, agentId],
  });
  if (existing.rows.length === 0) return json({ error: "agent not found" }, 404);
  let current: any = {};
  try { current = JSON.parse(existing.rows[0][0] as string); } catch {}

  // Apply updates
  if (body.grants !== undefined) current.grants = body.grants;
  if (body.role !== undefined) current.role = body.role;
  if (body.name !== undefined) current.name = body.name;
  if (body.meta !== undefined) current.meta = body.meta;

  await sqlite.execute({
    sql: `UPDATE state SET value = ?, revision = revision + 1, updated_at = datetime('now')
          WHERE room_id = ? AND scope = '_agents' AND key = ?`,
    args: [JSON.stringify(current), roomId, agentId],
  });

  const changes: Record<string, any> = {};
  if (body.grants !== undefined) changes.grants = body.grants;
  if (body.role !== undefined) changes.role = body.role;
  if (body.name !== undefined) changes.name = body.name;
  appendStructuralEvent(roomId, "agent_update", agentId, { id: agentId, changes }).catch(() => {});

  // Return compatible shape
  return json({
    id: agentId, room_id: roomId, name: current.name, role: current.role,
    status: current.status, last_heartbeat: current.last_heartbeat,
    grants: JSON.stringify(current.grants ?? []), joined_at: current.joined_at,
  });
}


// ── Shared helpers used by MCP tools ──

/** Release an agent: set idle and clear any role filled_by referencing it.
 *  Used by embody (switch), disembody, restrict_scope, revoke_access. */
export async function releaseAgent(roomId: string, agentId: string) {
  // Update _agents scope entry
  try {
    const result = await sqlite.execute({
      sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_agents' AND key = ?`,
      args: [roomId, agentId],
    });
    if (result.rows.length > 0) {
      const current = JSON.parse(result.rows[0][0] as string);
      current.status = "idle";
      delete current.waiting_on;
      await sqlite.execute({
        sql: `UPDATE state SET value = ?, revision = revision + 1, updated_at = datetime('now')
              WHERE room_id = ? AND scope = '_agents' AND key = ?`,
        args: [JSON.stringify(current), roomId, agentId],
      });
    }
  } catch {}
  // Clear role filled_by
  await sqlite.execute({
    sql: `UPDATE state SET
            value = json_set(value, '$.filled_by', json('null')),
            revision = revision + 1, updated_at = datetime('now')
          WHERE room_id = ? AND scope = '_shared' AND key LIKE 'roles.%'
          AND json_extract(value, '$.filled_by') = ?`,
    args: [roomId, agentId],
  });
}

/** Fetch role definitions from _shared state for a room.
 *  Returns a map of roleId → parsed role definition object. */
export async function fetchRoomRoles(roomId: string): Promise<Record<string, any>> {
  const rolesResult = await sqlite.execute({
    sql: `SELECT key, value FROM state
          WHERE room_id = ? AND scope = '_shared' AND key LIKE 'roles.%'`,
    args: [roomId],
  });
  const roles: Record<string, any> = {};
  for (const r of rolesResult.rows) {
    const roleId = (r[0] as string).replace("roles.", "");
    try { roles[roleId] = JSON.parse(r[1] as string); } catch {}
  }
  return roles;
}
