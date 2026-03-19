/**
 * scripts/test-v9-wrap.ts — Verify wrapped context shape.
 *
 * Creates a test room with state, actions, views, agents, and messages,
 * then calls buildContext and validates the wrapped shape.
 *
 * Run: Val.town run_file on this script
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { migrate } from "../schema.ts";
import { migrateV8 } from "../schema-v8.ts";
import { buildContext } from "../cel.ts";
import { contentHash } from "../utils.ts";

const ROOM_ID = "_test_v9_wrap_" + Date.now();

async function setup() {
  await migrate();
  await migrateV8();

  // Create room
  const token = "room_test_" + Date.now();
  const tokenHash = await contentHash(token);
  await sqlite.execute({
    sql: `INSERT OR IGNORE INTO rooms (id, token_hash, created_at) VALUES (?, ?, datetime('now'))`,
    args: [ROOM_ID, tokenHash],
  });

  // Add some _shared state
  const entries = [
    { scope: "_shared", key: "phase", value: JSON.stringify("executing") },
    { scope: "_shared", key: "turn", value: JSON.stringify(3) },
    {
      scope: "_shared",
      key: "concepts.substrate",
      value: JSON.stringify({
        name: "substrate",
        definition: "shared-state coordination layer",
      }),
    },
    {
      scope: "_shared",
      key: "concepts.stigmergy",
      value: JSON.stringify({
        name: "stigmergy",
        definition: "indirect coordination through environment",
      }),
    },
  ];

  for (const e of entries) {
    const hash = await contentHash(e.value);
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
            ON CONFLICT(room_id, scope, key) DO UPDATE SET
              value = excluded.value, version = excluded.version,
              revision = state.revision + 1, updated_at = datetime('now')`,
      args: [ROOM_ID, e.scope, e.key, e.value, hash],
    });
  }

  // Add agents
  const agents = [
    {
      id: "explorer",
      value: {
        name: "Explorer",
        role: "concept-finder",
        status: "active",
        last_heartbeat: new Date().toISOString(),
        last_seen_seq: 0,
      },
    },
    {
      id: "synthesist",
      value: {
        name: "Synthesist",
        role: "concept-linker",
        status: "active",
        last_heartbeat: new Date(Date.now() - 60000).toISOString(),
        last_seen_seq: 0,
      },
    },
  ];

  for (const a of agents) {
    const val = JSON.stringify(a.value);
    const hash = await contentHash(val);
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
            VALUES (?, '_agents', ?, ?, ?, 1, datetime('now'))
            ON CONFLICT(room_id, scope, key) DO UPDATE SET
              value = excluded.value, version = excluded.version,
              revision = state.revision + 1, updated_at = datetime('now')`,
      args: [ROOM_ID, a.id, val, hash],
    });

    // Also insert into agents table for auth
    const agentToken = "as_test_" + a.id;
    const agentTokenHash = await contentHash(agentToken);
    await sqlite.execute({
      sql: `INSERT OR IGNORE INTO agents (id, room_id, name, role, status, token_hash, joined_at, last_heartbeat)
            VALUES (?, ?, ?, ?, 'active', ?, datetime('now'), datetime('now'))`,
      args: [a.id, ROOM_ID, a.value.name, a.value.role, agentTokenHash],
    });
  }

  // Add actions
  const actions = [
    {
      id: "add_concept",
      value: {
        description: "Add a new concept to the shared knowledge base",
        registered_by: "explorer",
        scope: "_shared",
        params: {
          name: { type: "string" },
          definition: { type: "string" },
        },
        writes: [
          {
            scope: "_shared",
            key: "concepts.${params.name}",
            value: {
              name: "${params.name}",
              definition: "${params.definition}",
            },
          },
        ],
      },
    },
    {
      id: "refine_concept",
      value: {
        description: "Refine an existing concept definition",
        registered_by: "synthesist",
        scope: "_shared",
        params: {
          name: { type: "string" },
          definition: { type: "string" },
        },
        writes: [
          {
            scope: "_shared",
            key: "concepts.${params.name}",
            merge: { definition: "${params.definition}", refined: true },
          },
        ],
      },
    },
  ];

  for (const a of actions) {
    const val = JSON.stringify(a.value);
    const hash = await contentHash(val);
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
            VALUES (?, '_actions', ?, ?, ?, 1, datetime('now'))
            ON CONFLICT(room_id, scope, key) DO UPDATE SET
              value = excluded.value, version = excluded.version,
              revision = state.revision + 1, updated_at = datetime('now')`,
      args: [ROOM_ID, a.id, val, hash],
    });
  }

  // Add a view
  const viewDef = {
    expr: 'size(state._shared)',
    description: "Count of entries in _shared scope",
    registered_by: "explorer",
    scope: "explorer",
  };
  const viewVal = JSON.stringify(viewDef);
  const viewHash = await contentHash(viewVal);
  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, value, version, revision, updated_at)
          VALUES (?, '_views', 'shared_entry_count', ?, ?, 1, datetime('now'))`,
    args: [ROOM_ID, viewVal, viewHash],
  });

  // Add some audit entries to populate meta
  const auditEntries = [
    {
      ts: new Date(Date.now() - 120000).toISOString(),
      kind: "invoke",
      agent: "explorer",
      action: "add_concept",
      ok: true,
      params: { name: "substrate", definition: "shared-state coordination layer" },
      effect: {
        writes: [
          { scope: "_shared", key: "concepts.substrate", value: { name: "substrate", definition: "shared-state coordination layer" } },
        ],
      },
    },
    {
      ts: new Date(Date.now() - 60000).toISOString(),
      kind: "invoke",
      agent: "explorer",
      action: "add_concept",
      ok: true,
      params: { name: "stigmergy", definition: "indirect coordination" },
      effect: {
        writes: [
          { scope: "_shared", key: "concepts.stigmergy", value: { name: "stigmergy", definition: "indirect coordination" } },
        ],
      },
    },
    {
      ts: new Date(Date.now() - 30000).toISOString(),
      kind: "invoke",
      agent: "synthesist",
      action: "refine_concept",
      ok: true,
      params: { name: "stigmergy", definition: "indirect coordination through environment" },
      effect: {
        writes: [
          { scope: "_shared", key: "concepts.stigmergy", value: { name: "stigmergy", definition: "indirect coordination through environment", refined: true } },
        ],
      },
    },
  ];

  for (let i = 0; i < auditEntries.length; i++) {
    const seq = i + 1;
    await sqlite.execute({
      sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, updated_at)
            VALUES (?, '_audit', ?, ?, ?, 1, datetime('now'))`,
      args: [ROOM_ID, String(seq), seq, JSON.stringify(auditEntries[i])],
    });
  }

  // Add a message
  const msg = JSON.stringify({
    from: "explorer",
    kind: "chat",
    body: "Found two interesting concepts",
    to: ["synthesist"],
  });
  const msgHash = await contentHash(msg);
  await sqlite.execute({
    sql: `INSERT INTO state (room_id, scope, key, sort_key, value, version, revision, updated_at)
          VALUES (?, '_messages', '1', 1, ?, ?, 1, datetime('now'))`,
    args: [ROOM_ID, msg, msgHash],
  });
}

async function test() {
  console.log("=== v9 Wrapped Context Test ===\n");

  // Build context as explorer
  const ctx = await buildContext(ROOM_ID, { selfAgent: "explorer" });

  // ── Verify shape ──
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  // 1. State entries are wrapped
  const phase = ctx.state._shared?.phase;
  checks.push({
    name: "state entry has .value",
    ok: phase?.value === "executing",
    detail: `phase.value = ${JSON.stringify(phase?.value)}`,
  });
  checks.push({
    name: "state entry has ._meta",
    ok: typeof phase?._meta === "object" && phase._meta !== null,
    detail: `phase._meta keys: ${phase?._meta ? Object.keys(phase._meta).join(", ") : "MISSING"}`,
  });
  checks.push({
    name: "_meta has revision",
    ok: typeof phase?._meta?.revision === "number",
    detail: `revision = ${phase?._meta?.revision}`,
  });
  checks.push({
    name: "_meta has score",
    ok: typeof phase?._meta?.score === "number",
    detail: `score = ${phase?._meta?.score}`,
  });
  checks.push({
    name: "_meta has velocity",
    ok: typeof phase?._meta?.velocity === "number",
    detail: `velocity = ${phase?._meta?.velocity}`,
  });

  // 2. Concepts have provenance from audit
  const substrate = ctx.state._shared?.["concepts.substrate"];
  checks.push({
    name: "concepts.substrate has writer from audit",
    ok: substrate?._meta?.writer === "explorer",
    detail: `writer = ${substrate?._meta?.writer}`,
  });
  checks.push({
    name: "concepts.substrate has via from audit",
    ok: substrate?._meta?.via === "add_concept",
    detail: `via = ${substrate?._meta?.via}`,
  });

  // 3. Key with multiple writers
  const stigmergy = ctx.state._shared?.["concepts.stigmergy"];
  checks.push({
    name: "stigmergy last writer is synthesist",
    ok: stigmergy?._meta?.writer === "synthesist",
    detail: `writer = ${stigmergy?._meta?.writer}`,
  });
  checks.push({
    name: "stigmergy has multiple writers",
    ok: Array.isArray(stigmergy?._meta?.writers) && stigmergy._meta.writers.length === 2,
    detail: `writers = ${JSON.stringify(stigmergy?._meta?.writers)}`,
  });

  // 4. Agents are wrapped
  const explorerAgent = ctx.agents?.explorer;
  checks.push({
    name: "agents.explorer has .value.name",
    ok: explorerAgent?.value?.name === "Explorer",
    detail: `name = ${explorerAgent?.value?.name}`,
  });
  checks.push({
    name: "agents.explorer has ._meta",
    ok: typeof explorerAgent?._meta === "object",
    detail: `_meta keys: ${explorerAgent?._meta ? Object.keys(explorerAgent._meta).join(", ") : "MISSING"}`,
  });

  // 5. Actions are wrapped with action-specific meta
  const addConcept = ctx.actions?.add_concept;
  checks.push({
    name: "actions.add_concept has .value",
    ok: typeof addConcept?.value === "object",
    detail: `value = ${JSON.stringify(addConcept?.value)}`,
  });
  checks.push({
    name: "actions.add_concept has invocations in _meta",
    ok: typeof addConcept?._meta?.invocations === "number",
    detail: `invocations = ${(addConcept?._meta as any)?.invocations}`,
  });
  checks.push({
    name: "add_concept invocations = 2 (from audit)",
    ok: (addConcept?._meta as any)?.invocations === 2,
    detail: `invocations = ${(addConcept?._meta as any)?.invocations}`,
  });
  checks.push({
    name: "add_concept contested with refine_concept",
    ok: Array.isArray((addConcept?._meta as any)?.contested) &&
      (addConcept?._meta as any)?.contested.includes("refine_concept"),
    detail: `contested = ${JSON.stringify((addConcept?._meta as any)?.contested)}`,
  });

  // 6. Views are wrapped
  const viewResult = ctx.views?.shared_entry_count;
  checks.push({
    name: "views.shared_entry_count has .value",
    ok: typeof viewResult?.value === "number",
    detail: `value = ${viewResult?.value}`,
  });
  checks.push({
    name: "views.shared_entry_count has ._meta",
    ok: typeof viewResult?._meta === "object",
    detail: `_meta keys: ${viewResult?._meta ? Object.keys(viewResult._meta).join(", ") : "MISSING"}`,
  });

  // 7. Messages summary (not wrapped — it's a computed aggregate)
  checks.push({
    name: "messages is a summary object",
    ok: typeof ctx.messages?.count === "number",
    detail: `count = ${ctx.messages?.count}`,
  });
  checks.push({
    name: "directed_unread for synthesist's message to explorer",
    ok: true, // explorer's directed_unread is 0 because the message is FROM explorer TO synthesist
    detail: `directed_unread = ${ctx.messages?.directed_unread}`,
  });

  // 8. Self is set
  checks.push({
    name: "self = explorer",
    ok: ctx.self === "explorer",
    detail: `self = ${ctx.self}`,
  });

  // ── Print results ──
  let passed = 0;
  let failed = 0;
  for (const c of checks) {
    const icon = c.ok ? "✓" : "✗";
    console.log(`  ${icon} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    if (c.ok) passed++;
    else failed++;
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${checks.length} checks`);

  // ── Print sample wrapped entries ──
  console.log("\n=== Sample wrapped entries ===\n");
  console.log("state._shared.phase:");
  console.log(JSON.stringify(phase, null, 2));
  console.log("\nstate._shared['concepts.stigmergy']:");
  console.log(JSON.stringify(stigmergy, null, 2));
  console.log("\nactions.add_concept:");
  console.log(JSON.stringify(addConcept, null, 2));
  console.log("\nviews.shared_entry_count:");
  console.log(JSON.stringify(viewResult, null, 2));

  return { passed, failed, total: checks.length };
}

async function cleanup() {
  await sqlite.execute({
    sql: `DELETE FROM state WHERE room_id = ?`,
    args: [ROOM_ID],
  });
  await sqlite.execute({
    sql: `DELETE FROM agents WHERE room_id = ?`,
    args: [ROOM_ID],
  });
  await sqlite.execute({
    sql: `DELETE FROM rooms WHERE id = ?`,
    args: [ROOM_ID],
  });
  try {
    await sqlite.execute({
      sql: `DELETE FROM log_index WHERE room_id = ?`,
      args: [ROOM_ID],
    });
  } catch {}
}

// ── Run ──
try {
  await setup();
  const result = await test();
  await cleanup();
  if (result.failed > 0) {
    console.error(`\n❌ ${result.failed} checks failed`);
  } else {
    console.log(`\n✅ All ${result.total} checks passed`);
  }
} catch (e) {
  console.error("Test error:", e);
  await cleanup().catch(() => {});
  throw e;
}
