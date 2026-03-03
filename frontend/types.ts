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

export interface View {
  id: string;
  room_id: string;
  scope: string;
  description?: string;
  expr: string;
  value: any;
  version: number;
  registered_by?: string;
}

export interface AuditRow {
  sort_key: number;
  value: any;
  updated_at: string;
}

export interface PollData {
  agents: Agent[];
  state: StateRow[];
  messages: RawMessage[];
  actions: Action[];
  views: View[];
  audit: AuditRow[];
}

export type TokenKind = "room" | "agent";

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

export type Surface =
  | SurfaceMetric
  | SurfaceViewGrid
  | SurfaceViewTable
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
