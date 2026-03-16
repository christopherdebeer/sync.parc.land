/**
 * salience.ts — Adaptive salience: the reward signal.
 *
 * Computes a relevance score for each state key relative to a specific agent.
 * All signals are derived from structure (state + log), not ML — making
 * salience transparent, debuggable, and observable as a system view.
 *
 * The RL isomorphism:
 *   World state    → State
 *   Transition fn  → Action.writes
 *   Observation fn → View.compute
 *   Trajectory     → Log
 *   Affordance map → Context
 *   Reward signal  → Salience score  ← this module
 *
 * Signals (each normalized to [0, 1]):
 *
 *   recency    — how recently was this key updated?
 *   dependency — does the agent's registered views depend on this key?
 *   authorship — did this agent write this key?
 *   directed   — is this a message directed to this agent?
 *   contest    — is this key a write target of competing actions?
 *   delta      — has this key changed since the agent last saw it?
 *
 * Weights are configurable per-room via _config.salience_weights.
 * Default weights emphasize dependency and delta (what matters to you
 * and what's new) over recency (what happened recently to anyone).
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { rows2objects } from "./utils.ts";
import type { DependencySet } from "./deps.ts";
import { isRelevant } from "./deps.ts";

// ── Types ──────────────────────────────────────────────────────────────

export interface SalienceWeights {
  recency: number;
  dependency: number;
  authorship: number;
  directed: number;
  contest: number;
  delta: number;
}

export interface SalienceEntry {
  scope: string;
  key: string;
  score: number;
  signals: {
    recency: number;
    dependency: number;
    authorship: number;
    directed: number;
    contest: number;
    delta: number;
  };
}

export interface SalienceMap {
  agent: string;
  weights: SalienceWeights;
  entries: SalienceEntry[];
  computed_at: string;
}

// ── Defaults ───────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: SalienceWeights = {
  recency: 0.10,
  dependency: 0.30,
  authorship: 0.10,
  directed: 0.20,
  contest: 0.10,
  delta: 0.20,
};

// ── Signal computation ─────────────────────────────────────────────────

/**
 * Recency signal: exponential decay from last update.
 * 1.0 = updated now, 0.5 ≈ 5 minutes ago, ~0 after an hour.
 */
function recencySignal(updatedAt: string | null, now: number): number {
  if (!updatedAt) return 0;
  const updated = new Date(updatedAt).getTime();
  if (isNaN(updated)) return 0;
  const ageMs = now - updated;
  if (ageMs <= 0) return 1;
  // Half-life of 5 minutes (300,000 ms)
  const halfLife = 300_000;
  return Math.pow(0.5, ageMs / halfLife);
}

/**
 * Dependency signal: is this key in the dependency set of any of the agent's views?
 * 1.0 = direct dependency, 0.5 = prefix match, 0.3 = scope match, 0 = unrelated.
 */
function dependencySignal(
  scope: string,
  key: string,
  agentDeps: DependencySet,
): number {
  // Check for direct hit
  for (const dep of agentDeps) {
    if (dep.root !== "state") continue;
    if (dep.access === "direct" && dep.scope === scope && dep.key === key) return 1.0;
  }
  // Check for prefix match
  for (const dep of agentDeps) {
    if (dep.root !== "state") continue;
    if (dep.access === "prefix" && dep.prefix && key.startsWith(dep.prefix)) {
      if (!dep.scope || dep.scope === scope) return 0.5;
    }
  }
  // Check for scope match
  for (const dep of agentDeps) {
    if (dep.root !== "state") continue;
    if (dep.access === "scope" && dep.scope === scope) return 0.3;
    if (dep.access === "full") return 0.1;
  }
  return 0;
}

/**
 * Authorship signal: did this agent write this key most recently?
 * Requires the audit log index. Returns 1.0 if the agent was the last writer.
 */
function authorshipSignal(
  lastWriter: string | null,
  agentId: string,
): number {
  if (!lastWriter) return 0;
  return lastWriter === agentId ? 1.0 : 0;
}

/**
 * Directed signal: for messages, is this directed at the agent?
 * 1.0 = explicitly directed (to includes agent), 0.3 = broadcast, 0 = not a message.
 */
function directedSignal(
  scope: string,
  value: any,
  agentId: string,
): number {
  if (scope !== "_messages") return 0;
  if (typeof value !== "object" || value === null) return 0.3; // broadcast
  if (Array.isArray(value.to)) {
    return value.to.includes(agentId) ? 1.0 : 0.1;
  }
  return 0.3; // no to field = broadcast
}

/**
 * Contest signal: is this key a write target of 2+ actions?
 * 1.0 = contested by actions the agent registered, 0.5 = contested by others.
 */
function contestSignal(
  scope: string,
  key: string,
  contestedTargets: Record<string, string[]>,
  agentActions: Set<string>,
): number {
  const target = `${scope}:${key}`;
  const contestants = contestedTargets[target];
  if (!contestants || contestants.length < 2) return 0;
  // Higher if the agent's own actions are involved
  const agentInvolved = contestants.some(id => agentActions.has(id));
  return agentInvolved ? 1.0 : 0.5;
}

/**
 * Delta signal: has this key been updated since the agent's last heartbeat?
 * 1.0 = updated since last seen, 0 = no change.
 */
function deltaSignal(
  updatedAt: string | null,
  agentLastSeen: string | null,
): number {
  if (!updatedAt || !agentLastSeen) return 0;
  const updated = new Date(updatedAt).getTime();
  const lastSeen = new Date(agentLastSeen).getTime();
  if (isNaN(updated) || isNaN(lastSeen)) return 0;
  return updated > lastSeen ? 1.0 : 0;
}

// ── Main computation ───────────────────────────────────────────────────

/**
 * Compute the salience map for a specific agent in a room.
 *
 * This is the core "reward signal" — it tells the agent what to pay
 * attention to. The map is computable entirely from structure:
 * state table, log_index, agent metadata, and view dependencies.
 */
export async function computeSalience(
  roomId: string,
  agentId: string,
  opts: {
    weights?: Partial<SalienceWeights>;
    agentDeps?: DependencySet;
    contestedTargets?: Record<string, string[]>;
    /** Only compute for specific scopes (default: all visible) */
    scopes?: string[];
    /** Max entries to return (default: 50) */
    limit?: number;
  } = {},
): Promise<SalienceMap> {
  const now = Date.now();
  const limit = opts.limit ?? 50;

  // Load room-level weight overrides from _config
  let roomWeights: Partial<SalienceWeights> = {};
  try {
    const configResult = await sqlite.execute({
      sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_config' AND key = 'salience_weights'`,
      args: [roomId],
    });
    if (configResult.rows.length > 0) {
      roomWeights = JSON.parse(configResult.rows[0][0] as string);
    }
  } catch { /* no config = use defaults */ }

  const weights: SalienceWeights = {
    ...DEFAULT_WEIGHTS,
    ...roomWeights,
    ...(opts.weights ?? {}),
  };

  // Load agent metadata from _agents scope
  let agentLastSeen: string | null = null;
  try {
    const agentResult = await sqlite.execute({
      sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_agents' AND key = ?`,
      args: [roomId, agentId],
    });
    if (agentResult.rows.length > 0) {
      const def = JSON.parse(agentResult.rows[0][0] as string);
      agentLastSeen = def.last_heartbeat ?? null;
    }
  } catch {}

  // Load agent's registered actions from _actions scope (for contest signal)
  const agentActions = new Set<string>();
  try {
    const actionsResult = await sqlite.execute({
      sql: `SELECT key, value FROM state WHERE room_id = ? AND scope = '_actions'`,
      args: [roomId],
    });
    for (const row of actionsResult.rows) {
      try {
        const def = JSON.parse(row[1] as string);
        if (def.registered_by === agentId) agentActions.add(row[0] as string);
      } catch {}
    }
  } catch {}

  // Load agent's view dependencies from _views scope
  let agentDeps: DependencySet = opts.agentDeps ?? [];
  if (agentDeps.length === 0) {
    try {
      const viewDepsResult = await sqlite.execute({
        sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_views'`,
        args: [roomId],
      });
      for (const row of viewDepsResult.rows) {
        try {
          const viewDef = JSON.parse(row[0] as string);
          // Include deps from views registered by this agent or scoped to this agent
          if (viewDef.registered_by === agentId || viewDef.scope === agentId) {
            if (Array.isArray(viewDef.deps)) {
              agentDeps.push(...viewDef.deps);
            }
          }
        } catch {}
      }
    } catch {}
  }

  // Load contested targets
  const contestedTargets = opts.contestedTargets ?? {};

  // Load recent write authorship from log_index
  // For each key, find the most recent writer
  const lastWriters = new Map<string, string>();
  try {
    // Get recent audit entries that have writes
    const recentAudit = await sqlite.execute({
      sql: `SELECT sort_key, value FROM state WHERE room_id = ? AND scope = '_audit'
            ORDER BY sort_key DESC LIMIT 200`,
      args: [roomId],
    });
    for (const row of recentAudit.rows) {
      try {
        const entry = JSON.parse(row[1] as string);
        if (entry.effect?.writes) {
          for (const w of entry.effect.writes) {
            const k = `${w.scope}:${w.key}`;
            if (!lastWriters.has(k)) {
              lastWriters.set(k, entry.agent ?? "");
            }
          }
        }
      } catch {}
    }
  } catch {}

  // Load state keys
  let stateSql = `SELECT scope, key, value, updated_at FROM state WHERE room_id = ?
    AND scope NOT IN ('_audit')`;
  const stateArgs: any[] = [roomId];

  if (opts.scopes && opts.scopes.length > 0) {
    const placeholders = opts.scopes.map(() => "?").join(",");
    stateSql += ` AND scope IN (${placeholders})`;
    stateArgs.push(...opts.scopes);
  }

  const stateResult = await sqlite.execute({ sql: stateSql, args: stateArgs });
  const stateRows = rows2objects(stateResult);

  // Compute salience for each key
  const entries: SalienceEntry[] = [];

  for (const row of stateRows) {
    const scope = row.scope as string;
    const key = row.key as string;
    const updatedAt = row.updated_at as string | null;

    // Parse value for directed signal
    let value: any = null;
    try { value = JSON.parse(row.value as string); } catch { value = row.value; }

    const lastWriter = lastWriters.get(`${scope}:${key}`) ?? null;

    const signals = {
      recency: recencySignal(updatedAt, now),
      dependency: dependencySignal(scope, key, agentDeps),
      authorship: authorshipSignal(lastWriter, agentId),
      directed: directedSignal(scope, key, value, agentId),
      contest: contestSignal(scope, key, contestedTargets, agentActions),
      delta: deltaSignal(updatedAt, agentLastSeen),
    };

    const score =
      signals.recency * weights.recency +
      signals.dependency * weights.dependency +
      signals.authorship * weights.authorship +
      signals.directed * weights.directed +
      signals.contest * weights.contest +
      signals.delta * weights.delta;

    entries.push({ scope, key, score, signals });
  }

  // Sort by score descending, take top N
  entries.sort((a, b) => b.score - a.score);
  const topEntries = entries.slice(0, limit);

  return {
    agent: agentId,
    weights,
    entries: topEntries,
    computed_at: new Date().toISOString(),
  };
}

/**
 * Lightweight salience check: is this (scope, key) salient for this agent?
 * Returns true if the key would score above threshold.
 * Used for quick filtering in context assembly without computing the full map.
 */
export function isSalient(
  scope: string,
  key: string,
  agentDeps: DependencySet,
  threshold: number = 0.05,
): boolean {
  // Quick check: is it a dependency?
  if (isRelevant(agentDeps, scope, key)) return true;
  // System scopes are always salient
  if (scope.startsWith("_")) return true;
  // Low threshold for everything else
  return false;
}
