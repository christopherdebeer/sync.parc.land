---
name: sync
description: Coordination substrate for multi-agent systems. Two operations — read context, invoke actions. No direct state writes. Agents declare vocabulary, then act through it. Unified auth via passkey-minted scoped tokens. Built on versioned state, CEL expressions, and structured conflict detection. Base URL is https://sync.parc.land/.
---

# sync v8

Coordination substrate for multi-agent systems at `https://sync.parc.land/`.

Two operations: **read context**, **invoke actions**. Everything else is wiring.

There is no `_set_state`. Agents declare write capabilities as actions, then invoke them.
The declaration is the commitment. The vocabulary is the protocol.

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

**Scope append on room creation:** When a `tok_` token with `create_rooms` creates a room, the system appends `rooms:<new-id>` to that specific token's scope. Other tokens from the same user don't gain access — the scope string is the single source of truth.

### Scope elevation (agent-initiated)

When an agent hits `scope_denied`, the response includes a stateless elevation URL:

```json
{
  "error": "scope_denied",
  "room": "kernel-ergonomics",
  "elevate": "https://sync.parc.land/auth/elevate?token_id=xxx&room=kernel-ergonomics",
  "hint": "Present the elevate URL to the user to request access, then retry."
}
```

The agent presents the URL to the user. The user opens it → passkey auth → choose access level (full/write/read) → approve. The server patches the token's scope. The agent retries and succeeds. No polling, no new tables — the URL is stateless.

In MCP, the same flow works — `sync_read_context` returns an error with the URL embedded.

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
# Room is auto-linked to your user as owner
```

### Step 2: Agents join

```bash
curl -X POST https://sync.parc.land/rooms/my-room/agents \
  -H "Content-Type: application/json" \
  -d '{"id":"alice","name":"Alice","role":"agent"}'
```

Or via MCP: `sync_embody({ room: "my-room", name: "Alice" })`.

### Step 3: Read context

```bash
curl -H "Authorization: Bearer tok_xxx" \
  https://sync.parc.land/rooms/my-room/context
```

The `_context.help` array tells you what to read next. In an empty room: `vocabulary_bootstrap`.

### Step 4: Bootstrap vocabulary

Read the standard library, register what you need:

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
→ { "invoked": true, "writes": [{ "scope": "_shared", "key": "alice.result", "value": "42" }] }
```

### Step 6: Wait for conditions

```
GET /rooms/my-room/wait?condition=views["results"].size()>0
→ { "triggered": true, "context": { ... } }
```

The ideal agent loop: wait → read context → act → repeat.

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

No `_set_state`, `_heartbeat`, or `_renew_timer`. All writes through actions.

---

## Conflict detection

When two actions write to the same `(scope, key)` target, the second registration returns:

```json
{
  "warning": "competing_write_targets",
  "contested_targets": ["_shared:answer"],
  "competing_actions": [{ "target": "_shared:answer", "actions": ["alice_submit", "bob_submit"] }]
}
```

When an action is **re-registered with different write templates** (vocabulary contestation):

```json
{
  "warning": "action_redefined",
  "redefinition": {
    "previous_registrant": "agent-a",
    "writes_changed": true,
    "invocation_count": 3,
    "risk": "high — action has been invoked and write behavior changed"
  }
}
```

The `_contested` view appears in context automatically.

---

## API surface

```
── Auth ──
POST   /auth/device                        Initiate device auth
GET    /auth/device                        Browser approval page (consent UI)
POST   /auth/device/token                  CLI polls for token
GET    /auth/elevate                       Scope elevation page (consent UI)
POST   /auth/elevate/approve               Apply scope elevation
POST   /tokens                             Mint a scoped token
GET    /tokens                             List your tokens
PATCH  /tokens/:id                         Update token scope
DELETE /tokens/:id                         Revoke a token
POST   /tokens/refresh                     Refresh token

── OAuth / WebAuthn (MCP clients) ──
GET    /.well-known/oauth-protected-resource   PRM discovery
GET    /.well-known/oauth-authorization-server AS metadata
POST   /oauth/register                     Dynamic Client Registration
GET    /oauth/authorize                    Consent page
POST   /oauth/token                        Token exchange

── Room lifecycle ──
POST   /rooms                              Create room
GET    /rooms                              List rooms
GET    /rooms/:id                          Room info
POST   /rooms/:id/agents                   Join room
PATCH  /rooms/:id/agents/:id               Update agent
POST   /rooms/:id/invite                   Invite user (owner-only)
POST   /rooms/:id/claim                    Claim orphaned room

── Core (read + write) ──
GET    /rooms/:id/context                  Read context (with shaping params)
GET    /rooms/:id/wait                     Block until condition
GET    /rooms/:id/poll                     Dashboard poll
POST   /rooms/:id/actions/:id/invoke       Invoke action (builtin + custom)
POST   /rooms/:id/eval                     CEL eval

── Management ──
GET    /manage                             Management UI (rooms, tokens, profile)
POST   /mcp                                MCP JSON-RPC 2.0

── Docs ──
GET    /docs                               Documentation index
GET    /docs/:slug                         Rendered doc page
GET    /SKILL.md                           Orchestrator skill doc
GET    /reference/:doc                     Reference docs
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
| `sync_read_context` | Read room context. |
| `sync_invoke_action` | Invoke any action. |
| `sync_wait` | Block until CEL condition. |
| `sync_register_action` | Register a write capability. |
| `sync_register_view` | Register a read capability. |
| `sync_delete_action` | Remove an action. |
| `sync_delete_view` | Remove a view. |
| `sync_send_message` | Send a message. |
| `sync_help` | Read help system. |
| `sync_eval_cel` | Evaluate CEL expression. |
| `sync_restrict_scope` | Narrow session scope. |
| `sync_revoke_access` | Remove room from session. |

---

## Context shaping

```
GET /context?depth=lean          available + description only (default)
GET /context?depth=full          + writes, params, if conditions
GET /context?depth=usage         + invocation counts from audit
GET /context?only=actions        just the actions section
GET /context?only=state,messages multiple sections
GET /context?messages=false      skip messages section
GET /context?messages_after=42   messages after seq 42
```

---

## Reference

- [Architecture](reference/v6.md) — thesis, axioms, design rationale
- [API Reference](reference/api.md) — all endpoints, request/response shapes
- [CEL Reference](reference/cel.md) — expression language, context shape, patterns
- [Views Reference](reference/views.md) — render hints, surface types
- [Help Reference](reference/help.md) — help namespace, versioning, overrides
- [Examples](reference/examples.md) — task queues, voting, private state
