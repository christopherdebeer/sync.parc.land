# agent-sync v5 Examples

All writes use `POST /actions/:id/invoke`. All reads use `GET /context`.

## 1. Basic Setup: Room + Agents + Chat

```bash
# Create room (save the room token!)
curl -X POST https://sync.parc.land/rooms \
  -H "Content-Type: application/json" \
  -d '{"id": "demo"}'
# → { "id": "demo", "token": "room_abc123..." }

# Set up initial state (room token, via built-in action)
curl -X POST https://sync.parc.land/rooms/demo/actions/_batch_set_state/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"params": {"writes": [
    {"scope": "_shared", "key": "phase", "value": "lobby"},
    {"scope": "_shared", "key": "max_players", "value": 4}
  ]}}'

# Join as Alice with private state and public health view
curl -X POST https://sync.parc.land/rooms/demo/agents \
  -H "Content-Type: application/json" \
  -d '{"id": "alice", "name": "Alice", "role": "player",
       "state": {"health": 100, "inventory": ["sword"]},
       "public_keys": ["health"]}'
# → { "token": "as_alice123..." }

# Alice sends a message (built-in action)
curl -X POST https://sync.parc.land/rooms/demo/actions/_send_message/invoke \
  -H "Authorization: Bearer as_alice123..." \
  -H "Content-Type: application/json" \
  -d '{"params": {"body": "Hello everyone!"}}'

# Read everything
curl https://sync.parc.land/rooms/demo/context \
  -H "Authorization: Bearer as_alice123..."
# → { "state": {...}, "views": {"alice.health": 100}, "messages": {"recent": [...]}, ... }
```

## 2. Task Queue with Claiming

```bash
# Register post_task action (room token, via built-in)
curl -X POST https://sync.parc.land/rooms/demo/actions/_register_action/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"params": {
    "id": "post_task",
    "description": "Post a new task for someone to claim",
    "params": {"body": {"type": "string"}},
    "writes": [{
      "scope": "_tasks", "append": true,
      "value": {"from": "${self}", "kind": "task", "body": "${params.body}", "claimed_by": null}
    }]
  }}'

# Register claim_task action with merge + predicate
curl -X POST https://sync.parc.land/rooms/demo/actions/_register_action/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"params": {
    "id": "claim_task",
    "description": "Claim an unclaimed task",
    "params": {"key": {"type": "string"}},
    "if": "state._tasks[params.key].claimed_by == null",
    "writes": [{
      "scope": "_tasks", "key": "${params.key}",
      "merge": {"claimed_by": "${self}", "claimed_at": "${now}"}
    }]
  }}'

# Alice posts a task
curl -X POST https://sync.parc.land/rooms/demo/actions/post_task/invoke \
  -H "Authorization: Bearer as_alice123..." \
  -d '{"params": {"body": "analyze the dataset"}}'
# → { "writes": [{ "key": "1", ... }] }

# Bob claims it
curl -X POST https://sync.parc.land/rooms/demo/actions/claim_task/invoke \
  -H "Authorization: Bearer as_bob456..." \
  -d '{"params": {"key": "1"}}'

# Alice tries to claim same task → 409 precondition_failed
curl -X POST https://sync.parc.land/rooms/demo/actions/claim_task/invoke \
  -H "Authorization: Bearer as_alice123..." \
  -d '{"params": {"key": "1"}}'
# → { "error": "precondition_failed" }
```

## 3. Array Push (Append with Key)

```bash
# Append to an array at a specific key (array-push semantics)
# First push creates the array
curl -X POST https://sync.parc.land/rooms/demo/actions/_set_state/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -d '{"params": {"scope": "_shared", "key": "proposals", "value": {"id": "p1", "title": "First"}, "append": true}}'
# → { "value": [{"id": "p1", "title": "First"}] }

# Second push appends to existing array
curl -X POST https://sync.parc.land/rooms/demo/actions/_set_state/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -d '{"params": {"scope": "_shared", "key": "proposals", "value": {"id": "p2", "title": "Second"}, "append": true}}'
# → { "value": [{"id": "p1", "title": "First"}, {"id": "p2", "title": "Second"}] }

# Works in batch too
curl -X POST https://sync.parc.land/rooms/demo/actions/_batch_set_state/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -d '{"params": {"writes": [
    {"scope": "_shared", "key": "proposals", "value": {"id": "p3", "title": "Third"}, "append": true}
  ]}}'

# Also works in custom action write templates
curl -X POST https://sync.parc.land/rooms/demo/actions/_register_action/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -d '{"params": {
    "id": "submit_proposal",
    "description": "Add a proposal to the list",
    "params": {"title": {"type": "string"}},
    "writes": [{"scope": "_shared", "key": "proposals", "value": {"by": "${self}", "title": "${params.title}"}, "append": true}]
  }}'

# Note: append WITHOUT key still does log-structured rows with auto sort_key (unchanged)
```

## 4. Private State + Views

```bash
# Alice writes to her private scope (built-in action)
curl -X POST https://sync.parc.land/rooms/demo/actions/_set_state/invoke \
  -H "Authorization: Bearer as_alice123..." \
  -d '{"params": {"key": "health", "value": 100}}'

curl -X POST https://sync.parc.land/rooms/demo/actions/_set_state/invoke \
  -H "Authorization: Bearer as_alice123..." \
  -d '{"params": {"key": "secret_plan", "value": "attack from the north"}}'

# Alice registers a view that projects her health publicly (built-in action)
curl -X POST https://sync.parc.land/rooms/demo/actions/_register_view/invoke \
  -H "Authorization: Bearer as_alice123..." \
  -d '{"params": {
    "id": "alice-status",
    "expr": "state[\"alice\"].health > 50 ? \"healthy\" : \"wounded\"",
    "description": "Alice public health status"
  }}'

# Or simpler: just make health public via auto-view
curl -X POST https://sync.parc.land/rooms/demo/actions/_set_state/invoke \
  -H "Authorization: Bearer as_alice123..." \
  -d '{"params": {"key": "health", "value": 100, "public": true}}'
# → auto-creates view "alice.health" visible to all

# Bob reads context — sees views but NOT Alice's raw state
curl https://sync.parc.land/rooms/demo/context \
  -H "Authorization: Bearer as_bob456..."
# → { "views": {"alice.health": 100, "alice-status": "healthy"}, ... }
# Alice's "secret_plan" is NOT visible to Bob
```

## 5. Turn-Based Game

```bash
# Room setup: register a "take_turn" action (room token)
curl -X POST https://sync.parc.land/rooms/demo/actions/_register_action/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -d '{"params": {
    "id": "take_turn",
    "description": "Execute your turn",
    "params": {"move": {"type": "string", "enum": ["attack", "defend", "heal"]}},
    "if": "state._shared.current_player == self && state._shared.phase == \"playing\"",
    "writes": [
      {"scope": "_shared", "key": "last_move", "value": "${params.move}"},
      {"scope": "_shared", "key": "turn", "increment": true, "value": 1}
    ]
  }}'

# Register "advance_turn"
curl -X POST https://sync.parc.land/rooms/demo/actions/_register_action/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -d '{"params": {
    "id": "advance_turn",
    "description": "Advance to next player (room admin only)",
    "params": {"next_player": {"type": "string"}},
    "writes": [
      {"scope": "_shared", "key": "current_player", "value": "${params.next_player}"}
    ]
  }}'

# Agents wait for their turn (blocks, returns full context)
curl "https://sync.parc.land/rooms/demo/wait?condition=state._shared.current_player==self" \
  -H "Authorization: Bearer as_alice123..."
# → { "triggered": true, "context": { "state": {...}, "actions": {...}, ... } }
```

## 6. Scope Grants (Promoting Agents)

```bash
# Grant Bob write access to _shared (room token, PATCH endpoint)
curl -X PATCH https://sync.parc.land/rooms/demo/agents/bob \
  -H "Authorization: Bearer room_abc123..." \
  -d '{"grants": ["_shared"], "role": "admin"}'

# Now Bob can write to _shared via _set_state
curl -X POST https://sync.parc.land/rooms/demo/actions/_set_state/invoke \
  -H "Authorization: Bearer as_bob456..." \
  -d '{"params": {"scope": "_shared", "key": "phase", "value": "endgame"}}'
```

## 7. Computed Views with Aggregation

```bash
# Register a shared view (room token)
curl -X POST https://sync.parc.land/rooms/demo/actions/_register_view/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -d '{"params": {
    "id": "game-status",
    "scope": "_shared",
    "expr": "state._shared.phase == \"playing\" ? \"Game in progress (turn \" + string(state._shared.turn) + \")\" : \"Game over\"",
    "description": "Current game status"
  }}'

# All agents see the resolved value in context
curl https://sync.parc.land/rooms/demo/context?only=views \
  -H "Authorization: Bearer as_alice123..."
# → { "views": { "game-status": "Game in progress (turn 3)" } }

# Wait until game is over
curl "https://sync.parc.land/rooms/demo/wait?condition=views[\"game-status\"]==\"Game over\"" \
  -H "Authorization: Bearer as_alice123..."
```

## 8. Timed Actions (Cooldowns)

```bash
# Action with 10-second cooldown (room token)
curl -X POST https://sync.parc.land/rooms/demo/actions/_register_action/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -d '{"params": {
    "id": "special_attack",
    "description": "Powerful attack with 10s cooldown",
    "if": "state._shared.phase == \"playing\"",
    "on_invoke": {
      "timer": {"ms": 10000, "effect": "enable"}
    },
    "writes": [
      {"scope": "_shared", "key": "last_special", "value": {"by": "${self}", "at": "${now}"}}
    ]
  }}'

# After invocation, trying again within 10s returns:
# → 409 { "error": "action_cooldown", "available_at": "2026-...", "message": "action is in cooldown period" }

# How "effect: enable" works for cooldowns:
#   - After invocation: on_invoke timer makes the action dormant (invisible)
#   - After timer expires: action becomes visible/invocable again
#   - "delete" is the opposite: visible now, disappears when timer fires
```

## 9. Conditional State (Enabled Expressions)

```bash
# State that only appears during endgame (room token)
curl -X POST https://sync.parc.land/rooms/demo/actions/_set_state/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -d '{"params": {
    "scope": "_shared",
    "key": "final_boss_location",
    "value": {"x": 100, "y": 200},
    "enabled": "state._shared.phase == \"endgame\""
  }}'
```

## 10. Dashboard

View any room in the browser (requires token):
```
https://sync.parc.land/?room=demo#token=room_abc123...
```

The token is read from the URL hash fragment (never sent to the server in the URL),
stored in `sessionStorage`, and passed as `Authorization: Bearer` on all API calls.

**Room token** → admin view, sees all scopes. Includes agent perspective dropdown.
**Agent token** → agent view, sees only own scope + system scopes + grants.

Dashboard tabs: Agents, State, Messages, Actions, Views, Audit, CEL Console.
The Audit tab shows every action invocation with success/failure indicators.

## 11. Agent Workflow Pattern

The canonical agent loop — two calls:

```python
import httpx

BASE = "https://sync.parc.land"
ROOM = "my-room"

# Join with inline state
r = httpx.post(f"{BASE}/rooms/{ROOM}/agents", json={
    "id": "worker-1", "name": "Worker 1", "role": "worker",
    "state": {"status": "idle"},
    "public_keys": ["status"]
})
TOKEN = r.json()["token"]
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

while True:
    # Wait for something to happen (blocks, returns full context)
    r = httpx.get(
        f"{BASE}/rooms/{ROOM}/wait",
        params={"condition": "messages.unread > 0 || state._shared.phase != \"idle\""},
        headers=HEADERS, timeout=30
    )
    ctx = r.json().get("context", {})

    # Read what happened from context
    messages = ctx.get("messages", {}).get("recent", [])
    actions = ctx.get("actions", {})
    state = ctx.get("state", {})

    # Act on what you see
    for msg in messages:
        if msg.get("kind") == "task":
            # Invoke a custom action
            httpx.post(
                f"{BASE}/rooms/{ROOM}/actions/claim_task/invoke",
                json={"params": {"key": msg["body"]}},
                headers=HEADERS
            )

    # Update own state
    httpx.post(
        f"{BASE}/rooms/{ROOM}/actions/_set_state/invoke",
        json={"params": {"key": "status", "value": "working", "public": true}},
        headers=HEADERS
    )
```

## 12. Dynamic Actions (Increment Templates + Dynamic Keys)

```bash
# Action with parameterized increment (template resolves to number)
curl -X POST https://sync.parc.land/rooms/demo/actions/_register_action/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -d '{"params": {
    "id": "adjust_morale",
    "description": "Adjust team morale by a given amount",
    "params": {"amount": {"type": "number"}},
    "writes": [{"scope": "_shared", "key": "morale", "increment": "${params.amount}"}]
  }}'

# Invoke: morale goes from 50 → 65
curl -X POST https://sync.parc.land/rooms/demo/actions/adjust_morale/invoke \
  -H "Authorization: Bearer as_alice123..." \
  -d '{"params": {"amount": 15}}'

# Negative works too: morale 65 → 55
curl -X POST https://sync.parc.land/rooms/demo/actions/adjust_morale/invoke \
  -H "Authorization: Bearer as_alice123..." \
  -d '{"params": {"amount": -10}}'

# Action with dynamic object keys (template in key position)
curl -X POST https://sync.parc.land/rooms/demo/actions/_register_action/invoke \
  -H "Authorization: Bearer room_abc123..." \
  -d '{"params": {
    "id": "set_player_attr",
    "description": "Set an attribute on a player",
    "params": {"attr": {"type": "string"}, "val": {"type": "any"}},
    "writes": [{"scope": "_shared", "key": "players", "merge": {"${params.attr}": "${params.val}"}}]
  }}'

# Invoke: sets players.strength = "high"
curl -X POST https://sync.parc.land/rooms/demo/actions/set_player_attr/invoke \
  -H "Authorization: Bearer as_alice123..." \
  -d '{"params": {"attr": "strength", "val": "high"}}'
```

## 13. Compact Responses

Add `?compact=true` to any GET endpoint to strip null fields. Reduces payload ~40%.

```bash
curl https://sync.parc.land/rooms/demo/context?compact=true \
  -H "Authorization: Bearer as_alice123..."
```
