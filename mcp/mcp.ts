/**
 * mcp.ts — sync-mcp HTTP router + MCP protocol handler
 *
 * Routes:
 *   POST /mcp                                  — MCP JSON-RPC (requires OAuth)
 *   GET  /mcp                                  — Server info
 *   DELETE /mcp                                — Session termination (no-op)
 *   GET  /.well-known/oauth-protected-resource — PRM (RFC 9728)
 *   GET  /.well-known/oauth-authorization-server — AS metadata (RFC 8414)
 *   POST /oauth/register                       — Dynamic Client Registration
 *   GET  /oauth/authorize                      — Authorization + WebAuthn page
 *   POST /oauth/consent                        — Consent → auth code
 *   POST /oauth/token                          — Token exchange
 *   POST /webauthn/register/options             — WebAuthn registration options
 *   POST /webauthn/register/verify              — WebAuthn registration verify
 *   POST /webauthn/authenticate/options         — WebAuthn auth options
 *   POST /webauthn/authenticate/verify          — WebAuthn auth verify
 *   GET/POST/DELETE /vault                      — Token vault API
 *   GET  /manage                                — Management UI
 *   GET/POST/DELETE /manage/api/*               — Management API (session-auth)
 *   GET  /recover                               — Recovery page (passkey re-registration)
 *   POST /recover/validate                      — Validate recovery token
 *   POST /recover/register/options              — WebAuthn reg options (recovery-scoped)
 *   POST /recover/register/verify               — WebAuthn reg verify + consume token
 */

import {
  cleanupExpired, ensureSchema, validateAccessToken,
  getUserSession, createUserSession, getUserRoom, getEmbodiment,
  vaultGetForRoom, parseScope, checkRoomInScope,
  type ParsedScope,
} from "./db.ts";
import * as db from "./db.ts";
import {
  handleASMetadata,
  handleAuthOptions,
  handleAuthorize,
  handleAuthVerify,
  handleConsent,
  handleDCR,
  handleManageApi,
  handleManagePage,
  handlePRM,
  handleRecoverPage,
  handleRecoverRegisterOptions,
  handleRecoverRegisterVerify,
  handleRecoverValidate,
  handleRegisterOptions,
  handleRegisterVerify,
  handleToken,
  handleVault,
  resolveAdminToken,
  resolveToken,
} from "./auth.tsx";
import {
  resolveAuthFromToken,
  resolveAgentAuth,
  type AuthResult,
} from "../auth.ts";
import { type ToolContext, TOOLS } from "./tools.ts";

// ─── Configuration ───────────────────────────────────────────────

const SERVER_NAME = "sync-mcp-server";
const SERVER_VERSION = "3.0.0";
const PROTOCOL_VERSION = "2025-03-26";

// ─── Schema init (runs once per cold start) ──────────────────────

let schemaReady = false;
async function initSchema() {
  if (!schemaReady) {
    await ensureSchema();
    schemaReady = true;
    // Background cleanup
    cleanupExpired().catch(() => {});
    // One-time vault → user_rooms migration
    db.migrateVaultToUserRooms().catch(() => {});
  }
}

// ─── MCP Protocol (JSON-RPC 2.0) ────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function rpcResult(
  id: string | number | null | undefined,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

function toolsToSchema() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
  }));
}

async function handleRpc(
  req: JsonRpcRequest,
  ctx: ToolContext,
): Promise<JsonRpcResponse> {
  const { method, id, params } = req;

  // ── Lifecycle ──
  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
  }

  if (method === "notifications/initialized" || method === "ping") {
    return rpcResult(id, {});
  }

  // ── Tools ──
  if (method === "tools/list") {
    return rpcResult(id, { tools: toolsToSchema() });
  }

  if (method === "tools/call") {
    const toolName = (params as any)?.name;
    const toolArgs = (params as any)?.arguments ?? {};

    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      return rpcError(id, -32602, `Unknown tool: ${toolName}`);
    }

    try {
      const result = await tool.handler(toolArgs, ctx);
      return rpcResult(id, {
        content: [
          {
            type: "text",
            text: typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2),
          },
        ],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return rpcResult(id, {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      });
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

// ─── Session extraction (replaces extractUserId) ─────────────────

interface SessionInfo {
  userId: string;
  clientId: string;
  tokenHash: string;
  scope: ParsedScope;
}

async function extractSession(req: Request): Promise<SessionInfo | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.substring(7);
  // Skip sync tokens (room_xxx, as_xxx, view_xxx) — those are per-call
  if (
    token.startsWith("room_") || token.startsWith("as_") ||
    token.startsWith("view_")
  ) return null;

  const valid = await validateAccessToken(token);
  if (!valid) return null;

  // Compute token hash for session lookup
  const tokenHash = await db.sha256(token);

  // Look up or lazily create user session row
  let session = await getUserSession(tokenHash);
  if (!session) {
    try {
      await createUserSession({
        tokenHash,
        userId: valid.userId,
        clientId: valid.clientId,
        scope: valid.scope ?? "sync:rooms",
        expiresAt: valid.expiresAt,
      });
      session = await getUserSession(tokenHash);
    } catch (_) { /* race condition — another call created it */ }
    if (!session) {
      // Fallback: return minimal info without session row
      return {
        userId: valid.userId,
        clientId: valid.clientId,
        tokenHash,
        scope: parseScope(valid.scope ?? "sync:rooms"),
      };
    }
  }

  return {
    userId: session.userId,
    clientId: session.clientId,
    tokenHash: session.tokenHash,
    scope: parseScope(session.scope),
  };
}

// ─── 401 Challenge ───────────────────────────────────────────────

function unauthorizedResponse(req: Request): Response {
  const origin = new URL(req.url);
  const prmUrl =
    `${origin.protocol}//${origin.host}/.well-known/oauth-protected-resource`;
  return new Response(
    JSON.stringify({
      error: "unauthorized",
      error_description:
        "OAuth Bearer token required. Complete the OAuth flow to authenticate.",
    }),
    {
      status: 401,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer resource_metadata="${prmUrl}"`,
      },
    },
  );
}

// ─── CORS ────────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Session-Id, X-Session-Id",
};

function corsJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ─── HTTP Router ─────────────────────────────────────────────────

export async function handleMcpRequest(req: Request): Promise<Response> {
  await initSchema();

  const url = new URL(req.url);
  const path = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // ── Well-Known endpoints (unauthenticated — required for discovery) ──
  if (
    req.method === "GET" && path === "/.well-known/oauth-protected-resource"
  ) {
    return handlePRM(req);
  }
  if (
    req.method === "GET" && path === "/.well-known/oauth-authorization-server"
  ) {
    return handleASMetadata(req);
  }

  // ── OAuth endpoints (unauthenticated — part of the auth flow itself) ──
  if (req.method === "POST" && path === "/oauth/register") {
    return handleDCR(req);
  }
  if (req.method === "GET" && path === "/oauth/authorize") {
    return handleAuthorize(req);
  }
  if (req.method === "POST" && path === "/oauth/consent") {
    return handleConsent(req);
  }
  if (req.method === "POST" && path === "/oauth/token") {
    return handleToken(req);
  }

  // ── WebAuthn endpoints (unauthenticated — part of the auth flow) ──
  if (req.method === "POST" && path === "/webauthn/register/options") {
    return handleRegisterOptions(req);
  }
  if (req.method === "POST" && path === "/webauthn/register/verify") {
    return handleRegisterVerify(req);
  }
  if (req.method === "POST" && path === "/webauthn/authenticate/options") {
    return handleAuthOptions(req);
  }
  if (req.method === "POST" && path === "/webauthn/authenticate/verify") {
    return handleAuthVerify(req);
  }

  // ── Management UI (WebAuthn session-authenticated) ──
  if (req.method === "GET" && path === "/manage") {
    return handleManagePage(req);
  }
  if (path.startsWith("/manage/api")) {
    return handleManageApi(req);
  }

  // ── Recovery (unauthenticated — uses recovery token) ──
  if (req.method === "GET" && path === "/recover") {
    return handleRecoverPage(req);
  }
  if (req.method === "POST" && path === "/recover/validate") {
    return handleRecoverValidate(req);
  }
  if (req.method === "POST" && path === "/recover/register/options") {
    return handleRecoverRegisterOptions(req);
  }
  if (req.method === "POST" && path === "/recover/register/verify") {
    return handleRecoverRegisterVerify(req);
  }

  // ── Vault API (requires OAuth) ──
  if (path.startsWith("/vault")) {
    const session = await extractSession(req);
    if (!session) {
      return unauthorizedResponse(req);
    }
    return handleVault(req, session.userId);
  }

  // ── MCP: DELETE (session termination, no-op for stateless) ──
  if (req.method === "DELETE" && (path === "/mcp" || path === "/")) {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  // ── MCP: GET (server info — unauthenticated for discoverability) ──
  if (req.method === "GET" && (path === "/" || path === "/mcp")) {
    return corsJson({
      name: SERVER_NAME,
      version: SERVER_VERSION,
      protocol: "MCP",
      protocolVersion: PROTOCOL_VERSION,
      transport: "streamable-http",
      auth: "OAuth 2.1 + WebAuthn passkeys",
      tools: TOOLS.map((t) => t.name),
      description:
        "MCP server for sync — multi-agent coordination platform (https://sync.parc.land)",
      endpoints: {
        mcp: "POST /mcp (JSON-RPC 2.0, requires OAuth)",
        oauth_prm: "GET /.well-known/oauth-protected-resource",
        oauth_metadata: "GET /.well-known/oauth-authorization-server",
        oauth_register: "POST /oauth/register",
        oauth_authorize: "GET /oauth/authorize",
        oauth_token: "POST /oauth/token",
        vault: "GET/POST/DELETE /vault",
      },
    });
  }

  // ── MCP: POST (JSON-RPC — requires OAuth) ──
  if (req.method === "POST" && (path === "/mcp" || path === "/")) {
    // Require OAuth Bearer token
    const session = await extractSession(req);
    if (!session) {
      return unauthorizedResponse(req);
    }

    // Build tool context with session-aware resolution
    const ctx: ToolContext = {
      userId: session.userId,
      clientId: session.clientId,
      sessionHash: session.tokenHash,
      scope: session.scope,

      // New: resolve auth for a room accounting for embodiment
      async resolveForRoom(roomId: string) {
        // 1. Check scope allows this room
        const scopeCheck = checkRoomInScope(session.scope, roomId, "observe");
        if (!scopeCheck.allowed) return null;

        // 2. Check user_rooms for access level
        const userRoom = await getUserRoom(session.userId, roomId);
        if (!userRoom) {
          // Fallback: check vault for legacy tokens
          const vaultEntries = await vaultGetForRoom(session.userId, roomId);
          if (vaultEntries.length === 0) return null;
          const best = vaultEntries.find(e => e.tokenType === "agent")
                    ?? vaultEntries.find(e => e.tokenType === "room")
                    ?? vaultEntries[0];
          const auth = await resolveAuthFromToken(best.token, roomId);
          if (auth instanceof Response) return null;
          return { auth, agentId: auth.agentId };
        }

        // 3. Check for active embodiment in this room
        const embodiedAgentId = await getEmbodiment(
          session.tokenHash, roomId,
        );
        if (embodiedAgentId) {
          const agentAuth = await resolveAgentAuth(roomId, embodiedAgentId);
          if (agentAuth) return { auth: agentAuth, agentId: embodiedAgentId };
          // Agent no longer exists — clean up stale embodiment
          await db.removeEmbodiment(session.tokenHash, roomId);
        }

        // 4. Not embodied — return view-level access
        return {
          auth: {
            authenticated: true,
            kind: "view" as const,
            agentId: null,
            roomId,
            grants: [],
          },
          agentId: null,
        };
      },

      // Legacy resolver (backward compat)
      resolveToken: (room?: string, token?: string) =>
        resolveToken(session.userId, room, token),

      // Admin auth for privilege escalation
      async resolveAdminAuth(roomId: string) {
        const userRoom = await getUserRoom(session.userId, roomId);
        if (!userRoom || userRoom.access !== "owner") return null;
        const adminToken = await resolveAdminToken(session.userId, roomId);
        if (!adminToken) return null;
        const auth = await resolveAuthFromToken(adminToken, roomId);
        if (auth instanceof Response) return null;
        return auth;
      },
    };

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify(rpcError(null, -32700, "Parse error")),
        {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    }

    // Handle batch
    if (Array.isArray(body)) {
      const responses = await Promise.all(
        (body as JsonRpcRequest[]).map((r) => handleRpc(r, ctx)),
      );
      return new Response(JSON.stringify(responses), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Single request
    const response = await handleRpc(body as JsonRpcRequest, ctx);
    return new Response(JSON.stringify(response), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return corsJson({ error: "Not found. POST JSON-RPC to /mcp" }, 404);
}
