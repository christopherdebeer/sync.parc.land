/**
 * cel.ts — CEL (Common Expression Language) evaluator for sync v9.
 *
 * v9: Wrapped state model + Environment API.
 *
 * Every entry in the CEL context is { value, _meta: { ... } }.
 * The Environment registers domain helpers and receiver methods
 * so expressions can query the wrapped shape ergonomically:
 *
 *   state._shared.phase.value == "executing"          // value access
 *   state._shared.phase._meta.writer == "explorer"    // meta access
 *   salient(state._shared, 0.5)                       // domain helper
 *   state._shared.keys().filter(k, ...)               // receiver method
 *   written_by(state._shared, self)                   // provenance query
 *
 * Three layers:
 *   Storage:    raw values in SQLite
 *   Engine:     buildContext wraps every entry with full _meta (this module)
 *   Projection: buildExpandedContext shapes _meta by salience threshold (context.ts)
 *
 * Validation pipeline (validateExpression):
 *   1. Parse   — syntax check with source-pointed error
 *   2. Check   — type-level validation via Environment.check()
 *   3. Lint    — static detection of old-style (v8) expressions
 *   4. Eval    — trial evaluation against room state (optional)
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import {
  Environment,
  evaluate as bareEvaluate,
  parse,
  ParseError,
  EvaluationError,
} from "npm:@marcbachmann/cel-js";
import { isTimerLive } from "./timers.ts";
import {
  computeRoomMeta,
  computeScore,
  loadAgentContext,
  wrapEntry,
  minimalMeta,
  type AgentContext,
  type RoomMeta,
  type WrappedEntry,
  type EntryMeta,
} from "./meta.ts";

// Re-export for consumers
export type { WrappedEntry, EntryMeta };

// ── Singleton Environment ──────────────────────────────────────────────
//
// Created once per process. Registers all domain helpers and receiver
// methods. Used for all CEL evaluation and validation.

let _env: Environment | null = null;

export function getCelEnvironment(): Environment {
  if (_env) return _env;

  const env = new Environment({
    unlistedVariablesAreDyn: true,
    homogeneousAggregateLiterals: false,
    enableOptionalTypes: true,
  });

  // ── Receiver methods (map → list conversions) ──────────────────────
  // The built-in map.keys() and map.entries() don't resolve through dyn
  // at eval time, so we register explicit receiver methods that work
  // regardless of how the map is accessed in the expression.

  env.registerFunction({
    name: "keys",
    receiverType: "map",
    returnType: "list",
    handler: (m: any) => Object.keys(m),
    params: [],
    description: "Get all keys from a map as a list",
  });

  env.registerFunction({
    name: "entries",
    receiverType: "map",
    returnType: "list",
    handler: (m: any) =>
      Object.entries(m).map(([k, v]) => ({ key: k, entry: v })),
    params: [],
    description: "Get all entries from a map as a list of { key, entry }",
  });

  env.registerFunction({
    name: "values",
    receiverType: "map",
    returnType: "list",
    handler: (m: any) => Object.values(m),
    params: [],
    description: "Get all values from a map as a list",
  });

  // ── Domain helpers: scope queries ──────────────────────────────────

  env.registerFunction({
    signature: "salient(map, double): list",
    handler: (scope: any, threshold: number) =>
      Object.keys(scope).filter(
        (k) => (scope[k]?._meta?.score ?? 0) > threshold,
      ),
    description:
      "Keys in scope with salience score above threshold",
  });

  env.registerFunction({
    signature: "elided(map): list",
    handler: (scope: any) =>
      Object.keys(scope).filter((k) => scope[k]?._meta?.elided === true),
    description: "Keys in scope that are elided (value is null)",
  });

  env.registerFunction({
    signature: "active(map): list",
    handler: (scope: any) =>
      Object.keys(scope).filter((k) => !scope[k]?._meta?.elided),
    description: "Keys in scope that are not elided",
  });

  env.registerFunction({
    signature: "written_by(map, string): list",
    handler: (scope: any, agent: string) =>
      Object.keys(scope).filter((k) => scope[k]?._meta?.writer === agent),
    description: "Keys in scope last written by a specific agent",
  });

  env.registerFunction({
    signature: "velocity_above(map, double): list",
    handler: (scope: any, threshold: number) =>
      Object.keys(scope).filter(
        (k) => (scope[k]?._meta?.velocity ?? 0) > threshold,
      ),
    description: "Keys in scope with write velocity above threshold",
  });

  env.registerFunction({
    signature: "top_n(map, int): list",
    handler: (scope: any, n: bigint) =>
      Object.entries(scope)
        .map(([k, v]: [string, any]) => ({
          key: k,
          score: v?._meta?.score ?? 0,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, Number(n))
        .map((e) => e.key),
    description:
      "Top N keys in scope by salience score",
  });

  env.registerFunction({
    signature: "focus(map): list",
    handler: (scope: any) =>
      Object.entries(scope)
        .filter(
          ([_, v]: [string, any]) =>
            !v?._meta?.elided && (v?._meta?.score ?? 0) > 0.5,
        )
        .map(([k]) => k),
    description: "Keys in focus tier (high score, not elided)",
  });

  env.registerFunction({
    signature: "peripheral(map): list",
    handler: (scope: any) =>
      Object.entries(scope)
        .filter(([_, v]: [string, any]) => {
          const s = v?._meta?.score ?? 0;
          return !v?._meta?.elided && s > 0.1 && s <= 0.5;
        })
        .map(([k]) => k),
    description:
      "Keys in peripheral tier (medium score, not elided)",
  });

  // ── Domain helpers: action queries ─────────────────────────────────

  env.registerFunction({
    signature: "contested(map): list",
    handler: (actions: any) =>
      Object.keys(actions).filter((k) => {
        const c = actions[k]?._meta?.contested;
        return Array.isArray(c) && c.length > 0;
      }),
    description: "Action IDs that have contested write targets",
  });

  env.registerFunction({
    signature: "stale(map, int): list",
    handler: (actions: any, threshold: bigint) =>
      Object.keys(actions).filter(
        (k) => (actions[k]?._meta?.invocations ?? 0) < Number(threshold),
      ),
    description: "Action IDs with fewer than N invocations",
  });

  // ── Convenience shorthands ─────────────────────────────────────────

  env.registerFunction({
    signature: "val(dyn): dyn",
    handler: (entry: any) => {
      if (entry && typeof entry === "object" && "value" in entry) {
        return entry.value;
      }
      return entry;
    },
    description: "Shorthand: extract .value from a wrapped entry",
  });

  env.registerFunction({
    signature: "meta(dyn, string): dyn",
    handler: (entry: any, field: string) => {
      if (entry && typeof entry === "object" && "_meta" in entry) {
        return entry._meta[field] ?? null;
      }
      return null;
    },
    description: "Shorthand: extract a _meta field from a wrapped entry",
  });

  _env = env;
  return env;
}

// ── CEL evaluation (replaces bare evaluate()) ──────────────────────────

/**
 * Evaluate a CEL expression using the sync Environment.
 * All domain helpers and receiver methods are available.
 */
export function celEval(expr: string, ctx: Record<string, any>): any {
  const env = getCelEnvironment();
  return env.evaluate(expr, ctx);
}

// ── Validation ─────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  stage: "parse" | "check" | "lint" | "eval" | "ok";
  error?: string;
  /** Source pointer for parse/eval errors (if available) */
  source?: string;
  /** Actionable hint for fixing the issue */
  hint?: string;
  /** Help key — invoke help({ key }) for detailed guidance */
  help?: string;
  /** Inferred return type (if validation succeeded) */
  type?: string;
  /** Lint warnings (expressions that parse but may be incorrect) */
  warnings?: string[];
}

/**
 * Detect old-style (v8) CEL patterns that silently produce wrong results
 * under the v9 wrapped shape.
 *
 * These expressions parse and evaluate without error, but compare
 * { value, _meta } objects to primitives (always false) or access
 * fields directly on the wrapped entry instead of on .value.
 */
function lintExpression(expr: string): string[] {
  const warnings: string[] = [];

  // Pattern: state.scope.key == "literal" (without .value)
  // Compares { value, _meta } to a primitive → always false
  const bareCompare =
    /state\.(\w+)\.(\w+)\s*(==|!=|>=|<=|>|<)\s*(".*?"|'.*?'|\d+(?:\.\d+)?|true|false|null)/g;
  let m;
  while ((m = bareCompare.exec(expr))) {
    const fullPath = `state.${m[1]}.${m[2]}`;
    if (
      !fullPath.endsWith(".value") && !fullPath.includes("._meta")
    ) {
      const parts = fullPath.split(".");
      if (parts.length === 3) {
        warnings.push(
          `"${fullPath}" compares a wrapped entry to a primitive. ` +
            `Use "${fullPath}.value" instead. See help({ key: "wrapped_entries" }).`,
        );
      }
    }
  }

  // Pattern: state.scope["key"].field where field isn't value or _meta
  const bracketField =
    /state\.\w+\["[^"]+"\]\.([a-z]\w+)/g;
  while ((m = bracketField.exec(expr))) {
    const field = m[1];
    if (field !== "value" && field !== "_meta" && !field.startsWith("_")) {
      warnings.push(
        `".${field}" accesses the wrapped entry directly. ` +
          `Use ".value.${field}" instead. See help({ key: "wrapped_entries" }).`,
      );
    }
  }

  // Pattern: state.scope.key.field where field isn't value/_meta
  // but only at the 4th dot level (state.scope.key.field)
  const dotField =
    /state\.(\w+)\.(\w+)\.([a-z]\w+)/g;
  while ((m = dotField.exec(expr))) {
    const field = m[3];
    if (
      field !== "value" && field !== "_meta" && !field.startsWith("_")
    ) {
      // Avoid false positives: state._shared.phase.value.something is fine
      // We only flag state._shared.key.field (not state._shared.key.value.field)
      const preceding = `state.${m[1]}.${m[2]}`;
      // Check that the preceding token isn't ".value"
      const fullMatch = m[0];
      if (!fullMatch.includes(".value.")) {
        warnings.push(
          `".${field}" on "${preceding}" accesses the wrapped entry directly. ` +
            `Use "${preceding}.value.${field}" instead.`,
        );
      }
    }
  }

  // Deduplicate
  return [...new Set(warnings)];
}

/**
 * Validate a CEL expression through a multi-stage pipeline.
 *
 * Stages:
 *   1. parse  — syntax check (catches missing operators, bad tokens, etc.)
 *   2. check  — type-level validation via Environment.check()
 *   3. lint   — static detection of v8-style patterns (silent wrong results)
 *   4. eval   — trial evaluation against provided context (optional)
 *
 * Returns structured feedback with error location, hint, and warnings.
 */
export function validateExpression(
  expr: string,
  trialCtx?: Record<string, any>,
): ValidationResult {
  if (!expr || typeof expr !== "string" || expr.trim() === "") {
    return {
      valid: false,
      stage: "parse",
      error: "Expression is empty",
      hint: "Provide a CEL expression.",
    };
  }

  // ── Stage 1: Parse ──
  try {
    parse(expr);
  } catch (e: any) {
    const msg = e.message || String(e);
    // Extract source pointer if present (lines after the first)
    const lines = msg.split("\n");
    const source = lines.length > 1 ? lines.slice(1).join("\n") : undefined;

    return {
      valid: false,
      stage: "parse",
      error: lines[0],
      source,
      hint: e instanceof ParseError
        ? "Syntax error. Check: balanced parentheses, valid operators (== not ===), proper string quotes."
        : "Expression could not be parsed.",
      help: "expressions",
    };
  }

  // ── Stage 2: Check ──
  // With unlistedVariablesAreDyn, all state access resolves to `dyn` which
  // means the checker can't validate receiver methods (.keys(), .entries())
  // or deep property access. We treat check failures as soft warnings
  // rather than hard errors — the real validation happens at eval time.
  try {
    const env = getCelEnvironment();
    const checkResult = env.check(expr);
    if (!checkResult.valid) {
      const msg = checkResult.error?.message ?? "Type check failed";
      // dyn-related failures are soft (receiver methods, overloads on dyn)
      const isDynIssue = msg.includes("dyn") || msg.includes("no matching overload");
      if (!isDynIssue) {
        const lines = msg.split("\n");
        return {
          valid: false,
          stage: "check",
          error: lines[0],
          source: lines.length > 1 ? lines.slice(1).join("\n") : undefined,
          hint:
            "Type error. Check that variable types match operators. Use .value for entry values and ._meta for metadata.",
          help: "expressions",
        };
      }
      // dyn type limitation — soft pass, not a real error
    }
  } catch {
    // check() can throw for complex dyn expressions — soft pass
  }

  // ── Stage 3: Lint ──
  const warnings = lintExpression(expr);

  // ── Stage 4: Trial eval (optional) ──
  if (trialCtx) {
    try {
      const env = getCelEnvironment();
      const result = env.evaluate(expr, trialCtx);
      const type = result === null
        ? "null"
        : typeof result === "bigint"
        ? "int"
        : Array.isArray(result)
        ? "list"
        : typeof result === "object"
        ? "map"
        : typeof result;

      return {
        valid: true,
        stage: "ok",
        type,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    } catch (e: any) {
      const msg = e.message || String(e);
      const lines = msg.split("\n");

      let hint: string;
      let help = "expressions";
      if (msg.includes("No such key")) {
        const keyMatch = msg.match(/No such key: (\S+)/);
        const missingKey = keyMatch?.[1] ?? "";
        if (missingKey === "value" || missingKey === "_meta") {
          hint =
            `Key "${missingKey}" not found. Only the top-level entry has .value and ._meta — ` +
            `you may be inside .value already.`;
          help = "wrapped_entries";
        } else if (missingKey === "meta") {
          hint = `Did you mean "._meta"? Meta fields use an underscore prefix.`;
          help = "wrapped_entries";
        } else {
          hint =
            `Key "${missingKey}" not found. Check the key exists, or guard with has().`;
        }
      } else if (msg.includes("no such overload")) {
        hint =
          "Type mismatch. Wrapped entries are maps — use .value for comparisons.";
        help = "wrapped_entries";
      } else if (msg.includes("no matching overload")) {
        hint =
          "Function or method not available for this type. See help({ key: \"functions\" }) for available helpers.";
        help = "functions";
      } else {
        hint =
          "Expression failed at runtime. Check that referenced keys exist.";
      }

      return {
        valid: false,
        stage: "eval",
        error: lines[0],
        source: lines.length > 1 ? lines.slice(1).join("\n") : undefined,
        hint,
        help,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    }
  }

  // No trial context — return parse+check+lint result
  return {
    valid: true,
    stage: "ok",
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * Legacy-compatible validateCel — wraps validateExpression.
 * Used by actions.ts, views.ts for backward-compatible validation.
 */
export function validateCel(
  expr: string,
): { valid: true; warnings?: string[] } | { valid: false; error: string; hint?: string; warnings?: string[] } {
  const result = validateExpression(expr);
  if (result.valid) {
    return { valid: true, ...(result.warnings?.length ? { warnings: result.warnings } : {}) };
  }
  // "No such key" at eval stage is acceptable — the key may not exist yet
  if (result.stage === "eval" && result.error?.includes("No such key")) {
    return { valid: true, ...(result.warnings?.length ? { warnings: result.warnings } : {}) };
  }
  return {
    valid: false,
    error: result.error ?? "validation failed",
    hint: result.hint,
    ...(result.warnings?.length ? { warnings: result.warnings } : {}),
  };
}

// ── Internal helpers ───────────────────────────────────────────────────

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

// ── buildContext ────────────────────────────────────────────────────────

export interface BuildContextOptions {
  /** The requesting agent's ID. Used for `self`, scope privacy, and salience scoring. */
  selfAgent?: string;
  /** Additional scopes to include (for view/action evaluation with registrar authority). */
  includeScopes?: string[];
  /** If true, include ALL scopes (for internal/admin use). */
  allScopes?: boolean;
}

/**
 * Build the CEL evaluation context from room data.
 *
 * v9: Every entry is wrapped as { value, _meta: { ... } }.
 * All evaluation uses the Environment (celEval) for domain helpers.
 */
export async function buildContext(
  roomId: string,
  opts: BuildContextOptions = {},
): Promise<Record<string, any>> {
  const { selfAgent, includeScopes = [], allScopes = false } = opts;

  const stateResult = await sqlite.execute({
    sql: `SELECT scope, key, sort_key, value, revision, updated_at,
                 timer_effect, timer_expires_at, timer_ticks_left, enabled_expr
          FROM state WHERE room_id = ?`,
    args: [roomId],
  });
  const stateRows = rows2objects(stateResult) as any[];

  const roomMeta = await computeRoomMeta(roomId);

  let agentCtx: AgentContext | null = null;
  if (selfAgent) {
    agentCtx = await loadAgentContext(roomId, selfAgent, stateRows);
  }

  // ── Build wrapped state tree ──
  const state: Record<string, Record<string, WrappedEntry>> = {};
  const deferredEnabled: {
    scope: string;
    key: string;
    value: any;
    revision: number;
    updatedAt: string;
    enabled_expr: string;
  }[] = [];

  for (const row of stateRows) {
    if (!isTimerLive(row)) continue;

    const scope = row.scope as string;
    const isShared = scope === "_shared";
    const isSelf = selfAgent && scope === selfAgent;
    const isExplicitlyIncluded = includeScopes.includes(scope);
    const isSystemScope = scope.startsWith("_");

    if (
      !allScopes && !isShared && !isSelf && !isExplicitlyIncluded &&
      !isSystemScope
    ) {
      continue;
    }

    if (row.enabled_expr) {
      deferredEnabled.push({
        scope,
        key: row.key,
        value: parseValue(row.value),
        revision: row.revision ?? 0,
        updatedAt: row.updated_at ?? "",
        enabled_expr: row.enabled_expr,
      });
      continue;
    }

    const contextScope = (isSelf && !allScopes) ? "self" : scope;
    if (!state[contextScope]) state[contextScope] = {};

    const value = parseValue(row.value);
    const score = computeScore(
      scope, row.key, row.updated_at, value, agentCtx, roomMeta,
    );

    state[contextScope][row.key] = wrapEntry(
      value, scope, row.key, row.revision ?? 0, row.updated_at ?? "",
      roomMeta, score,
    );
  }

  // ── Agents (wrapped) ──
  const agents: Record<string, WrappedEntry> = {};
  for (const row of stateRows) {
    if (row.scope !== "_agents") continue;
    if (!isTimerLive(row)) continue;
    const val = parseValue(row.value);
    const agentData = {
      name: val.name ?? row.key,
      role: val.role ?? "agent",
      status: val.status ?? "active",
      waiting_on: val.waiting_on ?? null,
      last_heartbeat: val.last_heartbeat ?? null,
    };
    const score = computeScore(
      "_agents", row.key, row.updated_at, val, agentCtx, roomMeta,
    );
    agents[row.key] = wrapEntry(
      agentData, "_agents", row.key, row.revision ?? 0,
      row.updated_at ?? "", roomMeta, score,
    );
  }

  // ── Message counts ──
  const countResult = await sqlite.execute({
    sql: `SELECT COUNT(*) as total FROM state WHERE room_id = ? AND scope = '_messages'
          AND (timer_effect IS NULL
               OR (timer_effect = 'delete' AND (timer_expires_at IS NULL OR timer_expires_at > datetime('now'))
                   AND (timer_ticks_left IS NULL OR timer_ticks_left > 0))
               OR (timer_effect = 'enable' AND ((timer_expires_at IS NOT NULL AND timer_expires_at <= datetime('now'))
                   OR (timer_ticks_left IS NOT NULL AND timer_ticks_left <= 0))))`,
    args: [roomId],
  });
  const totalCount = Number(
    (rows2objects(countResult)[0] as any)?.total || 0,
  );

  let unreadCount = 0;
  let directedUnread = 0;
  if (selfAgent) {
    let lastSeen = 0;
    try {
      const agentEntry = stateRows.find(
        (r: any) => r.scope === "_agents" && r.key === selfAgent,
      );
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

    const directedResult = await sqlite.execute({
      sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_messages' AND sort_key > ?`,
      args: [roomId, lastSeen],
    });
    for (const row of rows2objects(directedResult)) {
      try {
        const msg = JSON.parse((row as any).value);
        if (Array.isArray(msg.to) && msg.to.includes(selfAgent)) {
          directedUnread++;
        }
      } catch {}
    }
  }

  // ── Actions (wrapped with action meta) ──
  const actionsCtx: Record<string, WrappedEntry> = {};
  for (const row of stateRows) {
    if (row.scope !== "_actions") continue;
    if (!isTimerLive(row)) continue;
    const val = parseValue(row.value);

    if (val.enabled) {
      try {
        const checkCtx = {
          state, views: {}, agents,
          messages: { count: 0, unread: 0, directed_unread: 0 },
          actions: {}, self: selfAgent ?? "", params: {},
        };
        if (!celEval(val.enabled, checkCtx)) continue;
      } catch { continue; }
    }

    const actionData = { enabled: true, if_expr: val.if ?? null };
    const score = computeScore(
      "_actions", row.key, row.updated_at, val, agentCtx, roomMeta,
    );
    actionsCtx[row.key] = wrapEntry(
      actionData, "_actions", row.key, row.revision ?? 0,
      row.updated_at ?? "", roomMeta, score,
    );
  }

  // ── Assemble context ──
  const ctx: Record<string, any> = {
    state,
    views: {} as Record<string, WrappedEntry>,
    agents,
    messages: {
      count: totalCount,
      unread: unreadCount,
      directed_unread: directedUnread,
    },
    actions: actionsCtx,
    self: selfAgent ?? "",
    params: {},
  };

  // ── Deferred enabled entries ──
  for (const d of deferredEnabled) {
    try {
      if (celEval(d.enabled_expr, ctx)) {
        const contextScope =
          selfAgent && d.scope === selfAgent && !allScopes
            ? "self"
            : d.scope;
        if (!state[contextScope]) state[contextScope] = {};
        const score = computeScore(
          d.scope, d.key, d.updatedAt, d.value, agentCtx, roomMeta,
        );
        state[contextScope][d.key] = wrapEntry(
          d.value, d.scope, d.key, d.revision, d.updatedAt, roomMeta, score,
        );
      }
    } catch {}
  }

  // ── Views (wrapped) ──
  const viewEntries = stateRows.filter(
    (r: any) => r.scope === "_views" && isTimerLive(r),
  );
  const views = ctx.views as Record<string, WrappedEntry>;

  for (const row of viewEntries) {
    const val = parseValue(row.value);
    if (!val.expr) continue;

    if (val.enabled) {
      try {
        if (!celEval(val.enabled, ctx)) continue;
      } catch { continue; }
    }

    const viewCtx = await buildViewContext(
      roomId, val.scope ?? "_shared", ctx, roomMeta, agentCtx,
    );

    try {
      const result = celEval(val.expr, viewCtx);
      const viewValue = typeof result === "bigint" ? Number(result) : result;

      const score = computeScore(
        "_views", row.key, row.updated_at, viewValue, agentCtx, roomMeta,
      );
      views[row.key] = {
        value: viewValue,
        _meta: {
          ...minimalMeta(row.revision ?? 0, row.updated_at ?? "", score),
          writer: val.registered_by ?? null,
          via: null,
          seq: null,
        },
      };
    } catch (e: any) {
      views[row.key] = {
        value: { _error: e.message },
        _meta: minimalMeta(row.revision ?? 0, row.updated_at ?? "", 0),
      };
    }
  }

  // ── Action availability (post-view resolution) ──
  for (const [_id, entry] of Object.entries(actionsCtx)) {
    const ifExpr = entry.value.if_expr;
    if (ifExpr) {
      try {
        entry.value.available = !!celEval(ifExpr, ctx);
      } catch {
        entry.value.available = false;
      }
    } else {
      entry.value.available = true;
    }
    delete entry.value.if_expr;
  }

  return ctx;
}

/**
 * Build a context for view evaluation that includes the registrar's private scope.
 */
export async function buildViewContext(
  roomId: string,
  registrarScope: string,
  baseCtx: Record<string, any>,
  roomMeta?: RoomMeta,
  agentCtx?: AgentContext | null,
): Promise<Record<string, any>> {
  if (registrarScope === "_shared" || baseCtx.state[registrarScope]) {
    return baseCtx;
  }

  const scopeResult = await sqlite.execute({
    sql: `SELECT key, value, revision, updated_at,
                 timer_effect, timer_expires_at, timer_ticks_left, enabled_expr
          FROM state WHERE room_id = ? AND scope = ?`,
    args: [roomId, registrarScope],
  });
  const rows = rows2objects(scopeResult) as any[];

  const scopeData: Record<string, WrappedEntry> = {};
  for (const row of rows) {
    if (!isTimerLive(row)) continue;
    if (row.enabled_expr) {
      try {
        if (!celEval(row.enabled_expr, baseCtx)) continue;
      } catch { continue; }
    }
    const value = parseValue(row.value);
    const score = roomMeta
      ? computeScore(
        registrarScope, row.key, row.updated_at, value,
        agentCtx ?? null, roomMeta,
      )
      : 0;
    scopeData[row.key] = roomMeta
      ? wrapEntry(
        value, registrarScope, row.key, row.revision ?? 0,
        row.updated_at ?? "", roomMeta, score,
      )
      : { value, _meta: minimalMeta(row.revision ?? 0, row.updated_at ?? "") };
  }

  return {
    ...baseCtx,
    state: { ...baseCtx.state, [registrarScope]: scopeData },
  };
}

// ── Public evaluation API ──────────────────────────────────────────────

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
    const result = celEval(expr, context);
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
    const result = celEval(expr, extendedCtx);
    const value = typeof result === "bigint" ? Number(result) : result;
    return { ok: true, value };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}
