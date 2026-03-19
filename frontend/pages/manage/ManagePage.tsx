/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** ManagePage — unified management: profile, rooms, tokens.
 *
 * v7: Replaces vault table with unified tokens section.
 * Adds room search/filter/pagination.
 */
import { useCallback, useState, useEffect, useMemo } from "https://esm.sh/react@18.2.0";
import { styled } from "../../styled.ts";
import { Nav } from "../../components/Nav.tsx";
import {
  Card, ErrorText, Input, Label, PageWrapper,
  PrimaryButton, StatusText, Subtitle, Title, TitleDim,
} from "../../components/mcp.tsx";

export interface ManagePageProps {
  origin: string;
  dashboardOrigin?: string;
}

// ─── Styled components ───────────────────────────────────────────

const ModeToggle = styled.div`display:flex;gap:0;margin-bottom:1.25rem;border-radius:8px;overflow:hidden;border:1px solid var(--border,#21262d);`;
const ModeTab = styled.button<{$active?:boolean}>`flex:1;padding:0.5rem;border:none;background:${({$active})=>$active?"var(--surface2)":"transparent"};color:${({$active})=>$active?"var(--fg)":"var(--dim)"};cursor:pointer;font-size:0.85rem;transition:all 0.2s;font-family:inherit;`;
const MC = styled.div`width:100%;max-width:760px;padding:1rem;`;
const Section = styled.div`background:var(--surface,#161b22);border:1px solid var(--border,#21262d);border-radius:12px;padding:1.5rem 2rem;margin-bottom:1rem;@media(max-width:600px){padding:1rem 1.25rem;}`;
const Header = styled.div`display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem;flex-wrap:wrap;gap:0.5rem;`;
const UserBadge = styled.span`font-size:0.8rem;color:var(--dim);background:var(--bg,#0d1117);border:1px solid var(--border,#21262d);border-radius:6px;padding:0.3rem 0.7rem;`;
const SignOutBtn = styled.button`border:1px solid var(--border,#21262d);background:none;color:var(--dim);padding:0.3rem 0.8rem;border-radius:6px;font-size:0.78rem;cursor:pointer;font-family:inherit;&:hover{border-color:var(--red);color:var(--red);}`;
const STitle = styled.div`font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--dim);margin-bottom:0.75rem;`;
const PasskeyList = styled.div`display:flex;gap:0.5rem;flex-wrap:wrap;`;
const PasskeyChip = styled.span`font-size:0.75rem;background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:0.2rem 0.6rem;color:var(--dim);font-family:"SF Mono","Fira Code",monospace;`;
const SyncBadge = styled.span`color:var(--green);margin-left:0.3rem;font-size:0.65rem;`;
const ActionBtn = styled.button<{$v?:string}>`border:none;background:none;cursor:pointer;padding:0.25rem 0.5rem;border-radius:4px;font-size:0.78rem;font-family:inherit;transition:all 0.15s;${({$v})=>$v==="red"?`color:var(--red);&:hover{background:var(--surface);}`:$v==="blue"?`color:var(--accent);&:hover{background:var(--surface);}`:$v==="purple"?`color:var(--purple);&:hover{background:#1a1a2a;}`:$v==="green"?`color:var(--green);&:hover{background:var(--surface);}`:`color:var(--dim);&:hover{background:var(--surface2);}`};`;
const EmptyState = styled.div`text-align:center;padding:2rem;color:var(--dim);font-size:0.9rem;`;
const SearchInput = styled.input`width:100%;padding:0.55rem 0.75rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:0.85rem;font-family:inherit;&:focus{outline:none;border-color:var(--accent);}&::placeholder{color:#484f58;}`;
const TabBar = styled.div`display:flex;gap:0;border-radius:8px;overflow:hidden;border:1px solid var(--border);margin-bottom:1rem;`;
const Tab = styled.button<{$active?:boolean}>`flex:1;padding:0.5rem;border:none;background:${({$active})=>$active?"var(--surface2)":"transparent"};color:${({$active})=>$active?"var(--fg)":"var(--dim)"};cursor:pointer;font-size:0.82rem;font-family:inherit;transition:all 0.15s;`;
const Pill = styled.button`padding:0.2rem 0.6rem;border:1px solid var(--border);border-radius:99px;background:transparent;color:var(--dim);font-size:0.72rem;cursor:pointer;font-family:inherit;&:hover{border-color:var(--accent);color:var(--fg);}`;
const Count = styled.span`font-size:0.72rem;color:var(--dim);`;
const RoomCard = styled.div<{$open?:boolean}>`border:1px solid var(--border);border-radius:8px;margin-bottom:0.4rem;overflow:hidden;transition:border-color 0.15s;&:hover{border-color:#30363d;}`;
const RoomHeader = styled.div`display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0.85rem;cursor:pointer;`;
const RoomName = styled.span`font-weight:600;font-size:0.88rem;color:var(--fg);`;
const RoomMeta = styled.span`font-size:0.72rem;color:var(--dim);`;
const RoomDetail = styled.div`padding:0 0.85rem 0.65rem;font-size:0.8rem;border-top:1px solid var(--border);`;
const AgentRow = styled.div`display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;font-size:0.8rem;`;
const AgentName = styled.span`color:var(--fg);font-weight:500;`;
const AgentMeta = styled.span`color:var(--dim);font-size:0.72rem;`;
const TokenRow = styled.div`display:flex;align-items:flex-start;gap:0.75rem;padding:0.6rem 0;border-bottom:1px solid var(--border);&:last-child{border-bottom:none;}`;
const TokenInfo = styled.div`flex:1;min-width:0;`;
const TokenLabel = styled.div`font-size:0.85rem;color:var(--fg);font-weight:500;`;
const TokenScope = styled.div`font-size:0.72rem;color:var(--dim);font-family:"SF Mono","Fira Code",monospace;word-break:break-all;margin-top:0.15rem;`;
const TokenMeta = styled.div`font-size:0.72rem;color:var(--dim);margin-top:0.15rem;`;
const Badge = styled.span<{$c?:string}>`display:inline-block;font-size:0.68rem;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;padding:0.12rem 0.4rem;border-radius:4px;${({$c})=>$c==="active"?`background:#1a2a1a;color:#6c6;`:$c==="revoked"?`background:#2a1a1a;color:#c66;`:$c==="expired"?`background:#2a2a1a;color:#cc6;`:`background:#1a1a2a;color:#88f;`}`;
const RecoveryBox = styled.div`margin-top:0.75rem;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:0.75rem;`;
const RecoveryInput = styled.input`width:100%;padding:0.5rem 0.6rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--fg);font-family:"SF Mono","Fira Code",monospace;font-size:0.8rem;margin-bottom:0.4rem;`;
const Toast = styled.div<{$show?:boolean}>`position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:var(--surface2);color:var(--fg);padding:0.5rem 1.25rem;border-radius:8px;font-size:0.85rem;opacity:${({$show})=>$show?1:0};transition:opacity 0.3s;pointer-events:none;z-index:100;`;
const HeaderRight = styled.div`display:flex;align-items:center;gap:0.5rem;`;
const SmallPrimary = styled(PrimaryButton)`width:auto;padding:0.4rem 1rem;font-size:0.82rem;`;
const Pager = styled.div`display:flex;align-items:center;justify-content:center;gap:0.5rem;margin-top:0.75rem;`;
const PageBtn = styled.button<{$disabled?:boolean}>`padding:0.3rem 0.7rem;border:1px solid var(--border);border-radius:6px;background:transparent;color:${({$disabled})=>$disabled?"var(--dim)":"var(--fg)"};font-size:0.8rem;cursor:${({$disabled})=>$disabled?"default":"pointer"};font-family:inherit;opacity:${({$disabled})=>$disabled?0.4:1};&:hover{${({$disabled})=>!$disabled&&`border-color:var(--accent);`}}`;
const DashLink = styled.a`color:var(--purple);text-decoration:none;font-size:0.82rem;&:hover{text-decoration:underline;}`;
const InlineForm = styled.div`padding:0.65rem 0.85rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:0.5rem;`;
const FormRow = styled.div`display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;`;
const FormInput = styled.input`flex:1;min-width:120px;padding:0.45rem 0.65rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:0.82rem;font-family:inherit;&:focus{outline:none;border-color:var(--accent);}&::placeholder{color:#484f58;}`;
const FormSelect = styled.select`padding:0.45rem 0.5rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--fg);font-size:0.82rem;font-family:inherit;`;
const FormError = styled.div`font-size:0.75rem;color:var(--red,#f85149);`;

// ─── Types ───────────────────────────────────────────────────────

interface Passkey { id: string; device_type: string; backed_up: boolean; }
interface RoomData {
  room_id: string; access: string; label: string | null; is_default: boolean;
  agents: Array<{ id: string; name: string; role: string; status: string; last_heartbeat: string }>;
  roles: Record<string, any>;
}
interface TokenData {
  id: string; scope: string; label: string | null; room_id: string | null;
  agent_id: string | null; client_id: string | null; revoked: boolean;
  expires_at: string | null; created_at: string;
}
interface RecoveryToken { id: string; createdAt: string; expiresAt: string; used: boolean; }

type AuthMode = "signin" | "register";
type DashTab = "rooms" | "tokens" | "profile";
const PAGE_SIZE = 20;

// ─── Component ───────────────────────────────────────────────────

export function ManagePage({ origin, dashboardOrigin }: ManagePageProps) {
  const [phase, setPhase] = useState<"auth"|"dashboard">("auth");
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string|null>(null);
  const [username, setUsername] = useState("");
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [recoveryTokens, setRecoveryTokens] = useState<RecoveryToken[]>([]);
  const [newRecoveryToken, setNewRecoveryToken] = useState<string|null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [tab, setTab] = useState<DashTab>("rooms");
  const [roomSearch, setRoomSearch] = useState("");
  const [roomPage, setRoomPage] = useState(0);
  const [tokenFilter, setTokenFilter] = useState<"active"|"all">("active");
  const [expandedRoom, setExpandedRoom] = useState<string|null>(null);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoomId, setNewRoomId] = useState("");
  const [newRoomLabel, setNewRoomLabel] = useState("");
  const [inviteRoom, setInviteRoom] = useState<string|null>(null);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState("participant");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem('sync_session_id');
      if (saved) {
        setSessionId(saved);
        setPhase("dashboard");
        loadDashboard(saved).catch(() => { localStorage.removeItem('sync_session_id'); signOut(); });
      }
    } catch {}
  }, []);

  function toast(msg: string) { setToastMsg(msg); setToastVisible(true); setTimeout(() => setToastVisible(false), 2000); }

  async function api(method: string, path: string, body?: any, sid?: string): Promise<any> {
    const opts: RequestInit = { method, headers: { "Content-Type": "application/json", "X-Session-Id": sid || sessionId || "" } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${origin}/manage/api${path}`, opts);
    if (res.status === 401) { signOut(); return null; }
    return res.json();
  }

  async function doAuth() { setError(""); if (authMode === "register") await doRegister(); else await doSignIn(); }

  async function doSignIn() {
    setStatus("Generating authentication options...");
    try {
      const { startAuthentication } = await import("https://esm.sh/@simplewebauthn/browser@13");
      const optRes = await fetch(`${origin}/webauthn/authenticate/options`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const optData = await optRes.json();
      if (!optRes.ok) { setError(optData.error); setStatus(""); return; }
      setStatus("Touch your authenticator...");
      const assertResp = await startAuthentication({ optionsJSON: optData.options });
      setStatus("Verifying...");
      const verRes = await fetch(`${origin}/webauthn/authenticate/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId: optData.challengeId, response: assertResp }) });
      const verData = await verRes.json();
      if (!verRes.ok || !verData.verified) { setError(verData.error || "Authentication failed"); setStatus(""); return; }
      setSessionId(verData.sessionId);
      setPhase("dashboard");
      try { localStorage.setItem('sync_session_id', verData.sessionId); } catch {}
      setStatus("");
      await loadDashboard(verData.sessionId);
    } catch (err: any) { setError(err.message || "Authentication failed"); setStatus(""); }
  }

  async function doRegister() {
    const u = (document.getElementById("manage-username") as HTMLInputElement)?.value?.trim();
    if (!u) { setError("Username is required"); return; }
    setStatus("Generating registration options...");
    try {
      const { startRegistration } = await import("https://esm.sh/@simplewebauthn/browser@13");
      const optRes = await fetch(`${origin}/webauthn/register/options`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u }) });
      const optData = await optRes.json();
      if (!optRes.ok) { setError(optData.error || "Registration failed"); setStatus(""); return; }
      setStatus("Create your passkey...");
      const regResp = await startRegistration({ optionsJSON: optData.options });
      setStatus("Verifying...");
      const verRes = await fetch(`${origin}/webauthn/register/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId: optData.challengeId, response: regResp }) });
      const verData = await verRes.json();
      if (!verRes.ok || !verData.verified) { setError(verData.error || "Registration failed"); setStatus(""); return; }
      setSessionId(verData.sessionId);
      setPhase("dashboard");
      setStatus("");
      await loadDashboard(verData.sessionId);
    } catch (err: any) { setError(err.message || "Registration failed"); setStatus(""); }
  }

  async function loadDashboard(sid?: string) {
    const me = await api("GET", "/me", undefined, sid);
    if (!me) return;
    setUsername(me.user?.username ?? "Unknown");
    setPasskeys(me.passkeys ?? []);
    const roomData = await api("GET", "/rooms", undefined, sid);
    if (roomData?.rooms) setRooms(roomData.rooms);
    const tokenData = await api("GET", "/tokens", undefined, sid);
    if (tokenData?.tokens) setTokens(tokenData.tokens);
    const recData = await api("GET", "/recovery", undefined, sid);
    if (recData?.tokens) setRecoveryTokens(recData.tokens.filter((t: RecoveryToken) => !t.used && new Date(t.expiresAt) > new Date()));
  }

  async function createNewRoom() {
    setActionError("");
    const id = newRoomId.trim() || undefined;
    const label = newRoomLabel.trim() || undefined;
    const data = await api("POST", "/rooms", { id, label });
    if (!data) return;
    if (data.error) { setActionError(data.error === "room_exists" ? "Room ID already exists" : data.error); return; }
    toast(`Room "${data.id}" created`);
    setShowCreateRoom(false); setNewRoomId(""); setNewRoomLabel("");
    const roomData = await api("GET", "/rooms");
    if (roomData?.rooms) setRooms(roomData.rooms);
  }

  async function inviteUser(roomId: string) {
    setActionError("");
    if (!inviteUsername.trim()) { setActionError("Username required"); return; }
    const data = await api("POST", `/rooms/${encodeURIComponent(roomId)}/invite`, { username: inviteUsername.trim(), role: inviteRole });
    if (!data) return;
    if (data.error) { setActionError(data.error === "user_not_found" ? `User "${inviteUsername}" not found` : data.error); return; }
    toast(`Invited ${inviteUsername} to ${roomId}`);
    setInviteRoom(null); setInviteUsername(""); setInviteRole("participant");
  }

  async function deleteRoom(roomId: string) {
    if (!confirm(`Delete room "${roomId}"? This removes all state, agents, actions, and views. This cannot be undone.`)) return;
    const data = await api("DELETE", `/rooms/${encodeURIComponent(roomId)}`);
    if (!data) return;
    if (data.error) { toast(data.error); return; }
    toast(`Room "${roomId}" deleted`);
    setExpandedRoom(null);
    const roomData = await api("GET", "/rooms");
    if (roomData?.rooms) setRooms(roomData.rooms);
  }

  async function revokeToken(id: string, label: string) {
    if (!confirm(`Revoke token "${label || id}"?`)) return;
    await api("DELETE", `/tokens/${id}`);
    toast("Token revoked");
    const tokenData = await api("GET", "/tokens");
    if (tokenData?.tokens) setTokens(tokenData.tokens);
  }

  async function generateRecovery() {
    const data = await api("POST", "/recovery");
    if (!data || data.error) { toast(data?.error || "Failed"); return; }
    setNewRecoveryToken(data.token);
    toast("Recovery token generated");
    const recData = await api("GET", "/recovery");
    if (recData?.tokens) setRecoveryTokens(recData.tokens.filter((t: RecoveryToken) => !t.used && new Date(t.expiresAt) > new Date()));
  }

  async function revokeRecovery(id: string) {
    if (!confirm("Revoke this recovery token?")) return;
    await api("DELETE", `/recovery/${id}`);
    toast("Recovery token revoked");
    const recData = await api("GET", "/recovery");
    if (recData?.tokens) setRecoveryTokens(recData.tokens.filter((t: RecoveryToken) => !t.used && new Date(t.expiresAt) > new Date()));
  }

  function signOut() {
    try { localStorage.removeItem('sync_session_id'); } catch {}
    setSessionId(null); setPhase("auth"); setStatus(""); setError("");
    setRooms([]); setTokens([]); setPasskeys([]); setRecoveryTokens([]); setNewRecoveryToken(null);
  }

  // ── Derived data ──
  const dashBase = dashboardOrigin ?? origin.replace(/mcp\./, "");

  const filteredRooms = useMemo(() => {
    const q = roomSearch.toLowerCase().trim();
    if (!q) return rooms;
    return rooms.filter(r =>
      r.room_id.toLowerCase().includes(q) ||
      (r.label || "").toLowerCase().includes(q) ||
      r.agents.some(a => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
    );
  }, [rooms, roomSearch]);

  const totalRoomPages = Math.max(1, Math.ceil(filteredRooms.length / PAGE_SIZE));
  const pagedRooms = filteredRooms.slice(roomPage * PAGE_SIZE, (roomPage + 1) * PAGE_SIZE);

  const roomsWithAgents = rooms.filter(r => r.agents.length > 0).length;

  const filteredTokens = useMemo(() => {
    if (tokenFilter === "active") return tokens.filter(t => !t.revoked && (!t.expires_at || new Date(t.expires_at) > new Date()));
    return tokens;
  }, [tokens, tokenFilter]);

  const activeTokenCount = tokens.filter(t => !t.revoked && (!t.expires_at || new Date(t.expires_at) > new Date())).length;

  function describeScope(scope: string): string {
    const items = scope.split(/\s+/).filter(Boolean);
    if (items.length === 0) return "—";
    return items.map(item => {
      if (item === "create_rooms") return "create rooms";
      if (item === "rooms:*") return "all rooms";
      if (item === "rooms:*:read") return "all rooms (read)";
      if (item === "sync:rooms") return "all rooms (legacy)";
      if (item.includes(":agent:")) { const p = item.split(":"); return `${p[1]} → ${p[3]}`; }
      if (item.endsWith(":read")) return `${item.split(":")[1]} (read)`;
      if (item.endsWith(":write")) return `${item.split(":")[1]} (write)`;
      if (item.startsWith("rooms:")) return item.split(":")[1];
      return item;
    }).join(", ");
  }

  function tokenStatus(t: TokenData): "active" | "revoked" | "expired" {
    if (t.revoked) return "revoked";
    if (t.expires_at && new Date(t.expires_at) < new Date()) return "expired";
    return "active";
  }

  function timeAgo(iso: string): string {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  // ─── Render ────────────────────────────────────────────────────

  return (
    <>
      <Nav active="manage" />
      <PageWrapper>
        <MC>
          {phase === "auth" && (
            <Section>
              <Title>sync<TitleDim>·manage</TitleDim></Title>
              <Subtitle>Sign in or create an account to manage your sync rooms, tokens, and passkeys.</Subtitle>
              <ModeToggle>
                <ModeTab $active={authMode === "signin"} onClick={() => { setAuthMode("signin"); setError(""); setStatus(""); }}>Sign in</ModeTab>
                <ModeTab $active={authMode === "register"} onClick={() => { setAuthMode("register"); setError(""); setStatus(""); }}>Register</ModeTab>
              </ModeToggle>
              {authMode === "register" && (
                <div><Label htmlFor="manage-username">Username</Label><Input id="manage-username" type="text" placeholder="Choose a username" autoComplete="username" onKeyDown={(e) => e.key === "Enter" && doAuth()} /></div>
              )}
              <PrimaryButton onClick={doAuth}>{authMode === "register" ? "Create account with passkey" : "Sign in with passkey"}</PrimaryButton>
              {status && <StatusText>{status}</StatusText>}
              {error && <ErrorText>{error}</ErrorText>}
            </Section>
          )}

          {phase === "dashboard" && (
            <>
              <Section>
                <Header>
                  <Title style={{ margin: 0 }}>sync<TitleDim>·manage</TitleDim></Title>
                  <HeaderRight>
                    <UserBadge>{username}</UserBadge>
                    <SignOutBtn onClick={signOut}>Sign out</SignOutBtn>
                  </HeaderRight>
                </Header>
                <TabBar>
                  <Tab $active={tab === "rooms"} onClick={() => setTab("rooms")}>Rooms ({rooms.length})</Tab>
                  <Tab $active={tab === "tokens"} onClick={() => setTab("tokens")}>Tokens ({activeTokenCount})</Tab>
                  <Tab $active={tab === "profile"} onClick={() => setTab("profile")}>Profile</Tab>
                </TabBar>
              </Section>

              {/* ── Rooms tab ── */}
              {tab === "rooms" && (
                <Section>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
                    <SearchInput placeholder="Search rooms, agents..." value={roomSearch}
                      onChange={e => { setRoomSearch(e.target.value); setRoomPage(0); }} style={{ flex: 1, minWidth: "200px" }} />
                    <Pill onClick={() => { setRoomSearch(""); setRoomPage(0); }}>Clear</Pill>
                    <SmallPrimary onClick={() => setShowCreateRoom(v => !v)} style={{ margin: 0 }}>+ Room</SmallPrimary>
                  </div>

                  {showCreateRoom && (
                    <InlineForm>
                      <FormRow>
                        <FormInput placeholder="Room ID (optional, auto-generated)" value={newRoomId} onChange={e => setNewRoomId(e.target.value)} />
                        <FormInput placeholder="Label" value={newRoomLabel} onChange={e => setNewRoomLabel(e.target.value)} />
                        <SmallPrimary onClick={createNewRoom} style={{ margin: 0 }}>Create</SmallPrimary>
                        <Pill onClick={() => { setShowCreateRoom(false); setActionError(""); }}>Cancel</Pill>
                      </FormRow>
                      {actionError && <FormError>{actionError}</FormError>}
                    </InlineForm>
                  )}

                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
                    <Count>{filteredRooms.length} of {rooms.length} rooms</Count>
                    <Count>·</Count>
                    <Count>{roomsWithAgents} with agents</Count>
                  </div>

                  {pagedRooms.length === 0 ? (
                    <EmptyState>{rooms.length === 0 ? "No rooms yet. Click + Room to create one." : "No rooms match your search."}</EmptyState>
                  ) : pagedRooms.map(r => {
                    const isOpen = expandedRoom === r.room_id;
                    const isOwner = r.access === "owner";
                    const agentCount = r.agents.length;
                    const roleCount = Object.keys(r.roles || {}).length;
                    return (
                      <RoomCard key={r.room_id} $open={isOpen}>
                        <RoomHeader onClick={() => { setExpandedRoom(isOpen ? null : r.room_id); setInviteRoom(null); setActionError(""); }}>
                          <span style={{ color: "var(--dim)", fontSize: "0.75rem" }}>{isOpen ? "▾" : "▸"}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <RoomName>{r.label || r.room_id}</RoomName>
                            {r.label && r.label !== r.room_id && <RoomMeta style={{ marginLeft: "0.5rem" }}>{r.room_id}</RoomMeta>}
                            <RoomMeta style={{ marginLeft: "0.5rem" }}>[{r.access}]</RoomMeta>
                            <div>
                              {agentCount > 0 && <RoomMeta>{agentCount} agent{agentCount > 1 ? "s" : ""}</RoomMeta>}
                              {roleCount > 0 && <RoomMeta> · {roleCount} role{roleCount > 1 ? "s" : ""}</RoomMeta>}
                            </div>
                          </div>
                          <DashLink href={`${dashBase}/rooms/${encodeURIComponent(r.room_id)}/dashboard`} target="_blank" onClick={e => e.stopPropagation()}>dashboard</DashLink>
                        </RoomHeader>
                        {isOpen && (
                          <RoomDetail>
                            {r.agents.length > 0 ? (
                              <>
                                <div style={{ padding: "0.5rem 0 0.25rem", fontSize: "0.72rem", color: "var(--dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Agents</div>
                                {r.agents.map(a => (
                                  <AgentRow key={a.id}>
                                    <AgentName>{a.name || a.id}</AgentName>
                                    <AgentMeta>{a.role}</AgentMeta>
                                    <AgentMeta>·</AgentMeta>
                                    <AgentMeta>{a.status}</AgentMeta>
                                    {a.last_heartbeat && <AgentMeta>· {timeAgo(a.last_heartbeat.replace(" ", "T") + "Z")}</AgentMeta>}
                                  </AgentRow>
                                ))}
                              </>
                            ) : (
                              <div style={{ padding: "0.5rem 0", fontSize: "0.82rem", color: "var(--dim)" }}>No agents in this room.</div>
                            )}

                            {isOwner && (
                              <div style={{ display: "flex", gap: "0.5rem", padding: "0.5rem 0 0.25rem", flexWrap: "wrap" }}>
                                <ActionBtn $v="blue" onClick={e => { e.stopPropagation(); setInviteRoom(inviteRoom === r.room_id ? null : r.room_id); setActionError(""); }}>
                                  {inviteRoom === r.room_id ? "cancel invite" : "invite user"}
                                </ActionBtn>
                                <ActionBtn $v="red" onClick={e => { e.stopPropagation(); deleteRoom(r.room_id); }}>delete room</ActionBtn>
                              </div>
                            )}

                            {inviteRoom === r.room_id && (
                              <div style={{ padding: "0.4rem 0" }}>
                                <FormRow>
                                  <FormInput placeholder="Username" value={inviteUsername} onChange={e => setInviteUsername(e.target.value)}
                                    onKeyDown={e => e.key === "Enter" && inviteUser(r.room_id)} />
                                  <FormSelect value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                                    <option value="owner">Owner</option>
                                    <option value="collaborator">Collaborator</option>
                                    <option value="participant">Participant</option>
                                    <option value="observer">Observer</option>
                                  </FormSelect>
                                  <SmallPrimary onClick={() => inviteUser(r.room_id)} style={{ margin: 0 }}>Invite</SmallPrimary>
                                </FormRow>
                                {actionError && <FormError>{actionError}</FormError>}
                              </div>
                            )}
                          </RoomDetail>
                        )}
                      </RoomCard>
                    );
                  })}

                  {totalRoomPages > 1 && (
                    <Pager>
                      <PageBtn $disabled={roomPage === 0} onClick={() => roomPage > 0 && setRoomPage(roomPage - 1)}>← Prev</PageBtn>
                      <Count>{roomPage + 1} / {totalRoomPages}</Count>
                      <PageBtn $disabled={roomPage >= totalRoomPages - 1} onClick={() => roomPage < totalRoomPages - 1 && setRoomPage(roomPage + 1)}>Next →</PageBtn>
                    </Pager>
                  )}
                </Section>
              )}

              {/* ── Tokens tab ── */}
              {tab === "tokens" && (
                <Section>
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem", alignItems: "center" }}>
                    <Pill onClick={() => setTokenFilter("active")} style={tokenFilter === "active" ? { borderColor: "var(--accent)", color: "var(--fg)" } : {}}>Active ({activeTokenCount})</Pill>
                    <Pill onClick={() => setTokenFilter("all")} style={tokenFilter === "all" ? { borderColor: "var(--accent)", color: "var(--fg)" } : {}}>All ({tokens.length})</Pill>
                  </div>

                  {filteredTokens.length === 0 ? (
                    <EmptyState>No {tokenFilter === "active" ? "active " : ""}tokens. Use device auth or MCP to create tokens.</EmptyState>
                  ) : filteredTokens.map(t => {
                    const st = tokenStatus(t);
                    const scopeRoomCount = (t.scope.match(/rooms:/g) || []).length;
                    return (
                      <TokenRow key={t.id}>
                        <TokenInfo>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                            <TokenLabel>{t.label || t.client_id || "Token"}</TokenLabel>
                            <Badge $c={st}>{st}</Badge>
                          </div>
                          <TokenScope>{describeScope(t.scope)}{scopeRoomCount > 5 && ` (${scopeRoomCount} rooms)`}</TokenScope>
                          <TokenMeta>
                            Created {timeAgo(t.created_at.replace(" ", "T") + "Z")}
                            {t.expires_at && ` · expires ${new Date(t.expires_at).toLocaleDateString()}`}
                            {t.client_id && ` · ${t.client_id.substring(0, 16)}...`}
                          </TokenMeta>
                        </TokenInfo>
                        {st === "active" && (
                          <ActionBtn $v="red" onClick={() => revokeToken(t.id, t.label || t.id)}>revoke</ActionBtn>
                        )}
                      </TokenRow>
                    );
                  })}
                </Section>
              )}

              {/* ── Profile tab ── */}
              {tab === "profile" && (
                <>
                  <Section>
                    <STitle>Passkeys</STitle>
                    <PasskeyList>
                      {passkeys.length > 0 ? passkeys.map(p => (
                        <PasskeyChip key={p.id}>{p.id}{p.backed_up && <SyncBadge>synced</SyncBadge>}</PasskeyChip>
                      )) : <span style={{ color: "#666", fontSize: "0.85rem" }}>No passkeys found</span>}
                    </PasskeyList>
                  </Section>
                  <Section>
                    <STitle>Recovery Tokens</STitle>
                    {recoveryTokens.length === 0 ? (
                      <span style={{ color: "#666", fontSize: "0.85rem" }}>No active recovery tokens.</span>
                    ) : recoveryTokens.map(t => (
                      <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.3rem 0", fontSize: "0.82rem" }}>
                        <span style={{ color: "#888" }}>Created {t.createdAt.split("T")[0]}</span>
                        <span style={{ color: "#666" }}>expires {t.expiresAt.split("T")[0]}</span>
                        <ActionBtn $v="red" onClick={() => revokeRecovery(t.id)}>revoke</ActionBtn>
                      </div>
                    ))}
                    <div style={{ marginTop: "0.75rem" }}>
                      <SmallPrimary onClick={generateRecovery}>Generate recovery token</SmallPrimary>
                    </div>
                    {newRecoveryToken && (
                      <RecoveryBox>
                        <p style={{ fontSize: "0.78rem", color: "var(--yellow)", marginBottom: "0.4rem" }}>Copy this token now — it will not be shown again.</p>
                        <RecoveryInput type="text" readOnly value={newRecoveryToken} onClick={e => (e.target as HTMLInputElement).select()} />
                        <ActionBtn onClick={() => { navigator.clipboard.writeText(newRecoveryToken); toast("Recovery token copied"); }}>copy</ActionBtn>
                      </RecoveryBox>
                    )}
                  </Section>
                </>
              )}
            </>
          )}
          <Toast $show={toastVisible}>{toastMsg}</Toast>
        </MC>
      </PageWrapper>
    </>
  );
}
