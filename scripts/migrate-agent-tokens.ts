/**
 * scripts/migrate-agent-tokens.ts — Fold agent tokens into unified tokens table.
 *
 * For each agent with a token_hash, creates a corresponding tokens table entry.
 * Adds last_seen_seq to _agents scope entries.
 * Adds last_used_at column to tokens table.
 *
 * Idempotent: uses INSERT OR IGNORE (won't overwrite existing tokens).
 *
 * GET /scripts/migrate-agent-tokens → run the migration, return stats.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";

function rows2objects(result: { columns: string[]; rows: any[][] }) {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((col, i) => [col, row[i]]))
  );
}

export default async function handler(req: Request): Promise<Response> {
  const stats = { agents: 0, tokens_created: 0, scope_updated: 0, errors: [] as string[] };

  // 1. Add last_used_at column to tokens table
  try {
    await sqlite.execute({ sql: `ALTER TABLE tokens ADD COLUMN last_used_at TEXT`, args: [] });
  } catch { /* already exists */ }

  // 2. Get all agents with token hashes
  const agentsResult = await sqlite.execute({
    sql: `SELECT id, room_id, token_hash, grants, last_seen_seq, last_heartbeat, name, role FROM agents WHERE token_hash IS NOT NULL`,
    args: [],
  });
  const agents = rows2objects(agentsResult);
  stats.agents = agents.length;

  for (const agent of agents) {
    const agentId = agent.id as string;
    const roomId = agent.room_id as string;
    const tokenHash = agent.token_hash as string;
    const lastSeenSeq = agent.last_seen_seq ?? 0;
    const lastHeartbeat = agent.last_heartbeat ?? null;

    // Parse grants
    let grants: string[] = [];
    try { grants = JSON.parse(agent.grants as string || "[]"); } catch {}

    // Build scope string from grants
    // as_ tokens are room-scoped with agent identity
    const scope = `rooms:${roomId}:agent:${agentId}:write`;

    // 3. Create tokens table entry (using same hex hash)
    try {
      await sqlite.execute({
        sql: `INSERT OR IGNORE INTO tokens (id, token_hash, minted_by, scope, room_id, agent_id, label, last_used_at, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [
          `legacy_${roomId}_${agentId}`,  // deterministic ID
          tokenHash,                        // same hex SHA-256 hash
          "legacy_migration",               // minted_by
          scope,
          roomId,
          agentId,
          `Agent ${agent.name ?? agentId}`,
          lastHeartbeat,
        ],
      });
      stats.tokens_created++;
    } catch (e: any) {
      // Likely UNIQUE constraint on token_hash — token already migrated
      if (!e.message?.includes("UNIQUE")) {
        stats.errors.push(`token ${roomId}/${agentId}: ${e.message}`);
      }
    }

    // 4. Update _agents scope entry with last_seen_seq and token_id
    try {
      const scopeResult = await sqlite.execute({
        sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_agents' AND key = ?`,
        args: [roomId, agentId],
      });
      if (scopeResult.rows.length > 0) {
        const current = JSON.parse(scopeResult.rows[0][0] as string);
        current.last_seen_seq = lastSeenSeq;
        current.token_id = `legacy_${roomId}_${agentId}`;
        await sqlite.execute({
          sql: `UPDATE state SET value = ?, revision = revision + 1, updated_at = datetime('now')
                WHERE room_id = ? AND scope = '_agents' AND key = ?`,
          args: [JSON.stringify(current), roomId, agentId],
        });
        stats.scope_updated++;
      }
    } catch (e: any) {
      stats.errors.push(`scope ${roomId}/${agentId}: ${e.message}`);
    }
  }

  return new Response(JSON.stringify(stats, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
