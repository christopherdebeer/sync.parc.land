/**
 * oauth.ts — OAuth 2.1 protocol handlers for sync-mcp.
 *
 * Implements:
 * - Protected Resource Metadata (RFC 9728)
 * - Authorization Server Metadata (RFC 8414)
 * - Dynamic Client Registration (RFC 7591)
 * - Consent (exchange session for auth code)
 * - Token endpoint (authorization_code + refresh_token grants)
 */

import * as db from "./db.ts";

// ─── Configuration ───────────────────────────────────────────────

const TOKEN_EXPIRY_SECS = 3600; // 1 hour access tokens

function getOrigin(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
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
    scopes_supported: ["sync:rooms", "create_rooms", "rooms:{room_id}", "rooms:{room_id}:observe", "rooms:{room_id}:role:{role}"],
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

  if (authCode.redirectUri !== redirect_uri) {
    return json({
      error: "invalid_grant",
      error_description: "redirect_uri mismatch",
    }, 400);
  }

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

  // Create user session for the new access token (agency-identity)
  try {
    const atHash = await db.sha256(accessToken);
    await db.createUserSession({
      tokenHash: atHash,
      userId: authCode.userId,
      clientId: authCode.clientId,
      scope: authCode.scope ?? "sync:rooms",
      expiresAt: new Date(Date.now() + TOKEN_EXPIRY_SECS * 1000).toISOString(),
    });
  } catch (_) { /* best-effort — session tracking is additive */ }

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

  // Create new user session and transfer embodiments (agency-identity)
  try {
    const newAtHash = await db.sha256(accessToken);
    const newExpiry = new Date(Date.now() + TOKEN_EXPIRY_SECS * 1000).toISOString();
    await db.createUserSession({
      tokenHash: newAtHash,
      userId: rt.userId,
      clientId: rt.clientId,
      scope: rt.scope ?? "sync:rooms",
      expiresAt: newExpiry,
    });
    const oldSessions = await db.findSessionsByUserClient(rt.userId, rt.clientId, newAtHash);
    for (const oldHash of oldSessions) {
      await db.transferEmbodiments(oldHash, newAtHash);
      await db.deleteUserSession(oldHash);
    }
  } catch (_) { /* best-effort */ }

  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: TOKEN_EXPIRY_SECS,
    refresh_token: newRefreshToken,
    scope: rt.scope ?? "sync:rooms",
  });
}
