/**
 * scripts/test-v9-validation.ts — Test the CEL validation pipeline and Environment.
 *
 * Verifies: parse errors, type checking, lint detection, domain helpers,
 * receiver methods, and structured error feedback.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { migrate } from "../schema.ts";
import { migrateV8 } from "../schema-v8.ts";
import { validateExpression, celEval, buildContext, getCelEnvironment } from "../cel.ts";
import { contentHash } from "../utils.ts";

const ROOM_ID = "_test_v9_val_" + Date.now();

async function setup() {
  await migrate();
  await migrateV8();

  const tokenHash = await contentHash("room_test_" + Date.now());
  await sqlite.execute({
    sql: `INSERT OR IGNORE INTO rooms (id, token_hash, created_at) VALUES (?, ?, datetime('now'))`,
    args: [ROOM_ID, tokenHash],
  });

  const entries = [
    { scope: "_shared", key: "phase", value: JSON.stringify("executing") },
    { scope: "_shared", key: "turn", value: JSON.stringify(3) },
    { scope: "_shared", key: "concepts.substrate", value: JSON.stringify({ name: "substrate", definition: "shared-state" }) },
  ];
  for (const e of entries) {
    const hash = await contentHash(e.value);
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at) VALUES (?, ?, ?, ?, ?, 1, datetime('now'))`,
      args: [ROOM_ID, e.scope, e.key, e.value, hash],
    });
  }

  // Agent
  const agentVal = JSON.stringify({ name: "Explorer", role: "finder", status: "active", last_heartbeat: new Date().toISOString(), last_seen_seq: 0 });
  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at) VALUES (?, '_agents', 'explorer', ?, ?, 1, datetime('now'))`,
    args: [ROOM_ID, agentVal, await contentHash(agentVal)],
  });
  await sqlite.execute({
    sql: `INSERT OR IGNORE INTO agents (id, room_id, name, role, status, token_hash, joined_at, last_heartbeat)
          VALUES ('explorer', ?, 'Explorer', 'finder', 'active', ?, datetime('now'), datetime('now'))`,
    args: [ROOM_ID, await contentHash("as_test_explorer")],
  });

  // Audit for provenance
  const audit = {
    ts: new Date().toISOString(), kind: "invoke", agent: "explorer", action: "write_phase", ok: true,
    params: {}, effect: { writes: [{ scope: "_shared", key: "phase" }] },
  };
  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at) VALUES (?, '_audit', '1', 1, ?, 1, datetime('now'))`,
    args: [ROOM_ID, JSON.stringify(audit)],
  });
}

async function cleanup() {
  for (const sql of [
    `DELETE FROM state WHERE room_id = ?`,
    `DELETE FROM agents WHERE room_id = ?`,
    `DELETE FROM rooms WHERE id = ?`,
    `DELETE FROM log_index WHERE room_id = ?`,
  ]) { try { await sqlite.execute({ sql, args: [ROOM_ID] }); } catch {} }
}

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string) {
  const icon = ok ? "✓" : "✗";
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ""}`);
  if (ok) passed++; else failed++;
}

async function test() {
  console.log("=== v9 Validation Pipeline Tests ===\n");

  // ── 1. Parse errors ──
  console.log("--- Parse errors ---\n");

  const parseEmpty = validateExpression("");
  check("empty expression → parse error", !parseEmpty.valid && parseEmpty.stage === "parse");

  const parseBadSyntax = validateExpression("state._shared.phase ==");
  check("missing operand → parse error", !parseBadSyntax.valid && parseBadSyntax.stage === "parse",
    parseBadSyntax.error);
  check("parse error has hint", !!parseBadSyntax.hint);
  check("parse error has source pointer", !!parseBadSyntax.source);

  const parseTripleEquals = validateExpression('state._shared.phase === "test"');
  check("=== (JS not CEL) → parse error", !parseTripleEquals.valid && parseTripleEquals.stage === "parse");

  const parsePipe = validateExpression("state._shared | keys()");
  check("pipe syntax → parse error", !parsePipe.valid && parsePipe.stage === "parse");

  // ── 2. Valid expressions ──
  console.log("\n--- Valid expressions ---\n");

  const validValue = validateExpression('state._shared.phase.value == "executing"');
  check("v9 value access is valid", validValue.valid);

  const validMeta = validateExpression("state._shared.phase._meta.score > 0.5");
  check("v9 meta access is valid", validMeta.valid);

  const validHelper = validateExpression("salient(state._shared, 0.5)");
  check("domain helper is valid", validHelper.valid);

  const validKeys = validateExpression("state._shared.keys()");
  check("receiver method .keys() is valid", validKeys.valid);

  const validEntries = validateExpression("state._shared.entries().filter(e, e.entry._meta.score > 0.5)");
  check("entries + filter chain is valid", validEntries.valid);

  const validWrittenBy = validateExpression('written_by(state._shared, "explorer")');
  check("written_by helper is valid", validWrittenBy.valid);

  const validVal = validateExpression('val(state._shared.phase) == "executing"');
  check("val() shorthand is valid", validVal.valid);

  const validMeta2 = validateExpression('meta(state._shared.phase, "writer")');
  check("meta() shorthand is valid", validMeta2.valid);

  // ── 3. Lint warnings (old-style) ──
  console.log("\n--- Lint warnings (v8 patterns) ---\n");

  const lintBareCompare = validateExpression('state._shared.phase == "executing"');
  check("bare comparison → valid with warning",
    lintBareCompare.valid === true && (lintBareCompare.warnings?.length ?? 0) > 0,
    lintBareCompare.warnings?.[0]);

  const lintBareNumeric = validateExpression("state._shared.turn > 2");
  check("bare numeric comparison → valid with warning",
    lintBareNumeric.valid === true && (lintBareNumeric.warnings?.length ?? 0) > 0,
    lintBareNumeric.warnings?.[0]);

  const lintCorrectValue = validateExpression('state._shared.phase.value == "executing"');
  check("correct .value access → no warnings",
    lintCorrectValue.valid === true && (lintCorrectValue.warnings?.length ?? 0) === 0);

  const lintCorrectMeta = validateExpression("state._shared.phase._meta.score > 0.5");
  check("correct ._meta access → no warnings",
    lintCorrectMeta.valid === true && (lintCorrectMeta.warnings?.length ?? 0) === 0);

  // ── 4. Trial evaluation against room state ──
  console.log("\n--- Trial evaluation ---\n");

  const ctx = await buildContext(ROOM_ID, { selfAgent: "explorer" });

  const trialValid = validateExpression('state._shared.phase.value == "executing"', ctx);
  check("trial eval: valid expr → ok", trialValid.valid && trialValid.stage === "ok",
    `type: ${trialValid.type}`);

  const trialMissing = validateExpression("state._shared.nonexistent.value", ctx);
  check("trial eval: missing key → eval error", !trialMissing.valid && trialMissing.stage === "eval",
    trialMissing.error);
  check("trial eval: missing key has hint", !!trialMissing.hint);

  const trialType = validateExpression("state._shared.phase.value * 2", ctx);
  check("trial eval: type mismatch → eval error", !trialType.valid && trialType.stage === "eval",
    trialType.error);
  check("trial eval: type mismatch has hint", trialType.hint?.includes("Type mismatch") ?? false);

  // ── 5. Environment domain helpers work on room context ──
  console.log("\n--- Domain helpers on real room state ---\n");

  try {
    const r1 = celEval("salient(state._shared, 0.0)", ctx);
    check("salient() returns list", Array.isArray(r1), `${JSON.stringify(r1)}`);
  } catch (e: any) { check("salient() works", false, e.message); }

  try {
    const r2 = celEval('written_by(state._shared, "explorer")', ctx);
    check("written_by() returns list", Array.isArray(r2), `${JSON.stringify(r2)}`);
  } catch (e: any) { check("written_by() works", false, e.message); }

  try {
    const r3 = celEval("elided(state._shared)", ctx);
    check("elided() returns empty list (nothing elided at engine layer)", Array.isArray(r3) && r3.length === 0);
  } catch (e: any) { check("elided() works", false, e.message); }

  try {
    const r4 = celEval("state._shared.keys()", ctx);
    check(".keys() receiver works", Array.isArray(r4), `${JSON.stringify(r4)}`);
  } catch (e: any) { check(".keys() receiver works", false, e.message); }

  try {
    const r5 = celEval("state._shared.entries().filter(e, e.entry._meta.score > 0).size()", ctx);
    check("entries().filter().size() chain works", typeof r5 === "bigint" || typeof r5 === "number",
      `result: ${r5}`);
  } catch (e: any) { check("entries().filter().size() chain", false, e.message); }

  try {
    const r6 = celEval('val(state._shared.phase) == "executing"', ctx);
    check("val() shorthand evaluates correctly", r6 === true);
  } catch (e: any) { check("val() shorthand", false, e.message); }

  try {
    const r7 = celEval('meta(state._shared.phase, "writer")', ctx);
    check("meta() shorthand returns writer", r7 === "explorer" || r7 === null,
      `writer: ${r7}`);
  } catch (e: any) { check("meta() shorthand", false, e.message); }

  try {
    const r8 = celEval("top_n(state._shared, 2)", ctx);
    check("top_n() returns list of N keys", Array.isArray(r8) && r8.length === 2,
      `${JSON.stringify(r8)}`);
  } catch (e: any) { check("top_n() works", false, e.message); }

  // ── 6. getDefinitions() for agent documentation ──
  console.log("\n--- Environment definitions ---\n");

  const env = getCelEnvironment();
  try {
    const defs = env.getDefinitions();
    const customFns = defs.functions?.filter((f: any) => {
      const sig = f.signature ?? "";
      return sig.includes("salient") || sig.includes("elided") || sig.includes("written_by") ||
        sig.includes("val(") || sig.includes("meta(") || sig.includes("focus") ||
        sig.includes("contested") || sig.includes("stale") || sig.includes("active") ||
        sig.includes("velocity_above") || sig.includes("top_n") || sig.includes("peripheral");
    }) ?? [];
    check("custom domain functions registered", customFns.length >= 10,
      `found ${customFns.length} domain functions`);

    // Check that our functions have descriptions
    const withDesc = customFns.filter((f: any) => f.description);
    check("domain functions have descriptions", withDesc.length === customFns.length,
      `${withDesc.length}/${customFns.length} have descriptions`);
  } catch (e: any) { check("getDefinitions()", false, e.message); }
}

try {
  await setup();
  await test();
  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
  if (failed > 0) console.error(`\n❌ ${failed} checks failed`);
  else console.log(`\n✅ All checks passed`);
} catch (e) {
  console.error("Test error:", e);
  await cleanup().catch(() => {});
  throw e;
}
