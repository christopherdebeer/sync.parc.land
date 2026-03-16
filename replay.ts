/**
 * replay.ts — Time-travel replay for sync rooms.
 *
 * Reconstructs room state by replaying _audit entries (state table, _audit scope)
 * up to a given sequence number. Used by the /rooms/:id/replay/:seq endpoint.
 *
 * v8: Already reads exclusively from state table (no legacy table dependencies).
 * Audit entries contain full structural events — agent_join, register_action,
 * register_view, invoke with writes — everything needed for reconstruction.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { evaluate } from "npm:@marcbachmann/cel-js";
import { rows2objects } from "./utils.ts";
import { isTimerLive } from "./timers.ts";

/**
 * Reconstruct PollData (same shape as /poll) by replaying audit entries up to seq N.
 *
 * Reconstruction algorithm:
 *   Start from an empty room. Walk _audit entries in sort_key order up to `upToSeq`.
 *   Apply each entry's effect based on `kind`:
 *     - agent_join / agent_update → mutate agents map
 *     - register_action → upsert actions map
 *     - delete_action → remove from actions map
 *     - register_view → upsert views map (definition only; value evaluated at end)
 *     - delete_view → remove from views map
 *     - invoke (or legacy entries without kind) → apply effect.writes to state map
 *       append-type writes (sort_key present) are replayed as ordered inserts
 *   After all entries applied:
 *     - Evaluate each view's CEL expr against reconstructed state to produce view values
 *     - Messages are reconstructed from state._messages writes
 *     - Audit slice returned as-is up to upToSeq
 *
 * Backward compatibility: entries missing `kind` are treated as `invoke`.
 * Entries missing `effect.writes` on invoke produce no state changes (pre-v2 entries).
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
  // Fetch all audit entries up to upToSeq
  const auditRes = await sqlite.execute({
    sql: `SELECT sort_key, value FROM state WHERE room_id = ? AND scope = '_audit' AND sort_key <= ? ORDER BY sort_key ASC`,
    args: [roomId, upToSeq],
  });
  const auditRows = rows2objects(auditRes);

  // Also fetch total count for meta
  const totalRes = await sqlite.execute({
    sql: `SELECT COALESCE(MAX(sort_key), 0) as total FROM state WHERE room_id = ? AND scope = '_audit'`,
    args: [roomId],
  });
  const total = Number(rows2objects(totalRes)[0]?.total ?? 0);

  // ── Reconstruction state ──────────────────────────────────────────────────
  // agents: id → agent object
  const agentsMap: Record<string, any> = {};
  // actions: id → action definition
  const actionsMap: Record<string, any> = {};
  // views: id → view definition (expr, scope, description, render)
  const viewsMap: Record<string, any> = {};
  // state: scope → key → value (for non-system scopes)
  const stateMap: Record<string, Record<string, any>> = {};
  // messages: ordered array of message objects
  const messagesArr: any[] = [];
  // audit: parsed entries to return
  const auditOut: any[] = [];

  let lastTs: string | null = null;

  for (const row of auditRows) {
    let entry: any;
    try { entry = JSON.parse(row.value); } catch { continue; }
    const kind = entry.kind ?? "invoke";
    lastTs = entry.ts ?? lastTs;

    auditOut.push({ sort_key: row.sort_key, value: entry, updated_at: entry.ts ?? "" });

    switch (kind) {
      case "agent_join": {
        const s = entry.schema ?? {};
        agentsMap[s.id] = {
          id: s.id,
          name: s.name ?? s.id,
          role: s.role ?? "agent",
          status: "active",
          grants: JSON.stringify(s.grants ?? []),
          joined_at: entry.ts ?? "",
          last_heartbeat: entry.ts ?? "",
          waiting_on: null,
        };
        // Apply initial state if captured in the structural event
        if (s.state && typeof s.state === "object") {
          const scope = s.id;
          if (!stateMap[scope]) stateMap[scope] = {};
          for (const [key, value] of Object.entries(s.state)) {
            stateMap[scope][key] = value;
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
            id: s.id,
            room_id: roomId,
            scope: s.scope ?? "_shared",
            description: s.description ?? null,
            if: s.if_expr ?? null,
            enabled: s.enabled_expr ?? null,
            writes: s.writes ?? [],
            params: s.params ?? null,
            available: true,
            version: 1,
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
            id: s.id,
            room_id: roomId,
            scope: s.scope ?? "_shared",
            description: s.description ?? null,
            expr: s.expr,
            enabled: s.enabled_expr ?? null,
            render: s.render ?? null,
            registered_by: entry.agent ?? null,
            version: 1,
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
        // Apply effect.writes to stateMap
        const writes: Array<{ scope: string; key: string; value?: any }> = entry.effect?.writes ?? [];
        for (const w of writes) {
          const scope = w.scope;
          const key = w.key;
          if (!scope || !key) continue;

          // Messages go to messagesArr
          if (scope === "_messages") {
            messagesArr.push({ sort_key: key, value: w.value, updated_at: entry.ts ?? "" });
            continue;
          }
          // Audit writes are already being reconstructed from the entries themselves — skip
          if (scope === "_audit") continue;

          if (!stateMap[scope]) stateMap[scope] = {};
          stateMap[scope][key] = w.value;
        }

        // Update agent status from invocation context
        const invokeAgent = entry.agent;
        if (invokeAgent && agentsMap[invokeAgent]) {
          agentsMap[invokeAgent].status = "active";
          agentsMap[invokeAgent].last_heartbeat = entry.ts ?? agentsMap[invokeAgent].last_heartbeat;
        }
        break;
      }
    }
  }

  // ── Build stateRows (PollData.state shape) ────────────────────────────────
  const stateRows: any[] = [];
  for (const [scope, keys] of Object.entries(stateMap)) {
    for (const [key, value] of Object.entries(keys)) {
      stateRows.push({ room_id: roomId, scope, key, value, version: "", revision: 0, sort_key: null, updated_at: "" });
    }
  }

  // ── Evaluate views against reconstructed state ────────────────────────────
  // Build a minimal CEL context from reconstructed state
  const celState: Record<string, Record<string, any>> = {};
  for (const [scope, keys] of Object.entries(stateMap)) {
    celState[scope] = {};
    for (const [key, value] of Object.entries(keys)) {
      celState[scope][key] = value;
    }
  }

  const views: any[] = [];
  for (const viewDef of Object.values(viewsMap)) {
    let value: any = null;
    try {
      // Minimal context: state map only (no agents/actions in CEL for replay)
      const celCtx = { state: celState };
      const evalResult = evaluate(viewDef.expr, celCtx);
      value = typeof evalResult === "bigint" ? Number(evalResult) : evalResult;
    } catch (e: any) {
      value = { _error: e.message };
    }
    views.push({ ...viewDef, value });
  }

  // ── Sort messages ─────────────────────────────────────────────────────────
  // Primary strategy: query _messages from the DB using timestamp of the last processed
  // audit entry. This is backward-compatible (works for all existing rooms) and also
  // covers _send_message builtins whose writes are never in effect.writes.
  //
  // Messages are INSERTed BEFORE appendAuditEntry is called, so:
  //   _messages.updated_at (SQLite datetime) <= audit entry .ts (ISO string, same clock)
  //
  // Timestamp conversion: JS ISO "2026-03-07T19:39:19.123Z" → SQLite "2026-03-07 19:39:19"
  if (lastTs) {
    const sqliteTs = lastTs.replace("T", " ").replace(/\.\d+Z?$/, "");
    const dbMsgsRes = await sqlite.execute({
      sql: `SELECT sort_key, value, updated_at FROM state
            WHERE room_id = ? AND scope = '_messages' AND updated_at <= ?
            ORDER BY sort_key ASC`,
      args: [roomId, sqliteTs],
    });
    // Replace effect.writes-derived messages with DB-sourced messages (more reliable)
    messagesArr.length = 0;
    for (const row of rows2objects(dbMsgsRes)) {
      let msgValue: any = row.value;
      try { msgValue = JSON.parse(row.value); } catch {}
      messagesArr.push({ sort_key: row.sort_key, value: msgValue, updated_at: row.updated_at });
    }
  } else {
    // No audit entries processed (e.g. upToSeq=0) → no messages
    messagesArr.length = 0;
    messagesArr.sort((a, b) => Number(a.sort_key) - Number(b.sort_key));
  }

  // ── Actions with available=true (no CEL eval against reconstructed state) ──
  const actions = Object.values(actionsMap);

  return {
    agents: Object.values(agentsMap),
    state: stateRows,
    messages: messagesArr,
    actions,
    views,
    audit: auditOut,
    _replay: { seq: upToSeq, total, ts: lastTs },
  };
}
