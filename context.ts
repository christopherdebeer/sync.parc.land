/**
 * context.ts — Context assembly and CEL evaluation endpoint.
 *
 * Contains buildExpandedContext (the main context builder for MCP /context endpoint),
 * evalExpression, and the ContextRequest interface + parser.
 *
 * v8: Dashboard polling moved to poll-v8.ts (state-only, no legacy tables).
 * The old dashboardPoll has been removed.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { evaluate } from "npm:@marcbachmann/cel-js";
import { json, rows2objects } from "./utils.ts";
import { buildContext, buildViewContext, evalCel, type BuildContextOptions } from "./cel.ts";
import { isTimerLive } from "./timers.ts";
import { hasFullReadAccess, touchAgent, type AuthResult } from "./auth.ts";
import { computeContestedTargets } from "./actions.ts";
import { BUILTIN_ACTIONS, OVERRIDABLE_BUILTINS } from "./invoke.ts";
import { HELP_SYSTEM } from "./help-content.ts";
import { computeSalience } from "./salience.ts";

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

    // Update last_seen_seq in _agents scope
    if (auth.agentId && recentMessages.length > 0) {
      const maxSeq = Math.max(...recentMessages.map((m: any) => m.seq ?? 0));
      if (maxSeq > 0) {
        sqlite.execute({
          sql: `UPDATE state SET
                  value = json_set(value, '$.last_seen_seq', ?),
                  revision = revision + 1, updated_at = datetime('now')
                WHERE room_id = ? AND scope = '_agents' AND key = ?`,
          args: [maxSeq, roomId, auth.agentId],
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
    // v8: Read action definitions from _actions scope in state table
    const actionScopeResult = await sqlite.execute({
      sql: `SELECT key, value FROM state WHERE room_id = ? AND scope = '_actions'`,
      args: [roomId],
    });
    const actionEntries = rows2objects(actionScopeResult) as any[];

    // Invocation counts for "usage" depth
    let invocationCounts: Record<string, number> = {};
    if (depth === "usage") {
      const auditResult = await sqlite.execute({
        sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_audit' ORDER BY sort_key DESC LIMIT 500`,
        args: [roomId],
      });
      for (const row of rows2objects(auditResult)) {
        try {
          const entry = JSON.parse((row as any).value);
          if (entry.action && !entry.builtin) {
            invocationCounts[entry.action] = (invocationCounts[entry.action] ?? 0) + 1;
          }
        } catch {}
      }
    }

    actionsSection = {};
    for (const row of actionEntries) {
      let def: any;
      try { def = typeof row.value === "string" ? JSON.parse(row.value) : row.value; } catch { continue; }
      const id = row.key;

      // Check enabled
      if (def.enabled) {
        try { if (!evaluate(def.enabled, ctx)) continue; } catch { continue; }
      }

      // lean: just available + description
      const entry: any = {
        available: true,
        description: def.description ?? null,
      };

      if (def.if) {
        try { entry.available = !!evaluate(def.if, ctx); } catch { entry.available = false; }
      }

      if (depth === "full" || depth === "usage") {
        entry.enabled = true;
        if (def.params) entry.params = def.params;
        if (def.writes?.length > 0) entry.writes = def.writes;
        if (def.if) entry.if = def.if;
        if (def.scope && def.scope !== "_shared") entry.scope = def.scope;
      }

      if (depth === "usage") {
        entry.invocation_count = invocationCounts[id] ?? 0;
      }

      actionsSection[id] = entry;
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

  // ---- v8: _salience synthetic view (agent-specific) ----
  if (auth.authenticated && auth.agentId) {
    try {
      const salienceMap = await computeSalience(roomId, auth.agentId, {
        contestedTargets,
        limit: 20,
      });
      // Inject as a lightweight summary — full map available at /salience endpoint
      const topKeys = salienceMap.entries.slice(0, 10).map(e => ({
        key: `${e.scope}.${e.key}`,
        score: Math.round(e.score * 100) / 100,
        why: Object.entries(e.signals)
          .filter(([_, v]) => v > 0.1)
          .sort((a, b) => b[1] - a[1])
          .map(([k]) => k),
      }));
      if (topKeys.length > 0) {
        result.views = {
          ...result.views,
          _salience: {
            value: topKeys,
            description: "Top salient state keys for this agent. Score = weighted sum of recency, dependency, authorship, directed, contest, delta signals. Full map at GET /salience.",
            system: true,
          },
        };
      }
    } catch { /* salience is best-effort */ }
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
