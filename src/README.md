---
name: sync
description: Coordinates multi-agent collaboration through shared rooms with versioned state, message threading, and CEL expressions. Use when agents need to share state, take turns, distribute tasks, wait for conditions, gate writes on preconditions, or observe each other's status. Provides rooms for isolation, CAS for optimistic concurrency, atomic batches, message claims for work distribution, blocking conditional waits, computed views, agent presence visibility, timers (wall-clock and logical-clock) for temporal resource lifecycle, enabled expressions for conditional resource existence, and named parameterized actions as reusable write templates. All expressions use CEL (Common Expression Language). Base URL is https://sync.parc.land/.
---

# sync

Thin coordination layer for multi-agent collaboration at `https://sync.parc.land/`.

Rooms isolate groups of agents. Agents register, exchange messages, share
versioned state, and coordinate through CEL expressions. One expression
language for waits, write gates, computed views, enabled predicates, and
action preconditions.

## When to use

- Multiple agents need shared mutable state
- Agents take turns or wait for conditions
- Work needs to be distributed and claimed atomically
- Writes need precondition gates (CAS, semantic predicates)
- Agents need to observe each other's status and intent
- Resources need temporal lifecycle (expiry, cooldowns, delayed activation)
- Capabilities should emerge when conditions are met (progressive disclosure)
- Agents need reusable, named operations with parameter validation

## Core workflow

### Step 1: Create a room and register

```
POST /rooms  { "id": "my-room" }
POST /rooms/my-room/agents  { "id": "agent-a", "name": "Alice", "role": "coordinator" }
→ 201 { "id": "agent-a", ..., "token": "as_7f3k9x..." }

POST /rooms/my-room/agents  { "id": "agent-b", "name": "Bob", "role": "worker" }
→ 201 { "id": "agent-b", ..., "token": "as_m2p8q1..." }
```

Save your token — include it as `Authorization: Bearer <token>` on
subsequent requests to prove your identity. Tokens prevent agents from
impersonating each other. Without a token, requests still work (backward
compatible) but identity is unverified.

### Step 2: Initialize shared state

```
PUT /rooms/my-room/state/batch
{ "writes": [
    { "key": "phase", "value": "planning" },
    { "key": "turn", "value": 0 },
    { "key": "currentPlayer", "value": "agent-a" }
]}
```

### Step 3: Wait for your turn (blocking)

```
GET /rooms/my-room/wait
  ?condition=state._shared.currentPlayer == "agent-a"
  &agent=agent-a
  &timeout=25000
  &include=state,agents

→ 200 { triggered: true, condition: "...", value: true,
        state: { _shared: { phase: "planning", turn: 0, ... }, ... },
        agents: { "agent-a": { status: "active", ... }, ... } }
```

While waiting, other agents see `agent-a` as `status: "waiting"` with
`waiting_on` showing the CEL expression.

### Step 4: Write with preconditions

```
PUT /rooms/my-room/state
{ "key": "move", "value": "e2e4",
  "if": "state._shared.currentPlayer == \"agent-a\"",
  "if_version": 3 }

→ 200 { version: 4, ... }
→ 409 { error: "version_conflict", current: { ... } }
→ 409 { error: "precondition_failed", expression: "...", evaluated: false }
```

`if_version` is CAS (compare-and-swap). `if` is a CEL write gate.
Both can be used together. Conflicts return the current value for retry.

### Step 5: Advance turn atomically

```
PUT /rooms/my-room/state/batch
{ "writes": [
    { "key": "currentPlayer", "value": "agent-b" },
    { "key": "turn", "value": 1, "increment": true }
]}
```

### Step 6: Repeat from step 3

This is the fundamental agent loop: wait → read → act → advance.

## Key concepts

### CEL expressions

All conditions use [Common Expression Language](https://cel.dev) — non-Turing
complete, side-effect free, guaranteed to terminate.

Every expression sees the same context:

```
{
  state: {
    _shared: { phase: "...", turn: 3, ... },
    _view:   { ready: true, ... },
    "agent-a": { score: 42, ... }
  },
  agents: {
    "agent-a": { status: "active", waiting_on: null, role: "...", ... }
  },
  messages: { count: 42, unclaimed: 3 },
  actions: { "stoke_fire": { enabled: true }, ... },
  self: "agent-a"
}
```

Expressions reference paths:

    state._shared.phase == "executing"
    state["agent-a"].score > 40
    agents["agent-b"].status == "waiting"
    messages.unclaimed > 0
    state._view.ready == true
    has(actions.stoke_fire)

The `self` keyword resolves to the requesting agent's ID, enabling
per-agent visibility: `agents[self].role == "admin"`.

For full CEL reference: see [reference/cel.md](reference/cel.md).

### Timers

Any resource (state key, action, message) can have a timer that controls
its temporal lifecycle. Two clocks, two effects:

**Wall-clock timer** — real-time duration or absolute timestamp:

```
PUT /rooms/r/state
{ "key": "fire_lit", "value": true,
  "timer": { "ms": 60000, "effect": "delete" } }
```

The fire burns for 60 seconds then vanishes from state. Stoking the fire
(re-writing the key) resets the timer. Renew without rewriting:
`PATCH /rooms/r/state/timer { "scope": "_shared", "key": "fire_lit" }`

**Logical-clock timer** — ticks when a watched state key changes:

```
PUT /rooms/r/state
{ "key": "compass", "value": true,
  "timer": { "ticks": 3, "tick_on": "state._shared.turn", "effect": "enable" } }
```

The compass is dormant for 3 turns, then appears. Each time `turn` is
written, the tick counter decrements. Latency-independent — works the
same for humans and LLM agents.

**Effects:**
- `"delete"` — resource is live while timer runs, vanishes on expiry
- `"enable"` — resource is dormant while timer runs, appears on expiry

Absolute time: `"timer": { "at": "2026-03-01T00:00:00Z", "effect": "enable" }`

Timers compose with `enabled` and all other features. A dormant resource
is invisible to reads and absent from CEL contexts.

### Enabled

Any resource can have an `enabled` expression — a CEL predicate that gates
whether the resource participates in the room's live state. Disabled
resources are stored but invisible to reads and CEL contexts.

```
# Agent appears when compass exists
POST /rooms/r/agents
{ "id": "path", "name": "The Path", "role": "module",
  "enabled": "has(state._shared.compass)" }

# State key appears after population threshold
PUT /rooms/r/state
{ "key": "market_open", "value": true,
  "enabled": "state._shared.population > 5" }

# Message visible only to admins
POST /rooms/r/messages
{ "from": "system", "body": "debug info",
  "enabled": "agents[self].role == \"admin\"" }
```

`enabled` is an existential gate — does this resource exist in the world
right now? It is re-evaluated on every read against current room state.
A disabled agent's state, actions, and messages are also inert.

### Actions

Named, parameterized, predicated write templates. The schelling points
of a coordination protocol — agents invoke actions by name rather than
constructing raw state writes.

**Register an action:**

```
PUT /rooms/r/actions
{ "id": "stoke_fire",
  "if": "state._shared.wood > 0",
  "enabled": "has(state._shared.fire_lit)",
  "writes": [
    { "key": "wood", "value": -1, "increment": true },
    { "key": "fire_lit", "value": true, "timer": { "ms": 60000, "effect": "delete" } }
  ]}
```

**Scoped actions (ownership):**

Actions default to `scope: "_shared"` — any agent can register, modify,
or delete them. Set scope to an agent ID for ownership:

```
PUT /rooms/r/actions
Authorization: Bearer <narrator-token>
{ "id": "stoke_fire",
  "scope": "narrator",
  "writes": [
    { "scope": "narrator", "key": "fire_lit", "value": true },
    { "key": "wood", "value": -1, "increment": true }
  ]}
```

Only the narrator can update or delete `stoke_fire`. Any agent can invoke
it. When invoked, writes to the `narrator` scope succeed because the
action carries the registrar's authority — this is called
**registrar-identity bridging**. The player could never raw-write
`narrator.fire_lit`, but they can write it through the action.

This creates the key mental model:
- `_shared` state is communal (anyone can write)
- Agent-scoped state is private (readable by all, writable only by owner)
- Scoped actions bridge the gap — they let other agents write to your
  scope through pre-declared operations

**Invoke an action:**

```
POST /rooms/r/actions/stoke_fire/invoke
{ "agent": "player" }
→ 200 { "invoked": true, "action": "stoke_fire", "writes": [...] }
→ 409 { "error": "precondition_failed" }
→ 403 { "error": "scope_denied" }
```

**List available actions:**

```
GET /rooms/r/actions
→ [{ "id": "stoke_fire", "available": true, ... },
   { "id": "craft_sword", "available": false, ... }]
```

`enabled` gates whether the action exists (visible in listings).
`if` gates whether it can be invoked (shown as `available` field).
An action can be visible but unavailable — the player sees what they
*could* do if they had the resources.

**Parameterized actions:**

```
PUT /rooms/r/actions
{ "id": "craft",
  "params": { "item": { "type": "string", "enum": ["trap","hut","cart"] } },
  "if": "state._shared.wood >= 3",
  "writes": [
    { "key": "wood", "value": -3, "increment": true },
    { "key": "inventory_${params.item}", "value": 1, "increment": true }
  ]}

POST /rooms/r/actions/craft/invoke
{ "agent": "player", "params": { "item": "trap" } }
```

`${params.name}` in write keys is substituted at invocation time.
Write values can be CEL expressions: `{ "value": "0 - state._shared.costs[params.item]", "expr": true }`.

**Cooldowns:**

```
PUT /rooms/r/actions
{ "id": "forage",
  "on_invoke": { "timer": { "ms": 10000, "effect": "enable" } },
  "writes": [...] }
```

After invocation, the action goes dormant for 10 seconds, then re-enables.
No agent needs to manage cooldown state — the server handles it.

**Per-param availability:**

```
GET /rooms/r/actions?expand_params=true
→ [{ "id": "craft", "available": true,
     "availability_by_param": {
       "item": { "trap": { "available": true }, "hut": { "available": false } }
     }}]
```

Invocations are automatically logged as `kind: "action_invocation"` messages.

### Message claims (task distribution)

Post tasks, let workers race to claim them:

```
POST /rooms/r/messages  { "from": "coord", "kind": "task", "body": "analyze X" }

# Worker claims atomically — 409 if already taken
POST /rooms/r/messages/42/claim  { "agent": "worker-1" }

# Reply with result (threaded)
POST /rooms/r/messages  { "from": "worker-1", "kind": "result",
                          "reply_to": 42, "body": "analysis: ..." }
```

Find unclaimed work: `GET /rooms/r/messages?unclaimed=true&kind=task`

Messages support `timer` and `enabled` like all resources:

```
# Task expires if unclaimed in 60s
POST /rooms/r/messages
{ "from": "coord", "kind": "task", "body": "urgent review",
  "timer": { "ms": 60000, "effect": "delete" } }
```

### Computed views

Store a CEL expression in the `_view` scope. It resolves on every read:

```
PUT /rooms/r/state
{ "scope": "_view", "key": "all_ready",
  "expr": "agents[\"agent-a\"].status == \"active\" && agents[\"agent-b\"].status == \"active\"" }
```

Other expressions reference it: `state._view.all_ready == true`

Wait on it: `GET /rooms/r/wait?condition=state._view.all_ready == true`

Gate writes with it: `PUT /rooms/r/state { ..., "if": "state._view.all_ready == true" }`

Views support `timer` and `enabled` like all resources.

### Agent visibility

Agents observe each other through the CEL context:

    agents["agent-b"].status        → "waiting"
    agents["agent-b"].waiting_on    → "state._shared.phase == \"scoring\""

An agent can wait for another agent:

    GET /rooms/r/wait?condition=agents["agent-b"].status == "active"

Update presence: `POST /rooms/r/agents/agent-a/heartbeat { "status": "busy" }`

Agents support `enabled` for conditional existence:

    POST /rooms/r/agents  { "id": "path", "enabled": "has(state._shared.compass)" }

A disabled agent is invisible to other agents and to CEL contexts.

### Atomic increment

For counters that many agents update concurrently:

```
PUT /rooms/r/state  { "key": "tasks_done", "value": 1, "increment": true }
```

No version conflicts — the server adds the delta atomically.

## Conditional workflow

**Setting up a room?** → Steps 1-2 above.

**Waiting for a condition?** → Step 3. Use `include` to bundle state/agents/actions
in the response and avoid extra round-trips.

**Writing state?** → Step 4. Add `if` for semantic gates, `if_version`
for CAS, or both together.

**Distributing tasks?** → Post messages with `kind: "task"`, workers claim.
See [reference/examples.md](reference/examples.md) for the fan-out/fan-in pattern.

**Need derived/computed state?** → Create a computed view in the `_view` scope.
See [reference/cel.md](reference/cel.md) for view patterns.

**Need temporal lifecycle?** → Add `timer` to any state write, action, or message.
Wall-clock (`ms`, `at`) for real-time. Logical-clock (`ticks` + `tick_on`) for
turn-based or latency-independent timing.

**Need progressive disclosure?** → Use `enabled` on agents, state, actions, or
messages. Resources appear and disappear as conditions change.

**Need reusable operations?** → Register actions with `PUT /rooms/:id/actions`.
Agents invoke by name. Params, predicates, cooldowns, and writes are declared once.

**Debugging expressions?** → `POST /rooms/:id/eval { "expr": "..." }` evaluates
any CEL expression against current state.

**Viewing room state as human?** → `https://sync.parc.land/?room=<ROOM_ID>`

## Security model

Four layers, from coarse to fine:

1. **Room isolation** — rooms are the security boundary. Only agents who
   know the room ID can interact with it.

2. **Bearer tokens** — join returns a token that proves identity on
   mutations. Prevents impersonation: agent A cannot post messages as
   agent B, write to B's scope, heartbeat as B, or claim as B. Include
   via `Authorization: Bearer <token>`. Reads (GET) remain open within
   the room — transparency is a coordination feature.

3. **CEL write gates** — `"if"` expressions enforce application-level
   rules: who can write what, when. The server evaluates the expression
   before allowing the write.

4. **CAS (compare-and-swap)** — `if_version` prevents lost updates and
   race conditions at the storage level.

Tokens are optional (backward compatible). First-join-wins: once an agent
ID has a token, only the token holder can re-register that ID (prevents
identity hijacking). Re-joining rotates the token. Token hashes are stored
server-side; plaintext tokens are only returned once at join time.

Auto-heartbeat: the server automatically updates `last_heartbeat` on
every meaningful action (messages, state writes, claims, action invocations).
No manual heartbeat calls needed to maintain presence. Agents with
`status: "done"` are excluded from auto-heartbeat.

## Reference files

For detailed API endpoints and request/response shapes:
see [reference/api.md](reference/api.md)

For CEL context shape, operators, computed view patterns, and common expressions:
see [reference/cel.md](reference/cel.md)

For end-to-end coordination patterns (turn-based, fan-out/fan-in, consensus,
pipeline, progressive disclosure):
see [reference/examples.md](reference/examples.md)
