import { sqlite } from "https://esm.town/v/std/sqlite";
import { evaluate } from "npm:@marcbachmann/cel-js";
import { isTimerLive } from "./timers.ts";

/**
 * CEL (Common Expression Language) evaluator for agent-sync v8.
 *
 * v8: All entity data (agents, actions, views) read from state table scopes.
 * Legacy table fallbacks removed — v8 backfill ensures all rooms have scope data.
 * The agents table is retained for auth (token_hash) and unread tracking (last_seen_seq).
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

  // v8: Extract agents from _agents scope (already in stateRows)
  const agents: Record<string, any> = {};

  for (const row of stateRows) {
    if (row.scope !== "_agents") continue;
    if (!isTimerLive(row)) continue;
    const val = parseValue(row.value);
    agents[row.key] = {
      name: val.name ?? row.key,
      role: val.role ?? "agent",
      status: val.status ?? "active",
      waiting_on: val.waiting_on ?? null,
      last_heartbeat: val.last_heartbeat ?? null,
    };
  }

  // Fallback removed — v8 backfill ensures all rooms have _agents scope data.
  // If _agents scope is empty, the room has no agents (which is valid).

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
    // v8: Read last_seen_seq from _agents scope
    let lastSeen = 0;
    try {
      const agentEntry = stateRows.find(r => r.scope === "_agents" && r.key === selfAgent);
      if (agentEntry) {
        const val = parseValue(agentEntry.value);
        lastSeen = val.last_seen_seq ?? 0;
      }
    } catch {}
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

  // v8: Extract actions from _actions scope (already in stateRows)
  const actionsCtx: Record<string, any> = {};

  for (const row of stateRows) {
    if (row.scope !== "_actions") continue;
    if (!isTimerLive(row)) continue;
    const val = parseValue(row.value);
    // _actions scope entries have enabled/if as fields in the value JSON
    if (val.enabled) {
      try { if (!evaluate(val.enabled, { state, views: {}, agents, messages: { count: 0, unread: 0, directed_unread: 0 }, actions: {}, self: selfAgent ?? "", params: {} })) continue; } catch { continue; }
    }
    actionsCtx[row.key] = { enabled: true, if_expr: val.if ?? null };
  }

  // Fallback removed — v8 backfill ensures all rooms have _actions scope data.

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

  // Resolve deferred enabled state entries
  for (const d of deferredEnabled) {
    try {
      if (evaluate(d.enabled_expr, ctx)) {
        const contextScope = (selfAgent && d.scope === selfAgent && !allScopes) ? "self" : d.scope;
        if (!state[contextScope]) state[contextScope] = {};
        state[contextScope][d.key] = d.value;
      }
    } catch { /* expression error = not enabled */ }
  }

  // v8: Resolve views from _views scope (already in stateRows)
  // Fallback removed — v8 backfill ensures all rooms have _views scope data.
  const viewEntries = stateRows.filter(r => r.scope === "_views" && isTimerLive(r));

  for (const row of viewEntries) {
    const val = parseValue(row.value);
    if (!val.expr) continue;

    // Check enabled
    if (val.enabled) {
      try { if (!evaluate(val.enabled, ctx)) continue; } catch { continue; }
    }

    // Build view-specific context with registrar's scope access
    const viewCtx = await buildViewContext(roomId, val.scope ?? "_shared", ctx);

    try {
      const result = evaluate(val.expr, viewCtx);
      ctx.views[row.key] = typeof result === "bigint" ? Number(result) : result;
    } catch (e: any) {
      ctx.views[row.key] = { _error: e.message };
    }
  }

  // Evaluate action availability now that views are resolved
  for (const [id, actionEntry] of Object.entries(actionsCtx)) {
    const ifExpr = actionEntry.if_expr;
    if (ifExpr) {
      try {
        actionsCtx[id].available = !!evaluate(ifExpr, ctx);
      } catch {
        actionsCtx[id].available = false;
      }
    } else {
      actionsCtx[id].available = true;
    }
    // Clean up internal field
    delete actionsCtx[id].if_expr;
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
