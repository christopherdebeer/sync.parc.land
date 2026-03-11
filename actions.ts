/**
 * actions.ts — Action registration, deletion, and helpers.
 *
 * Handles action CRUD and provides formatAction + computeContestedTargets
 * used by invoke.ts and context.ts.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { json, rows2objects } from "./utils.ts";
import { validateCel } from "./cel.ts";
import { parseTimer, validateTimer, isTimerLive } from "./timers.ts";
import { appendStructuralEvent } from "./audit.ts";
import type { AuthResult } from "./auth.ts";

export function formatAction(row: any) {
  const out: any = {
    id: row.id, room_id: row.room_id, scope: row.scope ?? "_shared",
    description: row.description, version: row.version, created_at: row.created_at,
    registered_by: row.registered_by,
  };
  if (row.if_expr) out.if = row.if_expr;
  if (row.enabled_expr) out.enabled = row.enabled_expr;
  if (row.result_expr) out.result = row.result_expr;
  if (row.writes_json) { try { out.writes = JSON.parse(row.writes_json); } catch { out.writes = []; } }
  if (row.params_json) { try { out.params = JSON.parse(row.params_json); } catch {} }
  if (row.timer_json) { try { out.timer = JSON.parse(row.timer_json); } catch {} }
  if (row.on_invoke_timer_json) { try { out.on_invoke = { timer: JSON.parse(row.on_invoke_timer_json) }; } catch {} }
  return out;
}

/**
 *
 * Returns a map of "scope:key" → [actionId, ...] for any (scope, key) pair
 * that is the write target of two or more registered actions.
 * Template keys (containing "${") are tracked as-is — two actions writing
 * to `${params.key}` contest each other even if param values differ at runtime.
 */
export async function computeContestedTargets(roomId: string): Promise<Record<string, string[]>> {
  const result = await sqlite.execute({
    sql: `SELECT id, writes_json, timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect
          FROM actions WHERE room_id = ? ORDER BY created_at`,
    args: [roomId],
  });
  const rows = rows2objects(result).filter((r: any) => isTimerLive(r));

  // Collect (scope:key) → [actionId]
  const targets: Record<string, string[]> = {};
  for (const row of rows) {
    let writes: any[] = [];
    try { writes = JSON.parse(row.writes_json || "[]"); } catch {}
    for (const w of writes) {
      const scope = w.scope ?? "_shared";
      const key = w.key ?? null;
      if (!key) continue; // append-only writes have no static key
      const target = `${scope}:${key}`;
      if (!targets[target]) targets[target] = [];
      if (!targets[target].includes(row.id)) targets[target].push(row.id);
    }
  }

  // Keep only contested targets (2+ actions)
  const contested: Record<string, string[]> = {};
  for (const [target, ids] of Object.entries(targets)) {
    if (ids.length >= 2) contested[target] = ids;
  }
  return contested;
}

export async function registerAction(roomId: string, body: any, auth: AuthResult) {
  const id = body.id;
  if (!id) return json({ error: "id is required" }, 400);
  const scope = body.scope ?? "_shared";

  // Scope ownership enforcement
  if (scope !== "_shared") {
    if (!auth.authenticated) return json({ error: "authentication_required", message: `scoped actions require auth` }, 401);
    if (auth.kind !== "room" && !auth.grants.includes("*") && auth.agentId !== scope) {
      return json({ error: "identity_mismatch", message: `action scope "${scope}" requires authentication as "${scope}"` }, 403);
    }
  }

  // Validate expressions
  if (body.if) { const v = validateCel(body.if); if (!v.valid) return json({ error: "invalid_cel", field: "if", detail: v.error }, 400); }
  if (body.enabled) { const v = validateCel(body.enabled); if (!v.valid) return json({ error: "invalid_cel", field: "enabled", detail: v.error }, 400); }
  if (body.result) { const v = validateCel(body.result); if (!v.valid) return json({ error: "invalid_cel", field: "result", detail: v.error }, 400); }

  let timerCols = parseTimer(null);
  if (body.timer) {
    const tv = validateTimer(body.timer);
    if (!tv.valid) return json({ error: "invalid_timer", detail: tv.error }, 400);
    timerCols = parseTimer(body.timer);
  }
  if (body.on_invoke?.timer) {
    const tv = validateTimer(body.on_invoke.timer);
    if (!tv.valid) return json({ error: "invalid_timer", field: "on_invoke.timer", detail: tv.error }, 400);
  }

  const writes = body.writes ?? [];
  if (!Array.isArray(writes)) return json({ error: "writes must be an array" }, 400);
  const params = body.params ?? null;
  const writesJson = JSON.stringify(writes);
  const paramsJson = params ? JSON.stringify(params) : null;
  const onInvokeJson = body.on_invoke?.timer ? JSON.stringify(body.on_invoke.timer) : null;
  const registeredBy = scope !== "_shared" ? scope : (body.registered_by ?? (auth.authenticated ? auth.agentId : null));

  await sqlite.execute({
    sql: `INSERT INTO actions (id, room_id, scope, description, if_expr, enabled_expr, result_expr, writes_json, params_json,
            timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at,
            on_invoke_timer_json, registered_by, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id, room_id) DO UPDATE SET
            scope = excluded.scope, description = excluded.description,
            if_expr = excluded.if_expr, enabled_expr = excluded.enabled_expr,
            result_expr = excluded.result_expr,
            writes_json = excluded.writes_json, params_json = excluded.params_json,
            timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
            timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
            timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at,
            on_invoke_timer_json = excluded.on_invoke_timer_json,
            registered_by = excluded.registered_by,
            version = actions.version + 1`,
    args: [id, roomId, scope, body.description ?? null, body.if ?? null, body.enabled ?? null, body.result ?? null,
           writesJson, paramsJson, timerCols.timer_json, timerCols.timer_expires_at, timerCols.timer_ticks_left,
           timerCols.timer_tick_on, timerCols.timer_effect, timerCols.timer_started_at, onInvokeJson, registeredBy],
  });

  const result = await sqlite.execute({ sql: `SELECT * FROM actions WHERE id = ? AND room_id = ?`, args: [id, roomId] });
  const saved = formatAction(rows2objects(result)[0]);

  appendStructuralEvent(roomId, "register_action", auth.authenticated ? auth.agentId ?? null : null, {
    id, scope, description: body.description ?? null,
    if_expr: body.if ?? null, enabled_expr: body.enabled ?? null,
    writes: body.writes ?? [], params: body.params ?? null,
  }).catch(() => {});

  // Check for write target overlap with existing actions
  const contested = await computeContestedTargets(roomId);
  const myWrites = (body.writes ?? []).map((w: any) => `${w.scope ?? "_shared"}:${w.key ?? ""}`).filter((t: string) => !t.endsWith(":"));
  const myContested = myWrites.filter((t: string) => contested[t] && contested[t].length >= 2);

  if (myContested.length > 0) {
    return json({
      ...saved,
      warning: "competing_write_targets",
      contested_targets: myContested,
      competing_actions: myContested.map(t => ({ target: t, actions: contested[t] })),
      help: "contested_actions",
    }, 201);
  }

  return json(saved, 201);
}

export async function deleteAction(roomId: string, actionId: string, auth: AuthResult) {
  const existing = await sqlite.execute({ sql: `SELECT scope FROM actions WHERE id = ? AND room_id = ?`, args: [actionId, roomId] });
  if (existing.rows.length === 0) return json({ error: "action not found" }, 404);
  const scope = existing.rows[0][0] ?? "_shared";
  if (scope !== "_shared") {
    if (auth.kind !== "room" && !auth.grants.includes("*") && auth.agentId !== scope) {
      return json({ error: "action_owned", message: `action "${actionId}" owned by "${scope}"`, owner: scope }, 403);
    }
  }
  await sqlite.execute({ sql: `DELETE FROM actions WHERE id = ? AND room_id = ?`, args: [actionId, roomId] });
  appendStructuralEvent(roomId, "delete_action", auth.authenticated ? auth.agentId ?? null : null, { id: actionId }).catch(() => {});
  return json({ deleted: true, id: actionId });
}
