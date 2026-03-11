/**
 * scope.ts — OAuth scope parsing and room-level access checking.
 *
 * Pure functions with no DB dependency. Extracted from db.ts
 * because they're used by mcp.ts, tools.ts, and tool-context.ts
 * without needing any database operations.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface ParsedScope {
  rooms: Map<string, RoomScope>;
  createRooms: boolean;
}

export interface RoomScope {
  level: "full" | "observe" | "role";
  role?: string;
}

// ─── Parsing ────────────────────────────────────────────────────

/** Parse OAuth scope string into structured form.
 *  Format: "rooms:X rooms:Y:role:Z rooms:W:observe create_rooms" */
export function parseScope(scope: string): ParsedScope {
  const result: ParsedScope = { rooms: new Map(), createRooms: false };
  for (const part of scope.split(/\s+/).filter(Boolean)) {
    if (part === "create_rooms") {
      result.createRooms = true;
    } else if (part.startsWith("rooms:")) {
      const segments = part.split(":");
      const roomId = segments[1];
      if (!roomId) continue;
      if (segments[2] === "observe") {
        result.rooms.set(roomId, { level: "observe" });
      } else if (segments[2] === "role" && segments[3]) {
        result.rooms.set(roomId, { level: "role", role: segments[3] });
      } else {
        result.rooms.set(roomId, { level: "full" });
      }
    }
    // Legacy: "sync:rooms" or "sync:rooms.admin" → broad access (no room restriction)
  }
  return result;
}

/** Serialize a ParsedScope back to a scope string. */
export function serializeScope(parsed: ParsedScope): string {
  const parts: string[] = [];
  for (const [roomId, scope] of parsed.rooms) {
    if (scope.level === "observe") parts.push(`rooms:${roomId}:observe`);
    else if (scope.level === "role") parts.push(`rooms:${roomId}:role:${scope.role}`);
    else parts.push(`rooms:${roomId}`);
  }
  if (parsed.createRooms) parts.push("create_rooms");
  return parts.join(" ");
}

// ─── Access Checking ────────────────────────────────────────────

/** Check if a scope grants access to a room at the required level. */
export function checkRoomInScope(
  parsed: ParsedScope, roomId: string,
  requiredLevel: "observe" | "embody" | "embody_role",
  role?: string,
): { allowed: boolean; reason?: string } {
  const roomScope = parsed.rooms.get(roomId);

  // No room-level grants AND no rooms in scope → legacy broad scope, defer to user_rooms
  if (!roomScope && parsed.rooms.size === 0) {
    return { allowed: true };
  }

  if (!roomScope) {
    return { allowed: false, reason: "room_not_in_scope" };
  }

  if (requiredLevel === "observe") return { allowed: true };

  if (roomScope.level === "observe") {
    return { allowed: false, reason: "scope_observe_only" };
  }

  if (requiredLevel === "embody_role" && roomScope.level === "role") {
    if (roomScope.role !== role) {
      return { allowed: false, reason: "scope_role_mismatch" };
    }
  }

  return { allowed: true };
}
