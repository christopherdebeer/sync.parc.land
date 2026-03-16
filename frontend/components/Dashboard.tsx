/** @jsxImportSource https://esm.sh/react@18.2.0 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "https://esm.sh/react@18.2.0";
import { styled } from "../styled.ts";
import { Nav } from "./Nav.tsx";
import type {
  PollDataV8, DashboardConfig, Surface, TokenKind,
  ActionDef, ViewDef, AgentDef, StateEntry, AuditEntry,
} from "../types.ts";
import {
  actionsFromState, viewsFromState, agentsFromState,
  messagesFromState, sharedState, scopeEntries, allScopes,
} from "../types.ts";
import { JsonView } from "./JsonView.tsx";
import { AgentsPanel } from "./panels/Agents.tsx";
import { StatePanel } from "./panels/State.tsx";
import { MessagesPanel } from "./panels/Messages.tsx";
import { ActionsPanel } from "./panels/Actions.tsx";
import { ViewsPanel } from "./panels/Views.tsx";
import { AuditPanel } from "./panels/Audit.tsx";
import { CelPanel } from "./panels/Cel.tsx";
import { SurfacesView, type SurfaceContext } from "./panels/Surfaces.tsx";

const POLL_INTERVAL_MS = 2000;
const BASE_URL = globalThis.location?.origin || "";
const STORAGE_KEY = (roomId: string) => `sync_token_${roomId}`;

// Signal to the shell that React hydrated successfully
if (typeof window !== "undefined" && typeof (window as any).__HYDRATION_OK__ === "function") {
  (window as any).__HYDRATION_OK__();
}

// ── Safe storage helpers ─────────────────────────────────────────────────

function safeGetItem(storage: Storage, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}
function safeSetItem(storage: Storage, key: string, value: string): void {
  try { storage.setItem(key, value); } catch {}
}
function safeRemoveItem(storage: Storage, key: string): void {
  try { storage.removeItem(key); } catch {}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function inferTokenKind(tok: string): TokenKind {
  if (tok.startsWith("room_")) return "room";
  if (tok.startsWith("view_")) return "view";
  if (tok.startsWith("tok_")) return "room"; // unified tokens get full dashboard access
  return "agent";
}

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

// ── Styled components (unchanged) ────────────────────────────────────────────

const Page = styled.div`
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--bg); color: var(--fg); line-height: 1.6; min-height: 100vh;
  display: flex; flex-direction: column;
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
`;
const Gate = styled.div`
  padding: 15vw 1.5rem; text-align: center; font-size: 13px; width: 100%;
  min-height: 100vh; display: flex; flex-direction: column; align-items: center;
  justify-content: center; background-color: var(--bg); box-sizing: border-box;
  @media (max-width: 480px) { padding: 20vw 1.25rem; }
`;
const GateTitle = styled.h2`
  color: var(--accent); font-size: 16px; margin-bottom: 0.3rem;
`;
const GateSub = styled.div`
  color: var(--dim); font-size: 12px; margin-bottom: 1.2rem;
`;
const TokenInput = styled.input`
  width: 100%; max-width: 20rem; background: var(--surface);
  border: 1px solid var(--border); border-radius: 6px; padding: 0.6rem 0.8rem;
  color: var(--fg); font-family: inherit; font-size: 13px; outline: none;
  text-align: center; box-sizing: border-box;
  &:focus { border-color: var(--accent); }
`;
const GateError = styled.div`
  color: var(--red); font-size: 12px; margin-top: 0.5rem;
`;
const GateHint = styled.div`
  color: var(--dim); font-size: 11px; margin-top: 1rem;
`;
const GateStatus = styled.div`
  color: var(--dim); font-size: 12px; margin-top: 0.5rem;
`;
const PasskeyButton = styled.button`
  margin-top: 0.75rem; padding: 0.5rem 1.2rem; background: var(--surface);
  border: 1px solid var(--border); border-radius: 6px; color: var(--accent);
  font-family: inherit; font-size: 12px; cursor: pointer; transition: all 0.15s;
  &:hover { border-color: var(--accent); background: rgba(88,166,255,0.08); }
  &:disabled { opacity: 0.5; cursor: default; }
`;
const GateDivider = styled.div`
  color: var(--dim); font-size: 11px; margin: 0.75rem 0;
  display: flex; align-items: center; gap: 0.5rem;
  &::before, &::after { content: ""; flex: 1; border-top: 1px solid var(--border); }
`;
const DebugTrace = styled.div`
  margin-top: 1.5rem; padding: 0.5rem 0.75rem; background: var(--surface);
  border: 1px solid var(--border); border-radius: 6px; text-align: left;
  font-family: "SF Mono", "Fira Code", monospace; font-size: 10px;
  color: var(--dim); max-width: 28rem; width: 100%; max-height: 12rem;
  overflow-y: auto; line-height: 1.6; white-space: pre-wrap; word-break: break-all;
`;
const Main = styled.div`
  font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
  font-size: 13px; line-height: 1.5; background: var(--bg); color: var(--fg);
  max-width: 1100px; margin: 0 auto; min-height: 100vh; width: 100%;
  a { color: var(--accent); text-decoration: none; }
  code { background: var(--surface); padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.88em; }
`;
const Headers = styled.div`
  position: sticky; top: 0; background-color: var(--bg); padding: 1em; z-index: 10;
  @media (max-width: 480px) { padding: 0.6rem 0.5rem; }
`;
const HeaderRow = styled.div`
  display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.5rem;
`;
const Title = styled.h1`
  font-size: 14px; font-weight: 600;
  a { color: var(--accent); text-decoration: none; }
`;
const Subtitle = styled.div`
  color: var(--dim); font-size: 11px; word-break: break-all;
`;
const PollInfo = styled.div`
  color: var(--dim); font-size: 11px; display: flex; align-items: center; gap: 6px;
`;
const Dot = styled.span<{ $error?: boolean }>`
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: ${(p) => p.$error ? "var(--red)" : "var(--green)"};
`;
const IdBar = styled.div`
  display: flex; align-items: center; gap: 0.75rem; padding: 0.4rem 0.6rem;
  background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
  margin-bottom: 0.5rem; font-size: 12px; flex-wrap: wrap;
`;
const IdLabel = styled.span` color: var(--dim); `;
const IdKind = styled.span<{ $kind: TokenKind | null }>`
  font-weight: 600;
  color: ${(p) => p.$kind === "room" ? "var(--orange)" : p.$kind === "view" ? "var(--purple)" : "var(--accent)"};
`;
const IdSelect = styled.select`
  background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
  color: var(--fg); font-family: inherit; font-size: 12px; padding: 2px 6px; outline: none;
  &:focus { border-color: var(--accent); }
`;
const Logout = styled.span`
  color: var(--dim); cursor: pointer; font-size: 11px; margin-left: auto;
  &:hover { color: var(--red); }
`;
const SummaryBar = styled.div`
  display: flex; gap: 1rem; padding: 0.4rem 0; font-size: 12px; color: var(--dim); flex-wrap: wrap;
  @media (max-width: 480px) { gap: 0.5rem 0.75rem; font-size: 11px; }
`;
const Stat = styled.div<{ $color?: string }>`
  display: flex; align-items: center; gap: 4px; color: ${(p) => p.$color || "var(--dim)"};
`;
const StatN = styled.span` color: var(--fg); font-weight: 600; `;
const TabsBar = styled.div`
  display: flex; border-bottom: 1px solid var(--border); margin: 0.5rem 0 0;
  overflow-x: auto; scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;
const Tab = styled.button<{ $active: boolean }>`
  padding: 0.4rem 0.7rem; font-size: 12px; cursor: pointer;
  color: ${(p) => p.$active ? "var(--accent)" : "var(--dim)"};
  border-bottom: 2px solid ${(p) => p.$active ? "var(--accent)" : "transparent"};
  background: none; border-top: none; border-left: none; border-right: none;
  font-family: inherit; white-space: nowrap;
  &:hover { color: var(--fg); }
`;
const TabBadge = styled.span<{ $active: boolean }>`
  display: inline-block;
  background: ${(p) => p.$active ? "rgba(88,166,255,0.15)" : "var(--border)"};
  color: ${(p) => p.$active ? "var(--accent)" : "var(--dim)"};
  border-radius: 8px; padding: 0 5px; font-size: 10px; margin-left: 3px;
`;
const Panel = styled.div<{ $active: boolean }>`
  display: ${(p) => p.$active ? "block" : "none"}; padding: 0.75rem 1em;
  @media (max-width: 480px) { padding: 0.5rem; }
`;
const DebugToggle = styled.button<{ $open: boolean }>`
  display: flex; align-items: center; gap: 6px; width: 100%; padding: 0.5rem 1rem;
  background: var(--surface); border: none; border-top: 1px solid var(--border);
  color: var(--dim); font-family: inherit; font-size: 11px; cursor: pointer;
  &:hover { color: var(--fg); }
`;
const DebugSection = styled.div<{ $open: boolean }>`
  display: ${p => p.$open ? "block" : "none"};
`;

// ── Types ────────────────────────────────────────────────────────────────────

type PollStatus = "connecting" | "live" | "error";
type TabId = "agents" | "state" | "messages" | "actions" | "views" | "audit" | "cel";

const ALL_TABS: { id: TabId; label: string }[] = [
  { id: "agents", label: "Agents" },
  { id: "state", label: "State" },
  { id: "messages", label: "Messages" },
  { id: "actions", label: "Actions" },
  { id: "views", label: "Views" },
  { id: "audit", label: "Audit" },
  { id: "cel", label: "CEL" },
];

interface DashboardProps { roomId: string; }

// ── Dashboard config helpers ─────────────────────────────────────────────────

function extractDashboardConfig(state: StateEntry[]): DashboardConfig | null {
  const row = state.find(s => s.scope === "_shared" && s.key === "_dashboard");
  if (!row) return null;
  const v = typeof row.value === "string" ? (() => { try { return JSON.parse(row.value); } catch { return null; } })() : row.value;
  if (!v || typeof v !== "object") return null;
  return v as DashboardConfig;
}

/** v8: Generate auto-surface from a view definition with render hint */
function viewDefToSurface(viewId: string, def: ViewDef): Surface {
  const hint = def.render!;
  const id = `auto-${viewId}`;
  const label = hint.label || def.description || viewId;
  switch (hint.type) {
    case "metric": return { id, type: "metric", view: viewId, label };
    case "markdown": return { id, type: "markdown", view: viewId, label };
    case "array-table": return { id, type: "array-table", view: viewId, label, columns: hint.columns, max_rows: hint.max_rows };
    case "view-table": return { id, type: "view-table", views: [viewId], label };
    default: return { id, type: "metric", view: viewId, label };
  }
}

/** v8: Build a simple client-side CEL evaluator from state entries */
function makeSimpleCelEvaluatorV8(data: PollDataV8): (expr: string) => boolean {
  const stateMap: Record<string, Record<string, any>> = {};
  for (const s of data.state) {
    if (!stateMap[s.scope]) stateMap[s.scope] = {};
    stateMap[s.scope][s.key] = s.value;
  }

  function evalAtom(clause: string): boolean {
    const c = clause.trim();
    if (c === "true") return true;
    if (c === "false") return false;
    const m = c.match(/^state\.([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*(==|!=|>=?|<=?)\s*(.+)$/);
    if (m) {
      const [, scope, key, op, rawVal] = m;
      const actual = stateMap[scope]?.[key];
      let expected: any = rawVal.trim();
      if ((expected.startsWith('"') && expected.endsWith('"')) || (expected.startsWith("'") && expected.endsWith("'"))) expected = expected.slice(1, -1);
      else if (expected === "true") expected = true;
      else if (expected === "false") expected = false;
      else if (expected === "null") expected = null;
      else if (!isNaN(Number(expected))) expected = Number(expected);
      if (op === "==") return actual == expected;
      if (op === "!=") return actual != expected;
      if (op === ">") return actual > expected;
      if (op === "<") return actual < expected;
      if (op === ">=") return actual >= expected;
      if (op === "<=") return actual <= expected;
    }
    const mv = c.match(/^views\["?([^"]+)"?\]\s*(==|!=)\s*(.+)$/);
    if (mv) {
      const [, id, op, rawVal] = mv;
      const actual = data.resolved[id];
      let expected: any = rawVal.trim();
      if ((expected.startsWith('"') && expected.endsWith('"')) || (expected.startsWith("'") && expected.endsWith("'"))) expected = expected.slice(1, -1);
      if (op === "==") return actual == expected;
      if (op === "!=") return actual != expected;
    }
    return false;
  }

  return (expr: string): boolean => {
    try {
      const orGroups = expr.trim().split(/\s*\|\|\s*/);
      for (const group of orGroups) {
        const allTrue = group.split(/\s*&&\s*/).every(c => evalAtom(c.replace(/^\(+/, '').replace(/\)+$/, '').trim()));
        if (allTrue) return true;
      }
      return false;
    } catch { return false; }
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function Dashboard({ roomId }: DashboardProps) {
  const [token, setToken] = useState<string | null>(null);
  const [tokenKind, setTokenKind] = useState<TokenKind | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [authStatus, setAuthStatus] = useState("");
  const [data, setData] = useState<PollDataV8 | null>(null);
  const [pollStatus, setPollStatus] = useState<PollStatus>("connecting");
  const [activeTab, setActiveTab] = useState<TabId>("agents");
  const [viewAs, setViewAs] = useState("");
  const [tabInitialized, setTabInitialized] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [hasPasskeyOption, setHasPasskeyOption] = useState(false);
  const [vaultChecked, setVaultChecked] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Append a timestamped line to the visible debug trace
  const log = useCallback((msg: string) => {
    setDebugLog(prev => [...prev, `[${ts()}] ${msg}`]);
  }, []);

  const authHeaders = useCallback((): Record<string, string> => ({
    "Authorization": `Bearer ${token}`,
  }), [token]);

  const agentMap = useMemo<Record<string, { name: string; role: string }>>(() => {
    if (!data) return {};
    const m: Record<string, { name: string; role: string }> = {};
    for (const a of agentsFromState(data)) m[a.id] = { name: a.def.name, role: a.def.role };
    return m;
  }, [data]);

  const dashConfig = useMemo<DashboardConfig | null>(() => {
    if (!data) return null;
    return extractDashboardConfig(data.state);
  }, [data]);

  // v8: derive views from state for surface detection
  const derivedViews = useMemo(() => data ? viewsFromState(data) : [], [data]);

  const hasSurfaces = useMemo(
    () => Boolean(dashConfig?.surfaces?.length) || Boolean(derivedViews.some(v => v.def.render)),
    [dashConfig, derivedViews]
  );
  const activeSurfaces = useMemo<Surface[]>(() => {
    if (dashConfig?.surfaces?.length) return dashConfig.surfaces;
    return derivedViews
      .filter(v => v.def.render)
      .sort((a, b) => (a.def.render?.order ?? 999) - (b.def.render?.order ?? 999))
      .map(v => viewDefToSurface(v.id, v.def));
  }, [dashConfig, derivedViews]);
  const visibleTabs = useMemo(() => {
    if (!dashConfig?.tabs) return ALL_TABS;
    return ALL_TABS.filter(t => new Set(dashConfig.tabs).has(t.id));
  }, [dashConfig?.tabs]);

  useEffect(() => {
    if (tabInitialized || !dashConfig?.default_tab) return;
    const dt = dashConfig.default_tab as TabId;
    if (ALL_TABS.some(t => t.id === dt)) setActiveTab(dt);
    setTabInitialized(true);
  }, [dashConfig, tabInitialized]);

  const evalCel = useMemo(() => {
    if (!data) return () => true;
    return makeSimpleCelEvaluatorV8(data);
  }, [data]);

  // v8: Build SurfaceContext directly from v8 data — no legacy adapter
  const surfaceCtx = useMemo<SurfaceContext | null>(() => {
    if (!data || !token) return null;
    return {
      views: derivedViews.map(v => ({ id: v.id, value: v.value, description: v.def.description, render: v.def.render })),
      actions: actionsFromState(data).map(a => ({ id: a.id, available: a.available, description: a.def.description, params: a.def.params, writes: a.def.writes, if: a.def.if })),
      messages: messagesFromState(data).map(m => ({ sort_key: m.sort_key ?? 0, value: m.value, updated_at: m.updated_at })),
      state: data.state.map(s => ({ scope: s.scope, key: s.key, value: s.value })),
      agentMap,
      roomId,
      baseUrl: BASE_URL,
      authHeaders: () => ({ "Authorization": `Bearer ${token}` }),
      evalCel,
    };
  }, [data, derivedViews, agentMap, roomId, token, evalCel]);

  const doPoll = useCallback(async (tok: string) => {
    try {
      const r = await fetch(`${BASE_URL}/rooms/${roomId}/poll`, {
        headers: { "Authorization": `Bearer ${tok}` },
      });
      if (r.status === 401) return null;
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.json() as PollDataV8;
    } catch { return undefined; }
  }, [roomId]);

  const startPolling = useCallback((tok: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const poll = async () => {
      const d = await doPoll(tok);
      if (d === null) { safeRemoveItem(sessionStorage, STORAGE_KEY(roomId)); setToken(null); setTokenKind(null); setPollStatus("error"); if (pollRef.current) clearInterval(pollRef.current); return; }
      if (d === undefined) { setPollStatus("error"); return; }
      setData(d); setPollStatus("live");
    };
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [doPoll, roomId]);

  const authenticateWith = useCallback(async (tok: string): Promise<boolean> => {
    const d = await doPoll(tok);
    if (d === null || d === undefined) return false;
    safeSetItem(sessionStorage, STORAGE_KEY(roomId), tok);
    setToken(tok); setTokenKind(inferTokenKind(tok)); setData(d); setPollStatus("live"); startPolling(tok);
    return true;
  }, [doPoll, roomId, startPolling]);

  const tryAuth = useCallback(async () => {
    const tok = tokenInput.trim();
    if (!tok) return;
    setAuthError("");
    const d = await doPoll(tok);
    if (d === null) { setAuthError("Invalid token for this room."); return; }
    if (d === undefined) { setAuthError("Connection failed."); return; }
    safeSetItem(sessionStorage, STORAGE_KEY(roomId), tok);
    setToken(tok); setTokenKind(inferTokenKind(tok)); setData(d); setPollStatus("live"); startPolling(tok);
  }, [tokenInput, doPoll, roomId, startPolling]);

  const tryRoomTokenAuth = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      // v7: Mint a temporary tok_ token for this room via manage API
      const res = await fetch(`${BASE_URL}/manage/api/room-token`, {
        method: "POST",
        headers: { "X-Session-Id": sessionId, "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: roomId }),
      });
      if (res.status === 401) { safeRemoveItem(localStorage, "sync_session_id"); return false; }
      if (res.status === 403) return false; // no access to this room
      if (!res.ok) return false;
      const data = await res.json();
      if (!data.token) return false;
      return await authenticateWith(data.token);
    } catch { return false; }
  }, [roomId, authenticateWith]);

  const doPasskeyAuth = useCallback(async () => {
    setAuthError(""); setAuthStatus("Signing in with passkey…");
    try {
      const { startAuthentication } = await import("https://esm.sh/@simplewebauthn/browser@13");
      const optRes = await fetch(`${BASE_URL}/webauthn/authenticate/options`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const optData = await optRes.json();
      if (!optRes.ok) { setAuthError(optData.error || "Failed to get auth options"); setAuthStatus(""); return; }
      setAuthStatus("Touch your authenticator…");
      const assertResp = await startAuthentication({ optionsJSON: optData.options });
      setAuthStatus("Verifying…");
      const verRes = await fetch(`${BASE_URL}/webauthn/authenticate/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId: optData.challengeId, response: assertResp }) });
      const verData = await verRes.json();
      if (!verRes.ok || !verData.verified) { setAuthError(verData.error || "Authentication failed"); setAuthStatus(""); return; }
      safeSetItem(localStorage, "sync_session_id", verData.sessionId);
      setAuthStatus("Checking access…");
      const ok = await tryRoomTokenAuth(verData.sessionId);
      if (!ok) setAuthError("Signed in but you don't have access to this room.");
      setAuthStatus("");
    } catch (err: any) { setAuthError(err.message || "Passkey authentication failed"); setAuthStatus(""); }
  }, [tryRoomTokenAuth]);

  // ── Mount: sequential auth chain with debug logging ───────────────────────

  useEffect(() => {
    let cancelled = false;
    log("effect start · roomId=" + roomId);
    log("hash=" + (location.hash || "(empty)"));
    log("origin=" + BASE_URL);

    (async () => {
      try {
        // 1. Hash token
        const hash = location.hash;
        let hashToken: string | null = null;
        if (hash.includes("token=")) {
          hashToken = new URLSearchParams(hash.slice(1)).get("token");
          log("hash token found: " + (hashToken ? hashToken.slice(0, 12) + "…" : "null"));
        } else {
          log("no hash token");
        }

        if (hashToken) {
          log("polling with hash token…");
          const d = await doPoll(hashToken);
          if (cancelled) { log("cancelled after hash poll"); return; }
          log("hash poll result: " + (d === null ? "401" : d === undefined ? "error" : "ok"));
          if (d && d !== null && d !== undefined) {
            history.replaceState(null, "", location.pathname + location.search);
            safeSetItem(sessionStorage, STORAGE_KEY(roomId), hashToken);
            setToken(hashToken); setTokenKind(inferTokenKind(hashToken)); setData(d); setPollStatus("live"); startPolling(hashToken);
            log("authenticated via hash token ✓");
            return;
          }
          history.replaceState(null, "", location.pathname + location.search);
          setAuthError(d === null ? "Token from link was invalid or expired." : "Connection failed while verifying token from link.");
          setTokenInput(hashToken);
        }

        // 2. sessionStorage
        const stored = safeGetItem(sessionStorage, STORAGE_KEY(roomId));
        log("sessionStorage: " + (stored ? stored.slice(0, 12) + "…" : "null"));
        if (stored) {
          log("polling with stored token…");
          const d = await doPoll(stored);
          if (cancelled) { log("cancelled after stored poll"); return; }
          log("stored poll result: " + (d === null ? "401" : d === undefined ? "error" : "ok"));
          if (d && d !== null && d !== undefined) {
            setToken(stored); setTokenKind(inferTokenKind(stored)); setData(d); setPollStatus("live"); startPolling(stored);
            log("authenticated via sessionStorage ✓");
            return;
          }
          safeRemoveItem(sessionStorage, STORAGE_KEY(roomId));
          log("stored token invalid — cleared");
        }

        // 3. User-rooms auto-resolution (v7 — replaces vault)
        if (!cancelled) {
          const sessionId = safeGetItem(localStorage, "sync_session_id");
          log("manage session: " + (sessionId ? sessionId.slice(0, 12) + "…" : "null"));
          if (sessionId) {
            log("trying room-token resolution…");
            setAuthStatus("Checking access…");
            const ok = await tryRoomTokenAuth(sessionId);
            if (cancelled) { log("cancelled after room-token"); return; }
            log("room-token result: " + (ok ? "authenticated ✓" : "no access"));
            if (ok) { setAuthStatus(""); return; }
            setAuthStatus("");
          }
        }

        log("no auto-auth — showing gate");
      } catch (e: any) {
        log("ERROR: " + (e.message || String(e)));
        console.error("[dashboard] auth init error:", e);
      } finally {
        if (!cancelled) {
          setVaultChecked(true);
          if (typeof window !== "undefined" && window.PublicKeyCredential) setHasPasskeyOption(true);
          log("gate unlocked (vaultChecked=true)");
        }
      }
    })();

    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current); };
  }, [roomId]);

  const doLogout = useCallback(() => {
    safeRemoveItem(sessionStorage, STORAGE_KEY(roomId));
    if (pollRef.current) clearInterval(pollRef.current);
    setToken(null); setTokenKind(null); setData(null); setPollStatus("connecting");
    setTokenInput(""); setTabInitialized(false); setAuthError(""); setAuthStatus("");
    setVaultChecked(true);
    if (typeof window !== "undefined" && window.PublicKeyCredential) setHasPasskeyOption(true);
  }, [roomId]);

  // ── Derived data (must be above early returns to satisfy Rules of Hooks) ──

  const derivedAgents = useMemo(() => data ? agentsFromState(data) : [], [data]);
  const derivedActions = useMemo(() => data ? actionsFromState(data) : [], [data]);
  const derivedMessages = useMemo(() => data ? messagesFromState(data) : [], [data]);

  const panelAgents = useMemo(() => derivedAgents.map(a => ({
    id: a.id, name: a.def.name, role: a.def.role, status: a.def.status,
    last_heartbeat: a.def.last_heartbeat ?? "", grants: JSON.stringify(a.def.grants),
    joined_at: a.def.joined_at ?? "",
  })), [derivedAgents]);

  const panelState = useMemo(() => {
    if (!data) return [];
    return data.state.filter(s => s.scope !== "_audit").map(s => ({
      room_id: "", scope: s.scope, key: s.key, value: s.value,
      version: s.revision, sort_key: s.sort_key ?? undefined, updated_at: s.updated_at,
    }));
  }, [data]);

  const panelMessages = useMemo(() =>
    derivedMessages.map(m => ({ sort_key: m.sort_key ?? 0, value: m.value, updated_at: m.updated_at })),
  [derivedMessages]);

  const panelActions = useMemo(() => derivedActions.map(a => ({
    id: a.id, room_id: "", scope: a.def.scope ?? "_shared",
    description: a.def.description, available: a.available,
    params: a.def.params, writes: a.def.writes, version: 1,
    registered_by: a.def.registered_by, if: a.def.if,
  })), [derivedActions]);

  const panelViews = useMemo(() => derivedViews.map(v => ({
    id: v.id, room_id: "", scope: v.def.scope ?? "_shared",
    description: v.def.description, expr: v.def.expr,
    value: v.value, version: 1, registered_by: v.def.registered_by,
    render: v.def.render ?? null,
  })), [derivedViews]);

  const panelAudit = useMemo(() =>
    data?.audit.map(a => ({ sort_key: a.seq, value: a.value, updated_at: a.updated_at })) ?? [],
  [data]);

  const activeAgents = derivedAgents.filter(a => a.def.status === "active").length;
  const waitingAgents = derivedAgents.filter(a => a.def.status === "waiting").length;
  const stateCount = data?.state.filter(s => !s.scope.startsWith("_")).length ?? 0;
  const scopeCount = data ? allScopes(data).length : 0;
  const viewingId = viewAs || undefined;
  const titleText = dashConfig?.title || "agent-sync";
  const subtitleText = dashConfig?.subtitle || roomId;

  // ── Auth gate ─────────────────────────────────────────────────────────────

  if (!token) {
    return (
      <Gate>
        <GateTitle>agent-sync</GateTitle>
        <GateSub>{roomId}</GateSub>

        {!vaultChecked && authStatus && <GateStatus>{authStatus}</GateStatus>}
        {!vaultChecked && !authStatus && <GateStatus>connecting…</GateStatus>}

        {vaultChecked && (
          <>
            <TokenInput
              type="text" placeholder="paste room, agent, or view token"
              value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && tryAuth()}
              autoComplete="off" spellCheck={false}
            />
            {authError && <GateError>{authError}</GateError>}
            {authStatus && <GateStatus>{authStatus}</GateStatus>}
            {hasPasskeyOption && (
              <>
                <GateDivider>or</GateDivider>
                <PasskeyButton onClick={doPasskeyAuth} disabled={!!authStatus}>
                  Sign in with passkey
                </PasskeyButton>
              </>
            )}
            <GateHint>
              Token stored in sessionStorage · sent via Authorization header only.
            </GateHint>
          </>
        )}

        {/* Debug trace — always visible in gate */}
        {debugLog.length > 0 && (
          <DebugTrace>{debugLog.join("\n")}</DebugTrace>
        )}
      </Gate>
    );
  }

  // ── Authenticated dashboard ───────────────────────────────────────────────

  if (!data) return <div style={{ padding: "2rem", color: "#484f58" }}>waiting for data…</div>;

  return (
    <Page>
      <Nav active="dashboard" />
      <Main>
        <Headers>
          <HeaderRow>
            <div>
              <Title><a href="/">{titleText}</a>{!dashConfig?.title && <span style={{ color: "var(--dim)", fontWeight: 400 }}> v6</span>}</Title>
              <Subtitle>{subtitleText}</Subtitle>
            </div>
            <PollInfo><Dot $error={pollStatus === "error"} />{pollStatus === "live" ? "live" : pollStatus === "error" ? "error" : "connecting…"}</PollInfo>
          </HeaderRow>
          {(!hasSurfaces || debugOpen) && (
            <IdBar>
              <IdLabel>identity:</IdLabel>
              <IdKind $kind={tokenKind}>{tokenKind === "room" ? "room admin" : tokenKind === "view" ? "observer" : "agent"}</IdKind>
              {tokenKind === "room" && <IdSelect value={viewAs} onChange={(e) => setViewAs(e.target.value)}><option value="">admin (all scopes)</option>{derivedAgents.map(a => <option key={a.id} value={a.id}>view as: {a.def.name || a.id}</option>)}</IdSelect>}
              {tokenKind === "view" && <span style={{ color: "var(--dim)", fontSize: 11 }}>read-only</span>}
              <Logout onClick={doLogout}>✕ disconnect</Logout>
            </IdBar>
          )}
          {!hasSurfaces && (
            <SummaryBar>
              <Stat><StatN>{derivedAgents.length}</StatN> agents</Stat>
              {activeAgents > 0 && <Stat $color="var(--green)"><StatN>{activeAgents}</StatN> active</Stat>}
              {waitingAgents > 0 && <Stat $color="var(--yellow)"><StatN>{waitingAgents}</StatN> waiting</Stat>}
              <Stat><StatN>{stateCount}</StatN> keys / <StatN>{scopeCount}</StatN> scopes</Stat>
              <Stat><StatN>{derivedMessages.length}</StatN> msgs</Stat>
              <Stat $color="var(--green)"><StatN>{derivedActions.length}</StatN> actions</Stat>
              <Stat $color="var(--purple)"><StatN>{derivedViews.length}</StatN> views</Stat>
              {data && data.audit.length > 0 && <Stat $color="var(--orange)"><StatN>{data.audit.length}</StatN> audit</Stat>}
            </SummaryBar>
          )}
        </Headers>

        {hasSurfaces && surfaceCtx && (
          <>
            <SurfacesView surfaces={activeSurfaces} ctx={surfaceCtx} />
            {!dashConfig?.hide_debug && (
              <>
                <DebugToggle $open={debugOpen} onClick={() => setDebugOpen(o => !o)}>
                  <span style={{ fontSize: 10, display: "inline-block", transform: debugOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>▶</span>
                  {debugOpen ? "hide debug" : "debug"} · {derivedAgents.length} agents · {data?.state.length ?? 0} keys · {derivedActions.length} actions
                </DebugToggle>
                <DebugSection $open={debugOpen}>
                  <div style={{ padding: "0 1em" }}><TabsBar>{visibleTabs.map(t => { const a = activeTab === t.id; const counts: Record<string, number> = { agents: panelAgents.length, state: panelState.length, messages: panelMessages.length, actions: panelActions.length, views: panelViews.length, audit: panelAudit.length }; const c = counts[t.id] ?? null; return <Tab key={t.id} $active={a} onClick={() => setActiveTab(t.id)}>{t.label}{c !== null && <TabBadge $active={a}>{c}</TabBadge>}</Tab>; })}</TabsBar></div>
                  <Panel $active={activeTab === "agents"}><AgentsPanel agents={panelAgents} viewingId={viewingId} /></Panel>
                  <Panel $active={activeTab === "state"}><StatePanel rows={panelState} agentMap={agentMap as any} viewingId={viewingId} tokenKind={tokenKind} /></Panel>
                  <Panel $active={activeTab === "messages"}><MessagesPanel messages={panelMessages} agentMap={agentMap as any} roomId={roomId} baseUrl={BASE_URL} authHeaders={authHeaders} /></Panel>
                  <Panel $active={activeTab === "actions"}><ActionsPanel actions={panelActions} roomId={roomId} baseUrl={BASE_URL} authHeaders={authHeaders} /></Panel>
                  <Panel $active={activeTab === "views"}><ViewsPanel views={panelViews} /></Panel>
                  <Panel $active={activeTab === "audit"}><AuditPanel audit={panelAudit} agentMap={agentMap as any} /></Panel>
                  <Panel $active={activeTab === "cel"}><CelPanel roomId={roomId} baseUrl={BASE_URL} authHeaders={authHeaders} /></Panel>
                </DebugSection>
              </>
            )}
          </>
        )}

        {!hasSurfaces && (
          <>
            <div style={{ padding: "0 1em" }}><TabsBar>{visibleTabs.map(t => { const a = activeTab === t.id; const counts: Record<string, number> = { agents: panelAgents.length, state: panelState.length, messages: panelMessages.length, actions: panelActions.length, views: panelViews.length, audit: panelAudit.length }; const c = counts[t.id] ?? null; return <Tab key={t.id} $active={a} onClick={() => setActiveTab(t.id)}>{t.label}{c !== null && <TabBadge $active={a}>{c}</TabBadge>}</Tab>; })}</TabsBar></div>
            <Panel $active={activeTab === "agents"}><AgentsPanel agents={panelAgents} viewingId={viewingId} /></Panel>
            <Panel $active={activeTab === "state"}><StatePanel rows={panelState} agentMap={agentMap as any} viewingId={viewingId} tokenKind={tokenKind} /></Panel>
            <Panel $active={activeTab === "messages"}><MessagesPanel messages={panelMessages} agentMap={agentMap as any} roomId={roomId} baseUrl={BASE_URL} authHeaders={authHeaders} /></Panel>
            <Panel $active={activeTab === "actions"}><ActionsPanel actions={panelActions} roomId={roomId} baseUrl={BASE_URL} authHeaders={authHeaders} /></Panel>
            <Panel $active={activeTab === "views"}><ViewsPanel views={panelViews} /></Panel>
            <Panel $active={activeTab === "audit"}><AuditPanel audit={panelAudit} agentMap={agentMap as any} /></Panel>
            <Panel $active={activeTab === "cel"}><CelPanel roomId={roomId} baseUrl={BASE_URL} authHeaders={authHeaders} /></Panel>
          </>
        )}
      </Main>
    </Page>
  );
}
