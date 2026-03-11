#!/usr/bin/env -S deno run -A
/**
 * Blind Cartographers — Room Setup
 *
 * Creates the "cartographers" room, registers all agents, and writes
 * a tokens.json file that the agent runner scripts consume.
 *
 * Usage:
 *   deno run -A experiments/cartographers/setup.ts
 *
 * Environment:
 *   SYNC_BASE_URL  — defaults to https://sync.parc.land
 */

const BASE = Deno.env.get("SYNC_BASE_URL") || "https://sync.parc.land";
const ROOM = "cartographers";

interface AgentDef {
  id: string;
  name: string;
  role: string;
}

const agents: AgentDef[] = [
  { id: "neuroscientist", name: "Dr. Lena Okafor", role: "neuroscientist" },
  { id: "game-designer", name: "Mx. Sable Vance", role: "game-designer" },
  { id: "contemplative", name: "Brother Tenzin", role: "contemplative" },
  { id: "urban-planner", name: "Ade Okonkwo", role: "urban-planner" },
  { id: "economist", name: "Prof. Yuki Tanaka", role: "economist" },
];

async function api(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }

  if (!res.ok) {
    console.error(`${method} ${path} → ${res.status}`, json);
    // If room already exists, that's OK for idempotent reruns
    if (res.status === 409) return json;
    throw new Error(`API error: ${res.status}`);
  }

  return json;
}

async function main() {
  console.log(`\n🗺️  Blind Cartographers — Setting up room "${ROOM}" at ${BASE}\n`);

  // 1. Create room
  console.log("Creating room...");
  let roomData: any;
  try {
    roomData = await api("POST", "/rooms", { id: ROOM });
  } catch {
    // Room might already exist — try to continue if we have tokens saved
    console.log("Room may already exist. If you have tokens.json, agents can still join.");
    throw new Error("Could not create room. Delete the existing room or use saved tokens.");
  }

  const roomToken = roomData.token;
  const viewToken = roomData.view_token;
  console.log(`  Room token:  ${roomToken}`);
  console.log(`  View token:  ${viewToken}`);
  console.log(`  Dashboard:   ${BASE}/?room=${ROOM}#token=${viewToken}`);

  // 2. Register agents
  const tokens: Record<string, string> = {
    room: roomToken,
    view: viewToken,
  };

  for (const agent of agents) {
    console.log(`\nRegistering agent: ${agent.name} (${agent.id})...`);
    const data: any = await api(
      "POST",
      `/rooms/${ROOM}/agents`,
      { id: agent.id, name: agent.name, role: agent.role },
      roomToken,
    );
    tokens[agent.id] = data.token;
    console.log(`  Token: ${data.token}`);
  }

  // 3. Grant all agents write access to _shared so they can register
  //    actions that write to shared state
  for (const agent of agents) {
    console.log(`Granting _shared access to ${agent.id}...`);
    await api(
      "PATCH",
      `/rooms/${ROOM}/agents/${agent.id}`,
      { grants: ["_shared"] },
      roomToken,
    );
  }

  // 4. Save tokens
  const tokensPath = new URL("./tokens.json", import.meta.url).pathname;
  await Deno.writeTextFile(tokensPath, JSON.stringify(tokens, null, 2));
  console.log(`\n✅ Tokens saved to ${tokensPath}`);

  // 5. Print spawn commands
  console.log("\n─── Spawn Commands ───\n");
  console.log("Run each in a separate terminal to launch an agent:\n");
  for (const agent of agents) {
    console.log(
      `  deno run -A experiments/cartographers/agent.ts ${agent.id}`,
    );
  }

  console.log(`\n─── Dashboard ───\n`);
  console.log(`  ${BASE}/?room=${ROOM}#token=${viewToken}\n`);
}

main().catch((e) => {
  console.error(e.message);
  Deno.exit(1);
});
