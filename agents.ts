/**
 * agents.ts — Agent lifecycle management.
 *
 * Handles agent join (HTTP + direct), update, and initial state/view setup.
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
  const meta = JSON.stringify(body.meta ?? {});
  const enabled_expr = body.enabled ?? null;
  const token = generateToken("as");
  const hash = await hashToken(token);

  if (enabled_expr) {
    const v = validateCel(enabled_expr);
    if (!v.valid) return json({ error: "invalid_cel", field: "enabled", detail: v.error }, 400);
  }

  // Check for existing agent
  const existing = await sqlite.execute({
    sql: `SELECT id, token_hash FROM agents WHERE id = ? AND room_id = ?`,
    args: [id, roomId],
  });
  if (existing.rows.length > 0) {
    const existingHash = existing.rows[0][1];
    if (existingHash) {
      const header = req.headers.get("Authorization");
      if (!header || !header.startsWith("Bearer ")) {
        return json({ error: "agent_exists", message: `agent "${id}" already registered — include Authorization: Bearer <token> to re-join`, agent: id }, 409);
      }
      const callerToken = header.slice(7);
      const callerHash = await hashToken(callerToken);
      // Allow re-join with matching agent token OR room token
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
    }
  }

  await sqlite.execute({
    sql: `INSERT OR REPLACE INTO agents (id, room_id, name, role, meta, last_heartbeat, status, token_hash, grants, last_seen_seq, enabled_expr)
          VALUES (?, ?, ?, ?, ?, datetime('now'), 'active', ?, '[]', 0, ?)`,
    args: [id, roomId, name, role, meta, hash, enabled_expr],
  });

  // Inline initial state: write to agent's own scope
  if (body.state && typeof body.state === "object") {
    const statements: any[] = [];
    for (const [key, value] of Object.entries(body.state)) {
      const strValue = typeof value === "string" ? value : JSON.stringify(value);
      const isPublic = body.public_keys?.includes(key);
      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, value, version, updated_at)
              VALUES (?, ?, ?, ?, 1, datetime('now'))
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = version + 1, updated_at = datetime('now')`,
        args: [roomId, id, key, strValue],
      });
      // Auto-view for keys listed in public_keys
      if (isPublic) {
        const viewId = `${id}.${key}`;
        const expr = `state["${id}"]["${key}"]`;
        statements.push({
          sql: `INSERT INTO views (id, room_id, scope, description, expr, registered_by, version)
                VALUES (?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(id, room_id) DO UPDATE SET
                  expr = excluded.expr, scope = excluded.scope,
                  registered_by = excluded.registered_by,
                  version = views.version + 1`,
          args: [viewId, roomId, id, `auto: ${id}.${key}`, expr, id],
        });
      }
    }
    if (statements.length > 0) await sqlite.batch(statements);
  }

  // Inline views: register views scoped to this agent
  if (Array.isArray(body.views)) {
    const viewStatements: any[] = [];
    for (const v of body.views) {
      if (!v.id || !v.expr) continue;
      const vv = validateCel(v.expr);
      if (!vv.valid) continue; // skip invalid, don't block join
      viewStatements.push({
        sql: `INSERT INTO views (id, room_id, scope, description, expr, registered_by, version)
              VALUES (?, ?, ?, ?, ?, ?, 1)
              ON CONFLICT(id, room_id) DO UPDATE SET
                expr = excluded.expr, scope = excluded.scope, description = excluded.description,
                registered_by = excluded.registered_by,
                version = views.version + 1`,
        args: [v.id, roomId, id, v.description ?? null, v.expr, id],
      });
    }
    if (viewStatements.length > 0) await sqlite.batch(viewStatements);
  }

  const result = await sqlite.execute({
    sql: `SELECT * FROM agents WHERE id = ? AND room_id = ?`,
    args: [id, roomId],
  });
  const agent = rows2objects(result)[0];
  delete agent.token_hash;
  appendStructuralEvent(roomId, "agent_join", id, {
    id, name, role, grants: [],
    state: body.state && typeof body.state === "object" ? body.state : undefined,
  }).catch(() => {});
  return json({ ...agent, token }, 201);
}

/** Create or re-activate an agent without HTTP request auth.
 *  Trust boundary: caller is responsible for authorization.
 *  Used by MCP embodiment where trust source is smcp_user_rooms, not a room token.
 *  Returns the agent ID and raw token. */
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
  const meta = JSON.stringify(params.meta ?? {});
  const grants = JSON.stringify(params.grants ?? []);
  const token = generateToken("as");
  const hash = await hashToken(token);

  await sqlite.execute({
    sql: `INSERT OR REPLACE INTO agents
            (id, room_id, name, role, meta, last_heartbeat, status,
             token_hash, grants, last_seen_seq)
          VALUES (?, ?, ?, ?, ?, datetime('now'), 'active', ?, ?, 0)`,
    args: [id, roomId, name, role, meta, hash, grants],
  });

  // Inline initial state
  if (params.state && typeof params.state === "object") {
    const stmts: any[] = [];
    for (const [key, value] of Object.entries(params.state)) {
      const strValue = typeof value === "string" ? value : JSON.stringify(value);
      stmts.push({
        sql: `INSERT INTO state (room_id, scope, key, value, version,
                revision, updated_at)
              VALUES (?, ?, ?, ?, '', 1, datetime('now'))
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, revision = state.revision + 1,
                updated_at = datetime('now')`,
        args: [roomId, id, key, strValue],
      });
      if (params.publicKeys?.includes(key)) {
        const viewId = `${id}.${key}`;
        const expr = `state["${id}"]["${key}"]`;
        stmts.push({
          sql: `INSERT INTO views (id, room_id, scope, description, expr,
                  registered_by, version)
                VALUES (?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(id, room_id) DO UPDATE SET
                  expr = excluded.expr, version = views.version + 1`,
          args: [viewId, roomId, id, `auto: ${id}.${key}`, expr, id],
        });
      }
    }
    if (stmts.length > 0) await sqlite.batch(stmts);
  }

  // Inline views
  if (Array.isArray(params.views)) {
    const stmts: any[] = [];
    for (const v of params.views) {
      if (!v.id || !v.expr) continue;
      stmts.push({
        sql: `INSERT INTO views (id, room_id, scope, description, expr,
                registered_by, version)
              VALUES (?, ?, ?, ?, ?, ?, 1)
              ON CONFLICT(id, room_id) DO UPDATE SET
                expr = excluded.expr, description = excluded.description,
                version = views.version + 1`,
        args: [v.id, roomId, id, v.description ?? null, v.expr, id],
      });
    }
    if (stmts.length > 0) await sqlite.batch(stmts);
  }

  return { agentId: id, token };
}

export async function updateAgent(roomId: string, agentId: string, body: any) {
  // Only room token / admin can update grants and role
  const sets: string[] = [];
  const args: any[] = [];
  if (body.grants !== undefined) {
    sets.push("grants = ?");
    args.push(JSON.stringify(body.grants));
  }
  if (body.role !== undefined) {
    sets.push("role = ?");
    args.push(body.role);
  }
  if (body.name !== undefined) {
    sets.push("name = ?");
    args.push(body.name);
  }
  if (body.meta !== undefined) {
    sets.push("meta = ?");
    args.push(JSON.stringify(body.meta));
  }
  if (sets.length === 0) return json({ error: "no fields to update" }, 400);

  args.push(agentId, roomId);
  const result = await sqlite.execute({
    sql: `UPDATE agents SET ${sets.join(", ")} WHERE id = ? AND room_id = ?`,
    args,
  });
  if (result.rowsAffected === 0) return json({ error: "agent not found" }, 404);

  const updated = await sqlite.execute({
    sql: `SELECT * FROM agents WHERE id = ? AND room_id = ?`, args: [agentId, roomId],
  });
  const agent = rows2objects(updated)[0];
  delete agent.token_hash;
  const changes: Record<string, any> = {};
  if (body.grants !== undefined) changes.grants = body.grants;
  if (body.role !== undefined) changes.role = body.role;
  if (body.name !== undefined) changes.name = body.name;
  appendStructuralEvent(roomId, "agent_update", agentId, { id: agentId, changes }).catch(() => {});
  return json(agent);
}


// ── Shared helpers used by MCP tools ──

/** Release an agent: set idle and clear any role filled_by referencing it.
 *  Used by embody (switch), disembody, restrict_scope, revoke_access. */
export async function releaseAgent(roomId: string, agentId: string) {
  await sqlite.execute({
    sql: `UPDATE agents SET status = 'idle', waiting_on = NULL WHERE id = ? AND room_id = ?`,
    args: [agentId, roomId],
  });
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
