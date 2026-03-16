/**
 * rooms.ts — Room CRUD operations.
 *
 * v7: Room creation auto-links to user_rooms when caller has user identity.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { json, rows2objects } from "./utils.ts";
import { generateToken, hashToken, type AuthResult } from "./auth.ts";

export async function createRoom(body: any, auth?: AuthResult) {
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

  // v7: Auto-link to user_rooms when caller has user identity
  const userId = auth?.userId;
  if (userId) {
    try {
      await sqlite.execute({
        sql: `INSERT OR IGNORE INTO smcp_user_rooms (user_id, room_id, access, label)
              VALUES (?, ?, 'owner', ?)`,
        args: [userId, id, body.label ?? `Room: ${id}`],
      });
    } catch (_) { /* best-effort — don't fail room creation */ }
  }

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

  // v7: Check unified tokens table for tok_ tokens
  if (token.startsWith("tok_")) {
    // Import hashTokenB64 inline to avoid circular dep
    const data = new TextEncoder().encode(token);
    const hashBuf = await crypto.subtle.digest("SHA-256", data);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(hashBuf)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

    const tokenResult = await sqlite.execute({
      sql: `SELECT minted_by FROM tokens WHERE token_hash = ? AND revoked = 0
            AND (expires_at IS NULL OR expires_at > datetime('now'))`,
      args: [b64],
    });
    if (tokenResult.rows.length > 0) {
      const userId = tokenResult.rows[0][0] as string;
      const userRooms = await sqlite.execute({
        sql: `SELECT room_id FROM smcp_user_rooms WHERE user_id = ?`,
        args: [userId],
      });
      const roomIds = userRooms.rows.map((r: any[]) => r[0] as string);
      if (roomIds.length === 0) return json([]);
      const placeholders = roomIds.map(() => "?").join(",");
      const result = await sqlite.execute({
        sql: `SELECT * FROM rooms WHERE id IN (${placeholders}) ORDER BY created_at DESC`,
        args: roomIds,
      });
      return json(rows2objects(result).map(stripHashes));
    }
  }

  // Legacy: Check room tokens
  if (token.startsWith("room_")) {
    const result = await sqlite.execute({
      sql: `SELECT * FROM rooms WHERE token_hash = ?`, args: [hash],
    });
    return json(rows2objects(result).map(stripHashes));
  }

  // Legacy: Check view tokens
  if (token.startsWith("view_")) {
    const result = await sqlite.execute({
      sql: `SELECT * FROM rooms WHERE view_token_hash = ?`, args: [hash],
    });
    return json(rows2objects(result).map(stripHashes));
  }

  // v8: Agent token — check tokens table
  const agentResult = await sqlite.execute({
    sql: `SELECT room_id FROM tokens WHERE token_hash = ? AND revoked = 0`, args: [hash],
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
