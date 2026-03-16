/**
 * audit.ts — Fire-and-forget audit logging for sync rooms.
 *
 * Two entry types:
 * - Invocation entries (kind="invoke"): action invocations with effect.writes for replay
 * - Structural entries: agent join/update, action/view register/delete
 *
 * Both are appended to the _audit scope in room state. Never throws.
 *
 * v8: Also populates log_index for key-based temporal queries.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { rows2objects } from "./utils.ts";
import { indexLogEntry } from "./schema-v8.ts";

/** Append a structured audit entry to the _audit scope (fire-and-forget).
 *
 * Entry shape (v2):
 *   kind: "invoke" (default, backward-compatible) | structural event kinds
 *   ts, agent, ok — always present
 *   action, builtin, params — present for kind="invoke"
 *   effect.writes — resolved {scope, key, value} tuples for kind="invoke" (enables replay)
 *
 * Old entries without `kind` are treated as kind="invoke" during replay reconstruction. */
export async function appendAuditEntry(
  roomId: string,
  agent: string | null,
  action: string,
  builtin: boolean,
  params: Record<string, any>,
  status: number,
  executedWrites?: Array<{ scope: string; key: string; value?: any }>,
) {
  try {
    const seqResult = await sqlite.execute({
      sql: `SELECT COALESCE(MAX(sort_key), 0) + 1 as next_seq FROM state WHERE room_id = ? AND scope = '_audit'`,
      args: [roomId],
    });
    const seq = Number(rows2objects(seqResult)[0]?.next_seq ?? 1);
    const entry: Record<string, any> = {
      ts: new Date().toISOString(),
      kind: "invoke",
      agent: agent ?? "admin",
      action,
      builtin,
      params,
      ok: status < 400,
    };
    if (executedWrites && executedWrites.length > 0 && status < 400) {
      entry.effect = { writes: executedWrites };
    }
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at)
            VALUES (?, '_audit', ?, ?, ?, 1, datetime('now'))`,
      args: [roomId, String(seq), seq, JSON.stringify(entry)],
    });

    // v8: populate log_index for key-based temporal queries
    const affectedKeys: Array<{ scope: string; key: string }> = [];
    if (executedWrites && executedWrites.length > 0 && status < 400) {
      for (const w of executedWrites) {
        if (w.scope && w.key) affectedKeys.push({ scope: w.scope, key: w.key });
      }
    }
    indexLogEntry(roomId, seq, affectedKeys).catch(() => {});
  } catch {}
}

/** Append a structural audit event (agent join/update, action/view register/delete).
 *  These are the schema-change half of replay: they capture what entities existed
 *  at each point in time so reconstruction has the right agents, actions, and views.
 *
 *  `kind` discriminates the event. `schema` contains the full definition needed to
 *  reconstruct the entity. Fire-and-forget, never throws. */
export async function appendStructuralEvent(
  roomId: string,
  kind: "agent_join" | "agent_update" | "register_action" | "register_view" | "delete_action" | "delete_view",
  agent: string | null,
  schema: Record<string, any>,
) {
  try {
    const seqResult = await sqlite.execute({
      sql: `SELECT COALESCE(MAX(sort_key), 0) + 1 as next_seq FROM state WHERE room_id = ? AND scope = '_audit'`,
      args: [roomId],
    });
    const seq = Number(rows2objects(seqResult)[0]?.next_seq ?? 1);
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      kind,
      agent: agent ?? "admin",
      ok: true,
      schema,
    });
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at)
            VALUES (?, '_audit', ?, ?, ?, 1, datetime('now'))`,
      args: [roomId, String(seq), seq, entry],
    });

    // v8: populate log_index for structural events
    const affectedKeys: Array<{ scope: string; key: string }> = [];
    if (schema.id) {
      if (kind.includes("action")) {
        affectedKeys.push({ scope: "_actions", key: schema.id });
      } else if (kind.includes("view")) {
        affectedKeys.push({ scope: "_views", key: schema.id });
      } else if (kind === "agent_join" || kind === "agent_update") {
        affectedKeys.push({ scope: "_agents", key: schema.id });
      }
    }
    // Also index any state keys mentioned in the schema (e.g. action write targets)
    if (schema.writes && Array.isArray(schema.writes)) {
      for (const w of schema.writes) {
        if (w.scope && w.key && !w.key.includes("${")) {
          affectedKeys.push({ scope: w.scope, key: w.key });
        }
      }
    }
    indexLogEntry(roomId, seq, affectedKeys).catch(() => {});
  } catch {}
}
