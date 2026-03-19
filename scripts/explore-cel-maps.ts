/**
 * scripts/explore-cel-maps.ts — Explore cel-js capabilities on maps/objects.
 *
 * Tests what macros and operations work on map-typed data (our state scopes).
 * Goal: find what patterns work for filtering/querying wrapped entries.
 */

import { evaluate, parse, Environment } from "npm:@marcbachmann/cel-js";

// Simulate a wrapped state scope
const wrappedScope = {
  phase: { value: "executing", _meta: { score: 0.85, writer: "architect", revision: 3, velocity: 0.1 } },
  turn: { value: 3, _meta: { score: 0.5, writer: "system", revision: 5, velocity: 0.0 } },
  "concepts.substrate": { value: { name: "substrate", def: "shared state" }, _meta: { score: 0.9, writer: "explorer", revision: 7, velocity: 0.4 } },
  "concepts.stigmergy": { value: { name: "stigmergy", def: "indirect coord" }, _meta: { score: 0.3, writer: "synthesist", revision: 2, velocity: 0.0 } },
};

const ctx = {
  state: { _shared: wrappedScope },
  self: "explorer",
};

function tryExpr(label: string, expr: string, context?: any) {
  try {
    const result = evaluate(expr, context ?? ctx);
    const display = typeof result === "bigint" ? `${result}n` : JSON.stringify(result);
    console.log(`  ✓ ${label}`);
    console.log(`    expr: ${expr}`);
    console.log(`    result: ${display}`);
    return result;
  } catch (e: any) {
    console.log(`  ✗ ${label}`);
    console.log(`    expr: ${expr}`);
    console.log(`    error: ${e.message.split("\n")[0]}`);
    return undefined;
  }
}

console.log("=== 1. Basic map operations ===\n");

tryExpr("size of map", "size(state._shared)");
tryExpr("key access", 'state._shared.phase.value');
tryExpr("bracket key access", 'state._shared["concepts.substrate"].value.name');
tryExpr("has() on map key", 'has(state._shared.phase)');
tryExpr("has() on missing key", 'has(state._shared.nonexistent)');
tryExpr("in operator (key in map)", '"phase" in state._shared');
tryExpr("in operator (missing key)", '"missing" in state._shared');

console.log("\n=== 2. Map macros (2-arg: iterates keys) ===\n");

tryExpr("all keys exist pattern", 'state._shared.all(k, k != "")');
tryExpr("exists key matching", 'state._shared.exists(k, k == "phase")');
tryExpr("exists_one key", 'state._shared.exists_one(k, k == "phase")');

console.log("\n=== 3. Map macros with value access ===\n");
// In CEL, map macros iterate over KEYS. Can we access the value via the map?

tryExpr(
  "all: check score via map[key]",
  'state._shared.all(k, state._shared[k]._meta.score >= 0)',
);
tryExpr(
  "exists: high score entry",
  'state._shared.exists(k, state._shared[k]._meta.score > 0.8)',
);
tryExpr(
  "exists: writer check",
  'state._shared.exists(k, state._shared[k]._meta.writer == "explorer")',
);

console.log("\n=== 4. List-based workarounds ===\n");

// Convert map to list of entries first, then filter/map
// In CEL: does keys() or entries() exist?
tryExpr("map keys as list (not standard)", 'state._shared.keys()');

// Pipe syntax (might work at runtime but not parse for AST)
tryExpr("pipe: keys", 'state._shared | keys()');

console.log("\n=== 5. Filter/map attempts on maps ===\n");

tryExpr("2-arg filter on map (key filter)", 'state._shared.filter(k, k.startsWith("concepts"))');
tryExpr("3-arg filter on map (k, v, pred)", 'state._shared.filter(k, v, v._meta.score > 0.5)');
tryExpr("2-arg map on map", 'state._shared.map(k, k)');
tryExpr("3-arg map on map (filter+map)", 'state._shared.map(k, k.startsWith("concepts"), state._shared[k]._meta.writer)');

console.log("\n=== 6. List comprehension workaround ===\n");

// If we inject a keys list alongside the map, we can filter on the list
const ctxWithKeys = {
  ...ctx,
  _keys: Object.keys(wrappedScope),
};

tryExpr(
  "filter keys list by score",
  '_keys.filter(k, state._shared[k]._meta.score > 0.5)',
  ctxWithKeys,
);
tryExpr(
  "map keys to writers",
  '_keys.map(k, state._shared[k]._meta.writer)',
  ctxWithKeys,
);
tryExpr(
  "count high-score entries via keys list",
  'size(_keys.filter(k, state._shared[k]._meta.score > 0.5))',
  ctxWithKeys,
);
tryExpr(
  "count entries by writer",
  'size(_keys.filter(k, state._shared[k]._meta.writer == "explorer"))',
  ctxWithKeys,
);

console.log("\n=== 7. Environment API with custom functions ===\n");

const env = new Environment({ unlistedVariablesAreDyn: true });

// Register helper functions that operate on the wrapped scope
env.registerFunction('count_where(map, string, string): int', (scope: any, field: string, value: string) => {
  let count = 0n;
  for (const key of Object.keys(scope)) {
    const entry = scope[key];
    if (entry?._meta?.[field] === value) count++;
  }
  return count;
});

env.registerFunction('high_score_keys(map, double): list', (scope: any, threshold: number) => {
  const keys: string[] = [];
  for (const key of Object.keys(scope)) {
    const entry = scope[key];
    if (entry?._meta?.score > threshold) keys.push(key);
  }
  return keys;
});

env.registerFunction('scope_keys(map): list', (scope: any) => {
  return Object.keys(scope);
});

try {
  const r1 = env.evaluate('count_where(state._shared, "writer", "explorer")', ctx);
  console.log(`  ✓ count_where: ${r1}`);
} catch (e: any) {
  console.log(`  ✗ count_where: ${e.message.split("\n")[0]}`);
}

try {
  const r2 = env.evaluate('high_score_keys(state._shared, 0.5)', ctx);
  console.log(`  ✓ high_score_keys(>0.5): ${JSON.stringify(r2)}`);
} catch (e: any) {
  console.log(`  ✗ high_score_keys: ${e.message.split("\n")[0]}`);
}

try {
  const r3 = env.evaluate('scope_keys(state._shared)', ctx);
  console.log(`  ✓ scope_keys: ${JSON.stringify(r3)}`);
} catch (e: any) {
  console.log(`  ✗ scope_keys: ${e.message.split("\n")[0]}`);
}

// Can we chain: get keys, then filter with list macros?
try {
  const r4 = env.evaluate(
    'scope_keys(state._shared).filter(k, state._shared[k]._meta.score > 0.5)',
    ctx,
  );
  console.log(`  ✓ scope_keys + list filter: ${JSON.stringify(r4)}`);
} catch (e: any) {
  console.log(`  ✗ scope_keys + list filter: ${e.message.split("\n")[0]}`);
}

try {
  const r5 = env.evaluate(
    'scope_keys(state._shared).filter(k, state._shared[k]._meta.writer == "explorer").size()',
    ctx,
  );
  console.log(`  ✓ scope_keys + filter by writer + size: ${r5}`);
} catch (e: any) {
  console.log(`  ✗ scope_keys + filter by writer + size: ${e.message.split("\n")[0]}`);
}

console.log("\n=== 8. Practical v9 expressions (best patterns found) ===\n");

// Using whichever patterns work from above, show practical expressions
try {
  // "Enable synthesis only when concepts have stabilized"
  const r = env.evaluate(
    '!scope_keys(state._shared).exists(k, k.startsWith("concepts") && state._shared[k]._meta.velocity > 0.3)',
    ctx,
  );
  console.log(`  ✓ "concepts stabilized" gate: ${r}`);
} catch (e: any) {
  console.log(`  ✗ "concepts stabilized" gate: ${e.message.split("\n")[0]}`);
}

try {
  // "How many things has explorer written?"
  const r = env.evaluate(
    'scope_keys(state._shared).filter(k, state._shared[k]._meta.writer == "explorer").size()',
    ctx,
  );
  console.log(`  ✓ "explorer write count": ${r}`);
} catch (e: any) {
  console.log(`  ✗ "explorer write count": ${e.message.split("\n")[0]}`);
}

try {
  // "Get all high-salience keys I haven't written"
  const r = env.evaluate(
    'scope_keys(state._shared).filter(k, state._shared[k]._meta.score > 0.5 && state._shared[k]._meta.writer != self)',
    ctx,
  );
  console.log(`  ✓ "high-salience keys not written by me": ${JSON.stringify(r)}`);
} catch (e: any) {
  console.log(`  ✗ "high-salience keys not written by me": ${e.message.split("\n")[0]}`);
}

console.log("\nDone.");
