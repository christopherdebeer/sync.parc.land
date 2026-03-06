/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** AuthorizePage — OAuth sign-in/register + consent.
 *
 * Two-step flow:
 *   1. Sign in (passkey) or Register (username + passkey)
 *   2. Consent screen: grant access, pick default room, allow/deny
 *
 * Server validates OAuth params and passes them as props.
 * Client hydration adds WebAuthn + consent interactions.
 */
import { useState, useEffect } from "https://esm.sh/react@18.2.0";
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

// ─── Authorize-specific styled components ────────────────────────

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

const ScopeBox = styled.div`
  background: var(--bg, #0d1117);
  border: 1px solid var(--border, #21262d);
  border-radius: 8px;
  padding: 1rem;
  margin: 1rem 0;
  font-size: 0.85rem;

  code {
    color: var(--purple, #bc8cff);
  }

  ul {
    margin: 0.5rem 0 0 1.25rem;
    color: #999;
  }

  li {
    margin: 0.25rem 0;
  }
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
  justify-content: flex-end;
`;

const RoomPicker = styled.div`
  margin-top: 0.5rem;
`;

const RoomSelect = styled.select`
  width: 100%;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border, #21262d);
  border-radius: 8px;
  background: var(--bg, #0d1117);
  color: var(--fg, #c9d1d9);
  font-size: 0.85rem;
  font-family: inherit;
  margin-bottom: 0.5rem;
`;

const HintText = styled.p`
  font-size: 0.75rem;
  color: #666;
`;

const PickerLabel = styled.p`
  font-size: 0.85rem;
  color: #999;
  margin-bottom: 0.5rem;
`;

// ─── Component ───────────────────────────────────────────────────

type Step = "auth" | "consent";
type Mode = "signin" | "register";

interface RoomOption {
  vaultId: string;
  roomId: string;
  isDefault: boolean;
}

export function AuthorizePage({ origin, params }: AuthorizePageProps) {
  const [step, setStep] = useState<Step>("auth");
  const [mode, setMode] = useState<Mode>("signin");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [selectedRoom, setSelectedRoom] = useState("");

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
    setStep("consent");
    setStatus("");
    loadRoomPicker(verData.sessionId);
  }

  async function doRegister() {
    const usernameInput = (
      document.getElementById("username") as HTMLInputElement
    )?.value?.trim();
    if (!usernameInput) {
      setError("Username required");
      return;
    }

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
    if (!optRes.ok) {
      setError(optData.error);
      setStatus("");
      return;
    }

    setStatus("Touch your authenticator...");
    const attResp = await startRegistration({
      optionsJSON: optData.options,
    });

    setStatus("Verifying...");
    const verRes = await fetch(`${origin}/webauthn/register/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: optData.challengeId,
        userId: optData.userId,
        username: optData.username,
        response: attResp,
      }),
    });
    const verData = await verRes.json();
    if (!verRes.ok || !verData.verified) {
      setError(verData.error || "Registration failed");
      setStatus("");
      return;
    }

    setSessionId(verData.sessionId);
    setStep("consent");
    setStatus("");
    loadRoomPicker(verData.sessionId);
  }

  async function loadRoomPicker(sid: string) {
    try {
      const res = await fetch(`${origin}/manage/api/vault`, {
        headers: { "X-Session-Id": sid },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.entries || data.entries.length === 0) return;

      const seen: Record<string, RoomOption> = {};
      for (const e of data.entries) {
        if (!seen[e.room_id]) {
          seen[e.room_id] = {
            vaultId: e.id,
            roomId: e.room_id,
            isDefault: e.is_default,
          };
        }
        if (e.is_default) seen[e.room_id].isDefault = true;
      }
      const roomList = Object.values(seen);
      setRooms(roomList);

      const defaultRoom = roomList.find((r) => r.isDefault);
      if (defaultRoom) setSelectedRoom(defaultRoom.vaultId);
    } catch {
      // Silently fail — picker is optional
    }
  }

  async function allow() {
    // Set default room if selected
    if (selectedRoom) {
      await fetch(`${origin}/manage/api/vault/${selectedRoom}/default`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Id": sessionId || "",
        },
      });
    }

    const res = await fetch(`${origin}/oauth/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        clientId: params.clientId,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        codeChallengeMethod: params.codeChallengeMethod,
        scope: params.scope,
        state: params.state,
        resource: params.resource,
      }),
    });
    const data = await res.json();
    if (data.redirect) {
      window.location.href = data.redirect;
    }
  }

  function deny() {
    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set("error", "access_denied");
    if (params.state) redirect.searchParams.set("state", params.state);
    window.location.href = redirect.toString();
  }

  return (
    <PageWrapper>
      <Container>
        {step === "auth" && (
          <Card>
            <Title>
              sync<TitleDim>·mcp</TitleDim>
            </Title>
            <Subtitle>
              Sign in with a passkey to grant{" "}
              <strong>{params.clientName}</strong> access to your sync rooms.
            </Subtitle>

            <ModeToggle>
              <Tab
                $active={mode === "signin"}
                onClick={() => {
                  setMode("signin");
                  clearStatus();
                }}
              >
                Sign in
              </Tab>
              <Tab
                $active={mode === "register"}
                onClick={() => {
                  setMode("register");
                  clearStatus();
                }}
              >
                New account
              </Tab>
            </ModeToggle>

            {mode === "register" && (
              <div>
                <Label htmlFor="username">Username</Label>
                <Input
                  type="text"
                  id="username"
                  placeholder="Choose a username"
                  maxLength={64}
                  autoComplete="username webauthn"
                />
              </div>
            )}

            <PrimaryButton onClick={doAuth}>
              {mode === "register"
                ? "Create account with passkey"
                : "Sign in with passkey"}
            </PrimaryButton>

            {status && <StatusText>{status}</StatusText>}
            {error && <ErrorText>{error}</ErrorText>}
          </Card>
        )}

        {step === "consent" && (
          <Card>
            <Title>
              sync<TitleDim>·mcp</TitleDim>
            </Title>
            <Subtitle>
              Grant <strong>{params.clientName}</strong> access?
            </Subtitle>

            <ScopeBox>
              <p>
                Scope: <code>{params.scope}</code>
              </p>
              <ul>
                <li>Read room context and state</li>
                <li>Invoke actions and send messages</li>
                <li>Manage your token vault</li>
              </ul>
            </ScopeBox>

            {rooms.length > 0 && (
              <RoomPicker>
                <PickerLabel>Active room for this client:</PickerLabel>
                <RoomSelect
                  value={selectedRoom}
                  onChange={(e) => setSelectedRoom(e.target.value)}
                >
                  <option value="">All rooms (vault default)</option>
                  {rooms.map((r) => (
                    <option key={r.vaultId} value={r.vaultId}>
                      {r.roomId}
                      {r.isDefault ? " (current default)" : ""}
                    </option>
                  ))}
                </RoomSelect>
                <HintText>
                  Sets your default room. The client will use this room when no
                  room is specified.
                </HintText>
              </RoomPicker>
            )}

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
