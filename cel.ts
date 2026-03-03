import { sqlite } from "https://esm.town/v/std/sqlite";
import { evaluate } from "npm:@marcbachmann/cel-js";
import { isTimerLive } from "./timers.ts";

/**
 * CEL (Common Expression Language) evaluator for agent-sync v5.
 *
 * Context shape (per-agent, respecting scope privacy):
 *
 *   {
 *     state: {
 *       _shared: { phase: "executing", turn: 3, ... },
 *       self: { health: 80, inventory: [...] }   // own scope only
 *     },
 *     views: {
 *       "agent-a-status": "healthy",
 *       "total-score": 142
 *     },
 *     agents: {
 *       "agent-a": { name: "Alice", role: "warrior", status: "active" },
 *       "agent-b": { name: "Bob", role: "healer", status: "waiting" }
 *     },
 *     actions: {
 *       "attack": { available: true, enabled: true },
 *       "heal": { available: false, enabled: true }
 *     },
 *     messages: { count: 42, unread: 3 },
 *     self: "agent-a",
 *     params: {}
 *   }
 *
 * Private scopes: agent scopes are only visible to the owning agent (via `state.self`)
 * or to view/action evaluations where the registrar has scope authority.
 */

function rows2objects(result: { columns: string[]; rows: any[][] }) {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((col, i) => [col, row[i]]))
  );
}

function parseValue(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export interface BuildContextOptions {
  /** The requesting agent's ID. Used for `self` and scope privacy. */
  selfAgent?: string;
  /** Additional scopes to include (for view/action evaluation with registrar authority). */
  includeScopes?: string[];
  /** If true, include ALL scopes (for internal/admin use). */
  allScopes?: boolean;
}

/**
 * Build the CEL evaluation context from room data.
 * Respects scope privacy: only _shared, self scope, and explicitly included scopes are visible.
 */
export async function buildContext(roomId: string, opts: BuildContextOptions = {}): Promise<Record<string, any>> {
  const { selfAgent, includeScopes = [], allScopes = false } = opts;

  // Load all state
  const stateResult = await sqlite.execute({
    sql: `SELECT scope, key, sort_key, value, timer_effect, timer_expires_at, timer_ticks_left, enabled_expr FROM state WHERE room_id = ?`,
    args: [roomId],
  });
  const stateRows = rows2objects(stateResult) as any[];

  // Build state tree, respecting scope privacy
  const state: Record<string, Record<string, any>> = {};
  const deferredEnabled: { scope: string; key: string; value: any; enabled_expr: string }[] = [];

  for (const row of stateRows) {
    if (!isTimerLive(row)) continue;

    // Scope privacy: determine visibility
    const scope = row.scope;
    const isShared = scope === "_shared";
    const isSelf = selfAgent && scope === selfAgent;
    const isExplicitlyIncluded = includeScopes.includes(scope);
    const isSystemScope = scope.startsWith("_"); // _shared, _messages, etc.

    if (!allScopes && !isShared && !isSelf && !isExplicitlyIncluded && !isSystemScope) {
      continue; // private scope, not visible to this agent
    }

    // Defer enabled expressions
    if (row.enabled_expr) {
      deferredEnabled.push({ scope, key: row.key, value: parseValue(row.value), enabled_expr: row.enabled_expr });
      continue;
    }

    // Map self scope to "self" in context
    const contextScope = (isSelf && !allScopes) ? "self" : scope;
    if (!state[contextScope]) state[contextScope] = {};
    state[contextScope][row.key] = parseValue(row.value);
  }

  // Load agents (public presence only)
  const agentResult = await sqlite.execute({
    sql: `SELECT id, name, role, status, waiting_on, last_heartbeat, last_seen_seq, enabled_expr FROM agents WHERE room_id = ?`,
    args: [roomId],
  });
  const agentRows = rows2objects(agentResult) as any[];

  const agents: Record<string, any> = {};
  const deferredAgents: { id: string; data: any; enabled_expr: string }[] = [];

  for (const a of agentRows) {
    const data = {
      name: a.name,
      role: a.role,
      status: a.status || "unknown",
      waiting_on: a.waiting_on || null,
      last_heartbeat: a.last_heartbeat || null,
    };
    if (a.enabled_expr) {
      deferredAgents.push({ id: a.id, data, enabled_expr: a.enabled_expr });
      continue;
    }
    agents[a.id] = data;
  }

  // Message counts from _messages scope
  const countResult = await sqlite.execute({
    sql: `SELECT COUNT(*) as total FROM state WHERE room_id = ? AND scope = '_messages'
          AND (timer_effect IS NULL
               OR (timer_effect = 'delete' AND (timer_expires_at IS NULL OR timer_expires_at > datetime('now'))
                   AND (timer_ticks_left IS NULL OR timer_ticks_left > 0))
               OR (timer_effect = 'enable' AND ((timer_expires_at IS NOT NULL AND timer_expires_at <= datetime('now'))
                   OR (timer_ticks_left IS NOT NULL AND timer_ticks_left <= 0))))`,
    args: [roomId],
  });
  const totalCount = Number((rows2objects(countResult)[0] as any)?.total || 0);

  // Unread + directed_unread counts for self
  let unreadCount = 0;
  let directedUnread = 0;
  if (selfAgent) {
    const agent = agentRows.find(a => a.id === selfAgent);
    const lastSeen = agent?.last_seen_seq ?? 0;
    const unreadResult = await sqlite.execute({
      sql: `SELECT COUNT(*) as c FROM state WHERE room_id = ? AND scope = '_messages' AND sort_key > ?
            AND (timer_effect IS NULL
                 OR (timer_effect = 'delete' AND (timer_expires_at IS NULL OR timer_expires_at > datetime('now'))
                     AND (timer_ticks_left IS NULL OR timer_ticks_left > 0))
                 OR (timer_effect = 'enable' AND ((timer_expires_at IS NOT NULL AND timer_expires_at <= datetime('now'))
                     OR (timer_ticks_left IS NOT NULL AND timer_ticks_left <= 0))))`,
      args: [roomId, lastSeen],
    });
    unreadCount = Number((rows2objects(unreadResult)[0] as any)?.c || 0);

    // directed_unread: messages since lastSeen with to[] containing selfAgent
    // Fetch bodies to check the JSON to field (SQLite has no native JSON array search)
    const directedResult = await sqlite.execute({
      sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_messages' AND sort_key > ?`,
      args: [roomId, lastSeen],
    });
    for (const row of rows2objects(directedResult)) {
      try {
        const msg = JSON.parse((row as any).value);
        if (Array.isArray(msg.to) && msg.to.includes(selfAgent)) directedUnread++;
      } catch { /* malformed message — skip */ }
    }
  }

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

  // Build initial context (without deferred items or views)
  const ctx: Record<string, any> = {
    state,
    views: {},
    agents,
    messages: { count: totalCount, unread: unreadCount, directed_unread: directedUnread },
    actions: actionsCtx,
    self: selfAgent ?? "",
    params: {},
  };

  // Resolve deferred enabled expressions
  for (const d of deferredEnabled) {
    try {
      if (evaluate(d.enabled_expr, ctx)) {
        const contextScope = (selfAgent && d.scope === selfAgent && !allScopes) ? "self" : d.scope;
        if (!state[contextScope]) state[contextScope] = {};
        state[contextScope][d.key] = d.value;
      }
    } catch { /* expression error = not enabled */ }
  }

  for (const d of deferredAgents) {
    try {
      if (evaluate(d.enabled_expr, ctx)) {
        agents[d.id] = d.data;
      }
    } catch {}
  }

  for (const d of deferredActions) {
    try {
      if (evaluate(d.enabled_expr, ctx)) {
        actionsCtx[d.id] = { enabled: true };
      }
    } catch {}
  }

  // Resolve views — each view's expression runs with its registrar's scope authority
  const viewResult = await sqlite.execute({
    sql: `SELECT id, scope, expr, enabled_expr, timer_effect, timer_expires_at, timer_ticks_left FROM views WHERE room_id = ?`,
    args: [roomId],
  });
  const viewRows = rows2objects(viewResult) as any[];

  for (const v of viewRows) {
    if (!isTimerLive(v)) continue;

    // Check enabled
    if (v.enabled_expr) {
      try {
        if (!evaluate(v.enabled_expr, ctx)) continue;
      } catch { continue; }
    }

    // Build view-specific context with registrar's scope access
    const viewCtx = await buildViewContext(roomId, v.scope, ctx);

    try {
      const result = evaluate(v.expr, viewCtx);
      ctx.views[v.id] = typeof result === "bigint" ? Number(result) : result;
    } catch (e: any) {
      ctx.views[v.id] = { _error: e.message };
    }
  }

  // Evaluate action availability now that views are resolved
  for (const a of actionRows) {
    if (!isTimerLive(a)) continue;
    if (!actionsCtx[a.id]) continue;
    if (a.if_expr) {
      try {
        actionsCtx[a.id].available = !!evaluate(a.if_expr, ctx);
      } catch {
        actionsCtx[a.id].available = false;
      }
    } else {
      actionsCtx[a.id].available = true;
    }
  }

  return ctx;
}

/**
 * Build a context for view evaluation that includes the registrar's private scope.
 * Augments the base context with the view registrar's scope data.
 */
export async function buildViewContext(
  roomId: string,
  registrarScope: string,
  baseCtx: Record<string, any>,
): Promise<Record<string, any>> {
  // If the registrar scope is _shared or already in context, no augmentation needed
  if (registrarScope === "_shared" || baseCtx.state[registrarScope]) {
    return baseCtx;
  }

  // Load registrar's scope data
  const scopeResult = await sqlite.execute({
    sql: `SELECT key, value, timer_effect, timer_expires_at, timer_ticks_left, enabled_expr FROM state
          WHERE room_id = ? AND scope = ?`,
    args: [roomId, registrarScope],
  });
  const rows = rows2objects(scopeResult) as any[];

  const scopeData: Record<string, any> = {};
  for (const row of rows) {
    if (!isTimerLive(row)) continue;
    if (row.enabled_expr) {
      try {
        if (!evaluate(row.enabled_expr, baseCtx)) continue;
      } catch { continue; }
    }
    scopeData[row.key] = parseValue(row.value);
  }

  // Create augmented context with registrar's scope
  return {
    ...baseCtx,
    state: {
      ...baseCtx.state,
      [registrarScope]: scopeData,
    },
  };
}

/**
 * Evaluate a CEL expression against room state.
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
 * Evaluate a CEL expression with additional params context.
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
 * Validate a CEL expression by attempting evaluation with minimal context.
 */
export function validateCel(expr: string): { valid: true } | { valid: false; error: string } {
  try {
    evaluate(expr, {
      state: {}, views: {}, agents: {}, messages: { count: 0, unclaimed: 0, unread: 0, directed_unread: 0 },
      actions: {}, params: {}, self: "",
    });
    return { valid: true };
  } catch (e: any) {
    const msg = e.message || String(e);
    if (msg.includes("No such key") || msg.includes("no such key")) {
      return { valid: true };
    }
    return { valid: false, error: msg };
  }
}
