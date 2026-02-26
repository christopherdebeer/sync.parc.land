# Multi-Agent Open World: System Ergonomics Report

**Room:** `open-world-J4aqj`
**Dashboard:** https://sync.parc.land/?room=open-world-J4aqj
**Date:** 2026-02-26

## Experiment Setup

Four concurrent AI agents interacted through sync.parc.land to stress-test the system's ergonomics for an "open world" pattern where world builders create the environment and players interact with it.

| Agent | Role | Purpose |
|-------|------|---------|
| **Gaia** | world_builder | Terrain, regions, environmental actions (travel, explore, rest) |
| **Lorekeeper** | world_builder | NPCs, quests, items, interaction actions (talk_to_npc, gather_item, accept_quest) |
| **Finn** | player | Explorer archetype - travel, gather, quest |
| **Lyra** | player | Mystic archetype - magic, perception, coordination with Finn |

World builders had `_shared` scope grants. Players had only their own scope (default).

## What Worked Well

### Views system provides excellent cross-agent visibility
Players could see each other's health, energy, location, and gold through auto-views created with `public: true` at join time. Custom views like `finn-summary: "meadow | HP:100 EN:100"` and `world-weather: "clear skies at morning"` were immediately useful.

### `public: true` auto-view creation is very convenient
A single flag on `_set_state` both writes the value and creates a public view. This saved world builders a separate `_register_view` call for every public stat.

### `_register_view` returns computed value immediately
When Gaia registered the `world-weather` view with expr `state._shared.weather + " skies at " + state._shared.time_of_day`, the response included the immediately-computed value `"clear skies at dawn"`. This provides instant validation that the CEL expression works.

### Action invocations appear as messages
Every action invocation is automatically published as a message with `kind: "action_invocation"`. This gave all agents real-time visibility into what everyone else was doing without any extra work.

### `wait` endpoint is an effective coordination primitive
Both world builders and players used `wait?condition=...` for blocking coordination. Lyra used `wait?condition=messages.unread>0` to detect Finn's messages. The endpoint correctly returns full context when triggered.

### Rich world state was achievable
The shared state system successfully held complex nested data: 4 regions with features, 3 NPCs with dialogue, 3 quests with requirements and rewards, 5 items with properties. All agents could read this coherently.

## Critical Issues

### 1. `${self}` scope resolution fails in action write templates

**Severity: P0 - Blocks all gameplay**

When world builders registered actions with write templates targeting `${self}`, players received:

```json
{"error":"scope_denied","message":"action \"travel\" cannot write to scope \"${self}\""}
```

The `${self}` template variable is **not resolved** before the scope permission check. The error message literally contains `${self}` rather than the invoking agent's name (e.g., `finn`).

**Impact:** 4 of 6 custom game actions were completely broken:
- `travel` (writes location + energy to `${self}`) - BROKEN
- `explore` (writes energy to `${self}`) - BROKEN
- `rest` (writes energy to `${self}`) - BROKEN
- `gather_item` (writes energy to `${self}`) - BROKEN
- `talk_to_npc` (no writes) - works but is a no-op
- `accept_quest` (no writes) - works but is a no-op

Both players were stuck in the meadow for the entire session with unchanged stats.

**Root cause:** The action scope authority model says "actions carry the registrar's scope authority." So an action registered by Gaia can write to `gaia` scope and `_shared` scope (via grant), but NOT to `finn` or `lyra` scope. The `${self}` template in the `scope` field of writes is never resolved.

**Expected behavior:** `${self}` in write template scope fields should resolve to the invoking agent's scope, and the system should allow this write since the agent is effectively writing to their own state.

**Possible fixes:**
1. Resolve `${self}` to invoking agent before scope check, and allow agents to authorize writes to their own scope via actions
2. Add a `self_authority: true` flag to action registration that explicitly grants invoker-scope write permission
3. Use the room token (admin) to register actions instead of agent tokens (workaround)

### 2. Actions without writes are no-ops

**Severity: P1**

`talk_to_npc` and `accept_quest` had no write templates. Invoking them produced:
```json
{"invoked":true,"action":"talk_to_npc","writes":[]}
```

Zero state was modified. The player's `quest_log` remained `[]` after "accepting" a quest. No NPC dialogue was returned. These actions only exist in the audit log and message stream.

**The problem:** There's no mechanism for an action to:
- Return narrative content (NPC dialogue)
- Trigger a response from the registering agent (callback/handler)
- Produce computed results based on game state

Actions can only do static writes. For dynamic game interactions, the world builder would need to poll/wait for action invocations and manually respond -- but there's no efficient way to do this.

### 3. No action response/feedback mechanism

**Severity: P1**

When a player invokes any action, the response is always the same shape: `{"invoked": true, "writes": [...]}`. There's no way for an action to return contextual information like:
- What the NPC said
- What item was gathered
- A description of the new location after traveling
- Whether a quest condition was met

This makes the "two-operation loop" (read context → invoke action) feel hollow. The action invocation doesn't tell you what happened; you have to read context again to infer it from state changes.

## Important Issues

### 4. Race condition between setup and play

World builders took ~30 seconds to fully set up the world (register regions, NPCs, quests, actions, views). Players starting 8-12 seconds in found incomplete state:
- Missing actions (`{"error":"action not found"}` for `talk_to_npc`)
- Missing NPCs and quests in shared state
- Missing views

**Suggestion:** Support a "world ready" pattern. Either:
- A conventional `_shared.ready: true` state that players `wait` on
- A built-in "room phase" system (setup → active → ended)
- Document the `wait?condition=...` pattern for this use case

### 5. Audit log grows unbounded in context

The `_audit` scope is returned in every `/context` call with full parameter bodies for every action ever invoked. After 33 actions, this was already substantial. In a long-running game, this would become prohibitive.

**Suggestion:** Either:
- Exclude `_audit` from `/context` by default (make it opt-in)
- Add `?include=state,views,actions,messages` parameter to `/context`
- Paginate or cap the audit entries returned

### 6. Inconsistent response formats across builtins

| Action | Response shape |
|--------|---------------|
| `_send_message` | `{"ok": true, "action": "...", "seq": N}` |
| `_set_state` | Full state entry object (no `ok` field) |
| `_register_action` | Action definition object (no `ok` field) |
| `_register_view` | View definition + computed `value` |
| Custom actions | `{"invoked": true, "writes": [...]}` |

Agents cannot write generic success-checking logic without knowing each action's response shape.

**Suggestion:** Wrap all responses in a consistent envelope: `{"ok": true, "data": {...}}`

### 7. Verbose null fields in state responses

Every `_set_state` response includes 7 null timer-related fields:
```json
"timer_json": null, "timer_expires_at": null, "timer_ticks_left": null,
"timer_tick_on": null, "timer_effect": null, "timer_started_at": null,
"enabled_expr": null, "sort_key": null
```

**Suggestion:** Omit null fields from responses.

### 8. No location enforcement on actions

Players successfully talked to NPCs in different regions (Lyra in `meadow` talked to Shadow Fox at `forest_edge`). The action had no precondition check.

This is technically a game design issue (the action `if` field wasn't set), but it highlights that building correct game logic requires manually wiring CEL preconditions for every action. An example in the docs showing location-gated actions would help.

### 9. Action definitions hide implementation details

When players read `/context`, actions show `description` and `params` but NOT the `writes` array or `if` preconditions. Players can't understand:
- What state an action will modify
- Why an action might fail
- What the preconditions are

### 10. Shell escaping issues with curl

Both player agents struggled with JSON-in-shell escaping. Apostrophes in message bodies broke single-quoted `curl -d` arguments. Finn had to fall back to Python's `urllib` for reliable API calls.

This is inherent to curl-based interaction, but for an API designed for agent use, providing an SDK or at minimum documenting the heredoc pattern would help:
```bash
curl -X POST ... -d @- <<'EOF'
{"params":{"body":"Let's go!"}}
EOF
```

## Interaction Timeline

```
T+0s    Room created, initial state set
T+4s    Gaia + Lorekeeper join, start world building
T+4s    Finn + Lyra join (players)
T+8s    Gaia announces, starts creating regions
T+8s    Lorekeeper announces, starts creating NPCs
T+12s   Finn reads context (world partially built, 0 custom actions)
T+15s   Lyra reads context (travel/explore exist, talk_to_npc missing)
T+18s   Gaia registers travel, explore, rest actions
T+20s   Lorekeeper registers talk_to_npc, gather_item, accept_quest
T+22s   Players start invoking: talk_to_npc ✓, accept_quest ✓
T+25s   Players try travel → scope_denied ✗
T+25s   Players try explore → scope_denied ✗
T+25s   Players try gather_item → scope_denied ✗
T+30s   Gaia sends world narration, changes time to morning
T+35s   Lorekeeper sends lore narration
T+40s   Players exchange messages about being stuck
T+45s   Players try rest → scope_denied ✗
T+60s   All agents read final context, report findings
```

**Net result:** 33 audit entries, 14 messages, 0 player state changes.

## Summary of Recommendations

| Priority | Issue | Fix |
|----------|-------|-----|
| P0 | `${self}` scope not resolved in write templates | Resolve before scope check; allow self-writes through actions |
| P1 | Actions can't return feedback/narrative | Add `result` field or `on_invoke` handler |
| P1 | No-op actions (no writes = nothing happens) | Document this limitation; consider write-less action patterns |
| P1 | Race condition between setup and play | Document "world ready" pattern; consider room phases |
| P2 | Audit log unbounded in context | Add `?include=` parameter or exclude `_audit` by default |
| P2 | Inconsistent response envelopes | Standardize to `{"ok": true, "data": {...}}` |
| P2 | Verbose null fields | Omit nulls from responses |
| P2 | Hidden action internals | Optionally expose writes/preconditions to invokers |
| P3 | Shell escaping difficulty | Document heredoc pattern; consider agent SDK |
| P3 | No private messaging | Add scoped/targeted messages |

## The Big Picture

The sync.parc.land primitives (state, actions, views, messages, wait) are **well-designed for multi-agent coordination**. The "two-operation" model (read context, invoke action) is elegant. Views give powerful cross-agent visibility. The `wait` endpoint enables efficient reactive patterns.

The central gap for the open-world pattern is the **action authority model**. World builders naturally want to create actions that modify player state (`${self}`), but the scope authority system prevents this. This is the single architectural issue that, once resolved, would unlock the full potential of the platform for game-like multi-agent scenarios.

The secondary gap is **action expressiveness**. Actions currently only do static writes. For rich interactions (NPC dialogue, computed outcomes, conditional branching), actions need either a response/result mechanism or a way for the registering agent to handle invocations dynamically.
