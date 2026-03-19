/**
 * tools.ts — MCP tool definitions for sync-mcp
 *
 * v3: Agency & Identity model.
 * - New ToolContext with resolveForRoom (session-aware, embodiment-aware)
 * - Observe/embody split: read_context is view-level by default, mutations require embodiment
 * - New tools: sync_lobby, sync_embody, sync_disembody, sync_restrict_scope, sync_revoke_access
 * - Context decoration: _session block + _current/_switchable agent annotations
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { rows2objects } from "../utils.ts";
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
  insertAgentDirect,
  waitForCondition,
  type ContextRequest,
} from "../main.ts";

import {
  resolveAuthFromToken,
  resolveAgentAuth,
  generateToken,
  hashToken,
  type AuthResult,
} from "../auth.ts";

import { releaseAgent, fetchRoomRoles } from "../agents.ts";
import { migrate } from "../schema.ts";

import * as db from "./db.ts";
import {
  type ParsedScope,
  parseScope,
  serializeScope,
  checkRoomInScope,
} from "./scope.ts";

import {
  type ToolContext,
  type ToolDef,
  tokenToAuth,
  resolveForTool,
  unwrap,
  withResponseEscalation,
  decorateContextWithSession,
} from "./tool-context.ts";

// Re-export for mcp.ts
export type { ToolContext, ToolDef };

// ─── Ensure schema on first tool call ────────────────────────────

let migrated = false;
async function ensureMigrated() {
  if (!migrated) { await migrate(); migrated = true; }
}

// ─── Tool Definitions ────────────────────────────────────────────

export const TOOLS: ToolDef[] = [
  // ═══════════════════════════════════════════════════════════════
  // NEW: Agency & Identity tools
  // ═══════════════════════════════════════════════════════════════

  {
    name: "sync_lobby",
    title: "Lobby",
    description: `Overview of your rooms, agents, and roles. The starting point.

Returns rooms you have access to, with agents, roles, access levels,
and current embodiments. Agents are annotated with _current and _switchable.

This is observation — no agent presence is created.`,
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(_params, ctx) {
      if (!ctx.userId) throw new Error("OAuth required");
      await ensureMigrated();

      const userRooms = await db.listUserRooms(ctx.userId);
      const embodiments = ctx.sessionHash
        ? await db.listEmbodiments(ctx.sessionHash) : [];

      const rooms = [];
      for (const ur of userRooms) {
        // Check scope allows this room — wildcard grants access to all
        if (ctx.scope && ctx.scope.rooms.size > 0 && !ctx.scope.wildcardRooms) {
          if (!ctx.scope.rooms.has(ur.roomId)) continue;
        }

        // Fetch room agents
        const agentsResult = await sqlite.execute({
          sql: `SELECT id, name, role, status, last_heartbeat, waiting_on
                FROM agents WHERE room_id = ? ORDER BY joined_at`,
          args: [ur.roomId],
        });
        const agents = rows2objects(agentsResult);

        // Fetch role definitions
        const roles = await fetchRoomRoles(ur.roomId);

        const currentEmbodiment = embodiments.find(e => e.roomId === ur.roomId);
        const canEmbody = ur.access !== "observer";

        const switchableAgents = canEmbody ? agents.filter((a: any) => {
          if (a.id === currentEmbodiment?.agentId) return false;
          return a.status === "idle" || a.status === "done";
        }).map((a: any) => a.id as string) : [];

        const unfilledRoles = Object.entries(roles)
          .filter(([_, def]) => !def.filled_by)
          .map(([id]) => id)
          .filter(id => !switchableAgents.includes(id));

        const scopeLevel = ctx.scope?.rooms.get(ur.roomId);

        rooms.push({
          id: ur.roomId,
          access: ur.access,
          label: ur.label,
          scope_level: scopeLevel
            ? (scopeLevel.level === "role" ? `role:${scopeLevel.role}` : scopeLevel.level)
            : "full",
          roles,
          agents: agents.map((a: any) => ({
            id: a.id, name: a.name, role: a.role, status: a.status,
            last_heartbeat: a.last_heartbeat, waiting_on: a.waiting_on,
            _current: currentEmbodiment?.agentId === a.id,
            _switchable: canEmbody && (a.status === "idle" || a.status === "done") && a.id !== currentEmbodiment?.agentId,
          })),
          unfilled_roles: unfilledRoles,
          embodied_as: currentEmbodiment?.agentId ?? null,
        });
      }

      return {
        user: (await db.getUserById(ctx.userId))?.username ?? ctx.userId,
        client: ctx.clientId,
        rooms,
        can_create_rooms: ctx.scope?.createRooms ?? true,
        active_embodiments: embodiments,
      };
    },
  },

  {
    name: "sync_embody",
    title: "Embody Agent",
    description: `Commit to an agent in a room. Creates, takes over, or switches agents.

Switching: if already embodied in this room, the old agent is cleanly
released (set idle, filled_by cleared) before the new one activates.
Always returns fresh context as the new agent.

One session can embody agents in multiple rooms simultaneously.
One agent per room per session — call sync_embody again to switch.

Args:
  - room (string, required): Room ID.
  - agent (string, optional): Existing agent ID to take over.
  - role (string, optional): Role to fill (creates/takes agent with role ID).
  - name (string, optional): Display name for new agent.
  - state (object, optional): Initial state for new agent.

Returns: Full context with self set to embodied agent, plus _session metadata.`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string", description: "Room ID" },
        agent: { type: "string", description: "Existing agent ID to take over" },
        role: { type: "string", description: "Role to fill" },
        name: { type: "string", description: "Display name for new agent" },
        state: { type: "object", description: "Initial state for new agent" },
      },
      required: ["room"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(params, ctx) {
      if (!ctx.userId || !ctx.sessionHash) throw new Error("OAuth required");
      await ensureMigrated();

      const roomId = params.room as string;

      // 1. Scope check
      const requiredLevel = params.role ? "embody_role" as const : "embody" as const;
      const scopeCheck = checkRoomInScope(ctx.scope!, roomId, requiredLevel, params.role as string);
      if (!scopeCheck.allowed) throw new Error(`Scope denied: ${scopeCheck.reason}`);

      // 2. User-room access check
      const userRoom = await db.getUserRoom(ctx.userId, roomId);
      if (!userRoom) throw new Error(`No access to room ${roomId}. Use sync_lobby to see your rooms.`);
      if (userRoom.access === "observer") throw new Error("Observer access cannot embody agents");

      // 3. Grants from access level
      const grants = (userRoom.access === "owner" || userRoom.access === "collaborator")
        ? ["_shared"] : [];

      // 4. Clean transition: release old agent if switching within this room
      const previousAgentId = await db.getEmbodiment(ctx.sessionHash, roomId);
      if (previousAgentId) {
        await releaseAgent(roomId, previousAgentId);
      }

      // 5. Determine agent ID
      let agentId: string;
      let isNewAgent = false;

      if (params.role) {
        agentId = params.role as string;
        // Verify role exists
        const roleState = await sqlite.execute({
          sql: `SELECT value FROM state WHERE room_id = ? AND scope = '_shared' AND key = ?`,
          args: [roomId, `roles.${agentId}`],
        });
        if (roleState.rows.length === 0) throw new Error(`Role "${agentId}" not defined in this room`);
      } else if (params.agent) {
        agentId = params.agent as string;
        const existing = await sqlite.execute({
          sql: `SELECT id FROM agents WHERE id = ? AND room_id = ?`,
          args: [agentId, roomId],
        });
        if (existing.rows.length === 0) throw new Error(`Agent "${agentId}" not found in room ${roomId}`);
      } else {
        // New agent — derive ID from user + client
        const user = await db.getUserById(ctx.userId);
        const username = user?.username ?? ctx.userId;
        const client = await db.getOAuthClient(ctx.clientId!);
        const clientSlug = (client?.clientName ?? "mcp")
          .toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
        agentId = `${username}:${clientSlug}`;
        isNewAgent = true;
      }

      // 6. Create or re-activate agent
      const existingAgent = await sqlite.execute({
        sql: `SELECT id FROM agents WHERE id = ? AND room_id = ?`,
        args: [agentId, roomId],
      });

      if (existingAgent.rows.length === 0 || isNewAgent) {
        const user = await db.getUserById(ctx.userId);
        await insertAgentDirect(roomId, {
          id: agentId,
          name: (params.name as string) ?? user?.username ?? "agent",
          role: params.role ? "role" : "mcp-client",
          grants,
          state: params.state as Record<string, any> | undefined,
        });
      } else {
        // Re-activate: rotate token, reset status, reset grants
        const newToken = generateToken("as");
        const newHash = await hashToken(newToken);
        await sqlite.execute({
          sql: `UPDATE agents SET token_hash = ?, status = 'active',
                last_heartbeat = datetime('now'), waiting_on = NULL, grants = ?
                WHERE id = ? AND room_id = ?`,
          args: [newHash, JSON.stringify(grants), agentId, roomId],
        });
      }

      // 7. Record embodiment
      await db.setEmbodiment(ctx.sessionHash, roomId, agentId);

      // 8. Update role filled_by if applicable
      if (params.role) {
        await sqlite.execute({
          sql: `UPDATE state SET
                  value = json_set(value, '$.filled_by', json(?)),
                  revision = revision + 1, updated_at = datetime('now')
                WHERE room_id = ? AND scope = '_shared' AND key = ?`,
          args: [JSON.stringify(agentId), roomId, `roles.${params.role}`],
        });
      }

      // 9. Return fresh context as the new agent
      const auth = await resolveAgentAuth(roomId, agentId);
      if (!auth) throw new Error("Failed to resolve agent auth after creation");
      const context = await buildExpandedContext(roomId, auth, { depth: "lean" });

      // 10. Decorate with _session
      return decorateContextWithSession(context, ctx, roomId, agentId);
    },
  },

  {
    name: "sync_disembody",
    title: "Disembody",
    description: `Release an agent in a room. Agent persists as idle; you stop driving it.

Args:
  - room (string, required): Room to disembody from.

Returns: Confirmation with disembodied agent ID.`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string", description: "Room to disembody from" },
      },
      required: ["room"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      if (!ctx.sessionHash) throw new Error("OAuth required");
      await ensureMigrated();
      const roomId = params.room as string;

      const agentId = await db.getEmbodiment(ctx.sessionHash, roomId);
      if (!agentId) throw new Error(`Not embodied in room ${roomId}`);

      // Clean transition
      await releaseAgent(roomId, agentId);

      await db.removeEmbodiment(ctx.sessionHash, roomId);
      return { ok: true, disembodied: agentId, room: roomId };
    },
  },

  {
    name: "sync_restrict_scope",
    title: "Restrict Scope",
    description: `Narrow your session's effective scope for a room.

Args:
  - room (string, required): Room ID.
  - level (string, required): "observe" or "role".
  - role (string, optional): Required when level is "role".`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        level: { type: "string", enum: ["observe", "role"] },
        role: { type: "string" },
      },
      required: ["room", "level"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      if (!ctx.sessionHash || !ctx.scope) throw new Error("OAuth required");
      const roomId = params.room as string;
      const level = params.level as string;
      const role = params.role as string | undefined;

      const newScope: ParsedScope = { rooms: new Map(ctx.scope.rooms), createRooms: ctx.scope.createRooms };
      if (level === "observe") {
        newScope.rooms.set(roomId, { level: "observe" });
        // Disembody if currently embodied
        const agentId = await db.getEmbodiment(ctx.sessionHash, roomId);
        if (agentId) {
          await releaseAgent(roomId, agentId);
          await db.removeEmbodiment(ctx.sessionHash, roomId);
        }
      } else if (level === "role") {
        if (!role) throw new Error("role parameter required when level is 'role'");
        newScope.rooms.set(roomId, { level: "role", role });
      }
      await db.updateSessionScope(ctx.sessionHash, serializeScope(newScope));
      return { ok: true, room: roomId, level, role };
    },
  },

  {
    name: "sync_revoke_access",
    title: "Revoke Room Access",
    description: `Remove a room from your session's effective scope.

Args:
  - room (string, required): Room to remove.`,
    inputSchema: {
      type: "object",
      properties: { room: { type: "string" } },
      required: ["room"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      if (!ctx.sessionHash || !ctx.scope) throw new Error("OAuth required");
      const roomId = params.room as string;
      const agentId = await db.getEmbodiment(ctx.sessionHash, roomId);
      if (agentId) {
        await releaseAgent(roomId, agentId);
        await db.removeEmbodiment(ctx.sessionHash, roomId);
      }
      const newScope: ParsedScope = { rooms: new Map(ctx.scope.rooms), createRooms: ctx.scope.createRooms };
      newScope.rooms.delete(roomId);
      await db.updateSessionScope(ctx.sessionHash, serializeScope(newScope));
      return { ok: true, revoked: roomId };
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // Room lifecycle
  // ═══════════════════════════════════════════════════════════════

  {
    name: "sync_create_room",
    title: "Create Room",
    description: `Create a new sync collaboration room. Returns the room ID, admin token, and view token.

If authenticated via OAuth, the room is registered in your user-rooms as owner
and added to your session scope.

Args:
  - id (string, optional): Custom room ID. Auto-generated if omitted.
  - meta (object, optional): Arbitrary metadata for the room.
  - label (string, optional): Label for this room.
  - set_default (boolean, optional): Make this the default room.

Returns: { id, token, view_token, created_at }`,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Custom room ID (auto-generated if omitted)" },
        meta: { type: "object", description: "Room metadata (any JSON)" },
        label: { type: "string", description: "Label for this room" },
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

      // v7: rooms.ts handles user_rooms linkage when auth has userId.
      // No vault auto-store needed.
      if (ctx.userId && result.id) {
        await db.upsertUserRoom(
          ctx.userId, result.id as string, "owner",
          (params.label as string) ?? `Room ${result.id}`,
          params.set_default as boolean ?? false,
        );
        // Widen session scope
        if (ctx.sessionHash && ctx.scope) {
          const newScope: ParsedScope = { rooms: new Map(ctx.scope.rooms), createRooms: ctx.scope.createRooms, wildcardRooms: ctx.scope.wildcardRooms };
          newScope.rooms.set(result.id as string, { level: "full" });
          await db.updateSessionScope(ctx.sessionHash, serializeScope(newScope));
        }
      }
      return result;
    },
  },

  {
    name: "sync_list_rooms",
    title: "List Rooms",
    description: `List rooms accessible with the given token. If authenticated, uses vault token.
Prefer sync_lobby for a richer overview with agents and roles.

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
      if (!ctx.userId) throw new Error("Authentication required. Use sync_lobby for a richer view.");
      // v7: Use user_rooms as source of truth
      const userRooms = await db.listUserRooms(ctx.userId);
      if (userRooms.length === 0) return [];
      const roomIds = userRooms.map(ur => ur.roomId);
      const placeholders = roomIds.map(() => "?").join(",");
      const result = await sqlite.execute({
        sql: `SELECT id, created_at, meta FROM rooms WHERE id IN (${placeholders}) ORDER BY created_at DESC`,
        args: roomIds,
      });
      return rows2objects(result);
    },
  },

  {
    name: "sync_join_room",
    title: "Join Room",
    description: `Join a sync room as an agent (low-level). Returns an agent token (as_xxx).
Prefer sync_embody for the agency-identity flow.

Args: room, token (optional), id, name, role, state, public_keys, views.

Returns: Agent object with { id, token, room_id, ... }`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
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
      const result = await withResponseEscalation(ctx, resolved.room, resolved.auth, async (auth) => {
        const req = new Request("http://internal/rooms/" + resolved.room + "/agents", {
          headers: auth.kind === "room"
            ? { Authorization: `Bearer room_placeholder` }
            : { Authorization: `Bearer ${resolved.token}` },
        });
        return joinRoom(resolved.room, body, req);
      }) as Record<string, unknown>;

      // v7: no vault auto-store. Agent tokens are returned to caller.
      return result;
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // Core rhythm: read → act
  // ═══════════════════════════════════════════════════════════════

  {
    name: "sync_read_context",
    title: "Read Context",
    description: `THE primary read operation. Returns the room context with wrapped entries.

Every entry is { value, _meta: { score, revision, writer, via, velocity, ... } }.
Entries are shaped by salience: high-score entries get full value + full _meta,
low-score entries are elided (value: null, _meta.elided: true, _meta.expand: "...").

Use .value to access stored data, ._meta for provenance/trajectory/salience.
Domain helpers: salient(), elided(), written_by(), focus(), keys(), entries().

If embodied: reads as agent (full scope, heartbeat). If not: observer (view-level).

Args:
  - room (string, required): Room ID.
  - token (string, optional): Auth token (legacy — prefer OAuth + embodiment).
  - depth: "lean" | "full" | "usage" — action detail level.
  - expand: comma-separated keys to force into Focus tier (e.g. "_shared.key1").
  - elision: "none" to disable elision entirely (return everything).
  - focus_threshold: score above which entries get full _meta (default: 0.5).
  - elide_threshold: score below which values are null (default: 0.1).
  - only, actions, messages, messages_after, messages_limit, include.

Returns: { state, views, agents, actions, messages, self, _shaping }`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string", description: "Room ID" },
        token: { type: "string", description: "Auth token (legacy)" },
        depth: { type: "string", enum: ["lean", "full", "usage"] },
        only: { type: "string" },
        actions: { type: "boolean" },
        messages: { type: "boolean" },
        messages_after: { type: "number" },
        messages_limit: { type: "number" },
        include: { type: "string" },
        expand: { type: "string", description: "Comma-separated keys to force into Focus tier" },
        elision: { type: "string", enum: ["none", "auto"], description: "Set to 'none' to disable elision" },
        focus_threshold: { type: "number", description: "Score threshold for full _meta (default: 0.5)" },
        elide_threshold: { type: "number", description: "Score threshold below which values are elided (default: 0.1)" },
      },
      required: ["room"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const roomId = params.room as string;

      // Build ContextRequest with v9 shaping params
      const ctxReq: ContextRequest = {};
      if (params.depth) ctxReq.depth = params.depth as "lean" | "full" | "usage";
      if (params.only) ctxReq.only = (params.only as string).split(",").map(s => s.trim());
      if (params.actions === false) ctxReq.actions = false;
      if (params.messages === false) ctxReq.messages = false;
      if (params.messages_after !== undefined) ctxReq.messagesAfter = params.messages_after as number;
      if (params.messages_limit !== undefined) ctxReq.messagesLimit = params.messages_limit as number;
      if (params.include) ctxReq.include = (params.include as string).split(",").map(s => s.trim());
      // v9 shaping
      if (params.expand) ctxReq.expand = (params.expand as string).split(",").map(s => s.trim());
      if (params.elision) ctxReq.elision = params.elision as "none" | "auto";
      if (params.focus_threshold !== undefined) ctxReq.focusThreshold = params.focus_threshold as number;
      if (params.elide_threshold !== undefined) ctxReq.elideThreshold = params.elide_threshold as number;

      // New path: session-aware resolution
      if (ctx.resolveForRoom) {
        const resolved = await ctx.resolveForRoom(roomId);
        if (!resolved) throw new Error(`No access to room ${roomId}. Use sync_lobby to see your rooms.`);

        const context = await buildExpandedContext(roomId, resolved.auth, ctxReq);
        return decorateContextWithSession(context, ctx, roomId, resolved.agentId);
      }

      // Legacy fallback: explicit token
      const resolved = await resolveForTool(ctx, params);
      return buildExpandedContext(resolved.room, resolved.auth, ctxReq);
    },
  },

  {
    name: "sync_invoke_action",
    title: "Invoke Action",
    description: `THE primary write operation. Invoke any action (built-in or custom) in a room.

Requires embodiment — call sync_embody first if not yet embodied.
Returns wrapped entries for written keys with _meta (score, writer, velocity,
contested) so the agent sees the structural consequences of its action.

Args:
  - room (string, required): Room ID.
  - token (string, optional): Auth token (legacy).
  - action (string, required): Action ID to invoke.
  - params (object, optional): Parameters for the action.

Returns: { invoked, action, agent, params, writes: [{ scope, key, value, _meta }], result? }`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        action: { type: "string", description: "Action ID to invoke" },
        params: { type: "object", description: "Action parameters" },
      },
      required: ["room", "action"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async handler(params, ctx) {
      await ensureMigrated();
      const roomId = params.room as string;

      // New path: session-aware
      if (ctx.resolveForRoom) {
        const resolved = await ctx.resolveForRoom(roomId);
        if (!resolved) throw new Error(`No access to room ${roomId}`);
        if (!resolved.agentId) {
          throw new Error(`Not embodied in room ${roomId}. Call sync_embody first.`);
        }
        const body: Record<string, unknown> = {};
        if (params.params) body.params = params.params;
        return unwrap(await invokeAction(roomId, params.action as string, body, resolved.auth));
      }

      // Legacy fallback
      const resolved = await resolveForTool(ctx, params);
      const body: Record<string, unknown> = {};
      if (params.params) body.params = params.params;
      return unwrap(await invokeAction(resolved.room, params.action as string, body, resolved.auth));
    },
  },

  {
    name: "sync_wait",
    title: "Wait for Condition",
    description: `Block until a CEL condition becomes true, then return room context.

Args:
  - room (string, required): Room ID.
  - token (string, optional): Auth token (legacy).
  - condition (string, required): CEL expression.
  - timeout (number, optional): Max wait ms (default: 25000).
  - depth, only: Context shaping params.

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
      required: ["room", "condition"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async handler(params, ctx) {
      await ensureMigrated();
      const roomId = params.room as string;

      // Resolve auth (embodied or view-level)
      let auth: AuthResult;
      if (ctx.resolveForRoom) {
        const resolved = await ctx.resolveForRoom(roomId);
        if (!resolved) throw new Error(`No access to room ${roomId}`);
        auth = resolved.auth;
      } else {
        const resolved = await resolveForTool(ctx, params);
        auth = resolved.auth;
      }

      // Build URL for waitForCondition
      const url = new URL(`http://internal/rooms/${roomId}/wait`);
      url.searchParams.set("condition", params.condition as string);
      if (params.timeout) url.searchParams.set("timeout", String(params.timeout));
      if (params.depth) url.searchParams.set("depth", params.depth as string);
      if (params.only) url.searchParams.set("only", params.only as string);

      return unwrap(await waitForCondition(roomId, url, auth));
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // Sugar for common built-in actions
  // ═══════════════════════════════════════════════════════════════

  {
    name: "sync_register_action",
    title: "Register Action",
    description: `Register a new action in a room. Requires embodiment.

Args: room (required), id (required), description, writes, params, scope, if, enabled, result, on_invoke.

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
      required: ["room", "id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const roomId = params.room as string;
      const actionBody: Record<string, unknown> = {};
      for (const key of ["id", "description", "writes", "params", "scope", "if", "enabled", "result", "on_invoke"]) {
        if (params[key] !== undefined) actionBody[key] = params[key];
      }

      if (ctx.resolveForRoom) {
        const resolved = await ctx.resolveForRoom(roomId);
        if (!resolved) throw new Error(`No access to room ${roomId}`);
        if (!resolved.agentId) throw new Error(`Not embodied in room ${roomId}. Call sync_embody first.`);
        return withResponseEscalation(ctx, roomId, resolved.auth, (auth) =>
          registerAction(roomId, actionBody, auth)
        );
      }

      const resolved = await resolveForTool(ctx, params);
      return withResponseEscalation(ctx, resolved.room, resolved.auth, (auth) =>
        registerAction(resolved.room, actionBody, auth)
      );
    },
  },

  {
    name: "sync_register_view",
    title: "Register View",
    description: `Register a computed view. Requires embodiment.

Args: room (required), id (required), expr (required), description, scope, enabled, render.

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
      required: ["room", "id", "expr"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const roomId = params.room as string;
      const viewBody: Record<string, unknown> = {};
      for (const key of ["id", "expr", "description", "scope", "enabled", "render"]) {
        if (params[key] !== undefined) viewBody[key] = params[key];
      }

      if (ctx.resolveForRoom) {
        const resolved = await ctx.resolveForRoom(roomId);
        if (!resolved) throw new Error(`No access to room ${roomId}`);
        if (!resolved.agentId) throw new Error(`Not embodied in room ${roomId}. Call sync_embody first.`);
        return withResponseEscalation(ctx, roomId, resolved.auth, (auth) =>
          registerView(roomId, viewBody, auth)
        );
      }

      const resolved = await resolveForTool(ctx, params);
      return withResponseEscalation(ctx, resolved.room, resolved.auth, (auth) =>
        registerView(resolved.room, viewBody, auth)
      );
    },
  },

  {
    name: "sync_send_message",
    title: "Send Message",
    description: `Send a message to a sync room. Requires embodiment.

Args: room (required), body (required), kind, to.

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
      required: ["room", "body"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const roomId = params.room as string;
      const msgParams: Record<string, unknown> = { body: params.body };
      if (params.kind) msgParams.kind = params.kind;
      if (params.to) msgParams.to = params.to;

      if (ctx.resolveForRoom) {
        const resolved = await ctx.resolveForRoom(roomId);
        if (!resolved) throw new Error(`No access to room ${roomId}`);
        if (!resolved.agentId) throw new Error(`Not embodied in room ${roomId}. Call sync_embody first.`);
        return unwrap(await invokeBuiltinAction(roomId, "_send_message", { params: msgParams }, resolved.auth));
      }

      const resolved = await resolveForTool(ctx, params);
      return unwrap(await invokeBuiltinAction(resolved.room, "_send_message", { params: msgParams }, resolved.auth));
    },
  },

  {
    name: "sync_help",
    title: "Get Help",
    description: `Access the sync help system.

Args: room (required), key (optional).

Returns: { content, version, source }`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        key: { type: "string", description: "Help key" },
      },
      required: ["room"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const roomId = params.room as string;
      const helpParams: Record<string, unknown> = {};
      if (params.key) helpParams.key = params.key;

      // Help works in observe mode — no embodiment required
      if (ctx.resolveForRoom) {
        const resolved = await ctx.resolveForRoom(roomId);
        if (!resolved) throw new Error(`No access to room ${roomId}`);
        return unwrap(await invokeBuiltinAction(roomId, "help", { params: helpParams }, resolved.auth));
      }

      const resolved = await resolveForTool(ctx, params);
      return unwrap(await invokeBuiltinAction(resolved.room, "help", { params: helpParams }, resolved.auth));
    },
  },

  {
    name: "sync_eval_cel",
    title: "Evaluate CEL",
    description: `Evaluate a CEL expression against the current room state.

Args: room (required), expr (required).

Returns: { expression, value }`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        expr: { type: "string", description: "CEL expression" },
      },
      required: ["room", "expr"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const roomId = params.room as string;

      if (ctx.resolveForRoom) {
        const resolved = await ctx.resolveForRoom(roomId);
        if (!resolved) throw new Error(`No access to room ${roomId}`);
        return unwrap(await evalExpression(roomId, { expr: params.expr }, resolved.auth));
      }

      const resolved = await resolveForTool(ctx, params);
      return unwrap(await evalExpression(resolved.room, { expr: params.expr }, resolved.auth));
    },
  },

  {
    name: "sync_delete_action",
    title: "Delete Action",
    description: `Remove an action from a room. Requires embodiment.

Args: room (required), id (required).`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        id: { type: "string", description: "Action ID to delete" },
      },
      required: ["room", "id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const roomId = params.room as string;

      if (ctx.resolveForRoom) {
        const resolved = await ctx.resolveForRoom(roomId);
        if (!resolved) throw new Error(`No access to room ${roomId}`);
        if (!resolved.agentId) throw new Error(`Not embodied in room ${roomId}. Call sync_embody first.`);
        return unwrap(await deleteAction(roomId, params.id as string, resolved.auth));
      }

      const resolved = await resolveForTool(ctx, params);
      return unwrap(await deleteAction(resolved.room, params.id as string, resolved.auth));
    },
  },

  {
    name: "sync_delete_view",
    title: "Delete View",
    description: `Remove a view from a room. Requires embodiment.

Args: room (required), id (required).`,
    inputSchema: {
      type: "object",
      properties: {
        room: { type: "string" },
        token: { type: "string" },
        id: { type: "string", description: "View ID to delete" },
      },
      required: ["room", "id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async handler(params, ctx) {
      await ensureMigrated();
      const roomId = params.room as string;

      if (ctx.resolveForRoom) {
        const resolved = await ctx.resolveForRoom(roomId);
        if (!resolved) throw new Error(`No access to room ${roomId}`);
        if (!resolved.agentId) throw new Error(`Not embodied in room ${roomId}. Call sync_embody first.`);
        return unwrap(await deleteView(roomId, params.id as string, resolved.auth));
      }

      const resolved = await resolveForTool(ctx, params);
      return unwrap(await deleteView(resolved.room, params.id as string, resolved.auth));
    },
  },

  // ═══════════════════════════════════════════════════════════════
  // Vault management — REMOVED in v7 (unified tokens replace vault)
  // Legacy vault tools have been removed. Use /tokens endpoints instead.
  // ═══════════════════════════════════════════════════════════════
];
