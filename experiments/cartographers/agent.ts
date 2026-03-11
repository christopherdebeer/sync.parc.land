#!/usr/bin/env -S deno run -A
/**
 * Blind Cartographers — Agent Runner
 *
 * Spawns a single agent as a Claude Sonnet instance that interacts with
 * the sync room autonomously. Each agent reads context, reasons about
 * what to do, and invokes actions through the sync API.
 *
 * Usage:
 *   deno run -A experiments/cartographers/agent.ts neuroscientist
 *   deno run -A experiments/cartographers/agent.ts game-designer
 *   deno run -A experiments/cartographers/agent.ts contemplative
 *   deno run -A experiments/cartographers/agent.ts urban-planner
 *   deno run -A experiments/cartographers/agent.ts economist
 *
 * Environment:
 *   ANTHROPIC_API_KEY  — required
 *   SYNC_BASE_URL      — defaults to https://sync.parc.land
 *   MAX_TURNS          — max agent loop iterations (default: 30)
 *   MODEL              — model to use (default: claude-sonnet-4-20250514)
 */

import { buildSystemPrompt, BRIEFS } from "./briefs.ts";

const BASE = Deno.env.get("SYNC_BASE_URL") || "https://sync.parc.land";
const ROOM = "cartographers";
const MAX_TURNS = parseInt(Deno.env.get("MAX_TURNS") || "30");
const MODEL = Deno.env.get("MODEL") || "claude-sonnet-4-20250514";
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY");

if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY environment variable is required");
  Deno.exit(1);
}

const agentId = Deno.args[0];
if (!agentId || !BRIEFS.find((b) => b.id === agentId)) {
  console.error(`Usage: agent.ts <agent-id>`);
  console.error(`Available agents: ${BRIEFS.map((b) => b.id).join(", ")}`);
  Deno.exit(1);
}

// Load tokens
const tokensPath = new URL("./tokens.json", import.meta.url).pathname;
let tokens: Record<string, string>;
try {
  tokens = JSON.parse(await Deno.readTextFile(tokensPath));
} catch {
  console.error("tokens.json not found. Run setup.ts first.");
  Deno.exit(1);
}

const agentToken = tokens[agentId];
if (!agentToken) {
  console.error(`No token found for agent "${agentId}". Run setup.ts first.`);
  Deno.exit(1);
}

const brief = BRIEFS.find((b) => b.id === agentId)!;
console.log(`\n🧭 ${brief.name} (${agentId}) entering room "${ROOM}"\n`);

// ── Sync API helpers ──

async function syncGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${agentToken}` },
  });
  return res.json();
}

async function syncPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${agentToken}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Tool definitions for Claude ──

const tools = [
  {
    name: "read_context",
    description:
      "Read the current room context — state, views, agents, actions, messages. This is your primary way to see what's happening. Call with depth='full' to see action write templates and params.",
    input_schema: {
      type: "object" as const,
      properties: {
        depth: {
          type: "string",
          enum: ["lean", "full"],
          description: "lean = descriptions only, full = includes writes/params/if",
        },
      },
      required: [],
    },
  },
  {
    name: "invoke_action",
    description:
      "Invoke an action in the room. Use this for ALL writes: registering actions, registering views, sending messages, and invoking custom actions. The action_id is the name of the action (e.g. '_register_action', '_send_message', 'help', or any custom action).",
    input_schema: {
      type: "object" as const,
      properties: {
        action_id: {
          type: "string",
          description: "The action to invoke",
        },
        params: {
          type: "object",
          description: "Parameters for the action",
        },
      },
      required: ["action_id", "params"],
    },
  },
  {
    name: "wait_for_condition",
    description:
      "Block until a CEL condition becomes true, then return the full context. Use this to wait for other agents to act, for messages, etc. Good conditions: 'messages.directed_unread > 0', 'messages.unread > 0', state-based checks.",
    input_schema: {
      type: "object" as const,
      properties: {
        condition: {
          type: "string",
          description: "CEL expression that must evaluate to true",
        },
        timeout: {
          type: "number",
          description: "Max wait in ms (default 25000, max 25000)",
        },
      },
      required: ["condition"],
    },
  },
  {
    name: "done",
    description:
      "Signal that you believe the collaboration has reached a natural stopping point. Call this when you've registered a summary view and feel the room's artifact is complete enough.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description: "Why you think the session is complete",
        },
      },
      required: ["reason"],
    },
  },
];

// ── Tool execution ──

async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "read_context": {
      const depth = (input.depth as string) || "full";
      const ctx = await syncGet(
        `/rooms/${ROOM}/context?depth=${depth}`,
      );
      return JSON.stringify(ctx, null, 2);
    }
    case "invoke_action": {
      const actionId = input.action_id as string;
      const params = input.params || {};
      const result = await syncPost(
        `/rooms/${ROOM}/actions/${actionId}/invoke`,
        { params },
      );
      return JSON.stringify(result, null, 2);
    }
    case "wait_for_condition": {
      const condition = input.condition as string;
      const timeout = (input.timeout as number) || 25000;
      const result = await syncGet(
        `/rooms/${ROOM}/wait?condition=${encodeURIComponent(condition)}&timeout=${timeout}`,
      );
      return JSON.stringify(result, null, 2);
    }
    case "done": {
      return JSON.stringify({ status: "session_complete", reason: input.reason });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ── Anthropic API ──

interface Message {
  role: "user" | "assistant";
  content: unknown;
}

async function callClaude(messages: Message[], systemPrompt: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  return res.json();
}

// ── Agent loop ──

async function runAgent() {
  const systemPrompt = buildSystemPrompt(agentId, ROOM);
  const messages: Message[] = [];

  // Kick off with a user message that orients the agent
  messages.push({
    role: "user",
    content:
      `You have just entered the room "${ROOM}". Start by reading context to see what's there. Then act according to your judgment — register vocabulary, contribute knowledge, respond to others, build the shared artifact. Remember: the room IS the artifact.`,
  });

  let done = false;

  for (let turn = 0; turn < MAX_TURNS && !done; turn++) {
    console.log(`\n── Turn ${turn + 1}/${MAX_TURNS} ──`);

    const response = await callClaude(messages, systemPrompt);

    // Process response content
    const assistantContent = response.content;
    messages.push({ role: "assistant", content: assistantContent });

    // Check stop reason
    if (response.stop_reason === "end_turn") {
      // Model finished without tool use — extract text and print
      for (const block of assistantContent) {
        if (block.type === "text") {
          console.log(`  💭 ${brief.name}: ${block.text.slice(0, 200)}...`);
        }
      }
      // Give it a nudge to keep going
      messages.push({
        role: "user",
        content:
          "Continue participating. Read context to see if anything has changed, then act. If you believe the collaboration is complete, use the 'done' tool.",
      });
      continue;
    }

    if (response.stop_reason !== "tool_use") {
      console.log(`  ⚠️  Unexpected stop reason: ${response.stop_reason}`);
      break;
    }

    // Execute tool calls
    const toolResults: unknown[] = [];
    for (const block of assistantContent) {
      if (block.type === "text") {
        console.log(`  💭 ${brief.name}: ${block.text.slice(0, 200)}`);
      }
      if (block.type === "tool_use") {
        console.log(`  🔧 ${block.name}(${JSON.stringify(block.input).slice(0, 120)})`);

        if (block.name === "done") {
          console.log(`\n✅ ${brief.name} is done: ${(block.input as any).reason}`);
          done = true;
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: await executeTool(block.name, block.input as Record<string, unknown>),
          });
          break;
        }

        const result = await executeTool(
          block.name,
          block.input as Record<string, unknown>,
        );
        console.log(`  📨 Result: ${result.slice(0, 200)}...`);

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }
    }

    if (!done) {
      messages.push({ role: "user", content: toolResults });
    }
  }

  if (!done) {
    console.log(`\n⏰ ${brief.name} reached max turns (${MAX_TURNS})`);
  }

  console.log(`\n🏁 ${brief.name} session complete.\n`);
}

runAgent().catch((e) => {
  console.error(`\n❌ ${brief.name} crashed:`, e.message);
  Deno.exit(1);
});
