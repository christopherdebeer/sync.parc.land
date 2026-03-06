/**
 * tools.ts — MCP tool definitions for sync-mcp
 *
 * Direct function calls to sync's core (no HTTP proxy).
 * Auth resolution: vault token → AuthResult → direct function call.
 */

import {
  buildExpandedContext,
  createRoom,
  joinRoom,
  invokeAction,
  invokeBuiltinAction,
  registerAction,
  registerView,
  deleteAction,
  deleteView,
  evalExpression,
  listRooms,
  waitForCondition,
  type ContextRequest,
} from "../main.ts";

import {
  resolveAuthFromToken,
  type AuthResult,
} from "../auth.ts";

import { migrate } from "../schema.ts";

// ─── Ensure schema on first tool call ────────────────────────────

let migrated = false;
async function ensureMigrated() {
  if (!migrated) { await migrate(); migrated = true; }
}

// ─── Tool context (injected by MCP handler) ─────────────────────

export interface ToolContext {
  userId: string | null;
  resolveToken: (room?: string, token?: string) => Promise<{ room: string; token: string } | null>;
  resolveAdminToken: (room: string) => Promise<string | null>;
}

// ─── Auth helpers ────────────────────────────────────────────────

/** Convert a vault token string into an AuthResult for direct function calls. */
async function tokenToAuth(token: string, roomId: string): Promise<AuthResult> {
  const result = await resolveAuthFromToken(token, roomId);
  if (result instanceof Response) {
    const data = await result.json();
    throw new Error(data.error ?? data.message ?? "Invalid token");
  }
  return result;
}

/** Resolve vault → room + AuthResult for a tool call. */
async function resolveForTool(
  ctx: ToolContext,
  params: Record<string, unknown>,
): Promise<{ room: string; token: string; auth: AuthResult }> {
  const resolved = await ctx.resolveToken(
    params.room as string | undefined,
    params.token as string | undefined,
  );
  if (!resolved) {
    if (!ctx.userId) {
      throw new Error("Authentication required. Connect with OAuth or provide room + token parameters.");
    }
    throw new Error("No room specified and no default room in vault. Provide 'room' parameter or set a default room via sync_vault_store.");
  }
  const auth = await tokenToAuth(resolved.token, resolved.room);
  return { room: resolved.room, token: resolved.token, auth };
}

/** Unwrap a Response (from functions that return Response) into data.
 *  Throws on error status codes so MCP returns the error to the client. */
async function unwrap(response: Response): Promise<unknown> {
  const data = await response.json();
  if (response.status >= 400) {
    const msg = typeof data === "object"
      ? (data.error ?? data.message ?? JSON.stringify(data))
      : String(data);
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

/** Try with agent token first, escalate to admin on scope_denied. */
async function withEscalation<T>(
  ctx: ToolContext,
  room: string,
  agentAuth: AuthResult,
  fn: (auth: AuthResult) => Promise<T>,
  isError: (result: T) => boolean,
): Promise<T> {
  const result = await fn(agentAuth);
  if (!isError(result)) return result;

  // Try admin escalation
  const adminToken = await ctx.resolveAdminToken(room);
  if (!adminToken) return result;

  const adminAuth = await tokenToAuth(adminToken, room);
  return fn(adminAuth);
}

/** Escalation wrapper for functions returning Response. */
async function withResponseEscalation(
  ctx: ToolContext,
  room: string,
  agentAuth: AuthResult,
  fn: (auth: AuthResult) => Promise<Response>,
): Promise<unknown> {
  const response = await fn(agentAuth);
  if (response.status < 400) return response.json();

  const data = await response.json();
  const error = data?.error;
  const isScopeDenied = error === "scope_denied" || error === "room_token_required";

  if (!isScopeDenied) {
    throw new Error(typeof error === "string" ? error : JSON.stringify(data));
  }

  const adminToken = await ctx.resolveAdminToken(room);
  if (!adminToken) throw new Error(typeof error === "string" ? error : JSON.stringify(data));

  const adminAuth = await tokenToAuth(adminToken, room);
  return unwrap(await fn(adminAuth));
}

// ─── Tool Definitions ────────────────────────────────────────────

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  handler: (params: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export const TOOLS: ToolDef[] = [
  // ── Room lifecycle ──────────────────────────────────────────
  {
    name: "sync_create_room",
    title: "Create Room",
    description: `Create a new sync collaboration room. Returns the room ID, admin token, and view token.

If authenticated via OAuth, the room token is automatically saved to your vault.

Args:
  - id (string, optional): Custom room ID. Auto-generated if omitted.
  - meta (object, optional): Arbitrary metadata for the room.
  - label (string, optional): Vault label for this room.
  - set_default (boolean, optional): Make this the default room.

Returns: { id, token, view_token, created_at }`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Custom room ID (auto-generated if omitted)" },
        meta: { type: "object", description: "Room metadata (any JSON)" },
        label: { type: "string", description: "Vault label for this room" },
        set_default: { type: "boolean", description: "Make this the default room" },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const body: Record<string, unknown> = {};
      if (params.id) body.id = params.id;
      if (params.meta) body.meta = params.meta;
      const result = await unwrap(await createRoom(body)) as Record<string, unknown>;

      // Auto-vault if authenticated
      if (ctx.userId && result.token && result.id) {
        const { vaultStore } = await import("./db.ts");
        await vaultStore({
          userId: ctx.userId,
          roomId: result.id as string,
          token: result.token as string,
          tokenType: "room",
          label: (params.label as string) ?? `Room ${result.id}`,
          isDefault: params.set_default as boolean ?? false,
        });
        if (result.view_token) {
          await vaultStore({
            userId: ctx.userId,
            roomId: result.id as string,
            token: result.view_token as string,
            tokenType: "view",
            label: `View: ${result.id}`,
          });
        }
        result._vaulted = true;
      }
      return result;
    },
  },

  {
    name: "sync_list_rooms",
    title: "List Rooms",
    description: `List rooms accessible with the given token. If authenticated, uses vault token.

Args:
  - token (string, optional): Auth token. Optional if authenticated.

Returns: Array of room objects.`,
    inputSchema: {
      type: "object",
      properties: {
        token: { type: "string", description: "Auth token (room_xxx, view_xxx, or as_xxx). Optional if authenticated." },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      let token = params.token as string | undefined;
      if (!token && ctx.userId) {
        const { vaultList } = await import("./db.ts");
        const entries = await vaultList(ctx.userId);
        if (entries.length > 0) token = entries[0].token;
      }
      if (!token) throw new Error("No token available. Provide 'token' parameter or authenticate via OAuth.");
      // Construct minimal request for listRooms (it reads Authorization header)
      const fakeReq = new Request("http://internal/rooms", {
        headers: { Authorization: `Bearer ${token}` },
      });
      return unwrap(await listRooms(fakeReq));
    },
  },

  {
    name: "sync_join_room",
    title: "Join Room",
    description: `Join a sync room as an agent. Returns an agent token (as_xxx).

If authenticated, the agent token is automatically saved to your vault.

Args:
  - room (string, optional): Room ID (uses default if omitted).
  - token (string, optional): Room admin token (resolved from vault if omitted).
  - id (string, optional): Agent ID (auto-generated if omitted).
  - name (string, optional): Display name.
  - role (string, optional): Agent role.
  - state (object, optional): Initial private state.
  - public_keys (string[], optional): State keys to auto-expose as views.
  - views (array, optional): Pre-register views.

Returns: Agent object with { id, token, room_id, ... }`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string", description: "Room ID" },
        token: { type: "string", description: "Room admin token (room_xxx). Optional if authenticated." },
        id: { type: "string", description: "Agent ID" },
        name: { type: "string", description: "Display name" },
        role: { type: "string", description: "Agent role" },
        state: { type: "object", description: "Initial private state" },
        public_keys: { type: "array", items: { type: "string" }, description: "State keys to auto-expose" },
        views: { type: "array", items: { type: "object" }, description: "Views to pre-register" },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const resolved = await resolveForTool(ctx, params);
      const body: Record<string, unknown> = {};
      for (const key of ["id", "name", "role", "state", "public_keys", "views"]) {
        if (params[key] !== undefined) body[key] = params[key];
      }
      // joinRoom needs admin token — use escalation
      const fakeReq = new Request("http://internal/rooms/" + resolved.room + "/agents", {
        headers: { Authorization: `Bearer ${resolved.token}` },
      });
      const result = await withResponseEscalation(ctx, resolved.room, resolved.auth, async (auth) => {
        // joinRoom takes a Request for re-join token verification
        const req = new Request("http://internal/rooms/" + resolved.room + "/agents", {
          headers: auth.kind === "room"
            ? { Authorization: `Bearer room_placeholder` } // room auth resolved internally
            : { Authorization: `Bearer ${resolved.token}` },
        });
        return joinRoom(resolved.room, body, req);
      }) as Record<string, unknown>;

      // Auto-vault agent token
      if (ctx.userId && result.token) {
        const { vaultStore } = await import("./db.ts");
        await vaultStore({
          userId: ctx.userId,
          roomId: resolved.room,
          token: result.token as string,
          tokenType: "agent",
          label: `Agent: ${result.id ?? "unknown"}`,
        });
        result._vaulted = true;
      }
      return result;
    },
  },

  // ── Core rhythm: read → act ─────────────────────────────────

  {
    name: "sync_read_context",
    title: "Read Context",
    description: `THE primary read operation. Returns the full room context.

This is the "read" in the read → evaluate → act rhythm.

Args:
  - room (string, optional): Room ID (uses default if omitted).
  - token (string, optional): Auth token (resolved from vault if omitted).
  - depth (string, optional): "lean" | "full" | "usage"
  - only (string, optional): Section filter, e.g. "state,actions"
  - actions (boolean, optional): Include actions (default true)
  - messages (boolean, optional): Include messages (default true)
  - messages_after (number, optional): Seq cursor
  - messages_limit (number, optional): Max messages
  - include (string, optional): Extra scopes, e.g. "_audit"
  - compact (boolean, optional): Strip nulls

Returns: { state, views, agents, actions, messages, self, _context }`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string", description: "Room ID" },
        token: { type: "string", description: "Auth token" },
        depth: { type: "string", enum: ["lean", "full", "usage"] },
        only: { type: "string" },
        actions: { type: "boolean" },
        messages: { type: "boolean" },
        messages_after: { type: "number" },
        messages_limit: { type: "number" },
        include: { type: "string" },
        compact: { type: "boolean" },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const resolved = await resolveForTool(ctx, params);

      // Build ContextRequest directly (no URL parsing needed)
      const ctxReq: ContextRequest = {};
      if (params.depth) ctxReq.depth = params.depth as "lean" | "full" | "usage";
      if (params.only) ctxReq.only = (params.only as string).split(",").map(s => s.trim());
      if (params.actions === false) ctxReq.actions = false;
      if (params.messages === false) ctxReq.messages = false;
      if (params.messages_after !== undefined) ctxReq.messagesAfter = params.messages_after as number;
      if (params.messages_limit !== undefined) ctxReq.messagesLimit = params.messages_limit as number;
      if (params.include) ctxReq.include = (params.include as string).split(",").map(s => s.trim());

      // Direct call — returns data, not Response!
      return buildExpandedContext(resolved.room, resolved.auth, ctxReq);
    },
  },

  {
    name: "sync_invoke_action",
    title: "Invoke Action",
    description: `THE primary write operation. Invoke any action (built-in or custom) in a room.

This is the "act" in the read → evaluate → act rhythm.

Args:
  - room (string, optional): Room ID (uses default if omitted).
  - token (string, optional): Auth token (resolved from vault if omitted).
  - action (string, required): Action ID to invoke.
  - params (object, optional): Parameters for the action.
  - agent (string, optional): Agent identity override.

Returns: { invoked, action, agent, params, writes, result? }`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        action: { type: "string", description: "Action ID to invoke" },
        params: { type: "object", description: "Action parameters" },
        agent: { type: "string", description: "Agent identity override" },
      },
      required: ["action"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async handler(params, ctx) {
      await ensureMigrated();
      const resolved = await resolveForTool(ctx, params);
      const body: Record<string, unknown> = {};
      if (params.params) body.params = params.params;
      if (params.agent) body.agent = params.agent;

      // Direct call to invokeAction (handles both custom and builtin)
      return unwrap(await invokeAction(resolved.room, params.action as string, body, resolved.auth));
    },
  },

  {
    name: "sync_wait",
    title: "Wait for Condition",
    description: `Block until a CEL condition becomes true, then return room context.

Args:
  - room (string, optional): Room ID.
  - token (string, optional): Auth token.
  - condition (string, required): CEL expression.
  - timeout (number, optional): Max wait ms (default: 25000).

Returns: { triggered: true/false, condition, context }`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        condition: { type: "string", description: "CEL expression to wait for" },
        timeout: { type: "number" },
        depth: { type: "string", enum: ["lean", "full", "usage"] },
        only: { type: "string" },
      },
      required: ["condition"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async handler(params, ctx) {
      await ensureMigrated();
      const resolved = await resolveForTool(ctx, params);

      // Construct URL with query params for waitForCondition
      const url = new URL(`http://internal/rooms/${resolved.room}/wait`);
      url.searchParams.set("condition", params.condition as string);
      if (params.timeout) url.searchParams.set("timeout", String(params.timeout));
      if (params.depth) url.searchParams.set("depth", params.depth as string);
      if (params.only) url.searchParams.set("only", params.only as string);

      const auth = await tokenToAuth(resolved.token, resolved.room);
      const res = await waitForCondition(resolved.room, url, auth);
      return res.json();
    },
  },

  // ── Sugar for common built-in actions ───────────────────────

  {
    name: "sync_register_action",
    title: "Register Action",
    description: `Register a new action in a room.

Args: room, token (optional if authed), id (required), description, writes, params, scope, if, enabled, result, on_invoke.

Returns: Saved action definition.`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        id: { type: "string", description: "Action ID" },
        description: { type: "string" },
        writes: { type: "array", items: { type: "object" }, description: "Write templates" },
        params: { type: "object", description: "Parameter schema" },
        scope: { type: "string" },
        "if": { type: "string", description: "CEL precondition" },
        enabled: { type: "string", description: "CEL visibility gate" },
        result: { type: "string", description: "CEL result expression" },
        on_invoke: { type: "object", description: "Cooldown timer" },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const resolved = await resolveForTool(ctx, params);
      const actionBody: Record<string, unknown> = {};
      for (const key of ["id", "description", "writes", "params", "scope", "if", "enabled", "result", "on_invoke"]) {
        if (params[key] !== undefined) actionBody[key] = params[key];
      }
      // Uses escalation: agent token first, admin fallback for _shared scope
      return withResponseEscalation(ctx, resolved.room, resolved.auth, (auth) =>
        registerAction(resolved.room, actionBody, auth)
      );
    },
  },

  {
    name: "sync_register_view",
    title: "Register View",
    description: `Register a computed view — a named CEL expression.

Args: room, token (optional if authed), id (required), expr (required), description, scope, enabled, render.

Returns: View with current resolved value.`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        id: { type: "string" },
        expr: { type: "string" },
        description: { type: "string" },
        scope: { type: "string" },
        enabled: { type: "string" },
        render: { type: "object" },
      },
      required: ["id", "expr"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const resolved = await resolveForTool(ctx, params);
      const viewBody: Record<string, unknown> = {};
      for (const key of ["id", "expr", "description", "scope", "enabled", "render"]) {
        if (params[key] !== undefined) viewBody[key] = params[key];
      }
      return withResponseEscalation(ctx, resolved.room, resolved.auth, (auth) =>
        registerView(resolved.room, viewBody, auth)
      );
    },
  },

  {
    name: "sync_send_message",
    title: "Send Message",
    description: `Send a message to a sync room.

Args: room, token (optional if authed), body (required), kind, to.

Returns: { ok, seq, from, kind }`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        body: { type: "string", description: "Message content" },
        kind: { type: "string" },
        to: { type: "string", description: "Direct to agent(s)" },
      },
      required: ["body"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const resolved = await resolveForTool(ctx, params);
      const msgParams: Record<string, unknown> = { body: params.body };
      if (params.kind) msgParams.kind = params.kind;
      if (params.to) msgParams.to = params.to;
      return unwrap(await invokeBuiltinAction(resolved.room, "_send_message", { params: msgParams }, resolved.auth));
    },
  },

  {
    name: "sync_help",
    title: "Get Help",
    description: `Access the sync help system.

Args: room, token (optional if authed), key (optional).

Returns: { content, version, source }`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        key: { type: "string", description: "Help key" },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const resolved = await resolveForTool(ctx, params);
      const helpParams: Record<string, unknown> = {};
      if (params.key) helpParams.key = params.key;
      return unwrap(await invokeBuiltinAction(resolved.room, "help", { params: helpParams }, resolved.auth));
    },
  },

  {
    name: "sync_eval_cel",
    title: "Evaluate CEL",
    description: `Evaluate a CEL expression against the current room state.

Args: room, token (optional if authed), expr (required).

Returns: { expression, value }`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        expr: { type: "string", description: "CEL expression" },
      },
      required: ["expr"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const resolved = await resolveForTool(ctx, params);
      return unwrap(await evalExpression(resolved.room, { expr: params.expr }, resolved.auth));
    },
  },

  {
    name: "sync_delete_action",
    title: "Delete Action",
    description: `Remove an action from a room.

Args: room, token (optional if authed), id (required).`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        id: { type: "string", description: "Action ID to delete" },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const resolved = await resolveForTool(ctx, params);
      return unwrap(await deleteAction(resolved.room, params.id as string, resolved.auth));
    },
  },

  {
    name: "sync_delete_view",
    title: "Delete View",
    description: `Remove a view from a room.

Args: room, token (optional if authed), id (required).`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        id: { type: "string", description: "View ID to delete" },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const resolved = await resolveForTool(ctx, params);
      return unwrap(await deleteView(resolved.room, params.id as string, resolved.auth));
    },
  },

  // ── Vault management (auth-only) ───────────────────────────

  {
    name: "sync_vault_list",
    title: "List Vault",
    description: `List all sync tokens stored in your vault. Requires OAuth authentication.

Returns: Array of vault entries with room_id, token_type, label, is_default.`,
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(_params, ctx) {
      if (!ctx.userId) throw new Error("OAuth authentication required for vault access.");
      const { vaultList } = await import("./db.ts");
      const entries = await vaultList(ctx.userId);
      return entries.map((e) => ({
        id: e.id,
        room_id: e.roomId,
        token_type: e.tokenType,
        label: e.label,
        is_default: e.isDefault,
        token_preview: e.token.substring(0, 12) + "...",
      }));
    },
  },

  {
    name: "sync_vault_store",
    title: "Store Token in Vault",
    description: `Add a sync token to your vault. Requires OAuth authentication.

Args:
  - room_id (string, required): Room ID this token belongs to.
  - token (string, required): The sync token (room_xxx, as_xxx, or view_xxx).
  - token_type (string, required): "room", "agent", or "view".
  - label (string, optional): Human-readable label.
  - set_default (boolean, optional): Make this the default room.

Returns: { id, room_id, token_type }`,
    inputSchema: {
      type: "object",
      properties: {
        room_id: { type: "string" },
        token: { type: "string" },
        token_type: { type: "string", enum: ["room", "agent", "view"] },
        label: { type: "string" },
        set_default: { type: "boolean" },
      },
      required: ["room_id", "token", "token_type"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(params, ctx) {
      if (!ctx.userId) throw new Error("OAuth authentication required for vault access.");
      const { vaultStore } = await import("./db.ts");
      const id = await vaultStore({
        userId: ctx.userId,
        roomId: params.room_id as string,
        token: params.token as string,
        tokenType: params.token_type as string,
        label: params.label as string | undefined,
        isDefault: params.set_default as boolean | undefined,
      });
      return { id, room_id: params.room_id, token_type: params.token_type };
    },
  },

  {
    name: "sync_vault_remove",
    title: "Remove from Vault",
    description: `Remove a token from your vault. Requires OAuth authentication.

Args:
  - id (string, required): Vault entry ID (from sync_vault_list).

Returns: { deleted: true }`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Vault entry ID" },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      if (!ctx.userId) throw new Error("OAuth authentication required for vault access.");
      const { vaultDelete } = await import("./db.ts");
      await vaultDelete(ctx.userId, params.id as string);
      return { deleted: true, id: params.id };
    },
  },
];
