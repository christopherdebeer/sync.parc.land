/**
 * views.ts — View registration and deletion.
 *
 * Handles computed view CRUD with CEL expression validation and evaluation.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { evaluate } from "npm:@marcbachmann/cel-js";
import { json, rows2objects } from "./utils.ts";
import { validateCel, buildContext, buildViewContext } from "./cel.ts";
import { parseTimer, validateTimer } from "./timers.ts";
import { appendStructuralEvent } from "./audit.ts";
import type { AuthResult } from "./auth.ts";

export async function registerView(roomId: string, body: any, auth: AuthResult) {
  const id = body.id;
  if (!id) return json({ error: "id is required" }, 400);
  if (!body.expr) return json({ error: "expr is required" }, 400);
  const scope = body.scope ?? "_shared";

  // Scope ownership enforcement
  if (scope !== "_shared") {
    if (!auth.authenticated) return json({ error: "authentication_required" }, 401);
    if (auth.kind !== "room" && !auth.grants.includes("*") && auth.agentId !== scope) {
      return json({ error: "identity_mismatch", message: `view scope "${scope}" requires authentication as "${scope}"` }, 403);
    }
  }

  // Validate expression
  const v = validateCel(body.expr);
  if (!v.valid) return json({ error: "invalid_cel", field: "expr", detail: v.error }, 400);
  if (body.enabled) {
    const ev = validateCel(body.enabled);
    if (!ev.valid) return json({ error: "invalid_cel", field: "enabled", detail: ev.error }, 400);
  }

  let timerCols = parseTimer(null);
  if (body.timer) {
    const tv = validateTimer(body.timer);
    if (!tv.valid) return json({ error: "invalid_timer", detail: tv.error }, 400);
    timerCols = parseTimer(body.timer);
  }

  const registeredBy = scope !== "_shared" ? scope : (body.registered_by ?? (auth.authenticated ? auth.agentId : null));

  await sqlite.execute({
    sql: `INSERT INTO views (id, room_id, scope, description, expr, enabled_expr, render_json,
            timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at,
            registered_by, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id, room_id) DO UPDATE SET
            scope = excluded.scope, description = excluded.description, expr = excluded.expr,
            enabled_expr = excluded.enabled_expr, render_json = excluded.render_json,
            timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
            timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
            timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at,
            registered_by = excluded.registered_by,
            version = views.version + 1`,
    args: [id, roomId, scope, body.description ?? null, body.expr, body.enabled ?? null,
           body.render ? JSON.stringify(body.render) : null,
           timerCols.timer_json, timerCols.timer_expires_at, timerCols.timer_ticks_left,
           timerCols.timer_tick_on, timerCols.timer_effect, timerCols.timer_started_at, registeredBy],
  });

  // Return with resolved value
  const result = await sqlite.execute({ sql: `SELECT * FROM views WHERE id = ? AND room_id = ?`, args: [id, roomId] });
  const view = rows2objects(result)[0];

  // Evaluate current value
  const ctx = await buildContext(roomId, { selfAgent: auth.agentId ?? undefined });
  const viewCtx = await buildViewContext(roomId, scope, ctx);
  let resolvedValue: any = null;
  try {
    const evalResult = evaluate(body.expr, viewCtx);
    resolvedValue = typeof evalResult === "bigint" ? Number(evalResult) : evalResult;
  } catch (e: any) {
    resolvedValue = { _error: e.message };
  }

  appendStructuralEvent(roomId, "register_view", auth.authenticated ? auth.agentId ?? null : null, {
    id: body.id, scope, description: body.description ?? null,
    expr: body.expr, enabled_expr: body.enabled ?? null,
    render: body.render ?? null,
  }).catch(() => {});

  return json({
    id: view.id, room_id: view.room_id, scope: view.scope, description: view.description,
    expr: view.expr, enabled: view.enabled_expr,
    render: view.render_json ? (() => { try { return JSON.parse(view.render_json); } catch { return null; } })() : null,
    registered_by: view.registered_by,
    version: view.version, created_at: view.created_at,
    value: resolvedValue,
  }, 201);
}

export async function deleteView(roomId: string, viewId: string, auth: AuthResult) {
  const existing = await sqlite.execute({ sql: `SELECT scope FROM views WHERE id = ? AND room_id = ?`, args: [viewId, roomId] });
  if (existing.rows.length === 0) return json({ error: "view not found" }, 404);
  const scope = existing.rows[0][0] ?? "_shared";
  if (scope !== "_shared") {
    if (auth.kind !== "room" && !auth.grants.includes("*") && auth.agentId !== scope) {
      return json({ error: "view_owned", message: `view "${viewId}" owned by "${scope}"` }, 403);
    }
  }
  await sqlite.execute({ sql: `DELETE FROM views WHERE id = ? AND room_id = ?`, args: [viewId, roomId] });
  appendStructuralEvent(roomId, "delete_view", auth.authenticated ? auth.agentId ?? null : null, { id: viewId }).catch(() => {});
  return json({ deleted: true, id: viewId });
}
