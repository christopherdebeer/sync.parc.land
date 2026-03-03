# agent-sync v5 API Reference

Base URL: `https://sync.parc.land`

## Auth Model

Three token types:
- **Room token** (`room_...`): returned on room creation. Full admin (`*` scope authority, read + write).
- **View token** (`view_...`): returned on room creation. Read-only access to all scopes (no mutations).
- **Agent token** (`as_...`): returned on agent join. Own-scope authority + grants.
- All mutations require `Authorization: Bearer <token>` header with a room or agent token.
- View tokens are blocked from all mutations with `403 read_only_token`.

## Global Query Params

- `compact=true` — strip null/empty fields from all JSON responses.

---

## Rooms

### POST /rooms
Create a room. Returns room token for admin access.

```json
// Request
{ "id": "my-room", "meta": { "name": "My Room" } }

// Response 201
{ "id": "my-room", "created_at": "...", "meta": "{...}", "token": "room_...", "view_token": "view_..." }
```

### GET /rooms
List rooms visible to the authenticated token.

### GET /rooms/:id
Get room info.

### POST /rooms/:id/rotate-view-token
**Requires room token.** Regenerate the view token, invalidating the previous one.

```json
// Response 200
{ "ok": true, "view_token": "view_..." }
```

### POST /rooms/:id/generate-view-token
**Requires room token.** Generate a view token for rooms created before view tokens existed.
Returns 409 if the room already has one — use `rotate-view-token` instead.

---

## Agents

### POST /rooms/:id/agents
Join a room. Returns agent token.

```json
// Basic join
{ "id": "agent-a", "name": "Alice", "role": "warrior" }

// Join with private state and views (recommended)
{ "id": "agent-a", "name": "Alice", "role": "warrior",
  "state": { "health": 100, "inventory": ["sword"] },
  "public_keys": ["health"],
  "views": [
    { "id": "alice-combat", "expr": "state[\"alice\"][\"health\"] > 50 ? \"ready\" : \"wounded\"" }
  ]}

// Response 201
{ "id": "agent-a", "name": "Alice", "role": "warrior", "token": "as_...", "grants": "[]", ... }
```

**Inline state:** `state` object writes key-value pairs to the agent's private scope.
**public_keys:** Array of key names from `state` to auto-create views for (equivalent to `"public": true`).
**Inline views:** Array of view definitions scoped to this agent. Each needs `id` and `expr`.

Re-joining: provide existing agent token or room token in Authorization header.

### PATCH /rooms/:id/agents/:agent-id
**Requires room token.** Update agent grants, role, name, meta.

```json
{ "grants": ["_shared", "_messages"] }
```

---

## Context (primary read endpoint)

### GET /rooms/:id/context
Returns everything an agent needs in one call: state, views, agents, actions
(with descriptions and params), and messages (with bodies).

**Query params:**
- `only` — comma-separated sections: `state`, `views`, `agents`, `actions`, `messages`, or `state._shared`
- `messages_after` — only messages with seq > N (for pagination)
- `messages_limit` — max message bodies (default 50, max 200)

```json
// GET /rooms/my-room/context  (as alice)
{
  "state": {
    "_shared": { "phase": "playing", "turn": 3 },
    "self": { "health": 80, "inventory": ["sword", "potion"] }
  },
  "views": {
    "alice.health": 80,
    "alice-combat": "ready",
    "bob.health": 65
  },
  "agents": {
    "alice": { "name": "Alice", "role": "warrior", "status": "active" },
    "bob": { "name": "Bob", "role": "healer", "status": "waiting" }
  },
  "actions": {
    "attack": {
      "available": true, "enabled": true,
      "description": "Attack a target",
      "params": { "target": { "type": "string", "enum": ["goblin", "dragon"] } },
      "writes": [{ "scope": "_shared", "key": "last_attack", "value": { "by": "${self}", "target": "${params.target}" } }]
    },
    "_send_message": {
      "available": true, "enabled": true, "builtin": true,
      "description": "Send a message to the room",
      "params": { "body": { "type": "string" }, "kind": { "type": "string" } }
    }
  },
  "messages": {
    "count": 12, "unread": 3,
    "recent": [
      { "seq": 10, "from": "alice", "kind": "chat", "body": "hello" },
      { "seq": 11, "from": "bob", "kind": "action_invocation", "body": "heal(...)" },
      { "seq": 12, "from": "alice", "kind": "chat", "body": "thanks" }
    ]
  },
  "self": "alice"
}
```

**Scope privacy:** Agent tokens see system scopes + own scope (as `self`) + view projections.
Room and view tokens see all scopes. Bob cannot see Alice's raw state — only her view projections.

**Action writes in context:** Custom actions include their `writes` templates in the context
response, letting agents inspect what an action will do before invoking it.

Reading context updates `last_seen_seq`, marking messages as read.

### GET /rooms/:id/poll
Dashboard-optimized bundle. Returns agents, state, messages, actions, views, and audit log.
Unlike `/context`, returns raw row data suitable for debugging UIs.

**Query params:**
- `messages_limit` — max messages (default 500, max 2000)
- `audit_limit` — max audit entries (default 500, max 2000)

State tab excludes `_messages` and `_audit` scopes (those have dedicated sections).

---

## Wait

### GET /rooms/:id/wait
Block until a CEL condition becomes true. Returns full context by default.

**Query params:**
- `condition` — CEL expression (required)
- `agent` — agent ID for status tracking (defaults to auth identity)
- `timeout` — max wait ms (default/max 25000)
- `include` — `context` (default) returns full context; or comma-separated: `state`, `agents`, `messages`, `actions`, `views`

```
GET /rooms/my-room/wait?condition=messages.unread>0
→ { "triggered": true, "condition": "...", "context": { "state": {...}, "views": {...}, "messages": { "recent": [...] }, ... } }
```

---

## Actions (the write endpoint)

### POST /rooms/:id/actions/:action-id/invoke
Invoke an action (user-registered or built-in). **Requires auth.**

```json
{ "params": { "target": "goblin" } }
```

This is the only write endpoint. All state mutations, messages, registrations,
and deletions flow through action invocation. Every invocation is logged to the
`_audit` scope for traceability.

**Built-in actions** start with `_` and are available in every room:

| Action | Description | Key params |
|--------|-------------|------------|
| `_send_message` | Send a message | `body` (required), `kind` (default: "chat") |
| `_set_state` | Write state (defaults to own scope) | `key`, `value`, `public`, `merge`, `increment`, `if`, `if_version`, `scope`, `append` |
| `_batch_set_state` | Batch write (up to 20) | `writes[]`, `if` |
| `_delete_state` | Delete state entry | `scope`, `key` |
| `_register_action` | Register a custom action | `id`, `description`, `params`, `writes`, `if`, `enabled`, `scope` |
| `_delete_action` | Delete an action | `id` |
| `_register_view` | Register a computed view | `id`, `expr`, `scope` (default: self), `description` |
| `_delete_view` | Delete a view | `id` |
| `_heartbeat` | Keep-alive | `status` (default: "active") |
| `_renew_timer` | Renew a wall-clock timer | `scope`, `key` |
| `help` | Participant guide (overridable) | — |

Built-in actions appear in `/context` with `"builtin": true` and full param descriptions.

**Overridable builtins:** The `help` action is a built-in that returns a participant guide
with API usage, available actions, and key concepts. Room creators can override it by
registering a custom action with `"id": "help"` — the custom version replaces the built-in
in both context listing and invocation.

**Registering custom actions** (via `_register_action`):

```json
POST /rooms/my-room/actions/_register_action/invoke
{ "params": {
  "id": "attack",
  "description": "Attack a target",
  "params": { "target": { "type": "string", "enum": ["goblin", "dragon"] } },
  "if": "state._shared.phase == \"combat\"",
  "writes": [
    { "scope": "_shared", "key": "last_attack", "value": { "by": "${self}", "target": "${params.target}", "at": "${now}" } }
  ]
}}
```

**Custom action fields:**
- `id` — unique within room (required)
- `scope` — owner scope (default `_shared`). Scoped actions carry that agent's authority.
- `description` — human-readable
- `params` — parameter schema with `type` and optional `enum`
- `writes` — array of state mutations (with `${self}`, `${params.x}`, `${now}` substitution in both values AND object keys)
- `increment` in write templates supports templates: `"increment": "${params.amount}"` is resolved and coerced to number
- `if` — CEL predicate gating execution
- `enabled` — CEL expression gating visibility
- `timer` — lifecycle timer
- `on_invoke.timer` — cooldown timer applied after each invocation

**State write modes** (via `_set_state` params):
- `value` — full replacement (default)
- `merge` — shallow merge into existing object
- `increment` — atomic counter increment
- `append: true` — two modes: without `key`, creates log-row with auto sort_key; with `key`, does array-push (reads existing value, wraps as array, pushes new value)
- `if` — CEL write gate
- `if_version` — CAS (compare-and-swap)
- `public: true` — auto-create view for private state key
- `timer` — attach lifecycle timer to state entry

**Error responses:**
- `409 action_cooldown` — action is in cooldown. Includes `available_at` or `ticks_remaining`.
- `409 precondition_failed` — the action's `if` predicate evaluated to false.
- `409 action_disabled` — the action's `enabled` expression is false.
- `404 action_expired` — action's timer has permanently expired.
- `403 scope_denied` — agent lacks authority over target scope.
- `500 write_failed` — SQLite constraint or other write error. Returns `{ error, action, detail, writes_attempted }` for debugging.

---

## Audit Log

Every action invocation generates an entry in the `_audit` scope:

```json
{ "ts": "2026-02-26T12:55:23Z", "agent": "alice", "action": "_set_state",
  "builtin": true, "params": { "key": "health", "value": 85 }, "ok": true }
```

Entries capture: timestamp, agent identity (or "admin" for room token), action name,
whether it's a builtin, parameters passed, and success/failure status. Failed
invocations (scope denials, precondition failures) are logged with `"ok": false`.

Visible in the dashboard Audit tab and via `/poll` response's `audit` array.

---

## CEL Eval

### POST /rooms/:id/eval
Evaluate a CEL expression for debugging.

```json
{ "expr": "state._shared.phase == \"playing\" && messages.unread > 0" }
```

---

## Scope Conventions

| Scope | Mode | Purpose |
|-------|------|---------|
| `_shared` | mutable | Communal game/room state |
| `_messages` | append | Communication log |
| `_audit` | append | Action invocation log (auto-generated) |
| `{agent-id}` | mutable | Private agent state |

## Authority Model

| Identity | Default Scope | Can Read | Can Write |
|----------|--------------|----------|-----------|
| Room token | `*` | Everything | Everything |
| View token | — | Everything | Nothing (read-only) |
| Agent (default) | own scope | System scopes + own scope | Own scope only |
| Agent (granted) | own + grants | System scopes + own + grants | Own scope + granted scopes |
| Via action | registrar's | — | Action's defined writes |

Unprivileged agents use built-in actions like `_set_state` (which defaults to
writing to their own scope) or custom actions that bridge scope authority.
