/**
 * vault.ts — Token vault REST API and token resolution helpers.
 *
 * Provides the /vault HTTP endpoints and the resolveToken/resolveAdminToken
 * functions used by mcp.ts to build ToolContext.
 */

import * as db from "./db.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

// ─── Vault API ───────────────────────────────────────────────────

export async function handleVault(
  req: Request,
  userId: string,
): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean); // ["vault", ...]

  if (req.method === "GET") {
    const entries = await db.vaultList(userId);
    return json({
      entries: entries.map((e) => ({
        id: e.id,
        room_id: e.roomId,
        token_type: e.tokenType,
        label: e.label,
        is_default: e.isDefault,
        // Never expose the actual sync token in list view
        token_prefix: e.token.substring(0, 12) + "...",
      })),
    });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const { room_id, token, token_type, label, is_default } = body;
    if (!room_id || !token || !token_type) {
      return json({ error: "room_id, token, and token_type required" }, 400);
    }
    if (!["room", "agent", "view"].includes(token_type)) {
      return json({ error: "token_type must be room, agent, or view" }, 400);
    }
    const id = await db.vaultStore({
      userId,
      roomId: room_id,
      token,
      tokenType: token_type,
      label,
      isDefault: is_default,
    });
    return json({
      id,
      room_id,
      token_type,
      label,
      is_default: is_default ?? false,
    }, 201);
  }

  if (req.method === "DELETE" && pathParts.length >= 2) {
    const vaultId = pathParts[1];
    await db.vaultDelete(userId, vaultId);
    return json({ deleted: true, id: vaultId });
  }

  return json({ error: "Method not allowed" }, 405);
}

// ─── Token resolution for MCP tools ─────────────────────────────

export async function resolveToken(
  userId: string | null,
  room?: string,
  token?: string,
): Promise<{ room: string; token: string } | null> {
  // Explicit token always wins
  if (room && token) return { room, token };

  if (!userId) return null;

  // Room specified but no token → look up vault
  if (room) {
    const entries = await db.vaultGetForRoom(userId, room);
    console.log("resolveToken entries", entries);
    // Prefer agent token (identity) > room token (admin) > view token (read-only)
    const best = entries.find((e) => e.tokenType === "agent") ??
      entries.find((e) => e.tokenType === "room") ??
      entries[0];
    if (best) return { room, token: best.token };
    return null;
  }

  // No room, no token → use default
  const def = await db.vaultGetDefault(userId);
  console.log("resolveToken def", def);
  if (def) return { room: def.roomId, token: def.token };

  return null;
}

/** Resolve specifically the room (admin) token for a room. Used for privilege escalation
 *  when agent token gets scope_denied on shared-scope operations. */
export async function resolveAdminToken(
  userId: string | null,
  room: string,
): Promise<string | null> {
  if (!userId) return null;
  const entries = await db.vaultGetForRoom(userId, room);
  const roomEntry = entries.find((e) => e.tokenType === "room");
  return roomEntry?.token ?? null;
}
