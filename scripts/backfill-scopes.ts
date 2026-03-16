/**
 * scripts/backfill-scopes.ts — One-time migration: populate v8 scopes from legacy tables.
 *
 * For every room, copies:
 *   - actions table → state._actions.{id} (full action definition as JSON)
 *   - views table   → state._views.{id} (full view definition as JSON, with deps extracted)
 *   - agents table  → state._agents.{id} (presence data)
 *
 * Idempotent: uses INSERT OR IGNORE (won't overwrite data from dual-write).
 * Run once to bring all existing rooms up to v8 scope conventions.
 *
 * GET /scripts/backfill-scopes → run the migration, return stats.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { extractDependencies } from "../deps.ts";

function rows2objects(result: { columns: string[]; rows: any[][] }) {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((col, i) => [col, row[i]]))
  );
}

export default async function handler(req: Request): Promise<Response> {
  const stats = { rooms: 0, actions: 0, views: 0, agents: 0, skipped: 0, errors: [] as string[] };

  // Get all rooms
  const roomsResult = await sqlite.execute({ sql: `SELECT id FROM rooms`, args: [] });
  const rooms = roomsResult.rows.map(r => r[0] as string);
  stats.rooms = rooms.length;

  for (const roomId of rooms) {
    // ── Backfill _actions ──
    try {
      const actionsResult = await sqlite.execute({
        sql: `SELECT * FROM actions WHERE room_id = ?`,
        args: [roomId],
      });
      const actions = rows2objects(actionsResult);

      for (const action of actions) {
        try {
          let writes: any[] = [];
          try { writes = JSON.parse(action.writes_json || "[]"); } catch {}
          let params: any = null;
          try { params = action.params_json ? JSON.parse(action.params_json) : null; } catch {}
          let timer: any = null;
          try { timer = action.timer_json ? JSON.parse(action.timer_json) : null; } catch {}
          let onInvoke: any = null;
          try { onInvoke = action.on_invoke_timer_json ? { timer: JSON.parse(action.on_invoke_timer_json) } : null; } catch {}

          const value = JSON.stringify({
            description: action.description ?? null,
            if: action.if_expr ?? null,
            enabled: action.enabled_expr ?? null,
            result: action.result_expr ?? null,
            writes,
            params,
            scope: action.scope ?? "_shared",
            registered_by: action.registered_by ?? null,
            timer,
            on_invoke: onInvoke,
          });

          await sqlite.execute({
            sql: `INSERT OR IGNORE INTO state (room_id, scope, key, value, version, revision, updated_at)
                  VALUES (?, '_actions', ?, ?, '', 1, datetime('now'))`,
            args: [roomId, action.id, value],
          });
          stats.actions++;
        } catch (e: any) {
          stats.errors.push(`action ${roomId}/${action.id}: ${e.message}`);
        }
      }
    } catch (e: any) {
      stats.errors.push(`actions for ${roomId}: ${e.message}`);
    }

    // ── Backfill _views ──
    try {
      const viewsResult = await sqlite.execute({
        sql: `SELECT * FROM views WHERE room_id = ?`,
        args: [roomId],
      });
      const views = rows2objects(viewsResult);

      for (const view of views) {
        try {
          let render: any = null;
          try { render = view.render_json ? JSON.parse(view.render_json) : null; } catch {}
          let timer: any = null;
          try { timer = view.timer_json ? JSON.parse(view.timer_json) : null; } catch {}

          // Extract deps
          let deps: any[] = [];
          try { deps = extractDependencies(view.expr); } catch {}

          const value = JSON.stringify({
            expr: view.expr,
            description: view.description ?? null,
            enabled: view.enabled_expr ?? null,
            render,
            scope: view.scope ?? "_shared",
            registered_by: view.registered_by ?? null,
            timer,
            deps,
          });

          await sqlite.execute({
            sql: `INSERT OR IGNORE INTO state (room_id, scope, key, value, version, revision, updated_at)
                  VALUES (?, '_views', ?, ?, '', 1, datetime('now'))`,
            args: [roomId, view.id, value],
          });
          stats.views++;
        } catch (e: any) {
          stats.errors.push(`view ${roomId}/${view.id}: ${e.message}`);
        }
      }
    } catch (e: any) {
      stats.errors.push(`views for ${roomId}: ${e.message}`);
    }

    // ── Backfill _agents ──
    try {
      const agentsResult = await sqlite.execute({
        sql: `SELECT * FROM agents WHERE room_id = ?`,
        args: [roomId],
      });
      const agents = rows2objects(agentsResult);

      for (const agent of agents) {
        try {
          let grants: any[] = [];
          try { grants = agent.grants ? JSON.parse(agent.grants) : []; } catch {}

          const value = JSON.stringify({
            name: agent.name,
            role: agent.role ?? "agent",
            status: agent.status ?? "active",
            grants,
            last_heartbeat: agent.last_heartbeat ?? null,
            joined_at: agent.joined_at ?? null,
          });

          await sqlite.execute({
            sql: `INSERT OR IGNORE INTO state (room_id, scope, key, value, version, revision, updated_at)
                  VALUES (?, '_agents', ?, ?, '', 1, datetime('now'))`,
            args: [roomId, agent.id, value],
          });
          stats.agents++;
        } catch (e: any) {
          stats.errors.push(`agent ${roomId}/${agent.id}: ${e.message}`);
        }
      }
    } catch (e: any) {
      stats.errors.push(`agents for ${roomId}: ${e.message}`);
    }
  }

  return new Response(JSON.stringify(stats, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
