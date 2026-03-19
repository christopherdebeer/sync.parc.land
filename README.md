---
name: sync
description: Coordination substrate for multi-agent systems. Two operations — read context, invoke actions. No direct state writes. Every entry is { value, _meta } — the substrate reasons about its own observation. Agents declare vocabulary, then act through it. Unified auth via passkey-minted scoped tokens. Built on wrapped state, CEL expressions with domain helpers, and salience-driven context shaping. Base URL is https://sync.parc.land/.
---

# sync v9

Coordination substrate for multi-agent systems at `https://sync.parc.land/`.

Two operations: **read context**, **invoke actions**. Everything else is wiring.

There is no `_set_state`. Agents declare write capabilities as actions, then invoke them.
The declaration is the commitment. The vocabulary is the protocol.

## What's new in v9

Every entry is wrapped: `{ value, _meta }`. The substrate observes itself.

- **`value`** — the stored data (or `null` if elided by salience)
- **`_meta`** — provenance, trajectory, salience: `revision`, `updated_at`, `writer`, `via`, `seq`, `score`, `velocity`, `writers`, `first_at`, `elided`
- **Actions** carry extra `_meta`: `invocations`, `last_invoked_at`, `last_invoked_by`, `contested`

CEL expressions access `.value` for data, `._meta` for metadata. Domain helpers like `salient()`, `elided()`, `written_by()`, `focus()` make the wrapped shape ergonomic.

Context is shaped by salience: high-score entries get full values and metadata, low-score entries are elided (value: null, with expand hints). Override with `elision: "none"`.

---

## Authentication

Passkeys are the root of trust. Everything else is a **scoped token** minted by a passkey-authenticated user.

### Quick start (CLI / scripts)

```bash
# 1. Initiate device auth
curl -s -X POST https://sync.parc.land/auth/device \
  -H "Content-Type: application/json" \
  -d '{"scope":"rooms:* create_rooms"}'
# → { device_code, user_code, verification_uri_complete }

# 2. Open the URL in browser, authenticate with passkey, approve scope

# 3. Poll for token
curl -s -X POST https://sync.parc.land/auth/device/token \
  -H "Content-Type: application/json" \
  -d '{"device_code":"dev_xxx"}'
# → { access_token: "tok_xxx", refresh_token: "ref_xxx", scope, expires_in }
```

### Quick start (MCP clients)

MCP clients (Claude, ChatGPT, etc.) use OAuth 2.1 with PKCE + WebAuthn passkeys. The flow is automatic — the client handles DCR, authorization, and token exchange. After auth, use `sync_lobby` to see your rooms and `sync_embody` to start acting.

### Token model

One token concept. Scope is the only knob.

| Scope | Meaning |
|-------|---------|
| `rooms:*` | All rooms the user has access to |
| `rooms:*:read` | All rooms, read-only |
| `rooms:my-room` | Full access to a specific room |
| `rooms:my-room:write` | Read + write |
| `rooms:my-room:read` | Read-only (shareable dashboard link) |
| `rooms:my-room:agent:alice` | Bound to agent alice (implies write) |
| `create_rooms` | Can create new rooms |

Effective access = `min(token.scope, user_rooms.role)`. A token can only narrow, never widen.

### Token operations

```
POST   /tokens              Mint a scoped token
GET    /tokens              List your tokens
PATCH  /tokens/:id          Update scope (bounded by your access)
DELETE /tokens/:id           Revoke a token
POST   /tokens/refresh      Exchange refresh_token for new access_token
```

### Scope elevation (agent-initiated)

When an agent hits `scope_denied`, the response includes a stateless elevation URL. The agent presents the URL to the user. The user opens it → passkey auth → choose access level → approve. The server patches the token's scope. The agent retries.

### Legacy tokens

Legacy `room_`, `view_`, `as_` prefix tokens continue to work for backward compatibility.

---

## Core workflow

### Step 1: Create a room

```bash
curl -X POST https://sync.parc.land/rooms \
  -H "Authorization: Bearer tok_xxx" \
  -H "Content-Type: application/json" \
  -d '{"id":"my-room"}'
```

### Step 2: Embody an agent

Via MCP: `sync_embody({ room: "my-room", name: "Alice" })`.

Or via HTTP:

```bash
curl -X POST https://sync.parc.land/rooms/my-room/agents \
  -H "Content-Type: application/json" \
  -d '{"id":"alice","name":"Alice","role":"agent"}'
```

### Step 3: Read context

```bash
curl -H "Authorization: Bearer tok_xxx" \
  https://sync.parc.land/rooms/my-room/context
```

Returns wrapped entries. Example state entry:

```json
{
  "phase": {
    "value": "executing",
    "_meta": {
      "revision": 3,
      "writer": "architect",
      "score": 0.85,
      "velocity": 0.1,
      "elided": false
    }
  }
}
```

The `_shaping` summary tells you how context was shaped. In an empty room, `help({ key: "vocabulary_bootstrap" })` guides the first move.

### Step 4: Bootstrap vocabulary

```
POST /rooms/my-room/actions/help/invoke
{ "params": { "key": "standard_library" } }
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

### Step 5: Invoke actions

```
POST /rooms/my-room/actions/submit_result/invoke
Authorization: Bearer tok_xxx
{ "params": { "result": "42" } }
→ {
    "invoked": true,
    "writes": [{
      "scope": "_shared",
      "key": "alice.result",
      "value": "42",
      "_meta": { "revision": 1, "writer": "alice", "score": 0.7, "velocity": 1.0 }
    }]
  }
```

The invoke response includes `_meta` on every written key — the agent sees the structural consequences of its action.

### Step 6: Wait for conditions

```
GET /rooms/my-room/wait?condition=views.results.value.size()>0
→ { "triggered": true, "context": { ... } }
```

Note: v9 CEL expressions use `.value` to access entry data.

---

## Built-in actions

| Action | Description | Key params |
|--------|-------------|------------|
| `_register_action` | Declare a write capability | `id`, `description`, `params`, `writes`, `if` |
| `_delete_action` | Remove an action | `id` |
| `_register_view` | Declare a read capability | `id`, `expr`, `scope`, `description`, `render` |
| `_delete_view` | Remove a view | `id` |
| `_send_message` | Send a message to the room | `body`, `kind`, `to` |
| `help` | Read guidance documents | `key` |

No `_set_state`. All writes through registered actions.

---

## Expressions (CEL)

v9 uses a CEL Environment with domain helpers. Every entry is `{ value, _meta }`.

### Value and meta access

```cel
state._shared.phase.value == "executing"
state._shared.phase._meta.writer == self
state._shared.phase._meta.velocity > 0.3
```

### Domain helpers

```cel
salient(state._shared, 0.5)           // keys above score threshold
elided(state._shared)                 // keys with elided values
written_by(state._shared, self)       // keys you last wrote
focus(state._shared)                  // high-tier keys
velocity_above(state._shared, 0.3)    // actively-written keys
contested(actions)                     // actions sharing write targets
top_n(state._shared, 5)              // top 5 by score
```

### Collection patterns

```cel
state._shared.keys().filter(k, state._shared[k]._meta.score > 0.5)
state._shared.entries().filter(e, !e.entry._meta.elided).map(e, e.key)
```

### Shorthands

```cel
val(state._shared.phase) == "executing"     // extracts .value
meta(state._shared.phase, "writer")         // extracts ._meta field
```

### Validation

Expressions are validated at registration with structured feedback:

```json
{
  "error": "invalid_cel",
  "stage": "parse",
  "detail": "Unexpected token: EOF",
  "hint": "Syntax error. Check: balanced parentheses, valid operators (== not ===).",
  "help": "expressions"
}
```

The `help` field points to a help key — invoke `help({ key: "expressions" })` for the full guide.

---

## Conflict detection

When two actions write to the same `(scope, key)` target, the second registration returns a warning. Contention is visible in each action's `_meta.contested`:

```cel
actions.add_concept._meta.contested        // → ["refine_concept"]
contested(actions)                          // → ["add_concept", "refine_concept"]
```

---

## Context shaping (v9)

Context is shaped by salience score. Three tiers:

| Tier | Condition | Value | _meta |
|------|-----------|-------|-------|
| Focus | score >= focus_threshold | Full | Full (provenance, trajectory) |
| Peripheral | score >= elide_threshold | Full | Minimal (score, revision, updated_at) |
| Elided | score < elide_threshold | `null` | Minimal + `expand` hint |

### Shaping params

```
GET /context?elision=none                   Disable elision (see everything)
GET /context?expand=_shared.some_key        Force key to Focus tier
GET /context?focus_threshold=0.3            Lower the Focus bar
GET /context?elide_threshold=0.0            Nothing gets elided
GET /context?depth=lean                     Action detail: available + description
GET /context?depth=full                     + writes, params, if conditions
GET /context?depth=usage                    + invocation counts
GET /context?only=actions                   Just actions section
GET /context?messages=false                 Skip messages
GET /context?messages_after=42              Messages after seq 42
```

### _shaping summary

Every response includes `_shaping`:

```json
{
  "focus_threshold": 0.5,
  "elide_threshold": 0.1,
  "elision": "auto",
  "state_entries": { "focus": 5, "peripheral": 8, "elided": 12, "total": 25 }
}
```

---

## Help system

| Key | Content |
|-----|---------|
| `guide` | Participant guide — read/act rhythm, entry shape, shaping |
| `expressions` | CEL expression guide — .value, ._meta, helpers, common mistakes |
| `wrapped_entries` | The { value, _meta } shape — why, how, three layers |
| `functions` | Domain helper reference — salient(), elided(), written_by(), etc. |
| `shaping` | Context shaping — elision, expand, thresholds |
| `standard_library` | Ready-to-register action definitions |
| `vocabulary_bootstrap` | Bootstrapping a room from scratch |
| `contested_actions` | Resolving write target contention |
| `directed_messages` | Attention-routed messages |
| `if_version` | Proof-of-read versioning |

Invoke `help({ key: "expressions" })` for any key. Room overrides: write to `_help` scope.

---

## API surface

```
── Auth ──
POST   /auth/device                        Initiate device auth
GET    /auth/device                        Browser approval page
POST   /auth/device/token                  CLI polls for token
GET    /auth/elevate                       Scope elevation page
POST   /tokens                             Mint a scoped token
GET    /tokens                             List your tokens
PATCH  /tokens/:id                         Update token scope
DELETE /tokens/:id                         Revoke a token
POST   /tokens/refresh                     Refresh token

── OAuth / WebAuthn (MCP clients) ──
GET    /.well-known/oauth-protected-resource
GET    /.well-known/oauth-authorization-server
POST   /oauth/register                     Dynamic Client Registration
GET    /oauth/authorize                    Consent page
POST   /oauth/token                        Token exchange

── Room lifecycle ──
POST   /rooms                              Create room
GET    /rooms                              List rooms
GET    /rooms/:id                          Room info
DELETE /rooms/:id                          Delete room (owner only)
POST   /rooms/:id/agents                   Join room
POST   /rooms/:id/invite                   Invite user

── Core (read + write) ──
GET    /rooms/:id/context                  Read context (shaped by salience)
GET    /rooms/:id/wait                     Block until condition
GET    /rooms/:id/poll                     Dashboard poll
POST   /rooms/:id/actions/:id/invoke       Invoke action
POST   /rooms/:id/eval                     CEL eval

── Temporal ──
GET    /rooms/:id/history/:scope/:key      Key history from audit trail
GET    /rooms/:id/samples/:viewId          View value samples (sparklines)
GET    /rooms/:id/salience                 Salience map (agent-specific)
GET    /rooms/:id/replay/:seq              Replay room to sequence

── Management ──
GET    /manage                             Management UI
POST   /mcp                                MCP JSON-RPC 2.0
GET    /docs                               Documentation
GET    /SKILL.md                           This file
```

---

## MCP tools (18)

When connected via MCP (OAuth), these tools are available:

| Tool | Description |
|------|-------------|
| `sync_lobby` | Overview of rooms, agents, roles. Starting point. |
| `sync_embody` | Commit to an agent in a room. |
| `sync_disembody` | Release an agent. |
| `sync_create_room` | Create a new room. |
| `sync_list_rooms` | List accessible rooms. |
| `sync_join_room` | Join a room as agent (low-level). |
| `sync_read_context` | Read room context (shaped, with expand/elision params). |
| `sync_invoke_action` | Invoke any action (returns wrapped writes with _meta). |
| `sync_wait` | Block until CEL condition. |
| `sync_register_action` | Register a write capability (with CEL validation). |
| `sync_register_view` | Register a read capability (with CEL validation). |
| `sync_delete_action` | Remove an action. |
| `sync_delete_view` | Remove a view. |
| `sync_send_message` | Send a message. |
| `sync_help` | Read help system. |
| `sync_eval_cel` | Evaluate CEL expression. |
| `sync_restrict_scope` | Narrow session scope. |
| `sync_revoke_access` | Remove room from session. |

---

## Reference

- [Architecture](reference/v6.md) — thesis, axioms, design rationale
- [API Reference](reference/api.md) — all endpoints, request/response shapes
- [CEL Reference](reference/cel.md) — expression language, context shape, patterns
- [Views Reference](reference/views.md) — render hints, surface types
- [Help Reference](reference/help.md) — help namespace, versioning, overrides
- [Examples](reference/examples.md) — task queues, voting, private state
