// v373 — disable eruda (breaks WebAuthn)
//
// main.ts — HTTP router + barrel re-exports.
//
// All domain logic has been extracted to focused modules.
// This file provides the HTTP routing layer and re-exports
// for backward compatibility with mcp/tools.ts.

import { sqlite } from "https://esm.town/v/std/sqlite";
import { migrate } from "./schema.ts";
import { json, rows2objects, PARSE_FAILED, parseBody, stripNulls } from "./utils.ts";
import { handleMcpRequest } from "./mcp/mcp.ts";
import { renderLandingPage, renderDashboardPage, renderDocPage, renderDocsIndex } from "./frontend/pages.tsx";
import { mdToHtml } from "./frontend/markdown.ts";
import { README, REFERENCE_FILES, DOC_REGISTRY } from "./docs.ts";
import {
  resolveAuth, requireRoomToken, requireWriteAuth, assertIdentity,
  hasFullReadAccess, hashToken, type AuthResult,
} from "./auth.ts";
import { touchAgent } from "./auth.ts";
import { createRoom, getRoom, listRooms, rotateViewToken } from "./rooms.ts";
import { joinRoom, insertAgentDirect, updateAgent } from "./agents.ts";
import { registerAction, deleteAction } from "./actions.ts";
import { registerView, deleteView } from "./views.ts";
import { invokeAction, invokeBuiltinAction } from "./invoke.ts";
import { buildExpandedContext, dashboardPoll, evalExpression, parseContextRequest, type ContextRequest } from "./context.ts";
import { waitForCondition } from "./wait.ts";
import { replayRoom } from "./replay.ts";

// ── Re-exports for mcp/tools.ts backward compatibility ──

export {
  createRoom,
  listRooms,
  joinRoom,
  insertAgentDirect,
  registerAction,
  deleteAction,
  registerView,
  deleteView,
  invokeAction,
  invokeBuiltinAction,
  buildExpandedContext,
  evalExpression,
  waitForCondition,
};
export type { ContextRequest };

// ── Migration guard ──

let migrated = false;
async function ensureMigrated() {
  if (!migrated) { await migrate(); migrated = true; }
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

  // ── MCP / OAuth / WebAuthn / Management — delegate to MCP handler ──
  const p = url.pathname;
  if (
    p === "/mcp" ||
    p.startsWith("/oauth/") ||
    p.startsWith("/webauthn/") ||
    p.startsWith("/manage") ||
    p.startsWith("/recover") ||
    p.startsWith("/vault") ||
    (p.startsWith("/.well-known/oauth"))
  ) {
    return handleMcpRequest(req);
  }

  // POST /rooms
  if (method === "POST" && parts[0] === "rooms" && parts.length === 1) {
    const body = await parseBody(req);
    if (body === PARSE_FAILED) return json({ error: "invalid JSON" }, 400);
    return createRoom(body);
  }
  // GET /rooms
  if (method === "GET" && parts[0] === "rooms" && parts.length === 1) return listRooms(req);
  // GET /rooms/:id
  if (method === "GET" && parts[0] === "rooms" && parts.length === 2 && parts[1] !== "") return getRoom(parts[1]);

  const roomId = parts[1];
  if (!roomId || parts[0] !== "rooms") {
    // /docs — SSR index and rendered pages
    if (method === "GET" && (url.pathname === "/docs" || url.pathname === "/docs/")) {
      const docList = Object.entries(DOC_REGISTRY).map(([slug, d]) => ({ slug, title: d.title, category: d.category }));
      return renderDocsIndex(docList);
    }
    if (method === "GET" && url.pathname.startsWith("/docs/") && parts.length === 2) {
      const rawSlug = parts[1];
      // /docs/slug.md → raw markdown text
      if (rawSlug.endsWith(".md")) {
        const bareSlug = rawSlug.replace(/\.md$/, "");
        const doc = DOC_REGISTRY[bareSlug];
        if (doc) return new Response(doc.content, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
        return json({ error: "doc not found" }, 404);
      }
      // /docs/slug → SSR rendered page
      const doc = DOC_REGISTRY[rawSlug];
      if (doc) return renderDocPage(rawSlug, doc.title, mdToHtml(doc.content), doc.rawPath);
      return json({ error: "doc not found" }, 404);
    }
    // Root — SSR per-page (replaces SPA shell)
    if (url.pathname === "/" || url.pathname === "") {
      const roomId = url.searchParams.get("room");
      const docId = url.searchParams.get("doc");
      if (roomId) return renderDashboardPage(roomId);
      // Backward compat: /?doc=filename.md → 301 /docs/slug
      if (docId) {
        const slug = docId.replace(/\.md$/, "");
        return new Response(null, { status: 301, headers: { "Location": `/docs/${slug}` } });
      }
      return renderLandingPage();
    }
    // Frontend module proxy — redirect to esm.town for TSX→JS transpilation
    // esm.town does 302 → version-pinned URL → serves application/javascript
    if (method === "GET" && url.pathname.startsWith("/frontend/")) {
      const modulePath = url.pathname.slice(1); // "frontend/pages/landing/client.tsx"
      const esmUrl = `https://esm.town/v/c15r/sync/${modulePath}`;
      return new Response(null, {
        status: 302,
        headers: {
          "Location": esmUrl,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }
    // Static assets — /static/* and well-known shortcuts (/favicon.ico, /favicon.svg)
    if (method === "GET" && (url.pathname.startsWith("/static/") || url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg")) {
      const filePath = url.pathname === "/favicon.ico" ? "static/favicon.ico"
                     : url.pathname === "/favicon.svg" ? "static/favicon.svg"
                     : url.pathname.slice(1); // "static/whatever.ext"
      try {
        const fileUrl = new URL(`./${filePath}`, import.meta.url);
        const res = await fetch(fileUrl);
        if (!res.ok) return json({ error: "not found" }, 404);
        const body = await res.arrayBuffer();
        const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
        const mimeTypes: Record<string, string> = {
          ico: "image/x-icon", svg: "image/svg+xml", png: "image/png",
          jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
          css: "text/css", js: "application/javascript", json: "application/json",
          woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf",
          txt: "text/plain", xml: "application/xml",
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
    // SKILL.md — orchestrator skill (README content)
    if (method === "GET" && (url.pathname === "/SKILL.md" || url.pathname === "/skill.md")) {
      return new Response(README, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    // Reference docs
    if (method === "GET" && parts[0] === "reference" && parts.length === 2) {
      const doc = REFERENCE_FILES[parts[1]];
      if (doc) return new Response(doc, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    return json({ error: "not found" }, 404);
  }

  // Parse body for mutations
  let body: any = undefined;
  if (method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH") {
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
  if (method === "GET" && sub === "wait") return waitForCondition(roomId, url, auth);

  // ---- Context ----
  if (method === "GET" && sub === "context") return getContext(roomId, url, auth);

  // ---- Dashboard poll ----
  if (method === "GET" && sub === "poll") return dashboardPoll(roomId, url, auth);

  // ---- Replay ----
  if (method === "GET" && sub === "replay" && subId) {
    const seq = parseInt(subId);
    if (isNaN(seq) || seq < 0) return json({ error: "seq must be a non-negative integer" }, 400);
    const result = await replayRoom(roomId, seq);
    return json(result);
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
    // Check if room already has a view token
    const existing = await sqlite.execute({
      sql: `SELECT view_token_hash FROM rooms WHERE id = ?`, args: [roomId],
    });
    const room = rows2objects(existing)[0];
    if (room?.view_token_hash) {
      return json({ error: "view_token_exists", message: "room already has a view token — use rotate-view-token to replace it" }, 409);
    }
    return rotateViewToken(roomId);
  }

  return json({ error: "not found" }, 404);
}
