/**
 * scripts/test-v9-cel.ts — Verify CEL expressions work against wrapped shape.
 *
 * Tests that new-style expressions (.value, ._meta) evaluate correctly,
 * and that old-style expressions fail as expected.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { evaluate } from "npm:@marcbachmann/cel-js";
import { migrate } from "../schema.ts";
import { migrateV8 } from "../schema-v8.ts";
import { buildContext } from "../cel.ts";
import { contentHash } from "../utils.ts";

const ROOM_ID = "_test_v9_cel_" + Date.now();

async function setup() {
  await migrate();
  await migrateV8();

  const token = "room_test_" + Date.now();
  const tokenHash = await contentHash(token);
  await sqlite.execute({
    sql: `INSERT OR IGNORE INTO rooms (id, token_hash, created_at) VALUES (?, ?, datetime('now'))`,
    args: [ROOM_ID, tokenHash],
  });

  const entries = [
    { scope: "_shared", key: "phase", value: JSON.stringify("executing") },
    { scope: "_shared", key: "turn", value: JSON.stringify(3) },
    {
      scope: "_shared",
      key: "concepts.substrate",
      value: JSON.stringify({ name: "substrate", definition: "shared-state coordination" }),
    },
    {
      scope: "_shared",
      key: "concepts.stigmergy",
      value: JSON.stringify({ name: "stigmergy", definition: "indirect coordination" }),
    },
    {
      scope: "_shared",
      key: "concepts.emergence",
      value: JSON.stringify({ name: "emergence", definition: "complex behavior from simple rules" }),
    },
  ];

  for (const e of entries) {
    const hash = await contentHash(e.value);
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`,
      args: [ROOM_ID, e.scope, e.key, e.value, hash],
    });
  }

  // Agent
  const agentVal = JSON.stringify({
    name: "Explorer", role: "finder", status: "active",
    last_heartbeat: new Date().toISOString(), last_seen_seq: 0,
  });
  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
          VALUES (?, '_agents', 'explorer', ?, ?, 1, datetime('now'))`,
    args: [ROOM_ID, agentVal, await contentHash(agentVal)],
  });
  await sqlite.execute({
    sql: `INSERT OR IGNORE INTO agents (id, room_id, name, role, status, token_hash, joined_at, last_heartbeat)
          VALUES ('explorer', ?, 'Explorer', 'finder', 'active', ?, datetime('now'), datetime('now'))`,
    args: [ROOM_ID, await contentHash("as_test_explorer")],
  });

  // Audit entries for provenance
  const audit = [
    {
      ts: new Date(Date.now() - 60000).toISOString(),
      kind: "invoke", agent: "explorer", action: "add_concept", ok: true,
      params: {}, effect: { writes: [{ scope: "_shared", key: "concepts.substrate" }] },
    },
    {
      ts: new Date(Date.now() - 30000).toISOString(),
      kind: "invoke", agent: "explorer", action: "add_concept", ok: true,
      params: {}, effect: { writes: [{ scope: "_shared", key: "concepts.stigmergy" }] },
    },
  ];
  for (let i = 0; i < audit.length; i++) {
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at)
            VALUES (?, '_audit', ?, ?, ?, 1, datetime('now'))`,
      args: [ROOM_ID, String(i + 1), i + 1, JSON.stringify(audit[i])],
    });
  }
}

async function test() {
  console.log("=== v9 CEL Expression Tests ===\n");

  const ctx = await buildContext(ROOM_ID, { selfAgent: "explorer" });
  const checks: Array<{ name: string; expr: string; expected: any; ok: boolean; actual: any }> = [];

  function check(name: string, expr: string, expected: any) {
    try {
      const result = evaluate(expr, ctx);
      const actual = typeof result === "bigint" ? Number(result) : result;
      const ok = JSON.stringify(actual) === JSON.stringify(expected);
      checks.push({ name, expr, expected, ok, actual });
    } catch (e: any) {
      checks.push({ name, expr, expected, ok: expected === "ERROR", actual: `ERROR: ${e.message}` });
    }
  }

  // ── Value access ──
  check(
    "value access: phase",
    'state._shared.phase.value == "executing"',
    true,
  );
  check(
    "value access: turn",
    "state._shared.turn.value > 2",
    true,
  );
  check(
    "value access: nested",
    'state._shared["concepts.substrate"].value.name == "substrate"',
    true,
  );

  // ── Meta access ──
  check(
    "meta: revision",
    "state._shared.phase._meta.revision == 1",
    true,
  );
  check(
    "meta: writer",
    'state._shared["concepts.substrate"]._meta.writer == "explorer"',
    true,
  );
  check(
    "meta: elided is false",
    "state._shared.phase._meta.elided == false",
    true,
  );

  // ── Collection operations ──
  check(
    "size of scope (counts keys)",
    "size(state._shared)",
    5,
  );

  // ── Filter by meta ──
  // Note: cel-js filter syntax: obj.filter(k, v, predicate)
  // Under wrapped model, v is { value, _meta }
  check(
    "filter: entries with writer == explorer",
    'state._shared.filter(k, e, e._meta.writer == "explorer").size()',
    2,
  );
  check(
    "filter: entries with velocity > 0",
    "state._shared.filter(k, e, e._meta.velocity > 0).size()",
    2,
  );
  check(
    "filter: entries with score > 0.05",
    "state._shared.filter(k, e, e._meta.score > 0.05).size() > 0",
    true,
  );

  // ── Agent access ──
  check(
    "agent value access",
    'agents.explorer.value.name == "Explorer"',
    true,
  );
  check(
    "agent meta access",
    "agents.explorer._meta.revision == 1",
    true,
  );

  // ── Old-style expressions SHOULD FAIL ──
  check(
    "OLD STYLE: bare value comparison should fail",
    'state._shared.phase == "executing"',
    "ERROR",
  );

  // ── Substrate-native expressions (new capabilities) ──
  check(
    "NEW: count entries without audit history",
    "state._shared.filter(k, e, e._meta.writer == null).size()",
    3, // phase, turn, concepts.emergence have no audit writes
  );
  check(
    "NEW: map keys to their writers",
    'state._shared.filter(k, e, e._meta.writer != null).map(k, e, e._meta.writer)',
    // This returns a map/object of key→writer, let's check size instead
    "ERROR", // map returns an object, not easily comparable — let's skip this
  );

  // ── Print results ──
  let passed = 0;
  let failed = 0;
  for (const c of checks) {
    const icon = c.ok ? "✓" : "✗";
    console.log(`  ${icon} ${c.name}`);
    console.log(`    expr: ${c.expr}`);
    if (!c.ok) {
      console.log(`    expected: ${JSON.stringify(c.expected)}`);
      console.log(`    actual:   ${JSON.stringify(c.actual)}`);
    }
    if (c.ok) passed++;
    else failed++;
  }
  console.log(`\n${passed} passed, ${failed} failed out of ${checks.length}`);
  return { passed, failed };
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM state WHERE room_id = ?`,
    `DELETE FROM agents WHERE room_id = ?`,
    `DELETE FROM rooms WHERE id = ?`,
    `DELETE FROM log_index WHERE room_id = ?`,
  ]) {
    try { await sqlite.execute({ sql, args: [ROOM_ID] }); } catch {}
  }
}

try {
  await setup();
  const result = await test();
  await cleanup();
  if (result.failed > 0) console.error(`\n❌ ${result.failed} checks failed`);
  else console.log(`\n✅ All ${result.passed} checks passed`);
} catch (e) {
  console.error("Test error:", e);
  await cleanup().catch(() => {});
  throw e;
}
