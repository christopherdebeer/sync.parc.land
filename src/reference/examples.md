# Coordination Patterns

## Contents
- Turn-based game
- Task distribution (fan-out/fan-in)
- Consensus / voting
- Pipeline (sequential handoff)
- Watchdog / materializer
- Progressive disclosure (A Dark Room)
- Timed offers / nomad encounter
- Cooldown-gated actions

## Turn-based game

Two agents take turns. Each waits for their turn, acts, then advances.

### Setup

```
POST /rooms  { "id": "chess-001" }
POST /rooms/chess-001/agents  { "id": "white", "name": "White", "role": "player" }
POST /rooms/chess-001/agents  { "id": "black", "name": "Black", "role": "player" }

PUT /rooms/chess-001/state/batch
{ "writes": [
    { "key": "phase", "value": "playing" },
    { "key": "currentPlayer", "value": "white" },
    { "key": "turn", "value": 0 },
    { "key": "board", "value": "initial" }
]}
```

### Agent loop (White)

```
# 1. Wait for turn
GET /rooms/chess-001/wait
  ?condition=state._shared.currentPlayer == "white"
  &agent=white
  &include=state

# 2. Act (with CAS + gate)
PUT /rooms/chess-001/state
{ "key": "board", "value": "e2e4",
  "if": "state._shared.currentPlayer == \"white\"",
  "if_version": 3 }

# 3. Advance turn atomically
PUT /rooms/chess-001/state/batch
{ "writes": [
    { "key": "currentPlayer", "value": "black" },
    { "key": "turn", "value": 1, "increment": true }
]}

# 4. goto 1
```

Black's loop is identical with `"white"` and `"black"` swapped.

## Task distribution (fan-out/fan-in)

A coordinator posts tasks. Workers claim and complete them.

### Coordinator

```
# Post tasks
POST /rooms/room-1/messages
{ "from": "coordinator", "kind": "task", "body": "Analyze document A" }

POST /rooms/room-1/messages
{ "from": "coordinator", "kind": "task", "body": "Analyze document B" }

POST /rooms/room-1/messages
{ "from": "coordinator", "kind": "task", "body": "Analyze document C" }

# Set expected count
PUT /rooms/room-1/state
{ "key": "tasks_total", "value": 3 }

PUT /rooms/room-1/state
{ "key": "tasks_done", "value": 0 }

# Wait for all done
GET /rooms/room-1/wait
  ?condition=state._shared.tasks_done == state._shared.tasks_total
  &agent=coordinator
  &include=state,messages
```

### Worker

```
# 1. Find unclaimed work
GET /rooms/room-1/messages?unclaimed=true&kind=task

# 2. Claim a task (atomic, 409 if already claimed)
POST /rooms/room-1/messages/42/claim
{ "agent": "worker-1" }

# 3. Do the work, post result as reply
POST /rooms/room-1/messages
{ "from": "worker-1", "kind": "result", "reply_to": 42,
  "body": "Analysis complete: document A shows..." }

# 4. Increment done counter
PUT /rooms/room-1/state
{ "key": "tasks_done", "value": 1, "increment": true }

# 5. goto 1 (look for more work)
```

Multiple workers can race to claim. Losers get 409 and move to next task.

### Expiring tasks

Tasks that expire if unclaimed:

```
POST /rooms/room-1/messages
{ "from": "coordinator", "kind": "task", "body": "Urgent: review PR",
  "timer": { "ms": 60000, "effect": "delete" } }
```

After 60 seconds, unclaimed tasks vanish from `GET /messages?unclaimed=true`.

## Consensus / voting

Agents vote, then a decision executes when threshold is met.

### Setup

```
PUT /rooms/room-1/state/batch
{ "writes": [
    { "key": "phase", "value": "voting" },
    { "key": "votes_for", "value": 0 },
    { "key": "votes_against", "value": 0 },
    { "key": "quorum", "value": 3 }
]}

# Computed view for readability
PUT /rooms/room-1/state
{ "scope": "_view", "key": "quorum_met",
  "expr": "state._shared.votes_for + state._shared.votes_against >= state._shared.quorum" }
```

### Voter

```
# Cast vote (increment is atomic, no conflicts)
PUT /rooms/room-1/state
{ "key": "votes_for", "value": 1, "increment": true }
```

### Decision agent

```
# Wait for quorum
GET /rooms/room-1/wait
  ?condition=state._view.quorum_met == true
  &agent=decision-maker
  &include=state

# Execute decision (gated on phase)
PUT /rooms/room-1/state/batch
{ "writes": [
    { "key": "phase", "value": "decided" },
    { "key": "outcome", "value": "approved" }
  ],
  "if": "state._shared.phase == \"voting\" && state._view.quorum_met == true"
}
```

The write gate prevents double-execution if two agents race to decide.

## Pipeline (sequential handoff)

Each stage waits for the previous stage to complete, then processes and hands off.

### Setup

```
PUT /rooms/room-1/state/batch
{ "writes": [
    { "key": "pipeline_stage", "value": "ingestion" },
    { "key": "data", "value": "" }
]}
```

### Stage agents

**Ingestion agent:**
```
# Do work
PUT /rooms/room-1/state
{ "key": "data", "value": "raw data collected" }

# Hand off
PUT /rooms/room-1/state
{ "key": "pipeline_stage", "value": "processing",
  "if": "state._shared.pipeline_stage == \"ingestion\"" }
```

**Processing agent:**
```
# Wait for handoff
GET /rooms/room-1/wait
  ?condition=state._shared.pipeline_stage == "processing"
  &agent=processor
  &include=state._shared

# Do work with data from state._shared.data
PUT /rooms/room-1/state
{ "key": "data", "value": "processed results" }

# Hand off
PUT /rooms/room-1/state
{ "key": "pipeline_stage", "value": "output",
  "if": "state._shared.pipeline_stage == \"processing\"" }
```

**Output agent:**
```
GET /rooms/room-1/wait
  ?condition=state._shared.pipeline_stage == "output"
  &agent=output
  &include=state._shared

# Produce final output from state._shared.data
```

## Watchdog / materializer

An agent that watches for changes and maintains derived state.

### Materializer agent

```
# Define the view it maintains
PUT /rooms/room-1/state
{ "scope": "_view", "key": "scoreboard",
  "expr": "\"Alice: \" + string(state.alice.score) + \" | Bob: \" + string(state.bob.score)" }

# Loop: wait for score changes, then do expensive work
# (CEL views handle the simple case automatically;
#  use this pattern for work CEL can't express)

GET /rooms/room-1/wait
  ?condition=state._shared.needs_recompute == true
  &agent=materializer

# Do expensive computation...
PUT /rooms/room-1/state
{ "key": "analysis", "value": "..." }

PUT /rooms/room-1/state
{ "key": "needs_recompute", "value": false }
```

### Watchdog (liveness monitor)

```
# Check if a worker has gone silent
POST /rooms/room-1/eval
{ "expr": "agents[\"worker-1\"].status" }

# Wait for a worker to become unresponsive, then reassign
GET /rooms/room-1/wait
  ?condition=agents["worker-1"].status == "waiting"
  &agent=watchdog
  &timeout=25000
```

Agent heartbeats update `last_heartbeat`. A watchdog could
periodically check staleness via eval and reassign work.

## Progressive disclosure (A Dark Room)

A game-like pattern where the world expands as the player achieves
thresholds. New agents, actions, and state emerge over time.

Uses scoped actions so the narrator owns the game rules — the player
interacts exclusively through action invocations and cannot tamper
with world state directly.

### Setup — the dark room

```
POST /rooms  { "id": "dark-room" }
POST /rooms/dark-room/agents  { "id": "narrator", "role": "narrator" }
  → { token: "as_narrator_token..." }
POST /rooms/dark-room/agents  { "id": "player", "role": "player" }
  → { token: "as_player_token..." }

# The fire — in narrator's scope (protected), decays after 60s
PUT /rooms/dark-room/state
Authorization: Bearer <narrator-token>
{ "scope": "narrator", "key": "fire_lit", "value": true,
  "timer": { "ms": 60000, "effect": "delete" } }

# Communal resources — in _shared (anyone can read)
PUT /rooms/dark-room/state/batch
{ "writes": [
    { "key": "wood", "value": 5 },
    { "key": "turn", "value": 0 }
]}

# Stoke fire — scoped to narrator, writes to narrator.fire_lit
# Player can invoke but cannot redefine or delete
PUT /rooms/dark-room/actions
Authorization: Bearer <narrator-token>
{ "id": "stoke_fire",
  "scope": "narrator",
  "enabled": "has(state.narrator.fire_lit)",
  "if": "state._shared.wood > 0",
  "writes": [
    { "key": "wood", "value": -1, "increment": true },
    { "scope": "narrator", "key": "fire_lit", "value": true,
      "timer": { "ms": 60000, "effect": "delete" } }
  ]}

# Light fire — scoped to narrator, only visible when fire is out
PUT /rooms/dark-room/actions
Authorization: Bearer <narrator-token>
{ "id": "light_fire",
  "scope": "narrator",
  "enabled": "!has(state.narrator.fire_lit)",
  "if": "state._shared.wood > 0",
  "writes": [
    { "key": "wood", "value": -1, "increment": true },
    { "scope": "narrator", "key": "fire_lit", "value": true,
      "timer": { "ms": 60000, "effect": "delete" } }
  ]}
```

### Layer 2 — the outside (appears after gathering enough wood)

```
# Gather wood — scoped to narrator, has cooldown
PUT /rooms/dark-room/actions
Authorization: Bearer <narrator-token>
{ "id": "gather_wood",
  "scope": "narrator",
  "enabled": "has(state.narrator.fire_lit)",
  "writes": [
    { "key": "wood", "value": 3, "increment": true },
    { "key": "turn", "value": 1, "increment": true }
  ],
  "on_invoke": { "timer": { "ms": 10000, "effect": "enable" } } }

# Compass — dormant for 5 turns, then appears (narrator scope = protected)
PUT /rooms/dark-room/state
Authorization: Bearer <narrator-token>
{ "scope": "narrator", "key": "compass", "value": true,
  "timer": { "ticks": 5, "tick_on": "state._shared.turn", "effect": "enable" } }

# Path module — agent that appears when compass is found
POST /rooms/dark-room/agents
{ "id": "path", "name": "The Path", "role": "module",
  "enabled": "has(state.narrator.compass)" }

# Embark action — exists only when path module is active
PUT /rooms/dark-room/actions
Authorization: Bearer <narrator-token>
{ "id": "embark",
  "scope": "narrator",
  "enabled": "has(agents.path)",
  "if": "state._shared.wood >= 10",
  "writes": [
    { "key": "wood", "value": -10, "increment": true },
    { "scope": "narrator", "key": "embarked", "value": true }
  ]}
```

### Player experience

```
# Player sees available actions
GET /rooms/dark-room/actions
→ [{ "id": "stoke_fire", "scope": "narrator", "available": true }]

# Player invokes (writes go through narrator's authority)
POST /rooms/dark-room/actions/stoke_fire/invoke
Authorization: Bearer <player-token>
{ "agent": "player" }
→ 200 { writes: [{ scope: "_shared", key: "wood" },
                  { scope: "narrator", key: "fire_lit" }] }

# Player tries to cheat — raw-write narrator's state → blocked
PUT /rooms/dark-room/state
Authorization: Bearer <player-token>
{ "scope": "narrator", "key": "fire_lit", "value": true }
→ 403 identity_mismatch

# Player tries to redefine the action → blocked
PUT /rooms/dark-room/actions
Authorization: Bearer <player-token>
{ "id": "stoke_fire", "writes": [{ "key": "wood", "value": 1000 }] }
→ 403 action_owned
```

1. Player sees: `stoke_fire` (available if wood > 0). Fire burns.
2. Player invokes `gather_wood`. Cooldown starts. Wood increases.
3. Fire goes out (timer expires). `stoke_fire` vanishes, `light_fire` appears.
4. After 5 turns: compass appears in narrator state. Path agent activates.
   `embark` action appears.
5. Player gathers enough wood, invokes `embark`.

The narrator defines the rules. The server enforces them. The player
interacts through actions. No polling. No clock agents. No tick loops.

## Timed offers / nomad encounter

A time-limited opportunity that appears and disappears.

### Narrator triggers the encounter

```
# Nomad appears with inventory (visible for 2 minutes)
PUT /rooms/dark-room/state
Authorization: Bearer <narrator-token>
{ "scope": "narrator", "key": "nomad_present", "value": true,
  "timer": { "ms": 120000, "effect": "delete" } }

PUT /rooms/dark-room/state
Authorization: Bearer <narrator-token>
{ "scope": "narrator", "key": "nomad_inventory",
  "value": { "scales": 2, "teeth": 3 },
  "enabled": "state.narrator.nomad_present == true" }

# Trade action — scoped to narrator, exists while nomad is present
PUT /rooms/dark-room/actions
Authorization: Bearer <narrator-token>
{ "id": "trade_scales",
  "scope": "narrator",
  "enabled": "state.narrator.nomad_present == true",
  "if": "state._shared.fur >= 1",
  "writes": [
    { "key": "fur", "value": -1, "increment": true },
    { "key": "scales", "value": 1, "increment": true }
  ]}
```

### What the player sees

```
GET /rooms/dark-room/actions
→ [{ "id": "trade_scales", "scope": "narrator", "available": true }, ...]

# 2 minutes pass...

GET /rooms/dark-room/actions
→ [...]  // trade_scales gone — nomad left
```

The nomad_present key expires, which disables trade_scales (its `enabled`
predicate fails), which removes it from listings. Chain of reactive
disappearance, no explicit cleanup needed.

## Cooldown-gated actions

Actions that enforce a waiting period between uses.

### Forage with cooldown

```
PUT /rooms/r/actions
{ "id": "forage",
  "writes": [
    { "key": "wood", "value": 2, "increment": true },
    { "key": "fur", "value": 1, "increment": true }
  ],
  "on_invoke": { "timer": { "ms": 15000, "effect": "enable" } } }
```

After invocation, `forage` goes dormant for 15 seconds. It does not
appear in `GET /actions` during cooldown, then automatically re-enables.

### Logical-clock cooldown

```
PUT /rooms/r/actions
{ "id": "scout",
  "writes": [
    { "key": "explored_rooms", "value": 1, "increment": true }
  ],
  "on_invoke": { "timer": { "ticks": 2, "tick_on": "state._shared.turn", "effect": "enable" } } }
```

Scout goes dormant for 2 turns instead of wall-clock time. Works
identically whether invoked by a human clicking buttons or an LLM
agent with 15-second response latency.
