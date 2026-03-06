/**
 * main.ts — sync-mcp HTTP router + MCP protocol handler
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

import { cleanupExpired, ensureSchema, validateAccessToken } from "./db.ts";
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
import { type ToolContext, TOOLS } from "./tools.ts";

// ─── Configuration ───────────────────────────────────────────────

const SERVER_NAME = "sync-mcp-server";
const SERVER_VERSION = "2.0.0";
const PROTOCOL_VERSION = "2025-03-26";

// ─── Schema init (runs once per cold start) ──────────────────────

let schemaReady = false;
async function initSchema() {
  if (!schemaReady) {
    await ensureSchema();
    schemaReady = true;
    // Background cleanup
    cleanupExpired().catch(() => {});
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

// ─── Auth extraction ─────────────────────────────────────────────

async function extractUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.substring(7);
  // Skip sync tokens (room_xxx, as_xxx, view_xxx) — those are per-call
  if (
    token.startsWith("room_") || token.startsWith("as_") ||
    token.startsWith("view_")
  ) return null;

  const valid = await validateAccessToken(token);
  return valid?.userId ?? null;
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
    const userId = await extractUserId(req);
    if (!userId) {
      return unauthorizedResponse(req);
    }
    return handleVault(req, userId);
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
    const userId = await extractUserId(req);
    if (!userId) {
      // Return 401 with WWW-Authenticate to trigger MCP OAuth discovery
      return unauthorizedResponse(req);
    }

    // Build tool context with authenticated user
    const ctx: ToolContext = {
      userId,
      resolveToken: (room?: string, token?: string) =>
        resolveToken(userId, room, token),
      resolveAdminToken: (room: string) => resolveAdminToken(userId, room),
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