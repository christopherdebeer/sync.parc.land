/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** ManagePage — vault, passkeys, recovery token management.
 *
 * Two-phase flow:
 *   1. Sign in with passkey (WebAuthn)
 *   2. Dashboard: passkeys, vault table, recovery tokens
 *
 * Server renders the sign-in form. Client hydration adds WebAuthn + dashboard.
 */
import { useCallback, useState, useEffect } from "https://esm.sh/react@18.2.0";
import { styled } from "../../styled.ts";
import { Nav } from "../../components/Nav.tsx";
import {
  Card,
  ErrorText,
  Input,
  Label,
  PageWrapper,
  PrimaryButton,
  StatusText,
  Subtitle,
  Title,
  TitleDim,
} from "../../components/mcp.tsx";

export interface ManagePageProps {
  origin: string;
  /** Dashboard origin for vault→dashboard links. Computed server-side. */
  dashboardOrigin?: string;
}

// ─── Manage-specific styled components ───────────────────────────

const ModeToggle = styled.div`
  display: flex;
  gap: 0;
  margin-bottom: 1.25rem;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border, #21262d);
`;

const ModeTab = styled.button<{ $active?: boolean }>`
  flex: 1;
  padding: 0.5rem;
  border: none;
  background: ${({ $active }) => ($active ? "var(--surface2)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--fg)" : "var(--dim)")};
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s;
  font-family: inherit;
`;

const ManageContainer = styled.div`
  width: 100%;
  max-width: 720px;
  padding: 1rem;
`;

const ManageCard = styled.div`
  background: var(--surface, #161b22);
  border: 1px solid var(--border, #21262d);
  border-radius: 12px;
  padding: 1.5rem 2rem;
  margin-bottom: 1rem;

  @media (max-width: 600px) {
    padding: 1rem 1.25rem;
  }
`;

const ManageHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
`;

const UserBadge = styled.span`
  font-size: 0.8rem;
  color: var(--dim);
  background: var(--bg, #0d1117);
  border: 1px solid var(--border, #21262d);
  border-radius: 6px;
  padding: 0.3rem 0.7rem;
`;

const SignOutButton = styled.button`
  border: 1px solid var(--border, #21262d);
  background: none;
  color: var(--dim);
  padding: 0.3rem 0.8rem;
  border-radius: 6px;
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  &:hover {
    border-color: var(--red, #f85149);
    color: var(--red, #f85149);
  }
`;

const SectionTitle = styled.div`
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--dim);
  margin-bottom: 0.75rem;
`;

const PasskeyList = styled.div`
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
`;

const PasskeyChip = styled.span`
  font-size: 0.75rem;
  background: var(--bg, #0d1117);
  border: 1px solid var(--border, #21262d);
  border-radius: 5px;
  padding: 0.2rem 0.6rem;
  color: var(--dim);
  font-family: "SF Mono", "Fira Code", monospace;
`;

const SyncedBadge = styled.span`
  color: var(--green, #3fb950);
  margin-left: 0.3rem;
  font-size: 0.65rem;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 2rem;
  color: var(--dim);
  font-size: 0.9rem;
`;

const VaultTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;

  @media (max-width: 600px) {
    font-size: 0.78rem;
  }
`;

const Th = styled.th`
  text-align: left;
  color: var(--dim);
  font-weight: 500;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.5rem 0.5rem;
  border-bottom: 1px solid var(--border, #21262d);

  @media (max-width: 600px) {
    padding: 0.4rem 0.3rem;
  }
`;

const Td = styled.td<{ $actions?: boolean; $hideMobile?: boolean }>`
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid var(--border);
  vertical-align: middle;
  ${({ $actions }) => $actions && `white-space: nowrap; text-align: right;`} ${(
    { $hideMobile },
  ) =>
    $hideMobile &&
    `@media (max-width: 600px) { display: none; }`} @media (max-width: 600px) {
    padding: 0.4rem 0.3rem;
  }
`;

const Tr = styled.tr`
  &:last-child td {
    border-bottom: none;
  }
  &:hover td {
    background: var(--surface);
  }
`;

const TokenType = styled.span<{ $type: string }>`
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  ${({ $type }) =>
    $type === "room"
      ? `background: #1a2a1a; color: #6c6;`
      : $type === "agent"
      ? `background: #2a2a1a; color: #cc6;`
      : `background: #1a1a2a; color: #88f;`};
`;

const DefaultBadge = styled.span`
  font-size: 0.65rem;
  color: var(--accent, #58a6ff);
  border: 1px solid rgba(88, 166, 255, 0.2);
  border-radius: 3px;
  padding: 0.1rem 0.35rem;
  margin-left: 0.4rem;
`;

const RoomId = styled.span`
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 0.82rem;
  color: var(--fg, #c9d1d9);
`;

const LabelText = styled.span`
  color: var(--dim);
  font-size: 0.82rem;
`;

const ActionBtn = styled.button<{ $variant?: string }>`
  border: none;
  background: none;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.78rem;
  transition: all 0.15s;
  font-family: inherit;
  ${({ $variant }) =>
    $variant === "revoke"
      ? `color: var(--red, #f85149); &:hover { background: var(--surface); }`
      : $variant === "default"
      ? `color: var(--accent, #58a6ff); &:hover { background: var(--surface); }`
      : $variant === "dash"
      ? `color: var(--purple, #bc8cff); &:hover { background: var(--surface); }`
      : `color: var(--dim); &:hover { background: var(--surface2); }`};
`;

const DashLink = styled.a`
  border: none;
  background: none;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.78rem;
  transition: all 0.15s;
  color: var(--purple, #bc8cff);
  text-decoration: none;
  &:hover {
    background: #1a1a2a;
  }
`;

const RecoveryBox = styled.div`
  margin-top: 0.75rem;
  background: var(--bg, #0d1117);
  border: 1px solid var(--border, #21262d);
  border-radius: 8px;
  padding: 0.75rem;
`;

const RecoveryWarning = styled.p`
  font-size: 0.78rem;
  color: var(--yellow, #d29922);
  margin-bottom: 0.4rem;
`;

const RecoveryInput = styled.input`
  width: 100%;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border, #21262d);
  border-radius: 6px;
  background: var(--surface, #161b22);
  color: var(--fg, #c9d1d9);
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 0.8rem;
  cursor: text;
  margin-bottom: 0.4rem;
`;

const RecoveryRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0;
  font-size: 0.82rem;
`;

const Toast = styled.div<{ $show?: boolean }>`
  position: fixed;
  bottom: 1.5rem;
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface2);
  color: var(--fg, #c9d1d9);
  padding: 0.5rem 1.25rem;
  border-radius: 8px;
  font-size: 0.85rem;
  opacity: ${({ $show }) => ($show ? 1 : 0)};
  transition: opacity 0.3s;
  pointer-events: none;
  z-index: 100;
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const SmallPrimary = styled(PrimaryButton)`
  width: auto;
  padding: 0.4rem 1rem;
  font-size: 0.82rem;
`;

// ─── Types ───────────────────────────────────────────────────────

interface Passkey {
  id: string;
  device_type: string;
  backed_up: boolean;
}

interface VaultEntry {
  id: string;
  room_id: string;
  token: string;
  token_type: string;
  label: string | null;
  is_default: boolean;
}

interface RecoveryToken {
  id: string;
  createdAt: string;
  expiresAt: string;
  used: boolean;
}

// ─── Component ───────────────────────────────────────────────────

type AuthMode = "signin" | "register";

export function ManagePage({ origin, dashboardOrigin }: ManagePageProps) {
  const [phase, setPhase] = useState<"auth" | "dashboard">("auth");
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [vault, setVault] = useState<VaultEntry[]>([]);
  const [recoveryTokens, setRecoveryTokens] = useState<RecoveryToken[]>([]);
  const [newRecoveryToken, setNewRecoveryToken] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  useEffect(() => {
    const savedSessionId = localStorage.getItem('sync_session_id');
    if (savedSessionId) {
      setSessionId(savedSessionId);
      setPhase("dashboard");
      loadDashboard(savedSessionId).catch(() => {
        // If session invalid, clear it
        localStorage.removeItem('sync_session_id');
        signOut();
      });
    }
  }, []);

  function toast(msg: string) {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2000);
  }

  async function api(
    method: string,
    path: string,
    body?: any,
    sid?: string,
  ): Promise<any> {
    const opts: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": sid || sessionId || "",
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${origin}/manage/api${path}`, opts);
    if (res.status === 401) {
      signOut();
      return null;
    }
    return res.json();
  }

  async function doAuth() {
    setError("");
    if (authMode === "register") {
      await doRegister();
    } else {
      await doSignIn();
    }
  }

  async function doSignIn() {
    setStatus("Generating authentication options...");
    try {
      const { startAuthentication } = await import(
        "https://esm.sh/@simplewebauthn/browser@13"
      );

      const optRes = await fetch(`${origin}/webauthn/authenticate/options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const optData = await optRes.json();
      if (!optRes.ok) {
        setError(optData.error);
        setStatus("");
        return;
      }

      setStatus("Touch your authenticator...");
      const assertResp = await startAuthentication({
        optionsJSON: optData.options,
      });

      setStatus("Verifying...");
      const verRes = await fetch(`${origin}/webauthn/authenticate/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: optData.challengeId,
          response: assertResp,
        }),
      });
      const verData = await verRes.json();
      if (!verRes.ok || !verData.verified) {
        setError(verData.error || "Authentication failed");
        setStatus("");
        return;
      }

      setSessionId(verData.sessionId);
      setPhase("dashboard");
      localStorage.setItem('sync_session_id', verData.sessionId);
      setStatus("");
      await loadDashboard(verData.sessionId);
    } catch (err: any) {
      setError(err.message || "Authentication failed");
      setStatus("");
    }
  }

  async function doRegister() {
    const usernameInput = (
      document.getElementById("manage-username") as HTMLInputElement
    )?.value?.trim();
    if (!usernameInput) {
      setError("Username is required");
      return;
    }
    setStatus("Generating registration options...");
    try {
      const { startRegistration } = await import(
        "https://esm.sh/@simplewebauthn/browser@13"
      );

      const optRes = await fetch(`${origin}/webauthn/register/options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameInput }),
      });
      const optData = await optRes.json();
      if (!optRes.ok) {
        setError(optData.error || "Registration failed");
        setStatus("");
        return;
      }

      setStatus("Create your passkey...");
      const regResp = await startRegistration({
        optionsJSON: optData.options,
      });

      setStatus("Verifying...");
      const verRes = await fetch(`${origin}/webauthn/register/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: optData.challengeId,
          response: regResp,
        }),
      });
      const verData = await verRes.json();
      if (!verRes.ok || !verData.verified) {
        setError(verData.error || "Registration failed");
        setStatus("");
        return;
      }

      setSessionId(verData.sessionId);
      setPhase("dashboard");
      setStatus("");
      await loadDashboard(verData.sessionId);
    } catch (err: any) {
      setError(err.message || "Registration failed");
      setStatus("");
    }
  }

  async function loadDashboard(sid?: string) {
    const me = await api("GET", "/me", undefined, sid);
    if (!me) return;
    setUsername(me.user?.username ?? "Unknown");
    setPasskeys(me.passkeys ?? []);
    await loadVault(sid);
    await loadRecovery(sid);
  }

  async function loadVault(sid?: string) {
    const data = await api("GET", "/vault", undefined, sid);
    if (!data) return;
    setVault(data.entries ?? []);
  }

  async function loadRecovery(sid?: string) {
    const data = await api("GET", "/recovery", undefined, sid);
    if (!data) return;
    const active = (data.tokens || []).filter(
      (t: RecoveryToken) => !t.used && new Date(t.expiresAt) > new Date(),
    );
    setRecoveryTokens(active);
  }

  async function copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    toast("Token copied");
  }

  async function setDefault(id: string) {
    await api("POST", `/vault/${id}/default`);
    toast("Default room updated");
    await loadVault();
  }

  async function revoke(id: string, label: string) {
    if (!confirm(`Revoke ${label}? This cannot be undone.`)) return;
    await api("DELETE", `/vault/${id}`);
    toast("Token revoked");
    await loadVault();
  }

  async function generateRecovery() {
    const data = await api("POST", "/recovery");
    if (!data || data.error) {
      toast(data?.error || "Failed");
      return;
    }
    setNewRecoveryToken(data.token);
    toast("Recovery token generated");
    await loadRecovery();
  }

  async function revokeRecovery(id: string) {
    if (!confirm("Revoke this recovery token?")) return;
    await api("DELETE", `/recovery/${id}`);
    toast("Recovery token revoked");
    await loadRecovery();
  }

  function signOut() {
    localStorage.removeItem('sync_session_id');
    setSessionId(null);
    setPhase("auth");
    setStatus("");
    setError("");
    setVault([]);
    setPasskeys([]);
    setRecoveryTokens([]);
    setNewRecoveryToken(null);
  }

  // Group vault entries by room
  const roomGroups: Record<string, VaultEntry[]> = {};
  for (const e of vault) {
    if (!roomGroups[e.room_id]) roomGroups[e.room_id] = [];
    roomGroups[e.room_id].push(e);
  }

  // Use server-provided dashboardOrigin, fallback to string replacement
  const dashBase = dashboardOrigin ?? origin.replace(/mcp\./, "");

  return (
    <>
      <Nav active="manage" />
      <PageWrapper>
        <ManageContainer>
          {phase === "auth" && (
            <ManageCard>
              <Title>
                sync<TitleDim>·manage</TitleDim>
              </Title>
              <Subtitle>
                Sign in or create an account to manage your sync rooms, tokens,
                and passkeys.
              </Subtitle>

              <ModeToggle>
                <ModeTab
                  $active={authMode === "signin"}
                  onClick={() => {
                    setAuthMode("signin");
                    setError("");
                    setStatus("");
                  }}
                >
                  Sign in
                </ModeTab>
                <ModeTab
                  $active={authMode === "register"}
                  onClick={() => {
                    setAuthMode("register");
                    setError("");
                    setStatus("");
                  }}
                >
                  Register
                </ModeTab>
              </ModeToggle>

              {authMode === "register" && (
                <div>
                  <Label htmlFor="manage-username">Username</Label>
                  <Input
                    id="manage-username"
                    type="text"
                    placeholder="Choose a username"
                    autoComplete="username"
                    onKeyDown={(e) => e.key === "Enter" && doAuth()}
                  />
                </div>
              )}

              <PrimaryButton onClick={doAuth}>
                {authMode === "register"
                  ? "Create account with passkey"
                  : "Sign in with passkey"}
              </PrimaryButton>
              {status && <StatusText>{status}</StatusText>}
              {error && <ErrorText>{error}</ErrorText>}
            </ManageCard>
          )}

          {phase === "dashboard" && (
            <>
              {/* Header + Passkeys */}
              <ManageCard>
                <ManageHeader>
                  <Title style={{ margin: 0 }}>
                    sync<TitleDim>·mcp</TitleDim>
                  </Title>
                  <HeaderRight>
                    <UserBadge>{username}</UserBadge>
                    <SignOutButton onClick={signOut}>Sign out</SignOutButton>
                  </HeaderRight>
                </ManageHeader>

                <SectionTitle>Passkeys</SectionTitle>
                <PasskeyList>
                  {passkeys.length > 0
                    ? (
                      passkeys.map((p) => (
                        <PasskeyChip key={p.id}>
                          {p.id}
                          {p.backed_up && <SyncedBadge>synced</SyncedBadge>}
                        </PasskeyChip>
                      ))
                    )
                    : (
                      <span style={{ color: "#666", fontSize: "0.85rem" }}>
                        No passkeys found
                      </span>
                    )}
                </PasskeyList>
              </ManageCard>

              {/* Vault */}
              <ManageCard>
                <SectionTitle>Token Vault</SectionTitle>
                {vault.length === 0
                  ? (
                    <EmptyState>
                      No tokens in vault yet.
                      <br />
                      Connect an MCP client to create rooms and tokens will
                      appear here.
                    </EmptyState>
                  )
                  : (
                    <VaultTable>
                      <thead>
                        <tr>
                          <Th>Room</Th>
                          <Th>Type</Th>
                          <Th
                            style={{ display: undefined }}
                            className="hide-mobile"
                          >
                            Label
                          </Th>
                          <Th style={{ textAlign: "right" }}>Actions</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(roomGroups).map(([roomId, entries]) =>
                          entries.map((e, i) => (
                            <Tr key={e.id}>
                              <Td>
                                {i === 0 && (<>
                                  {e.is_default && (
                                  <DefaultBadge title="current default room">★</DefaultBadge>
                                )}
                                  {!e.is_default && e.token_type === "room" && (
                                  <ActionBtn
                                    $variant="default"
                                    onClick={() => setDefault(e.id)}
                                    title="Set as default room"
                                  >
                                    ☆
                                  </ActionBtn>
                                )}
                                  <RoomId>
                                    <DashLink
                                      href={`${dashBase}?room=${
                                        encodeURIComponent(roomId)
                                      }#token=${encodeURIComponent(e.token)}`}
                                      target="_blank"
                                      title="Open dashboard"
                                    >
                                      {roomId}
                                    </DashLink>
                                  </RoomId>
                                </>)}
                              </Td>
                              <Td>
                                <TokenType $type={e.token_type}>
                                  {e.token_type}
                                </TokenType>
                              </Td>
                              <Td $hideMobile>
                                <DashLink
                                  href={`${dashBase}?room=${
                                    encodeURIComponent(roomId)
                                  }#token=${encodeURIComponent(e.token)}`}
                                  target="_blank"
                                  title="Open dashboard"
                                >
                                  <LabelText>{e.label || ""}</LabelText>
                                </DashLink>
                              </Td>
                              <Td $actions>
                                <ActionBtn
                                  onClick={() => copyToken(e.token)}
                                >
                                  copy
                                </ActionBtn>
                                
                                <ActionBtn
                                  $variant="revoke"
                                  onClick={() =>
                                    revoke(
                                      e.id,
                                      `${e.token_type} for ${roomId}`,
                                    )}
                                >
                                  revoke
                                </ActionBtn>
                              </Td>
                            </Tr>
                          ))
                        )}
                      </tbody>
                    </VaultTable>
                  )}
              </ManageCard>

              {/* Recovery */}
              <ManageCard>
                <SectionTitle>Recovery Tokens</SectionTitle>
                {recoveryTokens.length === 0
                  ? (
                    <span style={{ color: "#666", fontSize: "0.85rem" }}>
                      No active recovery tokens.
                    </span>
                  )
                  : (
                    recoveryTokens.map((t) => (
                      <RecoveryRow key={t.id}>
                        <span style={{ color: "#888" }}>
                          Created {t.createdAt.split("T")[0]}
                        </span>
                        <span style={{ color: "#666" }}>
                          expires {t.expiresAt.split("T")[0]}
                        </span>
                        <ActionBtn
                          $variant="revoke"
                          onClick={() => revokeRecovery(t.id)}
                        >
                          revoke
                        </ActionBtn>
                      </RecoveryRow>
                    ))
                  )}
                <div style={{ marginTop: "0.75rem" }}>
                  <SmallPrimary onClick={generateRecovery}>
                    Generate recovery token
                  </SmallPrimary>
                </div>
                {newRecoveryToken && (
                  <RecoveryBox>
                    <RecoveryWarning>
                      Copy this token now — it will not be shown again.
                    </RecoveryWarning>
                    <RecoveryInput
                      type="text"
                      readOnly
                      value={newRecoveryToken}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <ActionBtn
                      onClick={() => {
                        navigator.clipboard.writeText(newRecoveryToken);
                        toast("Recovery token copied");
                      }}
                      style={{ fontSize: "0.82rem" }}
                    >
                      copy
                    </ActionBtn>
                  </RecoveryBox>
                )}
              </ManageCard>
            </>
          )}

          <Toast $show={toastVisible}>{toastMsg}</Toast>
        </ManageContainer>
      </PageWrapper>
    </>
  );
}
