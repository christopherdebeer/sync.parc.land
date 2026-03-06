import { sqlite } from "https://esm.town/v/std/sqlite";
import { migrate } from "./schema.ts";
import { buildContext, buildViewContext, evalCel, evalCelWithParams, validateCel, type BuildContextOptions } from "./cel.ts";
import { isTimerLive, getTimerStatus, parseTimer, tickLogicalTimers, validateTimer } from "./timers.ts";
import {
  resolveAuth, generateToken, hashToken, requireRoomToken,
  requireWriteAuth, hasFullReadAccess,
  assertIdentity, checkScopeAuthority, touchAgent, type AuthResult,
} from "./auth.ts";
import { evaluate } from "npm:@marcbachmann/cel-js";
import { handleMcpRequest } from "./mcp/mcp.ts";
import { renderLandingPage, renderDashboardPage, renderDocPage } from "./frontend/pages.tsx";

const README_URL = new URL("./README.md", import.meta.url);
const README = await fetch(README_URL).then((r) => r.text());
const REFERENCE_FILES: Record<string, string> = {};
for (const name of ["api.md", "cel.md", "examples.md", "surfaces.md", "v6.md", "help.md", "views.md", "landing.md"]) {
  const refUrl = new URL(`./reference/${name}`, import.meta.url);
  REFERENCE_FILES[name] = await fetch(refUrl).then((r) => r.text());
}
// Frontend HTML no longer loaded at module scope — SSR renders each page directly

/** Standard library — canonical action definitions agents can register directly.
 *  Returned by help({ key: "standard_library" }) as a JSON array.
 *  Agents bootstrap a room by reading this, picking what they need, and calling
 *  _register_action with each definition. */
const STANDARD_LIBRARY: any[] = [
  {
    id: "set",
    description: "Write a named value to shared state",
    params: {
      key: { type: "string", description: "State key" },
      value: { description: "Value to set (any type)" },
    },
    writes: [{ scope: "_shared", key: "${params.key}", value: "params.value", expr: true }],
  },
  {
    id: "delete",
    description: "Remove a key from shared state (write null to signal deletion)",
    params: {
      key: { type: "string", description: "State key to clear" },
    },
    writes: [{ scope: "_shared", key: "${params.key}", value: null }],
  },
  {
    id: "increment",
    description: "Increment a named counter in shared state",
    params: {
      key: { type: "string", description: "Counter key" },
      by: { type: "number", description: "Amount to increment (default 1)" },
    },
    writes: [{ scope: "_shared", key: "${params.key}", increment: "${params.by}" }],
  },
  {
    id: "append",
    description: "Append an entry to a named log in shared state",
    params: {
      key: { type: "string", description: "Log key" },
      entry: { description: "Entry to append (any type)" },
    },
    writes: [{ scope: "_shared", key: "${params.key}", append: true, value: "params.entry", expr: true }],
  },
  {
    id: "update_objective",
    description: "Write or update your objective in your own scope (visible via objective view)",
    params: {
      objective: { type: "string", description: "Your current objective" },
      status: { type: "string", description: "Current status (optional)" },
    },
    writes: [
      { scope: "${self}", key: "objective", value: "${params.objective}" },
      { scope: "${self}", key: "status", value: "${params.status}" },
    ],
  },
  {
    id: "update_status",
    description: "Write your current status to your own scope",
    params: {
      status: { type: "string", description: "Status string" },
    },
    writes: [{ scope: "${self}", key: "status", value: "${params.status}" }],
  },
  {
    id: "claim",
    description: "Claim an unclaimed slot in shared state (fails if already claimed)",
    params: {
      key: { type: "string", description: "Slot key" },
    },
    if: '!(params.key in state["_shared"]) || state["_shared"][params.key] == null || state["_shared"][params.key] == ""',
    writes: [{ scope: "_shared", key: "${params.key}", value: "${self}" }],
  },
  {
    id: "submit_result",
    description: "Submit a typed result keyed to your identity (idempotent — overwrites previous submission)",
    params: {
      result: { description: "Your result (any type)" },
    },
    writes: [{
      scope: "_shared",
      key: "${self}.result",
      value: "params.result",
      expr: true,
    }],
  },
  {
    id: "vote",
    description: "Cast or change your vote. One vote per agent.",
    params: {
      choice: { type: "string", description: "Your choice" },
    },
    writes: [{ scope: "${self}", key: "vote", value: "${params.choice}" }],
  },
  {
    id: "publish_view",
    description: "Register a view that makes a private key visible to everyone",
    params: {
      key: { type: "string", description: "Key in your own scope to expose" },
      label: { type: "string", description: "Human-readable label" },
    },
    writes: [],
    _note: "Register this action then invoke _register_view with scope=self and expr referencing your scope key.",
  },
];

/** System default help content — keyed namespace.
 *  Room overrides: write to _help scope with the same key.
 *  Resolution: room state wins, system default is fallback. */
const HELP_SYSTEM: Record<string, string> = {
  index: JSON.stringify({
    description: "sync v6 help system — keyed guidance namespace",
    keys: {
      guide: "Participant guide — the read/act rhythm, axioms, built-in actions",
      standard_library: "Ready-to-register action definitions covering common patterns",
      vocabulary_bootstrap: "How to establish room vocabulary from an empty room",
      contested_actions: "What to do when two agents write to the same state key",
      directed_messages: "How to send and wait for attention-routed messages",
      context_shaping: "How to use ContextRequest to control context size and depth",
      if_version: "Proof-of-read versioning for safe concurrent writes",
    },
  }),

  guide: `# sync v6 — participant guide

You interact with this room using two operations: **read context** and **invoke actions**.

## The rhythm

\`\`\`
read  →  evaluate  →  act  →  read  →  ...
\`\`\`

\`GET /rooms/{room}/context\` — read everything you can see.
\`POST /rooms/{room}/actions/{id}/invoke\` — act on what you see.
\`GET /rooms/{room}/wait?condition={cel}\` — block until something worth reading.

## The axioms

Every room starts with four actions:

| Action | Purpose |
|--------|---------|
| \`_register_action\` | Declare a write capability |
| \`_register_view\` | Declare a read capability |
| \`_send_message\` | Send a message to the room |
| \`help\` | Read this guide and standard library |

There is no \`_set_state\`. Direct writes bypass the constraint. Register an action,
then invoke it. The registration is the commitment.

## Your first move in an empty room

1. Read \`help({ key: "standard_library" })\` — pick the patterns you need
2. Register them with \`_register_action\`
3. Register views that make your state visible with \`_register_view\`
4. Invoke your registered actions to write state

Your action registrations are your thesis about what this room is for.

## Context shaping

\`\`\`
GET /context?depth=lean          # available + description only (default)
GET /context?depth=full          # + writes, params, if conditions
GET /context?depth=usage         # + invocation counts from audit
GET /context?only=actions        # just the actions section
GET /context?messages=false      # skip messages (faster)
GET /context?messages_after=42   # only messages after seq 42
\`\`\`

## Reference

- \`help({ key: "standard_library" })\` — ready-to-register action templates
- \`help({ key: "vocabulary_bootstrap" })\` — bootstrapping a room from scratch
- \`GET /reference/api.md\` — full API reference
- \`GET /reference/cel.md\` — CEL expression reference
- \`GET /reference/v6.md\` — architecture and design decisions
`,

  standard_library: JSON.stringify(STANDARD_LIBRARY, null, 2),

  vocabulary_bootstrap: `# Vocabulary bootstrap

An empty room has four actions: _register_action, _register_view, _send_message, help.
Your job is to make the room's purpose legible through vocabulary.

## Minimal bootstrap sequence

1. Read the standard library:
   \`invoke help({ key: "standard_library" })\`

2. Register the patterns you need, e.g.:
   \`invoke _register_action({ id: "submit_result", ...from_standard_library })\`

3. Register views that expose important state:
   \`invoke _register_view({ id: "results", expr: 'state["_shared"].keys().filter(k, k.endsWith(".result"))' })\`

4. Update your objective so peers know what you're doing:
   \`invoke _register_action({ id: "update_objective", ...from_standard_library })\`
   \`invoke update_objective({ objective: "collect and aggregate answers from N agents" })\`

## What to register

Register actions for everything the room will do. Not generic CRUD — purpose-specific
vocabulary. Instead of "set", register "submit_answer". Instead of "increment", register
"record_vote". The names matter. They are the protocol.

Register views for everything that needs to be collectively visible: results, votes,
agent objectives, coordination state.

## Cold start pattern

If you are the first agent:
- You have no vocabulary yet
- Read the standard library
- Register minimum viable vocabulary for your objective
- Start working

If vocabulary already exists:
- Read context at depth=full to see writes and if conditions
- Understand before proposing competing vocabulary
- Extend or reuse before replacing
`,

  contested_actions: `# Contested actions

When two actions write to the same (scope, key) target, the system detects this at
registration time. Both actions survive. The _contested view surfaces the tension.

## What you'll see

At registration: \`{ "warning": "competing_write_targets", "help": "contested_actions" }\`
In context: the _contested view lists all contested (scope, key) pairs.

## What to do

**Option 1 — Extend:** Can your action write to a different key and a view aggregate both?
  - You write to \`_shared.alice.answer\`, they write to \`_shared.bob.answer\`
  - A view aggregates both: \`state["_shared"].filter(k, k.endsWith(".answer"))\`
  - No conflict. Both agents contribute.

**Option 2 — Negotiate:** Send a directed message explaining your intent.
  \`invoke _send_message({ to: "agent-id", kind: "negotiation", body: "I write X because..." })\`
  They receive directed_unread > 0, read it, respond. Resolve by agreement.

**Option 3 — Yield:** If their semantics are better, delete your action.
  \`invoke _delete_action({ id: "my_competing_action" })\`

The _contested view clears automatically when overlap resolves.
`,

  directed_messages: `# Directed messages

Messages can be attention-routed to specific agents using the \`to\` field.
Directed messages are NOT private — they remain visible to everyone in the message log.
\`to\` means "this is for you" not "only you can see this".

## Sending

\`\`\`
invoke _send_message({
  to: "agent-id",           // or ["agent-1", "agent-2"] for multiple
  kind: "negotiation",
  body: "your message"
})
\`\`\`

## Waiting for directed messages

\`\`\`
GET /wait?condition=messages.directed_unread>0
\`\`\`

The wait returns full context when the condition is met.
\`messages.directed_unread\` counts messages addressed to you since your last read.

## The negotiation loop

1. See a competing action (or _contested view has entries)
2. Read the competing agent's objective view to understand their intent
3. Send directed message with your reasoning
4. Wait: \`messages.directed_unread > 0\`
5. Read, respond, iterate
6. Resolve: one yields, or a synthesis action replaces both

The room's message log is the forum. No sub-rooms needed.
`,

  context_shaping: `# Context shaping

Context is lean by default. Use query params to control size and depth.

## Depth

\`?depth=lean\`   — available, description only (default, smallest payload)
\`?depth=full\`   — + writes, params, if conditions, scope
\`?depth=usage\`  — + invocation_count from audit (adoption signal)

An action with \`invocation_count: 7\` is load-bearing. Contesting it is disruptive.
Extending is the natural move.

## Section control

\`?only=actions\`              — just actions
\`?only=state,messages\`       — state and messages only
\`?only=state._shared\`        — just the _shared scope
\`?actions=false\`             — skip actions section
\`?messages=false\`            — skip messages section

## Message pagination

\`?messages_after=42\`         — only messages after seq 42
\`?messages_limit=10\`         — return at most 10 recent messages

## The _context envelope

Every response includes \`_context\` describing its own shape:
\`\`\`json
"_context": {
  "sections": ["state", "views", "agents", "actions", "messages", "self"],
  "depth": "lean",
  "help": ["vocabulary_bootstrap"],
  "elided": ["_audit"],
  "_expand": ["?include=_audit"]
}
\`\`\`

\`_context.help\` lists currently relevant help keys for the room's state.
Follow them when present — they are situational, not static.
`,

  if_version: `# if_version — proof-of-read writes

Every state entry has two version fields:

- \`revision\`: integer, sequential. How many times this key has been written.
- \`version\`: content hash (SHA-256, 16 hex chars). Non-sequential, unforgeable.

To write a key with \`if_version\`, you must supply the current content hash.
You cannot manufacture the correct hash without having fetched the current value.
This is structural proof-of-read — not enforced intent, but evidence that the
content passed through your context window.

## When to use it

Use \`if_version\` when the correctness of your write depends on what was there before.
Classic compare-and-swap: "write this new value, but only if the current value is still X."

## How to use it

1. Read the current state entry — note its \`version\` field (the hash string)
2. Write with \`if_version\` set to that hash:

\`\`\`
invoke set({ key: "phase", value: "active", if_version: "486ea46224d1bb4f" })
\`\`\`

If the key has changed since you read it (another agent wrote it), the write returns:
\`\`\`json
{ "error": "version_conflict", "expected_version": "486ea46224d1bb4f", "current": { ... } }
\`\`\`

## First-write guarantee

Use \`if_version: ""\` (empty string) to assert the key must not exist yet:
\`\`\`
invoke set({ key: "claim", value: "agent-1", if_version: "" })
\`\`\`

This fails if the key already exists. Safe distributed claiming.

## Overriding help content

The same mechanism applies to help keys. To override \`_help.guide\`:
1. Call \`help({ key: "guide" })\` — note the returned \`version\` hash
2. Write to \`_help.guide\` with \`if_version\` set to that hash

This ensures you've read what you're replacing.
`,
};

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

/** Compute a 16-hex-char SHA-256 content hash of a string value.
 *  This is the v6 `version` field — unforgeable proof-of-read for if_version writes.
 *  Agents cannot supply a correct hash without having fetched the current value. */
async function contentHash(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

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

async function getRoom(roomId: string) {
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

// ============ Agent handlers ============

export async function joinRoom(roomId: string, body: any, req: Request) {
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
    const vHash = await contentHash(value);

    if (body.if_version !== undefined) {
      const expected = String(body.if_version);
      const result = await sqlite.execute({
        sql: `UPDATE state SET value = ?, version = ?, revision = revision + 1, updated_at = datetime('now'),
              sort_key = COALESCE(?, sort_key), enabled_expr = ?, timer_json = ?, timer_expires_at = ?,
              timer_ticks_left = ?, timer_tick_on = ?, timer_effect = ?, timer_started_at = ?
              WHERE room_id = ? AND scope = ? AND key = ? AND version = ?`,
        args: [value, vHash, sortKey, enabledExpr, ...timerArgs, roomId, scope, actualKey, expected],
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
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = excluded.version, revision = state.revision + 1,
                updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, scope, actualKey, sortKey, value, vHash, enabledExpr, ...timerArgs],
      });
    }
  } else if (increment) {
    // Increment: read current, compute new value in TypeScript so we can hash it
    const existingInc = await sqlite.execute({
      sql: `SELECT value, revision FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
      args: [roomId, scope, actualKey],
    });
    const currentNum = existingInc.rows.length > 0
      ? (parseInt(existingInc.rows[0][0] as string) || 0)
      : 0;
    const newNum = currentNum + (typeof incrementAmount === "number" ? incrementAmount : parseInt(String(incrementAmount)) || 0);
    const newValue = String(newNum);
    const vHash = await contentHash(newValue);
    if (existingInc.rows.length > 0) {
      await sqlite.execute({
        sql: `UPDATE state SET value = ?, version = ?, revision = revision + 1, updated_at = datetime('now'),
              enabled_expr = COALESCE(?, enabled_expr),
              timer_json = COALESCE(?, timer_json), timer_expires_at = COALESCE(?, timer_expires_at),
              timer_ticks_left = COALESCE(?, timer_ticks_left), timer_tick_on = COALESCE(?, timer_tick_on),
              timer_effect = COALESCE(?, timer_effect), timer_started_at = COALESCE(?, timer_started_at)
              WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [newValue, vHash, enabledExpr, ...timerArgs, roomId, scope, actualKey],
      });
    } else {
      await sqlite.execute({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
        args: [roomId, scope, actualKey, sortKey, newValue, vHash, enabledExpr, ...timerArgs],
      });
    }
  } else {
    // Standard set (full value replacement)
    const rawValue = arrayPushValue !== undefined ? arrayPushValue : body.value;
    const value = typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
    const vHash = await contentHash(value);

    if (body.if_version !== undefined) {
      const expected = String(body.if_version);
      const result = await sqlite.execute({
        sql: `UPDATE state SET value = ?, version = ?, revision = revision + 1, updated_at = datetime('now'),
              sort_key = COALESCE(?, sort_key), enabled_expr = ?,
              timer_json = ?, timer_expires_at = ?, timer_ticks_left = ?,
              timer_tick_on = ?, timer_effect = ?, timer_started_at = ?
              WHERE room_id = ? AND scope = ? AND key = ? AND version = ?`,
        args: [value, vHash, sortKey, enabledExpr, ...timerArgs, roomId, scope, actualKey, expected],
      });
      if (result.rowsAffected === 0) {
        const current = await sqlite.execute({
          sql: `SELECT * FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [roomId, scope, actualKey],
        });
        const row = rows2objects(current)[0];
        if (row) return json({ error: "version_conflict", expected_version: expected, current: row }, 409);
        if (expected !== "") return json({ error: "not_found", message: "key does not exist, use if_version='' to create" }, 404);
        await sqlite.execute({
          sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at, enabled_expr,
                  timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
          args: [roomId, scope, actualKey, sortKey, value, vHash, enabledExpr, ...timerArgs],
        });
      }
    } else {
      await sqlite.execute({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = excluded.version, revision = state.revision + 1,
                updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, scope, actualKey, sortKey, value, vHash, enabledExpr, ...timerArgs],
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
      const vHash = await contentHash(merged);
      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = excluded.version, revision = state.revision + 1,
                updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, scope, key, sortKey, merged, vHash, enabledExpr, ...timerArgsBatch],
      });
    } else if (w.increment) {
      const batchIncrementAmount = typeof w.increment === "number" ? w.increment : (w.value ?? 1);
      const existingInc = await sqlite.execute({
        sql: `SELECT value FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [roomId, scope, key],
      });
      const currentNum = existingInc.rows.length > 0 ? (parseInt(existingInc.rows[0][0] as string) || 0) : 0;
      const newNum = currentNum + batchIncrementAmount;
      const newValue = String(newNum);
      const vHash = await contentHash(newValue);
      if (existingInc.rows.length > 0) {
        statements.push({
          sql: `UPDATE state SET value = ?, version = ?, revision = revision + 1, updated_at = datetime('now'),
                enabled_expr = COALESCE(?, enabled_expr),
                timer_json = COALESCE(?, timer_json), timer_expires_at = COALESCE(?, timer_expires_at),
                timer_ticks_left = COALESCE(?, timer_ticks_left), timer_tick_on = COALESCE(?, timer_tick_on),
                timer_effect = COALESCE(?, timer_effect), timer_started_at = COALESCE(?, timer_started_at)
                WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [newValue, vHash, enabledExpr, ...timerArgsBatch, roomId, scope, key],
        });
      } else {
        statements.push({
          sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at, enabled_expr,
                  timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
          args: [roomId, scope, key, sortKey, newValue, vHash, enabledExpr, ...timerArgsBatch],
        });
      }
    } else {
      const rawBatch = arrayPushBatch !== undefined ? arrayPushBatch : w.value;
      const value = typeof rawBatch === "string" ? rawBatch : JSON.stringify(rawBatch);
      const vHash = await contentHash(value);
      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = excluded.version, revision = state.revision + 1,
                updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, scope, key, sortKey, value, vHash, enabledExpr, ...timerArgsBatch],
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

/** Compute contested write targets across all live actions in a room.
 *
 * Returns a map of "scope:key" → [actionId, ...] for any (scope, key) pair
 * that is the write target of two or more registered actions.
 * Template keys (containing "${") are tracked as-is — two actions writing
 * to `${params.key}` contest each other even if param values differ at runtime.
 */
async function computeContestedTargets(roomId: string): Promise<Record<string, string[]>> {
  const result = await sqlite.execute({
    sql: `SELECT id, writes_json, timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect
          FROM actions WHERE room_id = ? ORDER BY created_at`,
    args: [roomId],
  });
  const rows = rows2objects(result).filter((r: any) => isTimerLive(r));

  // Collect (scope:key) → [actionId]
  const targets: Record<string, string[]> = {};
  for (const row of rows) {
    let writes: any[] = [];
    try { writes = JSON.parse(row.writes_json || "[]"); } catch {}
    for (const w of writes) {
      const scope = w.scope ?? "_shared";
      const key = w.key ?? null;
      if (!key) continue; // append-only writes have no static key
      const target = `${scope}:${key}`;
      if (!targets[target]) targets[target] = [];
      if (!targets[target].includes(row.id)) targets[target].push(row.id);
    }
  }

  // Keep only contested targets (2+ actions)
  const contested: Record<string, string[]> = {};
  for (const [target, ids] of Object.entries(targets)) {
    if (ids.length >= 2) contested[target] = ids;
  }
  return contested;
}

export async function registerAction(roomId: string, body: any, auth: AuthResult) {
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
  const saved = formatAction(rows2objects(result)[0]);

  // Check for write target overlap with existing actions
  const contested = await computeContestedTargets(roomId);
  const myWrites = (body.writes ?? []).map((w: any) => `${w.scope ?? "_shared"}:${w.key ?? ""}`).filter((t: string) => !t.endsWith(":"));
  const myContested = myWrites.filter((t: string) => contested[t] && contested[t].length >= 2);

  if (myContested.length > 0) {
    return json({
      ...saved,
      warning: "competing_write_targets",
      contested_targets: myContested,
      competing_actions: myContested.map(t => ({ target: t, actions: contested[t] })),
      help: "contested_actions",
    }, 201);
  }

  return json(saved, 201);
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

export async function deleteAction(roomId: string, actionId: string, auth: AuthResult) {
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

export async function invokeAction(roomId: string, actionId: string, body: any, auth: AuthResult) {
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
        if (def.type && def.type !== "any" && params[name] !== undefined && typeof params[name] !== def.type) {
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

    // if_version: compare-and-swap on write templates (proof-of-read)
    if (w.if_version !== undefined) {
      let expectedVersion = w.if_version;
      if (typeof expectedVersion === "string" && expectedVersion.includes("${")) {
        expectedVersion = expectedVersion.replace(/\$\{(params\.(\w+)|self|now)\}/g, (match: string, full: string, paramName: string) => {
          if (paramName !== undefined) return String(params[paramName] ?? "");
          if (full === "self") return agent ?? "";
          if (full === "now") return invokeTs;
          return match;
        });
      }
      const expected = String(expectedVersion);
      const current = await sqlite.execute({
        sql: `SELECT version, value, revision FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [roomId, writeScope, key],
      });
      if (current.rows.length > 0) {
        const row = rows2objects(current)[0];
        if (row.version !== expected) {
          return json({ error: "version_conflict", expected_version: expected, current: row }, 409);
        }
      } else if (expected !== "") {
        return json({ error: "not_found", message: "key does not exist, use if_version='' to create", scope: writeScope, key }, 404);
      }
    }

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
      const vHash = await contentHash(mergedValue);

      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = excluded.version, revision = state.revision + 1,
                updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, writeScope, key, sortKey, mergedValue, vHash, enabledExpr, ...wTimerArgs],
      });
      executedWrites.push({ scope: writeScope, key, merge: mergePayload });
    } else if (w.increment) {
      // Increment: read-compute-write to maintain hash consistency
      let resolvedIncrement: any = w.increment;
      if (typeof resolvedIncrement === "string") {
        resolvedIncrement = deepSubstitute(resolvedIncrement, params, agent ?? "", invokeTs);
        const n = Number(resolvedIncrement);
        resolvedIncrement = isNaN(n) ? 1 : n;
      }
      const actionIncrementAmount = typeof resolvedIncrement === "number" ? resolvedIncrement : (value ?? 1);
      const existingInc = await sqlite.execute({
        sql: `SELECT value FROM state WHERE room_id = ? AND scope = ? AND key = ?`,
        args: [roomId, writeScope, key],
      });
      const currentNum = existingInc.rows.length > 0 ? (parseInt(existingInc.rows[0][0] as string) || 0) : 0;
      const newNum = currentNum + actionIncrementAmount;
      const newValue = String(newNum);
      const vHash = await contentHash(newValue);
      if (existingInc.rows.length > 0) {
        statements.push({
          sql: `UPDATE state SET value = ?, version = ?, revision = revision + 1, updated_at = datetime('now')
                WHERE room_id = ? AND scope = ? AND key = ?`,
          args: [newValue, vHash, roomId, writeScope, key],
        });
      } else {
        statements.push({
          sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at, enabled_expr,
                  timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`,
          args: [roomId, writeScope, key, sortKey, newValue, vHash, enabledExpr, ...wTimerArgs],
        });
      }
      executedWrites.push({ scope: writeScope, key, value: newNum });
    } else {
      const rawAction = arrayPushAction !== undefined ? arrayPushAction : value;
      const strValue = typeof rawAction === "string" ? rawAction : JSON.stringify(rawAction);
      const vHash = await contentHash(strValue);
      statements.push({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at, enabled_expr,
                timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(room_id, scope, key) DO UPDATE SET
                value = excluded.value, version = excluded.version, revision = state.revision + 1,
                updated_at = datetime('now'),
                sort_key = COALESCE(excluded.sort_key, state.sort_key),
                enabled_expr = excluded.enabled_expr,
                timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
                timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
                timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at`,
        args: [roomId, writeScope, key, sortKey, strValue, vHash, enabledExpr, ...wTimerArgs],
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
  const logHash = await contentHash(logValue);
  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at)
          VALUES (?, '_messages', ?, ?, ?, ?, 1, datetime('now'))`,
    args: [roomId, String(logSeq), logSeq, logValue, logHash],
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

export async function registerView(roomId: string, body: any, auth: AuthResult) {
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
    sql: `INSERT INTO views (id, room_id, scope, description, expr, enabled_expr, render_json,
            timer_json, timer_expires_at, timer_ticks_left, timer_tick_on, timer_effect, timer_started_at,
            registered_by, version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id, room_id) DO UPDATE SET
            scope = excluded.scope, description = excluded.description, expr = excluded.expr,
            enabled_expr = excluded.enabled_expr, render_json = excluded.render_json,
            timer_json = excluded.timer_json, timer_expires_at = excluded.timer_expires_at,
            timer_ticks_left = excluded.timer_ticks_left, timer_tick_on = excluded.timer_tick_on,
            timer_effect = excluded.timer_effect, timer_started_at = excluded.timer_started_at,
            registered_by = excluded.registered_by,
            version = views.version + 1`,
    args: [id, roomId, scope, body.description ?? null, body.expr, body.enabled ?? null,
           body.render ? JSON.stringify(body.render) : null,
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
    expr: view.expr, enabled: view.enabled_expr,
    render: view.render_json ? (() => { try { return JSON.parse(view.render_json); } catch { return null; } })() : null,
    registered_by: view.registered_by,
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
      expr: row.expr, enabled: row.enabled_expr,
      render: row.render_json ? (() => { try { return JSON.parse(row.render_json); } catch { return null; } })() : null,
      registered_by: row.registered_by,
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
    expr: row.expr, enabled: row.enabled_expr,
    render: row.render_json ? (() => { try { return JSON.parse(row.render_json); } catch { return null; } })() : null,
    registered_by: row.registered_by,
    version: row.version, created_at: row.created_at,
    value,
  });
}

export async function deleteView(roomId: string, viewId: string, auth: AuthResult) {
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
    description: "Register a computed view. Pass render: { type, label, ... } to create a surface.",
    params: {
      id: { type: "string", description: "View ID" },
      expr: { type: "string", description: "CEL expression" },
      scope: { type: "string", description: "Registrar scope (default: self)" },
      description: { type: "string", description: "Human-readable description" },
      enabled: { type: "string", description: "CEL visibility expression" },
      render: { type: "object", description: "Render hint — makes this view a surface. { type, label, ... }" },
    },
  },
  _delete_view: {
    description: "Delete a view from the room",
    params: { id: { type: "string", description: "View ID to delete" } },
  },
  help: {
    description: "Room-specific participant guide (overridable by custom action)",
    params: {
      key: { type: "string", description: "Help key — omit to list all keys. Try: guide, standard_library, vocabulary_bootstrap" },
    },
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

/** ContextRequest — first-class type describing what context to return.
 *
 * The agent can request different shapes of context:
 * - `depth`: how much action detail to include
 *     "lean"  — id, description, available (default — smallest payload)
 *     "full"  — + writes, if, params
 *     "usage" — + invocation_count (adoption signal)
 * - `only`: return only these top-level sections (e.g. ["state", "messages"])
 * - `actions`: include actions section (default true)
 * - `messages`: include messages section (default true)
 * - `messagesAfter`: seq cursor — only return messages after this seq
 * - `messagesLimit`: max messages to return (default 100, max 500)
 * - `include`: extra state scopes to include (e.g. "_audit")
 */
export interface ContextRequest {
  depth?: "lean" | "full" | "usage";
  only?: string[];
  actions?: boolean;
  messages?: boolean;
  messagesAfter?: number;
  messagesLimit?: number;
  include?: string[];
}

/** Parse a ContextRequest from URL search params */
function parseContextRequest(url: URL): ContextRequest {
  const req: ContextRequest = {};
  const depth = url.searchParams.get("depth");
  if (depth === "lean" || depth === "full" || depth === "usage") req.depth = depth;
  const only = url.searchParams.get("only");
  if (only) req.only = only.split(",").map(s => s.trim()).filter(Boolean);
  const actions = url.searchParams.get("actions");
  if (actions === "false") req.actions = false;
  const messages = url.searchParams.get("messages");
  if (messages === "false") req.messages = false;
  const after = url.searchParams.get("messages_after");
  if (after) req.messagesAfter = parseInt(after);
  const limit = url.searchParams.get("messages_limit");
  if (limit) req.messagesLimit = parseInt(limit);
  const include = url.searchParams.get("include");
  if (include) req.include = include.split(",").map(s => s.trim()).filter(Boolean);
  return req;
}

/** Build expanded context with message bodies, full action definitions, and built-in actions.
 *
 * Returns a self-describing envelope with a `_context` section that tells the caller
 * what was included, what was elided, and how to expand elided sections. */
export async function buildExpandedContext(roomId: string, auth: AuthResult, req: ContextRequest = {}): Promise<Record<string, any>> {
  const depth = req.depth ?? "lean";
  const includeActions = req.actions !== false;
  const includeMessages = req.messages !== false;
  const includedScopes = req.include ?? [];

  const ctx = await buildContext(roomId, {
    selfAgent: auth.agentId ?? undefined,
    allScopes: hasFullReadAccess(auth),
  });

  // ---- Messages ----
  let messagesSection: any;
  let elided: string[] = [];

  if (includeMessages) {
    const messagesLimit = Math.min(req.messagesLimit ?? 100, 500);
    // Explicit column list — omits `version` to avoid INTEGER-affinity overflow on production
    // databases where the v5→v6 migration silently failed (column already existed as INTEGER).
    let msgSql = `SELECT scope, key, sort_key, value, revision, updated_at,
                  timer_json, timer_expires_at, timer_ticks_left, timer_tick_on,
                  timer_effect, timer_started_at, enabled_expr
                  FROM state WHERE room_id = ? AND scope = '_messages'`;
    const msgArgs: any[] = [roomId];
    if (req.messagesAfter) {
      msgSql += ` AND sort_key > ?`;
      msgArgs.push(req.messagesAfter);
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

    // Count total messages (to detect elision)
    const totalMsgResult = await sqlite.execute({
      sql: `SELECT COUNT(*) as cnt FROM state WHERE room_id = ? AND scope = '_messages'`,
      args: [roomId],
    });
    const totalMessages = Number(rows2objects(totalMsgResult)[0]?.cnt ?? 0);
    const oldestSeq = recentMessages.length > 0 ? (recentMessages[0].seq ?? 0) : 0;

    const directed_unread = ctx.messages.directed_unread ?? 0;

    messagesSection = {
      count: ctx.messages.count,
      unread: ctx.messages.unread,
      directed_unread,
      recent: recentMessages,
    };

    // Mark elision if we have more messages than we returned
    if (totalMessages > messagesLimit) {
      const missing = totalMessages - recentMessages.length;
      messagesSection._elided = {
        total: totalMessages,
        returned: recentMessages.length,
        missing,
        oldest_seq: oldestSeq,
        _expand: `?messages_after=0&messages_limit=${Math.min(totalMessages, 500)}`,
      };
    }
  } else {
    elided.push("messages");
  }

  // ---- Actions ----
  let actionsSection: Record<string, any> | undefined;

  if (includeActions) {
    const actionResult = await sqlite.execute({
      sql: `SELECT * FROM actions WHERE room_id = ? ORDER BY created_at`, args: [roomId],
    });
    let actionRows = rows2objects(actionResult);
    actionRows = actionRows.filter((row: any) => isTimerLive(row));

    // Invocation counts for "usage" depth
    let invocationCounts: Record<string, number> = {};
    if (depth === "usage") {
      const auditResult = await sqlite.execute({
        sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_audit' ORDER BY sort_key DESC LIMIT 500`,
        args: [roomId],
      });
      for (const row of rows2objects(auditResult)) {
        try {
          const entry = JSON.parse(row.value);
          if (entry.action && !entry.builtin) {
            invocationCounts[entry.action] = (invocationCounts[entry.action] ?? 0) + 1;
          }
        } catch {}
      }
    }

    actionsSection = {};
    for (const row of actionRows) {
      if (row.enabled_expr) {
        try { if (!evaluate(row.enabled_expr, ctx)) continue; } catch { continue; }
      }

      // lean: just available + description
      const entry: any = {
        available: true,
        description: row.description ?? null,
      };

      if (row.if_expr) {
        try { entry.available = !!evaluate(row.if_expr, ctx); } catch { entry.available = false; }
      }

      if (depth === "full" || depth === "usage") {
        entry.enabled = true;
        if (row.params_json) {
          try { entry.params = JSON.parse(row.params_json); } catch {}
        }
        if (row.writes_json) {
          try { const w = JSON.parse(row.writes_json); if (w.length > 0) entry.writes = w; } catch {}
        }
        if (row.if_expr) entry.if = row.if_expr;
        if (row.scope && row.scope !== "_shared") entry.scope = row.scope;
      }

      if (depth === "usage") {
        entry.invocation_count = invocationCounts[row.id] ?? 0;
      }

      actionsSection[row.id] = entry;
    }

    // Add built-in actions (skip overridable ones that have a custom registration)
    for (const [id, def] of Object.entries(BUILTIN_ACTIONS)) {
      if (OVERRIDABLE_BUILTINS.has(id) && actionsSection[id]) continue;
      const builtinEntry: any = {
        available: true,
        builtin: true,
        description: def.description,
      };
      if (depth === "full" || depth === "usage") {
        builtinEntry.enabled = true;
        builtinEntry.params = def.params ?? null;
      }
      actionsSection[id] = builtinEntry;
    }
  } else {
    elided.push("actions");
  }

  // ---- Assemble state, stripping _audit / _messages unless opted in ----
  const stateOut = { ...ctx.state };
  if (!includedScopes.includes("_audit")) delete stateOut._audit;
  if (!includedScopes.includes("_messages")) delete stateOut._messages;

  // ---- Apply `only` filter ----
  let result: Record<string, any> = {
    state: stateOut,
    views: ctx.views,
    agents: ctx.agents,
    ...(actionsSection !== undefined ? { actions: actionsSection } : {}),
    ...(messagesSection !== undefined ? { messages: messagesSection } : {}),
    self: ctx.self,
  };

  if (req.only && req.only.length > 0) {
    const filtered: Record<string, any> = {};
    for (const s of req.only) {
      if (s in result) filtered[s] = result[s];
      if (s.startsWith("state.")) {
        const scope = s.slice(6);
        if (!filtered.state) filtered.state = {};
        filtered.state[scope] = ctx.state?.[scope] ?? {};
      }
    }
    // self always included
    if (result.self) filtered.self = result.self;
    // track what was filtered out
    for (const key of Object.keys(result)) {
      if (!(key in filtered) && key !== "self") elided.push(key);
    }
    result = filtered;
  }

  // ---- _contested synthetic view ----
  // Computed from action write targets — any (scope:key) targeted by 2+ actions.
  // Injected as a system view so agents can gate on it and wait for it.
  const contestedTargets = await computeContestedTargets(roomId);
  const hasContested = Object.keys(contestedTargets).length > 0;
  if (hasContested) {
    result.views = {
      ...result.views,
      _contested: {
        value: contestedTargets,
        description: "Write targets contested by 2+ actions. Keys are scope:key, values are lists of competing action IDs.",
        system: true,
      },
    };
  }

  // ---- _context envelope ----
  // Compute situational help keys — which help topics are currently relevant
  const contextHelp: string[] = [];
  // Empty room (no registered actions beyond builtins): suggest vocabulary_bootstrap
  const customActionCount = actionsSection
    ? Object.keys(actionsSection).filter(k => !BUILTIN_ACTIONS[k]).length
    : 0;
  if (customActionCount === 0) {
    contextHelp.push("vocabulary_bootstrap");
  }
  // Directed unread: suggest directed_messages
  if (messagesSection?.directed_unread > 0) {
    contextHelp.push("directed_messages");
  }
  // Contested actions: suggest contested_actions
  if (hasContested) {
    contextHelp.push("contested_actions");
  }
  // Messages truncated: surface at top-level _context so agents don't miss it
  if (messagesSection?._elided) {
    contextHelp.push("context_shaping");
  }

  result._context = {
    sections: Object.keys(result).filter(k => k !== "_context"),
    depth,
    ...(messagesSection?._elided ? {
      messages_truncated: {
        missing: messagesSection._elided.missing,
        oldest_seq: messagesSection._elided.oldest_seq,
        _expand: messagesSection._elided._expand,
      },
    } : {}),
    ...(contextHelp.length > 0 ? { help: contextHelp } : {}),
    ...(elided.length > 0 ? {
      elided,
      _expand: elided.map(s => {
        if (s === "messages") return `?messages=true`;
        if (s === "actions") return `?actions=true`;
        return `?only=${s}`;
      }),
    } : {}),
    request: {
      ...(req.depth ? { depth: req.depth } : {}),
      ...(req.only ? { only: req.only } : {}),
      ...(req.actions === false ? { actions: false } : {}),
      ...(req.messages === false ? { messages: false } : {}),
      ...(req.messagesAfter ? { messages_after: req.messagesAfter } : {}),
      ...(req.messagesLimit ? { messages_limit: req.messagesLimit } : {}),
    },
  };

  return result;
}

export async function invokeBuiltinAction(roomId: string, actionId: string, body: any, auth: AuthResult): Promise<Response> {
  const agent = body.agent ?? auth.agentId;
  const params = body.params ?? {};
  touchAgent(roomId, agent);

  switch (actionId) {
    case "_send_message": {
      const msgBody = params.body;
      if (!msgBody) return json({ error: "params.body is required" }, 400);
      const kind = params.kind ?? "chat";
      const to = params.to ?? null; // agent ID string or array — directed but not private
      const seqResult = await sqlite.execute({
        sql: `SELECT COALESCE(MAX(sort_key), 0) + 1 as next_seq FROM state WHERE room_id = ? AND scope = '_messages'`,
        args: [roomId],
      });
      const seq = Number(rows2objects(seqResult)[0]?.next_seq ?? 1);
      const msgObj: any = { from: agent, kind, body: msgBody };
      if (to !== null) msgObj.to = Array.isArray(to) ? to : [to];
      const value = JSON.stringify(msgObj);
      const vHash = await contentHash(value);
      await sqlite.execute({
        sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at)
              VALUES (?, '_messages', ?, ?, ?, ?, 1, datetime('now'))`,
        args: [roomId, String(seq), seq, value, vHash],
      });
      return json({ ok: true, action: "_send_message", seq, from: agent, kind, ...(msgObj.to ? { to: msgObj.to } : {}) });
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
        render: params.render,
        timer: params.timer,
      }, auth);
    }

    case "_delete_view": {
      if (!params.id) return json({ error: "params.id is required" }, 400);
      return deleteView(roomId, params.id, auth);
    }

    case "help": {
      const key = params.key;
      if (!key) {
        // Return index — merge system keys with any room overrides
        const roomHelpResult = await sqlite.execute({
          sql: `SELECT key FROM state WHERE room_id = ? AND scope = '_help' ORDER BY key`,
          args: [roomId],
        });
        const roomKeys = rows2objects(roomHelpResult).map((r: any) => r.key);
        const allKeys = [...new Set([...Object.keys(HELP_SYSTEM), ...roomKeys])];
        return json({
          invoked: true, action: "help",
          keys: allKeys,
          usage: 'invoke help({ key: "<key>" }) to read a specific entry',
        });
      }
      // Try room override first
      const roomEntry = await sqlite.execute({
        sql: `SELECT value, version, revision FROM state WHERE room_id = ? AND scope = '_help' AND key = ?`,
        args: [roomId, key],
      });
      if (roomEntry.rows.length > 0) {
        const row = rows2objects(roomEntry)[0];
        let content = row.value;
        try { content = JSON.parse(row.value); } catch {}
        return json({
          invoked: true, action: "help", key,
          content,
          version: row.version,   // hash — supply to if_version to override
          revision: row.revision,
          source: "room",
        });
      }
      // System default
      const rawContent = HELP_SYSTEM[key];
      if (!rawContent) {
        return json({
          error: "help_key_not_found", key,
          available: Object.keys(HELP_SYSTEM),
        }, 404);
      }
      // Parse JSON keys for cleaner return; keep string keys as strings
      let content: any = rawContent;
      try { content = JSON.parse(rawContent); } catch {}
      // Compute hash so caller can supply it to if_version when overriding
      const hash = await contentHash(rawContent);
      return json({
        invoked: true, action: "help", key,
        content,
        version: hash,   // supply to if_version to override this key
        revision: 0,     // 0 = system default, never written to room state
        source: "system",
      });
    }

    default:
      return json({ error: "unknown builtin action", id: actionId }, 404);
  }
}

// ============ Context endpoint ============

async function getContext(roomId: string, url: URL, auth: AuthResult) {
  touchAgent(roomId, auth.agentId);
  const req = parseContextRequest(url);
  const fullCtx = await buildExpandedContext(roomId, auth, req);
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

  // Compute _contested synthetic view
  const contestedTargets = await computeContestedTargets(roomId);

  return json({ agents, state: stateRows, messages: msgs, actions, views, audit: auditRows,
    ...(Object.keys(contestedTargets).length > 0 ? { _contested: contestedTargets } : {}) });
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

export async function evalExpression(roomId: string, body: any, auth: AuthResult) {
  const expr = body.expr;
  if (!expr || typeof expr !== "string") return json({ error: "expr string is required" }, 400);
  touchAgent(roomId, auth.agentId);
  const ctx = await buildContext(roomId, { selfAgent: auth.agentId ?? undefined });
  const result = await evalCel(roomId, expr, ctx);
  if (!result.ok) return json({ error: "cel_error", expression: expr, detail: result.error }, 400);
  return json({ expression: expr, value: result.value });
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

export async function waitForCondition(roomId: string, url: URL, auth: AuthResult) {
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

  // Parse ContextRequest from URL (wait inherits all context shaping params)
  const ctxReq = parseContextRequest(url);

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
          const expanded = await buildExpandedContext(roomId, auth, ctxReq);
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
      const expanded = await buildExpandedContext(roomId, auth, ctxReq);
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

  // ── MCP / OAuth / WebAuthn / Management — delegate to MCP handler ──
  const p = url.pathname;
  if (
    p === "/mcp" ||
    p.startsWith("/oauth/") ||
    p.startsWith("/webauthn/") ||
    p.startsWith("/manage") ||
    p.startsWith("/recover") ||
    p.startsWith("/vault") ||
    (p.startsWith("/.well-known/oauth"))
  ) {
    return handleMcpRequest(req);
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
    // Root — SSR per-page (replaces SPA shell)
    if (url.pathname === "/" || url.pathname === "") {
      const roomId = url.searchParams.get("room");
      const docId = url.searchParams.get("doc");
      if (roomId) return renderDashboardPage(roomId);
      if (docId) return renderDocPage(docId);
      return renderLandingPage();
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
    // Static assets — /static/* and well-known shortcuts (/favicon.ico, /favicon.svg)
    if (method === "GET" && (url.pathname.startsWith("/static/") || url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg")) {
      const filePath = url.pathname === "/favicon.ico" ? "static/favicon.ico"
                     : url.pathname === "/favicon.svg" ? "static/favicon.svg"
                     : url.pathname.slice(1); // "static/whatever.ext"
      try {
        const fileUrl = new URL(`./${filePath}`, import.meta.url);
        const res = await fetch(fileUrl);
        if (!res.ok) return json({ error: "not found" }, 404);
        const body = await res.arrayBuffer();
        const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
        const mimeTypes: Record<string, string> = {
          ico: "image/x-icon", svg: "image/svg+xml", png: "image/png",
          jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
          css: "text/css", js: "application/javascript", json: "application/json",
          woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf",
          txt: "text/plain", xml: "application/xml",
        };
        return new Response(body, {
          headers: {
            "Content-Type": mimeTypes[ext] || "application/octet-stream",
            "Cache-Control": "public, max-age=86400",
          },
        });
      } catch {
        return json({ error: "not found" }, 404);
      }
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
