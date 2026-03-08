/**
 * wait.ts — Long-poll condition waiting.
 *
 * Blocks until a CEL expression becomes true against room state,
 * then returns the current context. Used by /rooms/:id/wait endpoint.
 */

import { sqlite } from "https://esm.town/v/std/sqlite";
import { json, sleep } from "./utils.ts";
import { buildContext, evalCel, validateCel } from "./cel.ts";
import { buildExpandedContext, parseContextRequest, type ContextRequest } from "./context.ts";
import type { AuthResult } from "./auth.ts";

const MAX_WAIT_MS = 25_000;
const POLL_INTERVAL_MS = 1_000;

async function buildIncludeData(roomId: string, includeParam: string | null, ctx: Record<string, any>) {
  const data: Record<string, any> = {};
  if (!includeParam) return data;
  const includes = includeParam.split(",");
  for (const inc of includes) {
    const trimmed = inc.trim();
    if (trimmed === "state" || trimmed.startsWith("state.")) {
      const scope = trimmed === "state" ? null : trimmed.slice(6);
      data.state = scope ? (ctx.state?.[scope] ?? {}) : ctx.state;
    }
    if (trimmed === "agents") data.agents = ctx.agents;
    if (trimmed === "messages") data.messages = ctx.messages;
    if (trimmed === "actions") data.actions = ctx.actions;
    if (trimmed === "views") data.views = ctx.views;
  }
  return data;
}

export async function waitForCondition(roomId: string, url: URL, auth: AuthResult) {
  const condition = url.searchParams.get("condition");
  const agent = url.searchParams.get("agent") ?? auth.agentId;
  const timeoutParam = url.searchParams.get("timeout");
  const includeParam = url.searchParams.get("include");
  if (!condition) return json({ error: "condition parameter is required (CEL expression)" }, 400);
  const validation = validateCel(condition);
  if (!validation.valid) return json({ error: "invalid_cel", expression: condition, detail: validation.error }, 400);
  const timeout = Math.min(timeoutParam ? parseInt(timeoutParam) : MAX_WAIT_MS, MAX_WAIT_MS);

  // include=context (or no include param) returns full context object
  const wantFullContext = !includeParam || includeParam === "context";

  // Parse ContextRequest from URL (wait inherits all context shaping params)
  const ctxReq = parseContextRequest(url);

  if (agent) {
    await sqlite.execute({
      sql: `UPDATE agents SET status = 'waiting', waiting_on = ?, last_heartbeat = datetime('now') WHERE id = ? AND room_id = ?`,
      args: [condition, agent, roomId],
    });
  }

  const startTime = Date.now();
  try {
    while (Date.now() - startTime < timeout) {
      const ctx = await buildContext(roomId, { selfAgent: agent ?? undefined });
      const result = await evalCel(roomId, condition, ctx);
      if (result.ok && result.value) {
        if (agent) {
          await sqlite.execute({
            sql: `UPDATE agents SET status = 'active', waiting_on = NULL, last_heartbeat = datetime('now') WHERE id = ? AND room_id = ?`,
            args: [agent, roomId],
          });
        }
        if (wantFullContext) {
          const expanded = await buildExpandedContext(roomId, auth, ctxReq);
          return json({ triggered: true, condition, context: expanded });
        }
        const includeData = await buildIncludeData(roomId, includeParam, ctx);
        return json({ triggered: true, condition, value: result.value, ...includeData });
      }
      await sleep(POLL_INTERVAL_MS);
    }
    if (agent) {
      await sqlite.execute({
        sql: `UPDATE agents SET status = 'active', waiting_on = NULL, last_heartbeat = datetime('now') WHERE id = ? AND room_id = ?`,
        args: [agent, roomId],
      });
    }
    if (wantFullContext) {
      const expanded = await buildExpandedContext(roomId, auth, ctxReq);
      return json({ triggered: false, timeout: true, elapsed_ms: Date.now() - startTime, context: expanded });
    }
    const ctx = await buildContext(roomId, { selfAgent: agent ?? undefined });
    const includeData = await buildIncludeData(roomId, includeParam, ctx);
    return json({ triggered: false, timeout: true, elapsed_ms: Date.now() - startTime, ...includeData });
  } catch (e) {
    if (agent) {
      try { await sqlite.execute({ sql: `UPDATE agents SET status = 'active', waiting_on = NULL WHERE id = ? AND room_id = ?`, args: [agent, roomId] }); } catch {}
    }
    throw e;
  }
}
