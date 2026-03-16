/**
 * actions.ts — Action registration, deletion, and helpers.
 *
 * v8: Actions are state. Definitions + timer cooldown state stored in _actions scope only.
 * Legacy actions table removed — all reads and writes go through state.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { json, rows2objects } from "./utils.ts";
import { validateCel } from "./cel.ts";
import { parseTimer, validateTimer } from "./timers.ts";
import { appendStructuralEvent } from "./audit.ts";
import type { AuthResult } from "./auth.ts";

/**
 * Returns a map of "scope:key" → [actionId, ...] for any (scope, key) pair
 * that is the write target of two or more registered actions.
 */
export async function computeContestedTargets(roomId: string): Promise<Record<string, string[]>> {
  const result = await sqlite.execute({
    sql: `SELECT key, value FROM state WHERE room_id = ? AND scope = '_actions'`,
    args: [roomId],
  });
  const rows = rows2objects(result);

  const targets: Record<string, string[]> = {};
  for (const row of rows) {
    let def: any;
    try { def = JSON.parse(row.value as string); } catch { continue; }
    const writes = Array.isArray(def.writes) ? def.writes : [];
    for (const w of writes) {
      const scope = w.scope ?? "_shared";
      const key = w.key ?? null;
      if (!key) continue;
      const target = `${scope}:${key}`;
      if (!targets[target]) targets[target] = [];
      if (!targets[target].includes(row.key as string)) targets[target].push(row.key as string);
    }
  }

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

  if (body.timer) {
    const tv = validateTimer(body.timer);
    if (!tv.valid) return json({ error: "invalid_timer", detail: tv.error }, 400);
  }
  if (body.on_invoke?.timer) {
    const tv = validateTimer(body.on_invoke.timer);
    if (!tv.valid) return json({ error: "invalid_timer", field: "on_invoke.timer", detail: tv.error }, 400);
  }

  const writes = body.writes ?? [];
  if (!Array.isArray(writes)) return json({ error: "writes must be an array" }, 400);
  const registeredBy = scope !== "_shared" ? scope : (body.registered_by ?? (auth.authenticated ? auth.agentId : null));

  // Check for semantic changes on re-registration
  const writesJson = JSON.stringify(writes);
  const paramsJson = body.params ? JSON.stringify(body.params) : null;
  let reregistration: {
    previousRegistrant: string | null;
    writesChanged: boolean;
    paramsChanged: boolean;
    previousWrites: any[];
    invocationCount: number;
  } | null = null;

  const existing = await sqlite.execute({
    sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_actions' AND key = ?`,
    args: [roomId, id],
  });
  if (existing.rows.length > 0) {
    let prevDef: any = {};
    try { prevDef = JSON.parse(existing.rows[0][0] as string); } catch {}
    const prevWritesJson = JSON.stringify(prevDef.writes ?? []);
    const prevParamsJson = prevDef.params ? JSON.stringify(prevDef.params) : null;
    const writesChanged = prevWritesJson !== writesJson;
    const paramsChanged = prevParamsJson !== paramsJson;

    if (writesChanged || paramsChanged) {
      let invocationCount = 0;
      try {
        const auditResult = await sqlite.execute({
          sql: `SELECT COUNT(*) as cnt FROM state WHERE room_id = ? AND scope = '_audit' AND value LIKE ?`,
          args: [roomId, `%"action":"${id}"%`],
        });
        invocationCount = Number(rows2objects(auditResult)[0]?.cnt ?? 0);
      } catch {}

      reregistration = {
        previousRegistrant: prevDef.registered_by ?? null,
        writesChanged, paramsChanged,
        previousWrites: prevDef.writes ?? [],
        invocationCount,
      };
    }
  }

  // Build timer state for initial registration
  let timerState: any = null;
  if (body.timer) {
    const cols = parseTimer(body.timer);
    timerState = {
      timer_json: cols.timer_json,
      timer_expires_at: cols.timer_expires_at,
      timer_ticks_left: cols.timer_ticks_left,
      timer_tick_on: cols.timer_tick_on,
      timer_effect: cols.timer_effect,
      timer_started_at: cols.timer_started_at,
    };
  }

  // Write to _actions scope (single source of truth)
  const actionDef = {
    description: body.description ?? null,
    if: body.if ?? null,
    enabled: body.enabled ?? null,
    result: body.result ?? null,
    writes,
    params: body.params ?? null,
    scope,
    registered_by: registeredBy,
    timer: body.timer ?? null,
    on_invoke: body.on_invoke ?? null,
    _timer: timerState,  // mutable runtime timer state (updated on invoke)
  };

  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
          VALUES (?, '_actions', ?, ?, '', 1, datetime('now'))
          ON CONFLICT(room_id, scope, key) DO UPDATE SET
            value = excluded.value, revision = state.revision + 1, updated_at = datetime('now')`,
    args: [roomId, id, JSON.stringify(actionDef)],
  });

  appendStructuralEvent(roomId, "register_action", auth.authenticated ? auth.agentId ?? null : null, {
    id, scope, description: body.description ?? null,
    if_expr: body.if ?? null, enabled_expr: body.enabled ?? null,
    writes, params: body.params ?? null,
  }).catch(() => {});

  // Build response directly from input
  const response: any = {
    id, room_id: roomId, scope, description: body.description ?? null,
    registered_by: registeredBy, writes, params: body.params ?? null,
  };
  if (body.if) response.if = body.if;
  if (body.enabled) response.enabled = body.enabled;
  if (body.result) response.result = body.result;
  if (body.timer) response.timer = body.timer;
  if (body.on_invoke) response.on_invoke = body.on_invoke;

  // Check contested targets
  const contested = await computeContestedTargets(roomId);
  const myWrites = writes.map((w: any) => `${w.scope ?? "_shared"}:${w.key ?? ""}`).filter((t: string) => !t.endsWith(":"));
  const myContested = myWrites.filter((t: string) => contested[t] && contested[t].length >= 2);

  const warnings: string[] = [];
  const warningDetails: Record<string, any> = {};

  if (myContested.length > 0) {
    warnings.push("competing_write_targets");
    warningDetails.contested_targets = myContested;
    warningDetails.competing_actions = myContested.map(t => ({ target: t, actions: contested[t] }));
  }

  if (reregistration) {
    warnings.push("action_redefined");
    warningDetails.redefinition = {
      previous_registrant: reregistration.previousRegistrant,
      writes_changed: reregistration.writesChanged,
      params_changed: reregistration.paramsChanged,
      invocation_count: reregistration.invocationCount,
      previous_writes: reregistration.previousWrites,
      risk: reregistration.invocationCount > 0 && reregistration.writesChanged
        ? "high — action has been invoked and write behavior changed"
        : reregistration.writesChanged
        ? "medium — write behavior changed"
        : "low — parameter schema changed but write targets unchanged",
    };
  }

  if (warnings.length > 0) {
    return json({ ...response, warning: warnings.length === 1 ? warnings[0] : warnings, ...warningDetails, help: "contested_actions" }, 201);
  }

  return json(response, 201);
}

export async function deleteAction(roomId: string, actionId: string, auth: AuthResult) {
  const existing = await sqlite.execute({
    sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_actions' AND key = ?`,
    args: [roomId, actionId],
  });
  if (existing.rows.length === 0) return json({ error: "action not found" }, 404);
  let def: any = {};
  try { def = JSON.parse(existing.rows[0][0] as string); } catch {}
  const scope = def.scope ?? "_shared";
  if (scope !== "_shared") {
    if (auth.kind !== "room" && !auth.grants.includes("*") && auth.agentId !== scope) {
      return json({ error: "action_owned", message: `action "${actionId}" owned by "${scope}"`, owner: scope }, 403);
    }
  }
  await sqlite.execute({ sql: `DELETE FROM state WHERE room_id = ? AND scope = '_actions' AND key = ?`, args: [roomId, actionId] });
  appendStructuralEvent(roomId, "delete_action", auth.authenticated ? auth.agentId ?? null : null, { id: actionId }).catch(() => {});
  return json({ deleted: true, id: actionId });
}
