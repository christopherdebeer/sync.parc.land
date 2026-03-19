/**
 * scripts/explore-cel-errors.ts — Explore error reporting, parse/compile feedback,
 * and type-checking in cel-js Environment API.
 *
 * Goal: Understand what quality of error messages we can give room designers
 * when their CEL expressions are malformed, reference missing keys, have type
 * mismatches, or use the wrapped shape incorrectly.
 */

import { evaluate, parse, Environment, ParseError, EvaluationError } from "npm:@marcbachmann/cel-js";

// ── Test wrapped context ────────────────────────────────────────────────

const wrappedScope = {
  phase: {
    value: "executing",
    _meta: { score: 0.85, writer: "architect", revision: 3, velocity: 0.1, elided: false },
  },
  turn: {
    value: 3,
    _meta: { score: 0.5, writer: "system", revision: 5, velocity: 0.0, elided: false },
  },
  "concepts.substrate": {
    value: { name: "substrate", definition: "shared-state coordination" },
    _meta: { score: 0.9, writer: "explorer", revision: 7, velocity: 0.4, elided: false },
  },
};

const ctx = {
  state: { _shared: wrappedScope },
  actions: {},
  agents: {},
  views: {},
  messages: { count: 0, unread: 0, directed_unread: 0 },
  self: "explorer",
  params: {},
};

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: Parse errors — what feedback does parse() give?
// ═══════════════════════════════════════════════════════════════════════

console.log("═══ 1. PARSE ERRORS ═══\n");

function tryParse(label: string, expr: string) {
  try {
    const compiled = parse(expr);
    console.log(`  ✓ parsed: ${label}`);
    return compiled;
  } catch (e: any) {
    const isParseError = e instanceof ParseError;
    console.log(`  ✗ ${label}`);
    console.log(`    expr: ${expr}`);
    console.log(`    type: ${isParseError ? "ParseError" : e.constructor?.name ?? typeof e}`);
    console.log(`    message: ${e.message}`);
    if (e.line !== undefined) console.log(`    line: ${e.line}, col: ${e.column}`);
    if (e.source !== undefined) console.log(`    source: ${e.source}`);
    return null;
  }
}

tryParse("valid expression", 'state._shared.phase.value == "executing"');
tryParse("syntax error: missing operand", "state._shared.phase ==");
tryParse("syntax error: unbalanced parens", "size(state._shared");
tryParse("syntax error: invalid token", "state._shared.phase === 'test'");
tryParse("syntax error: pipe (unsupported)", "state._shared | keys()");
tryParse("syntax error: empty", "");
tryParse("syntax error: just a dot", ".");
tryParse("syntax error: double operator", "1 ++ 2");
tryParse("syntax error: bad string", '"unterminated');
tryParse("misspelled macro", "state._shared.filtr(k, k == 1)");

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: Evaluation errors — what happens at runtime?
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ 2. EVALUATION ERRORS ═══\n");

function tryEval(label: string, expr: string, context?: any) {
  try {
    const result = evaluate(expr, context ?? ctx);
    const display = typeof result === "bigint" ? `${result}n` : JSON.stringify(result);
    console.log(`  ✓ ${label} → ${display}`);
    return result;
  } catch (e: any) {
    const isEvalError = e instanceof EvaluationError;
    console.log(`  ✗ ${label}`);
    console.log(`    expr: ${expr}`);
    console.log(`    type: ${isEvalError ? "EvaluationError" : e.constructor?.name ?? typeof e}`);
    // Show full message (includes source pointer)
    const lines = e.message.split("\n");
    for (const line of lines) {
      console.log(`    ${line}`);
    }
    return undefined;
  }
}

console.log("--- Missing keys ---\n");
tryEval("missing scope", "state._missing.phase.value");
tryEval("missing key in scope", "state._shared.nonexistent.value");
tryEval("missing _meta field", "state._shared.phase._meta.nonexistent_field");
tryEval("missing nested value field", 'state._shared.phase.value.nonexistent');

console.log("\n--- Type mismatches ---\n");
tryEval("string + int", 'state._shared.phase.value + 1');
tryEval("comparing number to string", 'state._shared.turn.value == "three"');
tryEval("arithmetic on string", 'state._shared.phase.value * 2');
tryEval("calling size on non-collection", 'size(state._shared.phase.value)');
tryEval("calling size on number", 'size(state._shared.turn.value)');
tryEval("boolean logic on string", 'state._shared.phase.value && true');

console.log("\n--- Common v9 mistakes ---\n");
tryEval("OLD STYLE: forgot .value (string compare)", 'state._shared.phase == "executing"');
tryEval("OLD STYLE: forgot .value (numeric)", 'state._shared.turn > 2');
tryEval("OLD STYLE: forgot .value (nested)", 'state._shared["concepts.substrate"].name');
tryEval("wrong meta path (no underscore)", 'state._shared.phase.meta.score');
tryEval("_meta on bare value", 'state._shared.phase.value._meta');

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: Environment type-checking (env.check())
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ 3. ENVIRONMENT TYPE-CHECKING ═══\n");

// Build a typed environment that knows about the wrapped shape
const env = new Environment({
  unlistedVariablesAreDyn: true,  // for now — explore strict mode later
});

// Register receiver methods
env.registerFunction({
  name: "keys",
  receiverType: "map",
  returnType: "list",
  handler: (m: any) => Object.keys(m),
  params: [],
});
env.registerFunction({
  name: "entries",
  receiverType: "map",
  returnType: "list",
  handler: (m: any) => Object.entries(m).map(([k, v]) => ({ key: k, entry: v })),
  params: [],
});

// Domain helpers
env.registerFunction("salient(map, double): list", (scope: any, threshold: number) =>
  Object.keys(scope).filter(k => scope[k]?._meta?.score > threshold)
);
env.registerFunction("elided(map): list", (scope: any) =>
  Object.keys(scope).filter(k => scope[k]?._meta?.elided === true)
);
env.registerFunction("written_by(map, string): list", (scope: any, agent: string) =>
  Object.keys(scope).filter(k => scope[k]?._meta?.writer === agent)
);

function tryCheck(label: string, expr: string) {
  try {
    const result = env.check(expr);
    if (result.valid) {
      console.log(`  ✓ valid: ${label} → type: ${result.type}`);
    } else {
      console.log(`  ✗ invalid: ${label}`);
      console.log(`    expr: ${expr}`);
      console.log(`    error: ${result.error?.message ?? "unknown"}`);
    }
    return result;
  } catch (e: any) {
    console.log(`  ✗ check threw: ${label}`);
    console.log(`    expr: ${expr}`);
    console.log(`    error: ${e.message.split("\n")[0]}`);
    return null;
  }
}

console.log("--- Basic type checks ---\n");
tryCheck("int literal", "1 + 2");
tryCheck("string literal", '"hello"');
tryCheck("bool literal", "true && false");
tryCheck("comparison", "1 > 2");

console.log("\n--- With unlistedVariablesAreDyn: true ---\n");
tryCheck("dyn variable access", "state._shared.phase.value");
tryCheck("dyn comparison", 'state._shared.phase.value == "executing"');
tryCheck("dyn _meta access", "state._shared.phase._meta.score > 0.5");
tryCheck("function call", "salient(state._shared, 0.5)");
tryCheck("chained", 'salient(state._shared, 0.5).filter(k, k.startsWith("concepts"))');

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: Strict typed environment
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ 4. STRICT TYPED ENVIRONMENT ═══\n");

const strictEnv = new Environment({
  unlistedVariablesAreDyn: false,
  homogeneousAggregateLiterals: false,
});

// Register the state shape with proper typing
// The challenge: state is deeply nested with dynamic keys
// Let's see how far we can get with registerVariable + schema

try {
  strictEnv.registerVariable("self", "string");
  strictEnv.registerVariable("params", "map");
  strictEnv.registerVariable("messages", {
    type: "map",
    description: "Message counts",
  });

  // state is a nested map — hard to type fully since keys are dynamic
  strictEnv.registerVariable("state", {
    type: "map",
    description: "Room state — wrapped entries with { value, _meta }",
  });
  strictEnv.registerVariable("views", { type: "map" });
  strictEnv.registerVariable("agents", { type: "map" });
  strictEnv.registerVariable("actions", { type: "map" });

  console.log("  ✓ Strict environment created with variables\n");
} catch (e: any) {
  console.log(`  ✗ Failed to create strict env: ${e.message}\n`);
}

function tryStrictCheck(label: string, expr: string) {
  try {
    const result = strictEnv.check(expr);
    if (result.valid) {
      console.log(`  ✓ valid: ${label} → type: ${result.type}`);
    } else {
      console.log(`  ✗ invalid: ${label}`);
      console.log(`    expr: ${expr}`);
      console.log(`    error: ${result.error?.message}`);
    }
  } catch (e: any) {
    console.log(`  ✗ check threw: ${label}`);
    console.log(`    ${e.message.split("\n")[0]}`);
  }
}

function tryStrictEval(label: string, expr: string) {
  try {
    const result = strictEnv.evaluate(expr, ctx);
    const display = typeof result === "bigint" ? `${result}n` : JSON.stringify(result);
    console.log(`  ✓ ${label} → ${display}`);
  } catch (e: any) {
    console.log(`  ✗ ${label}`);
    const lines = e.message.split("\n");
    console.log(`    ${lines[0]}`);
  }
}

console.log("--- Type checks in strict mode ---\n");
tryStrictCheck("known variable", "self");
tryStrictCheck("unknown variable", "unknown_var");
tryStrictCheck("state access (map)", "state._shared");
tryStrictCheck("deep access (dyn from map)", 'state._shared.phase.value == "executing"');
tryStrictCheck("self comparison", 'self == "explorer"');
tryStrictCheck("params access", "params.name");

console.log("\n--- Evaluation in strict mode ---\n");
tryStrictEval("value access", 'state._shared.phase.value');
tryStrictEval("meta access", 'state._shared.phase._meta.score');
tryStrictEval("comparison", 'state._shared.phase.value == "executing"');

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5: Custom validation — wrapping parse + check + eval
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ 5. CUSTOM VALIDATION PIPELINE ═══\n");

interface ValidationResult {
  valid: boolean;
  stage: "parse" | "typecheck" | "evaluate" | "ok";
  error?: string;
  hint?: string;
  type?: string;
}

function validateExpression(expr: string, context?: any): ValidationResult {
  // Stage 1: Parse
  try {
    parse(expr);
  } catch (e: any) {
    return {
      valid: false,
      stage: "parse",
      error: e.message,
      hint: "Check syntax: balanced parentheses, valid operators, proper string quotes.",
    };
  }

  // Stage 2: Type check (if using Environment)
  try {
    const checkResult = env.check(expr);
    if (!checkResult.valid) {
      return {
        valid: false,
        stage: "typecheck",
        error: checkResult.error?.message ?? "Type check failed",
        hint: "Check that variable types match operators used.",
      };
    }
  } catch (e: any) {
    // check() itself threw — treat as soft warning, not hard failure
    // (dyn types can cause this)
  }

  // Stage 3: Trial evaluation
  try {
    const result = env.evaluate(expr, context ?? ctx);
    const type = result === null ? "null"
      : typeof result === "bigint" ? "int"
      : Array.isArray(result) ? "list"
      : typeof result;
    return { valid: true, stage: "ok", type };
  } catch (e: any) {
    const msg = e.message || String(e);

    // Detect common v9 mistakes and provide specific hints
    let hint: string | undefined;

    if (msg.includes("No such key: value") || msg.includes("no such key")) {
      hint = "Key not found. If accessing a wrapped entry, use .value for the data and ._meta for metadata.";
    }

    // Detect old-style access pattern (comparing wrapped entry to primitive)
    if (!msg.includes("No such key")) {
      // Try to detect: result was an object compared to a primitive
      // This is subtle — the expression evaluates but gives wrong result
    }

    return {
      valid: false,
      stage: "evaluate",
      error: msg.split("\n")[0],
      hint: hint ?? "Expression parsed but failed at runtime. Check that referenced keys exist in the current room state.",
    };
  }
}

console.log("--- Validation pipeline ---\n");

const cases = [
  { label: "valid v9 expression", expr: 'state._shared.phase.value == "executing"' },
  { label: "valid meta access", expr: "state._shared.phase._meta.score > 0.5" },
  { label: "valid domain helper", expr: "salient(state._shared, 0.5)" },
  { label: "syntax error", expr: "state._shared.phase ==" },
  { label: "missing key", expr: "state._shared.nonexistent.value" },
  { label: "old-style (no .value)", expr: 'state._shared.phase == "executing"' },
  { label: "wrong meta path", expr: "state._shared.phase.meta.score" },
  { label: "type mismatch", expr: 'state._shared.phase.value * 2' },
  { label: "empty expression", expr: "" },
  { label: "valid filter chain", expr: 'state._shared.keys().filter(k, state._shared[k]._meta.score > 0.5)' },
];

for (const c of cases) {
  const result = validateExpression(c.expr);
  const icon = result.valid ? "✓" : "✗";
  console.log(`  ${icon} ${c.label}`);
  console.log(`    expr: ${c.expr}`);
  if (result.valid) {
    console.log(`    → type: ${result.type}`);
  } else {
    console.log(`    stage: ${result.stage}`);
    console.log(`    error: ${result.error?.split("\n")[0]}`);
    if (result.hint) console.log(`    hint: ${result.hint}`);
  }
  console.log();
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6: Detecting old-style expressions
// ═══════════════════════════════════════════════════════════════════════

console.log("═══ 6. OLD-STYLE EXPRESSION DETECTION ═══\n");

/**
 * Detect common patterns where someone wrote a v8-style expression
 * that would silently produce wrong results under v9 wrapped shape.
 *
 * These DON'T throw — they evaluate to a wrong value. So we need
 * static analysis of the expression to catch them.
 */
function detectOldStyle(expr: string): string[] {
  const warnings: string[] = [];

  // Pattern: state.scope.key == "literal" (without .value)
  // This compares { value, _meta } to "literal" → always false
  const bareCompare = /state\.\w+\.\w+\s*(==|!=|>=|<=|>|<)\s*(".*?"|'.*?'|\d+|true|false)/g;
  let m;
  while ((m = bareCompare.exec(expr))) {
    const path = m[0].split(/\s*(==|!=|>=|<=|>|<)\s*/)[0].trim();
    // Check it's not already accessing .value or ._meta
    if (!path.endsWith(".value") && !path.includes("._meta")) {
      // Count dots to see if it's scope.key level (not scope.key.value.field)
      const parts = path.split(".");
      if (parts.length === 3) { // state.scope.key
        warnings.push(
          `"${path}" compares a wrapped entry (not its value). Did you mean "${path}.value ${m[1]} ${m[2]}"?`
        );
      }
    }
  }

  // Pattern: state.scope.key.field (accessing nested field without .value)
  // e.g., state._shared["concepts.substrate"].name instead of .value.name
  const directNested = /state\.\w+(?:\["[^"]+"\]|\.\w+)\.([a-z]\w+)/g;
  while ((m = directNested.exec(expr))) {
    const field = m[1];
    if (field !== "value" && field !== "_meta" && !field.startsWith("_")) {
      // This might be accessing a field directly on the wrapped entry
      // (which would fail or return undefined, not the intended value field)
      warnings.push(
        `".${field}" accesses the wrapped entry directly. If this is a value field, use ".value.${field}" instead.`
      );
    }
  }

  return warnings;
}

const oldStyleCases = [
  'state._shared.phase == "executing"',
  'state._shared.turn > 2',
  'state._shared.phase.value == "executing"',  // correct — should NOT warn
  'state._shared["concepts.substrate"].name == "substrate"',
  'state._shared["concepts.substrate"].value.name == "substrate"',  // correct
  'state._shared.phase._meta.score > 0.5',  // correct — should NOT warn
];

for (const expr of oldStyleCases) {
  const warnings = detectOldStyle(expr);
  if (warnings.length === 0) {
    console.log(`  ✓ ${expr}`);
  } else {
    console.log(`  ⚠ ${expr}`);
    for (const w of warnings) {
      console.log(`    → ${w}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7: Environment.getDefinitions() — can we expose to agents?
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ 7. ENVIRONMENT DEFINITIONS (for agent docs) ═══\n");

try {
  const defs = env.getDefinitions();
  console.log("  Registered definitions:");
  if (defs.functions) {
    for (const f of defs.functions) {
      const sig = f.signature ?? `${f.name}(${(f.params ?? []).map((p: any) => p.type ?? 'dyn').join(', ')}): ${f.returnType ?? 'dyn'}`;
      console.log(`    fn ${sig}${f.description ? ` — ${f.description}` : ''}`);
    }
  }
  if (defs.variables) {
    for (const v of defs.variables) {
      console.log(`    var ${v.name}: ${v.type}${v.description ? ` — ${v.description}` : ''}`);
    }
  }
} catch (e: any) {
  console.log(`  getDefinitions() error: ${e.message}`);
  // Try alternative approaches
  try {
    const defs = (env as any).getDefinitions?.() ?? "method not found";
    console.log(`  raw: ${JSON.stringify(defs).slice(0, 500)}`);
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 8: Parse + AST inspection
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ 8. AST INSPECTION ═══\n");

function inspectAst(label: string, expr: string) {
  try {
    const compiled = parse(expr);
    console.log(`  ${label}:`);
    console.log(`    expr: ${expr}`);
    if (compiled.ast) {
      console.log(`    ast: ${JSON.stringify(compiled.ast).slice(0, 200)}`);
    }
    // What properties does the compiled function have?
    const props = Object.keys(compiled).filter(k => k !== "ast");
    if (props.length > 0) {
      console.log(`    props: ${props.join(", ")}`);
    }
    // Does it have a check method?
    if (typeof compiled.check === "function") {
      const checkResult = compiled.check();
      console.log(`    check(): ${JSON.stringify(checkResult)}`);
    }
  } catch (e: any) {
    console.log(`  ✗ ${label}: ${e.message.split("\n")[0]}`);
  }
}

inspectAst("simple comparison", 'state._shared.phase.value == "executing"');
inspectAst("meta access", 'state._shared.phase._meta.score');
inspectAst("function call", 'size(state._shared)');
inspectAst("filter macro", 'state._shared.filter(k, k.startsWith("concepts"))');

// ═══════════════════════════════════════════════════════════════════════
// SECTION 9: Environment with enableOptionalTypes
// ═══════════════════════════════════════════════════════════════════════

console.log("\n═══ 9. OPTIONAL CHAINING ═══\n");

const optEnv = new Environment({
  unlistedVariablesAreDyn: true,
  enableOptionalTypes: true,
});

// Register helpers
optEnv.registerFunction({
  name: "keys",
  receiverType: "map",
  returnType: "list",
  handler: (m: any) => Object.keys(m),
  params: [],
});

function tryOpt(label: string, expr: string) {
  try {
    const result = optEnv.evaluate(expr, ctx);
    const display = typeof result === "bigint" ? `${result}n` : JSON.stringify(result);
    console.log(`  ✓ ${label} → ${display}`);
  } catch (e: any) {
    console.log(`  ✗ ${label}`);
    console.log(`    ${e.message.split("\n")[0]}`);
  }
}

// Optional chaining: .?key returns optional(value) or optional.none()
tryOpt("optional access on existing key", 'state._shared.?phase');
tryOpt("optional access on missing key", 'state._shared.?nonexistent');
tryOpt("optional deep access", 'state._shared.?phase.?value');
tryOpt("optional _meta", 'state._shared.?phase.?_meta.?score');
tryOpt("optional with comparison", 'state._shared.?phase.?value == "executing"');
tryOpt("optional on missing with default", 'state._shared.?nonexistent.orValue("default")');
tryOpt("has + optional combo", 'has(state._shared.nonexistent) ? state._shared.nonexistent.value : "missing"');

console.log("\nDone.");
