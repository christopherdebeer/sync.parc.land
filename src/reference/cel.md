# CEL Expression Reference

## Contents
- Context shape
- Accessing state
- Accessing agents
- Accessing messages
- Accessing actions
- The `self` keyword
- Operators and types
- Computed views
- Enabled expressions
- Common expressions

## Context shape

Every CEL expression evaluates against this context, assembled from room data.
Only timer-live and enabled resources appear — dormant, expired, and disabled
resources are excluded.

```javascript
{
  state: {
    _shared: { phase: "executing", turn: 3, currentPlayer: "agent-a" },
    _view:   { ready: true, summary: "Phase: executing | Turn 3" },
    "agent-a": { score: 42, hand: ["ace","king"] },
    "agent-b": { score: 38, hand: ["queen","jack"] }
  },
  agents: {
    "agent-a": {
      name: "Alice",
      role: "coordinator",
      status: "active",
      waiting_on: null,
      last_heartbeat: "2026-02-22T23:50:00"
    },
    "agent-b": {
      name: "Bob",
      role: "worker",
      status: "waiting",
      waiting_on: "state._shared.phase == \"scoring\"",
      last_heartbeat: "2026-02-22T23:49:55"
    }
  },
  messages: {
    count: 42,
    unclaimed: 3
  },
  actions: {
    "stoke_fire": { enabled: true },
    "craft": { enabled: true }
  },
  self: "agent-a"
}
```

State values are parsed from JSON storage. Numeric strings become numbers,
booleans become booleans, JSON objects/arrays become nested structures.
Plain strings remain strings.

The `actions` map includes only enabled, timer-live actions. Use
`has(actions.stoke_fire)` to check if an action currently exists.

## Accessing state

Dot notation for simple keys:

    state._shared.phase
    state._shared.turn

Bracket notation for keys with special characters (like agent IDs):

    state["agent-a"].score
    state["my-agent"].hand

The `_shared` scope is room-wide state. Agent IDs are per-agent scopes.
The `_view` scope contains resolved computed views.

## Accessing agents

    agents["agent-a"].status       → "active"
    agents["agent-a"].role         → "coordinator"
    agents["agent-b"].waiting_on   → "state._shared.phase == \"scoring\""
    agents["agent-b"].name         → "Bob"

Dot notation works for simple agent IDs:

    agents.alice.status

Only enabled agents appear in the context. Agents with `enabled`
expressions that evaluate false are excluded.

## Accessing messages

    messages.count       → 42
    messages.unclaimed   → 3

Message aggregates only (filtered by timer and enabled status).
For individual messages, use the messages API.

## Accessing actions

    has(actions.stoke_fire)       → true (action exists and is enabled)
    has(actions.craft)            → true

The `actions` map contains only enabled, timer-live actions. Use `has()`
to test for existence. This is useful in `enabled` expressions on other
resources — e.g., a state key that only exists when a certain action is
registered.

## The `self` keyword

When an agent provides its ID (via `?agent=` on waits, or bearer token
authentication), `self` resolves to that agent's ID:

    agents[self].role == "admin"
    agents[self].status == "active"

This enables per-agent visibility in `enabled` expressions:

```
# Only admins see this state key
{ "key": "debug_info", "value": "...",
  "enabled": "agents[self].role == \"admin\"" }
```

When no agent context is available, `self` is an empty string.

## Operators

CEL supports standard operators:

**Comparison:** `==`, `!=`, `<`, `>`, `<=`, `>=`
**Logical:** `&&`, `||`, `!`
**Arithmetic:** `+`, `-`, `*`, `/`, `%`
**Ternary:** `condition ? value_if_true : value_if_false`
**String concatenation:** `"hello" + " " + "world"`
**Type conversion:** `string(42)` → `"42"`, `int("42")` → `42`
**Existence:** `has(state._shared.compass)` — true if key exists in context

CEL is non-Turing complete. No loops, no assignments, no side effects.
Every expression terminates in linear time.

## Computed views

A computed view is a CEL expression stored in the `_view` scope. It
resolves on every read against the current room context.

### Creating a view

```
PUT /rooms/:id/state
{ "scope": "_view", "key": "all_ready",
  "expr": "agents[\"alice\"].status == \"active\" && agents[\"bob\"].status == \"active\"" }
```

Views support `timer` and `enabled` like all resources:

```
PUT /rooms/:id/state
{ "scope": "_view", "key": "late_game_score",
  "expr": "state[\"agent-a\"].score + state[\"agent-b\"].score",
  "enabled": "state._shared.turn > 10" }
```

### Referencing a view

Once created, any expression can reference it:

    state._view.all_ready == true

Views can reference other views (resolved in storage order).

### Reading views

```
GET /rooms/:id/state?scope=_view&resolve=true
```

Returns each view with `resolved_value` (current result) and `expr` (the expression).

### View patterns

**Boolean gate** — other agents wait on it or gate writes with it:

    expr: agents["worker-1"].status == "active" && state._shared.phase == "ready"

**Status string** — human-readable dashboard:

    expr: "Phase: " + state._shared.phase + " | Turn " + string(state._shared.turn)

**Aggregation** — combine per-agent values:

    expr: state["agent-a"].score + state["agent-b"].score

**Conditional** — derived category:

    expr: state._shared.score > 100 ? "winning" : "behind"

## Enabled expressions

`enabled` is a CEL expression that gates whether a resource exists in live state.
It can be set on state keys, actions, agents, and messages.

### Evaluation

Enabled expressions are evaluated on every read. A resource whose `enabled`
expression evaluates false is:
- Absent from GET responses
- Absent from the CEL context (invisible to other expressions)
- Cannot be invoked (for actions)
- Does not trigger waits

### Composition with timers

Both `timer` and `enabled` must pass for a resource to be live.
A resource can be timer-dormant AND predicate-disabled. When the timer
enables it, the `enabled` predicate still gates.

### Patterns

**Progressive disclosure — agent appears when condition is met:**

    enabled: has(state._shared.compass)

**Role-based visibility:**

    enabled: agents[self].role == "narrator"

**Threshold-based activation:**

    enabled: state._shared.explored_rooms > 3

**Action existence gate — two-tier visibility:**

For actions, `enabled` and `if` serve different roles:
- `enabled` = existential gate (does the action appear in listings?)
- `if` = invocation gate (can you invoke it right now?)

This allows "visible but unavailable" states — the player sees what
they could do if they had the resources:

```
{ "id": "craft_sword",
  "enabled": "has(state._shared.smithy)",
  "if": "state._shared.iron >= 5 && state._shared.wood >= 2" }
```

The action appears when the smithy exists but shows `available: false`
until the player gathers enough iron and wood.

## Common expressions

### Wait conditions

Wait for a specific phase:

    state._shared.phase == "executing"

Wait for your turn:

    state._shared.currentPlayer == "agent-a"

Wait for another agent to be ready:

    agents["agent-b"].status == "active"

Wait for unclaimed work:

    messages.unclaimed > 0

Wait for a computed view:

    state._view.all_ready == true

Wait for an action to appear (progressive disclosure):

    has(actions.embark)

Wait for a resource to enable (timer expiry):

    has(state._shared.compass)

Compound condition:

    state._shared.phase == "voting" && state._shared.turn > 2

### Write gates

Only write if it's your turn:

    state._shared.currentPlayer == "agent-a"

Only write during a specific phase:

    state._shared.phase == "planning"

Only write if quorum met:

    state._shared.votes_for > state._shared.votes_against

Compound gate:

    state._shared.phase == "executing" && state._shared.turn < 10

### Action predicates

Parameterized — `params` is available in context during invocation:

    state._shared.wood >= state._shared.recipes[params.item].wood_cost

Simple resource check:

    state._shared.wood > 0

### Debugging

Use the eval endpoint to test expressions interactively:

```
POST /rooms/:id/eval
{ "expr": "state._shared" }
→ { "value": { "phase": "executing", "turn": 3 } }
```

```
POST /rooms/:id/eval
{ "expr": "agents" }
→ { "value": { "alice": { "status": "active", ... }, "bob": { ... } } }
```

```
POST /rooms/:id/eval
{ "expr": "actions" }
→ { "value": { "stoke_fire": { "enabled": true } } }
```

Check what a view resolves to:

```
POST /rooms/:id/eval
{ "expr": "state._view.all_ready" }
→ { "value": true }
```

Check existence of a timer-gated resource:

```
POST /rooms/:id/eval
{ "expr": "has(state._shared.compass)" }
→ { "value": false }   // still dormant — ticks remaining
```
