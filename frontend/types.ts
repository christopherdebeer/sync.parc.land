// ── v8 types: state is the single source ────────────────────────────────────

/** A single entry in the state table. Every entity lives here. */
export interface StateEntry {
  scope: string;
  key: string;
  sort_key: number | null;
  value: any;
  revision: number;
  updated_at: string;
}

/** Action definition (value of _actions.{id} state entry) */
export interface ActionDef {
  description?: string;
  if?: string;
  enabled?: string;
  result?: string;
  writes: any[];
  params?: Record<string, { type?: string; description?: string; enum?: any[] }>;
  scope: string;
  registered_by?: string;
  timer?: any;
  on_invoke?: any;
}

/** View definition (value of _views.{id} state entry) */
export interface ViewDef {
  expr: string;
  description?: string;
  enabled?: string;
  render?: RenderHint | null;
  scope: string;
  registered_by?: string;
  timer?: any;
  deps?: any[];
}

/** Agent presence (value of _agents.{id} state entry) */
export interface AgentDef {
  name: string;
  role: string;
  status: string;
  grants: string[];
  last_heartbeat?: string;
  joined_at?: string;
}

/** Salience entry in poll response */
export interface SalienceEntry {
  key: string;
  score: number;
  signals: string[];
}

/** Audit entry */
export interface AuditEntry {
  seq: number;
  value: any;
  updated_at: string;
}

/** The v8 poll response. State is the single data source. */
export interface PollDataV8 {
  state: StateEntry[];
  resolved: Record<string, any>;
  available: Record<string, boolean>;
  audit: AuditEntry[];
  salience?: SalienceEntry[];
}

/** Helper: extract entries for a specific scope */
export function scopeEntries(poll: PollDataV8, scope: string): StateEntry[] {
  return poll.state.filter(s => s.scope === scope);
}

/** Helper: get all unique scopes in the state */
export function allScopes(poll: PollDataV8): string[] {
  const s = new Set(poll.state.map(e => e.scope));
  return [...s].sort();
}

/** Helper: extract action defs with availability */
export function actionsFromState(poll: PollDataV8): Array<{ id: string; def: ActionDef; available: boolean }> {
  return scopeEntries(poll, "_actions").map(e => ({
    id: e.key,
    def: e.value as ActionDef,
    available: poll.available[e.key] ?? true,
  }));
}

/** Helper: extract view defs with resolved values */
export function viewsFromState(poll: PollDataV8): Array<{ id: string; def: ViewDef; value: any }> {
  return scopeEntries(poll, "_views").map(e => ({
    id: e.key,
    def: e.value as ViewDef,
    value: poll.resolved[e.key],
  }));
}

/** Helper: extract agents */
export function agentsFromState(poll: PollDataV8): Array<{ id: string; def: AgentDef }> {
  return scopeEntries(poll, "_agents").map(e => ({
    id: e.key,
    def: e.value as AgentDef,
  }));
}

/** Helper: extract messages (sorted by sort_key) */
export function messagesFromState(poll: PollDataV8): StateEntry[] {
  return scopeEntries(poll, "_messages").sort((a, b) => (a.sort_key ?? 0) - (b.sort_key ?? 0));
}

/** Helper: extract shared state */
export function sharedState(poll: PollDataV8): StateEntry[] {
  return scopeEntries(poll, "_shared");
}

// ── Legacy types (used by panel components + replay normalizers) ────────────

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: string;
  last_heartbeat: string;
  waiting_on?: string;
  grants: string;
  joined_at: string;
}

export interface StateRow {
  room_id: string;
  scope: string;
  key: string;
  value: any;
  version: number;
  sort_key?: number;
  updated_at: string;
  timer_effect?: string;
  timer_expires_at?: string;
  timer_ticks_left?: number;
  enabled_expr?: string;
}

export interface RawMessage {
  sort_key: number;
  value: any;
  updated_at: string;
}

export interface Action {
  id: string;
  room_id: string;
  scope: string;
  description?: string;
  if?: string;
  available: boolean;
  params?: Record<string, { type?: string; description?: string; enum?: any[] }>;
  writes?: any[];
  version: number;
  registered_by?: string;
}

export interface RenderHintColumn {
  key: string;
  label?: string;
  width?: string;
  truncate?: number;
}

export interface RenderHint {
  type: "metric" | "markdown" | "array-table" | "view-table" | "json";
  label?: string;
  order?: number;
  group?: string;
  // metric-specific
  unit?: string;
  color?: "default" | "green" | "red" | "yellow";
  // array-table-specific
  columns?: RenderHintColumn[];
  max_rows?: number;
  layout?: "table" | "event-log";
}

export interface View {
  id: string;
  room_id: string;
  scope: string;
  description?: string;
  expr: string;
  value: any;
  version: number;
  registered_by?: string;
  render?: RenderHint | null;
}

export interface AuditRow {
  sort_key: number;
  value: any;
  updated_at: string;
}

export type TokenKind = "room" | "view" | "agent";

// ── Surface types ───────────────────────────────────────────────────────────

export interface SurfaceMetric {
  id: string;
  type: "metric";
  view: string;
  label?: string;
  enabled?: string;
}

export interface SurfaceViewGrid {
  id: string;
  type: "view-grid";
  views: string[];
  label?: string;
  enabled?: string;
}

export interface SurfaceViewTable {
  id: string;
  type: "view-table";
  views: string[];
  label?: string;
  enabled?: string;
}

export interface SurfaceActionBar {
  id: string;
  type: "action-bar";
  actions: string[];
  label?: string;
  enabled?: string;
}

export interface SurfaceActionForm {
  id: string;
  type: "action-form";
  action: string;
  label?: string;
  enabled?: string;
}

export interface SurfaceActionChoice {
  id: string;
  type: "action-choice";
  actions: string[];
  label?: string;
  enabled?: string;
}

export interface SurfaceFeed {
  id: string;
  type: "feed";
  kinds?: string[];
  compose?: boolean;
  label?: string;
  enabled?: string;
}

export interface SurfaceWatch {
  id: string;
  type: "watch";
  keys: { scope: string; key: string }[];
  label?: string;
  enabled?: string;
}

export interface SurfaceSection {
  id: string;
  type: "section";
  label?: string;
  enabled?: string;
  surfaces: Surface[];
}

export interface SurfaceMarkdown {
  id: string;
  type: "markdown";
  view: string;
  label?: string;
  enabled?: string;
}

export interface SurfaceArrayTable {
  id: string;
  type: "array-table";
  view: string;
  label?: string;
  enabled?: string;
  columns?: RenderHintColumn[];
  max_rows?: number;
}

export type Surface =
  | SurfaceMetric
  | SurfaceViewGrid
  | SurfaceViewTable
  | SurfaceArrayTable
  | SurfaceActionBar
  | SurfaceActionForm
  | SurfaceActionChoice
  | SurfaceFeed
  | SurfaceWatch
  | SurfaceSection
  | SurfaceMarkdown;

// ── Dashboard config ────────────────────────────────────────────────────────

export interface DashboardConfig {
  title?: string;
  subtitle?: string;
  default_tab?: string;
  tabs?: string[];
  pinned_views?: string[];
  hero?: string | null;
  surfaces?: Surface[];
  hide_debug?: boolean;
}
