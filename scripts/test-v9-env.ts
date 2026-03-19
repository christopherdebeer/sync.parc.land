/**
 * scripts/test-v9-env.ts — Integration test for v9 Environment + validation pipeline.
 *
 * Tests:
 *   1. Environment singleton (celEval uses domain helpers)
 *   2. buildContext produces wrapped entries evaluated via Environment
 *   3. validateExpression pipeline (parse, check, lint, eval stages)
 *   4. Action registration with CEL validation and lint warnings
 *   5. View registration with CEL evaluation via Environment
 *   6. Error quality: specific hints for common mistakes
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { migrate } from "../schema.ts";
import { migrateV8 } from "../schema-v8.ts";
import {
  buildContext,
  celEval,
  getCelEnvironment,
  validateExpression,
  validateCel,
} from "../cel.ts";
import { registerAction } from "../actions.ts";
import { registerView } from "../views.ts";
import { contentHash } from "../utils.ts";
import type { AuthResult } from "../auth.ts";

const ROOM = "_test_v9_env_" + Date.now();

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

  // State entries
  const entries = [
    { scope: "_shared", key: "phase", value: JSON.stringify("executing") },
    { scope: "_shared", key: "turn", value: JSON.stringify(3) },
    {
      scope: "_shared",
      key: "concepts.substrate",
      value: JSON.stringify({
        name: "substrate",
        definition: "shared-state coordination",
      }),
    },
    {
      scope: "_shared",
      key: "concepts.stigmergy",
      value: JSON.stringify({
        name: "stigmergy",
        definition: "indirect coordination",
      }),
    },
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

  // Audit entries
  const audits = [
    {
      ts: new Date(Date.now() - 60000).toISOString(),
      kind: "invoke", agent: "explorer", action: "add_concept", ok: true,
      params: {}, effect: { writes: [{ scope: "_shared", key: "concepts.substrate" }] },
    },
    {
      ts: new Date(Date.now() - 30000).toISOString(),
      kind: "invoke", agent: "synthesist", action: "refine", ok: true,
      params: {}, effect: { writes: [{ scope: "_shared", key: "concepts.stigmergy" }] },
    },
  ];
  for (let i = 0; i < audits.length; i++) {
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at)
            VALUES (?, '_audit', ?, ?, ?, 1, datetime('now'))`,
      args: [ROOM, String(i + 1), i + 1, JSON.stringify(audits[i])],
    });
  }
}

// ── Test harness ───────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(name);
  }
}

// ── Tests ──────────────────────────────────────────────────────────────

async function testEnvironmentSingleton() {
  console.log("\n── 1. Environment singleton ──\n");

  const env = getCelEnvironment();
  check("Environment created", !!env);

  // Verify domain helpers registered
  const defs = env.getDefinitions();
  const fnNames = (defs.functions ?? []).map((f: any) => {
    const sig = f.signature ?? "";
    const match = sig.match(/^(?:\w+\.)?(\w+)\(/);
    return match?.[1] ?? f.name ?? "";
  });

  check("salient() registered", fnNames.includes("salient"));
  check("elided() registered", fnNames.includes("elided"));
  check("written_by() registered", fnNames.includes("written_by"));
  check("focus() registered", fnNames.includes("focus"));
  check("contested() registered", fnNames.includes("contested"));
  check("val() registered", fnNames.includes("val"));
  check("meta() registered", fnNames.includes("meta"));
  check("keys() receiver registered", fnNames.includes("keys"));
  check("entries() receiver registered", fnNames.includes("entries"));

  // Same instance on second call
  const env2 = getCelEnvironment();
  check("Singleton returns same instance", env === env2);
}

async function testCelEvalWithHelpers() {
  console.log("\n── 2. celEval with domain helpers ──\n");

  const ctx = await buildContext(ROOM, { selfAgent: "explorer" });

  // Direct value access
  const phase = celEval('state._shared.phase.value', ctx);
  check("celEval: value access", phase === "executing", `got ${phase}`);

  // Meta access
  const rev = celEval('state._shared.phase._meta.revision', ctx);
  check("celEval: meta access", typeof rev === "number" || typeof rev === "bigint", `got ${typeof rev}`);

  // val() shorthand
  const valResult = celEval('val(state._shared.phase) == "executing"', ctx);
  check("celEval: val() shorthand", valResult === true, `got ${valResult}`);

  // meta() shorthand
  const metaResult = celEval('meta(state._shared.phase, "revision")', ctx);
  check("celEval: meta() shorthand", metaResult !== null && metaResult !== undefined, `got ${metaResult}`);

  // keys() receiver
  const keys = celEval('state._shared.keys()', ctx);
  check("celEval: keys() receiver", Array.isArray(keys) && keys.length === 4, `got ${JSON.stringify(keys)}`);

  // entries() receiver
  const entries = celEval('state._shared.entries().size()', ctx);
  check("celEval: entries().size()", Number(entries) === 4, `got ${entries}`);

  // salient() helper
  const sal = celEval('salient(state._shared, 0.0)', ctx);
  check("celEval: salient()", Array.isArray(sal), `got ${typeof sal}`);

  // written_by() helper
  const wb = celEval('written_by(state._shared, "explorer")', ctx);
  check("celEval: written_by()", Array.isArray(wb), `got ${typeof wb}`);

  // Complex chain: keys + filter + size
  const highScore = celEval(
    'state._shared.keys().filter(k, state._shared[k]._meta.score > 0.0).size()',
    ctx,
  );
  check("celEval: keys().filter()._meta.score chain", Number(highScore) > 0, `got ${highScore}`);

  // entries + filter + map
  const writers = celEval(
    'state._shared.entries().filter(e, e.entry._meta.writer != null).map(e, e.entry._meta.writer)',
    ctx,
  );
  check("celEval: entries().filter().map() chain", Array.isArray(writers), `got ${typeof writers}`);
}

async function testValidationPipeline() {
  console.log("\n── 3. Validation pipeline ──\n");

  // Valid v9 expression
  const v1 = validateExpression('state._shared.phase.value == "executing"');
  check("valid v9 expr", v1.valid && v1.stage === "ok");

  // Parse error: missing operand
  const v2 = validateExpression("state._shared.phase ==");
  check("parse error detected", !v2.valid && v2.stage === "parse");
  check("parse error has hint", !!v2.hint);
  check("parse error has source pointer", !!v2.source);

  // Parse error: empty
  const v3 = validateExpression("");
  check("empty expr caught", !v3.valid && v3.stage === "parse");

  // Valid domain helper
  const v4 = validateExpression("salient(state._shared, 0.5)");
  check("domain helper validates", v4.valid);

  // Old-style lint warning
  const v5 = validateExpression('state._shared.phase == "executing"');
  check("old-style expr gets lint warning", v5.valid && (v5.warnings?.length ?? 0) > 0,
    `warnings: ${JSON.stringify(v5.warnings)}`);

  // Nested field without .value lint
  const v6 = validateExpression('state._shared["concepts.substrate"].name == "substrate"');
  check("bare field access gets lint warning", v6.valid && (v6.warnings?.length ?? 0) > 0,
    `warnings: ${JSON.stringify(v6.warnings)}`);

  // Correct expression: no warnings
  const v7 = validateExpression('state._shared.phase.value == "executing"');
  check("correct expr: no warnings", v7.valid && (!v7.warnings || v7.warnings.length === 0));

  // Trial evaluation — valid
  const ctx = await buildContext(ROOM, { selfAgent: "explorer" });
  const v8 = validateExpression('state._shared.phase.value == "executing"', ctx);
  check("trial eval: valid", v8.valid && v8.type === "boolean");

  // Trial evaluation — missing key
  const v9 = validateExpression("state._shared.nonexistent.value", ctx);
  check("trial eval: missing key", !v9.valid && v9.stage === "eval");
  check("missing key hint mentions key name", v9.hint?.includes("nonexistent") ?? false);

  // Trial evaluation — type mismatch
  const v10 = validateExpression("state._shared.phase.value * 2", ctx);
  check("trial eval: type mismatch", !v10.valid && v10.stage === "eval");
  check("type mismatch hint mentions .value", v10.hint?.includes(".value") ?? false);
}

async function testValidateCelLegacy() {
  console.log("\n── 4. validateCel (legacy compat) ──\n");

  const r1 = validateCel('state._shared.phase.value == "executing"');
  check("validateCel: valid", r1.valid);

  const r2 = validateCel("invalid + + syntax");
  check("validateCel: invalid", !r2.valid);
  check("validateCel: has error", "error" in r2 && !!r2.error);
  check("validateCel: has hint", "hint" in r2 && !!r2.hint);

  // Lint warnings pass through
  const r3 = validateCel('state._shared.phase == "executing"');
  check("validateCel: old-style passes with warnings",
    r3.valid && (r3.warnings?.length ?? 0) > 0);
}

async function testActionRegistrationValidation() {
  console.log("\n── 5. Action registration validation ──\n");

  const auth: AuthResult = {
    authenticated: true,
    kind: "room",
    agentId: "explorer",
    roomId: ROOM,
    grants: ["*"],
  };

  // Valid action with v9 expressions
  const r1 = await registerAction(ROOM, {
    id: "test_valid_action",
    description: "Test action with v9 CEL",
    if: 'state._shared.phase.value == "executing"',
    writes: [{ scope: "_shared", key: "test_key", value: "test" }],
  }, auth);
  const j1 = await r1.json();
  check("valid action registered", r1.status === 201, `status ${r1.status}: ${JSON.stringify(j1)}`);

  // Action with parse error in if
  const r2 = await registerAction(ROOM, {
    id: "test_bad_if",
    if: "state._shared.phase ==",
    writes: [],
  }, auth);
  const j2 = await r2.json();
  check("bad if expression rejected", r2.status === 400);
  check("error includes stage", j2.stage === "parse");
  check("error includes hint", !!j2.hint);

  // Action with old-style lint warnings
  const r3 = await registerAction(ROOM, {
    id: "test_lint_action",
    description: "Action with old-style CEL",
    if: 'state._shared.phase == "executing"',
    writes: [{ scope: "_shared", key: "lint_test", value: "v" }],
  }, auth);
  const j3 = await r3.json();
  check("old-style action registered (warnings, not errors)", r3.status === 201);
  check("response includes cel_warnings", Array.isArray(j3.cel_warnings),
    `cel_warnings: ${JSON.stringify(j3.cel_warnings)}`);
}

async function testViewRegistrationValidation() {
  console.log("\n── 6. View registration validation ──\n");

  const auth: AuthResult = {
    authenticated: true,
    kind: "room",
    agentId: "explorer",
    roomId: ROOM,
    grants: ["*"],
  };

  // Valid v9 view using domain helper
  const r1 = await registerView(ROOM, {
    id: "test_salient_view",
    expr: "salient(state._shared, 0.0)",
    description: "Keys above zero salience",
    scope: "_shared",
  }, auth);
  const j1 = await r1.json();
  check("domain helper view registered", r1.status === 201, `status ${r1.status}`);
  check("view resolved value is a list", Array.isArray(j1.value), `value: ${JSON.stringify(j1.value)}`);

  // View using keys() + filter
  const r2 = await registerView(ROOM, {
    id: "test_keys_view",
    expr: 'state._shared.keys().filter(k, k.startsWith("concepts"))',
    description: "Concept keys",
    scope: "_shared",
  }, auth);
  const j2 = await r2.json();
  check("keys() view registered", r2.status === 201);
  check("keys view resolved", Array.isArray(j2.value) && j2.value.length === 2,
    `value: ${JSON.stringify(j2.value)}`);

  // View using val() shorthand
  const r3 = await registerView(ROOM, {
    id: "test_val_view",
    expr: 'val(state._shared.phase)',
    description: "Phase value via shorthand",
    scope: "_shared",
  }, auth);
  const j3 = await r3.json();
  check("val() view registered", r3.status === 201);
  check("val() view resolved to 'executing'", j3.value === "executing", `value: ${j3.value}`);

  // View with entries() chain
  const r4 = await registerView(ROOM, {
    id: "test_entries_view",
    expr: 'state._shared.entries().filter(e, e.entry._meta.writer != null).map(e, e.key)',
    description: "Keys with known writers",
    scope: "_shared",
  }, auth);
  const j4 = await r4.json();
  check("entries() view registered", r4.status === 201, `status ${r4.status}`);
  check("entries view resolved to list", Array.isArray(j4.value), `value: ${JSON.stringify(j4.value)}`);

  // View with bad expression
  const r5 = await registerView(ROOM, {
    id: "test_bad_view",
    expr: "state._shared.phase ==",
    scope: "_shared",
  }, auth);
  const j5 = await r5.json();
  check("bad view rejected", r5.status === 400);
  check("bad view error has stage", j5.stage === "parse");

  // View with lint warnings
  const r6 = await registerView(ROOM, {
    id: "test_lint_view",
    expr: 'state._shared.phase == "executing"',
    scope: "_shared",
  }, auth);
  const j6 = await r6.json();
  check("lint view registered with warnings", r6.status === 201);
  check("lint view has warnings", Array.isArray(j6.warnings) && j6.warnings.length > 0,
    `warnings: ${JSON.stringify(j6.warnings)}`);
}

async function testErrorQuality() {
  console.log("\n── 7. Error quality ──\n");

  const ctx = await buildContext(ROOM, { selfAgent: "explorer" });

  // Specific error for missing key
  const r1 = validateExpression("state._shared.nonexistent.value", ctx);
  check("missing key: error names the key", r1.error?.includes("nonexistent") ?? false);
  check("missing key: hint suggests has()", r1.hint?.includes("has()") ?? false);

  // Specific error for type mismatch
  const r2 = validateExpression("state._shared.phase.value * 2", ctx);
  check("type mismatch: error mentions overload", r2.error?.includes("overload") ?? false);
  check("type mismatch: hint mentions .value", r2.hint?.includes(".value") ?? false);

  // Wrong meta path (no underscore)
  const r3 = validateExpression("state._shared.phase.meta.score", ctx);
  check("wrong meta path: caught", !r3.valid);
  check("wrong meta path: error names 'meta'", r3.error?.includes("meta") ?? false);

  // _meta on bare value (not on wrapped entry)
  const r4 = validateExpression("state._shared.phase.value._meta", ctx);
  check("_meta on value: caught", !r4.valid);

  // Triple equals (JavaScript habit)
  const r5 = validateExpression('state._shared.phase.value === "executing"');
  check("=== caught at parse", !r5.valid && r5.stage === "parse");

  // Unbalanced parens
  const r6 = validateExpression("size(state._shared");
  check("unbalanced parens: caught at parse", !r6.valid && r6.stage === "parse");
  check("unbalanced parens: has source pointer", !!r6.source);
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
  await testEnvironmentSingleton();
  await testCelEvalWithHelpers();
  await testValidationPipeline();
  await testValidateCelLegacy();
  await testActionRegistrationValidation();
  await testViewRegistrationValidation();
  await testErrorQuality();
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
