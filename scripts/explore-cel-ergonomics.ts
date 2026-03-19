/**
 * scripts/explore-cel-ergonomics.ts — Explore Environment API for wrapped state ergonomics.
 *
 * Goal: Find the best patterns for making CEL expressions over { value, _meta }
 * entries feel natural. Test custom functions, receiver methods, and macros.
 */

import { evaluate, parse, Environment } from "npm:@marcbachmann/cel-js";

// ── Test data ──────────────────────────────────────────────────────────

const wrappedScope = {
  phase: {
    value: "executing",
    _meta: { score: 0.85, writer: "architect", revision: 3, velocity: 0.1, elided: false, writers: ["architect"] },
  },
  turn: {
    value: 3,
    _meta: { score: 0.5, writer: "system", revision: 5, velocity: 0.0, elided: false, writers: ["system"] },
  },
  "concepts.substrate": {
    value: { name: "substrate", definition: "shared-state coordination layer" },
    _meta: { score: 0.9, writer: "explorer", revision: 7, velocity: 0.4, elided: false, writers: ["explorer", "synthesist"] },
  },
  "concepts.stigmergy": {
    value: { name: "stigmergy", definition: "indirect coordination" },
    _meta: { score: 0.3, writer: "synthesist", revision: 2, velocity: 0.0, elided: false, writers: ["synthesist"] },
  },
  "concepts.emergence": {
    value: null, // elided
    _meta: { score: 0.04, writer: "explorer", revision: 1, velocity: 0.0, elided: true, writers: ["explorer"] },
  },
};

const wrappedActions = {
  add_concept: {
    value: { enabled: true, available: true, description: "Add a concept" },
    _meta: { score: 0.6, invocations: 14, last_invoked_by: "explorer", contested: ["refine_concept"], elided: false },
  },
  refine_concept: {
    value: { enabled: true, available: true, description: "Refine a concept" },
    _meta: { score: 0.4, invocations: 3, last_invoked_by: "synthesist", contested: ["add_concept"], elided: false },
  },
  synthesize: {
    value: { enabled: false, available: false, description: "Generate synthesis" },
    _meta: { score: 0.2, invocations: 0, last_invoked_by: null, contested: [], elided: false },
  },
};

const ctx = {
  state: { _shared: wrappedScope },
  actions: wrappedActions,
  self: "explorer",
};

// ── Helpers ─────────────────────────────────────────────────────────────

let passCount = 0;
let failCount = 0;

function tryExpr(env: Environment, label: string, expr: string, context?: any) {
  try {
    const result = env.evaluate(expr, context ?? ctx);
    const display = typeof result === "bigint" ? `${result}n` : JSON.stringify(result);
    console.log(`  ✓ ${label}`);
    console.log(`    ${expr}`);
    console.log(`    → ${display}`);
    passCount++;
    return result;
  } catch (e: any) {
    console.log(`  ✗ ${label}`);
    console.log(`    ${expr}`);
    console.log(`    ERROR: ${e.message.split("\n")[0]}`);
    failCount++;
    return undefined;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// APPROACH 1: Utility functions (scope → list conversions)
// ═══════════════════════════════════════════════════════════════════════

console.log("═══ APPROACH 1: Utility functions ═══\n");

const env1 = new Environment({ unlistedVariablesAreDyn: true });

// keys(map) → list of key strings
env1.registerFunction("keys(map): list", (m: any) => Object.keys(m));

// values(map) → list of wrapped entries
env1.registerFunction("values(map): list", (m: any) => Object.values(m));

// entries(map) → list of [key, entry] pairs
env1.registerFunction("entries(map): list", (m: any) =>
  Object.entries(m).map(([k, v]) => ({ key: k, entry: v }))
);

console.log("--- keys / values / entries ---\n");

tryExpr(env1, "keys(scope)", "keys(state._shared)");
tryExpr(env1, "keys + filter by meta", 
  'keys(state._shared).filter(k, state._shared[k]._meta.score > 0.5)');
tryExpr(env1, "keys + count by writer",
  'size(keys(state._shared).filter(k, state._shared[k]._meta.writer == "explorer"))');
tryExpr(env1, "values: count non-elided",
  "values(state._shared).filter(e, !e._meta.elided).size()");
tryExpr(env1, "entries: map to key+score pairs",
  "entries(state._shared).map(e, e.key + \": \" + string(e.entry._meta.score))");

// ═══════════════════════════════════════════════════════════════════════
// APPROACH 2: Receiver methods on maps (called as map.method())
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ APPROACH 2: Receiver methods ═══\n");

const env2 = new Environment({ unlistedVariablesAreDyn: true });

// map.keys() as a receiver method
env2.registerFunction({
  name: "keys",
  receiverType: "map",
  returnType: "list",
  handler: (m: any) => Object.keys(m),
  params: [],
});

// map.values() as a receiver method
env2.registerFunction({
  name: "values",
  receiverType: "map",
  returnType: "list",
  handler: (m: any) => Object.values(m),
  params: [],
});

// map.entries() as a receiver method → list of {key, entry}
env2.registerFunction({
  name: "entries",
  receiverType: "map",
  returnType: "list",
  handler: (m: any) => Object.entries(m).map(([k, v]) => ({ key: k, entry: v })),
  params: [],
});

console.log("--- scope.keys() / scope.values() / scope.entries() ---\n");

tryExpr(env2, "scope.keys()", "state._shared.keys()");
tryExpr(env2, "scope.values()", "state._shared.values().size()");
tryExpr(env2, "scope.entries()", "state._shared.entries().size()");
tryExpr(env2, "keys + filter chain",
  'state._shared.keys().filter(k, state._shared[k]._meta.score > 0.5)');
tryExpr(env2, "entries + filter on entry",
  "state._shared.entries().filter(e, e.entry._meta.score > 0.5).size()");
tryExpr(env2, "entries + map to writers",
  "state._shared.entries().filter(e, !e.entry._meta.elided).map(e, e.entry._meta.writer)");
tryExpr(env2, "entries: high-score elided keys",
  "state._shared.entries().filter(e, e.entry._meta.elided && e.entry._meta.score > 0.01).map(e, e.key)");

// ═══════════════════════════════════════════════════════════════════════
// APPROACH 3: Domain-specific helpers
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ APPROACH 3: Domain helpers ═══\n");

const env3 = new Environment({ unlistedVariablesAreDyn: true });

// Reuse receiver methods
env3.registerFunction({
  name: "keys",
  receiverType: "map",
  returnType: "list",
  handler: (m: any) => Object.keys(m),
  params: [],
});
env3.registerFunction({
  name: "values",
  receiverType: "map",
  returnType: "list",
  handler: (m: any) => Object.values(m),
  params: [],
});
env3.registerFunction({
  name: "entries",
  receiverType: "map",
  returnType: "list",
  handler: (m: any) => Object.entries(m).map(([k, v]) => ({ key: k, entry: v })),
  params: [],
});

// written_by(scope, agent) → list of keys written by agent
env3.registerFunction("written_by(map, string): list", (scope: any, agent: string) =>
  Object.keys(scope).filter(k => scope[k]?._meta?.writer === agent)
);

// salient(scope, threshold) → list of keys above threshold
env3.registerFunction("salient(map, double): list", (scope: any, threshold: number) =>
  Object.keys(scope).filter(k => scope[k]?._meta?.score > threshold)
);

// elided(scope) → list of elided keys
env3.registerFunction("elided(map): list", (scope: any) =>
  Object.keys(scope).filter(k => scope[k]?._meta?.elided === true)
);

// active(scope) → list of non-elided keys
env3.registerFunction("active(map): list", (scope: any) =>
  Object.keys(scope).filter(k => !scope[k]?._meta?.elided)
);

// velocity_above(scope, threshold) → keys with velocity above threshold
env3.registerFunction("velocity_above(map, double): list", (scope: any, threshold: number) =>
  Object.keys(scope).filter(k => (scope[k]?._meta?.velocity ?? 0) > threshold)
);

// contested(actions_map) → list of action IDs that have contested targets
env3.registerFunction("contested(map): list", (actions: any) =>
  Object.keys(actions).filter(k => {
    const c = actions[k]?._meta?.contested;
    return Array.isArray(c) && c.length > 0;
  })
);

// stale(actions_map, count_threshold) → actions with < N invocations
env3.registerFunction("stale(map, int): list", (actions: any, threshold: bigint) =>
  Object.keys(actions).filter(k => (actions[k]?._meta?.invocations ?? 0) < Number(threshold))
);

console.log("--- Domain helpers ---\n");

tryExpr(env3, "written_by(scope, agent)",
  'written_by(state._shared, "explorer")');
tryExpr(env3, "salient(scope, threshold)",
  "salient(state._shared, 0.5)");
tryExpr(env3, "elided(scope)",
  "elided(state._shared)");
tryExpr(env3, "active(scope) count",
  "size(active(state._shared))");
tryExpr(env3, "velocity_above for stability gate",
  'size(velocity_above(state._shared, 0.3)) == 0');
tryExpr(env3, "contested actions",
  "contested(actions)");
tryExpr(env3, "stale actions (< 5 invocations)",
  "stale(actions, 5)");

// ═══════════════════════════════════════════════════════════════════════
// APPROACH 4: Combining approaches — practical expressions
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ APPROACH 4: Practical v9 expressions ═══\n");

// Use env3 which has all helpers

console.log("--- Action predicates (if / enabled gates) ---\n");

tryExpr(env3, "gate: only when concepts stabilized",
  'size(velocity_above(state._shared, 0.3)) == 0');

tryExpr(env3, "gate: only if I haven't written the target",
  'state._shared["concepts.substrate"]._meta.writer != self');

tryExpr(env3, "gate: only if target was recently updated",
  'state._shared["concepts.substrate"]._meta.velocity > 0.1');

tryExpr(env3, "gate: at least 3 non-elided concepts exist",
  'active(state._shared).filter(k, k.startsWith("concepts")).size() >= 3');

tryExpr(env3, "gate: action not invoked more than 20 times",
  "actions.add_concept._meta.invocations < 20");

tryExpr(env3, "gate: only invoke if contested",
  "size(actions.add_concept._meta.contested) > 0");

console.log("\n--- View expressions ---\n");

tryExpr(env3, "view: count of active concepts",
  'active(state._shared).filter(k, k.startsWith("concepts")).size()');

tryExpr(env3, "view: high-salience keys I should look at",
  "salient(state._shared, 0.5)");

tryExpr(env3, "view: what am I not seeing?",
  "elided(state._shared)");

tryExpr(env3, "view: who is most active writer?",
  "state._shared.entries().filter(e, !e.entry._meta.elided).map(e, e.entry._meta.writer)");

tryExpr(env3, "view: velocity report as key list",
  "state._shared.entries().filter(e, e.entry._meta.velocity > 0).map(e, e.key)");

console.log("\n--- Self-aware / meta-reasoning ---\n");

tryExpr(env3, "am I seeing less than half?",
  "size(elided(state._shared)) > size(active(state._shared))");

tryExpr(env3, "how many of my writes are high-salience?",
  'written_by(state._shared, self).filter(k, state._shared[k]._meta.score > 0.5).size()');

tryExpr(env3, "are there contested actions I registered?",
  'contested(actions).exists(a, actions[a]._meta.last_invoked_by == self)');

// ═══════════════════════════════════════════════════════════════════════
// APPROACH 5: Custom macros (parse-time transforms)
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ APPROACH 5: Custom macros ═══\n");

const env5 = new Environment({ unlistedVariablesAreDyn: true });

// Reuse receiver methods
env5.registerFunction({
  name: "keys",
  receiverType: "map",
  returnType: "list",
  handler: (m: any) => Object.keys(m),
  params: [],
});
env5.registerFunction({
  name: "entries",
  receiverType: "map",
  returnType: "list",
  handler: (m: any) => Object.entries(m).map(([k, v]) => ({ key: k, entry: v })),
  params: [],
});

// Try registering a macro that transforms at parse time
// The idea: scope.where(field, op, value) → filtered key list
try {
  env5.registerFunction('where(ast): dyn', ({ast, args}: any) => {
    return {
      typeCheck(checker: any, macro: any, ctx: any) {
        return { type: 'list' };
      },
      evaluate(evaluator: any, macro: any, ctx: any) {
        // This runs at evaluation time
        const scope = evaluator.eval(args[0], ctx);
        if (!scope || typeof scope !== 'object') return [];
        return Object.keys(scope);
      }
    };
  });
  console.log("  ✓ Macro registered (where)");
} catch (e: any) {
  console.log(`  ✗ Macro registration failed: ${e.message.split("\n")[0]}`);
}

// Try a simpler macro: `val(entry)` → entry.value (shorthand for .value)
try {
  env5.registerFunction('val(dyn): dyn', (entry: any) => {
    if (entry && typeof entry === 'object' && 'value' in entry) return entry.value;
    return entry;
  });
  console.log("  ✓ val() function registered");
  
  tryExpr(env5, "val(entry) shorthand",
    'val(state._shared.phase) == "executing"');
  tryExpr(env5, "val() on nested",
    'val(state._shared["concepts.substrate"]).name == "substrate"');
} catch (e: any) {
  console.log(`  ✗ val() registration failed: ${e.message.split("\n")[0]}`);
}

// meta(entry, field) → entry._meta[field]
try {
  env5.registerFunction('meta(dyn, string): dyn', (entry: any, field: string) => {
    if (entry && typeof entry === 'object' && '_meta' in entry) return entry._meta[field];
    return null;
  });
  console.log("  ✓ meta() function registered");
  
  tryExpr(env5, "meta(entry, field) shorthand",
    'meta(state._shared.phase, "writer") == "architect"');
  tryExpr(env5, "meta for score",
    'meta(state._shared["concepts.substrate"], "score") > 0.5');
} catch (e: any) {
  console.log(`  ✗ meta() registration failed: ${e.message.split("\n")[0]}`);
}

// ═══════════════════════════════════════════════════════════════════════
// APPROACH 6: Score-aware sorting helper
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ APPROACH 6: Score-aware helpers ═══\n");

const env6 = new Environment({ unlistedVariablesAreDyn: true });

env6.registerFunction({
  name: "keys",
  receiverType: "map",
  returnType: "list",
  handler: (m: any) => Object.keys(m),
  params: [],
});

// top_n(scope, n) → top N keys by score
env6.registerFunction("top_n(map, int): list", (scope: any, n: bigint) => {
  const entries = Object.entries(scope)
    .map(([k, v]: [string, any]) => ({ key: k, score: v?._meta?.score ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(n));
  return entries.map(e => e.key);
});

// focus(scope) → keys in focus tier (high score, non-elided)
env6.registerFunction("focus(map): list", (scope: any) =>
  Object.entries(scope)
    .filter(([_, v]: [string, any]) => !v?._meta?.elided && (v?._meta?.score ?? 0) > 0.5)
    .map(([k]) => k)
);

// peripheral(scope) → keys in peripheral tier (medium score, non-elided)
env6.registerFunction("peripheral(map): list", (scope: any) =>
  Object.entries(scope)
    .filter(([_, v]: [string, any]) => {
      const s = v?._meta?.score ?? 0;
      return !v?._meta?.elided && s > 0.1 && s <= 0.5;
    })
    .map(([k]) => k)
);

tryExpr(env6, "top_n(scope, 3)",
  "top_n(state._shared, 3)");
tryExpr(env6, "focus(scope) — high tier keys",
  "focus(state._shared)");
tryExpr(env6, "peripheral(scope) — medium tier keys",
  "peripheral(state._shared)");
tryExpr(env6, "gate: only proceed if focus set has concepts",
  'focus(state._shared).exists(k, k.startsWith("concepts"))');

// ═══════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════");
console.log(`Total: ${passCount} passed, ${failCount} failed`);
console.log("═══════════════════════════════════════════════\n");

console.log("RECOMMENDED PATTERN:");
console.log("  Combine receiver methods (.keys(), .entries()) with domain helpers");
console.log("  (written_by, salient, elided, focus) and direct ._meta access.\n");
console.log("  Receiver: state._shared.entries().filter(e, e.entry._meta.score > 0.5)");
console.log("  Helper:   salient(state._shared, 0.5)");
console.log("  Direct:   state._shared.phase._meta.writer == self");
console.log("  Shorthand: val(state._shared.phase) == \"executing\"");
