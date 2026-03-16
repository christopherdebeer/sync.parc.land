/**
 * scripts/probe-ast.ts — CEL AST shape discovery tool.
 *
 * Verified AST format (March 2026):
 *   { op: "id", args: "state" }          — identifier (args is STRING)
 *   { op: ".", args: [parent, "field"] }  — member access
 *   { op: "[]", args: [obj, index] }      — bracket access
 *   { op: "value", args: "literal" }      — literal value
 *   Pipe expressions (|) FAIL to parse — handled by regex fallback in deps.ts
 *
 * Keep as reference. Can be removed before merge.
 */

import { parse } from "npm:@marcbachmann/cel-js";
import { extractDependencies } from "../deps.ts";

const EXPRESSIONS = [
  // Direct key access — should yield AST deps
  `state._shared.phase`,
  `state._shared.theses.game_designer`,

  // Pipe expressions — should fall back to regex
  `state._shared | keys() | filter(k, k.startsWith("concepts.")) | size()`,

  // View reference via bracket — should yield AST deps
  `views["concept_count"] > 10`,

  // Comparison — should yield AST deps
  `state._shared.phase == "active"`,

  // Pipe with agents — regex fallback
  `agents | values() | filter(a, a.status == "active") | size()`,

  // Mixed: direct + pipe — AST for first part, regex catches pipe
  `state._shared.thesis_log | size() > 0 && state._shared.phase != "setup"`,

  // Bracket access — AST deps
  `state._shared["concepts.attention_restoration"]`,

  // Messages — AST deps
  `messages.count > 0`,

  // Ternary — AST deps
  `state._shared.score > 100 ? "high" : "low"`,

  // Pipe with prefix — regex catches both scope and prefix
  `state._shared | keys() | filter(k, k.startsWith("tensions.")) | size()`,
];

export default async function handler(req: Request): Promise<Response> {
  const results: any[] = [];

  for (const expr of EXPRESSIONS) {
    const entry: any = { expr };
    try {
      const compiled = parse(expr);
      entry.parseable = true;
      entry.astTopOp = compiled.ast?.op;
    } catch (e: any) {
      entry.parseable = false;
      entry.parseError = e.message?.split("\n")[0];
    }
    // Always extract deps (should work for both parseable and unparseable)
    entry.deps = extractDependencies(expr);
    results.push(entry);
  }

  return new Response(JSON.stringify(results, (_, v) => typeof v === "bigint" ? Number(v) : v, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
