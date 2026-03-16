// v8 — merged from v8 branch · legacy tables dropped · substrate surfaces
// force-restart: 2026-03-15T14:00Z
//
// main.ts — HTTP router + barrel re-exports.
//
// All domain logic has been extracted to focused modules.
// This file provides the HTTP routing layer and re-exports
// for backward compatibility with mcp/tools.ts.

import { sqlite } from "https://esm.town/v/std/sqlite";
import { migrate } from "./schema.ts";
import { migrateUnifiedAuth } from "./schema-v7.ts";
import {
  json,
  PARSE_FAILED,
  parseBody,
  rows2objects,
  stripNulls,
} from "./utils.ts";
import { handleMcpRequest } from "./mcp/mcp.ts";
import {
  renderDashboardPage,
  renderDocPage,
  renderDocsIndex,
  renderLandingPage,
  renderOverviewPage,
} from "./frontend/pages.tsx";
import { mdToHtml } from "./frontend/markdown.ts";
import { DOC_REGISTRY, README, REFERENCE_FILES } from "./docs.ts";
import {
  assertIdentity,
  type AuthResult,
  hasFullReadAccess,
  hashToken,
  hashTokenB64,
  requireRoomToken,
  requireWriteAuth,
  resolveAuth,
} from "./auth.ts";
import { touchAgent } from "./auth.ts";
import { createRoom, getRoom, listRooms, rotateViewToken } from "./rooms.ts";
import { insertAgentDirect, joinRoom, updateAgent } from "./agents.ts";
import { deleteAction, registerAction } from "./actions.ts";
import { deleteView, registerView } from "./views.ts";
import { invokeAction, invokeBuiltinAction } from "./invoke.ts";
import {
  buildExpandedContext,
  type ContextRequest,
  evalExpression,
  parseContextRequest,
} from "./context.ts";
import { waitForCondition } from "./wait.ts";
import { replayRoom } from "./replay.ts";
import { queryKeyHistory, queryPrefixHistory } from "./schema-v8.ts";
import { queryViewSamples } from "./sampling.ts";
import { computeSalience } from "./salience.ts";
import { dashboardPollV8 } from "./poll-v8.ts";
import { renderDashboardV8 } from "./frontend/dashboard-v8.ts";
import { parseScope } from "./mcp/scope.ts";
import { validateTokenByHash } from "./mcp/db.ts";
// v7: Device auth + token management
import {
  handleDeviceApprove,
  handleDeviceDeny,
  handleDeviceLookup,
  handleDevicePage,
  handleDeviceStart,
  handleDeviceToken,
} from "./mcp/device.ts";
import {
  handleConsentApprove,
  handleConsentPage,
  handleConsentRooms,
  handleElevatePage,
} from "./mcp/elevate.tsx";
import {
  handleClaim,
  handleInvite,
  handleListTokens,
  handleMintToken,
  handleRefreshToken,
  handleRevokeToken,
  handleUpdateToken,
} from "./tokens.ts";

// ── Re-exports for mcp/tools.ts backward compatibility ──

export {
  buildExpandedContext,
  createRoom,
  deleteAction,
  deleteView,
  evalExpression,
  insertAgentDirect,
  invokeAction,
  invokeBuiltinAction,
  joinRoom,
  listRooms,
  registerAction,
  registerView,
  waitForCondition,
};
export type { ContextRequest };

// ── Migration guard ──

let migrated = false;
async function ensureMigrated() {
  if (!migrated) {
    await migrate();
    await migrateUnifiedAuth();
    migrated = true;
  }
}

// ── Context endpoint ──

async function getContext(roomId: string, url: URL, auth: AuthResult) {
  touchAgent(roomId, auth.agentId);
  const req = parseContextRequest(url);
  const fullCtx = await buildExpandedContext(roomId, auth, req);
  return json(fullCtx);
}

// ── Router ──

export default async function (req: Request) {
  await ensureMigrated();
  const url = new URL(req.url);
  const compact = url.searchParams.get("compact") === "true";

  const response = await route(req, url);

  // v8: Add version header to every response for debugging stale isolates
  response.headers.set("X-Sync-Version", "v8-625");

  if (compact && response.headers.get("Content-Type")?.includes("json")) {
    const data = await response.json();
    return json(stripNulls(data), response.status);
  }
  return response;
}

async function route(req: Request, _url?: URL): Promise<Response> {
  const url = _url ?? new URL(req.url);
  const method = req.method;
  const parts = url.pathname.split("/").filter(Boolean);

  // CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
      },
    });
  }

  // ── v7: Device auth endpoints ──
  const p = url.pathname;
  if (p.startsWith("/auth/device")) {
    if (method === "POST" && p === "/auth/device") {
      return handleDeviceStart(req);
    }
    if (method === "GET" && p === "/auth/device") return handleDevicePage(req);
    if (method === "POST" && p === "/auth/device/lookup") {
      return handleDeviceLookup(req);
    }
    if (method === "POST" && p === "/auth/device/approve") {
      return handleDeviceApprove(req);
    }
    if (method === "POST" && p === "/auth/device/deny") {
      return handleDeviceDeny(req);
    }
    if (method === "POST" && p === "/auth/device/token") {
      return handleDeviceToken(req);
    }
    return json({ error: "not found" }, 404);
  }

  // ── v7: Unified consent page ──
  if (p.startsWith("/auth/consent")) {
    if (method === "GET" && p === "/auth/consent") {
      return handleConsentPage(req);
    }
    if (method === "GET" && p === "/auth/consent/rooms") {
      return handleConsentRooms(req);
    }
    if (method === "POST" && p === "/auth/consent/approve") {
      return handleConsentApprove(req);
    }
    return json({ error: "not found" }, 404);
  }

  // ── v7: Legacy /auth/elevate → redirect to /auth/consent ──
  if (p.startsWith("/auth/elevate")) {
    if (method === "GET" && p === "/auth/elevate") {
      return handleElevatePage(req);
    }
    // Legacy approve endpoint — redirect to consent approve
    if (method === "POST" && p === "/auth/elevate/approve") {
      return handleConsentApprove(req);
    }
    if (method === "GET" && p === "/auth/elevate/token") {
      return handleConsentRooms(req);
    }
    return json({ error: "not found" }, 404);
  }

  // ── v7: Token management endpoints ──
  if (p === "/tokens" || p.startsWith("/tokens/")) {
    if (method === "POST" && p === "/tokens") return handleMintToken(req);
    if (method === "POST" && p === "/tokens/refresh") {
      return handleRefreshToken(req);
    }
    if (method === "GET" && p === "/tokens") return handleListTokens(req);
    if (method === "PATCH" && parts[0] === "tokens" && parts[1]) {
      return handleUpdateToken(req, parts[1]);
    }
    if (method === "DELETE" && parts[0] === "tokens" && parts[1]) {
      return handleRevokeToken(req, parts[1]);
    }
    return json({ error: "not found" }, 404);
  }

  // ── MCP / OAuth / WebAuthn / Management — delegate to MCP handler ──
  if (
    p === "/mcp" ||
    p.startsWith("/oauth/") ||
    p.startsWith("/webauthn/") ||
    p.startsWith("/manage") ||
    p.startsWith("/recover") ||
    (p.startsWith("/.well-known/oauth"))
  ) {
    return handleMcpRequest(req);
  }

  // ── Legacy /vault → 410 Gone ──
  if (p.startsWith("/vault")) {
    return json({
      error: "vault_deprecated",
      message: "Use /tokens endpoints instead.",
    }, 410);
  }

  // POST /rooms — v7: require auth with create_rooms scope (or legacy token)
  if (method === "POST" && parts[0] === "rooms" && parts.length === 1) {
    const body = await parseBody(req);
    if (body === PARSE_FAILED) return json({ error: "invalid JSON" }, 400);
    let auth: AuthResult | undefined;
    let creatingTokenId: string | null = null;
    const header = req.headers.get("Authorization");
    if (!header?.startsWith("Bearer ")) {
      return json({
        error: "authentication_required",
        message:
          "Room creation requires authentication. Use device auth or OAuth to get a token.",
      }, 401);
    }
    const tokenStr = header.slice(7);
    // v7 tokens: check create_rooms scope
    if (tokenStr.startsWith("tok_")) {
      const hash = await hashTokenB64(tokenStr);
      const tok = await validateTokenByHash(hash);
      if (!tok) return json({ error: "invalid_token" }, 401);
      const parsed = parseScope(tok.scope);
      if (!parsed.createRooms && !parsed.wildcardRooms) {
        return json({
          error: "scope_denied",
          message: "Token scope does not include create_rooms",
        }, 403);
      }
      auth = {
        authenticated: true,
        kind: "room",
        agentId: null,
        roomId: null,
        grants: ["*"],
        userId: tok.mintedBy,
      };
      // Track which token is creating this room (for scope append)
      if (!parsed.wildcardRooms) creatingTokenId = tok.id;
    } else {
      // Legacy tokens
      const result = await resolveAuth(req, "__room_creation__");
      if (result instanceof Response) return result;
      if (!result.authenticated) return json({ error: "invalid_token" }, 401);
      if (result.userId) auth = result;
      else auth = result;
    }
    const response = await createRoom(body, auth);
    // v7: Append the new room to the creating token's scope
    if (creatingTokenId && response.status === 201) {
      try {
        const roomData = await response.clone().json();
        const newRoomId = roomData.id;
        if (newRoomId) {
          await sqlite.execute({
            sql:
              `UPDATE tokens SET scope = scope || ' rooms:' || ? WHERE id = ?`,
            args: [newRoomId, creatingTokenId],
          });
        }
      } catch { /* best-effort */ }
    }
    return response;
  }
  // GET /rooms
  if (method === "GET" && parts[0] === "rooms" && parts.length === 1) {
    return listRooms(req);
  }
  // GET /rooms/:id
  if (
    method === "GET" && parts[0] === "rooms" && parts.length === 2 &&
    parts[1] !== ""
  ) return getRoom(parts[1]);

  const roomId = parts[1];
  if (!roomId || parts[0] !== "rooms") {
    // /overview — Vision & Architecture page
    if (
      method === "GET" &&
      (url.pathname === "/overview" || url.pathname === "/overview/")
    ) {
      return renderOverviewPage();
    }
    // /docs — SSR index and rendered pages
    if (
      method === "GET" &&
      (url.pathname === "/docs" || url.pathname === "/docs/")
    ) {
      const docList = Object.entries(DOC_REGISTRY).map(([slug, d]) => ({
        slug,
        title: d.title,
        category: d.category,
      }));
      return renderDocsIndex(docList);
    }
    if (
      method === "GET" && url.pathname.startsWith("/docs/") &&
      parts.length === 2
    ) {
      const rawSlug = parts[1];
      if (rawSlug.endsWith(".md")) {
        const bareSlug = rawSlug.replace(/\.md$/, "");
        const doc = DOC_REGISTRY[bareSlug];
        if (doc) {
          return new Response(doc.content, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        return json({ error: "doc not found" }, 404);
      }
      const doc = DOC_REGISTRY[rawSlug];
      if (doc) {
        return renderDocPage(
          rawSlug,
          doc.title,
          mdToHtml(doc.content),
          doc.rawPath,
        );
      }
      return json({ error: "doc not found" }, 404);
    }
    if (url.pathname === "/" || url.pathname === "") {
      const roomId = url.searchParams.get("room");
      const docId = url.searchParams.get("doc");
      if (roomId) return renderDashboardPage(roomId);
      if (docId) {
        const slug = docId.replace(/\.md$/, "");
        return new Response(null, {
          status: 301,
          headers: { "Location": `/docs/${slug}` },
        });
      }
      return renderLandingPage();
    }
    if (method === "GET" && url.pathname.startsWith("/frontend/")) {
      const modulePath = url.pathname.slice(1);
      const esmUrl = `https://esm.town/v/c15r/sync/${modulePath}`;
      return new Response(null, {
        status: 302,
        headers: {
          "Location": esmUrl,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }
    if (
      method === "GET" &&
      (url.pathname.startsWith("/static/") || url.pathname === "/favicon.ico" ||
        url.pathname === "/favicon.svg")
    ) {
      const filePath = url.pathname === "/favicon.ico"
        ? "static/favicon.ico"
        : url.pathname === "/favicon.svg"
        ? "static/favicon.svg"
        : url.pathname.slice(1);
      try {
        const fileUrl = new URL(`./${filePath}`, import.meta.url);
        const res = await fetch(fileUrl);
        if (!res.ok) return json({ error: "not found" }, 404);
        const body = await res.arrayBuffer();
        const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
        const mimeTypes: Record<string, string> = {
          ico: "image/x-icon",
          svg: "image/svg+xml",
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
          css: "text/css",
          js: "application/javascript",
          json: "application/json",
          woff: "font/woff",
          woff2: "font/woff2",
          ttf: "font/ttf",
          txt: "text/plain",
          xml: "application/xml",
        };
        return new Response(body, {
          headers: {
            "Content-Type": mimeTypes[ext] || "application/octet-stream",
            "Cache-Control": "public, max-age=86400",
          },
        });
      } catch {
        return json({ error: "not found" }, 404);
      }
    }
    if (
      method === "GET" &&
      (url.pathname === "/SKILL.md" || url.pathname === "/skill.md")
    ) {
      return new Response(README, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (method === "GET" && parts[0] === "reference" && parts.length === 2) {
      const doc = REFERENCE_FILES[parts[1]];
      if (doc) {
        return new Response(doc, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    }
    return json({ error: "not found" }, 404);
  }

  // Parse body for mutations
  let body: any = undefined;
  if (
    method === "POST" || method === "PUT" || method === "DELETE" ||
    method === "PATCH"
  ) {
    body = await parseBody(req);
    if (body === PARSE_FAILED) return json({ error: "invalid JSON" }, 400);
  }

  // Resolve auth for all room-scoped requests
  const authResult = await resolveAuth(req, roomId);
  if (authResult instanceof Response) return authResult;
  const auth = authResult;

  const sub = parts[2];
  const subId = parts[3];
  const subAction = parts[4];

  // ---- v7: Room invitation ----
  if (sub === "invite" && method === "POST") {
    return handleInvite(req, roomId, body);
  }

  // ---- v7: Room claim (orphaned rooms) ----
  if (sub === "claim" && method === "POST") {
    return handleClaim(req, roomId, body);
  }

  // ---- v7: Room deletion (owner only) ----
  if (!sub && method === "DELETE") {
    if (!auth.authenticated) {
      return json({ error: "authentication_required" }, 401);
    }
    // Check ownership: admin auth OR direct user_rooms owner check
    let isOwner = auth.kind === "room" || auth.grants.includes("*");
    if (!isOwner && auth.userId) {
      const ownerCheck = await sqlite.execute({
        sql:
          `SELECT access FROM smcp_user_rooms WHERE user_id = ? AND room_id = ? AND access = 'owner'`,
        args: [auth.userId, roomId],
      });
      isOwner = ownerCheck.rows.length > 0;
    }
    // Fallback: if no user_rooms entries exist for this room at all, allow owner-scoped token
    if (!isOwner && auth.userId) {
      const anyUsers = await sqlite.execute({
        sql: `SELECT COUNT(*) FROM smcp_user_rooms WHERE room_id = ?`,
        args: [roomId],
      });
      if (Number(anyUsers.rows[0][0]) === 0) isOwner = true; // orphaned room, allow cleanup
    }
    if (!isOwner) {
      return json({
        error: "owner_required",
        message: "Only room owners can delete rooms",
      }, 403);
    }
    // Delete room and all related data (FK constraints off for clean cascade)
    try {
      await sqlite.execute({ sql: `PRAGMA foreign_keys = OFF`, args: [] });
    } catch {}
    const tables = [
      `DELETE FROM state WHERE room_id = ?`,
      `DELETE FROM log_index WHERE room_id = ?`,
      `DELETE FROM tokens WHERE room_id = ?`,
      `DELETE FROM smcp_embodiments WHERE room_id = ?`,
      `DELETE FROM smcp_vault WHERE room_id = ?`,
      `DELETE FROM smcp_user_rooms WHERE room_id = ?`,
      `DELETE FROM rooms WHERE id = ?`,
    ];
    for (const sql of tables) {
      try {
        await sqlite.execute({ sql, args: [roomId] });
      } catch {}
    }
    try {
      await sqlite.execute({ sql: `PRAGMA foreign_keys = ON`, args: [] });
    } catch {}
    return json({ deleted: true, room: roomId });
  }

  // ---- v8: Standalone dashboard (no React SSR) ----
  if (method === "GET" && sub === "dashboard") return renderDashboardV8(roomId);

  // ---- Agents ----
  if (sub === "agents") {
    if (method === "POST" && !subId) return joinRoom(roomId, body, req);
    if (method === "PATCH" && subId && !subAction) {
      const deny = requireRoomToken(auth);
      if (deny) return deny;
      return updateAgent(roomId, subId, body);
    }
  }

  // ---- Actions (invoke only — writes via built-in actions) ----
  if (sub === "actions") {
    if (method === "POST" && subId && subAction === "invoke") {
      const deny = requireWriteAuth(auth);
      if (deny) return deny;
      const identityDeny = assertIdentity(auth, body.agent);
      if (identityDeny) return identityDeny;
      return invokeAction(roomId, subId, body, auth);
    }
  }

  // ---- Wait ----
  if (method === "GET" && sub === "wait") {
    return waitForCondition(roomId, url, auth);
  }

  // ---- Context ----
  if (method === "GET" && sub === "context") {
    return getContext(roomId, url, auth);
  }

  // ---- Dashboard poll (v8: state-only) ----
  if (method === "GET" && sub === "poll") {
    return dashboardPollV8(roomId, url, auth);
  }

  // ---- Replay ----
  if (method === "GET" && sub === "replay" && subId) {
    const seq = parseInt(subId);
    if (isNaN(seq) || seq < 0) {
      return json({ error: "seq must be a non-negative integer" }, 400);
    }
    const result = await replayRoom(roomId, seq);
    return json(result);
  }

  // ---- v8: Key history (temporal projection) ----
  // GET /rooms/:id/history/:scope/:key?limit=100&after=seq
  if (method === "GET" && sub === "history" && subId && subAction) {
    const scope = subId;
    const key = subAction;
    const limit = parseInt(url.searchParams.get("limit") ?? "100");
    const after = url.searchParams.get("after")
      ? parseInt(url.searchParams.get("after")!)
      : undefined;
    const prefix = url.searchParams.get("prefix");

    if (prefix) {
      // Prefix query: /rooms/:id/history/:scope/_?prefix=concepts.
      const results = await queryPrefixHistory(roomId, scope, prefix, {
        limit,
        after,
      });
      return json({ room_id: roomId, scope, prefix, entries: results });
    }

    const results = await queryKeyHistory(roomId, scope, key, { limit, after });
    return json({ room_id: roomId, scope, key, entries: results });
  }

  // ---- v8: View value samples (temporal sparklines) ----
  // GET /rooms/:id/samples/:viewId?limit=100&after=seq
  if (method === "GET" && sub === "samples" && subId) {
    const limit = parseInt(url.searchParams.get("limit") ?? "100");
    const after = url.searchParams.get("after")
      ? parseInt(url.searchParams.get("after")!)
      : undefined;
    const results = await queryViewSamples(roomId, subId, { limit, after });
    return json({ room_id: roomId, view_id: subId, samples: results });
  }

  // ---- v8: Salience map (agent-specific relevance scores) ----
  // GET /rooms/:id/salience?limit=50&agent=X (agent param for room/admin tokens)
  if (method === "GET" && sub === "salience") {
    if (!auth.authenticated) {
      return json({
        error: "agent_auth_required",
        message: "Salience requires authentication",
      }, 401);
    }
    // Allow room/admin/view tokens to view any agent's salience via ?agent= param
    let agentId = auth.agentId;
    const agentParam = url.searchParams.get("agent");
    if (
      agentParam &&
      (auth.kind === "room" || auth.kind === "view" ||
        auth.grants.includes("*"))
    ) {
      agentId = agentParam;
    }
    if (!agentId) {
      return json({
        error: "agent_required",
        message:
          "Use ?agent=<id> with a room token, or authenticate as an agent",
      }, 400);
    }
    const limit = parseInt(url.searchParams.get("limit") ?? "50");
    const map = await computeSalience(roomId, agentId, { limit });
    return json(map);
  }

  // ---- CEL eval ----
  if (method === "POST" && sub === "eval") {
    return evalExpression(roomId, body, auth);
  }

  // ---- View token rotation (admin only) ----
  if (method === "POST" && sub === "rotate-view-token") {
    const deny = requireRoomToken(auth);
    if (deny) return deny;
    return rotateViewToken(roomId);
  }

  // ---- Generate view token for existing rooms that don't have one (admin only) ----
  if (method === "POST" && sub === "generate-view-token") {
    const deny = requireRoomToken(auth);
    if (deny) return deny;
    const existing = await sqlite.execute({
      sql: `SELECT view_token_hash FROM rooms WHERE id = ?`,
      args: [roomId],
    });
    const room = rows2objects(existing)[0];
    if (room?.view_token_hash) {
      return json({
        error: "view_token_exists",
        message:
          "room already has a view token — use rotate-view-token to replace it",
      }, 409);
    }
    return rotateViewToken(roomId);
  }

  return json({ error: "not found" }, 404);
}