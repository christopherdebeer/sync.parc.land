# Dark Room: The Sync Engine

How the dark-room text adventure uses sync.parc.land as its communication backbone.

## Endpoints

The game operates within a single room (`dark-room`) using five HTTP endpoints:

### Read shared game state

```
GET /rooms/dark-room/state?scope=_shared
```

Returns the narrator-written world state visible to all agents. Response:

```json
{
  "turn": "3",
  "location": "cave_entrance",
  "wood": "2",
  "narrator_text": "The cave mouth yawns before you, cold air rushing outward...",
  "n1_opening": "You awaken in darkness. The air is damp and still...",
  "n1_turn2_result": "You gather fallen branches from the forest floor."
}
```

### Read per-wanderer state

```
GET /rooms/dark-room/state?scope=wanderer-1
```

Returns actions submitted by a specific wanderer. Response:

```json
{
  "action": "explore cave",
  "action_turn": "3"
}
```

### Write state (batch)

```
POST /rooms/dark-room/state
Content-Type: application/json

[
  {"key": "narrator_text", "value": "The torch flickers as you step inside...", "scope": "_shared"},
  {"key": "turn", "value": "4", "scope": "_shared"},
  {"key": "location", "value": "cave_interior", "scope": "_shared"}
]
```

Accepts an array of key-value-scope triples. Both narrator and wanderer use this endpoint, writing to different scopes.

### Read message history

```
GET /rooms/dark-room/messages
```

Returns the human-readable timeline displayed on the dashboard. Response is an array of messages with `from_agent`, `kind`, and `body` fields.

### Post messages (dashboard)

```
POST /rooms/dark-room/messages
Content-Type: application/json

{"from_agent": "narrator", "kind": "narrative", "body": "## Turn 3\nThe wanderer explores the cave entrance..."}
```

Posts a message to the room's timeline for dashboard display. This is separate from the state channel used for agent-to-agent communication.

## Communication Pattern

```
Narrator                   sync.parc.land                  Wanderer
   |                            |                              |
   |-- POST state (_shared) --> |                              |
   |   narrator_text, turn,     |                              |
   |   location, world keys     |                              |
   |                            |                              |
   |                            | <-- GET state (_shared) -----|
   |                            |     reads narrator_text      |
   |                            |                              |
   |                            | <-- POST state (wanderer-1) -|
   |                            |     action, action_turn      |
   |                            |                              |
   |--- GET state (wanderer-1)->|                              |
   |    reads action,           |                              |
   |    action_turn             |                              |
   |                            |                              |
   |-- POST state (_shared) --> |                              |
   |   updated narrator_text,   |                              |
   |   turn++                   |                              |
```

**Polling cadence:** Both agents poll every 30 seconds. The narrator checks the wanderer's scope for new actions (comparing `action_turn` against the current `turn`). The wanderer checks the shared scope for updated `narrator_text`.

**Turn detection:** The narrator increments `turn` in shared state after processing an action. The wanderer compares its last `action_turn` against the shared `turn` to know when the narrator has responded.

## State Namespacing

State keys use wave-prefixed namespacing to avoid collisions across waves:

| Key pattern | Scope | Purpose |
|---|---|---|
| `turn` | `_shared` | Current turn number (no prefix, overwritten each wave) |
| `location` | `_shared` | Current location (no prefix, overwritten) |
| `wood` | `_shared` | Resource counter (no prefix) |
| `narrator_text` | `_shared` | Latest narrative (no prefix, overwritten) |
| `n1_opening` | `_shared` | Wave 1 narrator opening text |
| `n1_turn2_result` | `_shared` | Wave 1 turn 2 narrative result |
| `n2_opening` | `_shared` | Wave 2 narrator opening text |
| `action` | `wanderer-1` | Latest wanderer action (overwritten) |
| `action_turn` | `wanderer-1` | Turn number the action targets |

Prefixed keys (`n1_`, `n2_`, etc.) accumulate across waves and are never cleared. This creates a layered history: each wave's narrator can read prior wave state to maintain story continuity. Unprefixed keys (`turn`, `location`, `narrator_text`) are transient and overwritten each wave.

## Agent Lifecycle

Each wave spawns two agents as background tasks:

```
Wave N starts
  |
  |-- spawn narrator (starts immediately)
  |     |-- writes opening narrative to _shared
  |     |-- polls wanderer-N scope every 30s
  |     |-- processes actions, writes results to _shared
  |     |-- 15-20 iterations max
  |     |-- ends on story conclusion or iteration limit
  |
  |-- spawn wanderer (waits 60s, then starts)
        |-- reads _shared for narrator_text
        |-- writes action + action_turn to wanderer-N scope
        |-- polls _shared every 30s for narrator response
        |-- 15-20 iterations max
        |-- ends on story conclusion or iteration limit
```

The 60-second wanderer delay ensures the narrator has written the opening scene before the wanderer begins reading. After that, both agents poll independently on 30-second intervals, creating a natural asynchronous conversation rhythm.

A wave ends when either agent reaches its iteration limit or the narrator writes a conclusion. State persists after agents terminate, available for the next wave's agents to read.
