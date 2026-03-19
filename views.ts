/**
 * views.ts — View registration and deletion.
 *
 * v9: Uses Environment-based CEL evaluation (celEval) and rich validation
 * (validateExpression) with lint warnings for old-style patterns.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { json, rows2objects } from "./utils.ts";
import { validateCel, validateExpression, celEval, buildContext, buildViewContext } from "./cel.ts";
import { parseTimer, validateTimer } from "./timers.ts";
import { appendStructuralEvent } from "./audit.ts";
import { extractDependencies } from "./deps.ts";
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

  // Validate expression with full pipeline
  const exprValidation = validateExpression(body.expr);
  if (!exprValidation.valid) {
    return json({
      error: "invalid_cel",
      field: "expr",
      stage: exprValidation.stage,
      detail: exprValidation.error,
      hint: exprValidation.hint,
      source: exprValidation.source,
      help: exprValidation.help ?? "expressions",
    }, 400);
  }

  if (body.enabled) {
    const enabledValidation = validateExpression(body.enabled);
    if (!enabledValidation.valid) {
      return json({
        error: "invalid_cel",
        field: "enabled",
        stage: enabledValidation.stage,
        detail: enabledValidation.error,
        hint: enabledValidation.hint,
        source: enabledValidation.source,
        help: enabledValidation.help ?? "expressions",
      }, 400);
    }
  }

  if (body.timer) {
    const tv = validateTimer(body.timer);
    if (!tv.valid) return json({ error: "invalid_timer", detail: tv.error }, 400);
  }

  const registeredBy = scope !== "_shared" ? scope : (body.registered_by ?? (auth.authenticated ? auth.agentId : null));

  // Extract CEL dependencies at registration time
  let deps: any[] = [];
  try {
    deps = extractDependencies(body.expr);
  } catch { /* non-fatal */ }

  // Write to _views scope
  const viewStateValue = JSON.stringify({
    expr: body.expr,
    description: body.description ?? null,
    enabled: body.enabled ?? null,
    render: body.render ?? null,
    scope,
    registered_by: registeredBy,
    timer: body.timer ?? null,
    deps,
  });
  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
          VALUES (?, '_views', ?, ?, '', 1, datetime('now'))
          ON CONFLICT(room_id, scope, key) DO UPDATE SET
            value = excluded.value, revision = state.revision + 1, updated_at = datetime('now')`,
    args: [roomId, id, viewStateValue],
  });

  // Evaluate current value using Environment
  const ctx = await buildContext(roomId, { selfAgent: auth.agentId ?? undefined });
  const viewCtx = await buildViewContext(roomId, scope, ctx);
  let resolvedValue: any = null;
  try {
    const evalResult = celEval(body.expr, viewCtx);
    resolvedValue = typeof evalResult === "bigint" ? Number(evalResult) : evalResult;
  } catch (e: any) {
    resolvedValue = { _error: e.message };
  }

  appendStructuralEvent(roomId, "register_view", auth.authenticated ? auth.agentId ?? null : null, {
    id, scope, description: body.description ?? null,
    expr: body.expr, enabled_expr: body.enabled ?? null,
    render: body.render ?? null, deps,
  }).catch(() => {});

  const response: any = {
    id, room_id: roomId, scope, description: body.description ?? null,
    expr: body.expr, enabled: body.enabled ?? null,
    render: body.render ?? null,
    registered_by: registeredBy,
    value: resolvedValue, deps,
  };

  // Include lint warnings if any
  const allWarnings = [
    ...(exprValidation.warnings ?? []),
  ];
  if (allWarnings.length > 0) {
    response.warnings = allWarnings;
  }

  return json(response, 201);
}

export async function deleteView(roomId: string, viewId: string, auth: AuthResult) {
  const existing = await sqlite.execute({
    sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_views' AND key = ?`,
    args: [roomId, viewId],
  });
  if (existing.rows.length === 0) return json({ error: "view not found" }, 404);
  let def: any = {};
  try { def = JSON.parse(existing.rows[0][0] as string); } catch {}
  const scope = def.scope ?? "_shared";
  if (scope !== "_shared") {
    if (auth.kind !== "room" && !auth.grants.includes("*") && auth.agentId !== scope) {
      return json({ error: "view_owned", message: `view "${viewId}" owned by "${scope}"` }, 403);
    }
  }
  await sqlite.execute({ sql: `DELETE FROM state WHERE room_id = ? AND scope = '_views' AND key = ?`, args: [roomId, viewId] });
  appendStructuralEvent(roomId, "delete_view", auth.authenticated ? auth.agentId ?? null : null, { id: viewId }).catch(() => {});
  return json({ deleted: true, id: viewId });
}
