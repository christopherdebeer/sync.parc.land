import { sqlite } from "https://esm.town/v/std/sqlite";

/**
 * Timer and Enabled utilities for agent-sync.
 *
 * Timer: temporal lifecycle for any resource (state, actions, messages, agents).
 *   - Wall-clock: { ms, effect } or { at, effect }
 *   - Logical-clock: { ticks, tick_on, effect }
 *   - effect: "delete" (resource vanishes on expiry) or "enable" (dormant until expiry)
 *
 * Enabled: CEL expression gating a resource's participation in live state.
 *   - Disabled resources are stored but invisible to reads and CEL contexts.
 */

// ============ Timer parsing and storage ============

export interface TimerConfig {
  ms?: number;
  at?: string;         // ISO datetime
  ticks?: number;
  tick_on?: string;    // state key path to watch
  effect: "delete" | "enable";
}

export interface TimerColumns {
  timer_json: string | null;
  timer_expires_at: string | null;
  timer_ticks_left: number | null;
  timer_tick_on: string | null;
  timer_effect: string | null;
  timer_started_at: string | null;
}

/** Parse a timer config from request body into DB columns */
export function parseTimer(timer: TimerConfig | undefined | null): TimerColumns {
  if (!timer) {
    return {
      timer_json: null,
      timer_expires_at: null,
      timer_ticks_left: null,
      timer_tick_on: null,
      timer_effect: null,
      timer_started_at: null,
    };
  }

  const now = new Date();
  const cols: TimerColumns = {
    timer_json: JSON.stringify(timer),
    timer_effect: timer.effect,
    timer_started_at: now.toISOString(),
    timer_expires_at: null,
    timer_ticks_left: null,
    timer_tick_on: null,
  };

  if (timer.ms !== undefined) {
    cols.timer_expires_at = new Date(now.getTime() + timer.ms).toISOString();
  } else if (timer.at !== undefined) {
    cols.timer_expires_at = new Date(timer.at).toISOString();
  } else if (timer.ticks !== undefined) {
    cols.timer_ticks_left = timer.ticks;
    cols.timer_tick_on = timer.tick_on ?? null;
  }

  return cols;
}

/** Validate timer config from request body */
export function validateTimer(timer: any): { valid: true } | { valid: false; error: string } {
  if (!timer || typeof timer !== "object") {
    return { valid: false, error: "timer must be an object" };
  }
  if (!timer.effect || (timer.effect !== "delete" && timer.effect !== "enable")) {
    return { valid: false, error: "timer.effect must be 'delete' or 'enable'" };
  }
  const hasMs = timer.ms !== undefined;
  const hasAt = timer.at !== undefined;
  const hasTicks = timer.ticks !== undefined;
  const clockCount = [hasMs, hasAt, hasTicks].filter(Boolean).length;
  if (clockCount === 0) {
    return { valid: false, error: "timer must specify one of: ms, at, ticks" };
  }
  if (clockCount > 1) {
    return { valid: false, error: "timer must specify exactly one of: ms, at, ticks" };
  }
  if (hasMs && (typeof timer.ms !== "number" || timer.ms <= 0)) {
    return { valid: false, error: "timer.ms must be a positive number" };
  }
  if (hasAt) {
    const d = new Date(timer.at);
    if (isNaN(d.getTime())) {
      return { valid: false, error: "timer.at must be a valid ISO datetime" };
    }
  }
  if (hasTicks) {
    if (typeof timer.ticks !== "number" || timer.ticks <= 0 || !Number.isInteger(timer.ticks)) {
      return { valid: false, error: "timer.ticks must be a positive integer" };
    }
    if (!timer.tick_on || typeof timer.tick_on !== "string") {
      return { valid: false, error: "timer.tick_on is required for logical-clock timers (state key path to watch)" };
    }
  }
  return { valid: true };
}

// ============ Timer status evaluation ============

export type TimerStatus = "active" | "expired" | "no_timer";

/** Check the timer status of a resource row */
export function getTimerStatus(row: {
  timer_effect?: string | null;
  timer_expires_at?: string | null;
  timer_ticks_left?: number | null;
}): TimerStatus {
  if (!row.timer_effect) return "no_timer";

  // Wall-clock timer
  if (row.timer_expires_at) {
    const expires = new Date(row.timer_expires_at).getTime();
    const now = Date.now();
    return now >= expires ? "expired" : "active";
  }

  // Logical-clock timer
  if (row.timer_ticks_left !== undefined && row.timer_ticks_left !== null) {
    return row.timer_ticks_left <= 0 ? "expired" : "active";
  }

  return "no_timer";
}

/**
 * Determine if a resource is live (visible to reads and CEL) based on its timer.
 *
 * effect="delete": live while timer is active, dead when expired
 * effect="enable": dead while timer is active (dormant), live when expired
 */
export function isTimerLive(row: {
  timer_effect?: string | null;
  timer_expires_at?: string | null;
  timer_ticks_left?: number | null;
}): boolean {
  const status = getTimerStatus(row);
  if (status === "no_timer") return true;

  if (row.timer_effect === "delete") {
    return status === "active"; // live until expired
  }
  if (row.timer_effect === "enable") {
    return status === "expired"; // dormant until expired, then live
  }
  return true;
}

// ============ Logical clock ticking ============

/**
 * Called after a state key is written. Decrements ticks_remaining for all
 * resources in the room that have tick_on matching the written key path.
 *
 * The key path is "scope.key" (e.g., "_shared.turn", "agent-a.score").
 * tick_on values are matched as stored — agents set them as state key paths
 * like "state._shared.turn".
 */
export async function tickLogicalTimers(roomId: string, scope: string, key: string): Promise<void> {
  // Match tick_on patterns: "state.{scope}.{key}" or just "{scope}.{key}"
  const fullPath = `state.${scope}.${key}`;
  const shortPath = `${scope}.${key}`;

  // Tick state timers
  await sqlite.execute({
    sql: `UPDATE state SET timer_ticks_left = timer_ticks_left - 1
          WHERE room_id = ? AND timer_tick_on IS NOT NULL AND timer_ticks_left > 0
          AND (timer_tick_on = ? OR timer_tick_on = ?)`,
    args: [roomId, fullPath, shortPath],
  });

  // Tick action timers
  await sqlite.execute({
    sql: `UPDATE actions SET timer_ticks_left = timer_ticks_left - 1
          WHERE room_id = ? AND timer_tick_on IS NOT NULL AND timer_ticks_left > 0
          AND (timer_tick_on = ? OR timer_tick_on = ?)`,
    args: [roomId, fullPath, shortPath],
  });

  // Tick message timers
  await sqlite.execute({
    sql: `UPDATE messages SET timer_ticks_left = timer_ticks_left - 1
          WHERE room_id = ? AND timer_tick_on IS NOT NULL AND timer_ticks_left > 0
          AND (timer_tick_on = ? OR timer_tick_on = ?)`,
    args: [roomId, fullPath, shortPath],
  });
}

// ============ Timer renewal ============

/** Renew a wall-clock timer (reset expiry from now) */
export function renewTimer(timerJson: string | null): { expires_at: string } | null {
  if (!timerJson) return null;
  try {
    const timer = JSON.parse(timerJson);
    if (timer.ms) {
      return { expires_at: new Date(Date.now() + timer.ms).toISOString() };
    }
  } catch {}
  return null;
}
