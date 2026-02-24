/* Open in Val Town: https://www.val.town/x/c15r/agent-sync/code/main.ts */
import { sqlite } from "https://esm.town/v/std/sqlite";
import { migrate } from "./schema.ts";
import { dashboardHTML } from "./dashboard.ts";
import { buildContext, evalCel, evalCelWithParams, validateCel } from "./cel.ts";
import { isTimerLive, parseTimer, tickLogicalTimers, validateTimer, renewTimer } from "./timers.ts";
import { evaluate } from "npm:@marcbachmann/cel-js";

const README_URL = new URL("./README.md", import.meta.url);
const README = await fetch(README_URL).then((r) => r.text());
const REFERENCE_FILES = {};
for (const name of ["api.md", "cel.md", "examples.md"]) {
  const refUrl = new URL(`./reference/${name}`, import.meta.url);
  REFERENCE_FILES[name] = await fetch(refUrl).then((r) => r.text());
}
let migrated = false;
async function ensureMigrated() {
  if (!migrated) {
    await migrate();
    migrated = true;
  }
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function rows2objects(result) {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((col, i) => [col, row[i]]))
  );
}
const PARSE_FAILED = Symbol("parse_failed");
async function parseBody(req) {
  const text = await req.text();
  if (!text || text.trim() === "") return {};
  try { return JSON.parse(text); } catch { return PARSE_FAILED; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============ Authentication ============
async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "as_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function resolveAuth(req, roomId) {
  const header = req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return { authenticated: false, agentId: null };
  }
  const token = header.slice(7);
  const hash = await hashToken(token);
  const result = await sqlite.execute({
    sql: `SELECT id FROM agents WHERE token_hash = ? AND room_id = ?`,
    args: [hash, roomId],
  });
  if (result.rows.length === 0) {
    return json({ error: "invalid_token", message: "bearer token does not match any agent in this room" }, 401);
  }
  return { authenticated: true, agentId: result.rows[0][0], roomId };
}
function assertIdentity(auth, claimedAgent) {
  if (!auth.authenticated) return null;
  if (!claimedAgent) return null;
  if (auth.agentId === claimedAgent) return null;
  return json({
    error: "identity_mismatch",
    message: `token belongs to "${auth.agentId}" but request claims "${claimedAgent}"`,
    authenticated_as: auth.agentId,
    claimed: claimedAgent,
  }, 403);
}

// ============ Auto-heartbeat ============
function touchAgent(roomId, agentId) {
  if (!agentId) return;
  sqlite.execute({
    sql: `UPDATE agents SET last_heartbeat = datetime('now')
          WHERE id = ? AND room_id = ? AND status != 'done'`,
    args: [agentId, roomId],
  }).catch(() => {});
}

// ============ Room handlers ============
async function createRoom(body) {
  const id = body.id ?? crypto.randomUUID();
  const meta = JSON.stringify(body.meta ?? {});
  try {
    await sqlite.execute({ sql: `INSERT INTO rooms (id, meta) VALUES (?, ?)`, args: [id, meta] });
  } catch (e) {
    if (e.message?.includes("UNIQUE constraint")) return json({ error: "room_exists", id }, 409);
    throw e;
  }
  const result = await sqlite.execute({ sql: `SELECT * FROM rooms WHERE id = ?`, args: [id] });
  return json(rows2objects(result)[0], 201);
}
async function getRoom(roomId) {
  const result = await sqlite.execute({ sql: `SELECT * FROM rooms WHERE id = ?`, args: [roomId] });
  const room = rows2objects(result)[0];
  if (!room) return json({ error: "room not found" }, 404);
  return json(room);
}
async function listRooms(req) {
  const header = req.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return json({ error: "authentication_required", message: "include Authorization: Bearer <token> to list your rooms" }, 401);
  }
  const token = header.slice(7);
  const hash = await hashToken(token);
  const agentResult = await sqlite.execute({ sql: `SELECT id FROM agents WHERE token_hash = ?`, args: [hash] });
  if (agentResult.rows.length === 0) return json({ error: "invalid_token" }, 401);
  const agentId = agentResult.rows[0][0];
  const result = await sqlite.execute({
    sql: `SELECT r.* FROM rooms r INNER JOIN agents a ON a.room_id = r.id WHERE a.id = ? ORDER BY r.created_at DESC`,
    args: [agentId],
  });
  return json(rows2objects(result));
}

// ============ Agent handlers ============
async function joinRoom(roomId, body, req) {
  const id = body.id ?? crypto.randomUUID();
  const name = body.name ?? "anonymous";
  const role = body.role ?? "agent";
  const meta = JSON.stringify(body.meta ?? {});
  const enabled_expr = body.enabled ?? null;
  const token = generateToken();
  const hash = await hashToken(token);

  // Validate enabled expression if provided
  if (enabled_expr) {
    const v = validateCel(enabled_expr);
    if (!v.valid) return json({ error: "invalid_cel", field: "enabled", expression: enabled_expr, detail: v.error }, 400);
  }

  const existing = await sqlite.execute({
    sql: `SELECT id, token_hash FROM agents WHERE id = ? AND room_id = ?`,
    args: [id, roomId],
  });
  if (existing.rows.length > 0) {
    const existingHash = existing.rows[0][1];
    if (existingHash) {
      const header = req.headers.get("Authorization");
      if (!header || !header.startsWith("Bearer ")) {
        return json({ error: "agent_exists", message: `agent "${id}" already registered — include Authorization: Bearer <token> to re-join`, agent: id }, 409);
      }
      const callerHash = await hashToken(header.slice(7));
      if (callerHash !== existingHash) {
        return json({ error: "invalid_token", message: `token does not match agent "${id}" — cannot re-join`, agent: id }, 401);
      }
    }
  }
  await sqlite.execute({
    sql: `INSERT OR REPLACE INTO agents (id, room_id, name, role, meta, last_heartbeat, status, token_hash, enabled_expr)
          VALUES (?, ?, ?, ?, ?, datetime('now'), 'active', ?, ?)`,
    args: [id, roomId, name, role, meta, hash, enabled_expr],
  });
  const result = await sqlite.execute({
    sql: `SELECT * FROM agents WHERE id = ? AND room_id = ?`,
    args: [id, roomId],
  });
  const agent = rows2objects(result)[0];
  delete agent.token_hash;
  return json({ ...agent, token }, 201);
}
async function listAgents(roomId, selfAgent?) {
  const result = await sqlite.execute({
    sql: `SELECT * FROM agents WHERE room_id = ? ORDER BY joined_at`,
    args: [roomId],
  });
  let agents = rows2objects(result);

  // Filter by enabled expressions
  const ctx = selfAgent ? await buildContext(roomId, selfAgent) : null;
  agents = agents.filter(a => {
    if (!a.enabled_expr) return true;
    if (!ctx) return true;
    try {
      return !!evaluate(a.enabled_expr, ctx);
    } catch { return false; }
  });

  return json(agents.map((a) => {
    delete a.token_hash;
    return a;
  }));
}
async function heartbeat(roomId, agentId, body) {
  const status = body.status ?? "active";
  const result = await sqlite.execute({
    sql: `UPDATE agents SET last_heartbeat = datetime('now'), status = ?
          WHERE id = ? AND room_id = ?`,
    args: [status, agentId, roomId],
  });
  if (result.rowsAffected === 0) return json({ error: "agent not found", agent: agentId, room: roomId }, 404);
  return json({ ok: true, agent: agentId, status, heartbeat: new Date().toISOString() });
}

// ============ Message handlers ============
function msgToApi(row) {
  const out = { ...row };
  out.id = out.seq;
  delete out.seq;
  return out;
}
async function postMessage(roomId, body) {
  const from_agent = body.from ?? null;
  const to_agent = body.to ?? null;
  const kind = body.kind ?? "message";
  const reply_to = body.reply_to ?? null;
  const msgBody = typeof body.body === "string" ? body.body : JSON.stringify(body.body);
  const enabled_expr = body.enabled ?? null;

  // Validate enabled expression
  if (enabled_expr) {
    const v = validateCel(enabled_expr);
    if (!v.valid) return json({ error: "invalid_cel", field: "enabled", expression: enabled_expr, detail: v.error }, 400);
  }

  // Validate and parse timer
  let timerCols = { timer_json: null, timer_expires_at: null, timer_ticks_left: null, timer_tick_on: null, timer_effect: null, timer_started_at: null };
  if (body.timer) {
    const tv = validateTimer(body.timer);
    if (!tv.valid) return json({ error: "invalid_timer", detail: tv.error }, 400);
    timerCols = parseTimer(body.timer);
  }

  if (reply_to !== null) {
    const parent = await sqlite.execute({
      sql: `SELECT seq FROM messages WHERE seq = ? AND room_id = ?`,
      args: [reply_to, roomId],
    });
    if (parent.rows.length === 0) return json({ error: `reply_to message ${reply_to} not found` }, 400);
  }
  touchAgent(roomId, from_agent);
  await sqlite.execute({
    sql: `INSERT INTO messages (room_id, from_agent, to_agent, kind, body, reply_to, seq,
            enabled_expr, timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
          VALUES (?, ?, ?, ?, ?, ?,
            (SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE room_id = ?),
            ?, ?, ?, ?, ?, ?, ?)`,
    args: [roomId, from_agent, to_agent, kind, msgBody, reply_to, roomId,
           enabled_expr, timerCols.timer_json, timerCols.timer_expires_at, timerCols.timer_ticks_left,
           timerCols.timer_tick_on, timerCols.timer_effect, timerCols.timer_started_at],
  });
  const result = await sqlite.execute({
    sql: `SELECT * FROM messages WHERE room_id = ? ORDER BY seq DESC LIMIT 1`,
    args: [roomId],
  });
  return json(msgToApi(rows2objects(result)[0]), 201);
}
async function getMessages(roomId, url) {
  const after = url.searchParams.get("after");
  const kind = url.searchParams.get("kind");
  const thread = url.searchParams.get("thread");
  const unclaimed = url.searchParams.get("unclaimed");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 500);
  let sql = `SELECT * FROM messages WHERE room_id = ?`;
  const args: any[] = [roomId];
  if (after) { sql += ` AND seq > ?`; args.push(parseInt(after)); }
  if (kind) { sql += ` AND kind = ?`; args.push(kind); }
  if (from) { sql += ` AND from_agent = ?`; args.push(from); }
  if (to) { sql += ` AND to_agent = ?`; args.push(to); }
  if (thread) { sql += ` AND (seq = ? OR reply_to = ?)`; args.push(parseInt(thread), parseInt(thread)); }
  if (unclaimed === "true") { sql += ` AND claimed_by IS NULL`; }
  sql += ` ORDER BY seq ASC LIMIT ?`;
  args.push(limit);
  const result = await sqlite.execute({ sql, args });
  let rows = rows2objects(result);

  // Filter by timer and enabled
  const ctx = await buildContext(roomId);
  rows = rows.filter(row => {
    if (!isTimerLive(row)) return false;
    if (row.enabled_expr) {
      try {
        return !!evaluate(row.enabled_expr, ctx);
      } catch { return false; }
    }
    return true;
  });

  return json(rows.map(msgToApi));
}
async function claimMessage(roomId, msgSeq, body) {
  const agent = body.agent;
  if (!agent) return json({ error: "agent is required" }, 400);
  touchAgent(roomId, agent);
  const result = await sqlite.execute({
    sql: `UPDATE messages SET claimed_by = ?, claimed_at = datetime('now')
          WHERE seq = ? AND room_id = ? AND claimed_by IS NULL`,
    args: [agent, parseInt(msgSeq), roomId],
  });
  if (result.rowsAffected === 0) {
    const current = await sqlite.execute({
      sql: `SELECT claimed_by, claimed_at FROM messages WHERE seq = ? AND room_id = ?`,
      args: [parseInt(msgSeq), roomId],
    });
    const row = rows2objects(current)[0];
    if (!row) return json({ error: "message not found" }, 404);
    return json({ claimed: false, claimed_by: row.claimed_by, claimed_at: row.claimed_at }, 409);
  }
  return json({ claimed: true, claimed_by: agent, message_id: parseInt(msgSeq) });
}

// ============ State handlers ============
async function setState(roomId, body) {
  const scope = body.scope ?? "_shared";
  const key = body.key;
  const increment = body.increment === true;
  if (!key) return json({ error: "key is required" }, 400);

  // Validate enabled expression
  if (body.enabled) {
    const v = validateCel(body.enabled);
    if (!v.valid) return json({ error: "invalid_cel", field: "enabled", expression: body.enabled, detail: v.error }, 400);
  }

  // Validate timer
  let timerCols = parseTimer(null);
  if (body.timer) {
    const tv = validateTimer(body.timer);
    if (!tv.valid) return json({ error: "invalid_timer", detail: tv.error }, 400);
    timerCols = parseTimer(body.timer);
  }

  const impliedAgent = body.agent ?? (scope !== "_shared" && scope !== "_view" ? scope : null);
  touchAgent(roomId, impliedAgent);

  // CEL write gate
  if (body.if) {
    if (typeof body.if !== "string") return json({ error: "if must be a CEL expression string" }, 400);
    const celResult = await evalCel(roomId, body.if);
    if (!celResult.ok) return json({ error: "cel_error", expression: body.if, detail: celResult.error }, 400);
    if (!celResult.value) return json({ error: "precondition_failed", expression: body.if, evaluated: celResult.value }, 409);
  }

  // Computed view
  if (scope === "_view" && body.expr) {
    const validation = validateCel(body.expr);
    if (!validation.valid) return json({ error: "invalid_cel", expression: body.expr, detail: validation.error }, 400);
    const value = JSON.stringify({ _cel_expr: body.expr });
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, value, version, updated_at, enabled_expr,
              timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
            VALUES (?, '_view', ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(room_id, scope, key) DO UPDATE SET
              value = excluded.value, version = version + 1, updated_at = datetime('now'),
              enabled_expr = excluded.enabled_expr,
              timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
              timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
              timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
      args: [roomId, key, value, body.enabled ?? null,
             timerCols.timer_json, timerCols.timer_expires_at, timerCols.timer_ticks_left,
             timerCols.timer_tick_on, timerCols.timer_effect, timerCols.timer_started_at],
    });
    const ctx = await buildContext(roomId);
    const resolved = ctx.state?._view?.[key];
    const result = await sqlite.execute({
      sql: `SELECT * FROM state WHERE room_id = ? AND scope = '_view' AND key = ?`,
      args: [roomId, key],
    });
    const row = rows2objects(result)[0];
    return json({ ...row, resolved_value: resolved });
  }

  // Build the enabled and timer args
  const enabledExpr = body.enabled ?? null;
  const timerArgs = [timerCols.timer_json, timerCols.timer_expires_at, timerCols.timer_ticks_left,
                     timerCols.timer_tick_on, timerCols.timer_effect, timerCols.timer_started_at];

  // CAS + increment logic (same as before, with timer/enabled columns)
  if (body.if_version !== undefined) {
    const expected = parseInt(body.if_version);
    if (increment) {
      const result = await sqlite.execute({
        sql: `UPDATE state SET value = CAST(CAST(value AS INTEGER) + CAST(? AS INTEGER) AS TEXT),
              version = version + 1, updated_at = datetime('now'),
              enabled_expr = COALESCE(?, enabled_expr),
              timer_json = COALESCE(?, timer_json), timer_expires_at = COALESCE(?, timer_expires_at),
              timer_ticks_left = COALESCE(?, timer_ticks_left), timer_tick_on = COALESCE(?, timer_tick_on),
              timer_effect = COALESCE(?, timer_effect), timer_started_at = COALESCE(?, timer_started_at)
              WHERE room_id = ? AND scope = ? AND key = ? AND version = ?`,
        args: [String(body.value ?? 1), enabledExpr, ...timerArgs, roomId, scope, key, expected],
      });
      if (result.rowsAffected === 0) {
        const current = await sqlite.execute({
          sql: `SELECT * FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [roomId, scope, key],
        });
        const row = rows2objects(current)[0];
        return json({ error: "version_conflict", expected_version: expected, current: row ?? null }, 409);
      }
    } else {
      const value = typeof body.value === "string" ? body.value : JSON.stringify(body.value);
      const result = await sqlite.execute({
        sql: `UPDATE state SET value = ?, version = version + 1, updated_at = datetime('now'),
              enabled_expr = ?, timer_json = ?, timer_expires_at = ?, timer_ticks_left = ?,
              timer_tick_on = ?, timer_effect = ?, timer_started_at = ?
              WHERE room_id = ? AND scope = ? AND key = ? AND version = ?`,
        args: [value, enabledExpr, ...timerArgs, roomId, scope, key, expected],
      });
      if (result.rowsAffected === 0) {
        const current = await sqlite.execute({
          sql: `SELECT * FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [roomId, scope, key],
        });
        const row = rows2objects(current)[0];
        if (row) return json({ error: "version_conflict", expected_version: expected, current: row }, 409);
        if (expected !== 0) return json({ error: "not_found", message: "key does not exist, use if_version=0 to create" }, 404);
        await sqlite.execute({
          sql: `INSERT INTO state (room_id, scope, key, value, version, updated_at, enabled_expr,
                  timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
                VALUES (?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
          args: [roomId, scope, key, value, enabledExpr, ...timerArgs],
        });
      }
    }
  } else if (increment) {
    const existing = await sqlite.execute({
      sql: `SELECT version FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
      args: [roomId, scope, key],
    });
    if (existing.rows.length > 0) {
      await sqlite.execute({
        sql: `UPDATE state SET value = CAST(CAST(value AS INTEGER) + CAST(? AS INTEGER) AS TEXT),
              version = version + 1, updated_at = datetime('now'),
              enabled_expr = COALESCE(?, enabled_expr),
              timer_json = COALESCE(?, timer_json), timer_expires_at = COALESCE(?, timer_expires_at),
              timer_ticks_left = COALESCE(?, timer_ticks_left), timer_tick_on = COALESCE(?, timer_tick_on),
              timer_effect = COALESCE(?, timer_effect), timer_started_at = COALESCE(?, timer_started_at)
              WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [String(body.value ?? 1), enabledExpr, ...timerArgs, roomId, scope, key],
      });
    } else {
      await sqlite.execute({
        sql: `INSERT INTO state (room_id, scope, key, value, version, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
        args: [roomId, scope, key, String(body.value ?? 1), enabledExpr, ...timerArgs],
      });
    }
  } else {
    const value = typeof body.value === "string" ? body.value : JSON.stringify(body.value);
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, value, version, updated_at, enabled_expr,
              timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
            VALUES (?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(room_id, scope, key) DO UPDATE SET
              value = excluded.value, version = version + 1, updated_at = datetime('now'),
              enabled_expr = excluded.enabled_expr,
              timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
              timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
              timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
      args: [roomId, scope, key, value, enabledExpr, ...timerArgs],
    });
  }

  // Tick logical timers watching this key
  await tickLogicalTimers(roomId, scope, key);

  const result = await sqlite.execute({
    sql: `SELECT * FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
    args: [roomId, scope, key],
  });
  return json(rows2objects(result)[0]);
}

// Atomic batch writes
async function batchSetState(roomId, body) {
  const writes = body.writes;
  if (!Array.isArray(writes) || writes.length === 0) return json({ error: "writes array is required" }, 400);
  if (writes.length > 20) return json({ error: "max 20 writes per batch" }, 400);

  if (body.agent) { touchAgent(roomId, body.agent); }
  else {
    const agentScopes = new Set(writes.map((w) => w.scope).filter((s) => s && s !== "_shared" && s !== "_view"));
    for (const scope of agentScopes) touchAgent(roomId, scope);
  }

  // CEL write gate
  if (body.if) {
    if (typeof body.if !== "string") return json({ error: "if must be a CEL expression string" }, 400);
    const celResult = await evalCel(roomId, body.if);
    if (!celResult.ok) return json({ error: "cel_error", expression: body.if, detail: celResult.error }, 400);
    if (!celResult.value) return json({ error: "precondition_failed", expression: body.if, evaluated: celResult.value }, 409);
  }

  const statements = [];
  const tickKeys: { scope: string; key: string }[] = [];

  for (const w of writes) {
    const scope = w.scope ?? "_shared";
    const key = w.key;
    if (!key) return json({ error: "each write needs a key" }, 400);

    let timerCols = parseTimer(null);
    if (w.timer) {
      const tv = validateTimer(w.timer);
      if (!tv.valid) return json({ error: "invalid_timer", key, detail: tv.error }, 400);
      timerCols = parseTimer(w.timer);
    }
    const enabledExpr = w.enabled ?? null;
    const timerArgs = [timerCols.timer_json, timerCols.timer_expires_at, timerCols.timer_ticks_left,
                       timerCols.timer_tick_on, timerCols.timer_effect, timerCols.timer_started_at];

    tickKeys.push({ scope, key });

    if (w.increment === true) {
      const existing = await sqlite.execute({
        sql: `SELECT version FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [roomId, scope, key],
      });
      if (existing.rows.length > 0) {
        statements.push({
          sql: `UPDATE state SET value = CAST(CAST(value AS INTEGER) + CAST(? AS INTEGER) AS TEXT),
                version = version + 1, updated_at = datetime('now'),
                enabled_expr = COALESCE(?, enabled_expr),
                timer_json = COALESCE(?, timer_json), timer_expires_at = COALESCE(?, timer_expires_at),
                timer_ticks_left = COALESCE(?, timer_ticks_left), timer_tick_on = COALESCE(?, timer_tick_on),
                timer_effect = COALESCE(?, timer_effect), timer_started_at = COALESCE(?, timer_started_at)
                WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [String(w.value ?? 1), enabledExpr, ...timerArgs, roomId, scope, key],
        });
      } else {
        statements.push({
          sql: `INSERT INTO state (room_id, scope, key, value, version, updated_at, enabled_expr,
                  timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
                VALUES (?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
          args: [roomId, scope, key, String(w.value ?? 1), enabledExpr, ...timerArgs],
        });
      }
    } else {
      const value = typeof w.value === "string" ? w.value : JSON.stringify(w.value);
      if (w.if_version !== undefined) {
        const expected = parseInt(w.if_version);
        if (expected === 0) {
          statements.push({
            sql: `INSERT INTO state (room_id, scope, key, value, version, updated_at, enabled_expr,
                    timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
                  VALUES (?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
            args: [roomId, scope, key, value, enabledExpr, ...timerArgs],
          });
        } else {
          statements.push({
            sql: `UPDATE state SET value = ?, version = version + 1, updated_at = datetime('now'),
                  enabled_expr = ?, timer_json = ?, timer_expires_at = ?, timer_ticks_left = ?,
                  timer_tick_on = ?, timer_effect = ?, timer_started_at = ?
                  WHERE room_id = ? AND scope = ? AND key = ? AND version = ?`,
            args: [value, enabledExpr, ...timerArgs, roomId, scope, key, expected],
          });
        }
      } else {
        statements.push({
          sql: `INSERT INTO state (room_id, scope, key, value, version, updated_at, enabled_expr,
                  timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
                VALUES (?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(room_id, scope, key) DO UPDATE SET
                  value = excluded.value, version = version + 1, updated_at = datetime('now'),
                  enabled_expr = excluded.enabled_expr,
                  timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                  timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                  timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
          args: [roomId, scope, key, value, enabledExpr, ...timerArgs],
        });
      }
    }
  }

  await sqlite.batch(statements);

  // Tick logical timers for all written keys
  for (const tk of tickKeys) {
    await tickLogicalTimers(roomId, tk.scope, tk.key);
  }

  const keys = writes.map((w) => ({ scope: w.scope ?? "_shared", key: w.key }));
  const results = [];
  for (const k of keys) {
    const result = await sqlite.execute({
      sql: `SELECT * FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
      args: [roomId, k.scope, k.key],
    });
    const row = rows2objects(result)[0];
    if (row) results.push(row);
  }
  return json({ ok: true, count: results.length, state: results });
}

async function getState(roomId, url) {
  const scope = url.searchParams.get("scope");
  const key = url.searchParams.get("key");
  const resolve = url.searchParams.get("resolve");
  const raw = url.searchParams.get("raw");
  let sql = `SELECT * FROM state WHERE room_id = ?`;
  const args: any[] = [roomId];
  if (scope) { sql += ` AND scope = ?`; args.push(scope); }
  if (key) { sql += ` AND key = ?`; args.push(key); }
  sql += ` ORDER BY updated_at DESC`;
  const result = await sqlite.execute({ sql, args });
  let rows = rows2objects(result);

  // Filter by timer liveness
  rows = rows.filter(row => isTimerLive(row));

  // Filter by enabled expressions
  const ctx = await buildContext(roomId);
  rows = rows.filter(row => {
    if (!row.enabled_expr) return true;
    try {
      return !!evaluate(row.enabled_expr, ctx);
    } catch { return false; }
  });

  // Parse values (unless raw=true)
  if (raw !== "true") {
    rows = rows.map((row) => {
      if (row.scope === "_view") {
        try {
          const val = JSON.parse(row.value);
          if (val && val._cel_expr) {
            if (resolve === "true") return { ...row, value: val, _needs_resolve: true };
            return { ...row, value: val };
          }
        } catch {}
      }
      try {
        const parsed = JSON.parse(row.value);
        return { ...row, value: parsed };
      } catch { return row; }
    });
  }

  // Resolve computed views if requested
  if (resolve === "true") {
    rows = rows.map((row) => {
      if (row.scope === "_view" || row._needs_resolve) {
        const val = typeof row.value === "object" && row.value?._cel_expr ? row.value : null;
        if (val) {
          const resolved = ctx.state?._view?.[row.key];
          const out = { ...row, resolved_value: resolved, expr: val._cel_expr };
          delete out._needs_resolve;
          return out;
        }
      }
      return row;
    });
  }

  if (scope && key) {
    const obj = rows[0];
    return obj ? json(obj) : json({ error: "not found" }, 404);
  }
  return json(rows);
}

async function deleteState(roomId, body) {
  const scope = body.scope ?? "_shared";
  const key = body.key;
  if (!key) return json({ error: "key is required" }, 400);
  await sqlite.execute({
    sql: `DELETE FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
    args: [roomId, scope, key],
  });
  return json({ deleted: true });
}

// ============ Timer renewal endpoint ============
async function renewStateTimer(roomId, body) {
  const scope = body.scope ?? "_shared";
  const key = body.key;
  if (!key) return json({ error: "key is required" }, 400);

  const existing = await sqlite.execute({
    sql: `SELECT timer_json FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
    args: [roomId, scope, key],
  });
  const row = rows2objects(existing)[0];
  if (!row) return json({ error: "not found" }, 404);

  const renewal = renewTimer(row.timer_json);
  if (!renewal) return json({ error: "no wall-clock timer to renew" }, 400);

  await sqlite.execute({
    sql: `UPDATE state SET timer_expires_at = ?, timer_started_at = datetime('now')
          WHERE room_id = ? AND scope = ? AND key = ?`,
    args: [renewal.expires_at, roomId, scope, key],
  });

  const updated = await sqlite.execute({
    sql: `SELECT * FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
    args: [roomId, scope, key],
  });
  return json(rows2objects(updated)[0]);
}

// ============ Actions handlers ============
async function registerAction(roomId, body, auth) {
  const id = body.id;
  if (!id) return json({ error: "id is required" }, 400);

  const scope = body.scope ?? "_shared";

  // If scope is an agent ID, enforce ownership via token
  if (scope !== "_shared") {
    if (!auth.authenticated) {
      return json({ error: "authentication_required", message: `scoped actions require a bearer token — scope "${scope}" requires authentication as that agent` }, 401);
    }
    if (auth.agentId !== scope) {
      return json({ error: "identity_mismatch", message: `action scope "${scope}" requires authentication as "${scope}", but token belongs to "${auth.agentId}"`, authenticated_as: auth.agentId, scope }, 403);
    }
  }

  // Check existing action scope ownership on update
  const existing = await sqlite.execute({
    sql: `SELECT scope FROM actions WHERE id = ? AND room_id = ?`,
    args: [id, roomId],
  });
  if (existing.rows.length > 0) {
    const existingScope = existing.rows[0][0] ?? "_shared";
    if (existingScope !== "_shared") {
      if (!auth.authenticated || auth.agentId !== existingScope) {
        return json({ error: "action_owned", message: `action "${id}" is owned by scope "${existingScope}" — only that agent can update it`, owner: existingScope }, 403);
      }
    }
  }

  // Validate expressions
  if (body.if) {
    const v = validateCel(body.if);
    if (!v.valid) return json({ error: "invalid_cel", field: "if", expression: body.if, detail: v.error }, 400);
  }
  if (body.enabled) {
    const v = validateCel(body.enabled);
    if (!v.valid) return json({ error: "invalid_cel", field: "enabled", expression: body.enabled, detail: v.error }, 400);
  }

  // Validate timer
  let timerCols = parseTimer(null);
  if (body.timer) {
    const tv = validateTimer(body.timer);
    if (!tv.valid) return json({ error: "invalid_timer", detail: tv.error }, 400);
    timerCols = parseTimer(body.timer);
  }

  // Validate on_invoke timer
  if (body.on_invoke?.timer) {
    const tv = validateTimer(body.on_invoke.timer);
    if (!tv.valid) return json({ error: "invalid_timer", field: "on_invoke.timer", detail: tv.error }, 400);
  }

  // Validate writes
  const writes = body.writes ?? [];
  if (!Array.isArray(writes)) return json({ error: "writes must be an array" }, 400);

  // Validate params schema
  const params = body.params ?? null;

  const writesJson = JSON.stringify(writes);
  const paramsJson = params ? JSON.stringify(params) : null;
  const onInvokeJson = body.on_invoke?.timer ? JSON.stringify(body.on_invoke.timer) : null;

  const registeredBy = scope !== "_shared" ? scope : (body.registered_by ?? (auth.authenticated ? auth.agentId : null));

  await sqlite.execute({
    sql: `INSERT INTO actions (id, room_id, scope, if_expr, enabled_expr, writes_json, params_json,
            timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at,
            on_invoke_timer_json, registered_by, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id, room_id) DO UPDATE SET
            scope = excluded.scope,
            if_expr = excluded.if_expr, enabled_expr = excluded.enabled_expr,
            writes_json = excluded.writes_json, params_json = excluded.params_json,
            timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
            timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
            timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at,
            on_invoke_timer_json = excluded.on_invoke_timer_json,
            registered_by = excluded.registered_by,
            version = actions.version + 1`,
    args: [id, roomId, scope, body.if ?? null, body.enabled ?? null, writesJson, paramsJson,
           timerCols.timer_json, timerCols.timer_expires_at, timerCols.timer_ticks_left,
           timerCols.timer_tick_on, timerCols.timer_effect, timerCols.timer_started_at,
           onInvokeJson, registeredBy],
  });

  const result = await sqlite.execute({
    sql: `SELECT * FROM actions WHERE id = ? AND room_id = ?`,
    args: [id, roomId],
  });
  const action = rows2objects(result)[0];
  return json(formatAction(action), 201);
}

function formatAction(row) {
  const out: any = {
    id: row.id,
    room_id: row.room_id,
    scope: row.scope ?? "_shared",
    version: row.version,
    created_at: row.created_at,
    registered_by: row.registered_by,
  };
  if (row.if_expr) out.if = row.if_expr;
  if (row.enabled_expr) out.enabled = row.enabled_expr;
  if (row.writes_json) {
    try { out.writes = JSON.parse(row.writes_json); } catch { out.writes = []; }
  }
  if (row.params_json) {
    try { out.params = JSON.parse(row.params_json); } catch {}
  }
  if (row.timer_json) {
    try { out.timer = JSON.parse(row.timer_json); } catch {}
  }
  if (row.on_invoke_timer_json) {
    try { out.on_invoke = { timer: JSON.parse(row.on_invoke_timer_json) }; } catch {}
  }
  return out;
}

async function listActions(roomId, url?) {
  const expand = url?.searchParams?.get("expand_params");
  const result = await sqlite.execute({
    sql: `SELECT * FROM actions WHERE room_id = ? ORDER BY created_at`,
    args: [roomId],
  });
  let rows = rows2objects(result);

  // Filter by timer liveness
  rows = rows.filter(row => isTimerLive(row));

  // Build context for enabled + available evaluation
  const ctx = await buildContext(roomId);

  // Filter by enabled expressions
  rows = rows.filter(row => {
    if (!row.enabled_expr) return true;
    try {
      return !!evaluate(row.enabled_expr, ctx);
    } catch { return false; }
  });

  // Format with availability
  const actions = rows.map(row => {
    const action = formatAction(row);
    // Check if the `if` predicate passes
    if (row.if_expr) {
      try {
        action.available = !!evaluate(row.if_expr, ctx);
      } catch { action.available = false; }
    } else {
      action.available = true;
    }

    // Expand params: evaluate `if` for each enum value
    if (expand === "true" && row.params_json) {
      try {
        const params = JSON.parse(row.params_json);
        const availability_by_param: any = {};
        for (const [paramName, paramDef] of Object.entries(params as Record<string, any>)) {
          if (paramDef.enum && row.if_expr) {
            availability_by_param[paramName] = {};
            for (const enumVal of paramDef.enum) {
              try {
                const paramCtx = { ...ctx, params: { [paramName]: enumVal } };
                availability_by_param[paramName][enumVal] = {
                  available: !!evaluate(row.if_expr, paramCtx),
                };
              } catch {
                availability_by_param[paramName][enumVal] = { available: false };
              }
            }
          }
        }
        if (Object.keys(availability_by_param).length > 0) {
          action.availability_by_param = availability_by_param;
        }
      } catch {}
    }

    return action;
  });

  return json(actions);
}

async function getAction(roomId, actionId) {
  const result = await sqlite.execute({
    sql: `SELECT * FROM actions WHERE id = ? AND room_id = ?`,
    args: [actionId, roomId],
  });
  const row = rows2objects(result)[0];
  if (!row) return json({ error: "action not found" }, 404);
  if (!isTimerLive(row)) return json({ error: "action not found" }, 404);
  return json(formatAction(row));
}

async function deleteAction(roomId, actionId, auth) {
  // Check scope ownership before deleting
  const existing = await sqlite.execute({
    sql: `SELECT scope FROM actions WHERE id = ? AND room_id = ?`,
    args: [actionId, roomId],
  });
  if (existing.rows.length === 0) return json({ error: "action not found" }, 404);

  const scope = existing.rows[0][0] ?? "_shared";
  if (scope !== "_shared") {
    if (!auth.authenticated || auth.agentId !== scope) {
      return json({ error: "action_owned", message: `action "${actionId}" is owned by scope "${scope}" — only that agent can delete it`, owner: scope }, 403);
    }
  }

  const result = await sqlite.execute({
    sql: `DELETE FROM actions WHERE id = ? AND room_id = ?`,
    args: [actionId, roomId],
  });
  if (result.rowsAffected === 0) return json({ error: "action not found" }, 404);
  return json({ deleted: true, id: actionId });
}

async function invokeAction(roomId, actionId, body, auth) {
  const agent = body.agent ?? null;
  touchAgent(roomId, agent);

  // Load the action
  const actionResult = await sqlite.execute({
    sql: `SELECT * FROM actions WHERE id = ? AND room_id = ?`,
    args: [actionId, roomId],
  });
  const action = rows2objects(actionResult)[0];
  if (!action) return json({ error: "action not found" }, 404);
  if (!isTimerLive(action)) return json({ error: "action not found (expired)" }, 404);

  const actionScope = action.scope ?? "_shared";

  // Check enabled
  const ctx = await buildContext(roomId);
  if (action.enabled_expr) {
    try {
      if (!evaluate(action.enabled_expr, ctx)) {
        return json({ error: "action_disabled", id: actionId, enabled: action.enabled_expr }, 409);
      }
    } catch (e) {
      return json({ error: "cel_error", field: "enabled", detail: e.message }, 400);
    }
  }

  // Merge params
  const params = body.params ?? {};

  // Validate params against schema
  if (action.params_json) {
    try {
      const schema = JSON.parse(action.params_json);
      for (const [name, def] of Object.entries(schema as Record<string, any>)) {
        if (def.enum && params[name] !== undefined && !def.enum.includes(params[name])) {
          return json({ error: "invalid_param", param: name, value: params[name], allowed: def.enum }, 400);
        }
        if (def.type && params[name] !== undefined) {
          const actual = typeof params[name];
          if (def.type !== actual) {
            return json({ error: "invalid_param_type", param: name, expected: def.type, actual }, 400);
          }
        }
      }
    } catch {}
  }

  // Check if predicate
  if (action.if_expr) {
    const result = evalCelWithParams(action.if_expr, ctx, params);
    if (!result.ok) return json({ error: "cel_error", field: "if", detail: result.error }, 400);
    if (!result.value) {
      return json({ error: "precondition_failed", action: actionId, expression: action.if_expr, evaluated: result.value }, 409);
    }
  }

  // Execute writes with registrar-identity scope enforcement
  const writes = JSON.parse(action.writes_json || "[]");
  const statements = [];
  const executedWrites = [];

  for (const w of writes) {
    const writeScope = w.scope ?? "_shared";

    // Scope enforcement for writes
    // _shared and _view are communal — always allowed
    // Agent-scoped writes require authorization:
    //   - actionScope matches writeScope (registrar-identity bridging)
    //   - invoking agent matches writeScope (self-write)
    if (writeScope !== "_shared" && writeScope !== "_view") {
      const registrarAllowed = actionScope === writeScope;
      const invokerAllowed = agent === writeScope;
      if (!registrarAllowed && !invokerAllowed) {
        return json({
          error: "scope_denied",
          message: `action "${actionId}" (scope: "${actionScope}") cannot write to scope "${writeScope}" — neither registrar nor invoker has authority`,
          action_scope: actionScope,
          write_scope: writeScope,
          invoker: agent,
        }, 403);
      }
    }

    // Resolve param substitutions in key (e.g., "inventory_${params.item}")
    let key = w.key;
    if (key && key.includes("${")) {
      key = key.replace(/\$\{params\.(\w+)\}/g, (_, name) => String(params[name] ?? ""));
    }

    // Resolve value — if expr flag, evaluate as CEL
    let value;
    if (w.expr === true && typeof w.value === "string") {
      const evalResult = evalCelWithParams(w.value, ctx, params);
      if (!evalResult.ok) return json({ error: "cel_error", field: `writes[].value`, detail: evalResult.error, key }, 400);
      value = evalResult.value;
    } else {
      value = w.value;
    }

    // Parse timer on individual writes if present
    let writeTimerCols = parseTimer(null);
    if (w.timer) {
      const tv = validateTimer(w.timer);
      if (tv.valid) writeTimerCols = parseTimer(w.timer);
    }
    const enabledExpr = w.enabled ?? null;
    const timerArgs = [writeTimerCols.timer_json, writeTimerCols.timer_expires_at, writeTimerCols.timer_ticks_left,
                       writeTimerCols.timer_tick_on, writeTimerCols.timer_effect, writeTimerCols.timer_started_at];

    if (w.increment === true) {
      const existing = await sqlite.execute({
        sql: `SELECT version FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [roomId, writeScope, key],
      });
      if (existing.rows.length > 0) {
        statements.push({
          sql: `UPDATE state SET value = CAST(CAST(value AS INTEGER) + CAST(? AS INTEGER) AS TEXT),
                version = version + 1, updated_at = datetime('now'),
                enabled_expr = COALESCE(?, enabled_expr),
                timer_json = COALESCE(?, timer_json), timer_expires_at = COALESCE(?, timer_expires_at),
                timer_ticks_left = COALESCE(?, timer_ticks_left), timer_tick_on = COALESCE(?, timer_tick_on),
                timer_effect = COALESCE(?, timer_effect), timer_started_at = COALESCE(?, timer_started_at)
                WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [String(value ?? 1), enabledExpr, ...timerArgs, roomId, writeScope, key],
        });
      } else {
        statements.push({
          sql: `INSERT INTO state (room_id, scope, key, value, version, updated_at, enabled_expr,
                  timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
                VALUES (?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
          args: [roomId, writeScope, key, String(value ?? 1), enabledExpr, ...timerArgs],
        });
      }
    } else {
      const strValue = typeof value === "string" ? value : JSON.stringify(value);
      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, value, version, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = version + 1, updated_at = datetime('now'),
                enabled_expr = COALESCE(excluded.enabled_expr, state.enabled_expr),
                timer_json = COALESCE(excluded.timer_json, state.timer_json),
                timer_expires_at = COALESCE(excluded.timer_expires_at, state.timer_expires_at),
                timer_ticks_left = COALESCE(excluded.timer_ticks_left, state.timer_ticks_left),
                timer_tick_on = COALESCE(excluded.timer_tick_on, state.timer_tick_on),
                timer_effect = COALESCE(excluded.timer_effect, state.timer_effect),
                timer_started_at = COALESCE(excluded.timer_started_at, state.timer_started_at)`,
        args: [roomId, writeScope, key, strValue, enabledExpr, ...timerArgs],
      });
    }
    executedWrites.push({ scope: writeScope, key, value });
  }

  if (statements.length > 0) {
    await sqlite.batch(statements);
  }

  // Tick logical timers for all written keys
  for (const w of executedWrites) {
    await tickLogicalTimers(roomId, w.scope, w.key);
  }

  // Apply on_invoke timer (cooldown) to the action itself
  if (action.on_invoke_timer_json) {
    try {
      const invokeTimer = JSON.parse(action.on_invoke_timer_json);
      const cols = parseTimer(invokeTimer);
      await sqlite.execute({
        sql: `UPDATE actions SET timer_json = ?, timer_expires_at = ?, timer_ticks_left = ?,
              timer_tick_on = ?, timer_effect = ?, timer_started_at = ?
              WHERE id = ? AND room_id = ?`,
        args: [cols.timer_json, cols.timer_expires_at, cols.timer_ticks_left,
               cols.timer_tick_on, cols.timer_effect, cols.timer_started_at,
               actionId, roomId],
      });
    } catch {}
  }

  // Log the invocation as a message
  const logBody = JSON.stringify({ action: actionId, agent, params, writes: executedWrites });
  await sqlite.execute({
    sql: `INSERT INTO messages (room_id, from_agent, kind, body, seq)
          VALUES (?, ?, 'action_invocation', ?,
            (SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE room_id = ?))`,
    args: [roomId, agent, logBody, roomId],
  });

  return json({
    invoked: true,
    action: actionId,
    agent,
    params,
    writes: executedWrites,
  });
}

// ============ CEL eval endpoint ============
async function evalExpression(roomId, body) {
  const expr = body.expr;
  if (!expr || typeof expr !== "string") return json({ error: "expr string is required" }, 400);
  touchAgent(roomId, body.agent);
  const ctx = await buildContext(roomId);
  const result = await evalCel(roomId, expr, ctx);
  if (!result.ok) return json({ error: "cel_error", expression: expr, detail: result.error }, 400);
  return json({
    expression: expr,
    value: result.value,
    context_keys: {
      state_scopes: Object.keys(ctx.state || {}),
      agents: Object.keys(ctx.agents || {}),
      messages: ctx.messages,
      actions: Object.keys(ctx.actions || {}),
    },
  });
}

// ============ Conditional Wait ============
const MAX_WAIT_MS = 25_000;
const POLL_INTERVAL_MS = 1_000;
async function buildIncludeData(roomId, includeParam, ctx) {
  const data = {};
  if (!includeParam) return data;
  const includes = includeParam.split(",");
  for (const inc of includes) {
    const trimmed = inc.trim();
    if (trimmed === "state" || trimmed.startsWith("state.")) {
      const scope = trimmed === "state" ? null : trimmed.slice(6);
      data.state = scope ? (ctx.state?.[scope] ?? {}) : ctx.state;
    }
    if (trimmed === "agents") data.agents = ctx.agents;
    if (trimmed === "messages") data.messages = ctx.messages;
    if (trimmed === "actions") data.actions = ctx.actions;
    if (trimmed.startsWith("messages:after:")) {
      const afterSeq = parseInt(trimmed.split(":")[2]);
      const msgResult = await sqlite.execute({
        sql: `SELECT * FROM messages WHERE room_id = ? AND seq > ? ORDER BY seq ASC LIMIT 50`,
        args: [roomId, afterSeq],
      });
      data.messages_since = rows2objects(msgResult).map(msgToApi);
    }
  }
  return data;
}
async function waitForCondition(roomId, url) {
  const condition = url.searchParams.get("condition");
  const agent = url.searchParams.get("agent");
  const timeoutParam = url.searchParams.get("timeout");
  const includeParam = url.searchParams.get("include");
  if (!condition) return json({ error: "condition parameter is required (CEL expression)" }, 400);
  const validation = validateCel(condition);
  if (!validation.valid) return json({ error: "invalid_cel", expression: condition, detail: validation.error }, 400);
  const timeout = Math.min(timeoutParam ? parseInt(timeoutParam) : MAX_WAIT_MS, MAX_WAIT_MS);
  if (agent) {
    await sqlite.execute({
      sql: `UPDATE agents SET status = 'waiting', waiting_on = ?, last_heartbeat = datetime('now')
            WHERE id = ? AND room_id = ?`,
      args: [condition, agent, roomId],
    });
  }
  const startTime = Date.now();
  try {
    while (Date.now() - startTime < timeout) {
      const ctx = await buildContext(roomId, agent ?? undefined);
      const result = await evalCel(roomId, condition, ctx);
      if (result.ok && result.value) {
        if (agent) {
          await sqlite.execute({
            sql: `UPDATE agents SET status = 'active', waiting_on = NULL, last_heartbeat = datetime('now')
                  WHERE id = ? AND room_id = ?`,
            args: [agent, roomId],
          });
        }
        const includeData = await buildIncludeData(roomId, includeParam, ctx);
        return json({ triggered: true, condition, value: result.value, ...includeData });
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (agent) {
      await sqlite.execute({
        sql: `UPDATE agents SET status = 'active', waiting_on = NULL, last_heartbeat = datetime('now')
              WHERE id = ? AND room_id = ?`,
        args: [agent, roomId],
      });
    }
    const ctx = await buildContext(roomId, agent ?? undefined);
    const includeData = await buildIncludeData(roomId, includeParam, ctx);
    return json({ triggered: false, timeout: true, elapsed_ms: Date.now() - startTime, ...includeData });
  } catch (e) {
    if (agent) {
      try { await sqlite.execute({ sql: `UPDATE agents SET status = 'active', waiting_on = NULL WHERE id = ? AND room_id = ?`, args: [agent, roomId] }); } catch (_) {}
    }
    throw e;
  }
}

// ============ Router ============
export default async function (req) {
  await ensureMigrated();
  const url = new URL(req.url);
  const method = req.method;
  const parts = url.pathname.split("/").filter(Boolean);

  // POST /rooms
  if (method === "POST" && parts[0] === "rooms" && parts.length === 1) {
    const body = await parseBody(req);
    if (body === PARSE_FAILED) return json({ error: "invalid JSON in request body" }, 400);
    return createRoom(body);
  }
  // GET /rooms
  if (method === "GET" && parts[0] === "rooms" && parts.length === 1) return listRooms(req);
  // GET /rooms/:id
  if (method === "GET" && parts[0] === "rooms" && parts.length === 2) return getRoom(parts[1]);

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
      },
    });
  }

  const roomId = parts[1];
  let body = undefined;
  if (method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH") {
    body = await parseBody(req);
    if (body === PARSE_FAILED) return json({ error: "invalid JSON in request body" }, 400);
  }

  if (parts[0] === "rooms" && roomId) {
    const sub = parts[2];
    const subId = parts[3];
    const subAction = parts[4];

    let auth = { authenticated: false, agentId: null };
    if (method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH") {
      const authResult = await resolveAuth(req, roomId);
      if (authResult instanceof Response) return authResult;
      auth = authResult;
    }

    // Agents
    if (method === "POST" && sub === "agents" && !subId) return joinRoom(roomId, body, req);
    if (method === "GET" && sub === "agents" && !subId) return listAgents(roomId);
    if (method === "POST" && sub === "agents" && subId && subAction === "heartbeat") {
      const deny = assertIdentity(auth, subId);
      if (deny) return deny;
      return heartbeat(roomId, subId, body);
    }

    // Messages
    if (method === "POST" && sub === "messages" && !subId) {
      const deny = assertIdentity(auth, body.from);
      if (deny) return deny;
      return postMessage(roomId, body);
    }
    if (method === "GET" && sub === "messages" && !subId) return getMessages(roomId, url);
    if (method === "POST" && sub === "messages" && subId && subAction === "claim") {
      const deny = assertIdentity(auth, body.agent);
      if (deny) return deny;
      return claimMessage(roomId, subId, body);
    }

    // State
    if (method === "PUT" && sub === "state" && subId === "batch") {
      if (body.agent) {
        const deny = assertIdentity(auth, body.agent);
        if (deny) return deny;
      } else if (auth.authenticated) {
        const agentScopes = (body.writes || []).map((w) => w.scope).filter((s) => s && s !== "_shared" && s !== "_view");
        for (const scope of agentScopes) {
          const deny = assertIdentity(auth, scope);
          if (deny) return deny;
        }
      }
      return batchSetState(roomId, body);
    }
    if (method === "PUT" && sub === "state" && !subId) {
      const claimedAgent = body.agent ?? (body.scope && body.scope !== "_shared" && body.scope !== "_view" ? body.scope : null);
      const deny = assertIdentity(auth, claimedAgent);
      if (deny) return deny;
      return setState(roomId, body);
    }
    if (method === "GET" && sub === "state" && !subId) return getState(roomId, url);
    if (method === "DELETE" && sub === "state") {
      const claimedAgent = body.scope && body.scope !== "_shared" && body.scope !== "_view" ? body.scope : null;
      const deny = assertIdentity(auth, claimedAgent);
      if (deny) return deny;
      return deleteState(roomId, body);
    }

    // Timer renewal
    if (method === "PATCH" && sub === "state" && subId === "timer") {
      return renewStateTimer(roomId, body);
    }

    // Actions
    if (method === "PUT" && sub === "actions" && !subId) {
      return registerAction(roomId, body, auth);
    }
    if (method === "GET" && sub === "actions" && !subId) {
      return listActions(roomId, url);
    }
    if (method === "GET" && sub === "actions" && subId && !subAction) {
      return getAction(roomId, subId);
    }
    if (method === "DELETE" && sub === "actions" && subId && !subAction) {
      return deleteAction(roomId, subId, auth);
    }
    if (method === "POST" && sub === "actions" && subId && subAction === "invoke") {
      const deny = assertIdentity(auth, body.agent);
      if (deny) return deny;
      return invokeAction(roomId, subId, body, auth);
    }

    // Wait
    if (method === "GET" && sub === "wait") return waitForCondition(roomId, url);
    // CEL eval
    if (method === "POST" && sub === "eval") return evalExpression(roomId, body);
  }

  // Root
  if (url.pathname === "/" || url.pathname === "") {
    const roomId = url.searchParams.get("room");
    if (roomId) {
      const baseUrl = url.origin;
      return new Response(dashboardHTML(roomId, baseUrl), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response(README, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  // Reference docs
  if (method === "GET" && parts[0] === "reference" && parts.length === 2) {
    const doc = REFERENCE_FILES[parts[1]];
    if (doc) return new Response(doc, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  return json({ error: "not found" }, 404);
}
