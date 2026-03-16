/**
 * scope.ts — OAuth scope parsing and room-level access checking.
 *
 * v7: Extended scope language.
 *   rooms:{id}                  Full access (up to user's role)
 *   rooms:{id}:read             Read-only
 *   rooms:{id}:write            Read + write
 *   rooms:{id}:agent:{agent}    Bound to specific agent (implies write)
 *   rooms:{id}:admin            Admin operations
 *   rooms:{id}:observe          Observe-only (backward compat)
 *   rooms:*                     All rooms the user has access to
 *   rooms:*:read                All rooms, read-only
 *   create_rooms                Can create new rooms
 */

// ─── Types ──────────────────────────────────────────────────────

export interface ParsedScope {
  rooms: Map<string, RoomScope>;
  createRooms: boolean;
  /** If true, wildcard rooms:* was specified — applies to all rooms the user has access to */
  wildcardRooms: RoomScope | null;
}

export type ScopeLevel = "full" | "admin" | "write" | "read" | "observe";

export interface RoomScope {
  level: ScopeLevel;
  agent?: string;
  /** Multiple agent bindings for the same room (rooms:X:agent:A rooms:X:agent:B) */
  agents?: string[];
  /** v5 compat: role-based scope */
  role?: string;
}

/** The role hierarchy, from most to least privileged. */
const LEVEL_ORDER: ScopeLevel[] = ["full", "admin", "write", "read", "observe"];

/** Return the less privileged of two scope levels. */
export function minLevel(a: ScopeLevel, b: ScopeLevel): ScopeLevel {
  const ai = LEVEL_ORDER.indexOf(a);
  const bi = LEVEL_ORDER.indexOf(b);
  return ai >= bi ? a : b; // higher index = less privilege
}

/** Map user_rooms.role to a ScopeLevel for intersection. */
export function roleToLevel(role: string): ScopeLevel {
  switch (role) {
    case "owner": return "full";
    case "collaborator": return "write";
    case "participant": return "write";
    case "observer": return "read";
    default: return "read";
  }
}

/** Check if a scope level grants read access. */
export function canRead(level: ScopeLevel): boolean {
  return true; // all levels can read
}

/** Check if a scope level grants write access. */
export function canWrite(level: ScopeLevel): boolean {
  return level !== "read" && level !== "observe";
}

/** Check if a scope level grants admin access. */
export function canAdmin(level: ScopeLevel): boolean {
  return level === "full" || level === "admin";
}

// ─── Parsing ────────────────────────────────────────────────────

/** Parse scope string into structured form. */
export function parseScope(scope: string): ParsedScope {
  const result: ParsedScope = { rooms: new Map(), createRooms: false, wildcardRooms: null };
  for (const part of scope.split(/\s+/).filter(Boolean)) {
    if (part === "create_rooms") {
      result.createRooms = true;
      continue;
    }
    // Legacy: "sync:rooms" or "sync:rooms.admin" → broad access
    if (part === "sync:rooms" || part.startsWith("sync:")) {
      result.wildcardRooms = { level: "full" };
      result.createRooms = true;
      continue;
    }
    if (!part.startsWith("rooms:")) continue;

    const segments = part.split(":");
    const roomId = segments[1];
    if (!roomId) continue;

    // Wildcard: rooms:* or rooms:*:read etc.
    if (roomId === "*") {
      const modifier = segments[2];
      if (modifier === "read") {
        result.wildcardRooms = { level: "read" };
      } else if (modifier === "write") {
        result.wildcardRooms = { level: "write" };
      } else if (modifier === "observe") {
        result.wildcardRooms = { level: "observe" };
      } else {
        result.wildcardRooms = { level: "full" };
      }
      continue;
    }

    // Specific room
    const modifier = segments[2];
    if (modifier === "read") {
      result.rooms.set(roomId, { level: "read" });
    } else if (modifier === "write") {
      result.rooms.set(roomId, { level: "write" });
    } else if (modifier === "admin") {
      result.rooms.set(roomId, { level: "admin" });
    } else if (modifier === "observe") {
      result.rooms.set(roomId, { level: "observe" });
    } else if (modifier === "agent" && segments[3]) {
      const existing = result.rooms.get(roomId);
      if (existing?.agents) {
        // Accumulate: multiple agent bindings for same room
        existing.agents.push(segments[3]);
      } else if (existing?.agent) {
        // Second agent for this room — upgrade to agents array
        existing.agents = [existing.agent, segments[3]];
      } else {
        result.rooms.set(roomId, { level: "write", agent: segments[3], agents: [segments[3]] });
      }
    } else if (modifier === "role" && segments[3]) {
      // v5 backward compat
      result.rooms.set(roomId, { level: "write", role: segments[3] });
    } else {
      result.rooms.set(roomId, { level: "full" });
    }
  }
  return result;
}

/** Serialize a ParsedScope back to a scope string. */
export function serializeScope(parsed: ParsedScope): string {
  const parts: string[] = [];
  if (parsed.wildcardRooms) {
    if (parsed.wildcardRooms.level === "full") parts.push("rooms:*");
    else parts.push(`rooms:*:${parsed.wildcardRooms.level}`);
  }
  for (const [roomId, scope] of parsed.rooms) {
    if (scope.agents && scope.agents.length > 0) {
      for (const agentId of scope.agents) {
        parts.push(`rooms:${roomId}:agent:${agentId}`);
      }
    } else if (scope.agent) {
      parts.push(`rooms:${roomId}:agent:${scope.agent}`);
    } else if (scope.role) {
      parts.push(`rooms:${roomId}:role:${scope.role}`);
    } else if (scope.level === "full") {
      parts.push(`rooms:${roomId}`);
    } else {
      parts.push(`rooms:${roomId}:${scope.level}`);
    }
  }
  if (parsed.createRooms) parts.push("create_rooms");
  return parts.join(" ");
}

// ─── Room Matching ──────────────────────────────────────────────

export interface RoomMatch {
  level: ScopeLevel;
  agentId: string | null;
}

/** Match a room against this scope. Returns the granted level, or null if no access.
 *  When multiple agent bindings exist for the same room, agentId is null
 *  (let embodiment decide which agent to act as). */
export function matchRoom(parsed: ParsedScope, roomId: string): RoomMatch | null {
  const specific = parsed.rooms.get(roomId);
  if (specific) {
    // Multiple agents → don't bind to one, let embodiment decide
    const agentId = (specific.agents && specific.agents.length > 1)
      ? null
      : specific.agent ?? null;
    return { level: specific.level, agentId };
  }
  if (parsed.wildcardRooms) {
    return { level: parsed.wildcardRooms.level, agentId: null };
  }
  if (parsed.rooms.size === 0 && !parsed.wildcardRooms) {
    return { level: "full", agentId: null };
  }
  return null;
}

// ─── Access Checking (backward compat) ──────────────────────────

/** Check if level `have` is at least as privileged as `need`. */
export function levelCovers(have: ScopeLevel, need: ScopeLevel): boolean {
  return LEVEL_ORDER.indexOf(have) <= LEVEL_ORDER.indexOf(need);
}

/**
 * Check if `caller` scope fully subsumes `requested` scope.
 * A token can only mint/update sub-tokens within its own scope.
 *
 * Rules:
 * - requested.createRooms requires caller.createRooms
 * - requested wildcard requires caller wildcard at ≥ level
 * - each room in requested must be matched by caller (specific or wildcard) at ≥ level
 */
export function scopeSubsumes(
  caller: ParsedScope, requested: ParsedScope,
): { ok: true } | { ok: false; reason: string } {
  // create_rooms check
  if (requested.createRooms && !caller.createRooms) {
    return { ok: false, reason: "Caller token lacks create_rooms" };
  }

  // Wildcard check
  if (requested.wildcardRooms) {
    if (!caller.wildcardRooms) {
      return { ok: false, reason: "Caller token lacks wildcard room access" };
    }
    if (!levelCovers(caller.wildcardRooms.level, requested.wildcardRooms.level)) {
      return {
        ok: false,
        reason: `Caller wildcard is ${caller.wildcardRooms.level}, cannot grant ${requested.wildcardRooms.level}`,
      };
    }
  }

  // Per-room check
  for (const [roomId, reqScope] of requested.rooms) {
    // Find caller's level for this room
    const callerSpecific = caller.rooms.get(roomId);
    const callerLevel = callerSpecific?.level
      ?? caller.wildcardRooms?.level
      ?? null;

    if (callerLevel === null) {
      // Caller has no access to this room at all (and no wildcard)
      // But: if caller has an empty scope (no rooms, no wildcard), it means
      // the scope was not restricted — treat as full (legacy backward compat)
      if (caller.rooms.size === 0 && !caller.wildcardRooms) {
        continue; // unrestricted caller
      }
      return { ok: false, reason: `Caller token lacks access to room "${roomId}"` };
    }

    if (!levelCovers(callerLevel, reqScope.level)) {
      return {
        ok: false,
        reason: `Caller has ${callerLevel} on room "${roomId}", cannot grant ${reqScope.level}`,
      };
    }
  }

  return { ok: true };
}

/** Check if a scope grants access to a room at the required level. */
export function checkRoomInScope(
  parsed: ParsedScope, roomId: string,
  requiredLevel: "observe" | "embody" | "embody_role",
  role?: string,
): { allowed: boolean; reason?: string } {
  const match = matchRoom(parsed, roomId);

  // No match at all
  if (!match) {
    return { allowed: false, reason: "room_not_in_scope" };
  }

  if (requiredLevel === "observe") return { allowed: true };

  // observe/read can't embody
  if (match.level === "observe" || match.level === "read") {
    return { allowed: false, reason: "scope_read_only" };
  }

  if (requiredLevel === "embody_role") {
    const roomScope = parsed.rooms.get(roomId);
    if (roomScope?.role && roomScope.role !== role) {
      return { allowed: false, reason: "scope_role_mismatch" };
    }
  }

  return { allowed: true };
}
