/**
 * mcp.ts — sync-mcp HTTP router + MCP protocol handler
 *
 * v7 Phase 1: extractSession also checks unified tokens table for tok_ tokens.
 */

import {
  cleanupExpired, ensureSchema, validateAccessToken,
  getUserSession, createUserSession, getUserRoom, getEmbodiment,
  parseScope, checkRoomInScope,
  validateTokenByHash,
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
const SERVER_VERSION = "3.1.0";
const PROTOCOL_VERSION = "2025-03-26";

// ─── Schema init (runs once per cold start) ──────────────────────

let schemaReady = false;
async function initSchema() {
  if (!schemaReady) {
    await ensureSchema();
    schemaReady = true;
    cleanupExpired().catch(() => {});
    db.cleanupDeviceCodes().catch(() => {});
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

// ─── Session extraction ──────────────────────────────────────────

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
  // Skip sync tokens (room_xxx, as_xxx, view_xxx) — those are per-call legacy
  if (
    token.startsWith("room_") || token.startsWith("as_") ||
    token.startsWith("view_")
  ) return null;

  // ── v7: Check unified tokens table for tok_ tokens ──
  if (token.startsWith("tok_")) {
    const tokenHash = await db.sha256(token);
    const tok = await validateTokenByHash(tokenHash);
    if (!tok) return null;
    return {
      userId: tok.mintedBy,
      clientId: tok.clientId ?? "unified",
      tokenHash,
      scope: parseScope(tok.scope),
    };
  }

  // ── Existing path: smcp_at_ tokens via smcp_access_tokens table ──
  const valid = await validateAccessToken(token);
  if (!valid) return null;

  const tokenHash = await db.sha256(token);

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
    } catch (_) { /* race condition */ }
    if (!session) {
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
        "OAuth Bearer token required. Complete the OAuth flow or use device auth to authenticate.",
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

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // ── Well-Known ──
  if (req.method === "GET" && path === "/.well-known/oauth-protected-resource") {
    return handlePRM(req);
  }
  if (req.method === "GET" && path === "/.well-known/oauth-authorization-server") {
    return handleASMetadata(req);
  }

  // ── OAuth ──
  if (req.method === "POST" && path === "/oauth/register") return handleDCR(req);
  if (req.method === "GET" && path === "/oauth/authorize") return handleAuthorize(req);
  if (req.method === "POST" && path === "/oauth/consent") return handleConsent(req);
  if (req.method === "POST" && path === "/oauth/token") return handleToken(req);

  // ── WebAuthn ──
  if (req.method === "POST" && path === "/webauthn/register/options") return handleRegisterOptions(req);
  if (req.method === "POST" && path === "/webauthn/register/verify") return handleRegisterVerify(req);
  if (req.method === "POST" && path === "/webauthn/authenticate/options") return handleAuthOptions(req);
  if (req.method === "POST" && path === "/webauthn/authenticate/verify") return handleAuthVerify(req);

  // ── Management UI ──
  if (req.method === "GET" && path === "/manage") return handleManagePage(req);
  if (path.startsWith("/manage/api")) return handleManageApi(req);

  // ── Recovery ──
  if (req.method === "GET" && path === "/recover") return handleRecoverPage(req);
  if (req.method === "POST" && path === "/recover/validate") return handleRecoverValidate(req);
  if (req.method === "POST" && path === "/recover/register/options") return handleRecoverRegisterOptions(req);
  if (req.method === "POST" && path === "/recover/register/verify") return handleRecoverRegisterVerify(req);

  // ── Vault API (REMOVED — legacy, kept as 410 for old clients) ──
  if (path.startsWith("/vault")) {
    return corsJson({ error: "vault_deprecated", message: "Vault has been replaced by unified tokens. Use /tokens endpoints." }, 410);
  }

  // ── MCP: DELETE ──
  if (req.method === "DELETE" && (path === "/mcp" || path === "/")) {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  // ── MCP: GET (server info) ──
  if (req.method === "GET" && (path === "/" || path === "/mcp")) {
    return corsJson({
      name: SERVER_NAME,
      version: SERVER_VERSION,
      protocol: "MCP",
      protocolVersion: PROTOCOL_VERSION,
      transport: "streamable-http",
      auth: "OAuth 2.1 + WebAuthn passkeys + Device Auth",
      tools: TOOLS.map((t) => t.name),
      description:
        "MCP server for sync — multi-agent coordination platform (https://sync.parc.land)",
      endpoints: {
        mcp: "POST /mcp (JSON-RPC 2.0, requires OAuth or device auth token)",
        device_auth: "POST /auth/device (initiate), GET /auth/device (approve), POST /auth/device/token (poll)",
        tokens: "POST /tokens (mint), GET /tokens (list), DELETE /tokens/:id (revoke)",
        oauth_prm: "GET /.well-known/oauth-protected-resource",
        oauth_metadata: "GET /.well-known/oauth-authorization-server",
        oauth_register: "POST /oauth/register",
        oauth_authorize: "GET /oauth/authorize",
        oauth_token: "POST /oauth/token",
      },
    });
  }

  // ── MCP: POST (JSON-RPC — requires OAuth or unified token) ──
  if (req.method === "POST" && (path === "/mcp" || path === "/")) {
    const session = await extractSession(req);
    if (!session) return unauthorizedResponse(req);

    const ctx: ToolContext = {
      userId: session.userId,
      clientId: session.clientId,
      sessionHash: session.tokenHash,
      scope: session.scope,

      async resolveForRoom(roomId: string) {
        const scopeCheck = checkRoomInScope(session.scope, roomId, "observe");
        if (!scopeCheck.allowed) {
          // Surface elevation URL for scope_denied — agent can present to user
          const tokenResult = await db.validateTokenByHash(session.tokenHash);
          if (tokenResult) {
            const elevateUrl = `https://sync.parc.land/auth/elevate?token_id=${encodeURIComponent(tokenResult.id)}&room=${encodeURIComponent(roomId)}`;
            throw new Error(`scope_denied: Token scope does not include room "${roomId}". To request access, ask the user to open: ${elevateUrl}`);
          }
          return null;
        }

        // v7: user_rooms is the source of truth. No vault fallback.
        const userRoom = await getUserRoom(session.userId, roomId);
        if (!userRoom) return null;

        // Check for active embodiment in this room
        const embodiedAgentId = await getEmbodiment(session.tokenHash, roomId);
        if (embodiedAgentId) {
          const agentAuth = await resolveAgentAuth(roomId, embodiedAgentId);
          if (agentAuth) return { auth: agentAuth, agentId: embodiedAgentId };
          await db.removeEmbodiment(session.tokenHash, roomId);
        }

        // Not embodied — return access level based on user_rooms role
        const isOwner = userRoom.access === "owner";
        return {
          auth: {
            authenticated: true,
            kind: (isOwner ? "room" : "view") as "room" | "view",
            agentId: null,
            roomId,
            grants: isOwner ? ["*"] : [],
            userId: session.userId,
          },
          agentId: null,
        };
      },

      // Legacy resolver — kept for backward compat with old tool paths
      // that pass explicit token params. Will be removed in Phase 5.
      resolveToken: (room?: string, token?: string) =>
        resolveToken(session.userId, room, token),

      // v7: Admin auth from user_rooms owner role, no vault lookup needed
      async resolveAdminAuth(roomId: string) {
        const userRoom = await getUserRoom(session.userId, roomId);
        if (!userRoom || userRoom.access !== "owner") return null;
        // Construct admin AuthResult directly from ownership
        return {
          authenticated: true,
          kind: "room" as const,
          agentId: null,
          roomId,
          grants: ["*"],
          userId: session.userId,
        };
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

    if (Array.isArray(body)) {
      const responses = await Promise.all(
        (body as JsonRpcRequest[]).map((r) => handleRpc(r, ctx)),
      );
      return new Response(JSON.stringify(responses), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const response = await handleRpc(body as JsonRpcRequest, ctx);
    return new Response(JSON.stringify(response), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return corsJson({ error: "Not found. POST JSON-RPC to /mcp" }, 404);
}
