/**
 * poll-v8.ts — State-only dashboard poll. Clean break from legacy tables.
 *
 * One data source: the state table. Actions, views, agents, messages
 * are all state with scope prefixes. The frontend interprets scopes,
 * not separate data structures.
 *
 * Returns:
 *   state      — all state rows (every scope except _audit)
 *   resolved   — server-evaluated view values (CEL runs here, not in browser)
 *   available  — server-evaluated action predicates
 *   audit      — audit trail entries
 *   salience   — agent-specific relevance scores (if agent-authenticated)
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { evaluate } from "npm:@marcbachmann/cel-js";
import { json, rows2objects } from "./utils.ts";
import { buildContext, buildViewContext } from "./cel.ts";
import { isTimerLive } from "./timers.ts";
import { hasFullReadAccess, touchAgent, type AuthResult } from "./auth.ts";
import { computeContestedTargets } from "./actions.ts";
import { maybeSampleViews } from "./sampling.ts";
import { computeSalience } from "./salience.ts";

export async function dashboardPollV8(roomId: string, url: URL, auth: AuthResult) {
  const auditLimit = Math.min(parseInt(url.searchParams.get("audit_limit") ?? "500"), 2000);

  // ── Single state query: everything except _audit ──
  let stateSql = `SELECT scope, key, sort_key, value, revision, updated_at
                  FROM state WHERE room_id = ? AND scope != '_audit'`;
  const stateArgs: any[] = [roomId];

  // Scope privacy
  if (!hasFullReadAccess(auth)) {
    if (auth.authenticated && auth.kind === "agent") {
      const accessible = [auth.agentId!, ...auth.grants].filter(Boolean);
      const conditions = [`scope LIKE '\\_%' ESCAPE '\\'`]; // all system scopes
      for (const s of accessible) { conditions.push(`scope = ?`); stateArgs.push(s); }
      stateSql += ` AND (${conditions.join(" OR ")})`;
    } else {
      stateSql += ` AND scope LIKE '\\_%' ESCAPE '\\'`; // system scopes only
    }
  }

  stateSql += ` ORDER BY CASE WHEN sort_key IS NOT NULL THEN sort_key ELSE 0 END ASC`;

  const [stateResult, auditResult] = await Promise.all([
    sqlite.execute({ sql: stateSql, args: stateArgs }),
    sqlite.execute({
      sql: `SELECT sort_key, value, updated_at FROM state
            WHERE room_id = ? AND scope = '_audit'
            ORDER BY sort_key ASC LIMIT ?`,
      args: [roomId, auditLimit],
    }),
  ]);

  // ── Process state rows ──
  const rawRows = rows2objects(stateResult);
  const stateRows: any[] = [];

  for (const row of rawRows) {
    if (!isTimerLive(row)) continue;
    let value: any = row.value;
    try { value = JSON.parse(row.value); } catch {}
    stateRows.push({
      scope: row.scope,
      key: row.key,
      sort_key: row.sort_key ?? null,
      value,
      revision: row.revision,
      updated_at: row.updated_at,
    });
  }

  // ── Build CEL context for evaluation ──
  const ctx = await buildContext(roomId, {
    selfAgent: auth.agentId ?? undefined,
    allScopes: hasFullReadAccess(auth),
  });

  // ── Resolve view values from _views scope ──
  const resolved: Record<string, any> = {};
  const viewDefs = stateRows.filter(r => r.scope === "_views");

  for (const v of viewDefs) {
    const def = v.value;
    if (!def?.expr) continue;

    // Check enabled
    if (def.enabled) {
      try { if (!evaluate(def.enabled, ctx)) continue; } catch { continue; }
    }

    // Evaluate
    const viewCtx = await buildViewContext(roomId, def.scope ?? "_shared", ctx);
    try {
      const result = evaluate(def.expr, viewCtx);
      resolved[v.key] = typeof result === "bigint" ? Number(result) : result;
    } catch (e: any) {
      resolved[v.key] = { _error: e.message };
    }
  }

  // ── Evaluate action availability from _actions scope ──
  const available: Record<string, boolean> = {};
  const actionDefs = stateRows.filter(r => r.scope === "_actions");

  for (const a of actionDefs) {
    const def = a.value;
    // Check enabled
    if (def?.enabled) {
      try { if (!evaluate(def.enabled, ctx)) continue; } catch { continue; }
    }
    // Check if precondition
    if (def?.if) {
      try { available[a.key] = !!evaluate(def.if, ctx); } catch { available[a.key] = false; }
    } else {
      available[a.key] = true;
    }
  }

  // ── Process audit ──
  const auditRows = rows2objects(auditResult).map((row: any) => {
    let value: any = row.value;
    try { value = JSON.parse(row.value); } catch {}
    return { seq: row.sort_key, value, updated_at: row.updated_at };
  });

  // ── Sampling (fire-and-forget) ──
  const viewsForSampling = viewDefs
    .filter(v => v.value?.render?.temporal === true && resolved[v.key] !== undefined)
    .map(v => ({ id: v.key, value: resolved[v.key], render: v.value?.render }));
  maybeSampleViews(roomId, viewsForSampling).catch(() => {});

  // ── Salience (agent-authenticated only) ──
  let salience: any[] | undefined;
  if (auth.authenticated && auth.agentId) {
    touchAgent(roomId, auth.agentId);
    try {
      const contestedTargets = await computeContestedTargets(roomId);
      const map = await computeSalience(roomId, auth.agentId, {
        contestedTargets,
        limit: 20,
      });
      salience = map.entries.map(e => ({
        key: `${e.scope}.${e.key}`,
        score: Math.round(e.score * 100) / 100,
        signals: Object.entries(e.signals)
          .filter(([_, v]) => v > 0.05)
          .sort((a, b) => b[1] - a[1])
          .map(([k]) => k),
      }));
    } catch {}
  }

  return json({
    state: stateRows,
    resolved,
    available,
    audit: auditRows,
    ...(salience ? { salience } : {}),
  });
}
