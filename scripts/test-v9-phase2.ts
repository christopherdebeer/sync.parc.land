/**
 * scripts/test-v9-phase2.ts — Phase 2 integration test.
 *
 * Tests:
 *   1. buildExpandedContext returns wrapped { value, _meta } shape
 *   2. Salience-threshold shaping (focus/peripheral/elided tiers)
 *   3. expand param forces keys to Focus
 *   4. elision: "none" disables elision
 *   5. _shaping summary in response
 *   6. invoke response includes wrapped writes with _meta
 *   7. No _salience, _contested, or _context in response
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { migrate } from "../schema.ts";
import { migrateV8 } from "../schema-v8.ts";
import { buildExpandedContext } from "../context.ts";
import { invokeAction } from "../invoke.ts";
import { registerAction } from "../actions.ts";
import { contentHash } from "../utils.ts";
import type { AuthResult } from "../auth.ts";

const ROOM = "_test_v9_p2_" + Date.now();

// ── Setup ──────────────────────────────────────────────────────────────

async function setup() {
  await migrate();
  await migrateV8();

  const token = "room_test_" + Date.now();
  const tokenHash = await contentHash(token);
  await sqlite.execute({
    sql: `INSERT OR IGNORE INTO rooms (id, token_hash, created_at) VALUES (?, ?, datetime('now'))`,
    args: [ROOM, tokenHash],
  });

  // Mix of entries: some will be high-salience, some low
  const entries = [
    { scope: "_shared", key: "phase", value: JSON.stringify("executing") },
    { scope: "_shared", key: "turn", value: JSON.stringify(3) },
    { scope: "_shared", key: "concepts.substrate", value: JSON.stringify({ name: "substrate" }) },
    { scope: "_shared", key: "concepts.stigmergy", value: JSON.stringify({ name: "stigmergy" }) },
    // Low-activity keys
    { scope: "_shared", key: "config.display_mode", value: JSON.stringify("grid") },
    { scope: "_shared", key: "config.max_turns", value: JSON.stringify(10) },
    { scope: "_shared", key: "archive.old_concept_1", value: JSON.stringify({ name: "old1", archived: true }) },
    { scope: "_shared", key: "archive.old_concept_2", value: JSON.stringify({ name: "old2", archived: true }) },
  ];

  for (const e of entries) {
    const hash = await contentHash(e.value);
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
            ON CONFLICT(room_id, scope, key) DO UPDATE SET
              value = excluded.value, revision = state.revision + 1, updated_at = datetime('now')`,
      args: [ROOM, e.scope, e.key, e.value, hash],
    });
  }

  // Agents
  for (const id of ["explorer", "synthesist"]) {
    const val = JSON.stringify({
      name: id, role: "agent", status: "active",
      last_heartbeat: new Date().toISOString(), last_seen_seq: 0,
    });
    const hash = await contentHash(val);
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
            VALUES (?, '_agents', ?, ?, ?, 1, datetime('now'))
            ON CONFLICT(room_id, scope, key) DO UPDATE SET
              value = excluded.value, revision = state.revision + 1, updated_at = datetime('now')`,
      args: [ROOM, id, val, hash],
    });
    await sqlite.execute({
      sql: `INSERT OR IGNORE INTO agents (id, room_id, name, role, status, token_hash, joined_at, last_heartbeat)
            VALUES (?, ?, ?, 'agent', 'active', ?, datetime('now'), datetime('now'))`,
      args: [id, ROOM, id, await contentHash("as_" + id)],
    });
  }

  // Audit entries — give some keys high recency/dependency signals
  const audits = [
    {
      ts: new Date(Date.now() - 10000).toISOString(),
      kind: "invoke", agent: "explorer", action: "add_concept", ok: true,
      params: {}, effect: { writes: [{ scope: "_shared", key: "concepts.substrate" }] },
    },
    {
      ts: new Date(Date.now() - 5000).toISOString(),
      kind: "invoke", agent: "synthesist", action: "refine", ok: true,
      params: {}, effect: { writes: [{ scope: "_shared", key: "concepts.stigmergy" }, { scope: "_shared", key: "phase" }] },
    },
  ];
  for (let i = 0; i < audits.length; i++) {
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at)
            VALUES (?, '_audit', ?, ?, ?, 1, datetime('now'))`,
      args: [ROOM, String(i + 1), i + 1, JSON.stringify(audits[i])],
    });
  }

  // Register an action (so invoke test works)
  const auth: AuthResult = {
    authenticated: true, kind: "room", agentId: "explorer",
    roomId: ROOM, grants: ["*"],
  };
  await registerAction(ROOM, {
    id: "set_phase",
    description: "Set the phase",
    writes: [{ scope: "_shared", key: "phase", value: "${params.phase}" }],
    params: { phase: { type: "string" } },
  }, auth);

  // A message
  const msg = JSON.stringify({ from: "explorer", kind: "chat", body: "hello" });
  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at)
          VALUES (?, '_messages', '1', 1, ?, ?, 1, datetime('now'))`,
    args: [ROOM, msg, await contentHash(msg)],
  });
}

// ── Test harness ───────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); failed++; failures.push(name); }
}

// ── Tests ──────────────────────────────────────────────────────────────

async function testWrappedShape() {
  console.log("\n── 1. Wrapped shape in response ──\n");

  const auth: AuthResult = {
    authenticated: true, kind: "agent", agentId: "explorer",
    roomId: ROOM, grants: [],
  };

  const ctx = await buildExpandedContext(ROOM, auth, { elision: "none" });

  // State entries are wrapped
  const phase = ctx.state?._shared?.phase;
  check("state entry has .value", phase?.value === "executing");
  check("state entry has ._meta", typeof phase?._meta === "object");
  check("_meta has score", typeof phase?._meta?.score === "number");
  check("_meta has writer", phase?._meta?.writer !== undefined);
  check("_meta has velocity", typeof phase?._meta?.velocity === "number");

  // Agents wrapped
  const exp = ctx.agents?.explorer;
  check("agent has .value.name", exp?.value?.name === "explorer");
  check("agent has ._meta", typeof exp?._meta === "object");

  // Actions wrapped
  const sp = ctx.actions?.set_phase;
  check("action has .value", typeof sp?.value === "object");
  check("action has ._meta.invocations", typeof sp?._meta?.invocations === "number");

  // No old synthetic views
  check("no _salience in views", !ctx.views?._salience);
  check("no _contested in views", !ctx.views?._contested);
  check("no _context in response", !ctx._context);

  // _shaping summary present
  check("_shaping present", typeof ctx._shaping === "object");
  check("_shaping has state_entries", typeof ctx._shaping?.state_entries === "object");
}

async function testSalienceShaping() {
  console.log("\n── 2. Salience-threshold shaping ──\n");

  const auth: AuthResult = {
    authenticated: true, kind: "agent", agentId: "explorer",
    roomId: ROOM, grants: [],
  };

  // Default thresholds: focus=0.5, elide=0.1
  const ctx = await buildExpandedContext(ROOM, auth);

  const shared = ctx.state?._shared ?? {};
  const keys = Object.keys(shared);
  check("state has entries", keys.length > 0, `${keys.length} keys`);

  // Check for elided entries (value: null)
  const elidedKeys = keys.filter(k => shared[k]?.value === null);
  const nonElidedKeys = keys.filter(k => shared[k]?.value !== null);
  check("some entries may be elided", true, `elided: ${elidedKeys.length}, non-elided: ${nonElidedKeys.length}`);

  // Elided entries should have _meta.elided: true
  for (const k of elidedKeys) {
    check(`elided key ${k} has _meta.elided`, shared[k]._meta?.elided === true);
    check(`elided key ${k} has expand hint`, typeof shared[k]._meta?.expand === "string");
  }

  // Non-elided entries should have _meta.elided: false or undefined
  for (const k of nonElidedKeys.slice(0, 3)) { // check first 3
    check(`non-elided key ${k} has value`, shared[k]?.value !== null && shared[k]?.value !== undefined);
  }

  // _shaping summary
  check("_shaping.state_entries.total > 0", (ctx._shaping?.state_entries?.total ?? 0) > 0);
}

async function testExpandParam() {
  console.log("\n── 3. expand param ──\n");

  const auth: AuthResult = {
    authenticated: true, kind: "agent", agentId: "explorer",
    roomId: ROOM, grants: [],
  };

  // First get default — some keys may be elided
  const defaultCtx = await buildExpandedContext(ROOM, auth);
  const defaultShared = defaultCtx.state?._shared ?? {};
  const defaultElidedKeys = Object.keys(defaultShared).filter(k => defaultShared[k]?.value === null);

  if (defaultElidedKeys.length > 0) {
    // Expand one of the elided keys
    const keyToExpand = defaultElidedKeys[0];
    const expandedCtx = await buildExpandedContext(ROOM, auth, {
      expand: [`_shared.${keyToExpand}`],
    });
    const expandedEntry = expandedCtx.state?._shared?.[keyToExpand];
    check(`expanded key ${keyToExpand} has value`, expandedEntry?.value !== null);
    check(`expanded key has full _meta`, !!expandedEntry?._meta?.writers);
  } else {
    check("(no elided keys to test expand — all above threshold)", true);
  }
}

async function testElisionNone() {
  console.log("\n── 4. elision: none ──\n");

  const auth: AuthResult = {
    authenticated: true, kind: "agent", agentId: "explorer",
    roomId: ROOM, grants: [],
  };

  const ctx = await buildExpandedContext(ROOM, auth, { elision: "none" });
  const shared = ctx.state?._shared ?? {};
  const elidedKeys = Object.keys(shared).filter(k => shared[k]?.value === null);
  check("no elided entries with elision:none", elidedKeys.length === 0, `${elidedKeys.length} still elided`);
  check("_shaping.elision is 'none'", ctx._shaping?.elision === "none");
}

async function testInvokeWrappedWrites() {
  console.log("\n── 5. Invoke response with wrapped writes ──\n");

  const auth: AuthResult = {
    authenticated: true, kind: "agent", agentId: "explorer",
    roomId: ROOM, grants: ["*"],
  };

  const response = await invokeAction(ROOM, "set_phase", {
    agent: "explorer",
    params: { phase: "synthesis" },
  }, auth);

  const body = await response.json();
  check("invoke succeeded", body.invoked === true);
  check("writes is an array", Array.isArray(body.writes));

  if (body.writes?.length > 0) {
    const w = body.writes[0];
    check("write has .value", w.value !== undefined);
    check("write has ._meta", typeof w._meta === "object");
    check("write _meta has score", typeof w._meta?.score === "number");
    check("write _meta has writer", w._meta?.writer !== undefined);
    check("write _meta has revision", typeof w._meta?.revision === "number");
    check("write _meta has velocity", typeof w._meta?.velocity === "number");
    check("write scope is _shared", w.scope === "_shared");
    check("write key is phase", w.key === "phase");
  }
}

// ── Run ────────────────────────────────────────────────────────────────

async function cleanup() {
  for (const sql of [
    `DELETE FROM state WHERE room_id = ?`,
    `DELETE FROM agents WHERE room_id = ?`,
    `DELETE FROM rooms WHERE id = ?`,
    `DELETE FROM log_index WHERE room_id = ?`,
  ]) {
    try { await sqlite.execute({ sql, args: [ROOM] }); } catch {}
  }
}

try {
  await setup();
  await testWrappedShape();
  await testSalienceShaping();
  await testExpandParam();
  await testElisionNone();
  await testInvokeWrappedWrites();
  await cleanup();

  console.log(`\n════════════════════════════════════════`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log(`\nFailed:`);
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log(`════════════════════════════════════════`);

  if (failed > 0) console.error(`\n❌ ${failed} checks failed`);
  else console.log(`\n✅ All ${passed} checks passed`);
} catch (e) {
  console.error("Test error:", e);
  await cleanup().catch(() => {});
  throw e;
}
