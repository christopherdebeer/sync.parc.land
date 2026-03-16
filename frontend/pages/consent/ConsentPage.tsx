/** @jsxImportSource https://esm.sh/react@18.2.0 */
/**
 * ConsentPage — Unified scope consent for all auth flows.
 *
 * Three modes, one component:
 *   - elevate:  Agent requests room access → passkey auth → scope editor
 *   - device:   Post-passkey device auth → scope editor → approve device code
 *   - oauth:    Post-passkey OAuth → scope editor → issue auth code
 *
 * After passkey auth, loads user's rooms + current token scope (if elevate),
 * shows a full scope editor, then applies changes via mode-specific backend.
 */
import { useState, useMemo, useCallback } from "https://esm.sh/react@18.2.0";
import { styled } from "../../styled.ts";
import {
  PageWrapper, Container, Card, Title, TitleDim, Subtitle,
  PrimaryButton, SecondaryButton, StatusText, ErrorText,
} from "../../components/mcp.tsx";

// ─── Props ───────────────────────────────────────────────────────

export interface ConsentPageProps {
  origin: string;
  mode: "elevate" | "device" | "oauth";
  // Elevate
  tokenId?: string;
  addRoom?: string;
  addLevel?: string;
  // Device (pre-authenticated)
  sessionId?: string;
  deviceCode?: string;
  requestedScope?: string;
  // OAuth (pre-authenticated)
  clientId?: string;
  clientName?: string;
  redirectUri?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  oauthScope?: string;
  oauthState?: string;
  resource?: string;
}

// ─── Styled ──────────────────────────────────────────────────────

const WideContainer = styled.div`
  width: 100%; max-width: 520px; padding: 1rem;
`;

const TokenInfo = styled.div`
  font-size: 0.8rem; color: var(--dim); margin-bottom: 1rem;
  padding: 0.5rem 0.75rem; background: var(--bg); border: 1px solid var(--border);
  border-radius: 8px;
  strong { color: var(--fg); }
`;

const ScopeText = styled.div`
  font-size: 0.72rem; color: var(--dim); font-family: "SF Mono","Fira Code",monospace;
  word-break: break-all; margin-top: 0.25rem;
`;

const Toolbar = styled.div`margin-bottom: 0.75rem;`;

const SearchInput = styled.input`
  width: 100%; padding: 0.55rem 0.75rem; background: var(--bg);
  border: 1px solid var(--border); border-radius: 6px; color: var(--fg);
  font-size: 0.85rem; font-family: inherit; margin-bottom: 0.5rem;
  &:focus { outline: none; border-color: var(--accent); }
  &::placeholder { color: var(--dim); }
`;

const BulkActions = styled.div`display: flex; gap: 0.35rem; flex-wrap: wrap;`;

const Pill = styled.button`
  padding: 0.25rem 0.65rem; border: 1px solid var(--border); border-radius: 99px;
  background: transparent; color: var(--dim); font-size: 0.75rem; font-family: inherit;
  cursor: pointer; &:hover { border-color: var(--accent); color: var(--fg); }
`;

const RoomCount = styled.div`font-size: 0.75rem; color: var(--dim); margin-bottom: 0.4rem;`;

const RoomList = styled.div`max-height: 350px; overflow-y: auto; margin-bottom: 0.75rem;`;

const RoomRow = styled.div<{ $selected?: boolean; $isNew?: boolean }>`
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.55rem 0.8rem; border-radius: 8px; margin-bottom: 0.35rem;
  cursor: pointer; transition: all 0.15s;
  border: 1px solid ${({ $selected, $isNew }) =>
    $isNew ? "var(--green)" : $selected ? "var(--accent)" : "var(--border)"};
  background: ${({ $selected, $isNew }) =>
    $isNew ? "rgba(63,185,80,0.08)" : $selected ? "rgba(88,166,255,0.08)" : "transparent"};
  &:hover { border-color: var(--accent); }
`;

const RoomCheck = styled.input`accent-color: var(--accent); width: 1rem; height: 1rem; flex-shrink: 0;`;

const RoomInfo = styled.div`flex: 1; min-width: 0;`;
const RoomName = styled.span`font-weight: 600; font-size: 0.88rem; color: var(--fg);`;
const RoomMeta = styled.span`font-size: 0.72rem; color: var(--dim); margin-left: 0.5rem;`;
const RoomDetail = styled.div`font-size: 0.72rem; color: var(--dim); margin-top: 0.12rem;`;

const NewBadge = styled.span`
  font-size: 0.65rem; font-weight: 600; color: var(--green);
  background: rgba(63,185,80,0.1); border: 1px solid var(--green);
  border-radius: 4px; padding: 0.05rem 0.3rem; margin-left: 0.4rem;
`;

const ScopeSelect = styled.select`
  padding: 0.3rem 0.5rem; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface); color: var(--fg); font-size: 0.8rem;
  font-family: inherit; flex-shrink: 0;
`;

const ExpandLink = styled.div`
  font-size: 0.72rem; color: var(--accent); cursor: pointer;
  padding: 0.15rem 0; margin-top: 0.2rem;
  &:hover { text-decoration: underline; }
`;

const AgentList = styled.div`
  margin: 0.35rem 0 0 1.75rem; border-top: 1px solid var(--border);
  padding-top: 0.35rem;
`;

const AgentRow = styled.div`
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.25rem 0; font-size: 0.78rem;
`;

const AgentName = styled.span`color: var(--fg); font-weight: 500;`;
const AgentMeta = styled.span`color: var(--dim); font-size: 0.72rem;`;

const AgentSelect = styled.select`
  padding: 0.15rem 0.35rem; border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg); color: var(--fg); font-size: 0.75rem; font-family: inherit;
`;

const OptionRow = styled.label`
  display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0;
  font-size: 0.85rem; color: var(--fg); cursor: pointer;
  input { accent-color: var(--accent); }
`;

const Hint = styled.p`font-size: 0.75rem; color: var(--dim); margin-top: 0.5rem; line-height: 1.45;`;

const ButtonRow = styled.div`
  display: flex; gap: 0.75rem; margin-top: 1rem; justify-content: flex-end;
`;

const SuccessIcon = styled.div`
  text-align: center; padding: 1rem 0; color: var(--green);
  .icon { font-size: 3rem; margin-bottom: 0.5rem; }
`;

const ErrorIcon = styled.div`
  text-align: center; padding: 1rem 0; color: var(--red);
  .icon { font-size: 3rem; margin-bottom: 0.5rem; }
`;

const ClientBadge = styled.div`
  font-size: 0.85rem; color: var(--dim); margin-bottom: 1rem;
  padding: 0.5rem 0.75rem; background: var(--bg); border: 1px solid var(--border);
  border-radius: 8px;
  strong { color: var(--fg); }
`;

// ─── Types ───────────────────────────────────────────────────────

interface RoomData {
  room_id: string; access: string; label: string | null;
  agents: Array<{ id: string; name: string; role: string; status: string }>;
}

interface RoomSelection {
  selected: boolean;
  level: "full" | "write" | "read";
  isNew: boolean;
  expanded: boolean;
  agentScope: Record<string, string> | null;
}

type Step = "auth" | "loading" | "consent" | "success" | "error";

// ─── Component ───────────────────────────────────────────────────

export function ConsentPage(props: ConsentPageProps) {
  const { origin, mode } = props;
  const needsAuth = mode === "elevate"; // device + oauth arrive pre-authenticated

  const [step, setStep] = useState<Step>(needsAuth ? "auth" : "loading");
  const [status, setStatus] = useState(needsAuth ? "" : "Loading rooms...");
  const [error, setError] = useState("");
  const [sessionId, setSid] = useState(props.sessionId ?? "");
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [selections, setSelections] = useState<Record<string, RoomSelection>>({});
  const [canCreate, setCanCreate] = useState(true);
  const [search, setSearch] = useState("");
  const [currentScopeParts, setCurrentScopeParts] = useState<Set<string>>(new Set());
  const [tokenLabel, setTokenLabel] = useState<string | null>(null);
  const [tokenScope, setTokenScope] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  // ── Title text ──
  const titleSuffix = mode === "elevate" ? "scope" : mode === "device" ? "device" : "authorize";
  const subtitleText = mode === "elevate" && props.addRoom
    ? <>An agent is requesting access to <strong>{props.addRoom}</strong>.</>
    : mode === "device"
    ? "Choose what access to grant this device."
    : mode === "oauth"
    ? <>Grant <strong>{props.clientName || "MCP Client"}</strong> access?</>
    : "Review and edit token scope.";

  // ── Load rooms after auth ──
  const loadRooms = useCallback(async (sid: string) => {
    try {
      const url = `${origin}/auth/consent/rooms?session_id=${encodeURIComponent(sid)}`
        + (props.tokenId ? `&token_id=${encodeURIComponent(props.tokenId)}` : "");
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load rooms");
      const data = await res.json();
      if (data.error) throw new Error(data.message || data.error);

      const roomList: RoomData[] = data.rooms || [];
      setRooms(roomList);
      setTokenLabel(data.token_label);
      setTokenScope(data.token_scope);

      // Parse current scope to set initial selections
      const scopeStr = data.token_scope || props.requestedScope || props.oauthScope || "";
      const parts = scopeStr.split(/\s+/).filter(Boolean);
      const partSet = new Set(parts);
      setCurrentScopeParts(partSet);
      setCanCreate(parts.includes("create_rooms") || mode !== "elevate");

      const hasWildcard = parts.some((p: string) => p === "rooms:*" || p.startsWith("rooms:*:"));
      const init: Record<string, RoomSelection> = {};

      for (const r of roomList) {
        let inScope = hasWildcard;
        let level: "full" | "write" | "read" = hasWildcard ? "full" : "full";
        for (const p of parts) {
          if (p === `rooms:${r.room_id}`) { inScope = true; level = "full"; }
          else if (p === `rooms:${r.room_id}:write`) { inScope = true; level = "write"; }
          else if (p === `rooms:${r.room_id}:read`) { inScope = true; level = "read"; }
          else if (p.startsWith(`rooms:${r.room_id}:agent:`)) { inScope = true; level = "full"; }
        }
        const isRequested = r.room_id === props.addRoom;
        init[r.room_id] = {
          selected: mode === "elevate" ? (inScope || isRequested) : (hasWildcard || inScope || mode !== "oauth"),
          level: isRequested && !inScope ? (props.addLevel as any || "full") : (inScope ? level : "full"),
          isNew: isRequested && !inScope,
          expanded: false,
          agentScope: null,
        };
      }
      setSelections(init);
      setStep("consent");
      setStatus("");
    } catch (e: any) {
      setError(e.message || "Failed to load rooms");
      setStep("error");
    }
  }, [origin, props.tokenId, props.addRoom, props.addLevel, props.requestedScope, props.oauthScope, mode]);

  // ── Auto-load for pre-authenticated modes ──
  useState(() => {
    if (!needsAuth && sessionId) {
      loadRooms(sessionId);
    }
  });

  // ── Passkey auth (elevate mode only) ──
  async function doPasskeyAuth() {
    setError(""); setStatus("Generating options...");
    try {
      const { startAuthentication } = await import("https://esm.sh/@simplewebauthn/browser@13");
      const optRes = await fetch(`${origin}/webauthn/authenticate/options`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error);
      setStatus("Touch your authenticator...");
      const assertResp = await startAuthentication({ optionsJSON: optData.options });
      setStatus("Verifying...");
      const verRes = await fetch(`${origin}/webauthn/authenticate/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: optData.challengeId, response: assertResp }),
      });
      const verData = await verRes.json();
      if (!verRes.ok || !verData.verified) throw new Error(verData.error || "Verification failed");
      setSid(verData.sessionId);
      setStep("loading"); setStatus("Loading rooms...");
      await loadRooms(verData.sessionId);
    } catch (e: any) { setError(e.message); setStatus(""); }
  }

  // ── Filtering ──
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return rooms;
    return rooms.filter(r =>
      r.room_id.toLowerCase().includes(q) ||
      (r.label || "").toLowerCase().includes(q) ||
      r.agents.some(a => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
    );
  }, [rooms, search]);

  const selectedCount = Object.values(selections).filter(s => s.selected).length;
  const newCount = Object.values(selections).filter(s => s.selected && s.isNew).length;
  const withAgentsCount = rooms.filter(r => r.agents.length > 0).length;

  // ── Selection helpers ──
  function toggle(roomId: string) {
    setSelections(s => ({ ...s, [roomId]: { ...s[roomId], selected: !s[roomId]?.selected } }));
  }
  function setLevel(roomId: string, level: "full" | "write" | "read") {
    setSelections(s => ({ ...s, [roomId]: { ...s[roomId], level } }));
  }
  function toggleExpand(roomId: string) {
    setSelections(s => ({ ...s, [roomId]: { ...s[roomId], expanded: !s[roomId]?.expanded } }));
  }
  function setAgentBinding(roomId: string, agentId: string, value: string) {
    setSelections(s => {
      const curr = s[roomId];
      const agentScope = { ...(curr.agentScope || {}) };
      if (value === "agent") agentScope[agentId] = "agent";
      else delete agentScope[agentId];
      return { ...s, [roomId]: { ...curr, agentScope: Object.keys(agentScope).length ? agentScope : null } };
    });
  }
  function selectAll() {
    setSelections(s => {
      const n = { ...s };
      for (const r of filtered) if (n[r.room_id]) n[r.room_id] = { ...n[r.room_id], selected: true };
      return n;
    });
  }
  function selectNone() {
    setSelections(s => {
      const n = { ...s };
      for (const r of filtered) if (n[r.room_id]) n[r.room_id] = { ...n[r.room_id], selected: false };
      return n;
    });
  }
  function selectWithAgents() {
    setSelections(s => {
      const n = { ...s };
      for (const r of rooms) if (n[r.room_id]) n[r.room_id] = { ...n[r.room_id], selected: r.agents.length > 0 };
      return n;
    });
    setSearch("");
  }
  function selectCurrent() {
    setSelections(s => {
      const n = { ...s };
      for (const [rid, sel] of Object.entries(n)) {
        const inOld = !sel.isNew && (
          currentScopeParts.has(`rooms:${rid}`) ||
          currentScopeParts.has(`rooms:${rid}:read`) ||
          currentScopeParts.has(`rooms:${rid}:write`) ||
          currentScopeParts.has("rooms:*")
        );
        n[rid] = { ...sel, selected: inOld };
      }
      return n;
    });
  }

  // ── Build scope string ──
  function buildScope(): string {
    const parts: string[] = [];
    for (const [roomId, sel] of Object.entries(selections)) {
      if (!sel.selected) continue;
      const agentBindings = sel.agentScope ? Object.entries(sel.agentScope).filter(([, v]) => v === "agent") : [];
      if (agentBindings.length > 0) {
        for (const [agentId] of agentBindings) parts.push(`rooms:${roomId}:agent:${agentId}`);
      } else if (sel.level === "read") parts.push(`rooms:${roomId}:read`);
      else if (sel.level === "write") parts.push(`rooms:${roomId}:write`);
      else parts.push(`rooms:${roomId}`);
    }
    if (canCreate) parts.push("create_rooms");
    if (parts.length === 0 || (parts.length === 1 && parts[0] === "create_rooms")) {
      parts.unshift("rooms:*");
    }
    return parts.join(" ");
  }

  // ── Approve ──
  async function approve() {
    setError("");
    try {
      const scope = buildScope();

      if (mode === "elevate") {
        const res = await fetch(`${origin}/auth/consent/approve`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "elevate", session_id: sessionId, token_id: props.tokenId, new_scope: scope }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.message || data.error);
        setSuccessMsg(newCount > 0
          ? `Access granted. Return to your conversation — the agent can retry.`
          : "Token scope updated.");
        setStep("success");
      } else if (mode === "device") {
        const res = await fetch(`${origin}/auth/consent/approve`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "device", session_id: sessionId, device_code: props.deviceCode, new_scope: scope }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.message || data.error);
        setSuccessMsg("Device authorized. You can close this tab and return to your terminal.");
        setStep("success");
      } else if (mode === "oauth") {
        const res = await fetch(`${origin}/auth/consent/approve`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "oauth", session_id: sessionId, new_scope: scope,
            client_id: props.clientId, redirect_uri: props.redirectUri,
            code_challenge: props.codeChallenge, code_challenge_method: props.codeChallengeMethod,
            state: props.oauthState, resource: props.resource,
          }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.message || data.error);
        if (data.redirect) { window.location.href = data.redirect; return; }
        setSuccessMsg("Authorization complete.");
        setStep("success");
      }
    } catch (e: any) { setError(e.message || "Failed"); setStep("error"); }
  }

  function deny() {
    if (mode === "device" && props.deviceCode) {
      fetch(`${origin}/auth/device/deny`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: props.deviceCode }),
      }).catch(() => {});
    }
    if (mode === "oauth" && props.redirectUri) {
      const redirect = new URL(props.redirectUri);
      redirect.searchParams.set("error", "access_denied");
      if (props.oauthState) redirect.searchParams.set("state", props.oauthState);
      window.location.href = redirect.toString();
      return;
    }
    setSuccessMsg("Access denied.");
    setStep("success");
  }

  // ─── Render ────────────────────────────────────────────────────

  return (
    <PageWrapper>
      <WideContainer>
        {/* Auth step (elevate only) */}
        {step === "auth" && (
          <Card>
            <Title>sync<TitleDim>·{titleSuffix}</TitleDim></Title>
            <Subtitle>{subtitleText}</Subtitle>
            <PrimaryButton onClick={doPasskeyAuth}>Authenticate with passkey</PrimaryButton>
            <SecondaryButton onClick={() => window.close()} style={{ width: "100%", marginTop: "0.5rem" }}>Cancel</SecondaryButton>
            {status && <StatusText>{status}</StatusText>}
            {error && <ErrorText>{error}</ErrorText>}
          </Card>
        )}

        {/* Loading */}
        {step === "loading" && (
          <Card style={{ textAlign: "center" }}>
            <StatusText>{status || "Loading..."}</StatusText>
          </Card>
        )}

        {/* Consent editor */}
        {step === "consent" && (
          <Card>
            <Title>sync<TitleDim>·{titleSuffix}</TitleDim></Title>
            <Subtitle>{subtitleText}</Subtitle>

            {/* Context info */}
            {mode === "elevate" && tokenScope !== null && (
              <TokenInfo>
                <strong>{tokenLabel || "Token"}</strong>{" "}
                <span style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--dim)" }}>
                  {props.tokenId?.substring(0, 12)}...
                </span>
                <ScopeText>Current: {tokenScope || "(empty)"}</ScopeText>
              </TokenInfo>
            )}
            {mode === "oauth" && props.clientName && (
              <ClientBadge><strong>{props.clientName}</strong></ClientBadge>
            )}
            {mode === "device" && props.requestedScope && (
              <ClientBadge>Requested: <strong>{props.requestedScope}</strong></ClientBadge>
            )}

            {/* Toolbar */}
            <Toolbar>
              <SearchInput placeholder="Search rooms, agents..." value={search}
                onChange={e => setSearch(e.target.value)} />
              <BulkActions>
                <Pill onClick={selectAll}>All</Pill>
                <Pill onClick={selectNone}>None</Pill>
                {withAgentsCount > 0 && <Pill onClick={selectWithAgents}>With agents</Pill>}
                {mode === "elevate" && <Pill onClick={selectCurrent}>Current only</Pill>}
              </BulkActions>
            </Toolbar>

            <RoomCount>
              {filtered.length} of {rooms.length} rooms · {selectedCount} selected
              {newCount > 0 && ` (${newCount} new)`}
            </RoomCount>

            {/* Room list */}
            <RoomList>
              {filtered.length === 0 ? (
                <div style={{ padding: "0.75rem", textAlign: "center", color: "var(--dim)", fontSize: "0.85rem",
                  border: "1px dashed var(--border)", borderRadius: "8px" }}>
                  {rooms.length === 0 ? "No rooms yet." : "No rooms match your search."}
                </div>
              ) : filtered.map(r => {
                const sel = selections[r.room_id];
                if (!sel) return null;
                const agentCount = r.agents.length;
                return (
                  <div key={r.room_id}>
                    <RoomRow $selected={sel.selected} $isNew={sel.selected && sel.isNew}
                      onClick={() => toggle(r.room_id)}>
                      <RoomCheck type="checkbox" checked={sel.selected}
                        onChange={() => toggle(r.room_id)} onClick={e => e.stopPropagation()} />
                      <RoomInfo>
                        <RoomName>{r.label || r.room_id}</RoomName>
                        {r.label && r.label !== r.room_id && <RoomMeta>{r.room_id}</RoomMeta>}
                        <RoomMeta>[{r.access}]</RoomMeta>
                        {sel.isNew && <NewBadge>requested</NewBadge>}
                        <RoomDetail>
                          {agentCount > 0 && `${agentCount} agent${agentCount > 1 ? "s" : ""}`}
                        </RoomDetail>
                        {sel.selected && agentCount > 0 && (
                          <ExpandLink onClick={e => { e.stopPropagation(); toggleExpand(r.room_id); }}>
                            {sel.expanded ? "▾ hide agents" : "▸ refine per agent"}
                          </ExpandLink>
                        )}
                      </RoomInfo>
                      {sel.selected && (
                        <ScopeSelect value={sel.level} onClick={e => e.stopPropagation()}
                          onChange={e => { e.stopPropagation(); setLevel(r.room_id, e.target.value as any); }}>
                          <option value="full">Full</option>
                          <option value="write">Write</option>
                          <option value="read">Read</option>
                        </ScopeSelect>
                      )}
                    </RoomRow>
                    {sel.selected && sel.expanded && agentCount > 0 && (
                      <AgentList>
                        {r.agents.map(a => (
                          <AgentRow key={a.id}>
                            <AgentName>{a.name || a.id}</AgentName>
                            <AgentMeta>{a.role}</AgentMeta>
                            <AgentSelect onClick={e => e.stopPropagation()}
                              onChange={e => setAgentBinding(r.room_id, a.id, e.target.value)}
                              value={sel.agentScope?.[a.id] || ""}>
                              <option value="">Room level</option>
                              <option value="agent">Bound to agent</option>
                            </AgentSelect>
                          </AgentRow>
                        ))}
                      </AgentList>
                    )}
                  </div>
                );
              })}
            </RoomList>

            <OptionRow>
              <input type="checkbox" checked={canCreate} onChange={e => setCanCreate(e.target.checked)} />
              Allow creating new rooms
            </OptionRow>

            <Hint>
              {selectedCount > 0
                ? `${selectedCount} room${selectedCount > 1 ? "s" : ""} selected.`
                : "No rooms selected. Only room creation will be allowed."}
              {newCount > 0 && ` ${newCount} new (highlighted in green).`}
            </Hint>

            {error && <ErrorText>{error}</ErrorText>}

            <ButtonRow>
              <SecondaryButton onClick={deny}>Deny</SecondaryButton>
              <PrimaryButton onClick={approve} style={{ width: "auto", padding: "0.7rem 2rem" }}>
                {mode === "elevate" ? "Apply" : "Approve"}
              </PrimaryButton>
            </ButtonRow>
          </Card>
        )}

        {/* Success */}
        {step === "success" && (
          <Card>
            <SuccessIcon>
              <div className="icon">✓</div>
              <Title style={{ color: "var(--green)" }}>
                {mode === "elevate" ? "Scope Updated" : mode === "device" ? "Device Authorized" : "Authorized"}
              </Title>
              <Subtitle style={{ marginTop: "0.5rem" }}>{successMsg}</Subtitle>
            </SuccessIcon>
          </Card>
        )}

        {/* Error */}
        {step === "error" && (
          <Card>
            <ErrorIcon>
              <div className="icon">✗</div>
              <Title style={{ color: "var(--red)" }}>Failed</Title>
              <Subtitle style={{ marginTop: "0.5rem" }}>{error}</Subtitle>
            </ErrorIcon>
            <SecondaryButton onClick={() => setStep(needsAuth ? "auth" : "consent")} style={{ width: "100%" }}>
              Try Again
            </SecondaryButton>
          </Card>
        )}
      </WideContainer>
    </PageWrapper>
  );
}
