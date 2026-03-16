/**
 * sampling.ts — View value sampling for temporal traces.
 *
 * Records periodic snapshots of view values into the audit log as
 * `kind: "sample"` entries. These entries power temporal sparklines
 * and history views on the dashboard.
 *
 * Sampling strategy:
 *   - Only views with render.temporal = true are sampled
 *   - At most one sample per view per SAMPLE_INTERVAL_MS (60s default)
 *   - Sampling is piggybacked on dashboardPoll — no separate cron
 *   - Samples are fire-and-forget, never block the poll response
 *   - Sample entries are indexed in log_index under scope "_samples"
 *
 * Sample log entry shape:
 *   { kind: "sample", ts, views: { [viewId]: value } }
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { rows2objects } from "./utils.ts";
import { indexLogEntry } from "./schema-v8.ts";

const SAMPLE_INTERVAL_MS = 60_000; // 1 minute

// In-memory last-sample timestamps per room. Resets on cold start (acceptable).
const lastSampleTime = new Map<string, number>();

/**
 * Record view value samples if enough time has elapsed since the last sample.
 * Called from dashboardPoll after view evaluation.
 *
 * @param roomId - The room to sample
 * @param views - Evaluated views from the poll (with .value and .render)
 */
export async function maybeSampleViews(
  roomId: string,
  views: Array<{ id: string; value: any; render: any }>,
) {
  const now = Date.now();
  const lastTime = lastSampleTime.get(roomId) ?? 0;
  if (now - lastTime < SAMPLE_INTERVAL_MS) return;

  // Find temporal views
  const temporalViews = views.filter(v =>
    v.render?.temporal === true &&
    v.value !== undefined &&
    !(v.value && typeof v.value === "object" && v.value._error)
  );
  if (temporalViews.length === 0) return;

  // Record the sample
  lastSampleTime.set(roomId, now);

  try {
    // Get next audit seq
    const seqResult = await sqlite.execute({
      sql: `SELECT COALESCE(MAX(sort_key), 0) + 1 as next_seq FROM state WHERE room_id = ? AND scope = '_audit'`,
      args: [roomId],
    });
    const seq = Number(rows2objects(seqResult)[0]?.next_seq ?? 1);

    // Build sample entry
    const sampleValues: Record<string, any> = {};
    for (const v of temporalViews) {
      sampleValues[v.id] = v.value;
    }

    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      kind: "sample",
      agent: "_system",
      ok: true,
      views: sampleValues,
    });

    // Append to audit log
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at)
            VALUES (?, '_audit', ?, ?, ?, 1, datetime('now'))`,
      args: [roomId, String(seq), seq, entry],
    });

    // Index under _samples scope for each sampled view
    const affectedKeys = temporalViews.map(v => ({ scope: "_samples", key: v.id }));
    await indexLogEntry(roomId, seq, affectedKeys);
  } catch {
    // Fire and forget — never disrupt the poll
  }
}

/**
 * Query view value samples from the log.
 * Returns chronologically ordered samples for a specific view.
 */
export async function queryViewSamples(
  roomId: string,
  viewId: string,
  opts: { limit?: number; after?: number } = {},
): Promise<Array<{ seq: number; ts: string; value: any }>> {
  const limit = opts.limit ?? 100;
  let sql = `
    SELECT DISTINCT li.seq, s.value
    FROM log_index li
    JOIN state s ON s.room_id = li.room_id
      AND s.scope = '_audit'
      AND s.sort_key = li.seq
    WHERE li.room_id = ? AND li.scope = '_samples' AND li.key = ?
  `;
  const args: any[] = [roomId, viewId];

  if (opts.after) {
    sql += ` AND li.seq > ?`;
    args.push(opts.after);
  }

  sql += ` ORDER BY li.seq ASC LIMIT ?`;
  args.push(limit);

  const result = await sqlite.execute({ sql, args });
  return result.rows.map(([seq, rawValue]) => {
    let entry: any = {};
    try { entry = JSON.parse(rawValue as string); } catch {}
    return {
      seq: seq as number,
      ts: entry.ts ?? "",
      value: entry.views?.[viewId] ?? null,
    };
  });
}
