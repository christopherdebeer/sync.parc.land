/** @jsxImportSource https://esm.sh/react@18.2.0 */
/**
 * Replay widget — plays back a frozen room from its audit log.
 *
 * Props:
 *   roomId    — the room to replay
 *   viewToken — read-only token; no write access needed
 *   height    — optional container height (default 420px)
 *
 * Architecture:
 *   1. On mount, fetch full audit log via /poll (for the timeline)
 *   2. Fetch /replay/<firstSeq> to show initial state
 *   3. On playhead move to seq N, call GET /rooms/:id/replay/:seq
 *   4. Feed resulting PollData into frozen panel components
 *
 * Playback is time-faithful:
 *   - Timeline strip dots are positioned proportionally to real event timestamps
 *   - Scrubbing maps click position → timestamp → nearest event
 *   - Auto-play delays are gap_ms / speed (speed = compression factor; 1× = real time)
 *   - Gaps are capped at MAX_REAL_GAP_MS so a 6-hour silence doesn't freeze playback
 *
 * The widget is entirely read-only. No tokens are written, no mutations issued.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.2.0";
import { styled, keyframes } from "../styled.ts";
import type { AuditRow, Agent, View, Surface } from "../types.ts";
import { AgentsPanel } from "./panels/Agents.tsx";
import { StatePanel } from "./panels/State.tsx";
import { MessagesPanel } from "./panels/Messages.tsx";
import { ActionsPanel } from "./panels/Actions.tsx";
import { ViewsPanel } from "./panels/Views.tsx";
import { SurfacesView, type SurfaceContext } from "./panels/Surfaces.tsx";

// Lazily resolved at call time so it works during SSR (no location available)
function getBaseUrl(): string {
  return (typeof location !== "undefined" && location.origin) || "https://sync.parc.land";
}

// ── Styled shell ─────────────────────────────────────────────────────────────

const Shell = styled.div<{ $height: number }>`
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  height: ${p => p.$height}px;
  font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
  font-size: 12px;
  color: var(--fg);
`;

// ── Top bar ──────────────────────────────────────────────────────────────────

const TopBar = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.85rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
`;

const RoomLabel = styled.div`
  font-size: 11px;
  color: var(--dim);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ReplayBadge = styled.div`
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent);
  opacity: 0.7;
  white-space: nowrap;
`;

const SeqLabel = styled.div`
  font-size: 10px;
  color: var(--dim);
  white-space: nowrap;
`;

// ── Tabs ─────────────────────────────────────────────────────────────────────

const TabsRow = styled.div`
  display: flex;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  padding: 0 0.5rem;
`;

const RTab = styled.button<{ $active: boolean }>`
  padding: 0.35rem 0.6rem;
  font-size: 11px;
  background: none;
  border: none;
  border-bottom: 2px solid ${p => p.$active ? "var(--accent)" : "transparent"};
  color: ${p => p.$active ? "var(--accent)" : "var(--dim)"};
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  &:hover { color: var(--fg); }
`;

const TabBadge = styled.span<{ $active: boolean }>`
  display: inline-block;
  background: ${p => p.$active ? "rgba(88,166,255,0.15)" : "var(--border)"};
  color: ${p => p.$active ? "var(--accent)" : "var(--dim)"};
  border-radius: 8px;
  padding: 0 4px;
  font-size: 9px;
  margin-left: 3px;
`;

// ── Panel area ───────────────────────────────────────────────────────────────

const PanelArea = styled.div`
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
`;

const EmptyState = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--dim);
  font-size: 11px;
  opacity: 0.5;
`;

// ── Agent colours ─────────────────────────────────────────────────────────────

const AGENT_PALETTE = [
  "var(--accent)", "var(--green)", "var(--purple)", "var(--orange)",
  "var(--yellow)", "var(--red)", "#e879a0", "#47d1d1",
];

function agentColor(agentId: string): string {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = ((h << 5) - h + agentId.charCodeAt(i)) | 0;
  return AGENT_PALETTE[Math.abs(h) % AGENT_PALETTE.length];
}

// ── Event kind symbols ────────────────────────────────────────────────────────

function kindSymbol(kind: string): string {
  switch (kind) {
    case "agent_join": return "+";
    case "agent_update": return "~";
    case "register_action": return "⚡";
    case "delete_action": return "−";
    case "register_view": return "◉";
    case "delete_view": return "−";
    case "invoke": return "→";
    default: return "·";
  }
}

// ── Timeline ─────────────────────────────────────────────────────────────────

const TimelineArea = styled.div`
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  padding: 0.5rem 0.85rem 0.6rem;
  background: var(--surface);
`;

const ControlsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.35rem;
`;

const TBtn = styled.button<{ $active?: boolean }>`
  background: none;
  border: 1px solid ${p => p.$active ? "var(--accent)" : "var(--border)"};
  border-radius: 4px;
  color: ${p => p.$active ? "var(--accent)" : "var(--dim)"};
  font-size: 11px;
  padding: 0.2rem 0.4rem;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1;
  &:hover { color: var(--fg); border-color: var(--dim); }
  &:disabled { opacity: 0.3; cursor: default; }
`;

const SpeedBtn = styled.button<{ $active: boolean }>`
  background: none;
  border: 1px solid ${p => p.$active ? "var(--accent)" : "var(--border)"};
  border-radius: 4px;
  color: ${p => p.$active ? "var(--accent)" : "var(--dim)"};
  font-size: 10px;
  padding: 0.2rem 0.4rem;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  &:hover { color: var(--fg); }
`;

const SeqCounter = styled.div`
  font-size: 10px;
  color: var(--dim);
  white-space: nowrap;
  min-width: 3.5em;
  text-align: center;
`;

const Spacer = styled.div`flex: 1;`;

// ── Visual timeline strip ────────────────────────────────────────────────────

const StripWrap = styled.div`
  margin-top: 0.35rem;
  position: relative;
  height: 18px;
  cursor: pointer;
`;

const StripTrack = styled.div`
  position: absolute;
  top: 8px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--border);
  border-radius: 1px;
`;

const StripDot = styled.div<{ $color: string; $active: boolean; $pct: number }>`
  position: absolute;
  top: ${p => p.$active ? "3px" : "5px"};
  left: ${p => p.$pct}%;
  width: ${p => p.$active ? "8px" : "4px"};
  height: ${p => p.$active ? "12px" : "8px"};
  margin-left: ${p => p.$active ? "-4px" : "-2px"};
  border-radius: ${p => p.$active ? "2px" : "1px"};
  background: ${p => p.$color};
  opacity: ${p => p.$active ? 1 : 0.5};
  transition: all 0.1s ease;
  z-index: ${p => p.$active ? 2 : 1};
`;

const TimeRow = styled.div`
  display: flex;
  justify-content: space-between;
  margin-top: 0.2rem;
`;

const TimeLabel = styled.div`
  font-size: 9px;
  color: var(--dim);
  opacity: 0.5;
  white-space: nowrap;
`;

const EventLabel = styled.div`
  font-size: 10px;
  color: var(--dim);
  margin-top: 0.2rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-height: 1.4em;
  display: flex;
  align-items: center;
  gap: 0.35rem;
`;

const AgentDot = styled.span<{ $color: string }>`
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: ${p => p.$color};
  flex-shrink: 0;
`;

// ── Loading shimmer ───────────────────────────────────────────────────────────

const shimmer = keyframes`
  0% { opacity: 0.4; }
  50% { opacity: 0.8; }
  100% { opacity: 0.4; }
`;

const Loading = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--dim);
  font-size: 11px;
  animation: ${shimmer} 1.5s ease-in-out infinite;
`;

// ── Time helpers ──────────────────────────────────────────────────────────────

/** Extract epoch ms from an audit row's embedded .ts field. Returns 0 if absent. */
function entryMs(entry: AuditRow | undefined): number {
  const ts = (entry?.value as any)?.ts;
  if (!ts) return 0;
  const ms = Date.parse(ts);
  return isNaN(ms) ? 0 : ms;
}

/** Format a duration in ms as a compact human string: 0s, 4s, 2m 3s, 1h 4m */
function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/** Format a total duration for the right end label: abbreviated for long spans. */
function formatTotal(ms: number): string {
  return formatDuration(ms);
}

// Max real gap before we cap the playback delay (30s of real time = cap)
const MAX_REAL_GAP_MS = 30_000;
// Minimum playback delay per step (ms) — prevents instant-fire on zero-gap clusters
const MIN_DELAY_MS = 50;

// ── Data shape normalizers ────────────────────────────────────────────────────

function normalizeAgents(raw: any): Agent[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.entries(raw).map(([id, v]: [string, any]) => ({ id, ...v }));
}

function normalizeState(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const rows: any[] = [];
  for (const [scope, keys] of Object.entries(raw)) {
    if (typeof keys !== "object" || keys === null) continue;
    for (const [key, value] of Object.entries(keys as Record<string, any>)) {
      rows.push({ scope, key, value, version: 1, room_id: "", updated_at: "" });
    }
  }
  return rows;
}

function normalizeMessages(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (raw.recent && Array.isArray(raw.recent)) {
    return raw.recent.map((m: any) => ({
      sort_key: m.seq ?? 0,
      value: m,
      updated_at: "",
    }));
  }
  return Object.entries(raw)
    .filter(([k]) => !isNaN(Number(k)))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, v]) => ({ sort_key: Number(k), value: v, updated_at: "" }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SPEEDS = [1, 2, 5] as const;
type Speed = typeof SPEEDS[number];

function describeAuditEntry(entry: any): string {
  if (!entry) return "";
  const kind = entry.kind ?? "invoke";
  const agent = entry.agent ?? "?";
  switch (kind) {
    case "agent_join": return `${agent} joined`;
    case "agent_update": return `${agent} updated`;
    case "register_action": return `${agent} registered action "${entry.schema?.id ?? ""}"`;
    case "delete_action": return `${agent} deleted action "${entry.schema?.id ?? ""}"`;
    case "register_view": return `${agent} registered view "${entry.schema?.id ?? ""}"`;
    case "delete_view": return `${agent} deleted view "${entry.schema?.id ?? ""}"`;
    case "invoke": {
      const ok = entry.ok ? "" : " ✗";
      return `${agent} → ${entry.action ?? "?"}${ok}`;
    }
    default: return `${agent}: ${kind}`;
  }
}

// ── Render hint → Surface converter (mirrors Dashboard.tsx logic) ─────────────

function renderHintToSurface(view: View): Surface {
  const hint = view.render!;
  const id = `auto-${view.id}`;
  const label = hint.label || view.description || view.id;
  switch (hint.type) {
    case "metric": return { id, type: "metric", view: view.id, label };
    case "markdown": return { id, type: "markdown", view: view.id, label };
    case "array-table": return { id, type: "array-table", view: view.id, label, columns: hint.columns, max_rows: hint.max_rows };
    case "view-table": return { id, type: "view-table", views: [view.id], label };
    default: return { id, type: "metric", view: view.id, label };
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ReplayWidgetProps {
  roomId: string;
  viewToken: string;
  height?: number;
}

type ReplayTab = "surfaces" | "agents" | "state" | "messages" | "actions" | "views";

export function ReplayWidget({ roomId, viewToken, height = 420 }: ReplayWidgetProps) {
  const [auditLog, setAuditLog] = useState<AuditRow[]>([]);
  const [snapshot, setSnapshot] = useState<any | null>(null);
  const [playIdx, setPlayIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [activeTab, setActiveTab] = useState<ReplayTab>("agents");
  const playTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const authHeadersRef = useRef({ "Authorization": `Bearer ${viewToken}` });
  useEffect(() => {
    authHeadersRef.current = { "Authorization": `Bearer ${viewToken}` };
  }, [viewToken]);

  // ── Fetch full audit log on mount ─────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);
    const baseUrl = getBaseUrl();
    fetch(`${baseUrl}/rooms/${roomId}/poll?audit_limit=2000`, { headers: authHeadersRef.current })
      .then(async r => {
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          throw new Error(`${r.status}: ${body.slice(0, 120)}`);
        }
        return r.json();
      })
      .then((data: any) => {
        // v8: audit entries have `seq` instead of `sort_key`. Normalize.
        const rawAudit = data.audit || [];
        const log: AuditRow[] = rawAudit.map((a: any) => ({
          sort_key: a.sort_key ?? a.seq ?? 0,
          value: a.value,
          updated_at: a.updated_at ?? "",
        })).sort(
          (a: AuditRow, b: AuditRow) => Number(a.sort_key) - Number(b.sort_key)
        );
        setAuditLog(log);
        setPlayIdx(0);
        // Load snapshot at the very first event
        const firstSeq = log.length > 0 ? Number(log[0].sort_key ?? 0) : 0;
        fetch(`${baseUrl}/rooms/${roomId}/replay/${firstSeq}`, { headers: authHeadersRef.current })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d) setSnapshot(d); })
          .catch(() => {});
      })
      .catch(e => setError(e.message ?? String(e)))
      .finally(() => setLoading(false));
  }, [roomId, viewToken]);

  // ── Fetch snapshot at a given audit index ─────────────────────────────────
  const fetchSnapshot = useCallback(async (idx: number) => {
    if (auditLog.length === 0) return;
    const seq = Number(auditLog[idx]?.sort_key ?? idx);
    if (fetchAbortRef.current) fetchAbortRef.current.abort();
    const ac = new AbortController();
    fetchAbortRef.current = ac;
    setFetching(true);
    const baseUrl = getBaseUrl();
    try {
      const r = await fetch(`${baseUrl}/rooms/${roomId}/replay/${seq}`, {
        headers: authHeadersRef.current,
        signal: ac.signal,
      });
      if (!r.ok) return;
      setSnapshot(await r.json());
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message ?? String(e));
    } finally {
      setFetching(false);
    }
  }, [roomId, auditLog]);

  // ── Time-based auto-play via setTimeout chain ─────────────────────────────
  // Re-runs whenever playIdx advances (or playing/speed/auditLog change).
  // Each timeout fires once, advances playIdx by 1, then this effect re-runs
  // and schedules the *next* gap — so speed changes take effect immediately.
  useEffect(() => {
    if (playTimeoutRef.current) clearTimeout(playTimeoutRef.current);
    if (!playing || auditLog.length === 0) return;
    if (playIdx >= auditLog.length - 1) {
      setPlaying(false);
      return;
    }
    const currentMs = entryMs(auditLog[playIdx]);
    const nextMs = entryMs(auditLog[playIdx + 1]);
    const rawGap = Math.max(0, nextMs - currentMs);
    const cappedGap = Math.min(rawGap, MAX_REAL_GAP_MS);
    const delay = Math.max(MIN_DELAY_MS, cappedGap / speed);

    playTimeoutRef.current = setTimeout(() => {
      const next = playIdx + 1;
      setPlayIdx(next);
      fetchSnapshot(next);
    }, delay);

    return () => { if (playTimeoutRef.current) clearTimeout(playTimeoutRef.current); };
  }, [playing, playIdx, speed, auditLog, fetchSnapshot]);

  const togglePlay = useCallback(() => {
    setPlaying(p => {
      if (!p && playIdx >= auditLog.length - 1) {
        setPlayIdx(0);
        fetchSnapshot(0);
      }
      return !p;
    });
  }, [playIdx, auditLog.length, fetchSnapshot]);

  const stepBack = useCallback(() => {
    if (playIdx <= 0) return;
    const next = playIdx - 1;
    setPlayIdx(next);
    fetchSnapshot(next);
  }, [playIdx, fetchSnapshot]);

  const stepForward = useCallback(() => {
    if (playIdx >= auditLog.length - 1) return;
    const next = playIdx + 1;
    setPlayIdx(next);
    fetchSnapshot(next);
  }, [playIdx, auditLog.length, fetchSnapshot]);

  // ── Scrub: debounced to avoid hammering /replay on drag ──────────────────
  const scrubTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScrub = useCallback((idx: number) => {
    setPlayIdx(idx);
    if (scrubTimeout.current) clearTimeout(scrubTimeout.current);
    scrubTimeout.current = setTimeout(() => fetchSnapshot(idx), 120);
  }, [fetchSnapshot]);

  // ── Timeline strip: time-based click mapping ──────────────────────────────
  const stripRef = useRef<HTMLDivElement | null>(null);

  const firstMs = auditLog.length > 0 ? entryMs(auditLog[0]) : 0;
  const lastMs = auditLog.length > 0 ? entryMs(auditLog[auditLog.length - 1]) : 0;
  const totalMs = lastMs - firstMs;

  const onStripClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!stripRef.current || auditLog.length === 0) return;
    const rect = stripRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    let idx: number;
    if (totalMs <= 0) {
      // All events at same timestamp — fall back to index
      idx = Math.round(pct * (auditLog.length - 1));
    } else {
      const targetMs = firstMs + pct * totalMs;
      // Last entry with ts <= targetMs
      idx = 0;
      for (let i = 0; i < auditLog.length; i++) {
        if (entryMs(auditLog[i]) <= targetMs) idx = i;
        else break;
      }
    }
    setPlayIdx(idx);
    fetchSnapshot(idx);
  }, [auditLog, firstMs, totalMs, fetchSnapshot]);

  // ── Derived display values ────────────────────────────────────────────────
  const currentEntry = auditLog[playIdx]?.value;
  const eventDesc = describeAuditEntry(currentEntry);
  const currentAgent = (currentEntry as any)?.agent ?? "";
  const currentKind = (currentEntry as any)?.kind ?? "invoke";

  const currentMs = entryMs(auditLog[playIdx]);
  const elapsedMs = currentMs - firstMs;
  const seqLabel = auditLog.length > 0 ? `${playIdx + 1} / ${auditLog.length}` : "—";
  const elapsedLabel = totalMs > 0 ? `+${formatDuration(elapsedMs)}` : "";
  const totalLabel = totalMs > 0 ? formatTotal(totalMs) : "";

  const agents = normalizeAgents(snapshot?.agents);
  const state = normalizeState(snapshot?.state);
  const messages = normalizeMessages(snapshot?.messages);
  const actions: any[] = Array.isArray((snapshot as any)?.actions) ? (snapshot as any).actions : [];
  const views: any[] = Array.isArray((snapshot as any)?.views) ? (snapshot as any).views : [];
  const agentMap: Record<string, Agent> = {};
  for (const a of agents) agentMap[a.id] = a;

  // ── Surfaces from views with render hints ──────────────────────────────────
  const activeSurfaces = useMemo<Surface[]>(() => {
    return views
      .filter((v: any) => v.render)
      .sort((a: any, b: any) => (a.render?.order ?? 999) - (b.render?.order ?? 999))
      .map((v: any) => renderHintToSurface(v as View));
  }, [views]);

  const hasSurfaces = activeSurfaces.length > 0;

  // Auto-switch to surfaces tab when surfaces become available
  useEffect(() => {
    if (hasSurfaces && activeTab === "agents") setActiveTab("surfaces");
  }, [hasSurfaces]);

  const surfaceCtx = useMemo<SurfaceContext | null>(() => {
    if (!snapshot || !hasSurfaces) return null;
    return {
      views: views.map((v: any) => ({ id: v.id, value: v.value, description: v.description, render: v.render })),
      actions: actions.map((a: any) => ({ id: a.id, available: a.available !== false, description: a.description, params: a.params, writes: a.writes, if: a.if })),
      messages: messages.map((m: any) => ({ sort_key: m.sort_key ?? 0, value: m.value, updated_at: m.updated_at ?? "" })),
      state: state.map((s: any) => ({ scope: s.scope ?? "_shared", key: s.key ?? "", value: s.value })),
      agentMap: Object.fromEntries(agents.map(a => [a.id, { name: a.name }])),
      roomId,
      baseUrl: getBaseUrl(),
      authHeaders: () => authHeadersRef.current,
      evalCel: () => true,
      readOnly: true,
    };
  }, [snapshot, agents, state, messages, actions, views, roomId, hasSurfaces]);

  const tabs: { id: ReplayTab; label: string; count: number }[] = [
    ...(hasSurfaces ? [{ id: "surfaces" as ReplayTab, label: "Surfaces", count: activeSurfaces.length }] : []),
    { id: "agents", label: "Agents", count: agents.length },
    { id: "state", label: "State", count: state.length },
    { id: "messages", label: "Messages", count: messages.length },
    { id: "actions", label: "Actions", count: actions.length },
    { id: "views", label: "Views", count: views.length },
  ];

  return (
    <Shell $height={height}>
      {/* Top bar */}
      <TopBar>
        <RoomLabel>{roomId}</RoomLabel>
        {fetching && <SeqLabel style={{ color: "var(--accent)", opacity: 0.6 }}>…</SeqLabel>}
        <SeqLabel>{seqLabel}</SeqLabel>
        {elapsedLabel && <SeqLabel style={{ opacity: 0.6 }}>{elapsedLabel}</SeqLabel>}
        <ReplayBadge>replay</ReplayBadge>
      </TopBar>

      {/* Tabs */}
      <TabsRow>
        {tabs.map(t => (
          <RTab key={t.id} $active={activeTab === t.id} onClick={() => setActiveTab(t.id)}>
            {t.label}
            <TabBadge $active={activeTab === t.id}>{t.count}</TabBadge>
          </RTab>
        ))}
      </TabsRow>

      {/* Panel */}
      <PanelArea>
        {loading ? (
          <Loading>loading audit log…</Loading>
        ) : error ? (
          <EmptyState style={{ flexDirection: "column", gap: "0.5rem" }}>
            <span style={{ color: "var(--red)" }}>fetch error</span>
            <span style={{ fontSize: "10px", opacity: 0.7, maxWidth: "90%", textAlign: "center", wordBreak: "break-all" }}>{error}</span>
          </EmptyState>
        ) : !snapshot ? (
          <EmptyState>no data</EmptyState>
        ) : (
          <>
            {activeTab === "surfaces" && surfaceCtx && (
              <SurfacesView surfaces={activeSurfaces} ctx={surfaceCtx} />
            )}
            {activeTab === "agents" && (
              agents.length === 0
                ? <EmptyState>no agents at this point</EmptyState>
                : <AgentsPanel agents={agents} epochMs={firstMs} playheadMs={currentMs} />
            )}
            {activeTab === "state" && (
              state.length === 0
                ? <EmptyState>no state at this point</EmptyState>
                : <StatePanel rows={state} agentMap={agentMap} tokenKind={null} />
            )}
            {activeTab === "messages" && (
              messages.length === 0
                ? <EmptyState>no messages at this point</EmptyState>
                : <MessagesPanel
                    messages={messages}
                    agentMap={agentMap}
                    roomId={roomId}
                    baseUrl={getBaseUrl()}
                    authHeaders={() => authHeadersRef.current}
                    autoScroll={false}
                    readOnly
                    epochMs={firstMs}
                  />
            )}
            {activeTab === "actions" && (
              actions.length === 0
                ? <EmptyState>no actions at this point</EmptyState>
                : <ActionsPanel
                    actions={actions}
                    roomId={roomId}
                    baseUrl={getBaseUrl()}
                    authHeaders={() => authHeadersRef.current}
                    readOnly
                  />
            )}
            {activeTab === "views" && (
              views.length === 0
                ? <EmptyState>no views at this point</EmptyState>
                : <ViewsPanel views={views} />
            )}
          </>
        )}
      </PanelArea>

      {/* Timeline */}
      <TimelineArea>
        <ControlsRow>
          <TBtn $active={playing} onClick={togglePlay}>
            {playing ? "⏸" : "▶"}
          </TBtn>
          <TBtn onClick={stepBack} disabled={playIdx <= 0}>◀</TBtn>
          <TBtn onClick={stepForward} disabled={playIdx >= auditLog.length - 1}>▶</TBtn>
          <SeqCounter>{seqLabel}</SeqCounter>
          <Spacer />
          {SPEEDS.map(s => (
            <SpeedBtn key={s} $active={speed === s} onClick={() => setSpeed(s)}>
              {s}×
            </SpeedBtn>
          ))}
        </ControlsRow>

        {auditLog.length > 0 && (
          <>
            <StripWrap ref={stripRef} onClick={onStripClick}>
              <StripTrack />
              {auditLog.map((entry, i) => {
                const v = (entry.value ?? {}) as any;
                const agent = v.agent ?? "";
                const kind = v.kind ?? "invoke";
                // Position by real timestamp fraction; fall back to index if no ts data
                const pct = totalMs > 0
                  ? Math.max(0, Math.min(100, ((entryMs(entry) - firstMs) / totalMs) * 100))
                  : auditLog.length <= 1 ? 50 : (i / (auditLog.length - 1)) * 100;
                return (
                  <StripDot
                    key={i}
                    $color={agentColor(agent)}
                    $active={i === playIdx}
                    $pct={pct}
                    title={`${kindSymbol(kind)} ${agent}`}
                  />
                );
              })}
            </StripWrap>

            {totalMs > 0 && (
              <TimeRow>
                <TimeLabel>0s</TimeLabel>
                <TimeLabel>{totalLabel}</TimeLabel>
              </TimeRow>
            )}
          </>
        )}

        <EventLabel>
          {currentAgent && <AgentDot $color={agentColor(currentAgent)} />}
          <span>{kindSymbol(currentKind)} {eventDesc || "\u00a0"}</span>
        </EventLabel>
      </TimelineArea>
    </Shell>
  );
}
