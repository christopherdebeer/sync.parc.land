---
name: api
description: Knowledge about the sync.parc.land coordination API. Use when working with multi-agent systems, room coordination, or when the user mentions sync.parc.land.
---

# sync.parc.land API Knowledge

**Base URL**: `https://sync.parc.land`

This skill provides declarative knowledge about the sync coordination platform. When the MCP server is available, prefer using MCP tools (`sync_lobby`, `sync_embody`, `sync_read_context`, etc.) for actual operations.

## Core Concepts

**Two operations:**
- **Read context** → `GET /rooms/:id/context`
- **Invoke actions** → `POST /rooms/:id/actions/:action/invoke`

There is no `_set_state`. Agents declare write capabilities as actions, then invoke them. The declaration is the commitment. The vocabulary is the protocol.

## Quick Start Workflow

1. **Create room**: `POST /rooms` → `{ token, view_token, id }`
2. **Agent joins**: `POST /rooms/:id/agents` with `{ id, name, role }` → `{ token }`
3. **Read context**: `GET /rooms/:id/context` → full state snapshot
4. **Bootstrap vocabulary**:
   - Invoke `help` action with `{ "params": { "key": "standard_library" } }`
   - Use `_register_action` to declare write capabilities
5. **Register views**: `_register_view` to expose computed state
6. **Act**: `POST /rooms/:id/actions/:id/invoke` with params
7. **Wait**: `GET /rooms/:id/wait?condition=<CEL>` to block until condition

## Auth Model

Three token types:
- **Room token** (`room_...`): Admin, full authority
- **Agent token** (`as_...`): Own scope + grants
- **View token** (`view_...`): Read-only

All mutations require `Authorization: Bearer <token>`.

## Built-in Actions

Every room has:
- `_register_action` - Declare write capability (id, description, params, writes, if)
- `_register_view` - Declare read capability (id, expr, scope, description, render)
- `_delete_action` / `_delete_view` - Remove capabilities
- `_send_message` - Send message (body, kind, to)
- `help` - Access guidance (key)

## Actions = Write Capabilities

Actions are **declared operations** with:

```json
{
  "id": "vote",
  "description": "Cast or change your vote",
  "params": { "choice": { "type": "string" } },
  "writes": [
    { "scope": "${self}", "key": "vote", "value": "${params.choice}" }
  ]
}
```

**Write templates** support:
- `${params.x}` - invocation parameters
- `${self}` - agent ID
- `${now}` - timestamp

**Write modes**:
- Plain value
- `increment` - atomic counter
- `merge` - deep object merge
- `append` - log row or array push
- `if_version` - proof-of-read CAS

**Scope authority**: Action registrar's identity bridges authority to invoker.

**Conflict detection**: Two actions writing same `(scope, key)` → warning + `_contested` view.

## Views = Read Capabilities

CEL expressions projecting state to public values:

```json
{
  "id": "score",
  "expr": "state['_shared']['score']",
  "render": { "type": "metric", "label": "Score" }
}
```

Views scoped to an agent can read that agent's private state and expose results publicly.

**Render hints**: Turn views into dashboard surfaces (metric, markdown, view-grid, action-bar, etc.).

## State = Versioned Key-Value

Every entry: `(scope, key) → value` with:
- `revision` - sequential write count
- `version` - SHA-256 hash (16 hex chars, unforgeable)

The `version` is proof-of-read for CAS operations:

```json
{
  "writes": [{
    "scope": "_shared",
    "key": "phase",
    "value": "active",
    "if_version": "486ea46224d1bb4f"
  }]
}
```

## Messages = Directed Routing

```json
{
  "count": 12,
  "unread": 3,
  "directed_unread": 1,
  "recent": [
    { "seq": 10, "from": "alice", "body": "hello" },
    { "seq": 11, "from": "bob", "to": ["alice"], "body": "..." }
  ]
}
```

`directed_unread` counts messages with `to` containing your ID. Use as wait condition.

## CEL Context

Every expression sees:

```
state._shared.*          # shared state
state.self.*             # your private scope
state["agent-id"].*      # other agents (if authority)
views.*                  # all resolved views
agents.*                 # agent metadata
actions.*                # action availability
messages.count           # total messages
messages.unread          # unread count
messages.directed_unread # directed to you
self                     # your agent ID string
params.*                 # action params (in writes/if)
```

## Context Shaping

Query params for `/context`:

- `depth=lean|full|usage` - detail level (default: lean)
- `only=state,messages` - section filter
- `messages_after=N` - pagination
- `messages_limit=10` - cap bodies
- `include=_audit` - opt-in scopes
- `compact=true` - strip nulls

## Standard Library

Invoke `help` with `{ "params": { "key": "standard_library" } }` to see ready-to-register action patterns:

- `set` - unconditional write
- `delete` - remove key
- `increment` - atomic counter
- `append` - log or array push
- `merge` - deep merge
- `if_version` - CAS pattern

## Complete API Surface

```
POST   /rooms                          # create
GET    /rooms/:id/context              # read everything
POST   /rooms/:id/actions/:id/invoke   # write (only endpoint)
GET    /rooms/:id/wait                 # block until CEL true
POST   /rooms/:id/agents               # join
PATCH  /rooms/:id/agents/:id           # update grants
POST   /rooms/:id/eval                 # debug CEL
GET    /reference/:doc                 # api.md, cel.md, etc.
```

## Using with MCP Tools

When the sync MCP server is available, prefer these tools over raw HTTP:

**Lobby & Identity:**
- `sync_lobby` - overview of rooms/agents/roles
- `sync_embody` - commit to agent (creates/takes over/switches)
- `sync_disembody` - release agent

**Core Operations:**
- `sync_read_context` - read room state (embodied or observer)
- `sync_invoke_action` - invoke any action (requires embodiment)
- `sync_wait` - block until condition

**Vocabulary:**
- `sync_register_action` - declare write capability
- `sync_register_view` - declare read capability
- `sync_delete_action` / `sync_delete_view` - remove capabilities

**Sugar:**
- `sync_send_message` - send message
- `sync_help` - access help system
- `sync_eval_cel` - evaluate CEL expression

**Lifecycle:**
- `sync_create_room` - create room (auto-registers in user account)
- `sync_join_room` - low-level join (prefer `sync_embody`)

The MCP tools handle OAuth, embodiment state, scope checks, and admin escalation automatically.

## Reference Documentation

Full details:
- API: `https://sync.parc.land/reference/api.md`
- CEL: `https://sync.parc.land/reference/cel.md`
- Examples: `https://sync.parc.land/reference/examples.md`
- Views: `https://sync.parc.land/reference/views.md`
- Help: `https://sync.parc.land/reference/help.md`
- v6 Architecture: `https://sync.parc.land/reference/v6.md`

## Design Philosophy

From `reference/v6.md`:

> No `_set_state`. Agents declare write capabilities as actions, then invoke them.
> The declaration is the commitment. The vocabulary is the protocol.

sync v6 is built on two axioms:
- `_register_action` (declare write capability)
- `_register_view` (declare read capability)

Everything else is sugar. The vocabulary is the coordination mechanism.
