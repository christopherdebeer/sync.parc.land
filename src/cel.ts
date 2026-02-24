import { sqlite } from "https://esm.town/v/std/sqlite";
import { evaluate } from "npm:@marcbachmann/cel-js";
import { isTimerLive } from "./timers.ts";

/**
 * CEL (Common Expression Language) evaluator for agent-sync.
 *
 * All conditions, write gates, computed views, and enabled expressions use CEL.
 * Non-Turing complete, side-effect free, guaranteed to terminate.
 *
 * Context shape provided to every evaluation:
 *
 *   {
 *     state: {
 *       _shared: { phase: "executing", turn: 3, ... },
 *       "agent-a": { score: 42, ... },
 *       _view: { ready: true, summary: "..." }  // resolved computed views
 *     },
 *     agents: {
 *       "agent-a": { status: "active", role: "coordinator", waiting_on: null },
 *       "agent-b": { status: "waiting", role: "worker", waiting_on: "..." }
 *     },
 *     messages: { count: 42, unclaimed: 3 },
 *     actions: {
 *       "stoke_fire": { available: true, enabled: true },
 *       "craft": { available: false, enabled: true }
 *     }
 *   }
 *
 * The `self` keyword resolves to the requesting agent's ID when provided.
 */

function rows2objects(result: { columns: string[]; rows: any[][] }) {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((col, i) => [col, row[i]]))
  );
}

/** Try to parse a JSON string value into a native type for CEL context */
function parseValue(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** Build the CEL evaluation context from room data, filtering by timer and enabled status.
 *  selfAgent: the requesting agent's ID (used to resolve `self` in expressions and
 *  to evaluate per-agent enabled expressions) */
export async function buildContext(roomId: string, selfAgent?: string): Promise<Record<string, any>> {
  // Load all state
  const stateResult = await sqlite.execute({
    sql: `SELECT scope, key, value, timer_effect, timer_expires_at, timer_ticks_left, enabled_expr FROM state WHERE room_id = ?`,
    args: [roomId],
  });
  const stateRows = rows2objects(stateResult) as any[];

  // Nest into state.{scope}.{key} — only include live resources
  const state: Record<string, Record<string, any>> = {};
  const computedViews: { key: string; expr: string }[] = [];
  const deferredEnabled: { scope: string; key: string; value: any; enabled_expr: string; isView: boolean; viewExpr?: string }[] = [];

  for (const row of stateRows) {
    // Timer gate: skip non-live resources
    if (!isTimerLive(row)) continue;

    if (!state[row.scope]) state[row.scope] = {};
    const val = parseValue(row.value);

    // Check if this is a computed view
    const isView = row.scope === "_view" && typeof val === "object" && val !== null && val._cel_expr;

    // If has enabled_expr, defer until context is partially built
    if (row.enabled_expr) {
      deferredEnabled.push({
        scope: row.scope,
        key: row.key,
        value: val,
        enabled_expr: row.enabled_expr,
        isView: !!isView,
        viewExpr: isView ? val._cel_expr : undefined,
      });
      continue;
    }

    if (isView) {
      computedViews.push({ key: row.key, expr: val._cel_expr });
    } else {
      state[row.scope][row.key] = val;
    }
  }

  // Load agents (filter by timer on enabled_expr later)
  const agentResult = await sqlite.execute({
    sql: `SELECT id, name, role, status, waiting_on, last_heartbeat, enabled_expr FROM agents WHERE room_id = ?`,
    args: [roomId],
  });
  const agentRows = rows2objects(agentResult) as any[];

  const agents: Record<string, any> = {};
  const deferredAgents: { id: string; data: any; enabled_expr: string }[] = [];

  for (const a of agentRows) {
    if (a.enabled_expr) {
      deferredAgents.push({
        id: a.id,
        data: {
          name: a.name,
          role: a.role,
          status: a.status || "unknown",
          waiting_on: a.waiting_on || null,
          last_heartbeat: a.last_heartbeat || null,
        },
        enabled_expr: a.enabled_expr,
      });
      continue;
    }
    agents[a.id] = {
      name: a.name,
      role: a.role,
      status: a.status || "unknown",
      waiting_on: a.waiting_on || null,
      last_heartbeat: a.last_heartbeat || null,
    };
  }

  // Message aggregates (only count timer-live, non-enabled-gated messages for simplicity)
  // TODO: could filter by enabled_expr but aggregates are less critical
  const countResult = await sqlite.execute({
    sql: `SELECT COUNT(*) as total,
          SUM(CASE WHEN claimed_by IS NULL THEN 1 ELSE 0 END) as unclaimed
          FROM messages WHERE room_id = ?
          AND (timer_effect IS NULL
               OR (timer_effect = 'delete' AND (timer_expires_at IS NULL OR timer_expires_at > datetime('now'))
                   AND (timer_ticks_left IS NULL OR timer_ticks_left > 0))
               OR (timer_effect = 'enable' AND ((timer_expires_at IS NOT NULL AND timer_expires_at <= datetime('now'))
                   OR (timer_ticks_left IS NOT NULL AND timer_ticks_left <= 0))))`,
    args: [roomId],
  });
  const counts = rows2objects(countResult)[0] as any;

  // Load actions for context
  const actionResult = await sqlite.execute({
    sql: `SELECT id, if_expr, enabled_expr, timer_effect, timer_expires_at, timer_ticks_left FROM actions WHERE room_id = ?`,
    args: [roomId],
  });
  const actionRows = rows2objects(actionResult) as any[];

  const actionsCtx: Record<string, any> = {};
  const deferredActions: { id: string; if_expr: string | null; enabled_expr: string }[] = [];

  for (const a of actionRows) {
    if (!isTimerLive(a)) continue;
    if (a.enabled_expr) {
      deferredActions.push({ id: a.id, if_expr: a.if_expr, enabled_expr: a.enabled_expr });
      continue;
    }
    actionsCtx[a.id] = { enabled: true };
  }

  // Build initial context (without deferred items)
  const ctx: Record<string, any> = {
    state,
    agents,
    messages: {
      count: Number(counts.total || 0),
      unclaimed: Number(counts.unclaimed || 0),
    },
    actions: actionsCtx,
  };

  // Add self reference
  if (selfAgent) {
    ctx.self = selfAgent;
  }

  // Resolve computed views (non-enabled-gated)
  if (computedViews.length > 0) {
    if (!state._view) state._view = {};
    for (const view of computedViews) {
      try {
        const result = evaluate(view.expr, ctx);
        state._view[view.key] = typeof result === "bigint" ? Number(result) : result;
      } catch (e: any) {
        state._view[view.key] = { _error: e.message };
      }
    }
  }

  // Now resolve deferred enabled expressions against the partial context
  for (const d of deferredEnabled) {
    try {
      const result = evaluate(d.enabled_expr, ctx);
      if (result) {
        if (!state[d.scope]) state[d.scope] = {};
        if (d.isView && d.viewExpr) {
          try {
            const viewResult = evaluate(d.viewExpr, ctx);
            if (!state._view) state._view = {};
            state._view[d.key] = typeof viewResult === "bigint" ? Number(viewResult) : viewResult;
          } catch (e: any) {
            if (!state._view) state._view = {};
            state._view[d.key] = { _error: e.message };
          }
        } else {
          state[d.scope][d.key] = d.value;
        }
      }
    } catch {
      // Expression error = not enabled
    }
  }

  for (const d of deferredAgents) {
    try {
      const result = evaluate(d.enabled_expr, ctx);
      if (result) {
        agents[d.id] = d.data;
      }
    } catch {
      // Expression error = not enabled
    }
  }

  for (const d of deferredActions) {
    try {
      const result = evaluate(d.enabled_expr, ctx);
      if (result) {
        actionsCtx[d.id] = { enabled: true };
      }
    } catch {
      // Expression error = not enabled
    }
  }

  return ctx;
}

/**
 * Evaluate a CEL expression against room state.
 * Returns { ok: true, value } or { ok: false, error }.
 */
export async function evalCel(
  roomId: string,
  expr: string,
  ctx?: Record<string, any>,
): Promise<{ ok: true; value: any } | { ok: false; error: string }> {
  try {
    const context = ctx ?? (await buildContext(roomId));
    const result = evaluate(expr, context);
    const value = typeof result === "bigint" ? Number(result) : result;
    return { ok: true, value };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Evaluate a CEL expression with additional params context (for parameterized actions).
 */
export function evalCelWithParams(
  expr: string,
  ctx: Record<string, any>,
  params: Record<string, any>,
): { ok: true; value: any } | { ok: false; error: string } {
  try {
    const extendedCtx = { ...ctx, params };
    const result = evaluate(expr, extendedCtx);
    const value = typeof result === "bigint" ? Number(result) : result;
    return { ok: true, value };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Validate a CEL expression by attempting evaluation with an empty context.
 * Syntax errors are caught; missing variable errors mean valid syntax.
 */
export function validateCel(expr: string): { valid: true } | { valid: false; error: string } {
  try {
    // Evaluate against minimal context — syntax errors throw, missing vars are OK
    evaluate(expr, { state: {}, agents: {}, messages: { count: 0, unclaimed: 0 }, actions: {}, params: {}, self: "" });
    return { valid: true };
  } catch (e: any) {
    const msg = e.message || String(e);
    // "No such key" means the expression is syntactically valid but references
    // variables not in our test context — that's fine
    if (msg.includes("No such key") || msg.includes("no such key")) {
      return { valid: true };
    }
    return { valid: false, error: msg };
  }
}
