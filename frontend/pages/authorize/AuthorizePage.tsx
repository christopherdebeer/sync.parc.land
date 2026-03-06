/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** AuthorizePage — OAuth sign-in/register + consent with room-level scope.
 *
 * Two-step flow:
 *   1. Sign in (passkey) or Register (username + passkey)
 *   2. Consent screen: select rooms, set per-room scope level, allow/deny
 *
 * Server validates OAuth params and passes them as props.
 * Client hydration adds WebAuthn + consent interactions.
 */
import { useState } from "https://esm.sh/react@18.2.0";
import { styled } from "../../styled.ts";
import {
  PageWrapper,
  Container,
  Card,
  Title,
  TitleDim,
  Subtitle,
  Label,
  Input,
  PrimaryButton,
  SecondaryButton,
  StatusText,
  ErrorText,
} from "../../components/mcp.tsx";

export interface OAuthParams {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  state: string;
  resource: string;
}

export interface AuthorizePageProps {
  origin: string;
  params: OAuthParams;
}

// ─── Styled components ───────────────────────────────────────────

const ModeToggle = styled.div`
  display: flex;
  gap: 0;
  margin-bottom: 1.25rem;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border, #21262d);
`;

const Tab = styled.button<{ $active?: boolean }>`
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

const ScopeSection = styled.div`
  margin: 1rem 0;
`;

const RoomRow = styled.div<{ $selected?: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 0.85rem;
  border: 1px solid ${({ $selected }) => $selected ? "var(--accent, #58a6ff)" : "var(--border, #21262d)"};
  border-radius: 8px;
  margin-bottom: 0.5rem;
  background: ${({ $selected }) => $selected ? "var(--accent-soft, #1e3a5f)" : "var(--bg, #0d1117)"};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--accent, #58a6ff);
  }
`;

const RoomCheck = styled.input`
  accent-color: var(--accent, #58a6ff);
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
`;

const RoomInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const RoomName = styled.span`
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--fg, #c9d1d9);
`;

const RoomMeta = styled.span`
  font-size: 0.75rem;
  color: var(--dim, #484f58);
  margin-left: 0.5rem;
`;

const RoomDetail = styled.div`
  font-size: 0.75rem;
  color: var(--dim, #484f58);
  margin-top: 0.2rem;
`;

const ScopeSelect = styled.select`
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--border, #21262d);
  border-radius: 6px;
  background: var(--surface, #161b22);
  color: var(--fg, #c9d1d9);
  font-size: 0.8rem;
  font-family: inherit;
  flex-shrink: 0;
`;

const OptionRow = styled.label`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0;
  font-size: 0.85rem;
  color: var(--fg, #c9d1d9);
  cursor: pointer;
`;

const CheckBox = styled.input`
  accent-color: var(--accent, #58a6ff);
  width: 0.9rem;
  height: 0.9rem;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
  justify-content: flex-end;
`;

const HintText = styled.p`
  font-size: 0.75rem;
  color: var(--dim, #484f58);
  margin-top: 0.5rem;
  line-height: 1.45;
`;

const SectionLabel = styled.p`
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--fg, #c9d1d9);
  margin-bottom: 0.5rem;
`;

const EmptyState = styled.p`
  font-size: 0.85rem;
  color: var(--dim, #484f58);
  padding: 0.75rem;
  text-align: center;
  border: 1px dashed var(--border, #21262d);
  border-radius: 8px;
`;

// ─── Types ───────────────────────────────────────────────────────

type Step = "auth" | "consent";
type Mode = "signin" | "register";
type RoomScopeLevel = "full" | "observe";

interface RoomData {
  room_id: string;
  access: string;
  label: string | null;
  is_default: boolean;
  agents: Array<{ id: string; name: string; role: string; status: string }>;
  roles: Record<string, any>;
}

interface RoomSelection {
  selected: boolean;
  level: RoomScopeLevel;
}

// ─── Component ───────────────────────────────────────────────────

export function AuthorizePage({ origin, params }: AuthorizePageProps) {
  const [step, setStep] = useState<Step>("auth");
  const [mode, setMode] = useState<Mode>("signin");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [selections, setSelections] = useState<Record<string, RoomSelection>>({});
  const [canCreate, setCanCreate] = useState(true);

  function clearStatus() {
    setStatus("");
    setError("");
  }

  async function doAuth() {
    clearStatus();
    try {
      if (mode === "register") {
        await doRegister();
      } else {
        await doSignIn();
      }
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    }
  }

  async function doSignIn() {
    setStatus("Generating authentication options...");
    const { startAuthentication } = await import(
      "https://esm.sh/@simplewebauthn/browser@13"
    );
    const optRes = await fetch(`${origin}/webauthn/authenticate/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const optData = await optRes.json();
    if (!optRes.ok) { setError(optData.error); setStatus(""); return; }

    setStatus("Touch your authenticator...");
    const assertResp = await startAuthentication({ optionsJSON: optData.options });

    setStatus("Verifying...");
    const verRes = await fetch(`${origin}/webauthn/authenticate/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: optData.challengeId, response: assertResp }),
    });
    const verData = await verRes.json();
    if (!verRes.ok || !verData.verified) { setError(verData.error || "Authentication failed"); setStatus(""); return; }

    setSessionId(verData.sessionId);
    setStep("consent");
    setStatus("");
    loadRooms(verData.sessionId);
  }

  async function doRegister() {
    const usernameInput = (document.getElementById("username") as HTMLInputElement)?.value?.trim();
    if (!usernameInput) { setError("Username required"); return; }

    setStatus("Generating passkey options...");
    const { startRegistration } = await import(
      "https://esm.sh/@simplewebauthn/browser@13"
    );
    const optRes = await fetch(`${origin}/webauthn/register/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: usernameInput }),
    });
    const optData = await optRes.json();
    if (!optRes.ok) { setError(optData.error); setStatus(""); return; }

    setStatus("Touch your authenticator...");
    const attResp = await startRegistration({ optionsJSON: optData.options });

    setStatus("Verifying...");
    const verRes = await fetch(`${origin}/webauthn/register/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: optData.challengeId, userId: optData.userId,
        username: optData.username, response: attResp,
      }),
    });
    const verData = await verRes.json();
    if (!verRes.ok || !verData.verified) { setError(verData.error || "Registration failed"); setStatus(""); return; }

    setSessionId(verData.sessionId);
    setStep("consent");
    setStatus("");
    loadRooms(verData.sessionId);
  }

  async function loadRooms(sid: string) {
    try {
      const res = await fetch(`${origin}/manage/api/rooms`, {
        headers: { "X-Session-Id": sid },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.rooms) return;
      setRooms(data.rooms);
      // Default: all rooms selected with full access
      const initial: Record<string, RoomSelection> = {};
      for (const r of data.rooms) {
        initial[r.room_id] = { selected: true, level: "full" };
      }
      setSelections(initial);
    } catch { /* silent — rooms are optional for new users */ }
  }

  function toggleRoom(roomId: string) {
    setSelections(prev => ({
      ...prev,
      [roomId]: { ...prev[roomId], selected: !prev[roomId]?.selected },
    }));
  }

  function setRoomLevel(roomId: string, level: RoomScopeLevel) {
    setSelections(prev => ({
      ...prev,
      [roomId]: { ...prev[roomId], level },
    }));
  }

  function buildScopeString(): string {
    const parts: string[] = [];
    for (const [roomId, sel] of Object.entries(selections)) {
      if (!sel.selected) continue;
      if (sel.level === "observe") parts.push(`rooms:${roomId}:observe`);
      else parts.push(`rooms:${roomId}`);
    }
    if (canCreate) parts.push("create_rooms");
    // If no rooms selected and no legacy scope, add the legacy scope for compat
    if (parts.length === 0 || (parts.length === 1 && parts[0] === "create_rooms")) {
      parts.unshift("sync:rooms");
    }
    return parts.join(" ");
  }

  async function allow() {
    const scope = buildScopeString();
    const res = await fetch(`${origin}/oauth/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod,
        scope,
        state: params.state,
        resource: params.resource,
      }),
    });
    const data = await res.json();
    if (data.redirect) {
      window.location.href = data.redirect;
    } else if (data.error) {
      setError(data.error);
    }
  }

  function deny() {
    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set("error", "access_denied");
    if (params.state) redirect.searchParams.set("state", params.state);
    window.location.href = redirect.toString();
  }

  const selectedCount = Object.values(selections).filter(s => s.selected).length;

  return (
    <PageWrapper>
      <Container>
        {step === "auth" && (
          <Card>
            <Title>sync<TitleDim>·mcp</TitleDim></Title>
            <Subtitle>
              Sign in with a passkey to grant{" "}
              <strong>{params.clientName}</strong> access to your sync rooms.
            </Subtitle>

            <ModeToggle>
              <Tab $active={mode === "signin"} onClick={() => { setMode("signin"); clearStatus(); }}>
                Sign in
              </Tab>
              <Tab $active={mode === "register"} onClick={() => { setMode("register"); clearStatus(); }}>
                New account
              </Tab>
            </ModeToggle>

            {mode === "register" && (
              <div>
                <Label htmlFor="username">Username</Label>
                <Input type="text" id="username" placeholder="Choose a username"
                  maxLength={64} autoComplete="username webauthn" />
              </div>
            )}

            <PrimaryButton onClick={doAuth}>
              {mode === "register" ? "Create account with passkey" : "Sign in with passkey"}
            </PrimaryButton>

            {status && <StatusText>{status}</StatusText>}
            {error && <ErrorText>{error}</ErrorText>}
          </Card>
        )}

        {step === "consent" && (
          <Card>
            <Title>sync<TitleDim>·mcp</TitleDim></Title>
            <Subtitle>
              Grant <strong>{params.clientName}</strong> access?
            </Subtitle>

            <ScopeSection>
              {rooms.length > 0 ? (
                <>
                  <SectionLabel>Select rooms to grant access:</SectionLabel>
                  {rooms.map(r => {
                    const sel = selections[r.room_id];
                    const agentCount = r.agents?.length ?? 0;
                    const roleCount = Object.keys(r.roles ?? {}).length;
                    return (
                      <RoomRow key={r.room_id} $selected={sel?.selected}
                        onClick={() => toggleRoom(r.room_id)}>
                        <RoomCheck type="checkbox" checked={sel?.selected ?? false}
                          onChange={() => toggleRoom(r.room_id)}
                          onClick={e => e.stopPropagation()} />
                        <RoomInfo>
                          <RoomName>{r.label ?? r.room_id}</RoomName>
                          <RoomMeta>[{r.access}]</RoomMeta>
                          {(agentCount > 0 || roleCount > 0) && (
                            <RoomDetail>
                              {agentCount > 0 && `${agentCount} agent${agentCount > 1 ? "s" : ""}`}
                              {agentCount > 0 && roleCount > 0 && " · "}
                              {roleCount > 0 && `${roleCount} role${roleCount > 1 ? "s" : ""}`}
                            </RoomDetail>
                          )}
                        </RoomInfo>
                        {sel?.selected && (
                          <ScopeSelect value={sel.level}
                            onChange={e => { e.stopPropagation(); setRoomLevel(r.room_id, e.target.value as RoomScopeLevel); }}
                            onClick={e => e.stopPropagation()}>
                            <option value="full">Full access</option>
                            <option value="observe">Observe only</option>
                          </ScopeSelect>
                        )}
                      </RoomRow>
                    );
                  })}
                </>
              ) : (
                <EmptyState>
                  No rooms yet. The client can create rooms on your behalf.
                </EmptyState>
              )}

              <OptionRow style={{ marginTop: "0.75rem" }}>
                <CheckBox type="checkbox" checked={canCreate}
                  onChange={e => setCanCreate(e.target.checked)} />
                Allow creating new rooms
              </OptionRow>

              <HintText>
                {selectedCount > 0
                  ? `${selectedCount} room${selectedCount > 1 ? "s" : ""} selected. The client can observe, embody agents, and invoke actions in granted rooms.`
                  : "No rooms selected. The client will only be able to create new rooms."}
              </HintText>
            </ScopeSection>

            {error && <ErrorText>{error}</ErrorText>}

            <ButtonRow>
              <SecondaryButton onClick={deny}>Deny</SecondaryButton>
              <PrimaryButton onClick={allow} style={{ width: "auto", padding: "0.7rem 2rem" }}>
                Allow
              </PrimaryButton>
            </ButtonRow>
          </Card>
        )}
      </Container>
    </PageWrapper>
  );
}
