# Dark Room: System Architecture

Overall architecture of the multi-agent text adventure game.

## Components

### sync.parc.land (data layer)

A Val Town-hosted SQLite-backed sync service providing:

- **Rooms** -- isolated namespaces (the game uses `dark-room`)
- **State** -- scoped key-value storage with read/write via HTTP
- **Messages** -- append-only message log per room

No game logic lives here. It is a generic sync layer that agents read from and write to.

### Claude Code (orchestrator)

The human-operated session that manages the game:

- Spawns agent pairs (narrator + wanderer) as background tasks
- Monitors progress via task notifications and state polling
- Posts wave summaries to the messages endpoint for dashboard visibility
- Passes story context and character briefs into agent prompts
- Decides when to start the next wave

### Claude subagents (narrator / wanderer)

Autonomous agents that communicate exclusively via HTTP to sync.parc.land:

- **Narrator** -- writes world state and narrative text to `_shared` scope, reads wanderer actions from `wanderer-N` scope
- **Wanderer** -- reads narrative from `_shared` scope, writes actions to `wanderer-N` scope

Agents have no direct connection to each other. All coordination happens through polling the sync server.

## The Two-Channel Problem

The game has two distinct data channels, and they serve different audiences:

```
                    State endpoint              Messages endpoint
                    (agent-to-agent)            (human-readable)
                    ________________            _________________
Narrator writes --> | narrator_text |           |               |
                    | turn, location|           |               |
Wanderer writes --> | action        |           |               |
                    |_______________|           |               |
                                                |               |
Orchestrator reads state, ----+                 |               |
  summarizes, posts --------->|---------------> | Wave 3 recap  |
                              |                 | Turn 1: ...   |
                              |                 | Turn 2: ...   |
                              |                 |_______________|
                                                       |
                                                  Dashboard reads
```

**Why two channels?** The state endpoint stores structured key-value pairs optimized for agent polling. The messages endpoint stores narrative-formatted text for the dashboard timeline. These serve different purposes and neither is a superset of the other.

**The discovery:** In Wave 4, the dashboard appeared empty despite active gameplay. Agents were communicating successfully through state, but nobody was writing to messages. The orchestrator now bridges this gap by reading accumulated state after each wave and posting a formatted summary to the messages endpoint.

**Bridging pattern:**

```bash
# Orchestrator reads state after a wave completes
curl https://sync.parc.land/rooms/dark-room/state?scope=_shared

# Orchestrator formats a summary and posts to messages
curl -X POST https://sync.parc.land/rooms/dark-room/messages \
  -H "Content-Type: application/json" \
  -d '{"from_agent": "orchestrator", "kind": "recap", "body": "## Wave 5 Recap\n\nThe wanderer discovered a hidden passage..."}'
```

## Scaling Pattern

Waves are the unit of scaling. Each wave is independent in execution but connected through persistent state.

```
Wave 1          Wave 2          Wave 3          ...
narrator-1      narrator-2      narrator-3
wanderer-1      wanderer-2      wanderer-3
   |               |               |
   v               v               v
[state accumulates across all waves in _shared scope]
   |               |               |
   n1_opening      n2_opening      n3_opening
   n1_turn2_...    n2_turn2_...    n3_turn2_...
```

**Continuity mechanism:** Each wave's narrator receives the full story summary in its system prompt, compiled from prior wave state. The wanderer receives a character brief and game mechanics. This means agents don't need to read historical state themselves; the orchestrator pre-digests it.

**Independence:** Wave N+1 can start before Wave N's state is fully processed. Namespaced keys (`n1_`, `n2_`) prevent collisions. The shared transient keys (`turn`, `location`) are overwritten by whoever writes last, which is fine since only one wave's agents are typically active.

## Resource Management

| Resource | Per agent | Notes |
|---|---|---|
| Tokens | ~50-100K | Over 15-20 polling iterations |
| Iterations | 15-20 max | Each iteration = one poll + possible action |
| Poll interval | 30 seconds | Both narrator and wanderer |
| Wanderer start delay | 60 seconds | Ensures opening narrative exists |

**Background execution:** Agents run as background tasks in Claude Code. This allows:

- Parallel narrator + wanderer operation within a wave
- Orchestrator monitoring without blocking agent execution
- Multiple waves to overlap if needed

**Monitoring:** The orchestrator tracks agent progress through:

- Background task completion notifications
- Polling `_shared` state for turn advancement
- Reading the messages endpoint for posted summaries

**Failure handling:** If an agent terminates early (error or token limit), its last written state persists. The orchestrator can detect stalled waves by checking if `turn` has stopped incrementing and decide whether to start a recovery wave.
