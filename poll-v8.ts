/**
 * poll.ts — Dashboard poll endpoint (v9).
 *
 * Single data source: the state table. Returns state rows with _meta
 * (writer, score, velocity), resolved view values, action availability,
 * audit trail, and salience map.
 *
 * v9: Every state row includes _meta from meta.ts.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { json, rows2objects } from "./utils.ts";
import { buildContext, buildViewContext, celEval } from "./cel.ts";
import { isTimerLive } from "./timers.ts";
import { hasFullReadAccess, touchAgent, type AuthResult } from "./auth.ts";
import { computeContestedTargets } from "./actions.ts";
import { maybeSampleViews } from "./sampling.ts";
import { computeRoomMeta, computeScore, wrapEntry, loadAgentContext, type RoomMeta } from "./meta.ts";

export async function dashboardPoll(roomId: string, url: URL, auth: AuthResult) {
  const auditLimit = Math.min(parseInt(url.searchParams.get("audit_limit") ?? "500"), 2000);

  // ── Single state query: everything except _audit ──
  let stateSql = `SELECT scope, key, sort_key, value, revision, updated_at
                  FROM state WHERE room_id = ? AND scope != '_audit'`;
  const stateArgs: any[] = [roomId];

  // Scope privacy
  if (!hasFullReadAccess(auth)) {
    if (auth.authenticated && auth.kind === "agent") {
      const accessible = [auth.agentId!, ...auth.grants].filter(Boolean);
      const conditions = [`scope LIKE '\\_%' ESCAPE '\\'`];
      for (const s of accessible) { conditions.push(`scope = ?`); stateArgs.push(s); }
      stateSql += ` AND (${conditions.join(" OR ")})`;
    } else {
      stateSql += ` AND scope LIKE '\\_%' ESCAPE '\\'`;
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

  // ── Compute room meta for _meta enrichment ──
  let roomMeta: RoomMeta | null = null;
  let agentCtx: any = null;
  try {
    roomMeta = await computeRoomMeta(roomId);
    if (auth.agentId) {
      agentCtx = await loadAgentContext(roomId, auth.agentId, rows2objects(stateResult) as any[]);
    }
  } catch {}

  // ── Process state rows with _meta ──
  const rawRows = rows2objects(stateResult);
  const stateRows: any[] = [];

  for (const row of rawRows) {
    if (!isTimerLive(row)) continue;
    let value: any = row.value;
    try { value = JSON.parse(row.value); } catch {}

    // Compute _meta for this entry
    let _meta: any = null;
    if (roomMeta) {
      const score = computeScore(row.scope as string, row.key as string, row.updated_at as string, value, agentCtx, roomMeta);
      const wrapped = wrapEntry(value, row.scope as string, row.key as string, row.revision ?? 0, row.updated_at ?? "", roomMeta, score);
      _meta = wrapped._meta;
    }

    stateRows.push({
      scope: row.scope,
      key: row.key,
      sort_key: row.sort_key ?? null,
      value,
      revision: row.revision,
      updated_at: row.updated_at,
      _meta,
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

    if (def.enabled) {
      try { if (!celEval(def.enabled, ctx)) continue; } catch { continue; }
    }

    const viewCtx = await buildViewContext(roomId, def.scope ?? "_shared", ctx);
    try {
      const result = celEval(def.expr, viewCtx);
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
    if (def?.enabled) {
      try { if (!celEval(def.enabled, ctx)) continue; } catch { continue; }
    }
    if (def?.if) {
      try { available[a.key] = !!celEval(def.if, ctx); } catch { available[a.key] = false; }
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
      salience = stateRows
        .filter((r: any) => !r.scope.startsWith("_") || r.scope === "_shared")
        .filter((r: any) => r._meta && r._meta.score > 0.05)
        .map((r: any) => ({ key: `${r.scope}.${r.key}`, score: Math.round(r._meta.score * 100) / 100 }))
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 20);
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
