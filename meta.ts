/**
 * meta.ts — Entry metadata computation for wrapped state.
 *
 * v9: Every state entry carries { value, _meta: { ... } }.
 * This module computes _meta from:
 *   - The state row itself (revision, updated_at)
 *   - A single bulk audit scan (writer, via, seq, velocity, writers, first_at)
 *   - Action invocation stats (invocations, last_invoked_at, last_invoked_by)
 *   - Contested targets (contested)
 *   - Agent-specific salience score
 *
 * Design principle: one SQL query for audit entries, one pass to accumulate
 * per-key stats. Room-level meta is agent-independent. Score is added per-agent.
 *
 * Replaces salience.ts — score becomes one field in _meta, not a separate module.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import type { DependencySet } from "./deps.ts";
import { isRelevant } from "./deps.ts";

// ── Types ──────────────────────────────────────────────────────────────

export interface EntryMeta {
  revision: number;
  updated_at: string;
  writer: string | null;
  via: string | null;
  seq: number | null;
  score: number;
  velocity: number;
  writers: string[];
  first_at: string | null;
  elided: boolean;
}

export interface ActionMeta extends EntryMeta {
  invocations: number;
  last_invoked_at: string | null;
  last_invoked_by: string | null;
  contested: string[];
}

export interface WrappedEntry<T = any> {
  value: T;
  _meta: EntryMeta | ActionMeta;
}

// ── Internal accumulators ──────────────────────────────────────────────

interface WriteEvent {
  agent: string;
  action: string;
  seq: number;
  ts: string;
}

interface KeyAccum {
  writes: WriteEvent[];
  earliest_ts: string | null;
}

interface ActionInvokeAccum {
  invocations: number;
  last_invoked_at: string | null;
  last_invoked_by: string | null;
}

// ── Velocity ───────────────────────────────────────────────────────────

const VELOCITY_HALF_LIFE_MS = 300_000; // 5 minutes

/**
 * Exponential-decay weighted write count.
 * A write just now contributes 1.0, a write 5 min ago contributes 0.5.
 * Dimensionless — higher = more recent write activity.
 */
function computeVelocity(writes: WriteEvent[], now: number): number {
  let sum = 0;
  for (const w of writes) {
    const ts = new Date(w.ts).getTime();
    if (isNaN(ts)) continue;
    const age = now - ts;
    if (age < 0) continue;
    sum += Math.pow(0.5, age / VELOCITY_HALF_LIFE_MS);
  }
  return Math.round(sum * 100) / 100;
}

// ── Room-level meta (agent-independent) ────────────────────────────────

export interface RoomMeta {
  keys: Map<string, {
    writer: string | null;
    via: string | null;
    seq: number | null;
    velocity: number;
    writers: string[];
    first_at: string | null;
  }>;
  actions: Map<string, ActionInvokeAccum>;
  /** Contested write targets: "scope:key" → list of competing action IDs */
  contested: Map<string, string[]>;
}

/**
 * Compute room-level metadata from a single bulk audit scan.
 * One query, one pass. Agent-independent — score is added later.
 */
export async function computeRoomMeta(roomId: string): Promise<RoomMeta> {
  const now = Date.now();

  // ── Single audit scan ──
  const auditResult = await sqlite.execute({
    sql: `SELECT sort_key, value FROM state
          WHERE room_id = ? AND scope = '_audit'
          ORDER BY sort_key DESC LIMIT 1000`,
    args: [roomId],
  });

  const keyAccums = new Map<string, KeyAccum>();
  const actionAccums = new Map<string, ActionInvokeAccum>();

  for (const row of auditResult.rows) {
    const seq = Number(row[0]);
    let entry: any;
    try { entry = JSON.parse(row[1] as string); } catch { continue; }

    const agent = entry.agent ?? "";
    const action = entry.action ?? "";
    const ts = entry.ts ?? "";

    // Track action invocations (only non-builtin successful invokes)
    if ((entry.kind === "invoke" || (!entry.kind && entry.action)) && entry.ok !== false) {
      if (action && !entry.builtin) {
        let accum = actionAccums.get(action);
        if (!accum) {
          accum = { invocations: 0, last_invoked_at: null, last_invoked_by: null };
          actionAccums.set(action, accum);
        }
        accum.invocations++;
        // First encountered in DESC order = most recent
        if (!accum.last_invoked_at) {
          accum.last_invoked_at = ts;
          accum.last_invoked_by = agent;
        }
      }
    }

    // Track per-key writes
    const writes: Array<{ scope: string; key: string }> = entry.effect?.writes ?? [];
    for (const w of writes) {
      if (!w.scope || !w.key) continue;
      const mk = `${w.scope}:${w.key}`;
      let accum = keyAccums.get(mk);
      if (!accum) {
        accum = { writes: [], earliest_ts: null };
        keyAccums.set(mk, accum);
      }
      accum.writes.push({ agent, action, seq, ts });
      // Last seen in DESC order = earliest known
      accum.earliest_ts = ts;
    }
  }

  // ── Compute per-key derived fields ──
  const keys = new Map<string, {
    writer: string | null; via: string | null; seq: number | null;
    velocity: number; writers: string[]; first_at: string | null;
  }>();

  for (const [mk, accum] of keyAccums) {
    const mostRecent = accum.writes[0]; // first in DESC = most recent
    const writerSet = [...new Set(accum.writes.map(w => w.agent))];
    keys.set(mk, {
      writer: mostRecent?.agent ?? null,
      via: mostRecent?.action ?? null,
      seq: mostRecent?.seq ?? null,
      velocity: computeVelocity(accum.writes, now),
      writers: writerSet,
      first_at: accum.earliest_ts,
    });
  }

  // ── Contested targets from action definitions ──
  const contested = new Map<string, string[]>();
  try {
    const actionsResult = await sqlite.execute({
      sql: `SELECT key, value FROM state WHERE room_id = ? AND scope = '_actions'`,
      args: [roomId],
    });
    const writeTargets = new Map<string, string[]>();
    for (const row of actionsResult.rows) {
      const actionId = row[0] as string;
      try {
        const def = JSON.parse(row[1] as string);
        if (!Array.isArray(def.writes)) continue;
        for (const w of def.writes) {
          const scope = w.scope ?? "_shared";
          const key = w.key;
          if (!key || key.includes("${")) continue; // skip templated keys
          const target = `${scope}:${key}`;
          if (!writeTargets.has(target)) writeTargets.set(target, []);
          writeTargets.get(target)!.push(actionId);
        }
      } catch {}
    }
    for (const [target, actions] of writeTargets) {
      if (actions.length >= 2) contested.set(target, actions);
    }
  } catch {}

  return { keys, actions: actionAccums, contested };
}

// ── Score computation (agent-specific) ─────────────────────────────────

export interface ScoreWeights {
  recency: number;
  dependency: number;
  authorship: number;
  directed: number;
  contest: number;
  delta: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  recency: 0.10,
  dependency: 0.30,
  authorship: 0.10,
  directed: 0.20,
  contest: 0.10,
  delta: 0.20,
};

/** Agent-specific context needed for score computation */
export interface AgentContext {
  agentId: string;
  deps: DependencySet;
  lastSeen: string | null;
  registeredActions: Set<string>;
  weights: ScoreWeights;
}

/**
 * Load the agent context needed for score computation.
 * One function, two queries.
 */
export async function loadAgentContext(
  roomId: string,
  agentId: string,
  stateRows: any[],
): Promise<AgentContext> {
  // Agent last_heartbeat from _agents scope (already in stateRows)
  let lastSeen: string | null = null;
  const agentRow = stateRows.find(
    (r: any) => r.scope === "_agents" && r.key === agentId,
  );
  if (agentRow) {
    try {
      const val = JSON.parse(agentRow.value);
      lastSeen = val.last_heartbeat ?? null;
    } catch {}
  }

  // Agent's registered actions (from stateRows)
  const registeredActions = new Set<string>();
  for (const row of stateRows) {
    if (row.scope !== "_actions") continue;
    try {
      const def = JSON.parse(row.value);
      if (def.registered_by === agentId) registeredActions.add(row.key);
    } catch {}
  }

  // Agent's view dependencies (from stateRows)
  const deps: DependencySet = [];
  for (const row of stateRows) {
    if (row.scope !== "_views") continue;
    try {
      const viewDef = JSON.parse(row.value);
      if (
        viewDef.registered_by === agentId || viewDef.scope === agentId
      ) {
        if (Array.isArray(viewDef.deps)) {
          deps.push(...viewDef.deps);
        }
      }
    } catch {}
  }

  // Room-level weight overrides
  let weights = { ...DEFAULT_WEIGHTS };
  const configRow = stateRows.find(
    (r: any) => r.scope === "_config" && r.key === "salience_weights",
  );
  if (configRow) {
    try {
      const overrides = JSON.parse(configRow.value);
      weights = { ...weights, ...overrides };
    } catch {}
  }

  return { agentId, deps, lastSeen, registeredActions, weights };
}

/**
 * Compute salience score for a single entry.
 * All signals normalized to [0, 1], weighted sum.
 */
export function computeScore(
  scope: string,
  key: string,
  updatedAt: string | null,
  value: any,
  agentCtx: AgentContext | null,
  roomMeta: RoomMeta,
): number {
  if (!agentCtx) return 0.5; // no agent context → neutral score

  const w = agentCtx.weights;
  const now = Date.now();
  const mk = `${scope}:${key}`;

  // Recency: exponential decay from last update
  let recency = 0;
  if (updatedAt) {
    const age = now - new Date(updatedAt).getTime();
    if (age >= 0) recency = Math.pow(0.5, age / 300_000);
  }

  // Dependency: is this key in the agent's view dependency set?
  const dependency = isRelevant(agentCtx.deps, scope, key) ? 1.0 : 0;

  // Authorship: did this agent last write this key?
  const km = roomMeta.keys.get(mk);
  const authorship = km?.writer === agentCtx.agentId ? 1.0 : 0;

  // Directed: for messages, is this directed at the agent?
  let directed = 0;
  if (scope === "_messages" && typeof value === "object" && value !== null) {
    if (Array.isArray(value.to)) {
      directed = value.to.includes(agentCtx.agentId) ? 1.0 : 0.1;
    } else {
      directed = 0.3; // broadcast
    }
  }

  // Contest: is this key a write target of 2+ actions?
  let contest = 0;
  const contestants = roomMeta.contested.get(mk);
  if (contestants && contestants.length >= 2) {
    contest = contestants.some((id) => agentCtx.registeredActions.has(id))
      ? 1.0
      : 0.5;
  }

  // Delta: has this key been updated since the agent's last heartbeat?
  let delta = 0;
  if (updatedAt && agentCtx.lastSeen) {
    const updated = new Date(updatedAt).getTime();
    const last = new Date(agentCtx.lastSeen).getTime();
    if (!isNaN(updated) && !isNaN(last) && updated > last) delta = 1.0;
  }

  const score = recency * w.recency +
    dependency * w.dependency +
    authorship * w.authorship +
    directed * w.directed +
    contest * w.contest +
    delta * w.delta;

  return Math.round(score * 100) / 100;
}

// ── Entry wrapping ─────────────────────────────────────────────────────

/**
 * Wrap a state entry with full _meta.
 * Called once per entry during buildContext.
 */
export function wrapEntry(
  value: any,
  scope: string,
  key: string,
  revision: number,
  updatedAt: string,
  roomMeta: RoomMeta,
  score: number,
): WrappedEntry {
  const mk = `${scope}:${key}`;
  const km = roomMeta.keys.get(mk);

  const meta: EntryMeta = {
    revision,
    updated_at: updatedAt,
    writer: km?.writer ?? null,
    via: km?.via ?? null,
    seq: km?.seq ?? null,
    score,
    velocity: km?.velocity ?? 0,
    writers: km?.writers ?? [],
    first_at: km?.first_at ?? null,
    elided: false,
  };

  // Action-specific meta
  if (scope === "_actions") {
    const am = roomMeta.actions.get(key);
    // Contested: other actions that share write targets with this action
    const myContested: string[] = [];
    for (const [_target, actions] of roomMeta.contested) {
      if (actions.includes(key)) {
        for (const a of actions) {
          if (a !== key && !myContested.includes(a)) myContested.push(a);
        }
      }
    }

    const actionMeta = meta as ActionMeta;
    actionMeta.invocations = am?.invocations ?? 0;
    actionMeta.last_invoked_at = am?.last_invoked_at ?? null;
    actionMeta.last_invoked_by = am?.last_invoked_by ?? null;
    actionMeta.contested = myContested;
  }

  return { value, _meta: meta };
}

/**
 * Create a minimal _meta for entries with no audit history.
 * Used for newly created entries or entries predating the audit window.
 */
export function minimalMeta(
  revision: number,
  updatedAt: string,
  score: number = 0,
): EntryMeta {
  return {
    revision,
    updated_at: updatedAt,
    writer: null,
    via: null,
    seq: null,
    score,
    velocity: 0,
    writers: [],
    first_at: null,
    elided: false,
  };
}
