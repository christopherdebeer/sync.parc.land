/** @jsxImportSource https://esm.sh/react@18.2.0 */
/**
 * manage.tsx — Management UI, authorize page, and recovery flow.
 *
 * Contains all endpoints that render JSX (SSR) or serve session-authenticated APIs:
 * - GET /oauth/authorize — Authorization page with WebAuthn
 * - GET /manage — Management dashboard
 * - GET/POST/DELETE /manage/api/* — Management REST API
 * - GET /recover — Recovery page
 * - POST /recover/* — Recovery API endpoints
 */

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13";
import type {
  AuthenticatorTransportFuture,
} from "npm:@simplewebauthn/server@13";

import * as db from "./db.ts";
import { sqlite } from "https://esm.town/v/std/sqlite";
import { renderPage } from "../frontend/ssr.ts";
import { RecoverPage } from "../frontend/pages/recover/RecoverPage.tsx";
import { ManagePage } from "../frontend/pages/manage/ManagePage.tsx";
import { AuthorizePage } from "../frontend/pages/authorize/AuthorizePage.tsx";
import { getRpId } from "./webauthn.ts";
import { fetchRoomRoles } from "../agents.ts";

// ─── Helpers ─────────────────────────────────────────────────────

function getOrigin(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

/** Compute the dashboard origin from the request.
 *  If served from mcp.X, dashboard is at X. Otherwise same origin. */
function getDashboardOrigin(req: Request): string {
  const url = new URL(req.url);
  const hostname = url.hostname;
  if (hostname.startsWith("mcp.")) {
    return `${url.protocol}//${hostname.slice(4)}${url.port ? ":" + url.port : ""}`;
  }
  return getOrigin(req);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

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

  return renderPage({
    element: <AuthorizePage origin={origin} params={oauthParams} />,
    entry: "https://esm.town/v/c15r/sync/frontend/pages/authorize/client.tsx",
    props: { origin, params: oauthParams },
    title: "Sign in — sync·mcp",
  });
}

// ─── Management Page ─────────────────────────────────────────────

export function handleManagePage(req: Request): Response {
  const origin = getOrigin(req);
  const dashboardOrigin = getDashboardOrigin(req);
  return renderPage({
    element: <ManagePage origin={origin} dashboardOrigin={dashboardOrigin} />,
    entry: "https://esm.town/v/c15r/sync/frontend/pages/manage/client.tsx",
    props: { origin, dashboardOrigin },
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

  // GET /manage/api/rooms — user's rooms with agents and roles
  if (req.method === "GET" && path === "/rooms") {
    const userRooms = await db.listUserRooms(userId);
    const roomsWithDetail = [];
    for (const ur of userRooms) {
      const agentsRes = await sqlite.execute({
        sql: `SELECT id, name, role, status, last_heartbeat FROM agents WHERE room_id = ? ORDER BY joined_at`,
        args: [ur.roomId],
      });
      const agents = agentsRes.rows.map((r: any[]) => ({
        id: r[0], name: r[1], role: r[2], status: r[3], last_heartbeat: r[4],
      }));
      const roles = await fetchRoomRoles(ur.roomId);
      roomsWithDetail.push({
        room_id: ur.roomId,
        access: ur.access,
        label: ur.label,
        is_default: ur.isDefault,
        agents,
        roles,
      });
    }
    return json({ rooms: roomsWithDetail });
  }

  // POST /manage/api/rooms — create a new room
  if (req.method === "POST" && path === "/rooms") {
    const body = await req.json();
    const roomId = body.id ?? crypto.randomUUID();
    const label = body.label ?? `Room: ${roomId}`;
    // Check if room already exists
    const existing = await sqlite.execute({
      sql: `SELECT id FROM rooms WHERE id = ?`, args: [roomId],
    });
    if (existing.rows.length > 0) return json({ error: "room_exists", id: roomId }, 409);
    // Create room
    const { generateToken, hashToken } = await import("../auth.ts");
    const token = generateToken("room");
    const hash = await hashToken(token);
    const viewToken = generateToken("view");
    const viewHash = await hashToken(viewToken);
    await sqlite.execute({
      sql: `INSERT INTO rooms (id, meta, token_hash, view_token_hash) VALUES (?, ?, ?, ?)`,
      args: [roomId, JSON.stringify(body.meta ?? {}), hash, viewHash],
    });
    // Link to user as owner
    await sqlite.execute({
      sql: `INSERT OR IGNORE INTO smcp_user_rooms (user_id, room_id, access, label)
            VALUES (?, ?, 'owner', ?)`,
      args: [userId, roomId, label],
    });
    return json({ id: roomId, label, access: "owner" }, 201);
  }

  // POST /manage/api/rooms/:id/invite — invite a user
  if (req.method === "POST" && path.match(/^\/rooms\/[^/]+\/invite$/)) {
    const roomId = path.split("/")[2];
    const userRoom = await db.getUserRoom(userId, roomId);
    if (!userRoom || userRoom.access !== "owner") {
      return json({ error: "not_owner", message: "Only room owners can invite users" }, 403);
    }
    const body = await req.json();
    const { username, role } = body;
    if (!username) return json({ error: "username required" }, 400);
    const validRoles = ["owner", "collaborator", "participant", "observer"];
    const targetRole = role ?? "participant";
    if (!validRoles.includes(targetRole)) return json({ error: "invalid_role", valid: validRoles }, 400);
    const targetUser = await db.getUserByUsername(username);
    if (!targetUser) return json({ error: "user_not_found", message: `No user "${username}"` }, 404);
    await db.inviteUserToRoom(targetUser.id, roomId, targetRole, userId, body.label);
    return json({ invited: true, username, room: roomId, role: targetRole });
  }

  // DELETE /manage/api/rooms/:id — delete a room (owner only)
  if (req.method === "DELETE" && path.match(/^\/rooms\/[^/]+$/)) {
    const roomId = path.split("/")[2];
    const userRoom = await db.getUserRoom(userId, roomId);
    if (!userRoom || userRoom.access !== "owner") {
      return json({ error: "not_owner", message: "Only room owners can delete rooms" }, 403);
    }
    // Delete room data (cascade: agents, state, actions, views, messages, audit)
    await sqlite.batch([
      { sql: `DELETE FROM state WHERE room_id = ?`, args: [roomId] },
      { sql: `DELETE FROM actions WHERE room_id = ?`, args: [roomId] },
      { sql: `DELETE FROM views WHERE room_id = ?`, args: [roomId] },
      { sql: `DELETE FROM agents WHERE room_id = ?`, args: [roomId] },
      { sql: `DELETE FROM smcp_user_rooms WHERE room_id = ?`, args: [roomId] },
      { sql: `DELETE FROM rooms WHERE id = ?`, args: [roomId] },
    ]);
    return json({ deleted: true, room: roomId });
  }

  // POST /manage/api/room-token — mint a temporary token for dashboard access
  if (req.method === "POST" && path === "/room-token") {
    const body = await req.json();
    const roomId = body.room_id;
    if (!roomId) return json({ error: "room_id required" }, 400);

    // Check user has access to this room
    const userRoom = await db.getUserRoom(userId, roomId);
    if (!userRoom) return json({ error: "no_access", message: "You don't have access to this room" }, 403);

    // Mint a short-lived token scoped to this room
    const level = userRoom.access === "owner" ? "" : ":read";
    const result = await db.mintToken({
      userId,
      scope: `rooms:${roomId}${level}`,
      label: `Dashboard: ${roomId}`,
      roomId,
      expiresInSec: 3600, // 1 hour
    });

    return json({
      token: result.token,
      room_id: roomId,
      access: userRoom.access,
      expires_at: result.expiresAt,
    });
  }

  // ── Unified tokens (v7) ──

  // GET /manage/api/tokens — list unified tokens
  if (req.method === "GET" && path === "/tokens") {
    const tokens = await db.listUserTokens(userId);
    return json({
      tokens: tokens.map(t => ({
        id: t.id,
        scope: t.scope,
        label: t.label,
        room_id: t.roomId,
        agent_id: t.agentId,
        client_id: t.clientId,
        revoked: t.revoked,
        expires_at: t.expiresAt,
        created_at: t.createdAt,
      })),
    });
  }

  // DELETE /manage/api/tokens/:id — revoke a unified token
  if (req.method === "DELETE" && path.startsWith("/tokens/")) {
    const tokenId = path.split("/")[2];
    if (!tokenId) return json({ error: "Missing token ID" }, 400);
    const ok = await db.revokeToken(tokenId, userId);
    if (!ok) return json({ error: "Token not found or not owned by you" }, 404);
    return json({ revoked: true, id: tokenId });
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
    entry: "https://esm.town/v/c15r/sync/frontend/pages/recover/client.tsx",
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

  const sessionId = await db.createSession(result.userId, "recovery");

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
    rpName: "sync-mcp",
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
