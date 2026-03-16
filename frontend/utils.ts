import type { Agent } from "./types.ts";

export function esc(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function rel(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts.replace(" ", "T") + (ts.includes("Z") || ts.includes("+") ? "" : "Z"));
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 5) return "now";
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

export function hbc(ts: string | null | undefined): "stale" | "dead" | "" {
  if (!ts) return "dead";
  const d = new Date(ts.replace(" ", "T") + (ts.includes("Z") || ts.includes("+") ? "" : "Z"));
  const m = (Date.now() - d.getTime()) / 60000;
  if (m < 2) return "";
  if (m < 10) return "stale";
  return "dead";
}

export function aname(id: string | null | undefined, agentMap: Record<string, Agent>): string {
  if (!id) return "system";
  const a = agentMap[id];
  return a ? a.name : id.length > 12 ? id.slice(0, 8) + "…" : id;
}

export function tryParseJson(s: any): any {
  if (typeof s !== "string") return s;
  try { return JSON.parse(s); } catch { return s; }
}


/** Relative time from a fixed epoch (e.g. replay start). Returns "+0s", "+14s", "+2m", etc. */
export function relTo(ts: string | null | undefined, epochMs: number): string {
  if (!ts) return "";
  const d = new Date(ts.replace(" ", "T") + (ts.includes("Z") || ts.includes("+") ? "" : "Z"));
  const ms = d.getTime() - epochMs;
  if (ms < 0) return "+0s";
  const s = Math.floor(ms / 1000);
  if (s < 5) return "+0s";
  if (s < 60) return `+${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `+${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `+${h}h`;
  return `+${Math.floor(h / 24)}d`;
}

/** Heartbeat class relative to a replay playhead rather than Date.now(). */
export function hbcAt(ts: string | null | undefined, playheadMs: number): "stale" | "dead" | "" {
  if (!ts) return "dead";
  const d = new Date(ts.replace(" ", "T") + (ts.includes("Z") || ts.includes("+") ? "" : "Z"));
  const m = (playheadMs - d.getTime()) / 60000;
  if (m < 2) return "";
  if (m < 10) return "stale";
  return "dead";
}
