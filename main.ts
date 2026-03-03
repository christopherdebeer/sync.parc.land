import { sqlite } from "https://esm.town/v/std/sqlite";
import { migrate } from "./schema.ts";
import { buildContext, buildViewContext, evalCel, evalCelWithParams, validateCel, type BuildContextOptions } from "./cel.ts";
import { isTimerLive, getTimerStatus, parseTimer, tickLogicalTimers, validateTimer, renewTimer } from "./timers.ts";
import {
  resolveAuth, generateToken, hashToken, requireAuth, requireRoomToken,
  requireWriteAuth, hasFullReadAccess,
  assertIdentity, checkScopeAuthority, touchAgent, type AuthResult,
} from "./auth.ts";
import { evaluate } from "npm:@marcbachmann/cel-js";

const README_URL = new URL("./README.md", import.meta.url);
const README = await fetch(README_URL).then((r) => r.text());
const REFERENCE_FILES: Record<string, string> = {};
for (const name of ["api.md", "cel.md", "examples.md", "surfaces.md", "v6.md"]) {
  const refUrl = new URL(`./reference/${name}`, import.meta.url);
  REFERENCE_FILES[name] = await fetch(refUrl).then((r) => r.text());
}
const FRONTEND_HTML_URL = new URL("./frontend/index.html", import.meta.url);
const FRONTEND_HTML = await fetch(FRONTEND_HTML_URL).then((r) => r.text());

/** Help action content — the participant skill guide.
 *  Returned by the built-in `help` action unless overridden by a custom action. */
const HELP_CONTENT = `# sync — participant guide

You interact with this room using two operations: **read context** and **invoke actions**.

## Reading context

\`\`\`
GET /rooms/{room}/context
Authorization: Bearer {your_token}
\`\`\`

Returns everything you can see: shared state, your private state (as \`self\`), views, available actions with their parameters and write templates, recent messages, and agent presence.

## Invoking actions

\`\`\`
POST /rooms/{room}/actions/{action_id}/invoke
Authorization: Bearer {your_token}
{ "params": { ... } }
\`\`\`

Actions listed in your context are available to you. Check \`available: true\` before invoking.

## Built-in actions

| Action | Purpose |
|--------|---------|
| \`_send_message\` | Send a message (\`body\`, \`kind\`) |
| \`_set_state\` | Write to state (\`key\`, \`value\`, \`scope\`, \`public\`, \`merge\`, \`increment\`) |
| \`_batch_set_state\` | Batch writes (\`writes[]\`, \`if\`) |
| \`_delete_state\` | Remove state entry (\`scope\`, \`key\`) |
| \`_register_action\` | Define a custom action |
| \`_register_view\` | Define a computed view |
| \`_heartbeat\` | Stay active (\`status\`) |
| \`help\` | This guide (overridable per-room) |

## Waiting for changes

\`\`\`
GET /rooms/{room}/wait?condition={cel_expression}
Authorization: Bearer {your_token}
\`\`\`

Blocks until the CEL expression becomes true, then returns full context. The ideal loop:
1. \`GET /wait?condition=...\` — block until something relevant changes
2. \`POST /actions/{id}/invoke\` — act on what you see

## Key concepts

- **State scopes:** \`_shared\` is visible to all. Your agent ID is your private scope. \`public: true\` makes private keys visible as views.
- **Actions:** Custom actions have \`params\`, \`writes\` (templates with \`\${self}\`, \`\${params.x}\`, \`\${now}\`), and \`if\` preconditions.
- **Views:** Computed values from CEL expressions, visible to all agents.
- **Messages:** Appear in context under \`messages.recent\` with \`seq\`, \`from\`, \`kind\`, \`body\`.

## Reference

- Full API: \`GET /reference/api.md\`
- CEL expressions: \`GET /reference/cel.md\`
- Examples: \`GET /reference/examples.md\`
- Orchestrator skill: \`GET /SKILL.md\`
`;

let migrated = false;
async function ensureMigrated() {
  if (!migrated) { await migrate(); migrated = true; }
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
  });
}
function rows2objects(result: any) {
  return result.rows.map((row: any[]) =>
    Object.fromEntries(result.columns.map((col: string, i: number) => [col, row[i]]))
  );
}
const PARSE_FAILED = Symbol("parse_failed");
async function parseBody(req: Request) {
  const text = await req.text();
  if (!text || text.trim() === "") return {};
  try { return JSON.parse(text); } catch { return PARSE_FAILED; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deep substitute ${params.x}, ${self}, and ${now} in any value.
 *  Single-pass: param values containing ${self} or ${now} are NOT re-expanded.
 *  Timestamp is computed once per call and shared across the entire tree. */
function deepSubstitute(value: any, params: Record<string, any>, self: string, _ts?: string): any {
  if (typeof value === "string") {
    if (!value.includes("${")) return value;
    const ts = _ts ?? new Date().toISOString();
    return value.replace(/\$\{(params\.(\w+)|self|now)\}/g, (match, full, paramName) => {
      if (paramName !== undefined) return String(params[paramName] ?? "");
      if (full === "self") return self;
      if (full === "now") return ts;
      return match;
    });
  }
  if (Array.isArray(value)) {
    const ts = _ts ?? new Date().toISOString();
    return value.map(v => deepSubstitute(v, params, self, ts));
  }
  if (value !== null && typeof value === "object") {
    const ts = _ts ?? new Date().toISOString();
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      const rk = k.includes("${") ? deepSubstitute(k, params, self, ts) as string : k;
      out[rk] = deepSubstitute(v, params, self, ts);
    }
    return out;
  }
  return value;
}

/** Deep-merge source into target. Objects merge recursively; arrays and
 *  primitives in source overwrite target. null in source explicitly deletes
 *  the key (set to null). This prevents the catastrophic data-loss scenario
 *  where a shallow spread wipes sibling keys in nested objects. */
function deepMerge(target: any, source: any): any {
  if (source === null || source === undefined) return source;
  if (typeof target !== "object" || typeof source !== "object"
      || Array.isArray(target) || Array.isArray(source)
      || target === null) {
    return source;
  }
  const out: Record<string, any> = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v === null) { out[k] = null; continue; }
    out[k] = (k in out && typeof out[k] === "object" && !Array.isArray(out[k]) && out[k] !== null)
      ? deepMerge(out[k], v)
      : v;
  }
  return out;
}

// ============ Room handlers ============

async function createRoom(body: any) {
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

  // Seed default _dashboard config as self-documentation
  const dashboardDefault = JSON.stringify({
    title: "agent-sync",
    subtitle: id,
    default_tab: "agents",
    tabs: ["agents", "state", "messages", "actions", "views", "audit", "cel"],
    pinned_views: [],
    hero: null,
  });
  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, value, version, updated_at)
          VALUES (?, '_shared', '_dashboard', ?, 1, datetime('now'))
          ON CONFLICT(room_id, scope, key) DO NOTHING`,
    args: [id, dashboardDefault],
  }).catch(() => {});

  return json({ ...room, token, view_token: viewToken }, 201);
}

async function getRoom(roomId: string) {
  const result = await sqlite.execute({ sql: `SELECT * FROM rooms WHERE id = ?`, args: [roomId] });
  const room = rows2objects(result)[0];
  if (!room) return json({ error: "room not found" }, 404);
  delete room.token_hash;
  delete room.view_token_hash;
  return json(room);
}

async function listRooms(req: Request) {
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

// ============ Agent handlers ============

async function joinRoom(roomId: string, body: any, req: Request) {
  const id = body.id ?? crypto.randomUUID();
  const name = body.name ?? "anonymous";
  const role = body.role ?? "agent";
  const meta = JSON.stringify(body.meta ?? {});
  const enabled_expr = body.enabled ?? null;
  const token = generateToken("as");
  const hash = await hashToken(token);

  if (enabled_expr) {
    const v = validateCel(enabled_expr);
    if (!v.valid) return json({ error: "invalid_cel", field: "enabled", detail: v.error }, 400);
  }

  // Check for existing agent
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
      const callerToken = header.slice(7);
      const callerHash = await hashToken(callerToken);
      // Allow re-join with matching agent token OR room token
      if (callerHash !== existingHash) {
        // Check if it's a room token
        const roomCheck = await sqlite.execute({
          sql: `SELECT id FROM rooms WHERE id = ? AND token_hash = ?`,
          args: [roomId, callerHash],
        });
        if (roomCheck.rows.length === 0) {
          return json({ error: "invalid_token", message: `token does not match agent "${id}" — cannot re-join`, agent: id }, 401);
        }
      }
    }
  }

  await sqlite.execute({
    sql: `INSERT OR REPLACE INTO agents (id, room_id, name, role, meta, last_heartbeat, status, token_hash, grants, last_seen_seq, enabled_expr)
          VALUES (?, ?, ?, ?, ?, datetime('now'), 'active', ?, '[]', 0, ?)`,
    args: [id, roomId, name, role, meta, hash, enabled_expr],
  });

  // Inline initial state: write to agent's own scope
  if (body.state && typeof body.state === "object") {
    const statements: any[] = [];
    for (const [key, value] of Object.entries(body.state)) {
      const strValue = typeof value === "string" ? value : JSON.stringify(value);
      const isPublic = body.public_keys?.includes(key);
      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, value, version, updated_at)
              VALUES (?, ?, ?, ?, 1, datetime('now'))
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = version + 1, updated_at = datetime('now')`,
        args: [roomId, id, key, strValue],
      });
      // Auto-view for keys listed in public_keys
      if (isPublic) {
        const viewId = `${id}.${key}`;
        const expr = `state["${id}"]["${key}"]`;
        statements.push({
          sql: `INSERT INTO views (id, room_id, scope, description, expr, registered_by, version)
                VALUES (?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(id, room_id) DO UPDATE SET
                  expr = excluded.expr, scope = excluded.scope,
                  registered_by = excluded.registered_by,
                  version = views.version + 1`,
          args: [viewId, roomId, id, `auto: ${id}.${key}`, expr, id],
        });
      }
    }
    if (statements.length > 0) await sqlite.batch(statements);
  }

  // Inline views: register views scoped to this agent
  if (Array.isArray(body.views)) {
    const viewStatements: any[] = [];
    for (const v of body.views) {
      if (!v.id || !v.expr) continue;
      const vv = validateCel(v.expr);
      if (!vv.valid) continue; // skip invalid, don't block join
      viewStatements.push({
        sql: `INSERT INTO views (id, room_id, scope, description, expr, registered_by, version)
              VALUES (?, ?, ?, ?, ?, ?, 1)
              ON CONFLICT(id, room_id) DO UPDATE SET
                expr = excluded.expr, scope = excluded.scope, description = excluded.description,
                registered_by = excluded.registered_by,
                version = views.version + 1`,
        args: [v.id, roomId, id, v.description ?? null, v.expr, id],
      });
    }
    if (viewStatements.length > 0) await sqlite.batch(viewStatements);
  }

  const result = await sqlite.execute({
    sql: `SELECT * FROM agents WHERE id = ? AND room_id = ?`,
    args: [id, roomId],
  });
  const agent = rows2objects(result)[0];
  delete agent.token_hash;
  return json({ ...agent, token }, 201);
}

async function listAgents(roomId: string) {
  const result = await sqlite.execute({
    sql: `SELECT * FROM agents WHERE room_id = ? ORDER BY joined_at`,
    args: [roomId],
  });
  return json(rows2objects(result).map((a: any) => { delete a.token_hash; return a; }));
}

async function heartbeat(roomId: string, agentId: string, body: any) {
  const status = body.status ?? "active";
  const result = await sqlite.execute({
    sql: `UPDATE agents SET last_heartbeat = datetime('now'), status = ? WHERE id = ? AND room_id = ?`,
    args: [status, agentId, roomId],
  });
  if (result.rowsAffected === 0) return json({ error: "agent not found" }, 404);
  return json({ ok: true, agent: agentId, status, heartbeat: new Date().toISOString() });
}

async function updateAgent(roomId: string, agentId: string, body: any) {
  // Only room token / admin can update grants and role
  const sets: string[] = [];
  const args: any[] = [];
  if (body.grants !== undefined) {
    sets.push("grants = ?");
    args.push(JSON.stringify(body.grants));
  }
  if (body.role !== undefined) {
    sets.push("role = ?");
    args.push(body.role);
  }
  if (body.name !== undefined) {
    sets.push("name = ?");
    args.push(body.name);
  }
  if (body.meta !== undefined) {
    sets.push("meta = ?");
    args.push(JSON.stringify(body.meta));
  }
  if (sets.length === 0) return json({ error: "no fields to update" }, 400);

  args.push(agentId, roomId);
  const result = await sqlite.execute({
    sql: `UPDATE agents SET ${sets.join(", ")} WHERE id = ? AND room_id = ?`,
    args,
  });
  if (result.rowsAffected === 0) return json({ error: "agent not found" }, 404);

  const updated = await sqlite.execute({
    sql: `SELECT * FROM agents WHERE id = ? AND room_id = ?`, args: [agentId, roomId],
  });
  const agent = rows2objects(updated)[0];
  delete agent.token_hash;
  return json(agent);
}

// ============ State handlers ============

async function getState(roomId: string, url: URL, auth: AuthResult) {
  const scope = url.searchParams.get("scope");
  const key = url.searchParams.get("key");
  const after = url.searchParams.get("after");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "100"), 500);
  const raw = url.searchParams.get("raw");

  let sql = `SELECT * FROM state WHERE room_id = ?`;
  const args: any[] = [roomId];

  if (scope) {
    // Scope privacy check: agent can read own scope, _shared, system scopes, or granted scopes
    if (!scope.startsWith("_") && auth.authenticated && auth.kind === "agent") {
      if (scope !== auth.agentId && !auth.grants.includes(scope) && !auth.grants.includes("*")) {
        return json({ error: "scope_denied", message: `cannot read private scope "${scope}"` }, 403);
      }
    }
    sql += ` AND scope = ?`;
    args.push(scope);
  } else {
    // Without scope filter, enforce scope privacy
    if (hasFullReadAccess(auth)) {
      // Room token / admin / view token: see everything — no filter
    } else if (auth.authenticated && auth.kind === "agent") {
      // Agent: system scopes + own scope + granted scopes
      const accessibleScopes = [auth.agentId!, ...auth.grants].filter(Boolean);
      const conditions = [`scope LIKE '\\_%' ESCAPE '\\'`]; // system scopes starting with _
      for (const s of accessibleScopes) {
        conditions.push(`scope = ?`);
        args.push(s);
      }
      sql += ` AND (${conditions.join(" OR ")})`;
    } else {
      // Unauthenticated: system scopes only (no private agent state)
      sql += ` AND scope LIKE '\\_%' ESCAPE '\\'`;
    }
  }

  if (key) { sql += ` AND key = ?`; args.push(key); }
  if (after) { sql += ` AND sort_key > ?`; args.push(parseInt(after)); }

  sql += ` ORDER BY CASE WHEN sort_key IS NOT NULL THEN sort_key ELSE 0 END ASC LIMIT ?`;
  args.push(limit);

  const result = await sqlite.execute({ sql, args });
  let rows = rows2objects(result);

  // Filter by timer liveness and enabled
  const ctx = await buildContext(roomId, { selfAgent: auth.agentId ?? undefined });
  rows = rows.filter((row: any) => {
    if (!isTimerLive(row)) return false;
    if (row.enabled_expr) {
      try { return !!evaluate(row.enabled_expr, ctx); } catch { return false; }
    }
    return true;
  });

  // Parse values unless raw=true
  if (raw !== "true") {
    rows = rows.map((row: any) => {
      try { return { ...row, value: JSON.parse(row.value) }; } catch { return row; }
    });
  }

  // Update last_seen_seq for _messages scope reads
  if (scope === "_messages" && auth.agentId && rows.length > 0) {
    const maxSeq = Math.max(...rows.map((r: any) => r.sort_key ?? 0));
    if (maxSeq > 0) {
      sqlite.execute({
        sql: `UPDATE agents SET last_seen_seq = MAX(last_seen_seq, ?) WHERE id = ? AND room_id = ?`,
        args: [maxSeq, auth.agentId, roomId],
      }).catch(() => {});
    }
  }

  if (scope && key) {
    return rows[0] ? json(rows[0]) : json({ error: "not found" }, 404);
  }
  return json(rows);
}

async function setState(roomId: string, body: any, auth: AuthResult) {
  const scope = body.scope ?? "_shared";
  const key = body.key;
  const append = body.append === true;
  const merge = body.merge;
  const increment = !!body.increment;
  const incrementAmount = typeof body.increment === "number" ? body.increment : (body.value ?? 1);

  if (!append && !key) return json({ error: "key is required (or use append: true)" }, 400);

  // Scope authority check
  const scopeCheck = checkScopeAuthority(auth, scope);
  if (scopeCheck) return scopeCheck;

  touchAgent(roomId, auth.agentId);

  // Timer/enabled validation
  if (body.enabled) {
    const v = validateCel(body.enabled);
    if (!v.valid) return json({ error: "invalid_cel", field: "enabled", detail: v.error }, 400);
  }
  let timerCols = parseTimer(null);
  if (body.timer) {
    const tv = validateTimer(body.timer);
    if (!tv.valid) return json({ error: "invalid_timer", detail: tv.error }, 400);
    timerCols = parseTimer(body.timer);
  }
  const enabledExpr = body.enabled ?? null;
  const timerArgs = [timerCols.timer_json, timerCols.timer_expires_at, timerCols.timer_ticks_left,
                     timerCols.timer_tick_on, timerCols.timer_effect, timerCols.timer_started_at];

  // CEL write gate
  if (body.if) {
    if (typeof body.if !== "string") return json({ error: "if must be a CEL expression string" }, 400);
    const celResult = await evalCel(roomId, body.if);
    if (!celResult.ok) return json({ error: "cel_error", expression: body.if, detail: celResult.error }, 400);
    if (!celResult.value) return json({ error: "precondition_failed", expression: body.if, evaluated: celResult.value }, 409);
  }

  // Append mode
  let actualKey = key;
  let sortKey: number | null = null;
  let arrayPushValue: any = undefined;
  if (append) {
    if (key) {
      // Array-push: append value to JSON array stored at this key
      const existing = await sqlite.execute({
        sql: `SELECT value FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [roomId, scope, key],
      });
      let arr: any[] = [];
      if (existing.rows.length > 0) {
        try {
          const parsed = JSON.parse(existing.rows[0][0] as string);
          arr = Array.isArray(parsed) ? parsed : [parsed];
        } catch { arr = []; }
      }
      if (body.value === undefined) return json({ error: "value is required for array append" }, 400);
      arr.push(body.value);
      arrayPushValue = arr;
    } else {
      // Log-row: auto-assign sort_key, auto-generate key
      const seqResult = await sqlite.execute({
        sql: `SELECT COALESCE(MAX(sort_key), 0) + 1 as next_seq FROM state WHERE room_id = ? AND scope = ?`,
        args: [roomId, scope],
      });
      sortKey = Number(rows2objects(seqResult)[0]?.next_seq ?? 1);
      actualKey = String(sortKey);
    }
  }

  // Merge mode: read existing, deep merge
  if (merge && typeof merge === "object") {
    const existing = await sqlite.execute({
      sql: `SELECT value FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
      args: [roomId, scope, actualKey],
    });
    let currentValue: any = {};
    if (existing.rows.length > 0) {
      try { currentValue = JSON.parse(existing.rows[0][0] as string); } catch {}
    }
    const merged = deepMerge(currentValue, merge);
    const value = JSON.stringify(merged);

    if (body.if_version !== undefined) {
      const expected = parseInt(body.if_version);
      const result = await sqlite.execute({
        sql: `UPDATE state SET value = ?, version = version + 1, updated_at = datetime('now'),
              sort_key = COALESCE(?, sort_key), enabled_expr = ?, timer_json = ?, timer_expires_at = ?,
              timer_ticks_left = ?, timer_tick_on = ?, timer_effect = ?, timer_started_at = ?
              WHERE room_id = ? AND scope = ? AND key = ? AND version = ?`,
        args: [value, sortKey, enabledExpr, ...timerArgs, roomId, scope, actualKey, expected],
      });
      if (result.rowsAffected === 0) {
        const current = await sqlite.execute({
          sql: `SELECT * FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [roomId, scope, actualKey],
        });
        const row = rows2objects(current)[0];
        return json({ error: "version_conflict", expected_version: expected, current: row ?? null }, 409);
      }
    } else {
      await sqlite.execute({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = version + 1, updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, scope, actualKey, sortKey, value, enabledExpr, ...timerArgs],
      });
    }
  } else if (increment) {
    // Increment mode
    const existing = await sqlite.execute({
      sql: `SELECT version FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
      args: [roomId, scope, actualKey],
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
        args: [String(incrementAmount), enabledExpr, ...timerArgs, roomId, scope, actualKey],
      });
    } else {
      await sqlite.execute({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
        args: [roomId, scope, actualKey, sortKey, String(incrementAmount), enabledExpr, ...timerArgs],
      });
    }
  } else {
    // Standard set (full value replacement)
    const rawValue = arrayPushValue !== undefined ? arrayPushValue : body.value;
    const value = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);

    if (body.if_version !== undefined) {
      const expected = parseInt(body.if_version);
      const result = await sqlite.execute({
        sql: `UPDATE state SET value = ?, version = version + 1, updated_at = datetime('now'),
              sort_key = COALESCE(?, sort_key), enabled_expr = ?,
              timer_json = ?, timer_expires_at = ?, timer_ticks_left = ?,
              timer_tick_on = ?, timer_effect = ?, timer_started_at = ?
              WHERE room_id = ? AND scope = ? AND key = ? AND version = ?`,
        args: [value, sortKey, enabledExpr, ...timerArgs, roomId, scope, actualKey, expected],
      });
      if (result.rowsAffected === 0) {
        const current = await sqlite.execute({
          sql: `SELECT * FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [roomId, scope, actualKey],
        });
        const row = rows2objects(current)[0];
        if (row) return json({ error: "version_conflict", expected_version: expected, current: row }, 409);
        if (expected !== 0) return json({ error: "not_found", message: "key does not exist, use if_version=0 to create" }, 404);
        await sqlite.execute({
          sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at, enabled_expr,
                  timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
                VALUES (?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
          args: [roomId, scope, actualKey, sortKey, value, enabledExpr, ...timerArgs],
        });
      }
    } else {
      await sqlite.execute({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = version + 1, updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, scope, actualKey, sortKey, value, enabledExpr, ...timerArgs],
      });
    }
  }

  // Tick logical timers
  await tickLogicalTimers(roomId, scope, actualKey);

  // Auto-view for public: true on private scopes
  if (body.public === true && !scope.startsWith("_")) {
    await ensureAutoView(roomId, scope, actualKey, auth);
  } else if (body.public === false && !scope.startsWith("_")) {
    await removeAutoView(roomId, scope, actualKey);
  }

  const result = await sqlite.execute({
    sql: `SELECT * FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
    args: [roomId, scope, actualKey],
  });
  const row = rows2objects(result)[0];
  if (row) {
    try { row.value = JSON.parse(row.value); } catch {}
  }
  return json(row);
}

async function batchSetState(roomId: string, body: any, auth: AuthResult) {
  const writes = body.writes;
  if (!Array.isArray(writes) || writes.length === 0) return json({ error: "writes array is required" }, 400);
  if (writes.length > 20) return json({ error: "max 20 writes per batch" }, 400);

  // Check scope authority for all writes
  for (const w of writes) {
    const scope = w.scope ?? "_shared";
    const scopeCheck = checkScopeAuthority(auth, scope);
    if (scopeCheck) return scopeCheck;
  }

  touchAgent(roomId, auth.agentId);

  // CEL write gate
  if (body.if) {
    if (typeof body.if !== "string") return json({ error: "if must be a CEL expression string" }, 400);
    const celResult = await evalCel(roomId, body.if);
    if (!celResult.ok) return json({ error: "cel_error", expression: body.if, detail: celResult.error }, 400);
    if (!celResult.value) return json({ error: "precondition_failed", expression: body.if, evaluated: celResult.value }, 409);
  }

  const statements: any[] = [];
  const tickKeys: { scope: string; key: string }[] = [];

  for (const w of writes) {
    const scope = w.scope ?? "_shared";
    const append = w.append === true;
    let key = w.key;
    let sortKey: number | null = null;

    let timerCols = parseTimer(null);
    if (w.timer) {
      const tv = validateTimer(w.timer);
      if (!tv.valid) return json({ error: "invalid_timer", key, detail: tv.error }, 400);
      timerCols = parseTimer(w.timer);
    }
    const enabledExpr = w.enabled ?? null;
    const timerArgsBatch = [timerCols.timer_json, timerCols.timer_expires_at, timerCols.timer_ticks_left,
                       timerCols.timer_tick_on, timerCols.timer_effect, timerCols.timer_started_at];

    let arrayPushBatch: any = undefined;
    if (append) {
      if (key) {
        // Array-push: append value to JSON array stored at this key
        const existing = await sqlite.execute({
          sql: `SELECT value FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [roomId, scope, key],
        });
        let arr: any[] = [];
        if (existing.rows.length > 0) {
          try {
            const parsed = JSON.parse(existing.rows[0][0] as string);
            arr = Array.isArray(parsed) ? parsed : [parsed];
          } catch { arr = []; }
        }
        if (w.value === undefined) return json({ error: "value is required for array append", key }, 400);
        arr.push(w.value);
        arrayPushBatch = arr;
      } else {
        const seqResult = await sqlite.execute({
          sql: `SELECT COALESCE(MAX(sort_key), 0) + 1 as next_seq FROM state WHERE room_id = ? AND scope = ?`,
          args: [roomId, scope],
        });
        sortKey = Number(rows2objects(seqResult)[0]?.next_seq ?? 1);
        key = String(sortKey);
      }
    }

    if (!key) return json({ error: "each write needs a key (or use append: true)" }, 400);
    tickKeys.push({ scope, key });

    // Merge support in batch
    if (w.merge && typeof w.merge === "object") {
      const existing = await sqlite.execute({
        sql: `SELECT value FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [roomId, scope, key],
      });
      let currentValue: any = {};
      if (existing.rows.length > 0) {
        try { currentValue = JSON.parse(existing.rows[0][0] as string); } catch {}
      }
      const merged = JSON.stringify(deepMerge(currentValue, w.merge));
      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = version + 1, updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, scope, key, sortKey, merged, enabledExpr, ...timerArgsBatch],
      });
    } else if (w.increment) {
      const batchIncrementAmount = typeof w.increment === "number" ? w.increment : (w.value ?? 1);
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
          args: [String(batchIncrementAmount), enabledExpr, ...timerArgsBatch, roomId, scope, key],
        });
      } else {
        statements.push({
          sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at, enabled_expr,
                  timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
                VALUES (?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
          args: [roomId, scope, key, sortKey, String(batchIncrementAmount), enabledExpr, ...timerArgsBatch],
        });
      }
    } else {
      const rawBatch = arrayPushBatch !== undefined ? arrayPushBatch : w.value;
      const value = typeof rawBatch === "string" ? rawBatch : JSON.stringify(rawBatch);
      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = version + 1, updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, scope, key, sortKey, value, enabledExpr, ...timerArgsBatch],
      });
    }
  }

  if (statements.length > 0) await sqlite.batch(statements);

  for (const tk of tickKeys) {
    await tickLogicalTimers(roomId, tk.scope, tk.key);
  }

  // Auto-views for public: true in batch writes
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i];
    const scope = w.scope ?? "_shared";
    const key = tickKeys[i]?.key;
    if (key && !scope.startsWith("_")) {
      if (w.public === true) await ensureAutoView(roomId, scope, key, auth);
      else if (w.public === false) await removeAutoView(roomId, scope, key);
    }
  }

  // Return written state
  const results: any[] = [];
  for (const tk of tickKeys) {
    const result = await sqlite.execute({
      sql: `SELECT * FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
      args: [roomId, tk.scope, tk.key],
    });
    const row = rows2objects(result)[0];
    if (row) {
      try { row.value = JSON.parse(row.value); } catch {}
      results.push(row);
    }
  }
  return json({ ok: true, count: results.length, state: results });
}

async function deleteState(roomId: string, body: any, auth: AuthResult) {
  const scope = body.scope ?? "_shared";
  const key = body.key;
  if (!key) return json({ error: "key is required" }, 400);
  const scopeCheck = checkScopeAuthority(auth, scope);
  if (scopeCheck) return scopeCheck;
  await sqlite.execute({
    sql: `DELETE FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
    args: [roomId, scope, key],
  });
  return json({ deleted: true });
}

// ============ Action handlers ============

function formatAction(row: any) {
  const out: any = {
    id: row.id, room_id: row.room_id, scope: row.scope ?? "_shared",
    description: row.description, version: row.version, created_at: row.created_at,
    registered_by: row.registered_by,
  };
  if (row.if_expr) out.if = row.if_expr;
  if (row.enabled_expr) out.enabled = row.enabled_expr;
  if (row.result_expr) out.result = row.result_expr;
  if (row.writes_json) { try { out.writes = JSON.parse(row.writes_json); } catch { out.writes = []; } }
  if (row.params_json) { try { out.params = JSON.parse(row.params_json); } catch {} }
  if (row.timer_json) { try { out.timer = JSON.parse(row.timer_json); } catch {} }
  if (row.on_invoke_timer_json) { try { out.on_invoke = { timer: JSON.parse(row.on_invoke_timer_json) }; } catch {} }
  return out;
}

async function registerAction(roomId: string, body: any, auth: AuthResult) {
  const id = body.id;
  if (!id) return json({ error: "id is required" }, 400);
  const scope = body.scope ?? "_shared";

  // Scope ownership enforcement
  if (scope !== "_shared") {
    if (!auth.authenticated) return json({ error: "authentication_required", message: `scoped actions require auth` }, 401);
    if (auth.kind !== "room" && !auth.grants.includes("*") && auth.agentId !== scope) {
      return json({ error: "identity_mismatch", message: `action scope "${scope}" requires authentication as "${scope}"` }, 403);
    }
  }

  // Validate expressions
  if (body.if) { const v = validateCel(body.if); if (!v.valid) return json({ error: "invalid_cel", field: "if", detail: v.error }, 400); }
  if (body.enabled) { const v = validateCel(body.enabled); if (!v.valid) return json({ error: "invalid_cel", field: "enabled", detail: v.error }, 400); }
  if (body.result) { const v = validateCel(body.result); if (!v.valid) return json({ error: "invalid_cel", field: "result", detail: v.error }, 400); }

  let timerCols = parseTimer(null);
  if (body.timer) {
    const tv = validateTimer(body.timer);
    if (!tv.valid) return json({ error: "invalid_timer", detail: tv.error }, 400);
    timerCols = parseTimer(body.timer);
  }
  if (body.on_invoke?.timer) {
    const tv = validateTimer(body.on_invoke.timer);
    if (!tv.valid) return json({ error: "invalid_timer", field: "on_invoke.timer", detail: tv.error }, 400);
  }

  const writes = body.writes ?? [];
  if (!Array.isArray(writes)) return json({ error: "writes must be an array" }, 400);
  const params = body.params ?? null;
  const writesJson = JSON.stringify(writes);
  const paramsJson = params ? JSON.stringify(params) : null;
  const onInvokeJson = body.on_invoke?.timer ? JSON.stringify(body.on_invoke.timer) : null;
  const registeredBy = scope !== "_shared" ? scope : (body.registered_by ?? (auth.authenticated ? auth.agentId : null));

  await sqlite.execute({
    sql: `INSERT INTO actions (id, room_id, scope, description, if_expr, enabled_expr, result_expr, writes_json, params_json,
            timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at,
            on_invoke_timer_json, registered_by, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id, room_id) DO UPDATE SET
            scope = excluded.scope, description = excluded.description,
            if_expr = excluded.if_expr, enabled_expr = excluded.enabled_expr,
            result_expr = excluded.result_expr,
            writes_json = excluded.writes_json, params_json = excluded.params_json,
            timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
            timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
            timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at,
            on_invoke_timer_json = excluded.on_invoke_timer_json,
            registered_by = excluded.registered_by,
            version = actions.version + 1`,
    args: [id, roomId, scope, body.description ?? null, body.if ?? null, body.enabled ?? null, body.result ?? null,
           writesJson, paramsJson, timerCols.timer_json, timerCols.timer_expires_at, timerCols.timer_ticks_left,
           timerCols.timer_tick_on, timerCols.timer_effect, timerCols.timer_started_at, onInvokeJson, registeredBy],
  });

  const result = await sqlite.execute({ sql: `SELECT * FROM actions WHERE id = ? AND room_id = ?`, args: [id, roomId] });
  return json(formatAction(rows2objects(result)[0]), 201);
}

async function listActions(roomId: string, url: URL, auth: AuthResult) {
  const expand = url.searchParams.get("expand_params");
  const result = await sqlite.execute({ sql: `SELECT * FROM actions WHERE room_id = ? ORDER BY created_at`, args: [roomId] });
  let rows = rows2objects(result);

  rows = rows.filter((row: any) => isTimerLive(row));
  const ctx = await buildContext(roomId, { selfAgent: auth.agentId ?? undefined });

  rows = rows.filter((row: any) => {
    if (!row.enabled_expr) return true;
    try { return !!evaluate(row.enabled_expr, ctx); } catch { return false; }
  });

  const actions = rows.map((row: any) => {
    const action = formatAction(row);
    if (row.if_expr) {
      try { action.available = !!evaluate(row.if_expr, ctx); } catch { action.available = false; }
    } else {
      action.available = true;
    }

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
                availability_by_param[paramName][enumVal] = { available: !!evaluate(row.if_expr, paramCtx) };
              } catch { availability_by_param[paramName][enumVal] = { available: false }; }
            }
          }
        }
        if (Object.keys(availability_by_param).length > 0) action.availability_by_param = availability_by_param;
      } catch {}
    }
    return action;
  });

  return json(actions);
}

async function getAction(roomId: string, actionId: string) {
  const result = await sqlite.execute({ sql: `SELECT * FROM actions WHERE id = ? AND room_id = ?`, args: [actionId, roomId] });
  const row = rows2objects(result)[0];
  if (!row) return json({ error: "action not found" }, 404);
  if (!isTimerLive(row)) return json({ error: "action not found" }, 404);
  return json(formatAction(row));
}

async function deleteAction(roomId: string, actionId: string, auth: AuthResult) {
  const existing = await sqlite.execute({ sql: `SELECT scope FROM actions WHERE id = ? AND room_id = ?`, args: [actionId, roomId] });
  if (existing.rows.length === 0) return json({ error: "action not found" }, 404);
  const scope = existing.rows[0][0] ?? "_shared";
  if (scope !== "_shared") {
    if (auth.kind !== "room" && !auth.grants.includes("*") && auth.agentId !== scope) {
      return json({ error: "action_owned", message: `action "${actionId}" owned by "${scope}"`, owner: scope }, 403);
    }
  }
  await sqlite.execute({ sql: `DELETE FROM actions WHERE id = ? AND room_id = ?`, args: [actionId, roomId] });
  return json({ deleted: true, id: actionId });
}

async function invokeAction(roomId: string, actionId: string, body: any, auth: AuthResult) {
  // Built-in actions: dispatch to handler
  if (actionId.startsWith("_") && BUILTIN_ACTIONS[actionId]) {
    const response = await invokeBuiltinAction(roomId, actionId, body, auth);
    appendAuditEntry(roomId, body.agent ?? auth.agentId, actionId, true, body.params ?? {}, response.status).catch(() => {});
    return response;
  }

  const agent = body.agent ?? auth.agentId;
  touchAgent(roomId, agent);

  const actionResult = await sqlite.execute({ sql: `SELECT * FROM actions WHERE id = ? AND room_id = ?`, args: [actionId, roomId] });
  const action = rows2objects(actionResult)[0];
  if (!action) {
    // Fall through to overridable built-in if no custom action registered
    if (OVERRIDABLE_BUILTINS.has(actionId) && BUILTIN_ACTIONS[actionId]) {
      const response = await invokeBuiltinAction(roomId, actionId, body, auth);
      appendAuditEntry(roomId, body.agent ?? auth.agentId, actionId, true, body.params ?? {}, response.status).catch(() => {});
      return response;
    }
    return json({ error: "action not found" }, 404);
  }
  if (!isTimerLive(action)) {
    // Distinguish cooldown (dormant, will re-enable) from truly expired
    if (action.timer_effect === "enable" && getTimerStatus(action) === "active") {
      return json({
        error: "action_cooldown", action: actionId,
        message: "action is in cooldown period",
        available_at: action.timer_expires_at ?? undefined,
        ticks_remaining: action.timer_ticks_left ?? undefined,
      }, 409);
    }
    return json({ error: "action_expired", action: actionId }, 404);
  }

  const actionScope = action.scope ?? "_shared";

  // Build context with registrar's scope access for predicate evaluation
  const ctxOpts: BuildContextOptions = { selfAgent: agent ?? undefined };
  if (actionScope !== "_shared") {
    ctxOpts.includeScopes = [actionScope];
  }
  const ctx = await buildContext(roomId, ctxOpts);

  // Check enabled
  if (action.enabled_expr) {
    try {
      if (!evaluate(action.enabled_expr, ctx)) return json({ error: "action_disabled", id: actionId }, 409);
    } catch (e: any) { return json({ error: "cel_error", field: "enabled", detail: e.message }, 400); }
  }

  // Validate and merge params
  const params = body.params ?? {};
  if (action.params_json) {
    try {
      const schema = JSON.parse(action.params_json);
      for (const [name, def] of Object.entries(schema as Record<string, any>)) {
        if (def.enum && params[name] !== undefined && !def.enum.includes(params[name])) {
          return json({ error: "invalid_param", param: name, value: params[name], allowed: def.enum }, 400);
        }
        if (def.type && params[name] !== undefined && typeof params[name] !== def.type) {
          return json({ error: "invalid_param_type", param: name, expected: def.type, actual: typeof params[name] }, 400);
        }
      }
    } catch {}
  }

  // Check if predicate
  if (action.if_expr) {
    const result = evalCelWithParams(action.if_expr, ctx, params);
    if (!result.ok) return json({ error: "cel_error", field: "if", detail: result.error }, 400);
    if (!result.value) return json({ error: "precondition_failed", action: actionId, expression: action.if_expr }, 409);
  }

  // Execute writes
  const writes = JSON.parse(action.writes_json || "[]");
  const statements: any[] = [];
  const executedWrites: any[] = [];

  for (const w of writes) {
    // Shared timestamp for consistent ${now} across scope, key + value
    const invokeTs = new Date().toISOString();

    // Resolve template vars in scope before authority check
    let writeScope = w.scope ?? "_shared";
    if (writeScope.includes("${")) {
      writeScope = writeScope.replace(/\$\{(params\.(\w+)|self|now)\}/g, (match: string, full: string, paramName: string) => {
        if (paramName !== undefined) return String(params[paramName] ?? "");
        if (full === "self") return agent ?? "";
        if (full === "now") return invokeTs;
        return match;
      });
    }

    // Scope enforcement via registrar-identity bridging
    if (writeScope !== "_shared" && !writeScope.startsWith("_")) {
      const registrarAllowed = actionScope === writeScope;
      const invokerAllowed = agent === writeScope;
      if (!registrarAllowed && !invokerAllowed) {
        return json({ error: "scope_denied", message: `action "${actionId}" cannot write to scope "${writeScope}"` }, 403);
      }
    }

    // Resolve param substitutions in key (single-pass to prevent injection)
    let key = w.key ?? null;
    if (key && key.includes("${")) {
      key = key.replace(/\$\{(params\.(\w+)|self|now)\}/g, (match: string, full: string, paramName: string) => {
        if (paramName !== undefined) return String(params[paramName] ?? "");
        if (full === "self") return agent ?? "";
        if (full === "now") return invokeTs;
        return match;
      });
    }

    // Resolve value
    let value: any;
    if (w.expr === true && typeof w.value === "string") {
      const evalResult = evalCelWithParams(w.value, ctx, params);
      if (!evalResult.ok) return json({ error: "cel_error", field: "writes[].value", detail: evalResult.error, key }, 400);
      value = evalResult.value;
    } else {
      value = deepSubstitute(w.value, params, agent ?? "", invokeTs);
    }

    let writeTimerCols = parseTimer(null);
    if (w.timer) { const tv = validateTimer(w.timer); if (tv.valid) writeTimerCols = parseTimer(w.timer); }
    const enabledExpr = w.enabled ?? null;
    const wTimerArgs = [writeTimerCols.timer_json, writeTimerCols.timer_expires_at, writeTimerCols.timer_ticks_left,
                       writeTimerCols.timer_tick_on, writeTimerCols.timer_effect, writeTimerCols.timer_started_at];

    // Handle append
    let sortKey: number | null = null;
    let arrayPushAction: any = undefined;
    if (w.append === true) {
      if (key) {
        // Array-push: append value to JSON array stored at this key
        const existing = await sqlite.execute({
          sql: `SELECT value FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [roomId, writeScope, key],
        });
        let arr: any[] = [];
        if (existing.rows.length > 0) {
          try {
            const parsed = JSON.parse(existing.rows[0][0] as string);
            arr = Array.isArray(parsed) ? parsed : [parsed];
          } catch { arr = []; }
        }
        if (value === undefined) return json({ error: "write_failed", action: actionId, reason: "value is required for array append", key }, 400);
        arr.push(value);
        arrayPushAction = arr;
      } else {
        const seqResult = await sqlite.execute({
          sql: `SELECT COALESCE(MAX(sort_key), 0) + 1 as next_seq FROM state WHERE room_id = ? AND scope = ?`,
          args: [roomId, writeScope],
        });
        sortKey = Number(rows2objects(seqResult)[0]?.next_seq ?? 1);
        key = String(sortKey);
      }
    }

    if (!key) return json({ error: "write needs a key (or use append: true)", write: w }, 400);

    // Handle merge in action writes
    if (w.merge && typeof w.merge === "object") {
      let mergePayload = deepSubstitute(w.merge, params, agent ?? "", invokeTs);
      const existing = await sqlite.execute({
        sql: `SELECT value FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [roomId, writeScope, key],
      });
      let currentValue: any = {};
      if (existing.rows.length > 0) { try { currentValue = JSON.parse(existing.rows[0][0] as string); } catch {} }
      const mergedValue = JSON.stringify(deepMerge(currentValue, mergePayload));

      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = version + 1, updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, writeScope, key, sortKey, mergedValue, enabledExpr, ...wTimerArgs],
      });
      executedWrites.push({ scope: writeScope, key, merge: mergePayload });
    } else if (w.increment) {
      // Resolve template vars in increment value, then coerce to number
      let resolvedIncrement: any = w.increment;
      if (typeof resolvedIncrement === "string") {
        resolvedIncrement = deepSubstitute(resolvedIncrement, params, agent ?? "", invokeTs);
        const n = Number(resolvedIncrement);
        resolvedIncrement = isNaN(n) ? true : n; // fall back to default if coercion fails
      }
      const actionIncrementAmount = typeof resolvedIncrement === "number" ? resolvedIncrement : (value ?? 1);
      const existing = await sqlite.execute({
        sql: `SELECT version FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [roomId, writeScope, key],
      });
      if (existing.rows.length > 0) {
        statements.push({
          sql: `UPDATE state SET value = CAST(CAST(value AS INTEGER) + CAST(? AS INTEGER) AS TEXT),
                version = version + 1, updated_at = datetime('now')
                WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [String(actionIncrementAmount), roomId, writeScope, key],
        });
      } else {
        statements.push({
          sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at, enabled_expr,
                  timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
                VALUES (?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
          args: [roomId, writeScope, key, sortKey, String(actionIncrementAmount), enabledExpr, ...wTimerArgs],
        });
      }
      executedWrites.push({ scope: writeScope, key, value });
    } else {
      const rawAction = arrayPushAction !== undefined ? arrayPushAction : value;
      const strValue = typeof rawAction === "string" ? rawAction : JSON.stringify(rawAction);
      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = version + 1, updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, writeScope, key, sortKey, strValue, enabledExpr, ...wTimerArgs],
      });
      executedWrites.push({ scope: writeScope, key, value });
    }
  }

  if (statements.length > 0) {
    try {
      await sqlite.batch(statements);
    } catch (e: any) {
      const msg = e.message || String(e);
      const detail = msg.includes("SQLITE_CONSTRAINT") ? msg.split(":").slice(1).join(":").trim() : msg;
      return json({
        error: "write_failed",
        action: actionId,
        detail,
        writes_attempted: executedWrites,
      }, 500);
    }
  }

  // Tick logical timers
  for (const w of executedWrites) {
    await tickLogicalTimers(roomId, w.scope, w.key);
  }

  // Apply on_invoke cooldown timer
  if (action.on_invoke_timer_json) {
    try {
      const invokeTimer = JSON.parse(action.on_invoke_timer_json);
      const cols = parseTimer(invokeTimer);
      await sqlite.execute({
        sql: `UPDATE actions SET timer_json = ?, timer_expires_at = ?, timer_ticks_left = ?,
              timer_tick_on = ?, timer_effect = ?, timer_started_at = ?
              WHERE id = ? AND room_id = ?`,
        args: [cols.timer_json, cols.timer_expires_at, cols.timer_ticks_left,
               cols.timer_tick_on, cols.timer_effect, cols.timer_started_at, actionId, roomId],
      });
    } catch {}
  }

  // Log invocation to _messages
  const logSeqResult = await sqlite.execute({
    sql: `SELECT COALESCE(MAX(sort_key), 0) + 1 as next_seq FROM state WHERE room_id = ? AND scope = '_messages'`,
    args: [roomId],
  });
  const logSeq = Number(rows2objects(logSeqResult)[0]?.next_seq ?? 1);
  const logValue = JSON.stringify({
    from: agent, kind: "action_invocation",
    body: `${actionId}(${Object.entries(params).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join(", ")})`,
    action: actionId, params, writes: executedWrites,
  });
  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at)
          VALUES (?, '_messages', ?, ?, ?, 1, datetime('now'))`,
    args: [roomId, String(logSeq), logSeq, logValue],
  });

  appendAuditEntry(roomId, agent, actionId, false, params, 200).catch(() => {});

  // Evaluate result expression against post-write state
  let result: any = undefined;
  if (action.result_expr) {
    try {
      const postCtx = await buildContext(roomId, {
        selfAgent: agent ?? undefined,
        includeScopes: actionScope !== "_shared" ? [actionScope] : undefined,
      });
      const evalResult = evalCelWithParams(action.result_expr, postCtx, params);
      if (evalResult.ok) {
        result = typeof evalResult.value === "bigint" ? Number(evalResult.value) : evalResult.value;
      } else {
        result = { _error: evalResult.error };
      }
    } catch (e: any) {
      result = { _error: e.message };
    }
  }

  const response: any = { invoked: true, action: actionId, agent, params, writes: executedWrites };
  if (result !== undefined) response.result = result;
  return json(response);
}

// ============ View handlers ============

async function registerView(roomId: string, body: any, auth: AuthResult) {
  const id = body.id;
  if (!id) return json({ error: "id is required" }, 400);
  if (!body.expr) return json({ error: "expr is required" }, 400);
  const scope = body.scope ?? "_shared";

  // Scope ownership enforcement
  if (scope !== "_shared") {
    if (!auth.authenticated) return json({ error: "authentication_required" }, 401);
    if (auth.kind !== "room" && !auth.grants.includes("*") && auth.agentId !== scope) {
      return json({ error: "identity_mismatch", message: `view scope "${scope}" requires authentication as "${scope}"` }, 403);
    }
  }

  // Validate expression
  const v = validateCel(body.expr);
  if (!v.valid) return json({ error: "invalid_cel", field: "expr", detail: v.error }, 400);
  if (body.enabled) {
    const ev = validateCel(body.enabled);
    if (!ev.valid) return json({ error: "invalid_cel", field: "enabled", detail: ev.error }, 400);
  }

  let timerCols = parseTimer(null);
  if (body.timer) {
    const tv = validateTimer(body.timer);
    if (!tv.valid) return json({ error: "invalid_timer", detail: tv.error }, 400);
    timerCols = parseTimer(body.timer);
  }

  const registeredBy = scope !== "_shared" ? scope : (body.registered_by ?? (auth.authenticated ? auth.agentId : null));

  await sqlite.execute({
    sql: `INSERT INTO views (id, room_id, scope, description, expr, enabled_expr,
            timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at,
            registered_by, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id, room_id) DO UPDATE SET
            scope = excluded.scope, description = excluded.description, expr = excluded.expr,
            enabled_expr = excluded.enabled_expr,
            timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
            timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
            timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at,
            registered_by = excluded.registered_by,
            version = views.version + 1`,
    args: [id, roomId, scope, body.description ?? null, body.expr, body.enabled ?? null,
           timerCols.timer_json, timerCols.timer_expires_at, timerCols.timer_ticks_left,
           timerCols.timer_tick_on, timerCols.timer_effect, timerCols.timer_started_at, registeredBy],
  });

  // Return with resolved value
  const result = await sqlite.execute({ sql: `SELECT * FROM views WHERE id = ? AND room_id = ?`, args: [id, roomId] });
  const view = rows2objects(result)[0];

  // Evaluate current value
  const ctx = await buildContext(roomId, { selfAgent: auth.agentId ?? undefined });
  const viewCtx = await buildViewContext(roomId, scope, ctx);
  let resolvedValue: any = null;
  try {
    const evalResult = evaluate(body.expr, viewCtx);
    resolvedValue = typeof evalResult === "bigint" ? Number(evalResult) : evalResult;
  } catch (e: any) {
    resolvedValue = { _error: e.message };
  }

  return json({
    id: view.id, room_id: view.room_id, scope: view.scope, description: view.description,
    expr: view.expr, enabled: view.enabled_expr, registered_by: view.registered_by,
    version: view.version, created_at: view.created_at,
    value: resolvedValue,
  }, 201);
}

async function listViews(roomId: string, auth: AuthResult) {
  const result = await sqlite.execute({ sql: `SELECT * FROM views WHERE room_id = ? ORDER BY created_at`, args: [roomId] });
  let rows = rows2objects(result);

  rows = rows.filter((row: any) => isTimerLive(row));

  const ctx = await buildContext(roomId, { selfAgent: auth.agentId ?? undefined });

  // Filter by enabled and resolve values
  const views: any[] = [];
  for (const row of rows) {
    if (row.enabled_expr) {
      try { if (!evaluate(row.enabled_expr, ctx)) continue; } catch { continue; }
    }
    const viewCtx = await buildViewContext(roomId, row.scope, ctx);
    let value: any = null;
    try {
      const evalResult = evaluate(row.expr, viewCtx);
      value = typeof evalResult === "bigint" ? Number(evalResult) : evalResult;
    } catch (e: any) {
      value = { _error: e.message };
    }
    views.push({
      id: row.id, room_id: row.room_id, scope: row.scope, description: row.description,
      expr: row.expr, enabled: row.enabled_expr, registered_by: row.registered_by,
      version: row.version, created_at: row.created_at,
      value,
    });
  }

  return json(views);
}

async function getView(roomId: string, viewId: string, auth: AuthResult) {
  const result = await sqlite.execute({ sql: `SELECT * FROM views WHERE id = ? AND room_id = ?`, args: [viewId, roomId] });
  const row = rows2objects(result)[0];
  if (!row) return json({ error: "view not found" }, 404);
  if (!isTimerLive(row)) return json({ error: "view not found" }, 404);

  const ctx = await buildContext(roomId, { selfAgent: auth.agentId ?? undefined });
  const viewCtx = await buildViewContext(roomId, row.scope, ctx);
  let value: any = null;
  try {
    const evalResult = evaluate(row.expr, viewCtx);
    value = typeof evalResult === "bigint" ? Number(evalResult) : evalResult;
  } catch (e: any) {
    value = { _error: e.message };
  }

  return json({
    id: row.id, room_id: row.room_id, scope: row.scope, description: row.description,
    expr: row.expr, enabled: row.enabled_expr, registered_by: row.registered_by,
    version: row.version, created_at: row.created_at,
    value,
  });
}

async function deleteView(roomId: string, viewId: string, auth: AuthResult) {
  const existing = await sqlite.execute({ sql: `SELECT scope FROM views WHERE id = ? AND room_id = ?`, args: [viewId, roomId] });
  if (existing.rows.length === 0) return json({ error: "view not found" }, 404);
  const scope = existing.rows[0][0] ?? "_shared";
  if (scope !== "_shared") {
    if (auth.kind !== "room" && !auth.grants.includes("*") && auth.agentId !== scope) {
      return json({ error: "view_owned", message: `view "${viewId}" owned by "${scope}"` }, 403);
    }
  }
  await sqlite.execute({ sql: `DELETE FROM views WHERE id = ? AND room_id = ?`, args: [viewId, roomId] });
  return json({ deleted: true, id: viewId });
}

// ============ Built-in actions ============

const BUILTIN_ACTIONS: Record<string, { description: string; params?: Record<string, any> }> = {
  _send_message: {
    description: "Send a message to the room",
    params: {
      body: { type: "string", description: "Message content" },
      kind: { type: "string", description: "Message kind (default: chat)" },
    },
  },
  _set_state: {
    description: "Write a value to state",
    params: {
      scope: { type: "string", description: "Scope (default: self)" },
      key: { type: "string", description: "State key" },
      value: { type: "any", description: "Value to set" },
      public: { type: "boolean", description: "Auto-create view for this key" },
      merge: { type: "object", description: "Deep merge into existing value" },
      increment: { type: "number", description: "Increment by amount" },
      if: { type: "string", description: "CEL precondition" },
      if_version: { type: "number", description: "CAS version check" },
    },
  },
  _batch_set_state: {
    description: "Write multiple values to state atomically",
    params: {
      writes: { type: "array", description: "Array of {scope, key, value, public, merge, increment} entries" },
      if: { type: "string", description: "CEL precondition for entire batch" },
    },
  },
  _delete_state: {
    description: "Delete a state entry",
    params: {
      scope: { type: "string", description: "Scope (default: _shared)" },
      key: { type: "string", description: "State key to delete" },
    },
  },
  _register_action: {
    description: "Register a new action in the room",
    params: {
      id: { type: "string", description: "Action ID" },
      scope: { type: "string", description: "Owning scope" },
      description: { type: "string", description: "Human-readable description" },
      if: { type: "string", description: "CEL availability predicate" },
      enabled: { type: "string", description: "CEL enabled expression" },
      result: { type: "string", description: "CEL expression evaluated after writes, returned to invoker" },
      writes: { type: "array", description: "State write templates" },
      params: { type: "object", description: "Parameter schema" },
    },
  },
  _delete_action: {
    description: "Delete an action from the room",
    params: { id: { type: "string", description: "Action ID to delete" } },
  },
  _register_view: {
    description: "Register a computed view",
    params: {
      id: { type: "string", description: "View ID" },
      expr: { type: "string", description: "CEL expression" },
      scope: { type: "string", description: "Registrar scope (default: self)" },
      description: { type: "string", description: "Human-readable description" },
    },
  },
  _delete_view: {
    description: "Delete a view from the room",
    params: { id: { type: "string", description: "View ID to delete" } },
  },
  _heartbeat: {
    description: "Send a heartbeat to maintain active status",
    params: { status: { type: "string", description: "Agent status (default: active)" } },
  },
  _renew_timer: {
    description: "Renew a wall-clock timer on a state entry",
    params: {
      scope: { type: "string", description: "Scope (default: _shared)" },
      key: { type: "string", description: "State key with timer" },
    },
  },
  help: {
    description: "Room-specific participant guide (overridable by custom action)",
    params: {},
  },
};

/** Built-in actions that can be overridden by custom actions with the same id.
 *  If a room registers a custom action with one of these ids, the custom one
 *  wins in both context listing and invocation. */
const OVERRIDABLE_BUILTINS = new Set(["help"]);

/** Append a structured audit entry to the _audit scope (fire-and-forget) */
async function appendAuditEntry(roomId: string, agent: string | null, action: string, builtin: boolean, params: Record<string, any>, status: number) {
  try {
    const seqResult = await sqlite.execute({
      sql: `SELECT COALESCE(MAX(sort_key), 0) + 1 as next_seq FROM state WHERE room_id = ? AND scope = '_audit'`,
      args: [roomId],
    });
    const seq = Number(rows2objects(seqResult)[0]?.next_seq ?? 1);
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      agent: agent ?? "admin",
      action,
      builtin,
      params,
      ok: status < 400,
    });
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at)
            VALUES (?, '_audit', ?, ?, ?, 1, datetime('now'))`,
      args: [roomId, String(seq), seq, entry],
    });
  } catch {}
}

/** Build expanded context with message bodies, full action definitions, and built-in actions */
async function buildExpandedContext(roomId: string, auth: AuthResult, opts?: { messagesAfter?: number; messagesLimit?: number }): Promise<Record<string, any>> {
  const ctx = await buildContext(roomId, {
    selfAgent: auth.agentId ?? undefined,
    allScopes: hasFullReadAccess(auth),
  });

  // Expand messages with bodies
  const messagesLimit = Math.min(opts?.messagesLimit ?? 50, 200);
  let msgSql = `SELECT * FROM state WHERE room_id = ? AND scope = '_messages'`;
  const msgArgs: any[] = [roomId];
  if (opts?.messagesAfter) {
    msgSql += ` AND sort_key > ?`;
    msgArgs.push(opts.messagesAfter);
  }
  msgSql += ` ORDER BY sort_key DESC LIMIT ?`;
  msgArgs.push(messagesLimit);
  const msgResult = await sqlite.execute({ sql: msgSql, args: msgArgs });
  let msgRows = rows2objects(msgResult).filter((r: any) => isTimerLive(r));
  msgRows.reverse();
  const recentMessages = msgRows.map((r: any) => {
    let parsed: any = {};
    try { parsed = JSON.parse(r.value); } catch { parsed = { body: r.value }; }
    return { seq: r.sort_key, ...parsed };
  });

  // Update last_seen_seq
  if (auth.agentId && recentMessages.length > 0) {
    const maxSeq = Math.max(...recentMessages.map((m: any) => m.seq ?? 0));
    if (maxSeq > 0) {
      sqlite.execute({
        sql: `UPDATE agents SET last_seen_seq = MAX(last_seen_seq, ?) WHERE id = ? AND room_id = ?`,
        args: [maxSeq, auth.agentId, roomId],
      }).catch(() => {});
    }
  }

  // Expand actions with full definitions
  const actionResult = await sqlite.execute({
    sql: `SELECT * FROM actions WHERE room_id = ? ORDER BY created_at`, args: [roomId],
  });
  let actionRows = rows2objects(actionResult);
  actionRows = actionRows.filter((row: any) => isTimerLive(row));

  const expandedActions: Record<string, any> = {};
  for (const row of actionRows) {
    if (row.enabled_expr) {
      try { if (!evaluate(row.enabled_expr, ctx)) continue; } catch { continue; }
    }
    const entry: any = {
      available: true,
      enabled: true,
      description: row.description ?? null,
    };
    if (row.params_json) {
      try { entry.params = JSON.parse(row.params_json); } catch {}
    }
    if (row.writes_json) {
      try { const w = JSON.parse(row.writes_json); if (w.length > 0) entry.writes = w; } catch {}
    }
    if (row.scope && row.scope !== "_shared") entry.scope = row.scope;
    if (row.if_expr) {
      try { entry.available = !!evaluate(row.if_expr, ctx); } catch { entry.available = false; }
    }
    expandedActions[row.id] = entry;
  }

  // Add built-in actions (skip overridable ones that have a custom registration)
  for (const [id, def] of Object.entries(BUILTIN_ACTIONS)) {
    if (OVERRIDABLE_BUILTINS.has(id) && expandedActions[id]) continue;
    expandedActions[id] = {
      available: true,
      enabled: true,
      builtin: true,
      description: def.description,
      params: def.params ?? null,
    };
  }

  return {
    state: ctx.state,
    views: ctx.views,
    agents: ctx.agents,
    actions: expandedActions,
    messages: {
      count: ctx.messages.count,
      unread: ctx.messages.unread,
      recent: recentMessages,
    },
    self: ctx.self,
  };
}

async function invokeBuiltinAction(roomId: string, actionId: string, body: any, auth: AuthResult): Promise<Response> {
  const agent = body.agent ?? auth.agentId;
  const params = body.params ?? {};
  touchAgent(roomId, agent);

  switch (actionId) {
    case "_send_message": {
      const msgBody = params.body;
      if (!msgBody) return json({ error: "params.body is required" }, 400);
      const kind = params.kind ?? "chat";
      const seqResult = await sqlite.execute({
        sql: `SELECT COALESCE(MAX(sort_key), 0) + 1 as next_seq FROM state WHERE room_id = ? AND scope = '_messages'`,
        args: [roomId],
      });
      const seq = Number(rows2objects(seqResult)[0]?.next_seq ?? 1);
      const value = JSON.stringify({ from: agent, kind, body: msgBody });
      await sqlite.execute({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at)
              VALUES (?, '_messages', ?, ?, ?, 1, datetime('now'))`,
        args: [roomId, String(seq), seq, value],
      });
      return json({ ok: true, action: "_send_message", seq, from: agent, kind });
    }

    case "_set_state": {
      // Default scope to agent's own scope for built-in
      const stateBody = {
        scope: params.scope ?? auth.agentId ?? "_shared",
        key: params.key,
        value: params.value,
        public: params.public,
        merge: params.merge,
        increment: params.increment,
        if: params.if,
        if_version: params.if_version,
        timer: params.timer,
        enabled: params.enabled,
        append: params.append,
      };
      return setState(roomId, stateBody, auth);
    }

    case "_batch_set_state": {
      // Default each write's scope to agent's own scope (matching _set_state behavior)
      const defaultScope = auth.agentId ?? "_shared";
      const writes = (params.writes ?? []).map((w: any) => ({
        ...w,
        scope: w.scope ?? defaultScope,
      }));
      return batchSetState(roomId, { writes, if: params.if }, auth);
    }

    case "_delete_state": {
      return deleteState(roomId, { scope: params.scope ?? "_shared", key: params.key }, auth);
    }

    case "_register_action": {
      return registerAction(roomId, {
        id: params.id,
        scope: params.scope,
        description: params.description,
        if: params.if,
        enabled: params.enabled,
        result: params.result,
        writes: params.writes,
        params: params.params,
        timer: params.timer,
        on_invoke: params.on_invoke,
      }, auth);
    }

    case "_delete_action": {
      if (!params.id) return json({ error: "params.id is required" }, 400);
      return deleteAction(roomId, params.id, auth);
    }

    case "_register_view": {
      return registerView(roomId, {
        id: params.id,
        expr: params.expr,
        scope: params.scope ?? auth.agentId ?? "_shared",
        description: params.description,
        enabled: params.enabled,
        timer: params.timer,
      }, auth);
    }

    case "_delete_view": {
      if (!params.id) return json({ error: "params.id is required" }, 400);
      return deleteView(roomId, params.id, auth);
    }

    case "_heartbeat": {
      if (!agent) return json({ error: "no agent identity" }, 400);
      return heartbeat(roomId, agent, { status: params.status ?? "active" });
    }

    case "_renew_timer": {
      return renewStateTimer(roomId, { scope: params.scope ?? "_shared", key: params.key });
    }

    case "help": {
      return json({ invoked: true, action: "help", result: HELP_CONTENT });
    }

    default:
      return json({ error: "unknown builtin action", id: actionId }, 404);
  }
}

// ============ Context endpoint ============

async function getContext(roomId: string, url: URL, auth: AuthResult) {
  touchAgent(roomId, auth.agentId);

  const messagesAfter = url.searchParams.get("messages_after");
  const messagesLimit = url.searchParams.get("messages_limit");

  const fullCtx = await buildExpandedContext(roomId, auth, {
    messagesAfter: messagesAfter ? parseInt(messagesAfter) : undefined,
    messagesLimit: messagesLimit ? parseInt(messagesLimit) : undefined,
  });

  // Optionally filter to specific sections
  const only = url.searchParams.get("only");
  if (only) {
    const sections = only.split(",").map(s => s.trim());
    const filtered: Record<string, any> = {};
    for (const s of sections) {
      if (s in fullCtx) filtered[s] = (fullCtx as any)[s];
      if (s.startsWith("state.")) {
        const scope = s.slice(6);
        if (!filtered.state) filtered.state = {};
        filtered.state[scope] = fullCtx.state?.[scope] ?? {};
      }
    }
    if (!filtered.self && fullCtx.self) filtered.self = fullCtx.self;
    return json(filtered);
  }

  // Strip _audit and _messages from state by default — _audit grows unbounded
  // and messages are already returned as a dedicated parsed section.
  // Opt-in via ?include=_audit or ?include=_audit,_messages
  const include = url.searchParams.get("include");
  const includedScopes = include ? include.split(",").map(s => s.trim()) : [];
  if (fullCtx.state) {
    if (!includedScopes.includes("_audit")) delete fullCtx.state._audit;
    if (!includedScopes.includes("_messages")) delete fullCtx.state._messages;
  }

  return json(fullCtx);
}

// ============ Dashboard poll endpoint ============

/** Single-request bundle for dashboard polling. Returns all data sets in one response. */
async function dashboardPoll(roomId: string, url: URL, auth: AuthResult) {
  const messagesLimit = Math.min(parseInt(url.searchParams.get("messages_limit") ?? "500"), 2000);
  const auditLimit = Math.min(parseInt(url.searchParams.get("audit_limit") ?? "500"), 2000);

  // Run all queries concurrently — same logic as the individual endpoints
  const [agentsRes, stateRes, msgsRes, actionsRes, viewsRes, auditRes] = await Promise.all([
    // Agents
    sqlite.execute({ sql: `SELECT * FROM agents WHERE room_id = ? ORDER BY joined_at`, args: [roomId] }),
    // State (respects scope privacy, excludes _messages and _audit which have dedicated sections)
    (async () => {
      let sql = `SELECT * FROM state WHERE room_id = ? AND scope != '_messages' AND scope != '_audit'`;
      const args: any[] = [roomId];
      if (hasFullReadAccess(auth)) {
        // admin or view token: everything
      } else if (auth.authenticated && auth.kind === "agent") {
        const accessibleScopes = [auth.agentId!, ...auth.grants].filter(Boolean);
        const conditions = [`scope LIKE '\\_%' ESCAPE '\\'`];
        for (const s of accessibleScopes) { conditions.push(`scope = ?`); args.push(s); }
        sql += ` AND (${conditions.join(" OR ")})`;
      } else {
        sql += ` AND scope LIKE '\\_%' ESCAPE '\\'`;
      }
      sql += ` ORDER BY CASE WHEN sort_key IS NOT NULL THEN sort_key ELSE 0 END ASC LIMIT 500`;
      return sqlite.execute({ sql, args });
    })(),
    // Messages
    sqlite.execute({
      sql: `SELECT * FROM state WHERE room_id = ? AND scope = '_messages' ORDER BY sort_key ASC LIMIT ?`,
      args: [roomId, messagesLimit],
    }),
    // Actions
    sqlite.execute({ sql: `SELECT * FROM actions WHERE room_id = ? ORDER BY created_at`, args: [roomId] }),
    // Views
    sqlite.execute({ sql: `SELECT * FROM views WHERE room_id = ? ORDER BY created_at`, args: [roomId] }),
    // Audit
    sqlite.execute({
      sql: `SELECT * FROM state WHERE room_id = ? AND scope = '_audit' ORDER BY sort_key ASC LIMIT ?`,
      args: [roomId, auditLimit],
    }),
  ]);

  // Process agents
  const agents = rows2objects(agentsRes).map((a: any) => { delete a.token_hash; return a; });

  // Process state with timer/enabled filtering
  const ctx = await buildContext(roomId, { selfAgent: auth.agentId ?? undefined });
  let stateRows = rows2objects(stateRes);
  stateRows = stateRows.filter((row: any) => {
    if (!isTimerLive(row)) return false;
    if (row.enabled_expr) {
      try { return !!evaluate(row.enabled_expr, ctx); } catch { return false; }
    }
    return true;
  }).map((row: any) => {
    try { return { ...row, value: JSON.parse(row.value) }; } catch { return row; }
  });

  // Process messages
  let msgs = rows2objects(msgsRes);
  msgs = msgs.filter((row: any) => isTimerLive(row)).map((row: any) => {
    try { return { ...row, value: JSON.parse(row.value) }; } catch { return row; }
  });

  // Process actions
  let actionRows = rows2objects(actionsRes);
  actionRows = actionRows.filter((row: any) => isTimerLive(row));
  actionRows = actionRows.filter((row: any) => {
    if (!row.enabled_expr) return true;
    try { return !!evaluate(row.enabled_expr, ctx); } catch { return false; }
  });
  const actions = actionRows.map((row: any) => {
    const action = formatAction(row);
    if (row.if_expr) {
      try { action.available = !!evaluate(row.if_expr, ctx); } catch { action.available = false; }
    } else { action.available = true; }
    return action;
  });

  // Process views
  let viewRows = rows2objects(viewsRes);
  viewRows = viewRows.filter((row: any) => isTimerLive(row));
  const views: any[] = [];
  for (const row of viewRows) {
    if (row.enabled_expr) {
      try { if (!evaluate(row.enabled_expr, ctx)) continue; } catch { continue; }
    }
    const viewCtx = await buildViewContext(roomId, row.scope, ctx);
    let value: any = null;
    try {
      const evalResult = evaluate(row.expr, viewCtx);
      value = typeof evalResult === "bigint" ? Number(evalResult) : evalResult;
    } catch (e: any) { value = { _error: e.message }; }
    views.push({
      id: row.id, room_id: row.room_id, scope: row.scope, description: row.description,
      expr: row.expr, enabled: row.enabled_expr, registered_by: row.registered_by,
      version: row.version, created_at: row.created_at, value,
    });
  }

  // Process audit
  let auditRows = rows2objects(auditRes);
  auditRows = auditRows.map((row: any) => {
    try { return { ...row, value: JSON.parse(row.value) }; } catch { return row; }
  });

  return json({ agents, state: stateRows, messages: msgs, actions, views, audit: auditRows });
}

// ============ Auto-view helper ============

/** Create or update an auto-view for a state entry marked public: true */
async function ensureAutoView(roomId: string, scope: string, key: string, auth: AuthResult) {
  const viewId = `${scope}.${key}`;
  const expr = `state["${scope}"]["${key}"]`;
  const registeredBy = scope;

  await sqlite.execute({
    sql: `INSERT INTO views (id, room_id, scope, description, expr, registered_by, version)
          VALUES (?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id, room_id) DO UPDATE SET
            expr = excluded.expr, scope = excluded.scope,
            registered_by = excluded.registered_by,
            version = views.version + 1`,
    args: [viewId, roomId, scope, `auto: ${scope}.${key}`, expr, registeredBy],
  });
}

/** Remove an auto-view when public: false */
async function removeAutoView(roomId: string, scope: string, key: string) {
  const viewId = `${scope}.${key}`;
  await sqlite.execute({
    sql: `DELETE FROM views WHERE id = ? AND room_id = ? AND description LIKE 'auto:%'`,
    args: [viewId, roomId],
  });
}

// ============ View token rotation ============

async function rotateViewToken(roomId: string) {
  const viewToken = generateToken("view");
  const viewHash = await hashToken(viewToken);
  const result = await sqlite.execute({
    sql: `UPDATE rooms SET view_token_hash = ? WHERE id = ?`,
    args: [viewHash, roomId],
  });
  if (result.rowsAffected === 0) return json({ error: "room not found" }, 404);
  return json({ ok: true, view_token: viewToken });
}

// ============ CEL eval endpoint ============

async function evalExpression(roomId: string, body: any, auth: AuthResult) {
  const expr = body.expr;
  if (!expr || typeof expr !== "string") return json({ error: "expr string is required" }, 400);
  touchAgent(roomId, auth.agentId);
  const ctx = await buildContext(roomId, { selfAgent: auth.agentId ?? undefined });
  const result = await evalCel(roomId, expr, ctx);
  if (!result.ok) return json({ error: "cel_error", expression: expr, detail: result.error }, 400);
  return json({ expression: expr, value: result.value });
}

// ============ Timer renewal ============

async function renewStateTimer(roomId: string, body: any) {
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
    sql: `UPDATE state SET timer_expires_at = ?, timer_started_at = datetime('now') WHERE room_id = ? AND scope = ? AND key = ?`,
    args: [renewal.expires_at, roomId, scope, key],
  });
  const updated = await sqlite.execute({ sql: `SELECT * FROM state WHERE room_id = ? AND scope = ? AND key = ?`, args: [roomId, scope, key] });
  return json(rows2objects(updated)[0]);
}

// ============ Conditional Wait ============

const MAX_WAIT_MS = 25_000;
const POLL_INTERVAL_MS = 1_000;

async function buildIncludeData(roomId: string, includeParam: string | null, ctx: Record<string, any>) {
  const data: Record<string, any> = {};
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
    if (trimmed === "views") data.views = ctx.views;
  }
  return data;
}

async function waitForCondition(roomId: string, url: URL, auth: AuthResult) {
  const condition = url.searchParams.get("condition");
  const agent = url.searchParams.get("agent") ?? auth.agentId;
  const timeoutParam = url.searchParams.get("timeout");
  const includeParam = url.searchParams.get("include");
  if (!condition) return json({ error: "condition parameter is required (CEL expression)" }, 400);
  const validation = validateCel(condition);
  if (!validation.valid) return json({ error: "invalid_cel", expression: condition, detail: validation.error }, 400);
  const timeout = Math.min(timeoutParam ? parseInt(timeoutParam) : MAX_WAIT_MS, MAX_WAIT_MS);

  // include=context (or no include param) returns full context object
  const wantFullContext = !includeParam || includeParam === "context";

  if (agent) {
    await sqlite.execute({
      sql: `UPDATE agents SET status = 'waiting', waiting_on = ?, last_heartbeat = datetime('now') WHERE id = ? AND room_id = ?`,
      args: [condition, agent, roomId],
    });
  }

  const startTime = Date.now();
  try {
    while (Date.now() - startTime < timeout) {
      const ctx = await buildContext(roomId, { selfAgent: agent ?? undefined });
      const result = await evalCel(roomId, condition, ctx);
      if (result.ok && result.value) {
        if (agent) {
          await sqlite.execute({
            sql: `UPDATE agents SET status = 'active', waiting_on = NULL, last_heartbeat = datetime('now') WHERE id = ? AND room_id = ?`,
            args: [agent, roomId],
          });
        }
        if (wantFullContext) {
          const expanded = await buildExpandedContext(roomId, auth);
          if (expanded.state) { delete expanded.state._audit; delete expanded.state._messages; }
          return json({ triggered: true, condition, context: expanded });
        }
        const includeData = await buildIncludeData(roomId, includeParam, ctx);
        return json({ triggered: true, condition, value: result.value, ...includeData });
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (agent) {
      await sqlite.execute({
        sql: `UPDATE agents SET status = 'active', waiting_on = NULL, last_heartbeat = datetime('now') WHERE id = ? AND room_id = ?`,
        args: [agent, roomId],
      });
    }
    if (wantFullContext) {
      const expanded = await buildExpandedContext(roomId, auth);
      if (expanded.state) { delete expanded.state._audit; delete expanded.state._messages; }
      return json({ triggered: false, timeout: true, elapsed_ms: Date.now() - startTime, context: expanded });
    }
    const ctx = await buildContext(roomId, { selfAgent: agent ?? undefined });
    const includeData = await buildIncludeData(roomId, includeParam, ctx);
    return json({ triggered: false, timeout: true, elapsed_ms: Date.now() - startTime, ...includeData });
  } catch (e) {
    if (agent) {
      try { await sqlite.execute({ sql: `UPDATE agents SET status = 'active', waiting_on = NULL WHERE id = ? AND room_id = ?`, args: [agent, roomId] }); } catch {}
    }
    throw e;
  }
}

/** Strip null values from JSON-serializable data */
function stripNulls(data: any): any {
  if (data === null || data === undefined) return undefined;
  if (Array.isArray(data)) return data.map(stripNulls);
  if (typeof data === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && v !== undefined) out[k] = stripNulls(v);
    }
    return out;
  }
  return data;
}

// ============ Router ============

export default async function (req: Request) {
  await ensureMigrated();
  const url = new URL(req.url);
  const compact = url.searchParams.get("compact") === "true";

  const response = await route(req, url);

  if (compact && response.headers.get("Content-Type")?.includes("json")) {
    const data = await response.json();
    return json(stripNulls(data), response.status);
  }
  return response;
}

async function route(req: Request, _url?: URL): Promise<Response> {
  const url = _url ?? new URL(req.url);
  const method = req.method;
  const parts = url.pathname.split("/").filter(Boolean);

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

  // POST /rooms
  if (method === "POST" && parts[0] === "rooms" && parts.length === 1) {
    const body = await parseBody(req);
    if (body === PARSE_FAILED) return json({ error: "invalid JSON" }, 400);
    return createRoom(body);
  }
  // GET /rooms
  if (method === "GET" && parts[0] === "rooms" && parts.length === 1) return listRooms(req);
  // GET /rooms/:id
  if (method === "GET" && parts[0] === "rooms" && parts.length === 2 && parts[1] !== "") return getRoom(parts[1]);

  const roomId = parts[1];
  if (!roomId || parts[0] !== "rooms") {
    // Root — serve the React SPA (handles both landing and dashboard)
    if (url.pathname === "/" || url.pathname === "") {
      return new Response(FRONTEND_HTML, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }
    // Frontend module proxy — redirect to esm.town for transpilation
    if (method === "GET" && url.pathname.startsWith("/frontend/")) {
      const modulePath = url.pathname.slice(1); // "frontend/index.tsx"
      const moduleUrl = new URL(`./${modulePath}`, import.meta.url).href;
      // Add cache-busting param to defeat esm.town CDN cache
      const bustUrl = `${moduleUrl}?v=${Date.now()}`;
      return new Response(null, {
        status: 302,
        headers: {
          "Location": bustUrl,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }
    // SKILL.md — orchestrator skill (README content)
    if (method === "GET" && (url.pathname === "/SKILL.md" || url.pathname === "/skill.md")) {
      return new Response(README, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    // Reference docs
    if (method === "GET" && parts[0] === "reference" && parts.length === 2) {
      const doc = REFERENCE_FILES[parts[1]];
      if (doc) return new Response(doc, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    return json({ error: "not found" }, 404);
  }

  // Parse body for mutations
  let body: any = undefined;
  if (method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH") {
    body = await parseBody(req);
    if (body === PARSE_FAILED) return json({ error: "invalid JSON" }, 400);
  }

  // Resolve auth for all room-scoped requests
  const authResult = await resolveAuth(req, roomId);
  if (authResult instanceof Response) return authResult;
  const auth = authResult;

  const sub = parts[2];
  const subId = parts[3];
  const subAction = parts[4];

  // ---- Agents ----
  if (sub === "agents") {
    if (method === "POST" && !subId) return joinRoom(roomId, body, req);
    if (method === "PATCH" && subId && !subAction) {
      const deny = requireRoomToken(auth);
      if (deny) return deny;
      return updateAgent(roomId, subId, body);
    }
  }

  // ---- Actions (invoke only — writes via built-in actions) ----
  if (sub === "actions") {
    if (method === "POST" && subId && subAction === "invoke") {
      const deny = requireWriteAuth(auth);
      if (deny) return deny;
      const identityDeny = assertIdentity(auth, body.agent);
      if (identityDeny) return identityDeny;
      return invokeAction(roomId, subId, body, auth);
    }
  }

  // ---- Wait ----
  if (method === "GET" && sub === "wait") return waitForCondition(roomId, url, auth);

  // ---- Context ----
  if (method === "GET" && sub === "context") return getContext(roomId, url, auth);

  // ---- Dashboard poll ----
  if (method === "GET" && sub === "poll") return dashboardPoll(roomId, url, auth);

  // ---- CEL eval ----
  if (method === "POST" && sub === "eval") {
    return evalExpression(roomId, body, auth);
  }

  // ---- View token rotation (admin only) ----
  if (method === "POST" && sub === "rotate-view-token") {
    const deny = requireRoomToken(auth);
    if (deny) return deny;
    return rotateViewToken(roomId);
  }

  // ---- Generate view token for existing rooms that don't have one (admin only) ----
  if (method === "POST" && sub === "generate-view-token") {
    const deny = requireRoomToken(auth);
    if (deny) return deny;
    // Check if room already has a view token
    const existing = await sqlite.execute({
      sql: `SELECT view_token_hash FROM rooms WHERE id = ?`, args: [roomId],
    });
    const room = rows2objects(existing)[0];
    if (room?.view_token_hash) {
      return json({ error: "view_token_exists", message: "room already has a view token — use rotate-view-token to replace it" }, 409);
    }
    return rotateViewToken(roomId);
  }

  return json({ error: "not found" }, 404);
}
