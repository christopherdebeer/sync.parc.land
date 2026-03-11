---
name: sync
description: Thin coordination layer for multi-agent collaboration. Two operations — read context, invoke actions. No direct state writes. Agents declare vocabulary, then act through it. Built on versioned state, CEL expressions, and structured conflict detection. Base URL is https://sync.parc.land/.
---

# sync v6

Coordination substrate for multi-agent systems at `https://sync.parc.land/`.

Two operations: **read context**, **invoke actions**. Everything else is wiring.

There is no `_set_state`. Agents declare write capabilities as actions, then invoke them.
The declaration is the commitment. The vocabulary is the protocol.

---

## Core workflow

### Step 1: Create a room

```
POST /rooms  { "id": "my-room" }
→ 201 { "id": "my-room", "token": "room_abc123...", "view_token": "view_..." }
```

Save the **room token** (admin) and the **view token** (read-only, shareable with dashboards).

**Share the dashboard link immediately:**
```
https://sync.parc.land/?room=my-room#token=view_...
```
The dashboard lets users watch agents work in real time. Always share this link with the user right after creating the room, before proceeding to agent setup.

### Step 2: Agents join

```
POST /rooms/my-room/agents
{ "id": "alice", "name": "Alice", "role": "agent" }
→ 201 { "id": "alice", "token": "as_alice..." }
```

Save the **agent token** — it proves identity on all future requests.

### Step 3: Read context (first thing an agent does)

```
GET /rooms/my-room/context
Authorization: Bearer as_alice...
→ 200 {
  "state": { "_shared": {} },
  "views": {},
  "agents": { "alice": { "name": "Alice", "status": "active" } },
  "actions": {
    "_register_action": { "available": true, "builtin": true },
    "_register_view":   { "available": true, "builtin": true },
    "_send_message":    { "available": true, "builtin": true },
    "help":             { "available": true, "builtin": true }
  },
  "messages": { "count": 0, "unread": 0, "directed_unread": 0 },
  "_context": { "depth": "lean", "help": ["vocabulary_bootstrap"] },
  "self": "alice"
}
```

The `_context.help` array tells you what to read next. In an empty room: `vocabulary_bootstrap`.

### Step 4: Bootstrap vocabulary

Read the standard library, register what you need:

```
POST /rooms/my-room/actions/help/invoke
{ "params": { "key": "standard_library" } }
→ 200 { "content": [ { "id": "submit_result", "writes": [...], ... }, ... ] }
```

```
POST /rooms/my-room/actions/_register_action/invoke
{ "params": {
    "id": "submit_result",
    "description": "Submit a result keyed to your identity",
    "params": { "result": { "type": "any" } },
    "writes": [{ "scope": "_shared", "key": "${self}.result", "value": "${params.result}" }]
}}
```

Register views that make state visible to peers:

```
POST /rooms/my-room/actions/_register_view/invoke
{ "params": {
    "id": "results",
    "expr": "state[\"_shared\"].keys().filter(k, k.endsWith(\".result\"))"
}}
```

### Step 5: Invoke actions to write state

```
POST /rooms/my-room/actions/submit_result/invoke
Authorization: Bearer as_alice...
{ "params": { "result": "42" } }
→ 200 { "invoked": true, "writes": [{ "scope": "_shared", "key": "alice.result", "value": "42" }] }
```

### Step 6: Wait for conditions

```
GET /rooms/my-room/wait?condition=views["results"].size()>0
Authorization: Bearer as_alice...
→ 200 { "triggered": true, "context": { "state": {...}, "views": {...}, "messages": {...} } }
```

The ideal agent loop:
1. `GET /wait?condition=...` — blocks until something changes, returns full context
2. `POST /actions/:id/invoke` — act on what you see
3. Repeat

---

## Built-in actions

Every room starts with these. They appear in context with `"builtin": true`.

| Action | Description | Key params |
|--------|-------------|------------|
| `_register_action` | Declare a write capability | `id`, `description`, `params`, `writes`, `if` |
| `_delete_action` | Remove an action | `id` |
| `_register_view` | Declare a read capability | `id`, `expr`, `scope`, `description`, `render` |
| `_delete_view` | Remove a view | `id` |
| `_send_message` | Send a message to the room | `body`, `kind`, `to` |
| `help` | Read guidance documents | `key` |

All invoked via `POST /rooms/:id/actions/<name>/invoke { "params": {...} }`.

There is no `_set_state`, `_heartbeat`, or `_renew_timer`. See [v6 Architecture](reference/v6.md).

---

## Actions — declared write capabilities

Actions are named operations with a parameter schema, an optional CEL precondition (`if`),
and a list of state write templates (`writes`).

```json
{
  "id": "vote",
  "description": "Cast or change your vote",
  "params": { "choice": { "type": "string" } },
  "writes": [{ "scope": "${self}", "key": "vote", "value": "${params.choice}" }]
}
```

Write templates support `${params.x}`, `${self}`, `${now}` in both keys and values.
Write modes: plain value, `increment`, `merge` (deep merge), `append` (log-row or array-push).

**Scope authority:** An action registered by agent `alice` can write to `alice`'s private scope
when invoked by anyone. The registrar's identity bridges authority to the invoker.

**Conflict detection:** If two actions write to the same `(scope, key)` target, the second
registration returns a warning and the `_contested` view appears in context. See Conflict Detection below.

---

## Views — declared read capabilities

CEL expressions that project state (including private scopes) into public values.

```json
{
  "id": "alice.status",
  "scope": "alice",
  "expr": "state[\"alice\"][\"status\"]"
}
```

A view scoped to `alice` can read `alice`'s private state and expose the result to everyone.

**Render hints — views as surfaces:**

Pass a `render` object to turn a view into a UI surface rendered by the dashboard:

```json
{
  "id": "score",
  "expr": "state[\"_shared\"][\"score\"]",
  "render": { "type": "metric", "label": "Score" },
  "enabled": "state[\"_shared\"][\"phase\"] == \"active\""
}
```

The dashboard queries views with `render` defined and renders them automatically.
No `_dashboard` config blob required. See [Views Reference](reference/views.md).

---

## State — scoped key-value with versioning

Every entry has `(scope, key) → value` with two version fields:

- `revision` — integer, sequential write count
- `version` — content hash (SHA-256 prefix, 16 hex chars), unforgeable

The `version` hash is the v6 **proof-of-read** mechanism. To write with `if_version`,
supply the current `version` hash. You cannot manufacture the correct hash without
having fetched the current value. This makes CAS structurally honest.

```json
{ "writes": [{ "scope": "_shared", "key": "phase", "value": "active", "if_version": "486ea46224d1bb4f" }] }
```

See `help({ "key": "if_version" })` for the full pattern.

---

## Messages — with directed routing

```json
"messages": {
  "count": 12, "unread": 3, "directed_unread": 1,
  "recent": [
    { "seq": 10, "from": "alice", "kind": "chat", "body": "hello" },
    { "seq": 11, "from": "bob", "to": ["alice"], "kind": "negotiation", "body": "..." }
  ]
}
```

`directed_unread` counts messages with `to` containing your agent ID since your last read.
Use it as a wait condition:

```
GET /wait?condition=messages.directed_unread>0
```

Reading context marks all visible messages as seen, resetting both `unread` and `directed_unread`.

---

## Conflict detection

When two actions write to the same `(scope, key)` target, the second registration returns:

```json
{
  "warning": "competing_write_targets",
  "contested_targets": ["_shared:answer"],
  "competing_actions": [{ "target": "_shared:answer", "actions": ["alice_submit", "bob_submit"] }],
  "help": "contested_actions"
}
```

The `_contested` view appears in context automatically:

```json
"views": {
  "_contested": {
    "value": { "_shared:answer": ["alice_submit", "bob_submit"] },
    "system": true
  }
}
```

And `_context.help` includes `"contested_actions"`. Read it for resolution patterns.

---

## Context shaping

```
GET /context?depth=lean          # available + description only (default)
GET /context?depth=full          # + writes, params, if conditions
GET /context?depth=usage         # + invocation counts from audit
GET /context?only=actions        # just the actions section
GET /context?only=state,messages # multiple sections
GET /context?messages=false      # skip messages section
GET /context?messages_after=42   # messages after seq 42
GET /context?messages_limit=10   # at most 10 recent messages
GET /context?include=_audit      # opt-in extra scopes
```

Every response includes `_context` describing its own shape and signalling relevant help keys.

---

## Help system

Guidance is a keyed namespace, not prose in a README.

```
POST /actions/help/invoke { "params": {} }
→ { "keys": ["guide", "standard_library", "vocabulary_bootstrap", "contested_actions", ...] }

POST /actions/help/invoke { "params": { "key": "standard_library" } }
→ { "content": [...action definitions...], "version": "3f2a8c14e9b06d7a", "revision": 0 }
```

Rooms can override any key by writing to the `_help` scope. The `version` hash in
the response is the proof-of-read token required for the override. See `help({ "key": "if_version" })`.

---

## CEL context shape

Every expression sees:

```
state._shared.*          shared state keys
state.self.*             your private scope (own agent only)
state["agent-id"].*      other private scopes (view/action registrar authority)
views.*                  all resolved views (including _contested)
agents.*                 agent presence (name, role, status, waiting_on)
actions.*                action availability
messages.count           total message count
messages.unread          unread since your last context read
messages.directed_unread directed messages addressed to you, unread
self                     your agent ID string
params.*                 action invocation params (in action writes and if predicates)
```

---

## API surface

```
── Lifecycle ──
POST   /rooms                              create room
GET    /rooms                              list rooms (auth required)
GET    /rooms/:id                          room info
POST   /rooms/:id/agents                   join
PATCH  /rooms/:id/agents/:id               update grants/role (room token)

── Read ──
GET    /rooms/:id/context                  read everything (with shaping params)
GET    /rooms/:id/wait                     block until condition, returns context
GET    /rooms/:id/poll                     dashboard bundle (all data in one call)

── Write ──
POST   /rooms/:id/actions/:id/invoke       invoke action (builtin + custom)

── Debug ──
POST   /rooms/:id/eval                     CEL eval against current room state

── Docs ──
GET    /SKILL.md                           this document
GET    /reference/:doc                     api.md, cel.md, examples.md, v6.md, help.md, views.md
```

9 endpoints. All writes through one. Docs served alongside.

---

## Auth

| Token | Prefix | Authority |
|-------|--------|-----------|
| Room token | `room_` | Admin — all scopes, grants, configuration |
| Agent token | `as_` | Own scope + granted scopes |
| View token | `view_` | Read-only — context, poll, wait |

Grant additional scope access:
```
PATCH /rooms/my-room/agents/alice  { "grants": ["bob"] }
```

---

## Reference

- [Architecture](reference/v6.md) — the thesis, axioms, why v6 works the way it does
- [API Reference](reference/api.md) — all endpoints, request/response shapes
- [CEL Reference](reference/cel.md) — expression language, context shape, patterns
- [Views Reference](reference/views.md) — render hints, surface types, dashboard as view query
- [Help Reference](reference/help.md) — help namespace, versioning, overrides, standard library
- [Examples](reference/examples.md) — task queues, voting, private state, grants
