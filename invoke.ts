/**
 * invoke.ts — Action invocation engine and built-in action dispatch.
 *
 * Contains invokeAction (the ~350-line write engine), invokeBuiltinAction,
 * and the BUILTIN_ACTIONS / OVERRIDABLE_BUILTINS constants.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { evaluate } from "npm:@marcbachmann/cel-js";
import {
  json, rows2objects, contentHash, deepSubstitute, deepMerge,
} from "./utils.ts";
import { buildContext, evalCelWithParams, buildViewContext, type BuildContextOptions } from "./cel.ts";
import { isTimerLive, getTimerStatus, parseTimer, tickLogicalTimers, validateTimer } from "./timers.ts";
import { touchAgent, type AuthResult } from "./auth.ts";
import { appendAuditEntry, appendStructuralEvent } from "./audit.ts";
import { registerAction, deleteAction, formatAction, computeContestedTargets } from "./actions.ts";
import { registerView, deleteView } from "./views.ts";
import { HELP_SYSTEM } from "./help-content.ts";

// ── Builtins ──

export const BUILTIN_ACTIONS: Record<string, { description: string; params?: Record<string, any> }> = {
  _send_message: {
    description: "Send a message to the room",
    params: {
      body: { type: "string", description: "Message content" },
      kind: { type: "string", description: "Message kind (default: chat)" },
    },
  },
  _register_action: {
    description: "Register a new action in the room",
    params: {
      id: { type: "string", description: "Action ID" },
      scope: { type: "string", description: "Owning scope" },
      description: { type: "string", description: "Human-readable description" },
      if: { type: "string", description: "CEL availability predicate" },
      enabled: { type: "string", description: "CEL enabled expression" },
      result: { type: "string", description: "CEL expression evaluated after writes, returned to invoker" },
      writes: { type: "array", description: "State write templates" },
      params: { type: "object", description: "Parameter schema" },
    },
  },
  _delete_action: {
    description: "Delete an action from the room",
    params: { id: { type: "string", description: "Action ID to delete" } },
  },
  _register_view: {
    description: "Register a computed view. Pass render: { type, label, ... } to create a surface.",
    params: {
      id: { type: "string", description: "View ID" },
      expr: { type: "string", description: "CEL expression" },
      scope: { type: "string", description: "Registrar scope (default: self)" },
      description: { type: "string", description: "Human-readable description" },
      enabled: { type: "string", description: "CEL visibility expression" },
      render: { type: "object", description: "Render hint — makes this view a surface. { type, label, ... }" },
    },
  },
  _delete_view: {
    description: "Delete a view from the room",
    params: { id: { type: "string", description: "View ID to delete" } },
  },
  help: {
    description: "Room-specific participant guide (overridable by custom action)",
    params: {
      key: { type: "string", description: "Help key — omit to list all keys. Try: guide, standard_library, vocabulary_bootstrap" },
    },
  },
};

/** Built-in actions that can be overridden by custom actions with the same id.
 *  If a room registers a custom action with one of these ids, the custom one
 *  wins in both context listing and invocation. */
export const OVERRIDABLE_BUILTINS = new Set(["help"]);

// ── Invocation ──

export async function invokeAction(roomId: string, actionId: string, body: any, auth: AuthResult) {
  // Built-in actions: dispatch to handler
  if (actionId.startsWith("_") && BUILTIN_ACTIONS[actionId]) {
    const response = await invokeBuiltinAction(roomId, actionId, body, auth);
    appendAuditEntry(roomId, body.agent ?? auth.agentId, actionId, true, body.params ?? {}, response.status).catch(() => {});
    return response;
  }

  const agent = body.agent ?? auth.agentId;
  touchAgent(roomId, agent);

  const actionResult = await sqlite.execute({ sql: `SELECT * FROM actions WHERE id = ? AND room_id = ?`, args: [actionId, roomId] });
  const action = rows2objects(actionResult)[0];
  if (!action) {
    // Fall through to overridable built-in if no custom action registered
    if (OVERRIDABLE_BUILTINS.has(actionId) && BUILTIN_ACTIONS[actionId]) {
      const response = await invokeBuiltinAction(roomId, actionId, body, auth);
      appendAuditEntry(roomId, body.agent ?? auth.agentId, actionId, true, body.params ?? {}, response.status).catch(() => {});
      return response;
    }
    return json({ error: "action not found" }, 404);
  }
  if (!isTimerLive(action)) {
    // Distinguish cooldown (dormant, will re-enable) from truly expired
    if (action.timer_effect === "enable" && getTimerStatus(action) === "active") {
      return json({
        error: "action_cooldown", action: actionId,
        message: "action is in cooldown period",
        available_at: action.timer_expires_at ?? undefined,
        ticks_remaining: action.timer_ticks_left ?? undefined,
      }, 409);
    }
    return json({ error: "action_expired", action: actionId }, 404);
  }

  const actionScope = action.scope ?? "_shared";

  // Build context with registrar's scope access for predicate evaluation
  const ctxOpts: BuildContextOptions = { selfAgent: agent ?? undefined };
  if (actionScope !== "_shared") {
    ctxOpts.includeScopes = [actionScope];
  }
  const ctx = await buildContext(roomId, ctxOpts);

  // Check enabled
  if (action.enabled_expr) {
    try {
      if (!evaluate(action.enabled_expr, ctx)) return json({ error: "action_disabled", id: actionId }, 409);
    } catch (e: any) { return json({ error: "cel_error", field: "enabled", detail: e.message }, 400); }
  }

  // Validate and merge params
  const params = body.params ?? {};
  if (action.params_json) {
    try {
      const schema = JSON.parse(action.params_json);
      for (const [name, def] of Object.entries(schema as Record<string, any>)) {
        if (def.enum && params[name] !== undefined && !def.enum.includes(params[name])) {
          return json({ error: "invalid_param", param: name, value: params[name], allowed: def.enum }, 400);
        }
        if (def.type && def.type !== "any" && params[name] !== undefined && typeof params[name] !== def.type) {
          return json({ error: "invalid_param_type", param: name, expected: def.type, actual: typeof params[name] }, 400);
        }
      }
    } catch {}
  }

  // Check if predicate
  if (action.if_expr) {
    const result = evalCelWithParams(action.if_expr, ctx, params);
    if (!result.ok) return json({ error: "cel_error", field: "if", detail: result.error }, 400);
    if (!result.value) return json({ error: "precondition_failed", action: actionId, expression: action.if_expr }, 409);
  }

  // Execute writes
  const writes = JSON.parse(action.writes_json || "[]");
  const statements: any[] = [];
  const executedWrites: any[] = [];

  for (const w of writes) {
    // Shared timestamp for consistent ${now} across scope, key + value
    const invokeTs = new Date().toISOString();

    // Resolve template vars in scope before authority check
    let writeScope = w.scope ?? "_shared";
    if (writeScope.includes("${")) {
      writeScope = writeScope.replace(/\$\{(params\.(\w+)|self|now)\}/g, (match: string, full: string, paramName: string) => {
        if (paramName !== undefined) return String(params[paramName] ?? "");
        if (full === "self") return agent ?? "";
        if (full === "now") return invokeTs;
        return match;
      });
    }

    // Scope enforcement via registrar-identity bridging
    if (writeScope !== "_shared" && !writeScope.startsWith("_")) {
      const registrarAllowed = actionScope === writeScope;
      const invokerAllowed = agent === writeScope;
      if (!registrarAllowed && !invokerAllowed) {
        return json({ error: "scope_denied", message: `action "${actionId}" cannot write to scope "${writeScope}"` }, 403);
      }
    }

    // Resolve param substitutions in key (single-pass to prevent injection)
    let key = w.key ?? null;
    if (key && key.includes("${")) {
      key = key.replace(/\$\{(params\.(\w+)|self|now)\}/g, (match: string, full: string, paramName: string) => {
        if (paramName !== undefined) return String(params[paramName] ?? "");
        if (full === "self") return agent ?? "";
        if (full === "now") return invokeTs;
        return match;
      });
    }

    // Resolve value
    let value: any;
    if (w.expr === true && typeof w.value === "string") {
      const evalResult = evalCelWithParams(w.value, ctx, params);
      if (!evalResult.ok) return json({ error: "cel_error", field: "writes[].value", detail: evalResult.error, key }, 400);
      value = evalResult.value;
    } else {
      value = deepSubstitute(w.value, params, agent ?? "", invokeTs);
    }

    let writeTimerCols = parseTimer(null);
    if (w.timer) { const tv = validateTimer(w.timer); if (tv.valid) writeTimerCols = parseTimer(w.timer); }
    const enabledExpr = w.enabled ?? null;
    const wTimerArgs = [writeTimerCols.timer_json, writeTimerCols.timer_expires_at, writeTimerCols.timer_ticks_left,
                       writeTimerCols.timer_tick_on, writeTimerCols.timer_effect, writeTimerCols.timer_started_at];

    // Handle append
    let sortKey: number | null = null;
    let arrayPushAction: any = undefined;
    if (w.append === true) {
      if (key) {
        // Array-push: append value to JSON array stored at this key
        const existing = await sqlite.execute({
          sql: `SELECT value FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [roomId, writeScope, key],
        });
        let arr: any[] = [];
        if (existing.rows.length > 0) {
          try {
            const parsed = JSON.parse(existing.rows[0][0] as string);
            arr = Array.isArray(parsed) ? parsed : [parsed];
          } catch { arr = []; }
        }
        if (value === undefined) return json({ error: "write_failed", action: actionId, reason: "value is required for array append", key }, 400);
        arr.push(value);
        arrayPushAction = arr;
      } else {
        const seqResult = await sqlite.execute({
          sql: `SELECT COALESCE(MAX(sort_key), 0) + 1 as next_seq FROM state WHERE room_id = ? AND scope = ?`,
          args: [roomId, writeScope],
        });
        sortKey = Number(rows2objects(seqResult)[0]?.next_seq ?? 1);
        key = String(sortKey);
      }
    }

    if (!key) return json({ error: "write needs a key (or use append: true)", write: w }, 400);

    // if_version: compare-and-swap on write templates (proof-of-read)
    if (w.if_version !== undefined) {
      let expectedVersion = w.if_version;
      if (typeof expectedVersion === "string" && expectedVersion.includes("${")) {
        expectedVersion = expectedVersion.replace(/\$\{(params\.(\w+)|self|now)\}/g, (match: string, full: string, paramName: string) => {
          if (paramName !== undefined) return String(params[paramName] ?? "");
          if (full === "self") return agent ?? "";
          if (full === "now") return invokeTs;
          return match;
        });
      }
      const expected = String(expectedVersion);
      const current = await sqlite.execute({
        sql: `SELECT version, value, revision FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [roomId, writeScope, key],
      });
      if (current.rows.length > 0) {
        const row = rows2objects(current)[0];
        if (row.version !== expected) {
          return json({ error: "version_conflict", expected_version: expected, current: row }, 409);
        }
      } else if (expected !== "") {
        return json({ error: "not_found", message: "key does not exist, use if_version='' to create", scope: writeScope, key }, 404);
      }
    }

    // Handle merge in action writes
    if (w.merge && typeof w.merge === "object") {
      let mergePayload = deepSubstitute(w.merge, params, agent ?? "", invokeTs);
      const existing = await sqlite.execute({
        sql: `SELECT value FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [roomId, writeScope, key],
      });
      let currentValue: any = {};
      if (existing.rows.length > 0) { try { currentValue = JSON.parse(existing.rows[0][0] as string); } catch {} }
      const mergedValue = JSON.stringify(deepMerge(currentValue, mergePayload));
      const vHash = await contentHash(mergedValue);

      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = excluded.version, revision = state.revision + 1,
                updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, writeScope, key, sortKey, mergedValue, vHash, enabledExpr, ...wTimerArgs],
      });
      executedWrites.push({ scope: writeScope, key, merge: mergePayload });
    } else if (w.increment) {
      // Increment: read-compute-write to maintain hash consistency
      let resolvedIncrement: any = w.increment;
      if (typeof resolvedIncrement === "string") {
        resolvedIncrement = deepSubstitute(resolvedIncrement, params, agent ?? "", invokeTs);
        const n = Number(resolvedIncrement);
        resolvedIncrement = isNaN(n) ? 1 : n;
      }
      const actionIncrementAmount = typeof resolvedIncrement === "number" ? resolvedIncrement : (value ?? 1);
      const existingInc = await sqlite.execute({
        sql: `SELECT value FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [roomId, writeScope, key],
      });
      const currentNum = existingInc.rows.length > 0 ? (parseInt(existingInc.rows[0][0] as string) || 0) : 0;
      const newNum = currentNum + actionIncrementAmount;
      const newValue = String(newNum);
      const vHash = await contentHash(newValue);
      if (existingInc.rows.length > 0) {
        statements.push({
          sql: `UPDATE state SET value = ?, version = ?, revision = revision + 1, updated_at = datetime('now')
                WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [newValue, vHash, roomId, writeScope, key],
        });
      } else {
        statements.push({
          sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at, enabled_expr,
                  timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
          args: [roomId, writeScope, key, sortKey, newValue, vHash, enabledExpr, ...wTimerArgs],
        });
      }
      executedWrites.push({ scope: writeScope, key, value: newNum });
    } else {
      const rawAction = arrayPushAction !== undefined ? arrayPushAction : value;
      const strValue = typeof rawAction === "string" ? rawAction : JSON.stringify(rawAction);
      const vHash = await contentHash(strValue);
      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = excluded.version, revision = state.revision + 1,
                updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, writeScope, key, sortKey, strValue, vHash, enabledExpr, ...wTimerArgs],
      });
      executedWrites.push({ scope: writeScope, key, value });
    }
  }

  if (statements.length > 0) {
    try {
      await sqlite.batch(statements);
    } catch (e: any) {
      const msg = e.message || String(e);
      const detail = msg.includes("SQLITE_CONSTRAINT") ? msg.split(":").slice(1).join(":").trim() : msg;
      return json({
        error: "write_failed",
        action: actionId,
        detail,
        writes_attempted: executedWrites,
      }, 500);
    }
  }

  // Tick logical timers
  for (const w of executedWrites) {
    await tickLogicalTimers(roomId, w.scope, w.key);
  }

  // Apply on_invoke cooldown timer
  if (action.on_invoke_timer_json) {
    try {
      const invokeTimer = JSON.parse(action.on_invoke_timer_json);
      const cols = parseTimer(invokeTimer);
      await sqlite.execute({
        sql: `UPDATE actions SET timer_json = ?, timer_expires_at = ?, timer_ticks_left = ?,
              timer_tick_on = ?, timer_effect = ?, timer_started_at = ?
              WHERE id = ? AND room_id = ?`,
        args: [cols.timer_json, cols.timer_expires_at, cols.timer_ticks_left,
               cols.timer_tick_on, cols.timer_effect, cols.timer_started_at, actionId, roomId],
      });
    } catch {}
  }

  // Log invocation to _messages
  const logSeqResult = await sqlite.execute({
    sql: `SELECT COALESCE(MAX(sort_key), 0) + 1 as next_seq FROM state WHERE room_id = ? AND scope = '_messages'`,
    args: [roomId],
  });
  const logSeq = Number(rows2objects(logSeqResult)[0]?.next_seq ?? 1);
  const logValue = JSON.stringify({
    from: agent, kind: "action_invocation",
    body: `${actionId}(${Object.entries(params).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join(", ")})`,
    action: actionId, params, writes: executedWrites,
  });
  const logHash = await contentHash(logValue);
  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at)
          VALUES (?, '_messages', ?, ?, ?, ?, 1, datetime('now'))`,
    args: [roomId, String(logSeq), logSeq, logValue, logHash],
  });

  // Include the auto-log message write so audit entries capture it for replay reconstruction
  const auditWrites = [...executedWrites, { scope: "_messages", key: String(logSeq), value: JSON.parse(logValue) }];
  appendAuditEntry(roomId, agent, actionId, false, params, 200, auditWrites).catch(() => {});

  // Evaluate result expression against post-write state
  let result: any = undefined;
  if (action.result_expr) {
    try {
      const postCtx = await buildContext(roomId, {
        selfAgent: agent ?? undefined,
        includeScopes: actionScope !== "_shared" ? [actionScope] : undefined,
      });
      const evalResult = evalCelWithParams(action.result_expr, postCtx, params);
      if (evalResult.ok) {
        result = typeof evalResult.value === "bigint" ? Number(evalResult.value) : evalResult.value;
      } else {
        result = { _error: evalResult.error };
      }
    } catch (e: any) {
      result = { _error: e.message };
    }
  }

  const response: any = { invoked: true, action: actionId, agent, params, writes: executedWrites };
  if (result !== undefined) response.result = result;
  return json(response);
}

// ── Built-in action dispatch ──

export async function invokeBuiltinAction(roomId: string, actionId: string, body: any, auth: AuthResult): Promise<Response> {
  const agent = body.agent ?? auth.agentId;
  const params = body.params ?? {};
  touchAgent(roomId, agent);

  switch (actionId) {
    case "_send_message": {
      const msgBody = params.body;
      if (!msgBody) return json({ error: "params.body is required" }, 400);
      const kind = params.kind ?? "chat";
      const to = params.to ?? null; // agent ID string or array — directed but not private
      const seqResult = await sqlite.execute({
        sql: `SELECT COALESCE(MAX(sort_key), 0) + 1 as next_seq FROM state WHERE room_id = ? AND scope = '_messages'`,
        args: [roomId],
      });
      const seq = Number(rows2objects(seqResult)[0]?.next_seq ?? 1);
      const msgObj: any = { from: agent, kind, body: msgBody };
      if (to !== null) msgObj.to = Array.isArray(to) ? to : [to];
      const value = JSON.stringify(msgObj);
      const vHash = await contentHash(value);
      await sqlite.execute({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at)
              VALUES (?, '_messages', ?, ?, ?, ?, 1, datetime('now'))`,
        args: [roomId, String(seq), seq, value, vHash],
      });
      return json({ ok: true, action: "_send_message", seq, from: agent, kind, ...(msgObj.to ? { to: msgObj.to } : {}) });
    }

    case "_register_action": {
      return registerAction(roomId, {
        id: params.id,
        scope: params.scope,
        description: params.description,
        if: params.if,
        enabled: params.enabled,
        result: params.result,
        writes: params.writes,
        params: params.params,
        timer: params.timer,
        on_invoke: params.on_invoke,
      }, auth);
    }

    case "_delete_action": {
      if (!params.id) return json({ error: "params.id is required" }, 400);
      return deleteAction(roomId, params.id, auth);
    }

    case "_register_view": {
      return registerView(roomId, {
        id: params.id,
        expr: params.expr,
        scope: params.scope ?? auth.agentId ?? "_shared",
        description: params.description,
        enabled: params.enabled,
        render: params.render,
        timer: params.timer,
      }, auth);
    }

    case "_delete_view": {
      if (!params.id) return json({ error: "params.id is required" }, 400);
      return deleteView(roomId, params.id, auth);
    }

    case "help": {
      const key = params.key;
      if (!key) {
        // Return index — merge system keys with any room overrides
        const roomHelpResult = await sqlite.execute({
          sql: `SELECT key FROM state WHERE room_id = ? AND scope = '_help' ORDER BY key`,
          args: [roomId],
        });
        const roomKeys = rows2objects(roomHelpResult).map((r: any) => r.key);
        const allKeys = [...new Set([...Object.keys(HELP_SYSTEM), ...roomKeys])];
        return json({
          invoked: true, action: "help",
          keys: allKeys,
          usage: 'invoke help({ key: "<key>" }) to read a specific entry',
        });
      }
      // Try room override first
      const roomEntry = await sqlite.execute({
        sql: `SELECT value, version, revision FROM state WHERE room_id = ? AND scope = '_help' AND key = ?`,
        args: [roomId, key],
      });
      if (roomEntry.rows.length > 0) {
        const row = rows2objects(roomEntry)[0];
        let content = row.value;
        try { content = JSON.parse(row.value); } catch {}
        return json({
          invoked: true, action: "help", key,
          content,
          version: row.version,   // hash — supply to if_version to override
          revision: row.revision,
          source: "room",
        });
      }
      // System default
      const rawContent = HELP_SYSTEM[key];
      if (!rawContent) {
        return json({
          error: "help_key_not_found", key,
          available: Object.keys(HELP_SYSTEM),
        }, 404);
      }
      // Parse JSON keys for cleaner return; keep string keys as strings
      let content: any = rawContent;
      try { content = JSON.parse(rawContent); } catch {}
      // Compute hash so caller can supply it to if_version when overriding
      const hash = await contentHash(rawContent);
      return json({
        invoked: true, action: "help", key,
        content,
        version: hash,   // supply to if_version to override this key
        revision: 0,     // 0 = system default, never written to room state
        source: "system",
      });
    }

    default:
      return json({ error: "unknown builtin action", id: actionId }, 404);
  }
}
