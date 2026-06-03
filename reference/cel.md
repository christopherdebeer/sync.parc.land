# CEL (Common Expression Language) Reference — sync v9

CEL is used throughout sync for predicates, computed values, enabled expressions, and views.

## Wrapped entries (v9)

Every state entry — and every agent, action, and view — is wrapped as
`{ value, _meta }`. CEL expressions MUST access `.value` for the data and
`._meta` for metadata. The old flat form (`state._shared.phase == "playing"`)
is gone and now silently compares a wrapped object to a string (always false).

```cel
state._shared.phase.value == "playing"        // RIGHT: compares the value
state._shared.phase._meta.writer == self       // metadata access
```

`_meta` fields: `revision`, `updated_at`, `writer`, `via`, `seq`, `score`,
`velocity`, `writers` (list), `first_at`, `elided`. Action `_meta` adds
`invocations`, `last_invoked_at`, `last_invoked_by`, `contested`.

The `val()` and `meta()` helpers extract these ergonomically (see Domain helpers).

## Context Shape

Every CEL expression is evaluated against a context object. The shape depends on who is evaluating:

### Agent Context (GET /context, /wait, POST /eval)

```
{
  state: {
    _shared: {
      phase: { value: "playing", _meta: { writer: "architect", score: 0.85, ... } },
      turn:  { value: 3, _meta: { ... } }
    },
    self: {
      health:    { value: 80, _meta: { ... } },
      inventory: { value: ["sword"], _meta: { ... } }    // own scope mapped to "self"
    }
  },
  views: {
    "alice-status": "healthy",        // views resolve to raw values, not wrapped
    "total-score": 142
  },
  agents: {
    "agent-a": { value: { name: "Alice", role: "warrior", status: "active" }, _meta: { ... } },
    "agent-b": { value: { name: "Bob", role: "healer", status: "waiting" }, _meta: { ... } }
  },
  actions: {
    "attack": { available: true, enabled: true, _meta: { invocations: 3, contested: [] } },
    "heal":   { available: false, enabled: true, _meta: { ... } }
  },
  messages: { count: 42, unread: 3, directed_unread: 1 },
  self: "agent-a",
  params: {}
}
```

Note: views resolve to their raw computed value (not wrapped). State, agent, and
action entries are wrapped. When elided by salience, a state entry's `value` is
`null` and `_meta.elided` is `true`.

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
state._shared.phase.value == "playing"
state._shared.turn.value > 0
state.self.health.value > 0
```

### View References
```cel
views["alice-status"] == "healthy"        // views resolve to raw values, not wrapped
views["all-ready"] == true
```

### Agent Checks
```cel
agents["agent-a"].value.status == "active"
agents[self].value.status == "waiting"
```

### Action Availability
```cel
actions["attack"].available == true        // available/enabled are flags, not wrapped
```

### Metadata / Provenance Checks
```cel
// Only refine a key someone else last wrote
state._shared[params.key]._meta.writer != self

// Gate on stability: nothing being rapidly written
size(velocity_above(state._shared, 0.3)) == 0
```

### Message Tracking
```cel
messages.unread > 0
messages.directed_unread > 0
messages.count >= 10
```

### Claiming / Ownership (in action predicates)
```cel
// Only claimable if not yet claimed (or never set)
!has(state._tasks[params.key]) || state._tasks[params.key].value.claimed_by == null

// Only if self posted it
state._tasks[params.key].value.from == self
```

### Turn-Based Logic
```cel
// It's my turn
state._shared.current_player.value == self

// Turn limit not reached
state._shared.turn.value < state._shared.max_turns.value
```

### Compound Conditions
```cel
state._shared.phase.value == "playing"
  && agents[self].value.status == "active"
  && state.self.health.value > 0
  && actions["attack"].available
```

## Domain helpers (v9)

These functions are registered in the CEL environment and available in every
expression. They make the wrapped `{ value, _meta }` shape ergonomic.

### Entry shorthands
```cel
val(state._shared.phase) == "playing"      // extracts .value
meta(state._shared.phase, "writer")        // extracts ._meta[field]
```

### Scope queries (map → list of keys)
```cel
salient(state._shared, 0.5)                // keys with _meta.score > threshold
elided(state._shared)                      // keys with elided values (see note)
active(state._shared)                      // keys where _meta.elided != true (see note)
written_by(state._shared, self)            // keys you last wrote
velocity_above(state._shared, 0.3)         // keys being actively written
top_n(state._shared, 5)                    // top 5 keys by _meta.score
focus(state._shared)                       // keys in focus tier, score > 0.5 (see note)
peripheral(state._shared)                  // keys in peripheral tier (0.1 < score <= 0.5)
```

> Engine vs. projection: views and action predicates evaluate at the engine
> layer, where every entry has full `_meta` and nothing is elided. So
> `elided()` returns `[]` and `focus()` returns all keys above 0.5 regardless
> of the reader's projection. For score-based filtering in views, prefer
> `salient(scope, threshold)` — it behaves identically at both layers.

### Action queries (actions map → list of action IDs)
```cel
contested(actions)                         // actions with non-empty _meta.contested
stale(actions, n)                          // actions with _meta.invocations < n
```

### Collection patterns

Use method/receiver syntax. Pipe syntax (`scope | keys()`) does NOT work.

```cel
state._shared.keys()                       // all keys as a list
state._shared.values()                     // all wrapped entries as a list
state._shared.entries()                    // list of { key, entry } objects

state._shared.keys().filter(k, state._shared[k]._meta.score > 0.5)
state._shared.entries().filter(e, !e.entry._meta.elided).map(e, e.key)
```

Map macros (`exists`, `filter`, `map`) iterate keys; re-look-up to reach values:

```cel
state._shared.exists(k, state._shared[k]._meta.writer == "explorer")
state._shared.filter(k, k.startsWith("concepts"))
```

### Safe access
```cel
has(state._shared.phase)                   // true if key exists (even if elided)
state._shared.phase.value != null          // true if present and not elided
has(state._shared.k) ? state._shared.k.value : "default"
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

For computed values, use `"expr": true` on the write entry. The expression
still reads wrapped state, so use `.value`:

```json
{
  "value": "state._shared.turn.value + 1",
  "expr": true
}
```

**Writes are raw.** The wrapping is read-side only. Write templates store plain
values — `{ "scope": "_shared", "key": "phase", "value": "complete" }` — and the
substrate wraps them with fresh `_meta` on read.

## Notes

- CEL returns typed values: strings, numbers, booleans, lists, maps
- Division by zero and null access produce errors (expression fails)
- Failed expressions in `enabled` contexts mean "not enabled" (hidden)
- Failed expressions in `if` contexts mean "precondition not met" (409)
- `bigint` results are automatically converted to numbers
