/**
 * deps.ts — CEL dependency extraction.
 *
 * Verified against @marcbachmann/cel-js AST output (March 2026).
 *
 * AST format:
 *   { op: "id", args: "state" }               — identifier (args is a STRING)
 *   { op: ".", args: [parent, "field"] }       — member access
 *   { op: "[]", args: [obj, index] }           — bracket access
 *   { op: "value", args: "literal" }           — literal value
 *   { op: "==", args: [left, right] }          — comparison
 *   { op: "?:", args: [cond, then, else] }     — ternary
 *   { op: "&&", args: [left, right] }          — logical and
 *
 * CRITICAL: Pipe expressions (state._shared | keys() | filter(...))
 * are NOT parseable by parse() — they fail with "Unexpected character: |".
 * evaluate() handles them at runtime but the AST is unavailable.
 * For pipe expressions, we fall back to regex extraction.
 *
 * Strategy:
 *   1. Try AST walking (covers direct access, bracket access, comparisons)
 *   2. Fall back to regex for pipe expressions and parse failures
 *   3. Complement with Proxy tracing at runtime (optional validation)
 */

import { parse } from "npm:@marcbachmann/cel-js";

// ── Types ──────────────────────────────────────────────────────────────

export interface Dependency {
  root: "state" | "views" | "agents" | "actions" | "messages";
  scope?: string;
  key?: string;
  prefix?: string;
  access: "direct" | "scope" | "prefix" | "full";
  certainty: "static" | "regex" | "runtime";
}

export type DependencySet = Dependency[];

// ── Context roots ──────────────────────────────────────────────────────

const CONTEXT_ROOTS = new Set(["state", "views", "agents", "actions", "messages"]);

// ── AST Walking (verified format) ──────────────────────────────────────

/**
 * Resolve a member access chain from an AST node.
 * Returns ["state", "_shared", "phase"] for state._shared.phase
 */
function resolveChain(node: any): string[] | null {
  if (!node || typeof node !== "object") return null;

  // Identifier: { op: "id", args: "state" }
  if (node.op === "id" && typeof node.args === "string") {
    return [node.args];
  }

  // Member access: { op: ".", args: [parent, "field"] }
  if (node.op === "." && Array.isArray(node.args) && node.args.length === 2) {
    const parent = resolveChain(node.args[0]);
    const field = node.args[1];
    if (parent && typeof field === "string") {
      return [...parent, field];
    }
    return null;
  }

  // Bracket access: { op: "[]", args: [obj, { op: "value", args: "key" }] }
  if (node.op === "[]" && Array.isArray(node.args) && node.args.length === 2) {
    const parent = resolveChain(node.args[0]);
    const index = node.args[1];
    if (parent && index?.op === "value" && typeof index.args === "string") {
      return [...parent, index.args];
    }
    return null;
  }

  return null;
}

/**
 * Walk an AST and extract dependencies.
 * Only records the MOST SPECIFIC dep per chain (direct > scope > full).
 */
function walkAst(node: any, deps: Dependency[], seen: Set<string>) {
  if (!node || typeof node !== "object") return;

  function addDep(dep: Dependency) {
    const k = JSON.stringify(dep);
    if (seen.has(k)) return;
    seen.add(k);
    deps.push(dep);
  }

  // Find the deepest resolvable chain at this node.
  // We want state._shared.phase to produce ONE dep (direct), not three.
  function deepestChain(n: any): string[] | null {
    // Try to extend: if this is a "." with a child that's also a ".",
    // the parent will be covered by the child's walk. So only resolve
    // at leaf positions (nodes not used as operands in a deeper ".").
    const chain = resolveChain(n);
    return chain;
  }

  // Check if this node is a leaf in a member chain (not the operand of a parent ".")
  // We handle this by only recording deps for the TOP-LEVEL chain at each point.
  const chain = deepestChain(node);
  if (chain && chain.length > 0 && CONTEXT_ROOTS.has(chain[0])) {
    const root = chain[0] as Dependency["root"];
    if (root === "state") {
      if (chain.length >= 3) {
        addDep({ root: "state", scope: chain[1], key: chain[2], access: "direct", certainty: "static" });
      } else if (chain.length === 2) {
        addDep({ root: "state", scope: chain[1], access: "scope", certainty: "static" });
      } else {
        addDep({ root: "state", access: "full", certainty: "static" });
      }
    } else {
      if (chain.length >= 2) {
        addDep({ root, key: chain[1], access: "direct", certainty: "static" });
      } else {
        addDep({ root, access: "scope", certainty: "static" });
      }
    }
    // For member chains, DON'T recurse into children — the chain
    // already captured the full access path. Recurse into non-chain
    // siblings (e.g. the right side of a comparison).
    if (node.op === "." || node.op === "[]") return;
  }

  // Not a resolvable chain — recurse into args
  if (Array.isArray(node.args)) {
    for (const arg of node.args) {
      if (arg && typeof arg === "object") walkAst(arg, deps, seen);
    }
  }
}

// ── Regex Fallback (for pipe expressions) ──────────────────────────────

/**
 * Extract dependencies from a CEL expression string using regex.
 * Used when AST parsing fails (pipe expressions) or as a supplement.
 */
function extractRegex(expr: string): Dependency[] {
  const deps: Dependency[] = [];
  const seen = new Set<string>();

  function addDep(dep: Dependency) {
    const k = JSON.stringify(dep);
    if (seen.has(k)) return;
    seen.add(k);
    deps.push(dep);
  }

  // Direct key access: state._shared.phase or state._shared.theses.x
  const directPattern = /state\.([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let m;
  while ((m = directPattern.exec(expr))) {
    addDep({ root: "state", scope: m[1], key: m[2], access: "direct", certainty: "regex" });
  }

  // Scope-level access: state._shared (without further key, e.g. in pipe chains)
  const scopePattern = /state\.([a-zA-Z_][a-zA-Z0-9_]*)\s*[|)]/g;
  while ((m = scopePattern.exec(expr))) {
    addDep({ root: "state", scope: m[1], access: "scope", certainty: "regex" });
  }

  // Bracket access: state._shared["key.with.dots"]
  const bracketPattern = /state\.([a-zA-Z_][a-zA-Z0-9_]*)\["([^"]+)"\]/g;
  while ((m = bracketPattern.exec(expr))) {
    addDep({ root: "state", scope: m[1], key: m[2], access: "direct", certainty: "regex" });
  }

  // startsWith patterns: k.startsWith("concepts.")
  const prefixPattern = /startsWith\(["']([^"']+)["']\)/g;
  while ((m = prefixPattern.exec(expr))) {
    addDep({ root: "state", prefix: m[1], access: "prefix", certainty: "regex" });
  }

  // View references: views["concept_count"] or views.concept_count
  const viewPattern1 = /views\["([^"]+)"\]/g;
  while ((m = viewPattern1.exec(expr))) {
    addDep({ root: "views", key: m[1], access: "direct", certainty: "regex" });
  }
  const viewPattern2 = /views\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
  while ((m = viewPattern2.exec(expr))) {
    addDep({ root: "views", key: m[1], access: "direct", certainty: "regex" });
  }

  // Agent/action references
  const agentPattern = /agents\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
  while ((m = agentPattern.exec(expr))) {
    addDep({ root: "agents", key: m[1], access: "direct", certainty: "regex" });
  }

  // Messages reference
  if (/messages\b/.test(expr)) {
    addDep({ root: "messages", access: "scope", certainty: "regex" });
  }

  // Bare "agents" or "actions" in pipe chains
  if (/\bagents\s*[|.]/.test(expr) || /\bagents\s*\|/.test(expr)) {
    addDep({ root: "agents", access: "full", certainty: "regex" });
  }
  if (/\bactions\s*[|.]/.test(expr) || /\bactions\s*\|/.test(expr)) {
    addDep({ root: "actions", access: "full", certainty: "regex" });
  }

  return deps;
}

// ── Main extraction ────────────────────────────────────────────────────

/**
 * Extract dependencies from a CEL expression.
 *
 * Tries AST walking first (accurate, handles member access chains).
 * Falls back to regex for pipe expressions (which fail to parse).
 * Returns a deduplicated array.
 */
export function extractDependencies(expr: string): DependencySet {
  const deps: Dependency[] = [];
  const seen = new Set<string>();

  // Try AST walking
  let astWorked = false;
  try {
    const compiled = parse(expr);
    if (compiled?.ast) {
      walkAst(compiled.ast, deps, seen);
      astWorked = true;
    }
  } catch {
    // Parse failed (likely pipe expression) — fall through to regex
  }

  // Always run regex to catch pipe expressions and supplement AST
  const regexDeps = extractRegex(expr);
  for (const dep of regexDeps) {
    const k = JSON.stringify({ ...dep, certainty: undefined });
    // Only add regex deps that aren't already covered by AST deps
    const hasStatic = deps.some(d => {
      const dk = JSON.stringify({ ...d, certainty: undefined });
      return dk === k;
    });
    if (!hasStatic) {
      const fullK = JSON.stringify(dep);
      if (!seen.has(fullK)) {
        seen.add(fullK);
        deps.push(dep);
      }
    }
  }

  return deps;
}

// ── Proxy Tracing ──────────────────────────────────────────────────────

/**
 * Wrap a CEL context in Proxies that record property access.
 * Use to validate/supplement extracted dependencies at runtime.
 */
export function traceContext(ctx: Record<string, any>): {
  traced: Record<string, any>;
  getAccesses: () => DependencySet;
} {
  const accesses: Array<{ path: string[] }> = [];

  function proxyWrap(obj: any, path: string[]): any {
    if (obj === null || typeof obj !== "object") return obj;
    if (typeof obj === "function") return obj;

    return new Proxy(obj, {
      get(target, prop, receiver) {
        if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
        const key = String(prop);
        if (key === "toJSON" || key === "constructor" || key === "prototype" ||
            key === "then" || key === "length" || key === "toString" || key === "valueOf") {
          return Reflect.get(target, prop, receiver);
        }
        accesses.push({ path: [...path, key] });
        const val = Reflect.get(target, prop, receiver);
        return proxyWrap(val, [...path, key]);
      },
    });
  }

  function getAccesses(): DependencySet {
    const deps: Dependency[] = [];
    const seen = new Set<string>();
    for (const { path } of accesses) {
      if (path.length === 0 || !CONTEXT_ROOTS.has(path[0])) continue;
      const root = path[0] as Dependency["root"];
      let dep: Dependency;
      if (root === "state") {
        if (path.length >= 3) dep = { root: "state", scope: path[1], key: path[2], access: "direct", certainty: "runtime" };
        else if (path.length === 2) dep = { root: "state", scope: path[1], access: "scope", certainty: "runtime" };
        else dep = { root: "state", access: "full", certainty: "runtime" };
      } else {
        dep = { root, key: path.length >= 2 ? path[1] : undefined, access: path.length >= 2 ? "direct" : "scope", certainty: "runtime" };
      }
      const k = JSON.stringify(dep);
      if (!seen.has(k)) { seen.add(k); deps.push(dep); }
    }
    return deps;
  }

  return { traced: proxyWrap(ctx, []), getAccesses };
}

// ── Utilities ──────────────────────────────────────────────────────────

export function mergeDependencies(staticDeps: DependencySet, runtimeDeps: DependencySet): DependencySet {
  const seen = new Set<string>();
  const merged: Dependency[] = [];
  for (const dep of staticDeps) {
    const k = JSON.stringify({ ...dep, certainty: undefined });
    if (!seen.has(k)) { seen.add(k); merged.push(dep); }
  }
  for (const dep of runtimeDeps) {
    const k = JSON.stringify({ ...dep, certainty: undefined });
    if (!seen.has(k)) { seen.add(k); merged.push(dep); }
  }
  return merged;
}

export function isRelevant(deps: DependencySet, scope: string, key: string): boolean {
  for (const dep of deps) {
    if (dep.root !== "state") continue;
    if (dep.access === "full") return true;
    if (dep.access === "scope" && dep.scope === scope) return true;
    if (dep.access === "direct" && dep.scope === scope && dep.key === key) return true;
    if (dep.access === "prefix" && dep.prefix && key.startsWith(dep.prefix)) {
      if (!dep.scope || dep.scope === scope) return true;
    }
  }
  return false;
}

// ── Probe (development) ────────────────────────────────────────────────

export function probeAst(expr: string): any {
  try {
    const compiled = parse(expr);
    return compiled.ast;
  } catch (e: any) {
    return { error: e.message };
  }
}
