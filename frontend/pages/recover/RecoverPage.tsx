/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** RecoverPage — recovery token → new passkey registration.
 *
 * Three-step flow:
 *   1. Enter recovery token → validate
 *   2. Token verified → register new passkey (WebAuthn)
 *   3. Success → link to /manage
 *
 * Isomorphic: server renders step 1 (the form), client hydration
 * adds the WebAuthn interactivity.
 */
import { useState, useRef } from "https://esm.sh/react@18.2.0";
import { Nav } from "../../components/Nav.tsx";
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
  StatusText,
  ErrorText,
  SuccessText,
  AccentLink,
} from "../../components/mcp.tsx";

export interface RecoverPageProps {
  origin: string;
}

type Step = "token" | "register" | "done";

export function RecoverPage({ origin }: RecoverPageProps) {
  const [step, setStep] = useState<Step>("token");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tokenId, setTokenId] = useState<string | null>(null);
  const regOptionsRef = useRef<any>(null);

  async function handleValidateToken(e?: React.FormEvent) {
    e?.preventDefault();
    setError("");
    setStatus("Validating token...");

    const tokenInput = (document.getElementById("recovery-token") as HTMLInputElement)?.value?.trim();
    if (!tokenInput) {
      setError("Enter your recovery token");
      setStatus("");
      return;
    }

    try {
      const res = await fetch(`${origin}/recover/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenInput }),
      });
      const data = await res.json();
      if (!res.ok || !data.verified) {
        setError(data.error || "Invalid token");
        setStatus("");
        return;
      }

      setSessionId(data.sessionId);
      setTokenId(data.tokenId);

      // Get registration options to show username
      const optRes = await fetch(`${origin}/recover/register/options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: data.sessionId }),
      });
      const optData = await optRes.json();
      if (!optRes.ok) {
        setError(optData.error || "Failed to get options");
        setStatus("");
        return;
      }

      regOptionsRef.current = optData;
      setUsername(optData.username);
      setStep("register");
      setStatus("");
    } catch (err: any) {
      setError(err.message);
      setStatus("");
    }
  }

  async function handleRegisterPasskey() {
    setError("");
    setStatus("Touch your authenticator...");

    try {
      // Dynamic import — only loaded client-side when needed
      const { startRegistration } = await import(
        "https://esm.sh/@simplewebauthn/browser@13"
      );

      const attResp = await startRegistration({
        optionsJSON: regOptionsRef.current.options,
      });

      setStatus("Verifying...");

      const verRes = await fetch(`${origin}/recover/register/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: regOptionsRef.current.challengeId,
          sessionId,
          tokenId,
          response: attResp,
        }),
      });
      const verData = await verRes.json();
      if (!verRes.ok || !verData.verified) {
        setError(verData.error || "Registration failed");
        setStatus("");
        return;
      }

      setStep("done");
      setStatus("");
    } catch (err: any) {
      setError(err.message);
      setStatus("");
    }
  }

  return (
    <>
      <Nav />
      <PageWrapper>
        <Container>
        {step === "token" && (
          <Card>
            <Title>
              sync<TitleDim>·recover</TitleDim>
            </Title>
            <Subtitle>
              Enter your recovery token to register a new passkey for an
              existing account.
            </Subtitle>
            <form onSubmit={handleValidateToken}>
              <Label htmlFor="recovery-token">Recovery token</Label>
              <Input
                type="text"
                id="recovery-token"
                name="token"
                placeholder="recover_..."
                autoComplete="off"
                spellCheck={false}
              />
              <PrimaryButton type="submit">Verify token</PrimaryButton>
            </form>
            {status && <StatusText>{status}</StatusText>}
            {error && <ErrorText>{error}</ErrorText>}
          </Card>
        )}

        {step === "register" && (
          <Card>
            <Title>
              sync<TitleDim>·recover</TitleDim>
            </Title>
            <Subtitle>
              Token verified for <strong>{username}</strong>. Register a new
              passkey for this account.
            </Subtitle>
            <PrimaryButton onClick={handleRegisterPasskey}>
              Register new passkey
            </PrimaryButton>
            {status && <StatusText>{status}</StatusText>}
            {error && <ErrorText>{error}</ErrorText>}
          </Card>
        )}

        {step === "done" && (
          <Card>
            <Title>
              sync<TitleDim>·recover</TitleDim>
            </Title>
            <SuccessText style={{ marginBottom: "1rem" }}>
              New passkey registered successfully. Your recovery token has been
              consumed.
            </SuccessText>
            <Subtitle>
              You can now <AccentLink href="/manage">sign in</AccentLink> with
              your new passkey, or close this page.
            </Subtitle>
          </Card>
        )}
      </Container>
      </PageWrapper>
    </>
  );
}
