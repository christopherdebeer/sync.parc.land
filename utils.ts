/**
 * utils.ts — shared HTTP and data utilities for sync.
 *
 * Pure functions with no internal dependencies. Used by main.ts, invoke.ts,
 * context.ts, and any other module that needs JSON responses, SQLite row
 * formatting, template substitution, or content hashing.
 */

/** JSON response with CORS headers. */
export function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
  });
}

/** Convert SQLite result rows to objects using column names. */
export function rows2objects(result: any) {
  return result.rows.map((row: any[]) =>
    Object.fromEntries(result.columns.map((col: string, i: number) => [col, row[i]]))
  );
}

/** Sentinel for failed JSON parsing. */
export const PARSE_FAILED = Symbol("parse_failed");

/** Parse request body as JSON. Returns {} for empty bodies, PARSE_FAILED for invalid JSON. */
export async function parseBody(req: Request) {
  const text = await req.text();
  if (!text || text.trim() === "") return {};
  try { return JSON.parse(text); } catch { return PARSE_FAILED; }
}

/** Promise-based delay. */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Compute a 16-hex-char SHA-256 content hash of a string value.
 *  This is the v6 `version` field — unforgeable proof-of-read for if_version writes.
 *  Agents cannot supply a correct hash without having fetched the current value. */
export async function contentHash(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Deep substitute ${params.x}, ${self}, and ${now} in any value.
 *  Single-pass: param values containing ${self} or ${now} are NOT re-expanded.
 *  Timestamp is computed once per call and shared across the entire tree. */
export function deepSubstitute(value: any, params: Record<string, any>, self: string, _ts?: string): any {
  if (typeof value === "string") {
    if (!value.includes("${")) return value;
    const ts = _ts ?? new Date().toISOString();
    return value.replace(/\$\{(params\.(\w+)|self|now)\}/g, (match: string, full: string, paramName: string) => {
      if (paramName !== undefined) return String(params[paramName] ?? "");
      if (full === "self") return self;
      if (full === "now") return ts;
      return match;
    });
  }
  if (Array.isArray(value)) {
    const ts = _ts ?? new Date().toISOString();
    return value.map(v => deepSubstitute(v, params, self, ts));
  }
  if (value !== null && typeof value === "object") {
    const ts = _ts ?? new Date().toISOString();
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      const rk = k.includes("${") ? deepSubstitute(k, params, self, ts) as string : k;
      out[rk] = deepSubstitute(v, params, self, ts);
    }
    return out;
  }
  return value;
}

/** Deep-merge source into target. Objects merge recursively; arrays and
 *  primitives in source overwrite target. null in source explicitly deletes
 *  the key (set to null). */
export function deepMerge(target: any, source: any): any {
  if (source === null || source === undefined) return source;
  if (typeof target !== "object" || typeof source !== "object"
      || Array.isArray(target) || Array.isArray(source)
      || target === null) {
    return source;
  }
  const out: Record<string, any> = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v === null) { out[k] = null; continue; }
    out[k] = (k in out && typeof out[k] === "object" && !Array.isArray(out[k]) && out[k] !== null)
      ? deepMerge(out[k], v)
      : v;
  }
  return out;
}

/** Recursively strip null/undefined values from an object (for ?compact=true). */
export function stripNulls(data: any): any {
  if (data === null || data === undefined) return undefined;
  if (Array.isArray(data)) return data.map(stripNulls);
  if (typeof data === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && v !== undefined) out[k] = stripNulls(v);
    }
    return out;
  }
  return data;
}
