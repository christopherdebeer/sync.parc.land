/**
 * tool-context.ts — MCP tool infrastructure.
 *
 * Contains ToolContext and ToolDef interfaces, auth helpers for tool handlers,
 * and context decoration with session metadata. Separated from tools.ts
 * so tool implementations can import a focused set of infrastructure.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { rows2objects } from "../utils.ts";
import {
  resolveAuthFromToken,
  type AuthResult,
} from "../auth.ts";
import * as db from "./db.ts";
import { type ParsedScope } from "./scope.ts";

// ─── Tool context (injected by MCP handler) ─────────────────────

export interface ToolContext {
  userId: string | null;
  clientId: string | null;
  sessionHash: string | null;
  scope: ParsedScope | null;

  /** Resolve auth for a room, accounting for embodiment state.
   *  Returns embodied agent's AuthResult (if embodied), or view-level
   *  AuthResult (if observing), or null (no access). */
  resolveForRoom: (
    roomId: string,
  ) => Promise<{ auth: AuthResult; agentId: string | null } | null>;

  /** Legacy: explicit token override (backward compat for non-OAuth callers) */
  resolveToken: (
    room?: string, token?: string,
  ) => Promise<{ room: string; token: string } | null>;

  /** Admin-level auth for privilege escalation */
  resolveAdminAuth: (
    roomId: string,
  ) => Promise<AuthResult | null>;
}

// ─── Tool definition ─────────────────────────────────────────────

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

// ─── Auth helpers ────────────────────────────────────────────────

/** Convert a vault token string into an AuthResult for direct function calls. */
export async function tokenToAuth(token: string, roomId: string): Promise<AuthResult> {
  const result = await resolveAuthFromToken(token, roomId);
  if (result instanceof Response) {
    const data = await result.json();
    throw new Error(data.error ?? data.message ?? "Invalid token");
  }
  return result;
}

/** Resolve vault → room + AuthResult for a tool call (legacy path). */
export async function resolveForTool(
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

/** Unwrap a Response into data. Throws on error status with full structured detail. */
export async function unwrap(response: Response): Promise<unknown> {
  const data = await response.json();
  if (response.status >= 400) {
    // Preserve full error body for MCP consumers — agents need hint, help, stage, source
    if (typeof data === "object" && data !== null) {
      const parts: string[] = [];
      if (data.error) parts.push(String(data.error));
      if (data.detail) parts.push(String(data.detail));
      if (data.hint) parts.push(`Hint: ${data.hint}`);
      if (data.help) parts.push(`Help: invoke help({ key: "${data.help}" })`);
      if (data.source) parts.push(`Source: ${data.source}`);
      if (data.stage) parts.push(`Stage: ${data.stage}`);
      if (data.field) parts.push(`Field: ${data.field}`);
      // Elevation URL for scope_denied
      if (data.elevate) parts.push(`Elevate: ${data.elevate}`);
      throw new Error(parts.join("\n"));
    }
    throw new Error(String(data));
  }
  return data;
}

/** Escalation wrapper for functions returning Response. */
export async function withResponseEscalation(
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
    // Preserve structured error for MCP consumers
    const parts: string[] = [];
    if (typeof error === "string") parts.push(error);
    if (data.detail) parts.push(String(data.detail));
    if (data.hint) parts.push(`Hint: ${data.hint}`);
    if (data.help) parts.push(`Help: invoke help({ key: "${data.help}" })`);
    if (data.stage) parts.push(`Stage: ${data.stage}`);
    throw new Error(parts.length > 0 ? parts.join("\n") : JSON.stringify(data));
  }

  const adminAuth = await ctx.resolveAdminAuth(room);
  if (!adminAuth) throw new Error(typeof error === "string" ? error : JSON.stringify(data));

  return unwrap(await fn(adminAuth));
}

// ─── Context decoration ─────────────────────────────────────────

/** Decorate a context response with MCP session metadata.
 *  Adds _session block + _current/_switchable annotations on agents.
 *  This is MCP-layer only — buildExpandedContext stays session-unaware. */
export async function decorateContextWithSession(
  context: Record<string, any>,
  ctx: ToolContext,
  roomId: string,
  currentAgentId: string | null,
): Promise<Record<string, any>> {
  if (!ctx.sessionHash || !ctx.userId) return context;

  const userRoom = await db.getUserRoom(ctx.userId, roomId);
  const canEmbody = userRoom && userRoom.access !== "observer";

  const switchable: string[] = [];

  // Annotate agents in the agents section
  if (canEmbody && context.agents) {
    const agentsObj = context.agents;
    if (typeof agentsObj === "object" && !Array.isArray(agentsObj)) {
      for (const [agentId, agentData] of Object.entries(agentsObj as Record<string, any>)) {
        const isCurrent = agentId === currentAgentId;
        const isIdle = agentData.status === "idle"
                    || agentData.status === "done"
                    || agentData.status === "suspended";
        agentData._current = isCurrent;
        agentData._switchable = !isCurrent && isIdle;
        if (agentData._switchable) switchable.push(agentId);
      }
    }
  }

  // Check for unfilled roles
  try {
    const rolesResult = await sqlite.execute({
      sql: `SELECT key, value FROM state
            WHERE room_id = ? AND scope = '_shared' AND key LIKE 'roles.%'`,
      args: [roomId],
    });
    for (const r of rolesResult.rows) {
      const roleId = (r[0] as string).replace("roles.", "");
      try {
        const def = JSON.parse(r[1] as string);
        if (!def.filled_by && !switchable.includes(roleId)
            && roleId !== currentAgentId) {
          switchable.push(roleId);
        }
      } catch {}
    }
  } catch {}

  const scopeLevel = ctx.scope?.rooms.get(roomId);

  context._session = {
    agent: currentAgentId,
    room: roomId,
    switchable,
    scope_level: scopeLevel
      ? (scopeLevel.level === "role"
          ? `role:${scopeLevel.role}` : scopeLevel.level)
      : "full",
  };

  return context;
}
