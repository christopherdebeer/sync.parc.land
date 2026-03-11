/**
 * Pure value-shape → surface type inference.
 * No side effects, no imports from React or the DOM.
 *
 * Used by the dashboard to decide how to auto-surface a view that has
 * no explicit render.type, and to drive ArrayTableSurface's column logic.
 */

import type { RenderHintColumn } from "./types.ts";

// ── Result types ──────────────────────────────────────────────────────────────

export type SurfaceHint =
  | { type: "metric" }
  | { type: "markdown" }
  | { type: "array-table"; homogeneous: boolean; columns: string[] }
  | { type: "object-table"; keys: string[] }
  | { type: "json" }
  | { type: "error"; message: string };

// ── Column inference ──────────────────────────────────────────────────────────

const SAMPLE_SIZE = 5;

/** Returns the sorted key list from an object, or null if not an object. */
function objectKeys(item: any): string[] | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
  return Object.keys(item);
}

/**
 * Inspect a homogeneity sample from an array.
 * Returns:
 *   { homogeneous: true, columns: [...] }  — all sampled items share the same keys
 *   { homogeneous: false, columns: [] }    — heterogeneous; fallback to json
 *
 * Arrays of scalars are treated as homogeneous with a single synthetic column "value".
 */
export function inferArrayColumns(arr: any[]): { homogeneous: boolean; columns: string[] } {
  if (arr.length === 0) return { homogeneous: true, columns: [] };

  const sample = arr.slice(0, SAMPLE_SIZE);

  // All scalars?
  const allScalar = sample.every(
    item => item === null || typeof item !== "object"
  );
  if (allScalar) return { homogeneous: true, columns: ["value"] };

  // All objects?
  const keySets = sample.map(objectKeys);
  if (keySets.some(k => k === null)) {
    // Mixed scalars and objects — heterogeneous
    return { homogeneous: false, columns: [] };
  }

  // Compare key sets — allow at most 1 key difference across the sample
  const allKeys = keySets as string[][];
  const baseKeys = allKeys[0];
  const baseSorted = [...baseKeys].sort().join(",");

  for (const keys of allKeys.slice(1)) {
    const sorted = [...keys].sort().join(",");
    if (sorted !== baseSorted) {
      // Count differences
      const baseSet = new Set(baseKeys);
      const otherSet = new Set(keys);
      const added = keys.filter(k => !baseSet.has(k));
      const removed = baseKeys.filter(k => !otherSet.has(k));
      if (added.length + removed.length > 1) {
        return { homogeneous: false, columns: [] };
      }
    }
  }

  // Union of all keys in sample order (first item's order wins for stable display)
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const keys of allKeys) {
    for (const k of keys) {
      if (!seen.has(k)) { seen.add(k); columns.push(k); }
    }
  }

  return { homogeneous: true, columns };
}

// ── Top-level inference ───────────────────────────────────────────────────────

const MARKDOWN_PATTERN = /^#{1,3} |^\*\*|^- |\n#{1,3} |\n\*\*|\n- |`{1,3}/;

export function inferSurfaceType(value: any): SurfaceHint {
  // Error sentinel
  if (value && typeof value === "object" && "_error" in value) {
    return { type: "error", message: String(value._error) };
  }

  // Null / undefined → metric (shows "—")
  if (value === null || value === undefined) return { type: "metric" };

  // Scalars
  if (typeof value === "number" || typeof value === "boolean") return { type: "metric" };

  if (typeof value === "string") {
    // Long string or contains markdown → markdown
    if (value.length > 120 || value.includes("\n") || MARKDOWN_PATTERN.test(value)) {
      return { type: "markdown" };
    }
    return { type: "metric" };
  }

  // Array
  if (Array.isArray(value)) {
    const { homogeneous, columns } = inferArrayColumns(value);
    return { type: "array-table", homogeneous, columns };
  }

  // Object
  if (typeof value === "object") {
    const keys = Object.keys(value);
    // Object with all scalar leaf values → property panel (object-table)
    const allScalarLeaves = keys.every(k => {
      const v = value[k];
      return v === null || typeof v !== "object";
    });
    if (allScalarLeaves && keys.length > 0) {
      return { type: "object-table", keys };
    }
    return { type: "json" };
  }

  return { type: "json" };
}

// ── Column resolution (merge inferred + explicit render.columns) ──────────────

export interface ResolvedColumn {
  key: string;
  label: string;
  width?: string;
  truncate: number;
}

export function resolveColumns(
  inferredColumns: string[],
  renderColumns?: RenderHintColumn[] | null,
): ResolvedColumn[] {
  if (renderColumns && renderColumns.length > 0) {
    return renderColumns.map(c => ({
      key: c.key,
      label: c.label ?? c.key,
      width: c.width,
      truncate: c.truncate ?? 80,
    }));
  }
  return inferredColumns.map(k => ({
    key: k,
    label: k,
    truncate: 80,
  }));
}
