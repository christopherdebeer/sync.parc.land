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
import type { Agent, DashboardConfig, PollData, Surface, TokenKind, View } from "../types.ts";
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

const Page = styled.div`
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.6;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  a {
    color: var(--accent);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
`;

// ── Auth gate ───────────────────────────────────────────────────────────────

const Gate = styled.div`
  padding: 15vw 1.5rem;
  text-align: center;
  font-size: 13px;
  width: 100%;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: var(--bg);
  box-sizing: border-box;
  @media (max-width: 480px) {
    padding: 20vw 1.25rem;
  }
`;
const GateTitle = styled.h2`
  color: var(--accent);
  font-size: 16px;
  margin-bottom: 0.3rem;
`;
const GateSub = styled.div`
  color: var(--dim);
  font-size: 12px;
  margin-bottom: 1.2rem;
`;
const TokenInput = styled.input`
  width: 100%;
  max-width: 20rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.6rem 0.8rem;
  color: var(--fg);
  font-family: inherit;
  font-size: 13px;
  outline: none;
  text-align: center;
  box-sizing: border-box;
  &:focus {
    border-color: var(--accent);
  }
`;
const GateError = styled.div`
  color: var(--red);
  font-size: 12px;
  margin-top: 0.5rem;
`;
const GateHint = styled.div`
  color: var(--dim);
  font-size: 11px;
  margin-top: 1rem;
`;

// ── Dashboard shell ─────────────────────────────────────────────────────────

const Main = styled.div`
  font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
  font-size: 13px;
  line-height: 1.5;
  background: var(--bg);
  color: var(--fg);
  max-width: 1100px;
  margin: 0 auto;
  min-height: 100vh;
  width: 100%;
  a {
    color: var(--accent);
    text-decoration: none;
  }
  code {
    background: var(--surface);
    padding: 0.15em 0.4em;
    border-radius: 3px;
    font-size: 0.88em;
  }
`;

const Headers = styled.div`
  position: sticky;
  top: 0;
  background-color: var(--bg);
  padding: 1em;
  z-index: 10;
  @media (max-width: 480px) {
    padding: 0.6rem 0.5rem;
  }
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.5rem;
`;

const Title = styled.h1`
  font-size: 14px;
  font-weight: 600;
  a {
    color: var(--accent);
    text-decoration: none;
  }
`;

const Subtitle = styled.div`
  color: var(--dim);
  font-size: 11px;
  word-break: break-all;
`;

const PollInfo = styled.div`
  color: var(--dim);
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const Dot = styled.span<{ $error?: boolean }>`
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${(p) => p.$error ? "var(--red)" : "var(--green)"};
`;

const IdBar = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0.6rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 0.5rem;
  font-size: 12px;
  flex-wrap: wrap;
`;

const IdLabel = styled.span`
  color: var(--dim);
`;
const IdKind = styled.span<{ $kind: TokenKind | null }>`
  font-weight: 600;
  color: ${(p) => p.$kind === "room" ? "var(--orange)" : "var(--accent)"};
`;

const IdSelect = styled.select`
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--fg);
  font-family: inherit;
  font-size: 12px;
  padding: 2px 6px;
  outline: none;
  min-width: 0;
  max-width: 100%;
  &:focus {
    border-color: var(--accent);
  }
`;

const Logout = styled.span`
  color: var(--dim);
  cursor: pointer;
  font-size: 11px;
  margin-left: auto;
  &:hover {
    color: var(--red);
  }
`;

const SummaryBar = styled.div`
  display: flex;
  gap: 1rem;
  padding: 0.4rem 0;
  font-size: 12px;
  color: var(--dim);
  flex-wrap: wrap;
  @media (max-width: 480px) {
    gap: 0.5rem 0.75rem;
    font-size: 11px;
  }
`;

const Stat = styled.div<{ $color?: string }>`
  display: flex;
  align-items: center;
  gap: 4px;
  color: ${(p) => p.$color || "var(--dim)"};
`;

const StatN = styled.span`
  color: var(--fg);
  font-weight: 600;
`;

// ── Tabs ────────────────────────────────────────────────────────────────────

const TabsBar = styled.div`
  display: flex;
  border-bottom: 1px solid var(--border);
  margin: 0.5rem 0 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;

const Tab = styled.button<{ $active: boolean }>`
  padding: 0.4rem 0.7rem;
  font-size: 12px;
  cursor: pointer;
  color: ${(p) => p.$active ? "var(--accent)" : "var(--dim)"};
  border-bottom: 2px solid ${(p) =>
    p.$active ? "var(--accent)" : "transparent"};
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  font-family: inherit;
  white-space: nowrap;
  &:hover {
    color: var(--fg);
  }
`;

const TabBadge = styled.span<{ $active: boolean }>`
  display: inline-block;
  background: ${(p) => p.$active ? "rgba(88,166,255,0.15)" : "var(--border)"};
  color: ${(p) => p.$active ? "var(--accent)" : "var(--dim)"};
  border-radius: 8px;
  padding: 0 5px;
  font-size: 10px;
  margin-left: 3px;
`;

const Panel = styled.div<{ $active: boolean }>`
  display: ${(p) => p.$active ? "block" : "none"};
  padding: 0.75rem 1em;
  @media (max-width: 480px) {
    padding: 0.5rem;
  }
`;

// ── Debug toggle ────────────────────────────────────────────────────────────

const DebugToggle = styled.button<{ $open: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 0.5rem 1rem;
  background: var(--surface);
  border: none;
  border-top: 1px solid var(--border);
  color: var(--dim);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  &:hover { color: var(--fg); }
`;

const DebugSection = styled.div<{ $open: boolean }>`
  display: ${p => p.$open ? "block" : "none"};
`;

// ── Types ────────────────────────────────────────────────────────────────────

type PollStatus = "connecting" | "live" | "error";
type TabId =
  | "agents"
  | "state"
  | "messages"
  | "actions"
  | "views"
  | "audit"
  | "cel";

const ALL_TABS: { id: TabId; label: string; countKey?: keyof PollData }[] = [
  { id: "agents", label: "Agents", countKey: "agents" },
  { id: "state", label: "State", countKey: "state" },
  { id: "messages", label: "Messages", countKey: "messages" },
  { id: "actions", label: "Actions", countKey: "actions" },
  { id: "views", label: "Views", countKey: "views" },
  { id: "audit", label: "Audit", countKey: "audit" },
  { id: "cel", label: "CEL" },
];

interface DashboardProps {
  roomId: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractDashboardConfig(state: any[]): DashboardConfig | null {
  const row = state.find(s => s.scope === "_shared" && s.key === "_dashboard");
  if (!row) return null;
  const v = typeof row.value === "string" ? (() => { try { return JSON.parse(row.value); } catch { return null; } })() : row.value;
  if (!v || typeof v !== "object") return null;
  return v as DashboardConfig;
}

/** Simple client-side CEL-like evaluator for enabled expressions.
 *  Supports: state.scope.key == value, &&, ||, !=, > , <
 *  Falls back to true (show) on any parse error. */
function makeSimpleCelEvaluator(data: PollData): (expr: string) => boolean {
  // Build lookup maps
  const stateMap: Record<string, Record<string, any>> = {};
  for (const s of data.state) {
    if (!stateMap[s.scope]) stateMap[s.scope] = {};
    let val = s.value;
    if (typeof val === "string") { try { val = JSON.parse(val); } catch {} }
    stateMap[s.scope][s.key] = val;
  }
  const viewMap: Record<string, any> = {};
  for (const v of data.views) {
    viewMap[v.id] = v.value;
  }

  function evalAtom(clause: string): boolean {
    const c = clause.trim();
    if (c === "true") return true;
    if (c === "false") return false;

    // state.scope.key OP value
    const m = c.match(/^state\.([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*(==|!=|>=?|<=?)\s*(.+)$/);
    if (m) {
      const [, scope, key, op, rawVal] = m;
      const actual = stateMap[scope]?.[key];
      let expected: any = rawVal.trim();
      if ((expected.startsWith('"') && expected.endsWith('"')) || (expected.startsWith("'") && expected.endsWith("'"))) {
        expected = expected.slice(1, -1);
      } else if (expected === "true") expected = true;
      else if (expected === "false") expected = false;
      else if (expected === "null") expected = null;
      else if (!isNaN(Number(expected))) expected = Number(expected);

      if (op === "==") {
        // Treat undefined/missing keys as falsy: undefined == false → true, undefined == true → false
        if (actual === undefined || actual === null) {
          if (expected === false || expected === null || expected === 0 || expected === "") return true;
          return false;
        }
        return actual == expected;
      }
      if (op === "!=") {
        if (actual === undefined || actual === null) {
          if (expected === false || expected === null || expected === 0 || expected === "") return false;
          return true;
        }
        return actual != expected;
      }
      if (op === ">") return actual > expected;
      if (op === "<") return actual < expected;
      if (op === ">=") return actual >= expected;
      if (op === "<=") return actual <= expected;
    }

    // views["id"] OP value
    const mv = c.match(/^views\["?([^"]+)"?\]\s*(==|!=)\s*(.+)$/);
    if (mv) {
      const [, id, op, rawVal] = mv;
      const actual = viewMap[id];
      let expected: any = rawVal.trim();
      if ((expected.startsWith('"') && expected.endsWith('"')) || (expected.startsWith("'") && expected.endsWith("'"))) {
        expected = expected.slice(1, -1);
      }
      if (op === "==") return actual == expected;
      if (op === "!=") return actual != expected;
    }

    // Fallback: hide (fail closed)
    return false;
  }

  return (expr: string): boolean => {
    try {
      // Strip outer parens for simple cases
      let e = expr.trim();

      // Split on || first (lower precedence), then && within each group
      const orGroups = e.split(/\s*\|\|\s*/);
      for (const group of orGroups) {
        const andClauses = group.split(/\s*&&\s*/);
        // Strip parens from individual clauses
        const allTrue = andClauses.every(c => {
          const cleaned = c.replace(/^\(+/, '').replace(/\)+$/, '').trim();
          return evalAtom(cleaned);
        });
        if (allTrue) return true; // Any OR group passing is enough
      }
      return false;
    } catch {
      return false; // fail closed: unknown condition → hide
    }
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function Dashboard({ roomId }: DashboardProps) {
  const [token, setToken] = useState<string | null>(null);
  const [tokenKind, setTokenKind] = useState<TokenKind | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [data, setData] = useState<PollData | null>(null);
  const [pollStatus, setPollStatus] = useState<PollStatus>("connecting");
  const [activeTab, setActiveTab] = useState<TabId>("agents");
  const [viewAs, setViewAs] = useState("");
  const [tabInitialized, setTabInitialized] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const authHeaders = useCallback((): Record<string, string> => ({
    "Authorization": `Bearer ${token}`,
  }), [token]);

  const agentMap = useMemo<Record<string, Agent>>(() => {
    const m: Record<string, Agent> = {};
    for (const a of data?.agents || []) m[a.id] = a;
    return m;
  }, [data?.agents]);

  // Extract _dashboard config from state
  const dashConfig = useMemo<DashboardConfig | null>(() => {
    if (!data) return null;
    return extractDashboardConfig(data.state);
  }, [data?.state]);

  // Does this room have surfaces?
  const hasSurfaces = Boolean(dashConfig?.surfaces?.length);

  // Resolve visible tabs
  const visibleTabs = useMemo(() => {
    if (!dashConfig?.tabs) return ALL_TABS;
    const allowed = new Set(dashConfig.tabs);
    return ALL_TABS.filter(t => allowed.has(t.id));
  }, [dashConfig?.tabs]);

  // Set default tab from config on first data load
  useEffect(() => {
    if (tabInitialized || !dashConfig?.default_tab) return;
    const dt = dashConfig.default_tab as TabId;
    if (ALL_TABS.some(t => t.id === dt)) {
      setActiveTab(dt);
    }
    setTabInitialized(true);
  }, [dashConfig, tabInitialized]);

  // CEL evaluator for surface enabled expressions
  const evalCel = useMemo(() => {
    if (!data) return () => true;
    return makeSimpleCelEvaluator(data);
  }, [data]);

  // Surface context
  const surfaceCtx = useMemo<SurfaceContext | null>(() => {
    if (!data || !token) return null;
    return {
      data,
      agentMap,
      roomId,
      baseUrl: BASE_URL,
      authHeaders: () => ({ "Authorization": `Bearer ${token}` }),
      evalCel,
    };
  }, [data, agentMap, roomId, token, evalCel]);

  const doPoll = useCallback(async (tok: string) => {
    try {
      const r = await fetch(`${BASE_URL}/rooms/${roomId}/poll`, {
        headers: { "Authorization": `Bearer ${tok}` },
      });
      if (r.status === 401) return null;
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.json() as PollData;
    } catch {
      return undefined;
    }
  }, [roomId]);

  const startPolling = useCallback((tok: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const poll = async () => {
      const d = await doPoll(tok);
      if (d === null) {
        sessionStorage.removeItem(STORAGE_KEY(roomId));
        setToken(null);
        setTokenKind(null);
        setPollStatus("error");
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }
      if (d === undefined) {
        setPollStatus("error");
        return;
      }
      setData(d);
      setPollStatus("live");
    };
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [doPoll, roomId]);

  const tryAuth = useCallback(async () => {
    const tok = tokenInput.trim();
    if (!tok) return;
    setAuthError("");
    const d = await doPoll(tok);
    if (d === null) {
      setAuthError("Invalid token for this room.");
      return;
    }
    if (d === undefined) {
      setAuthError("Connection failed.");
      return;
    }
    sessionStorage.setItem(STORAGE_KEY(roomId), tok);
    const kind: TokenKind = tok.startsWith("room_") ? "room" : "agent";
    setToken(tok);
    setTokenKind(kind);
    setData(d);
    setPollStatus("live");
    startPolling(tok);
  }, [tokenInput, doPoll, roomId, startPolling]);

  useEffect(() => {
    const hash = location.hash;
    let stored: string | null = null;
    if (hash.includes("token=")) {
      stored = new URLSearchParams(hash.slice(1)).get("token");
      if (stored) {
        history.replaceState(null, "", location.pathname + location.search);
        sessionStorage.setItem(STORAGE_KEY(roomId), stored);
      }
    }
    if (!stored) stored = sessionStorage.getItem(STORAGE_KEY(roomId));
    if (!stored) return;

    (async () => {
      const d = await doPoll(stored!);
      if (!d) return;
      const kind: TokenKind = stored!.startsWith("room_") ? "room" : "agent";
      setToken(stored!);
      setTokenKind(kind);
      setData(d);
      setPollStatus("live");
      startPolling(stored!);
    })();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [roomId]);

  const doLogout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY(roomId));
    if (pollRef.current) clearInterval(pollRef.current);
    setToken(null);
    setTokenKind(null);
    setData(null);
    setPollStatus("connecting");
    setTokenInput("");
    setTabInitialized(false);
  }, [roomId]);

  if (!token) {
    return (
      <Gate>
        <GateTitle>agent-sync</GateTitle>
        <GateSub>{roomId}</GateSub>
        <TokenInput
          type="text"
          placeholder="paste room or agent token"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && tryAuth()}
          autoComplete="off"
          spellCheck={false}
        />
        {authError && <GateError>{authError}</GateError>}
        <GateHint>
          Token stored in sessionStorage and sent via Authorization header
          only.<br />
          Never leaves the browser in the URL.
        </GateHint>
      </Gate>
    );
  }

  const agents = data?.agents || [];
  const state = data?.state || [];
  const messages = data?.messages || [];
  const actions = data?.actions || [];
  const views = data?.views || [];
  const audit = data?.audit || [];

  const activeAgents = agents.filter((a) => a.status === "active").length;
  const waitingAgents = agents.filter((a) => a.status === "waiting").length;
  const scopeCount = new Set(state.map((s) => s.scope)).size;
  const viewingId = viewAs || undefined;

  const titleText = dashConfig?.title || "agent-sync";
  const subtitleText = dashConfig?.subtitle || roomId;

  return (
    <Page>
      <Nav active="dashboard" />
      <Main>
        <Headers>
          <HeaderRow>
            <div>
              <Title>
                <a href="/">{titleText}</a>
                {!dashConfig?.title && (
                  <span style={{ color: "var(--dim)", fontWeight: 400 }}> v6</span>
                )}
              </Title>
              <Subtitle>{subtitleText}</Subtitle>
            </div>
            <PollInfo>
              <Dot $error={pollStatus === "error"} />
              {pollStatus === "live"
                ? "live"
                : pollStatus === "error"
                ? "error"
                : "connecting…"}
            </PollInfo>
          </HeaderRow>

          {/* Identity bar — only shown when no surfaces (debug mode) or always minimal */}
          {(!hasSurfaces || debugOpen) && (
            <IdBar>
              <IdLabel>identity:</IdLabel>
              <IdKind $kind={tokenKind}>
                {tokenKind === "room" ? "room admin" : "agent"}
              </IdKind>
              {tokenKind === "room" && (
                <IdSelect
                  value={viewAs}
                  onChange={(e) => setViewAs(e.target.value)}
                >
                  <option value="">admin (all scopes)</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      view as: {a.name || a.id}
                    </option>
                  ))}
                </IdSelect>
              )}
              <Logout onClick={doLogout}>✕ disconnect</Logout>
            </IdBar>
          )}

          {/* Summary bar — compact version for surface mode */}
          {!hasSurfaces && (
            <SummaryBar>
              <Stat>
                <StatN>{agents.length}</StatN> agents
              </Stat>
              {activeAgents > 0 && (
                <Stat $color="var(--green)">
                  <StatN>{activeAgents}</StatN> active
                </Stat>
              )}
              {waitingAgents > 0 && (
                <Stat $color="var(--yellow)">
                  <StatN>{waitingAgents}</StatN> waiting
                </Stat>
              )}
              <Stat>
                <StatN>{state.length}</StatN> keys / <StatN>{scopeCount}</StatN>
                {" "}
                scopes
              </Stat>
              <Stat>
                <StatN>{messages.length}</StatN> msgs
              </Stat>
              <Stat $color="var(--green)">
                <StatN>{actions.length}</StatN> actions
              </Stat>
              <Stat $color="var(--purple)">
                <StatN>{views.length}</StatN> views
              </Stat>
              {audit.length > 0 && (
                <Stat $color="var(--orange)">
                  <StatN>{audit.length}</StatN> audit
                </Stat>
              )}
            </SummaryBar>
          )}
        </Headers>

        {/* ── Surface mode ─────────────────────────────────────────────── */}
        {hasSurfaces && surfaceCtx && (
          <>
            <SurfacesView surfaces={dashConfig!.surfaces!} ctx={surfaceCtx} />

            {/* Debug panel (collapsible tabs underneath) */}
            {!dashConfig?.hide_debug && (
              <>
                <DebugToggle $open={debugOpen} onClick={() => setDebugOpen(o => !o)}>
                  <span style={{ fontSize: 10, display: "inline-block", transform: debugOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>▶</span>
                  {debugOpen ? "hide debug" : "debug"} · {agents.length} agents · {state.length} keys · {actions.length} actions
                </DebugToggle>
                <DebugSection $open={debugOpen}>
                  <div style={{ padding: "0 1em" }}>
                    <TabsBar>
                      {visibleTabs.map((t) => {
                        const active = activeTab === t.id;
                        const count = t.countKey
                          ? (data?.[t.countKey] as any[])?.length ?? 0
                          : null;
                        return (
                          <Tab
                            key={t.id}
                            $active={active}
                            onClick={() => setActiveTab(t.id)}
                          >
                            {t.label}
                            {count !== null && (
                              <TabBadge $active={active}>{count}</TabBadge>
                            )}
                          </Tab>
                        );
                      })}
                    </TabsBar>
                  </div>
                  <Panel $active={activeTab === "agents"}>
                    <AgentsPanel agents={agents} viewingId={viewingId} />
                  </Panel>
                  <Panel $active={activeTab === "state"}>
                    <StatePanel rows={state} agentMap={agentMap} viewingId={viewingId} tokenKind={tokenKind} />
                  </Panel>
                  <Panel $active={activeTab === "messages"}>
                    <MessagesPanel messages={messages} agentMap={agentMap} roomId={roomId} baseUrl={BASE_URL} authHeaders={authHeaders} />
                  </Panel>
                  <Panel $active={activeTab === "actions"}>
                    <ActionsPanel actions={actions} roomId={roomId} baseUrl={BASE_URL} authHeaders={authHeaders} />
                  </Panel>
                  <Panel $active={activeTab === "views"}>
                    <ViewsPanel views={views} />
                  </Panel>
                  <Panel $active={activeTab === "audit"}>
                    <AuditPanel audit={audit} agentMap={agentMap} />
                  </Panel>
                  <Panel $active={activeTab === "cel"}>
                    <CelPanel roomId={roomId} baseUrl={BASE_URL} authHeaders={authHeaders} />
                  </Panel>
                </DebugSection>
              </>
            )}
          </>
        )}

        {/* ── Classic tab mode (no surfaces) ───────────────────────────── */}
        {!hasSurfaces && (
          <>
            <div style={{ padding: "0 1em" }}>
              <TabsBar>
                {visibleTabs.map((t) => {
                  const active = activeTab === t.id;
                  const count = t.countKey
                    ? (data?.[t.countKey] as any[])?.length ?? 0
                    : null;
                  return (
                    <Tab
                      key={t.id}
                      $active={active}
                      onClick={() => setActiveTab(t.id)}
                    >
                      {t.label}
                      {count !== null && (
                        <TabBadge $active={active}>{count}</TabBadge>
                      )}
                    </Tab>
                  );
                })}
              </TabsBar>
            </div>

            <Panel $active={activeTab === "agents"}>
              <AgentsPanel agents={agents} viewingId={viewingId} />
            </Panel>
            <Panel $active={activeTab === "state"}>
              <StatePanel
                rows={state}
                agentMap={agentMap}
                viewingId={viewingId}
                tokenKind={tokenKind}
              />
            </Panel>
            <Panel $active={activeTab === "messages"}>
              <MessagesPanel
                messages={messages}
                agentMap={agentMap}
                roomId={roomId}
                baseUrl={BASE_URL}
                authHeaders={authHeaders}
              />
            </Panel>
            <Panel $active={activeTab === "actions"}>
              <ActionsPanel
                actions={actions}
                roomId={roomId}
                baseUrl={BASE_URL}
                authHeaders={authHeaders}
              />
            </Panel>
            <Panel $active={activeTab === "views"}>
              <ViewsPanel views={views} />
            </Panel>
            <Panel $active={activeTab === "audit"}>
              <AuditPanel audit={audit} agentMap={agentMap} />
            </Panel>
            <Panel $active={activeTab === "cel"}>
              <CelPanel
                roomId={roomId}
                baseUrl={BASE_URL}
                authHeaders={authHeaders}
              />
            </Panel>
          </>
        )}
      </Main>
    </Page>
  );
}
