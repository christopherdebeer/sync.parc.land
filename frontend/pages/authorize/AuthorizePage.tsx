/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** AuthorizePage — OAuth sign-in/register, then redirect to unified consent.
 *
 * Step 1: Sign in (passkey) or Register (username + passkey)
 * Step 2: Redirect to /auth/consent?mode=oauth with session + OAuth params
 */
import { useState } from "https://esm.sh/react@18.2.0";
import { styled } from "../../styled.ts";
import {
  PageWrapper, Container, Card, Title, TitleDim, Subtitle,
  Label, Input, PrimaryButton, StatusText, ErrorText,
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

const ModeToggle = styled.div`
  display: flex; gap: 0; margin-bottom: 1.25rem; border-radius: 8px;
  overflow: hidden; border: 1px solid var(--border, #21262d);
`;

const Tab = styled.button<{ $active?: boolean }>`
  flex: 1; padding: 0.5rem; border: none;
  background: ${({ $active }) => ($active ? "var(--surface2)" : "transparent")};
  color: ${({ $active }) => ($active ? "var(--fg)" : "var(--dim)")};
  cursor: pointer; font-size: 0.85rem; transition: all 0.2s; font-family: inherit;
`;

type Mode = "signin" | "register";

export function AuthorizePage({ origin, params }: AuthorizePageProps) {
  const [mode, setMode] = useState<Mode>("signin");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  function clearStatus() { setStatus(""); setError(""); }

  function redirectToConsent(sid: string) {
    const u = new URL(`${origin}/auth/consent`);
    u.searchParams.set("mode", "oauth");
    u.searchParams.set("session_id", sid);
    u.searchParams.set("client_id", params.clientId);
    u.searchParams.set("client_name", params.clientName);
    u.searchParams.set("redirect_uri", params.redirectUri);
    u.searchParams.set("code_challenge", params.codeChallenge);
    u.searchParams.set("code_challenge_method", params.codeChallengeMethod);
    u.searchParams.set("scope", params.scope);
    u.searchParams.set("state", params.state);
    u.searchParams.set("resource", params.resource);
    window.location.href = u.toString();
  }

  async function doAuth() {
    clearStatus();
    try {
      if (mode === "register") await doRegister();
      else await doSignIn();
    } catch (err: any) { setError(err.message || "Authentication failed"); }
  }

  async function doSignIn() {
    setStatus("Generating authentication options...");
    const { startAuthentication } = await import("https://esm.sh/@simplewebauthn/browser@13");
    const optRes = await fetch(`${origin}/webauthn/authenticate/options`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    const optData = await optRes.json();
    if (!optRes.ok) { setError(optData.error); setStatus(""); return; }
    setStatus("Touch your authenticator...");
    const assertResp = await startAuthentication({ optionsJSON: optData.options });
    setStatus("Verifying...");
    const verRes = await fetch(`${origin}/webauthn/authenticate/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: optData.challengeId, response: assertResp }),
    });
    const verData = await verRes.json();
    if (!verRes.ok || !verData.verified) { setError(verData.error || "Authentication failed"); setStatus(""); return; }
    redirectToConsent(verData.sessionId);
  }

  async function doRegister() {
    const usernameInput = (document.getElementById("username") as HTMLInputElement)?.value?.trim();
    if (!usernameInput) { setError("Username required"); return; }
    setStatus("Generating passkey options...");
    const { startRegistration } = await import("https://esm.sh/@simplewebauthn/browser@13");
    const optRes = await fetch(`${origin}/webauthn/register/options`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: usernameInput }),
    });
    const optData = await optRes.json();
    if (!optRes.ok) { setError(optData.error); setStatus(""); return; }
    setStatus("Touch your authenticator...");
    const attResp = await startRegistration({ optionsJSON: optData.options });
    setStatus("Verifying...");
    const verRes = await fetch(`${origin}/webauthn/register/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId: optData.challengeId, userId: optData.userId, username: optData.username, response: attResp }),
    });
    const verData = await verRes.json();
    if (!verRes.ok || !verData.verified) { setError(verData.error || "Registration failed"); setStatus(""); return; }
    redirectToConsent(verData.sessionId);
  }

  return (
    <PageWrapper>
      <Container>
        <Card>
          <Title>sync<TitleDim>·mcp</TitleDim></Title>
          <Subtitle>
            Sign in with a passkey to grant <strong>{params.clientName}</strong> access to your sync rooms.
          </Subtitle>
          <ModeToggle>
            <Tab $active={mode === "signin"} onClick={() => { setMode("signin"); clearStatus(); }}>Sign in</Tab>
            <Tab $active={mode === "register"} onClick={() => { setMode("register"); clearStatus(); }}>New account</Tab>
          </ModeToggle>
          {mode === "register" && (
            <div>
              <Label htmlFor="username">Username</Label>
              <Input type="text" id="username" placeholder="Choose a username" maxLength={64} autoComplete="username webauthn" />
            </div>
          )}
          <PrimaryButton onClick={doAuth}>
            {mode === "register" ? "Create account with passkey" : "Sign in with passkey"}
          </PrimaryButton>
          {status && <StatusText>{status}</StatusText>}
          {error && <ErrorText>{error}</ErrorText>}
        </Card>
      </Container>
    </PageWrapper>
  );
}
