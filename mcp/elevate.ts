/** @jsxImportSource https://esm.sh/react@18.2.0 */
/**
 * elevate.ts — Unified scope consent handlers.
 *
 * Routes:
 *   GET  /auth/consent              SSR consent page (React)
 *   GET  /auth/consent/rooms        Load user's rooms + token scope (API)
 *   POST /auth/consent/approve      Apply scope changes (mode-dependent)
 *   GET  /auth/elevate              Redirect to /auth/consent?mode=elevate
 */

import * as db from "./db.ts";
import { sqlite } from "https://esm.town/v/std/sqlite";
import { renderPage } from "../frontend/ssr.ts";
import { ConsentPage } from "../frontend/pages/consent/ConsentPage.tsx";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Session-Id",
      "Cache-Control": "no-store",
    },
  });
}

function getOrigin(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

// ═══════════════════════════════════════════════════════════════════
// GET /auth/consent — Unified SSR consent page
// ═══════════════════════════════════════════════════════════════════

export function handleConsentPage(req: Request): Response {
  const url = new URL(req.url);
  const origin = getOrigin(req);

  const props = {
    origin,
    mode: (url.searchParams.get("mode") ?? "elevate") as "elevate" | "device" | "oauth",
    // Elevate
    tokenId: url.searchParams.get("token_id") ?? undefined,
    addRoom: url.searchParams.get("room") ?? undefined,
    addLevel: url.searchParams.get("level") ?? undefined,
    // Device (pre-authenticated)
    sessionId: url.searchParams.get("session_id") ?? undefined,
    deviceCode: url.searchParams.get("device_code") ?? undefined,
    requestedScope: url.searchParams.get("scope") ?? undefined,
    // OAuth (pre-authenticated)
    clientId: url.searchParams.get("client_id") ?? undefined,
    clientName: url.searchParams.get("client_name") ?? undefined,
    redirectUri: url.searchParams.get("redirect_uri") ?? undefined,
    codeChallenge: url.searchParams.get("code_challenge") ?? undefined,
    codeChallengeMethod: url.searchParams.get("code_challenge_method") ?? undefined,
    oauthScope: url.searchParams.get("scope") ?? undefined,
    oauthState: url.searchParams.get("state") ?? undefined,
    resource: url.searchParams.get("resource") ?? undefined,
  };

  // Strip undefined values for clean serialization
  const cleanProps = Object.fromEntries(
    Object.entries(props).filter(([, v]) => v !== undefined)
  );

  return renderPage({
    element: <ConsentPage {...cleanProps as any} />,
    entry: "https://esm.town/v/c15r/sync/frontend/pages/consent/client.tsx",
    props: cleanProps,
    title: `${props.mode === "elevate" ? "Grant Access" : props.mode === "device" ? "Authorize Device" : "Authorize"} — sync`,
  });
}

// ═══════════════════════════════════════════════════════════════════
// GET /auth/elevate — Legacy redirect
// ═══════════════════════════════════════════════════════════════════

export function handleElevatePage(req: Request): Response {
  const url = new URL(req.url);
  const newUrl = new URL("/auth/consent", url.origin);
  newUrl.searchParams.set("mode", "elevate");
  for (const key of ["token_id", "room", "level"]) {
    const v = url.searchParams.get(key);
    if (v) newUrl.searchParams.set(key, v);
  }
  return Response.redirect(newUrl.toString(), 302);
}

// ═══════════════════════════════════════════════════════════════════
// GET /auth/consent/rooms — Load user's rooms + token scope
// ═══════════════════════════════════════════════════════════════════

export async function handleConsentRooms(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id") ?? req.headers.get("x-session-id") ?? "";
  const tokenId = url.searchParams.get("token_id") ?? "";

  if (!sessionId) return jsonResp({ error: "session_id required" }, 400);
  const session = await db.validateSession(sessionId);
  if (!session) return jsonResp({ error: "invalid_session" }, 401);

  // Fetch user's rooms with agents
  const userRooms = await db.listUserRooms(session.userId);
  const rooms = [];
  for (const ur of userRooms) {
    const agentsRes = await sqlite.execute({
      sql: `SELECT id, name, role, status FROM agents WHERE room_id = ? ORDER BY joined_at`,
      args: [ur.roomId],
    });
    rooms.push({
      room_id: ur.roomId,
      access: ur.access,
      label: ur.label,
      agents: agentsRes.rows.map((r: any[]) => ({ id: r[0], name: r[1], role: r[2], status: r[3] })),
    });
  }

  // If editing existing token, include its current scope
  let tokenScope: string | null = null;
  let tokenLabel: string | null = null;
  if (tokenId) {
    const tokenResult = await sqlite.execute({
      sql: `SELECT scope, label FROM tokens WHERE id = ? AND minted_by = ? AND revoked = 0`,
      args: [tokenId, session.userId],
    });
    if (tokenResult.rows.length > 0) {
      tokenScope = tokenResult.rows[0][0] as string;
      tokenLabel = tokenResult.rows[0][1] as string | null;
    }
  }

  return jsonResp({ rooms, token_scope: tokenScope, token_label: tokenLabel });
}

// ═══════════════════════════════════════════════════════════════════
// POST /auth/consent/approve — Apply scope changes (mode-dependent)
// ═══════════════════════════════════════════════════════════════════

export async function handleConsentApprove(req: Request): Promise<Response> {
  const body = await req.json();
  const { mode, session_id, new_scope } = body;

  if (!session_id || !new_scope) return jsonResp({ error: "session_id and new_scope required" }, 400);

  const session = await db.validateSession(session_id);
  if (!session) return jsonResp({ error: "invalid_session" }, 401);

  // Validate: user must have access to all rooms in scope
  const scopeParts = new_scope.split(/\s+/).filter(Boolean);
  for (const part of scopeParts) {
    if (!part.startsWith("rooms:")) continue;
    const roomId = part.split(":")[1];
    if (roomId === "*") continue;
    const userRoom = await sqlite.execute({
      sql: `SELECT access FROM smcp_user_rooms WHERE user_id = ? AND room_id = ?`,
      args: [session.userId, roomId],
    });
    if (userRoom.rows.length === 0) {
      return jsonResp({ error: "no_access", message: `You don't have access to room "${roomId}"`, room: roomId }, 403);
    }
  }

  // ── Mode: Elevate (patch existing token) ──
  if (mode === "elevate") {
    const tokenId = body.token_id;
    if (!tokenId) return jsonResp({ error: "token_id required" }, 400);
    const tokenResult = await sqlite.execute({
      sql: `SELECT id FROM tokens WHERE id = ? AND minted_by = ? AND revoked = 0`,
      args: [tokenId, session.userId],
    });
    if (tokenResult.rows.length === 0) return jsonResp({ error: "token_not_found" }, 404);
    await sqlite.execute({ sql: `UPDATE tokens SET scope = ? WHERE id = ?`, args: [new_scope, tokenId] });
    await db.deleteSession(session_id);
    return jsonResp({ ok: true, mode: "elevate", token_id: tokenId, scope: new_scope });
  }

  // ── Mode: Device (approve device code with chosen scope) ──
  if (mode === "device") {
    const deviceCode = body.device_code;
    if (!deviceCode) return jsonResp({ error: "device_code required" }, 400);
    // Update scope + approve
    await sqlite.execute({ sql: `UPDATE device_codes SET scope = ? WHERE device_code = ?`, args: [new_scope, deviceCode] });
    const ok = await db.approveDeviceCode(deviceCode, session.userId);
    if (!ok) return jsonResp({ error: "approval_failed" }, 500);
    await db.deleteSession(session_id);
    return jsonResp({ ok: true, mode: "device" });
  }

  // ── Mode: OAuth (issue auth code with chosen scope) ──
  if (mode === "oauth") {
    const { client_id, redirect_uri, code_challenge, code_challenge_method, state, resource } = body;
    if (!client_id || !redirect_uri || !code_challenge) {
      return jsonResp({ error: "missing OAuth params" }, 400);
    }
    const code = await db.generateToken("authz");
    await db.saveAuthCode({
      code, clientId: client_id, userId: session.userId,
      redirectUri: redirect_uri, codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method || "S256",
      scope: new_scope, resource,
    });
    await db.deleteSession(session_id);
    const redirect = new URL(redirect_uri);
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);
    return jsonResp({ ok: true, mode: "oauth", redirect: redirect.toString() });
  }

  return jsonResp({ error: "invalid mode" }, 400);
}
