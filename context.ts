/**
 * context.ts — v9 Projection layer.
 *
 * Takes the full wrapped context from buildContext (engine layer) and shapes
 * it for the requesting agent based on salience thresholds.
 *
 * Three tiers:
 *   Focus      (score >= focus_threshold):   full value + full _meta
 *   Peripheral (score >= elide_threshold):   full value + minimal _meta
 *   Elided     (score <  elide_threshold):   value: null + minimal _meta + expand hint
 *
 * Override params:
 *   expand        — force specific keys to Focus (e.g. ["_shared.some_key"])
 *   elision       — "none" to disable elision entirely
 *   meta_threshold — override where full _meta kicks in (default: 0.5)
 *   focus_threshold — override focus threshold (default: 0.5)
 *   elide_threshold — override elide threshold (default: 0.1)
 *
 * Replaces: _salience synthetic view, _contested synthetic view, _context envelope.
 * All metadata now lives in _meta on the relevant entries.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { json, rows2objects } from "./utils.ts";
import {
  buildContext,
  celEval,
  evalCel,
  type BuildContextOptions,
  type WrappedEntry,
  type EntryMeta,
} from "./cel.ts";
import { isTimerLive } from "./timers.ts";
import { hasFullReadAccess, touchAgent, type AuthResult } from "./auth.ts";
import { BUILTIN_ACTIONS, OVERRIDABLE_BUILTINS } from "./invoke.ts";
import { minimalMeta } from "./meta.ts";

// ── ContextRequest ──────────────────────────────────────────────────────

export interface ContextRequest {
  /** Action detail level */
  depth?: "lean" | "full" | "usage";
  /** Return only these top-level sections */
  only?: string[];
  /** Include actions section (default true) */
  actions?: boolean;
  /** Include messages section (default true) */
  messages?: boolean;
  /** Message seq cursor — only return messages after this seq */
  messagesAfter?: number;
  /** Max messages to return (default 100, max 500) */
  messagesLimit?: number;
  /** Extra state scopes to include (e.g. "_audit") */
  include?: string[];

  // ── v9 shaping params ──

  /** Force specific keys to Focus tier: ["_shared.key1", "_agents.explorer"] */
  expand?: string[];
  /** Disable elision entirely: "none" */
  elision?: "none" | "auto";
  /** Threshold for full _meta (default 0.5) */
  focusThreshold?: number;
  /** Threshold below which values are elided (default 0.1) */
  elideThreshold?: number;
}

/** Parse a ContextRequest from URL search params or MCP tool params */
export function parseContextRequest(url: URL): ContextRequest {
  const req: ContextRequest = {};
  const depth = url.searchParams.get("depth");
  if (depth === "lean" || depth === "full" || depth === "usage") req.depth = depth;
  const only = url.searchParams.get("only");
  if (only) req.only = only.split(",").map((s) => s.trim()).filter(Boolean);
  const actions = url.searchParams.get("actions");
  if (actions === "false") req.actions = false;
  const messages = url.searchParams.get("messages");
  if (messages === "false") req.messages = false;
  const after = url.searchParams.get("messages_after");
  if (after) req.messagesAfter = parseInt(after);
  const limit = url.searchParams.get("messages_limit");
  if (limit) req.messagesLimit = parseInt(limit);
  const include = url.searchParams.get("include");
  if (include) req.include = include.split(",").map((s) => s.trim()).filter(Boolean);

  // v9 shaping
  const expand = url.searchParams.get("expand");
  if (expand) req.expand = expand.split(",").map((s) => s.trim()).filter(Boolean);
  const elision = url.searchParams.get("elision");
  if (elision === "none") req.elision = "none";
  const focusThreshold = url.searchParams.get("focus_threshold");
  if (focusThreshold) req.focusThreshold = parseFloat(focusThreshold);
  const elideThreshold = url.searchParams.get("elide_threshold");
  if (elideThreshold) req.elideThreshold = parseFloat(elideThreshold);

  return req;
}

// ── Shaping ─────────────────────────────────────────────────────────────

const DEFAULT_FOCUS_THRESHOLD = 0.5;
const DEFAULT_ELIDE_THRESHOLD = 0.1;

/** Minimal _meta for peripheral/elided tier — strip trajectory/provenance */
function trimMeta(meta: any, elided: boolean, expandHint?: string): any {
  const trimmed: any = {
    score: meta.score,
    revision: meta.revision,
    updated_at: meta.updated_at,
    elided,
  };
  if (elided && expandHint) {
    trimmed.expand = expandHint;
  }
  return trimmed;
}

/** Check if a scope.key is in the expand list */
function isExpanded(scope: string, key: string, expandSet: Set<string>): boolean {
  return (
    expandSet.has(`${scope}.${key}`) ||
    expandSet.has(`${scope}.*`) ||
    expandSet.has("*")
  );
}

/**
 * Shape a scope's entries by salience threshold.
 *
 * Focus:      full value + full _meta
 * Peripheral: full value + trimmed _meta (score, revision, updated_at)
 * Elided:     value: null + trimmed _meta + expand hint
 */
function shapeScope(
  scope: string,
  entries: Record<string, WrappedEntry>,
  focusThreshold: number,
  elideThreshold: number,
  expandSet: Set<string>,
  noElision: boolean,
): Record<string, any> {
  const shaped: Record<string, any> = {};

  for (const [key, entry] of Object.entries(entries)) {
    const score = entry._meta?.score ?? 0;
    const forceExpand = isExpanded(scope, key, expandSet);

    if (forceExpand || noElision || score >= focusThreshold) {
      // Focus tier: full value + full _meta
      shaped[key] = entry;
    } else if (score >= elideThreshold) {
      // Peripheral tier: full value + trimmed _meta
      shaped[key] = {
        value: entry.value,
        _meta: trimMeta(entry._meta, false),
      };
    } else {
      // Elided tier: null value + minimal _meta + expand hint
      shaped[key] = {
        value: null,
        _meta: trimMeta(
          entry._meta,
          true,
          `?expand=${scope}.${key}`,
        ),
      };
    }
  }

  return shaped;
}

// ── buildExpandedContext ─────────────────────────────────────────────────

/**
 * Build the agent-facing context response.
 *
 * v9: Returns wrapped { value, _meta } entries shaped by salience threshold.
 * All metadata (salience, provenance, trajectory, contested) lives in _meta.
 * No synthetic views, no _context envelope.
 */
export async function buildExpandedContext(
  roomId: string,
  auth: AuthResult,
  req: ContextRequest = {},
): Promise<Record<string, any>> {
  const depth = req.depth ?? "lean";
  const includeActions = req.actions !== false;
  const includeMessages = req.messages !== false;
  const includedScopes = req.include ?? [];

  // Shaping params
  const focusThreshold = req.focusThreshold ?? DEFAULT_FOCUS_THRESHOLD;
  const elideThreshold = req.elideThreshold ?? DEFAULT_ELIDE_THRESHOLD;
  const noElision = req.elision === "none";
  const expandSet = new Set(req.expand ?? []);

  // ── Engine layer: full wrapped context ──
  const ctx = await buildContext(roomId, {
    selfAgent: auth.agentId ?? undefined,
    allScopes: hasFullReadAccess(auth),
  });

  // ── Shape state scopes ──
  const stateOut: Record<string, any> = {};
  for (const [scope, entries] of Object.entries(ctx.state as Record<string, Record<string, WrappedEntry>>)) {
    // Strip _audit and _messages unless opted in
    if (scope === "_audit" && !includedScopes.includes("_audit")) continue;
    if (scope === "_messages" && !includedScopes.includes("_messages")) continue;
    // Skip system internals
    if (scope === "_actions" || scope === "_views" || scope === "_agents" || scope === "_config" || scope === "_help") continue;

    stateOut[scope] = shapeScope(
      scope, entries, focusThreshold, elideThreshold, expandSet, noElision,
    );
  }

  // ── Shape agents ──
  const agentsOut: Record<string, any> = {};
  for (const [id, entry] of Object.entries(ctx.agents as Record<string, WrappedEntry>)) {
    // Agents are always focus tier (important for coordination)
    agentsOut[id] = entry;
  }

  // ── Shape views ──
  const viewsOut: Record<string, any> = {};
  for (const [id, entry] of Object.entries(ctx.views as Record<string, WrappedEntry>)) {
    const score = entry._meta?.score ?? 0;
    if (noElision || score >= elideThreshold || isExpanded("_views", id, expandSet)) {
      viewsOut[id] = score >= focusThreshold || noElision
        ? entry
        : { value: entry.value, _meta: trimMeta(entry._meta, false) };
    } else {
      viewsOut[id] = {
        value: null,
        _meta: trimMeta(entry._meta, true, `?expand=_views.${id}`),
      };
    }
  }

  // ── Actions ──
  let actionsOut: Record<string, any> | undefined;

  if (includeActions) {
    actionsOut = {};

    // Custom actions from engine context (already wrapped with action _meta)
    for (const [id, entry] of Object.entries(ctx.actions as Record<string, WrappedEntry>)) {
      const actionValue = entry.value;
      const actionMeta = entry._meta as any;

      const shaped: any = {
        value: {
          available: actionValue.available ?? true,
          description: null as string | null,
        },
        _meta: actionMeta,
      };

      // Load full definition for description and depth-dependent fields
      try {
        const defResult = await sqlite.execute({
          sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_actions' AND key = ?`,
          args: [roomId, id],
        });
        if (defResult.rows.length > 0) {
          const def = JSON.parse(defResult.rows[0][0] as string);
          shaped.value.description = def.description ?? null;

          if (depth === "full" || depth === "usage") {
            shaped.value.enabled = true;
            if (def.params) shaped.value.params = def.params;
            if (def.writes?.length > 0) shaped.value.writes = def.writes;
            if (def.if) shaped.value.if = def.if;
            if (def.scope && def.scope !== "_shared") shaped.value.scope = def.scope;
          }
        }
      } catch {}

      actionsOut[id] = shaped;
    }

    // Built-in actions (not in _actions scope — synthesize wrapped entries)
    for (const [id, def] of Object.entries(BUILTIN_ACTIONS)) {
      if (OVERRIDABLE_BUILTINS.has(id) && actionsOut[id]) continue;

      const builtinValue: any = {
        available: true,
        builtin: true,
        description: def.description,
      };
      if (depth === "full" || depth === "usage") {
        builtinValue.enabled = true;
        builtinValue.params = def.params ?? null;
      }

      actionsOut[id] = {
        value: builtinValue,
        _meta: {
          ...minimalMeta(0, "", 0),
          // Builtins have no audit trail — minimal meta
          invocations: 0,
          last_invoked_at: null,
          last_invoked_by: null,
          contested: [],
        },
      };
    }
  }

  // ── Messages ──
  let messagesOut: any;
  let sectionElided: string[] = [];

  if (includeMessages) {
    const messagesLimit = Math.min(req.messagesLimit ?? 100, 500);
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
      try {
        parsed = JSON.parse(r.value);
      } catch {
        parsed = { body: r.value };
      }
      return { seq: r.sort_key, ...parsed };
    });

    // Update last_seen_seq
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

    // Count total for elision detection
    const totalMsgResult = await sqlite.execute({
      sql: `SELECT COUNT(*) as cnt FROM state WHERE room_id = ? AND scope = '_messages'`,
      args: [roomId],
    });
    const totalMessages = Number(rows2objects(totalMsgResult)[0]?.cnt ?? 0);
    const oldestSeq = recentMessages.length > 0 ? (recentMessages[0].seq ?? 0) : 0;

    messagesOut = {
      count: ctx.messages.count,
      unread: ctx.messages.unread,
      directed_unread: ctx.messages.directed_unread,
      recent: recentMessages,
    };

    if (totalMessages > messagesLimit) {
      messagesOut._meta = {
        total: totalMessages,
        returned: recentMessages.length,
        elided: true,
        expand: `?messages_after=0&messages_limit=${Math.min(totalMessages, 500)}`,
      };
    }
  } else {
    sectionElided.push("messages");
  }

  if (!includeActions) {
    sectionElided.push("actions");
  }

  // ── Assemble response ──
  let result: Record<string, any> = {
    state: stateOut,
    views: viewsOut,
    agents: agentsOut,
    ...(actionsOut !== undefined ? { actions: actionsOut } : {}),
    ...(messagesOut !== undefined ? { messages: messagesOut } : {}),
    self: ctx.self,
  };

  // ── Apply `only` filter ──
  if (req.only && req.only.length > 0) {
    const filtered: Record<string, any> = {};
    for (const s of req.only) {
      if (s in result) filtered[s] = result[s];
      if (s.startsWith("state.")) {
        const scope = s.slice(6);
        if (!filtered.state) filtered.state = {};
        if (ctx.state[scope]) {
          filtered.state[scope] = shapeScope(
            scope, ctx.state[scope], focusThreshold, elideThreshold, expandSet, noElision,
          );
        }
      }
    }
    if (result.self) filtered.self = result.self;
    for (const key of Object.keys(result)) {
      if (!(key in filtered) && key !== "self") sectionElided.push(key);
    }
    result = filtered;
  }

  // ── Shaping summary ──
  // Minimal envelope — just enough for the agent to understand what it got
  const shapingSummary: any = {
    focus_threshold: focusThreshold,
    elide_threshold: elideThreshold,
    elision: noElision ? "none" : "auto",
  };

  // Count shaped entries
  let focusCount = 0;
  let peripheralCount = 0;
  let elidedCount = 0;
  for (const scope of Object.values(stateOut)) {
    for (const entry of Object.values(scope as Record<string, any>)) {
      const e = entry as any;
      if (e?._meta?.elided) elidedCount++;
      else if (e?._meta?.score !== undefined && !e?._meta?.writers) peripheralCount++;
      else focusCount++;
    }
  }
  shapingSummary.state_entries = {
    focus: focusCount,
    peripheral: peripheralCount,
    elided: elidedCount,
    total: focusCount + peripheralCount + elidedCount,
  };

  if (sectionElided.length > 0) {
    shapingSummary.sections_elided = sectionElided;
  }

  result._shaping = shapingSummary;

  return result;
}

// ── CEL eval endpoint ───────────────────────────────────────────────────

export async function evalExpression(
  roomId: string,
  body: any,
  auth: AuthResult,
) {
  const expr = body.expr;
  if (!expr || typeof expr !== "string") {
    return json({ error: "expr string is required" }, 400);
  }
  touchAgent(roomId, auth.agentId);
  const ctx = await buildContext(roomId, {
    selfAgent: auth.agentId ?? undefined,
  });
  const result = await evalCel(roomId, expr, ctx);
  if (!result.ok) {
    return json(
      { error: "cel_error", expression: expr, detail: result.error },
      400,
    );
  }
  return json({ expression: expr, value: result.value });
}
