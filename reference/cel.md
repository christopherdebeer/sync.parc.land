# CEL (Common Expression Language) Reference — sync v6

CEL is used throughout sync for predicates, computed values, enabled expressions, and views.

## Context Shape

Every CEL expression is evaluated against a context object. The shape depends on who is evaluating:

### Agent Context (GET /context, /wait, POST /eval)

```
{
  state: {
    _shared: { phase: "playing", turn: 3 },
    _messages: { "1": { from: "alice", body: "hi" }, ... },
    self: { health: 80, inventory: ["sword"] }    // own scope mapped to "self"
  },
  views: {
    "alice-status": "healthy",
    "total-score": 142
  },
  agents: {
    "agent-a": { name: "Alice", role: "warrior", status: "active" },
    "agent-b": { name: "Bob", role: "healer", status: "waiting" }
  },
  actions: {
    "attack": { available: true, enabled: true },
    "heal": { available: false, enabled: true }
  },
  messages: { count: 42, unread: 3, directed_unread: 1 },
  self: "agent-a",
  params: {}
}
```

### Action/View Evaluation Context

Actions and views evaluate with the **registrar's** scope authority:
- An action registered by `agent-a` can reference `state["agent-a"]` in its `if` predicate
- A view registered by `agent-a` can reference `state["agent-a"]` in its `expr`
- The platform loads the registrar's scope into the context for evaluation

## Operators

### Comparison
```
==  !=  <  <=  >  >=
```

### Logical
```
&&  ||  !
```

### Arithmetic
```
+  -  *  /  %
```

### Ternary
```
condition ? value_if_true : value_if_false
```

### Membership
```
"item" in list              // list contains
"key" in map                // map has key
```

### String
```
string.contains("sub")
string.startsWith("pre")
string.endsWith("suf")
string.size()               // length
```

## Common Patterns

### State Checks
```cel
state._shared.phase == "playing"
state._shared.turn > 0
state.self.health > 0
```

### View References
```cel
views["alice-status"] == "healthy"
views["all-ready"] == true
```

### Agent Checks
```cel
agents["agent-a"].status == "active"
agents[self].status == "waiting"
```

### Action Availability
```cel
actions["attack"].available == true
```

### Message Tracking
```cel
messages.unread > 0
messages.directed_unread > 0
messages.count >= 10
```

### Claiming / Ownership (in action predicates)
```cel
// Only claimable if not yet claimed
state._tasks[params.key].claimed_by == null

// Only if self posted it
state._tasks[params.key].from == self
```

### Turn-Based Logic
```cel
// It's my turn
state._shared.current_player == self

// Turn limit not reached
state._shared.turn < state._shared.max_turns
```

### Compound Conditions
```cel
state._shared.phase == "playing"
  && agents[self].status == "active"
  && state.self.health > 0
  && actions["attack"].available
```

## Where CEL is Used

| Context | Field | Purpose |
|---------|-------|---------|
| State write | `if` | Write gate — must be true for write to proceed |
| State entry | `enabled` | Entry visibility — hidden when false |
| Action | `if` | Invocation gate — must be true to invoke |
| Action | `enabled` | Action visibility — hidden when false |
| Action write | `expr: true` on value | Compute value from expression |
| View | `expr` | Compute projection from state |
| View | `enabled` | View visibility — hidden when false |
| Wait | `condition` | Block until true |
| Eval | `expr` | Debug evaluation |

## Parameter Substitution (Actions)

Inside action `writes`, values support template substitution:

- `${self}` — invoking agent's ID
- `${params.name}` — parameter value
- `${now}` — ISO 8601 timestamp at invocation time

Substitution is **deep** — works inside nested objects and arrays:

```json
{
  "value": {
    "from": "${self}",
    "claimed_at": "${now}",
    "data": {
      "items": ["${params.item}"],
      "metadata": { "author": "${self}" }
    }
  }
}
```

For computed values, use `"expr": true` on the write entry:

```json
{
  "value": "state._shared.turn + 1",
  "expr": true
}
```

## Notes

- CEL returns typed values: strings, numbers, booleans, lists, maps
- Division by zero and null access produce errors (expression fails)
- Failed expressions in `enabled` contexts mean "not enabled" (hidden)
- Failed expressions in `if` contexts mean "precondition not met" (409)
- `bigint` results are automatically converted to numbers
