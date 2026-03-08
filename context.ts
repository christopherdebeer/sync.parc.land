/**
 * context.ts — Context assembly, dashboard polling, and CEL evaluation endpoint.
 *
 * Contains buildExpandedContext (the main context builder), dashboardPoll
 * (parallel query bundle for the dashboard UI), evalExpression, and
 * the ContextRequest interface + parser.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { evaluate } from "npm:@marcbachmann/cel-js";
import { json, rows2objects } from "./utils.ts";
import { buildContext, buildViewContext, evalCel, type BuildContextOptions } from "./cel.ts";
import { isTimerLive } from "./timers.ts";
import { hasFullReadAccess, touchAgent, type AuthResult } from "./auth.ts";
import { formatAction, computeContestedTargets } from "./actions.ts";
import { BUILTIN_ACTIONS, OVERRIDABLE_BUILTINS } from "./invoke.ts";
import { HELP_SYSTEM } from "./help-content.ts";

// ── ContextRequest ──

/** ContextRequest — first-class type describing what context to return.
 *
 * The agent can request different shapes of context:
 * - `depth`: how much action detail to include
 *     "lean"  — id, description, available (default — smallest payload)
 *     "full"  — + writes, if, params
 *     "usage" — + invocation_count (adoption signal)
 * - `only`: return only these top-level sections (e.g. ["state", "messages"])
 * - `actions`: include actions section (default true)
 * - `messages`: include messages section (default true)
 * - `messagesAfter`: seq cursor — only return messages after this seq
 * - `messagesLimit`: max messages to return (default 100, max 500)
 * - `include`: extra state scopes to include (e.g. "_audit")
 */
export interface ContextRequest {
  depth?: "lean" | "full" | "usage";
  only?: string[];
  actions?: boolean;
  messages?: boolean;
  messagesAfter?: number;
  messagesLimit?: number;
  include?: string[];
}

/** Parse a ContextRequest from URL search params */
export function parseContextRequest(url: URL): ContextRequest {
  const req: ContextRequest = {};
  const depth = url.searchParams.get("depth");
  if (depth === "lean" || depth === "full" || depth === "usage") req.depth = depth;
  const only = url.searchParams.get("only");
  if (only) req.only = only.split(",").map(s => s.trim()).filter(Boolean);
  const actions = url.searchParams.get("actions");
  if (actions === "false") req.actions = false;
  const messages = url.searchParams.get("messages");
  if (messages === "false") req.messages = false;
  const after = url.searchParams.get("messages_after");
  if (after) req.messagesAfter = parseInt(after);
  const limit = url.searchParams.get("messages_limit");
  if (limit) req.messagesLimit = parseInt(limit);
  const include = url.searchParams.get("include");
  if (include) req.include = include.split(",").map(s => s.trim()).filter(Boolean);
  return req;
}

// ── buildExpandedContext ──

/** Build expanded context with message bodies, full action definitions, and built-in actions.
 *
 * Returns a self-describing envelope with a `_context` section that tells the caller
 * what was included, what was elided, and how to expand elided sections. */
export async function buildExpandedContext(roomId: string, auth: AuthResult, req: ContextRequest = {}): Promise<Record<string, any>> {
  const depth = req.depth ?? "lean";
  const includeActions = req.actions !== false;
  const includeMessages = req.messages !== false;
  const includedScopes = req.include ?? [];

  const ctx = await buildContext(roomId, {
    selfAgent: auth.agentId ?? undefined,
    allScopes: hasFullReadAccess(auth),
  });

  // ---- Messages ----
  let messagesSection: any;
  let elided: string[] = [];

  if (includeMessages) {
    const messagesLimit = Math.min(req.messagesLimit ?? 100, 500);
    // Explicit column list — omits `version` to avoid INTEGER-affinity overflow on production
    // databases where the v5→v6 migration silently failed (column already existed as INTEGER).
    let msgSql = `SELECT scope, key, sort_key, value, revision, updated_at,
                  timer_json, timer_expires_at, timer_ticks_left, timer_tick_on,
                  timer_effect, timer_started_at, enabled_expr
                  FROM state WHERE room_id = ? AND scope = '_messages'`;
    const msgArgs: any[] = [roomId];
    if (req.messagesAfter) {
      msgSql += ` AND sort_key > ?`;
      msgArgs.push(req.messagesAfter);
    }
    msgSql += ` ORDER BY sort_key DESC LIMIT ?`;
    msgArgs.push(messagesLimit);
    const msgResult = await sqlite.execute({ sql: msgSql, args: msgArgs });
    let msgRows = rows2objects(msgResult).filter((r: any) => isTimerLive(r));
    msgRows.reverse();
    const recentMessages = msgRows.map((r: any) => {
      let parsed: any = {};
      try { parsed = JSON.parse(r.value); } catch { parsed = { body: r.value }; }
      return { seq: r.sort_key, ...parsed };
    });

    // Update last_seen_seq
    if (auth.agentId && recentMessages.length > 0) {
      const maxSeq = Math.max(...recentMessages.map((m: any) => m.seq ?? 0));
      if (maxSeq > 0) {
        sqlite.execute({
          sql: `UPDATE agents SET last_seen_seq = MAX(last_seen_seq, ?) WHERE id = ? AND room_id = ?`,
          args: [maxSeq, auth.agentId, roomId],
        }).catch(() => {});
      }
    }

    // Count total messages (to detect elision)
    const totalMsgResult = await sqlite.execute({
      sql: `SELECT COUNT(*) as cnt FROM state WHERE room_id = ? AND scope = '_messages'`,
      args: [roomId],
    });
    const totalMessages = Number(rows2objects(totalMsgResult)[0]?.cnt ?? 0);
    const oldestSeq = recentMessages.length > 0 ? (recentMessages[0].seq ?? 0) : 0;

    const directed_unread = ctx.messages.directed_unread ?? 0;

    messagesSection = {
      count: ctx.messages.count,
      unread: ctx.messages.unread,
      directed_unread,
      recent: recentMessages,
    };

    // Mark elision if we have more messages than we returned
    if (totalMessages > messagesLimit) {
      const missing = totalMessages - recentMessages.length;
      messagesSection._elided = {
        total: totalMessages,
        returned: recentMessages.length,
        missing,
        oldest_seq: oldestSeq,
        _expand: `?messages_after=0&messages_limit=${Math.min(totalMessages, 500)}`,
      };
    }
  } else {
    elided.push("messages");
  }

  // ---- Actions ----
  let actionsSection: Record<string, any> | undefined;

  if (includeActions) {
    const actionResult = await sqlite.execute({
      sql: `SELECT * FROM actions WHERE room_id = ? ORDER BY created_at`, args: [roomId],
    });
    let actionRows = rows2objects(actionResult);
    actionRows = actionRows.filter((row: any) => isTimerLive(row));

    // Invocation counts for "usage" depth
    let invocationCounts: Record<string, number> = {};
    if (depth === "usage") {
      const auditResult = await sqlite.execute({
        sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_audit' ORDER BY sort_key DESC LIMIT 500`,
        args: [roomId],
      });
      for (const row of rows2objects(auditResult)) {
        try {
          const entry = JSON.parse(row.value);
          if (entry.action && !entry.builtin) {
            invocationCounts[entry.action] = (invocationCounts[entry.action] ?? 0) + 1;
          }
        } catch {}
      }
    }

    actionsSection = {};
    for (const row of actionRows) {
      if (row.enabled_expr) {
        try { if (!evaluate(row.enabled_expr, ctx)) continue; } catch { continue; }
      }

      // lean: just available + description
      const entry: any = {
        available: true,
        description: row.description ?? null,
      };

      if (row.if_expr) {
        try { entry.available = !!evaluate(row.if_expr, ctx); } catch { entry.available = false; }
      }

      if (depth === "full" || depth === "usage") {
        entry.enabled = true;
        if (row.params_json) {
          try { entry.params = JSON.parse(row.params_json); } catch {}
        }
        if (row.writes_json) {
          try { const w = JSON.parse(row.writes_json); if (w.length > 0) entry.writes = w; } catch {}
        }
        if (row.if_expr) entry.if = row.if_expr;
        if (row.scope && row.scope !== "_shared") entry.scope = row.scope;
      }

      if (depth === "usage") {
        entry.invocation_count = invocationCounts[row.id] ?? 0;
      }

      actionsSection[row.id] = entry;
    }

    // Add built-in actions (skip overridable ones that have a custom registration)
    for (const [id, def] of Object.entries(BUILTIN_ACTIONS)) {
      if (OVERRIDABLE_BUILTINS.has(id) && actionsSection[id]) continue;
      const builtinEntry: any = {
        available: true,
        builtin: true,
        description: def.description,
      };
      if (depth === "full" || depth === "usage") {
        builtinEntry.enabled = true;
        builtinEntry.params = def.params ?? null;
      }
      actionsSection[id] = builtinEntry;
    }
  } else {
    elided.push("actions");
  }

  // ---- Assemble state, stripping _audit / _messages unless opted in ----
  const stateOut = { ...ctx.state };
  if (!includedScopes.includes("_audit")) delete stateOut._audit;
  if (!includedScopes.includes("_messages")) delete stateOut._messages;

  // ---- Apply `only` filter ----
  let result: Record<string, any> = {
    state: stateOut,
    views: ctx.views,
    agents: ctx.agents,
    ...(actionsSection !== undefined ? { actions: actionsSection } : {}),
    ...(messagesSection !== undefined ? { messages: messagesSection } : {}),
    self: ctx.self,
  };

  if (req.only && req.only.length > 0) {
    const filtered: Record<string, any> = {};
    for (const s of req.only) {
      if (s in result) filtered[s] = result[s];
      if (s.startsWith("state.")) {
        const scope = s.slice(6);
        if (!filtered.state) filtered.state = {};
        filtered.state[scope] = ctx.state?.[scope] ?? {};
      }
    }
    // self always included
    if (result.self) filtered.self = result.self;
    // track what was filtered out
    for (const key of Object.keys(result)) {
      if (!(key in filtered) && key !== "self") elided.push(key);
    }
    result = filtered;
  }

  // ---- _contested synthetic view ----
  // Computed from action write targets — any (scope:key) targeted by 2+ actions.
  // Injected as a system view so agents can gate on it and wait for it.
  const contestedTargets = await computeContestedTargets(roomId);
  const hasContested = Object.keys(contestedTargets).length > 0;
  if (hasContested) {
    result.views = {
      ...result.views,
      _contested: {
        value: contestedTargets,
        description: "Write targets contested by 2+ actions. Keys are scope:key, values are lists of competing action IDs.",
        system: true,
      },
    };
  }

  // ---- _context envelope ----
  // Compute situational help keys — which help topics are currently relevant
  const contextHelp: string[] = [];
  // Empty room (no registered actions beyond builtins): suggest vocabulary_bootstrap
  const customActionCount = actionsSection
    ? Object.keys(actionsSection).filter(k => !BUILTIN_ACTIONS[k]).length
    : 0;
  if (customActionCount === 0) {
    contextHelp.push("vocabulary_bootstrap");
  }
  // Directed unread: suggest directed_messages
  if (messagesSection?.directed_unread > 0) {
    contextHelp.push("directed_messages");
  }
  // Contested actions: suggest contested_actions
  if (hasContested) {
    contextHelp.push("contested_actions");
  }
  // Messages truncated: surface at top-level _context so agents don't miss it
  if (messagesSection?._elided) {
    contextHelp.push("context_shaping");
  }

  result._context = {
    sections: Object.keys(result).filter(k => k !== "_context"),
    depth,
    ...(messagesSection?._elided ? {
      messages_truncated: {
        missing: messagesSection._elided.missing,
        oldest_seq: messagesSection._elided.oldest_seq,
        _expand: messagesSection._elided._expand,
      },
    } : {}),
    ...(contextHelp.length > 0 ? { help: contextHelp } : {}),
    ...(elided.length > 0 ? {
      elided,
      _expand: elided.map(s => {
        if (s === "messages") return `?messages=true`;
        if (s === "actions") return `?actions=true`;
        return `?only=${s}`;
      }),
    } : {}),
    request: {
      ...(req.depth ? { depth: req.depth } : {}),
      ...(req.only ? { only: req.only } : {}),
      ...(req.actions === false ? { actions: false } : {}),
      ...(req.messages === false ? { messages: false } : {}),
      ...(req.messagesAfter ? { messages_after: req.messagesAfter } : {}),
      ...(req.messagesLimit ? { messages_limit: req.messagesLimit } : {}),
    },
  };

  return result;
}

// ── Dashboard poll ──

/** Single-request bundle for dashboard polling. Returns all data sets in one response. */
export async function dashboardPoll(roomId: string, url: URL, auth: AuthResult) {
  const messagesLimit = Math.min(parseInt(url.searchParams.get("messages_limit") ?? "500"), 2000);
  const auditLimit = Math.min(parseInt(url.searchParams.get("audit_limit") ?? "500"), 2000);

  // Run all queries concurrently — same logic as the individual endpoints
  const [agentsRes, stateRes, msgsRes, actionsRes, viewsRes, auditRes] = await Promise.all([
    // Agents
    sqlite.execute({ sql: `SELECT * FROM agents WHERE room_id = ? ORDER BY joined_at`, args: [roomId] }),
    // State (respects scope privacy, excludes _messages and _audit which have dedicated sections)
    (async () => {
      let sql = `SELECT * FROM state WHERE room_id = ? AND scope != '_messages' AND scope != '_audit'`;
      const args: any[] = [roomId];
      if (hasFullReadAccess(auth)) {
        // admin or view token: everything
      } else if (auth.authenticated && auth.kind === "agent") {
        const accessibleScopes = [auth.agentId!, ...auth.grants].filter(Boolean);
        const conditions = [`scope LIKE '\\_%' ESCAPE '\\'`];
        for (const s of accessibleScopes) { conditions.push(`scope = ?`); args.push(s); }
        sql += ` AND (${conditions.join(" OR ")})`;
      } else {
        sql += ` AND scope LIKE '\\_%' ESCAPE '\\'`;
      }
      sql += ` ORDER BY CASE WHEN sort_key IS NOT NULL THEN sort_key ELSE 0 END ASC LIMIT 500`;
      return sqlite.execute({ sql, args });
    })(),
    // Messages
    sqlite.execute({
      sql: `SELECT * FROM state WHERE room_id = ? AND scope = '_messages' ORDER BY sort_key ASC LIMIT ?`,
      args: [roomId, messagesLimit],
    }),
    // Actions
    sqlite.execute({ sql: `SELECT * FROM actions WHERE room_id = ? ORDER BY created_at`, args: [roomId] }),
    // Views
    sqlite.execute({ sql: `SELECT * FROM views WHERE room_id = ? ORDER BY created_at`, args: [roomId] }),
    // Audit
    sqlite.execute({
      sql: `SELECT * FROM state WHERE room_id = ? AND scope = '_audit' ORDER BY sort_key ASC LIMIT ?`,
      args: [roomId, auditLimit],
    }),
  ]);

  // Process agents
  const agents = rows2objects(agentsRes).map((a: any) => { delete a.token_hash; return a; });

  // Process state with timer/enabled filtering
  const ctx = await buildContext(roomId, { selfAgent: auth.agentId ?? undefined });
  let stateRows = rows2objects(stateRes);
  stateRows = stateRows.filter((row: any) => {
    if (!isTimerLive(row)) return false;
    if (row.enabled_expr) {
      try { return !!evaluate(row.enabled_expr, ctx); } catch { return false; }
    }
    return true;
  }).map((row: any) => {
    try { return { ...row, value: JSON.parse(row.value) }; } catch { return row; }
  });

  // Process messages
  let msgs = rows2objects(msgsRes);
  msgs = msgs.filter((row: any) => isTimerLive(row)).map((row: any) => {
    try { return { ...row, value: JSON.parse(row.value) }; } catch { return row; }
  });

  // Process actions
  let actionRows = rows2objects(actionsRes);
  actionRows = actionRows.filter((row: any) => isTimerLive(row));
  actionRows = actionRows.filter((row: any) => {
    if (!row.enabled_expr) return true;
    try { return !!evaluate(row.enabled_expr, ctx); } catch { return false; }
  });
  const actions = actionRows.map((row: any) => {
    const action = formatAction(row);
    if (row.if_expr) {
      try { action.available = !!evaluate(row.if_expr, ctx); } catch { action.available = false; }
    } else { action.available = true; }
    return action;
  });

  // Process views
  let viewRows = rows2objects(viewsRes);
  viewRows = viewRows.filter((row: any) => isTimerLive(row));
  const views: any[] = [];
  for (const row of viewRows) {
    if (row.enabled_expr) {
      try { if (!evaluate(row.enabled_expr, ctx)) continue; } catch { continue; }
    }
    const viewCtx = await buildViewContext(roomId, row.scope, ctx);
    let value: any = null;
    try {
      const evalResult = evaluate(row.expr, viewCtx);
      value = typeof evalResult === "bigint" ? Number(evalResult) : evalResult;
    } catch (e: any) { value = { _error: e.message }; }
    views.push({
      id: row.id, room_id: row.room_id, scope: row.scope, description: row.description,
      expr: row.expr, enabled: row.enabled_expr, registered_by: row.registered_by,
      version: row.version, created_at: row.created_at, value,
      render: row.render_json ? (() => { try { return JSON.parse(row.render_json); } catch { return null; } })() : null,
    });
  }

  // Process audit
  let auditRows = rows2objects(auditRes);
  auditRows = auditRows.map((row: any) => {
    try { return { ...row, value: JSON.parse(row.value) }; } catch { return row; }
  });

  // Compute _contested synthetic view
  const contestedTargets = await computeContestedTargets(roomId);

  return json({ agents, state: stateRows, messages: msgs, actions, views, audit: auditRows,
    ...(Object.keys(contestedTargets).length > 0 ? { _contested: contestedTargets } : {}) });
}

// ── CEL eval endpoint ──

export async function evalExpression(roomId: string, body: any, auth: AuthResult) {
  const expr = body.expr;
  if (!expr || typeof expr !== "string") return json({ error: "expr string is required" }, 400);
  touchAgent(roomId, auth.agentId);
  const ctx = await buildContext(roomId, { selfAgent: auth.agentId ?? undefined });
  const result = await evalCel(roomId, expr, ctx);
  if (!result.ok) return json({ error: "cel_error", expression: expr, detail: result.error }, 400);
  return json({ expression: expr, value: result.value });
}
