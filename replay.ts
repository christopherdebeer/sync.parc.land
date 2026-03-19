/**
 * replay.ts — Time-travel replay for sync rooms.
 *
 * v9: Reconstructs wrapped { value, _meta } state from audit entries.
 * Uses celEval (Environment) so v9 expressions with domain helpers work.
 * Accumulates per-key _meta (writer, via, revision) from audit walk.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { celEval } from "./cel.ts";
import { rows2objects } from "./utils.ts";
import { isTimerLive } from "./timers.ts";
import type { EntryMeta } from "./meta.ts";

/** Minimal _meta accumulated from audit walk */
function replayMeta(revision: number, writer: string | null, via: string | null, seq: number | null, ts: string): EntryMeta {
  return {
    revision,
    updated_at: ts,
    writer,
    via,
    seq,
    score: 0,
    velocity: 0,
    writers: writer ? [writer] : [],
    first_at: ts,
    elided: false,
  };
}

/**
 * Reconstruct room state by replaying audit entries up to seq N.
 * Returns wrapped { value, _meta } entries — same shape as live context.
 */
export async function replayRoom(roomId: string, upToSeq: number): Promise<{
  agents: any[];
  state: any[];
  messages: any[];
  actions: any[];
  views: any[];
  audit: any[];
  _replay: { seq: number; total: number; ts: string | null };
}> {
  const auditRes = await sqlite.execute({
    sql: `SELECT sort_key, value FROM state WHERE room_id = ? AND scope = '_audit' AND sort_key <= ? ORDER BY sort_key ASC`,
    args: [roomId, upToSeq],
  });
  const auditRows = rows2objects(auditRes);

  const totalRes = await sqlite.execute({
    sql: `SELECT COALESCE(MAX(sort_key), 0) as total FROM state WHERE room_id = ? AND scope = '_audit'`,
    args: [roomId],
  });
  const total = Number(rows2objects(totalRes)[0]?.total ?? 0);

  // ── Reconstruction state ──
  const agentsMap: Record<string, any> = {};
  const actionsMap: Record<string, any> = {};
  const viewsMap: Record<string, any> = {};
  // state: scope → key → { value, revision, writer, via, seq, writers, first_at }
  const stateMap: Record<string, Record<string, { value: any; revision: number; writer: string | null; via: string | null; seq: number | null; writers: Set<string>; first_at: string }>> = {};
  const messagesArr: any[] = [];
  const auditOut: any[] = [];

  let lastTs: string | null = null;

  function writeState(scope: string, key: string, value: any, agent: string | null, action: string | null, seq: number, ts: string) {
    if (!stateMap[scope]) stateMap[scope] = {};
    const existing = stateMap[scope][key];
    if (existing) {
      existing.value = value;
      existing.revision++;
      existing.writer = agent;
      existing.via = action;
      existing.seq = seq;
      if (agent) existing.writers.add(agent);
    } else {
      stateMap[scope][key] = {
        value, revision: 1, writer: agent, via: action, seq,
        writers: new Set(agent ? [agent] : []),
        first_at: ts,
      };
    }
  }

  for (const row of auditRows) {
    let entry: any;
    try { entry = JSON.parse(row.value); } catch { continue; }
    const kind = entry.kind ?? "invoke";
    lastTs = entry.ts ?? lastTs;
    const seq = Number(row.sort_key);

    auditOut.push({ sort_key: row.sort_key, value: entry, updated_at: entry.ts ?? "" });

    switch (kind) {
      case "agent_join": {
        const s = entry.schema ?? {};
        agentsMap[s.id] = {
          id: s.id, name: s.name ?? s.id, role: s.role ?? "agent",
          status: "active", grants: JSON.stringify(s.grants ?? []),
          joined_at: entry.ts ?? "", last_heartbeat: entry.ts ?? "", waiting_on: null,
        };
        if (s.state && typeof s.state === "object") {
          for (const [key, value] of Object.entries(s.state)) {
            writeState(s.id, key, value, s.id, null, seq, entry.ts ?? "");
          }
        }
        break;
      }
      case "agent_update": {
        const s = entry.schema ?? {};
        if (agentsMap[s.id]) {
          const changes = s.changes ?? {};
          if (changes.name !== undefined) agentsMap[s.id].name = changes.name;
          if (changes.role !== undefined) agentsMap[s.id].role = changes.role;
          if (changes.grants !== undefined) agentsMap[s.id].grants = JSON.stringify(changes.grants);
        }
        break;
      }
      case "register_action": {
        const s = entry.schema ?? {};
        if (s.id) {
          actionsMap[s.id] = {
            id: s.id, room_id: roomId, scope: s.scope ?? "_shared",
            description: s.description ?? null, if: s.if_expr ?? null,
            enabled: s.enabled_expr ?? null, writes: s.writes ?? [],
            params: s.params ?? null, available: true, version: 1,
            registered_by: entry.agent ?? null,
          };
        }
        break;
      }
      case "delete_action": {
        const s = entry.schema ?? {};
        if (s.id) delete actionsMap[s.id];
        break;
      }
      case "register_view": {
        const s = entry.schema ?? {};
        if (s.id) {
          viewsMap[s.id] = {
            id: s.id, room_id: roomId, scope: s.scope ?? "_shared",
            description: s.description ?? null, expr: s.expr,
            enabled: s.enabled_expr ?? null, render: s.render ?? null,
            registered_by: entry.agent ?? null, version: 1,
          };
        }
        break;
      }
      case "delete_view": {
        const s = entry.schema ?? {};
        if (s.id) delete viewsMap[s.id];
        break;
      }
      case "invoke":
      default: {
        const writes: Array<{ scope: string; key: string; value?: any }> = entry.effect?.writes ?? [];
        for (const w of writes) {
          if (!w.scope || !w.key) continue;
          if (w.scope === "_messages") {
            messagesArr.push({ sort_key: w.key, value: w.value, updated_at: entry.ts ?? "" });
            continue;
          }
          if (w.scope === "_audit") continue;
          writeState(w.scope, w.key, w.value, entry.agent ?? null, entry.action ?? null, seq, entry.ts ?? "");
        }
        const invokeAgent = entry.agent;
        if (invokeAgent && agentsMap[invokeAgent]) {
          agentsMap[invokeAgent].status = "active";
          agentsMap[invokeAgent].last_heartbeat = entry.ts ?? agentsMap[invokeAgent].last_heartbeat;
        }
        break;
      }
    }
  }

  // ── Build wrapped state (v9 shape: { value, _meta }) ──
  const stateRows: any[] = [];
  const celState: Record<string, Record<string, any>> = {};

  for (const [scope, keys] of Object.entries(stateMap)) {
    celState[scope] = {};
    for (const [key, entry] of Object.entries(keys)) {
      const wrapped = {
        value: entry.value,
        _meta: {
          ...replayMeta(entry.revision, entry.writer, entry.via, entry.seq, entry.first_at),
          updated_at: lastTs ?? entry.first_at,
          writers: [...entry.writers],
        },
      };
      celState[scope][key] = wrapped;
      stateRows.push({ room_id: roomId, scope, key, value: entry.value, version: "", revision: entry.revision, sort_key: null, updated_at: lastTs ?? "" });
    }
  }

  // ── Wrapped agents for CEL context ──
  const celAgents: Record<string, any> = {};
  for (const [id, a] of Object.entries(agentsMap)) {
    celAgents[id] = {
      value: { name: a.name, role: a.role, status: a.status },
      _meta: replayMeta(1, null, null, null, a.joined_at ?? ""),
    };
  }

  // ── Wrapped actions for CEL context ──
  const celActions: Record<string, any> = {};
  for (const [id, a] of Object.entries(actionsMap)) {
    celActions[id] = {
      value: { enabled: true, available: true, description: a.description },
      _meta: { ...replayMeta(1, a.registered_by, null, null, ""), invocations: 0, last_invoked_at: null, last_invoked_by: null, contested: [] },
    };
  }

  // ── Evaluate views against wrapped reconstructed state ──
  const views: any[] = [];
  for (const viewDef of Object.values(viewsMap)) {
    let value: any = null;
    try {
      const celCtx = {
        state: celState,
        views: {},
        agents: celAgents,
        actions: celActions,
        messages: { count: messagesArr.length, unread: 0, directed_unread: 0 },
        self: "",
        params: {},
      };
      const evalResult = celEval(viewDef.expr, celCtx);
      value = typeof evalResult === "bigint" ? Number(evalResult) : evalResult;
    } catch (e: any) {
      value = { _error: e.message };
    }
    views.push({ ...viewDef, value });
  }

  // ── Messages from DB (more reliable than audit writes) ──
  if (lastTs) {
    const sqliteTs = lastTs.replace("T", " ").replace(/\.\d+Z?$/, "");
    const dbMsgsRes = await sqlite.execute({
      sql: `SELECT sort_key, value, updated_at FROM state
            WHERE room_id = ? AND scope = '_messages' AND updated_at <= ?
            ORDER BY sort_key ASC`,
      args: [roomId, sqliteTs],
    });
    messagesArr.length = 0;
    for (const row of rows2objects(dbMsgsRes)) {
      let msgValue: any = row.value;
      try { msgValue = JSON.parse(row.value); } catch {}
      messagesArr.push({ sort_key: row.sort_key, value: msgValue, updated_at: row.updated_at });
    }
  } else {
    messagesArr.length = 0;
  }

  return {
    agents: Object.values(agentsMap),
    state: stateRows,
    messages: messagesArr,
    actions: Object.values(actionsMap),
    views,
    audit: auditOut,
    _replay: { seq: upToSeq, total, ts: lastTs },
  };
}
