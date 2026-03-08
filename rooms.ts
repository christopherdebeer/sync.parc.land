/**
 * rooms.ts — Room CRUD operations.
 *
 * Handles room creation, lookup, and listing.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { json, rows2objects } from "./utils.ts";
import { generateToken, hashToken } from "./auth.ts";

export async function createRoom(body: any) {
  const id = body.id ?? crypto.randomUUID();
  const meta = JSON.stringify(body.meta ?? {});
  const token = generateToken("room");
  const hash = await hashToken(token);
  const viewToken = generateToken("view");
  const viewHash = await hashToken(viewToken);
  try {
    await sqlite.execute({
      sql: `INSERT INTO rooms (id, meta, token_hash, view_token_hash) VALUES (?, ?, ?, ?)`,
      args: [id, meta, hash, viewHash],
    });
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint")) return json({ error: "room_exists", id }, 409);
    throw e;
  }
  const result = await sqlite.execute({ sql: `SELECT * FROM rooms WHERE id = ?`, args: [id] });
  const room = rows2objects(result)[0];
  delete room.token_hash;
  delete room.view_token_hash;

  // Dashboard reads views with render hints — no _dashboard config seeding needed.
  // Existing rooms with _dashboard state will continue to work (dashboard handles both).

  return json({ ...room, token, view_token: viewToken }, 201);
}

export async function getRoom(roomId: string) {
  const result = await sqlite.execute({ sql: `SELECT * FROM rooms WHERE id = ?`, args: [roomId] });
  const room = rows2objects(result)[0];
  if (!room) return json({ error: "room not found" }, 404);
  delete room.token_hash;
  delete room.view_token_hash;
  return json(room);
}

export async function listRooms(req: Request) {
  const header = req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return json({ error: "authentication_required", message: "include Authorization: Bearer <token> to list your rooms" }, 401);
  }
  const token = header.slice(7);
  const hash = await hashToken(token);

  const stripHashes = (r: any) => { delete r.token_hash; delete r.view_token_hash; return r; };

  // Check for room tokens matching any room
  if (token.startsWith("room_")) {
    const result = await sqlite.execute({
      sql: `SELECT * FROM rooms WHERE token_hash = ?`, args: [hash],
    });
    return json(rows2objects(result).map(stripHashes));
  }

  // Check for view tokens matching any room
  if (token.startsWith("view_")) {
    const result = await sqlite.execute({
      sql: `SELECT * FROM rooms WHERE view_token_hash = ?`, args: [hash],
    });
    return json(rows2objects(result).map(stripHashes));
  }

  // Agent token: find rooms this agent is in
  const agentResult = await sqlite.execute({
    sql: `SELECT room_id FROM agents WHERE token_hash = ?`, args: [hash],
  });
  if (agentResult.rows.length === 0) return json({ error: "invalid_token" }, 401);
  const roomIds = agentResult.rows.map((r: any[]) => r[0]);
  const placeholders = roomIds.map(() => "?").join(",");
  const result = await sqlite.execute({
    sql: `SELECT * FROM rooms WHERE id IN (${placeholders}) ORDER BY created_at DESC`,
    args: roomIds,
  });
  return json(rows2objects(result).map(stripHashes));
}

// ── View token rotation ──

export async function rotateViewToken(roomId: string) {
  const viewToken = generateToken("view");
  const viewHash = await hashToken(viewToken);
  const result = await sqlite.execute({
    sql: `UPDATE rooms SET view_token_hash = ? WHERE id = ?`,
    args: [viewHash, roomId],
  });
  if (result.rowsAffected === 0) return json({ error: "room not found" }, 404);
  return json({ ok: true, view_token: viewToken });
}
