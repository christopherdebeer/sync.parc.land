/** @jsxImportSource https://esm.sh/react@18.2.0 */
/**
 * auth.ts — OAuth 2.1 + WebAuthn handlers for sync-mcp
 *
 * Implements:
 * - Protected Resource Metadata (RFC 9728)
 * - Authorization Server Metadata (RFC 8414)
 * - Dynamic Client Registration (RFC 7591)
 * - Authorization Code + PKCE flow
 * - WebAuthn passkey registration/authentication
 * - Token vault management API
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13";
import type {
  AuthenticatorTransportFuture,
} from "npm:@simplewebauthn/server@13";

import * as db from "./db.ts";
import { renderPage } from "../frontend/ssr.ts";
import { RecoverPage } from "../frontend/pages/recover/RecoverPage.tsx";
import { ManagePage } from "../frontend/pages/manage/ManagePage.tsx";
import { AuthorizePage } from "../frontend/pages/authorize/AuthorizePage.tsx";

// ─── Configuration ───────────────────────────────────────────────

const TOKEN_EXPIRY_SECS = 3600; // 1 hour access tokens
const RP_NAME = "sync-mcp";
const STABLE_RP_ID = Deno.env.get("WEBAUTHN_RP_ID") ?? "parc.land";

function getOrigin(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

function getRpId(req: Request): string {
  const hostname = new URL(req.url).hostname;
  // Use stable RP ID if origin is compatible (hostname ends with .rpId or equals rpId)
  if (hostname === STABLE_RP_ID || hostname.endsWith("." + STABLE_RP_ID)) {
    return STABLE_RP_ID;
  }
  // Dev fallback: use hostname directly (each dev endpoint gets its own passkeys)
  return hostname;
}

function json(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ─── Protected Resource Metadata ─────────────────────────────────

export function handlePRM(req: Request): Response {
  const origin = getOrigin(req);
  return json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    resource_documentation: "https://sync.parc.land",
  });
}

// ─── Authorization Server Metadata ───────────────────────────────

export function handleASMetadata(req: Request): Response {
  const origin = getOrigin(req);
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    scopes_supported: ["sync:rooms", "sync:rooms.admin"],
  });
}

// ─── Dynamic Client Registration ─────────────────────────────────

export async function handleDCR(req: Request): Promise<Response> {
  const body = await req.json();
  const redirectUris = body.redirect_uris;
  if (
    !redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0
  ) {
    return json({
      error: "invalid_client_metadata",
      error_description: "redirect_uris required",
    }, 400);
  }

  const clientId = await db.generateToken("client");
  const clientSecret = body.token_endpoint_auth_method === "none"
    ? undefined
    : await db.generateToken("secret");

  await db.saveOAuthClient({
    clientId,
    clientSecret,
    redirectUris,
    clientName: body.client_name ?? null,
  });

  return json({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: redirectUris,
    client_name: body.client_name ?? null,
    token_endpoint_auth_method: clientSecret ? "client_secret_post" : "none",
  }, 201);
}

// ─── Authorization Endpoint ──────────────────────────────────────

export async function handleAuthorize(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const clientId = url.searchParams.get("client_id");
  const redirectUri = url.searchParams.get("redirect_uri");
  const responseType = url.searchParams.get("response_type");
  const codeChallenge = url.searchParams.get("code_challenge");
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") ??
    "S256";
  const scope = url.searchParams.get("scope") ?? "sync:rooms";
  const state = url.searchParams.get("state") ?? "";
  const resource = url.searchParams.get("resource") ?? "";

  // Validate params
  if (!clientId || !redirectUri || responseType !== "code" || !codeChallenge) {
    return html(
      errorPage(
        "Missing required parameters (client_id, redirect_uri, response_type=code, code_challenge)",
      ),
      400,
    );
  }

  const client = await db.getOAuthClient(clientId);
  if (!client) {
    return html(errorPage("Unknown client_id"), 400);
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return html(errorPage("redirect_uri not registered for this client"), 400);
  }

  const origin = getOrigin(req);
  const rpId = getRpId(req);

  const oauthParams = {
    clientId,
    clientName: client.clientName ?? "MCP Client",
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    scope,
    state,
    resource,
  };

  // Serve the SSR React page
  return renderPage({
    element: <AuthorizePage origin={origin} params={oauthParams} />,
    entry: "/frontend/pages/authorize/client.tsx",
    props: { origin, params: oauthParams },
    title: "Sign in — sync·mcp",
  });
}

// ─── WebAuthn: Registration Options ──────────────────────────────

export async function handleRegisterOptions(req: Request): Promise<Response> {
  const { username } = await req.json();
  if (
    !username || typeof username !== "string" || username.length < 1 ||
    username.length > 64
  ) {
    return json({ error: "Username required (1-64 chars)" }, 400);
  }

  // Check if username already exists
  const existing = await db.getUserByUsername(username);
  if (existing) {
    return json(
      { error: "Username already taken. Try signing in instead." },
      409,
    );
  }

  const userId = db.generateId();
  const rpId = getRpId(req);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId,
    userName: username,
    userID: new TextEncoder().encode(userId),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  // Store challenge
  const challengeId = db.generateId();
  await db.saveChallenge(
    challengeId,
    options.challenge,
    "registration",
    userId,
  );

  return json({
    options,
    challengeId,
    userId,
    username,
  });
}

// ─── WebAuthn: Registration Verify ───────────────────────────────

export async function handleRegisterVerify(req: Request): Promise<Response> {
  const { challengeId, userId, username, response } = await req.json();

  const challenge = await db.getChallenge(challengeId);
  if (!challenge || challenge.type !== "registration") {
    return json({ error: "Invalid or expired challenge" }, 400);
  }

  const rpId = getRpId(req);
  const origin = getOrigin(req);

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return json({ error: "Verification failed" }, 400);
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    // Create user
    await db.createUser(userId, username);

    // Save credential
    await db.saveCredential({
      id: credential.id,
      userId,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports as string[],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      rpId: getRpId(req),
    });

    await db.deleteChallenge(challengeId);

    // Create session
    const sessionId = await db.createSession(userId);

    return json({ verified: true, sessionId });
  } catch (err) {
    return json(
      { error: `Registration failed: ${(err as Error).message}` },
      400,
    );
  }
}

// ─── WebAuthn: Authentication Options ────────────────────────────

export async function handleAuthOptions(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const rpId = getRpId(req);

  // If username provided, get their credentials for allowCredentials
  let allowCredentials: {
    id: string;
    transports?: AuthenticatorTransportFuture[];
  }[] | undefined;
  if (body.username) {
    const user = await db.getUserByUsername(body.username);
    if (user) {
      const creds = await db.getCredentialsByUserId(user.id, rpId);
      allowCredentials = creds.map((c) => ({
        id: c.id,
        transports: c.transports as AuthenticatorTransportFuture[] | undefined,
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: rpId,
    userVerification: "preferred",
    allowCredentials,
  });

  const challengeId = db.generateId();
  await db.saveChallenge(challengeId, options.challenge, "authentication");

  return json({ options, challengeId });
}

// ─── WebAuthn: Authentication Verify ─────────────────────────────

export async function handleAuthVerify(req: Request): Promise<Response> {
  const { challengeId, response } = await req.json();

  const challenge = await db.getChallenge(challengeId);
  if (!challenge || challenge.type !== "authentication") {
    return json({ error: "Invalid or expired challenge" }, 400);
  }

  // Find credential
  const credential = await db.getCredentialById(response.id);
  if (!credential) {
    return json({ error: "Unknown credential" }, 400);
  }

  const rpId = getRpId(req);
  const origin = getOrigin(req);

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      credential: {
        id: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports as
          | AuthenticatorTransportFuture[]
          | undefined,
      },
    });

    if (!verification.verified) {
      return json({ error: "Authentication failed" }, 400);
    }

    // Update counter
    await db.updateCredentialCounter(
      credential.id,
      verification.authenticationInfo.newCounter,
    );
    await db.deleteChallenge(challengeId);

    // Create session
    const sessionId = await db.createSession(credential.userId);

    return json({ verified: true, sessionId });
  } catch (err) {
    return json({ error: `Auth failed: ${(err as Error).message}` }, 400);
  }
}

// ─── Consent (exchange session for auth code) ────────────────────

export async function handleConsent(req: Request): Promise<Response> {
  const body = await req.json();
  const {
    sessionId,
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    scope,
    state,
    resource,
  } = body;

  const session = await db.validateSession(sessionId);
  if (!session) {
    return json({ error: "Invalid or expired session" }, 401);
  }
  if (session.scope !== "consent") {
    return json({ error: "Session not authorized for consent" }, 403);
  }

  // Generate authorization code
  const code = await db.generateToken("authz");
  await db.saveAuthCode({
    code,
    clientId,
    userId: session.userId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    scope,
    resource,
  });

  await db.deleteSession(sessionId);

  // Build redirect URL
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);

  return json({ redirect: redirect.toString() });
}

// ─── Token Endpoint ──────────────────────────────────────────────

export async function handleToken(req: Request): Promise<Response> {
  let body: Record<string, string>;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await req.text();
    body = Object.fromEntries(new URLSearchParams(text));
  } else {
    body = await req.json();
  }

  const grantType = body.grant_type;

  if (grantType === "authorization_code") {
    return handleAuthCodeExchange(body);
  } else if (grantType === "refresh_token") {
    return handleRefreshExchange(body);
  }

  return json({ error: "unsupported_grant_type" }, 400);
}

async function handleAuthCodeExchange(
  body: Record<string, string>,
): Promise<Response> {
  const { code, redirect_uri, code_verifier, client_id } = body;

  if (!code || !redirect_uri || !code_verifier) {
    return json({
      error: "invalid_request",
      error_description: "code, redirect_uri, code_verifier required",
    }, 400);
  }

  const authCode = await db.consumeAuthCode(code);
  if (!authCode) {
    return json({
      error: "invalid_grant",
      error_description: "Invalid, expired, or already-used code",
    }, 400);
  }

  // Verify redirect_uri matches
  if (authCode.redirectUri !== redirect_uri) {
    return json({
      error: "invalid_grant",
      error_description: "redirect_uri mismatch",
    }, 400);
  }

  // Verify client_id matches
  if (client_id && authCode.clientId !== client_id) {
    return json({
      error: "invalid_grant",
      error_description: "client_id mismatch",
    }, 400);
  }

  // Verify PKCE
  const expectedChallenge = await db.sha256(code_verifier);
  if (expectedChallenge !== authCode.codeChallenge) {
    return json({
      error: "invalid_grant",
      error_description: "PKCE verification failed",
    }, 400);
  }

  // Issue tokens
  const accessToken = await db.generateToken("smcp_at");
  const refreshToken = await db.generateToken("smcp_rt");

  await db.saveAccessToken({
    token: accessToken,
    userId: authCode.userId,
    clientId: authCode.clientId,
    scope: authCode.scope ?? undefined,
    expiresInSec: TOKEN_EXPIRY_SECS,
  });

  await db.saveRefreshToken({
    token: refreshToken,
    userId: authCode.userId,
    clientId: authCode.clientId,
    scope: authCode.scope ?? undefined,
  });

  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: TOKEN_EXPIRY_SECS,
    refresh_token: refreshToken,
    scope: authCode.scope ?? "sync:rooms",
  });
}

async function handleRefreshExchange(
  body: Record<string, string>,
): Promise<Response> {
  const { refresh_token } = body;
  if (!refresh_token) {
    return json({ error: "invalid_request" }, 400);
  }

  const rt = await db.consumeRefreshToken(refresh_token);
  if (!rt) {
    return json({
      error: "invalid_grant",
      error_description: "Invalid or expired refresh token",
    }, 400);
  }

  // Issue new tokens (rotate refresh token)
  const accessToken = await db.generateToken("smcp_at");
  const newRefreshToken = await db.generateToken("smcp_rt");

  await db.saveAccessToken({
    token: accessToken,
    userId: rt.userId,
    clientId: rt.clientId,
    scope: rt.scope ?? undefined,
    expiresInSec: TOKEN_EXPIRY_SECS,
  });

  await db.saveRefreshToken({
    token: newRefreshToken,
    userId: rt.userId,
    clientId: rt.clientId,
    scope: rt.scope ?? undefined,
  });

  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: TOKEN_EXPIRY_SECS,
    refresh_token: newRefreshToken,
    scope: rt.scope ?? "sync:rooms",
  });
}

// ─── Vault API ───────────────────────────────────────────────────

export async function handleVault(
  req: Request,
  userId: string,
): Promise<Response> {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean); // ["vault", ...]

  if (req.method === "GET") {
    const entries = await db.vaultList(userId);
    return json({
      entries: entries.map((e) => ({
        id: e.id,
        room_id: e.roomId,
        token_type: e.tokenType,
        label: e.label,
        is_default: e.isDefault,
        // Never expose the actual sync token in list view
        token_prefix: e.token.substring(0, 12) + "...",
      })),
    });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const { room_id, token, token_type, label, is_default } = body;
    if (!room_id || !token || !token_type) {
      return json({ error: "room_id, token, and token_type required" }, 400);
    }
    if (!["room", "agent", "view"].includes(token_type)) {
      return json({ error: "token_type must be room, agent, or view" }, 400);
    }
    const id = await db.vaultStore({
      userId,
      roomId: room_id,
      token,
      tokenType: token_type,
      label,
      isDefault: is_default,
    });
    return json({
      id,
      room_id,
      token_type,
      label,
      is_default: is_default ?? false,
    }, 201);
  }

  if (req.method === "DELETE" && pathParts.length >= 2) {
    const vaultId = pathParts[1];
    await db.vaultDelete(userId, vaultId);
    return json({ deleted: true, id: vaultId });
  }

  return json({ error: "Method not allowed" }, 405);
}

// ─── Token resolution for MCP tools ─────────────────────────────

export async function resolveToken(
  userId: string | null,
  room?: string,
  token?: string,
): Promise<{ room: string; token: string } | null> {
  // Explicit token always wins
  if (room && token) return { room, token };

  if (!userId) return null;

  // Room specified but no token → look up vault
  if (room) {
    const entries = await db.vaultGetForRoom(userId, room);
    console.log("resolveToken entries", entries);
    // Prefer agent token (identity) > room token (admin) > view token (read-only)
    const best = entries.find((e) => e.tokenType === "agent") ??
      entries.find((e) => e.tokenType === "room") ??
      entries[0];
    if (best) return { room, token: best.token };
    return null;
  }

  // No room, no token → use default
  const def = await db.vaultGetDefault(userId);
  console.log("resolveToken def", def);
  if (def) return { room: def.roomId, token: def.token };

  return null;
}

/** Resolve specifically the room (admin) token for a room. Used for privilege escalation
 *  when agent token gets scope_denied on shared-scope operations. */
export async function resolveAdminToken(
  userId: string | null,
  room: string,
): Promise<string | null> {
  if (!userId) return null;
  const entries = await db.vaultGetForRoom(userId, room);
  const roomEntry = entries.find((e) => e.tokenType === "room");
  return roomEntry?.token ?? null;
}

// ─── Management Page ─────────────────────────────────────────────

export function handleManagePage(req: Request): Response {
  const origin = getOrigin(req);
  return renderPage({
    element: <ManagePage origin={origin} />,
    entry: "/frontend/pages/manage/client.tsx",
    props: { origin },
    title: "Manage — sync·mcp",
  });
}

export async function handleManageApi(req: Request): Promise<Response> {
  const sessionId = req.headers.get("x-session-id");
  if (!sessionId) return json({ error: "Missing X-Session-Id header" }, 401);

  const session = await db.validateSession(sessionId);
  if (!session) {
    return json(
      { error: "Invalid or expired session. Please sign in again." },
      401,
    );
  }
  if (session.scope === "recovery") {
    return json(
      { error: "Recovery sessions cannot access management API" },
      403,
    );
  }

  const userId = session.userId;
  const url = new URL(req.url);
  const path = url.pathname.replace("/manage/api", "");

  // GET /manage/api/me — user info
  if (req.method === "GET" && path === "/me") {
    const user = await db.getUserById(userId);
    const creds = await db.getCredentialsByUserId(userId);
    return json({
      user: user
        ? { id: user.id, username: user.username, created_at: user.created_at }
        : null,
      passkeys: creds.map((c) => ({
        id: c.id.substring(0, 16) + "...",
        device_type: c.deviceType,
        backed_up: c.backedUp,
      })),
    });
  }

  // GET /manage/api/vault — full vault with tokens
  if (req.method === "GET" && path === "/vault") {
    const entries = await db.vaultList(userId);
    return json({
      entries: entries.map((e) => ({
        id: e.id,
        room_id: e.roomId,
        token: e.token,
        token_type: e.tokenType,
        label: e.label,
        is_default: e.isDefault,
      })),
    });
  }

  // DELETE /manage/api/vault/:id
  if (req.method === "DELETE" && path.startsWith("/vault/")) {
    const vaultId = path.split("/")[2];
    if (!vaultId) return json({ error: "Missing vault entry ID" }, 400);
    await db.vaultDelete(userId, vaultId);
    return json({ deleted: true, id: vaultId });
  }

  // POST /manage/api/vault/:id/default — set as default
  if (req.method === "POST" && path.match(/^\/vault\/[^/]+\/default$/)) {
    const vaultId = path.split("/")[2];
    // Clear all defaults for this user, then set the one
    const entries = await db.vaultList(userId);
    const target = entries.find((e) => e.id === vaultId);
    if (!target) return json({ error: "Vault entry not found" }, 404);

    // Clear all defaults
    for (const e of entries) {
      if (e.isDefault) {
        await db.vaultDelete(userId, e.id);
        await db.vaultStore({
          userId,
          roomId: e.roomId,
          token: e.token,
          tokenType: e.tokenType,
          label: e.label ?? undefined,
          isDefault: false,
        });
      }
    }
    // Re-add the target as default
    await db.vaultDelete(userId, vaultId);
    await db.vaultStore({
      userId,
      roomId: target.roomId,
      token: target.token,
      tokenType: target.tokenType,
      label: target.label ?? undefined,
      isDefault: true,
    });

    return json({ ok: true, default_room: target.roomId });
  }

  // POST /manage/api/recovery — generate recovery token
  if (req.method === "POST" && path === "/recovery") {
    const result = await db.createRecoveryToken(userId);
    if ("error" in result) return json({ error: result.error }, 400);
    return json({
      token: result.token,
      expires_at: result.expiresAt,
      warning: "Store this token safely. It will not be shown again.",
    }, 201);
  }

  // GET /manage/api/recovery — list recovery tokens (metadata only)
  if (req.method === "GET" && path === "/recovery") {
    const tokens = await db.listRecoveryTokens(userId);
    return json({ tokens });
  }

  // DELETE /manage/api/recovery/:id — revoke a recovery token
  if (req.method === "DELETE" && path.startsWith("/recovery/")) {
    const tokenId = path.split("/")[2];
    if (!tokenId) return json({ error: "Missing token ID" }, 400);
    await db.revokeRecoveryToken(userId, tokenId);
    return json({ deleted: true, id: tokenId });
  }

  return json({ error: "Not found" }, 404);
}

// ─── Recovery: passkey re-registration ───────────────────────────

export function handleRecoverPage(req: Request): Response {
  const origin = getOrigin(req);
  return renderPage({
    element: <RecoverPage origin={origin} />,
    entry: "/frontend/pages/recover/client.tsx",
    props: { origin },
    title: "Recover — sync·mcp",
  });
}

export async function handleRecoverValidate(req: Request): Promise<Response> {
  const { token } = await req.json();
  if (!token) return json({ error: "Recovery token required" }, 400);

  const result = await db.validateRecoveryToken(token);
  if (!result) {
    return json(
      { error: "Invalid, expired, or already-used recovery token" },
      400,
    );
  }

  // Create a registration-only session
  const sessionId = await db.createSession(result.userId, "recovery");

  // Don't consume yet — consume after successful passkey registration
  return json({ verified: true, sessionId, tokenId: result.tokenId });
}

export async function handleRecoverRegisterOptions(
  req: Request,
): Promise<Response> {
  const { sessionId } = await req.json();
  if (!sessionId) return json({ error: "Session required" }, 400);

  const session = await db.validateSession(sessionId);
  if (!session || session.scope !== "recovery") {
    return json({ error: "Invalid or expired recovery session" }, 400);
  }

  const user = await db.getUserById(session.userId);
  if (!user) return json({ error: "User not found" }, 400);

  const rpId = getRpId(req);
  const existingCreds = await db.getCredentialsByUserId(user.id, rpId);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId,
    userName: user.username,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
    excludeCredentials: existingCreds.map((c) => ({
      id: c.id,
      transports: c.transports as AuthenticatorTransportFuture[] | undefined,
    })),
  });

  const challengeId = db.generateId();
  await db.saveChallenge(
    challengeId,
    options.challenge,
    "recovery-registration",
    user.id,
  );

  return json({ options, challengeId, username: user.username });
}

export async function handleRecoverRegisterVerify(
  req: Request,
): Promise<Response> {
  const { challengeId, sessionId, tokenId, response } = await req.json();

  const session = await db.validateSession(sessionId);
  if (!session || session.scope !== "recovery") {
    return json({ error: "Invalid or expired recovery session" }, 400);
  }

  const challenge = await db.getChallenge(challengeId);
  if (!challenge || challenge.type !== "recovery-registration") {
    return json({ error: "Invalid or expired challenge" }, 400);
  }

  const rpId = getRpId(req);
  const origin = getOrigin(req);

  try {
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return json({ error: "Verification failed" }, 400);
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    await db.saveCredential({
      id: credential.id,
      userId: session.userId,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports as string[],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      rpId,
    });

    await db.deleteChallenge(challengeId);
    await db.consumeRecoveryToken(tokenId);
    await db.deleteSession(sessionId);

    return json({ verified: true, rpId });
  } catch (err) {
    return json(
      { error: `Registration failed: ${(err as Error).message}` },
      400,
    );
  }
}

// ─── HTML Pages ──────────────────────────────────────────────────

const ERROR_CSS = `*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#0d1117;color:#c9d1d9;min-height:100vh;display:flex;align-items:center;justify-content:center}.container{width:100%;max-width:420px;padding:1rem}.card{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:2rem}h1{font-size:1.5rem;margin-bottom:0.75rem;font-weight:600}.error{color:#f85149;font-size:0.85rem;margin-top:0.5rem}`;

function errorPage(message: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Error — sync-mcp</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${ERROR_CSS}</style>
</head><body>
<div class="container"><div class="card">
<h1>Error</h1><p class="error">${escapeHtml(message)}</p>
</div></div></body></html>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}