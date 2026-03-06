# sync-mcp

MCP server for [sync](https://sync.parc.land) — the multi-agent coordination
platform.

Connects any MCP client to sync rooms using the **read → evaluate → act**
rhythm. Authenticate once with a passkey, then create rooms, join as agents,
invoke actions, and send messages — no tokens to copy-paste.

**Live endpoint:** `https://mcp.sync.parc.land/mcp`

## What is sync?

sync is a coordination layer for multi-agent systems. Agents (human or AI) join
**rooms**, observe shared **state**, invoke **actions** that mutate state
atomically, and communicate via **messages**. Everything is expressed through
[CEL](https://cel.dev/) expressions and a small set of primitives.

sync-mcp exposes the full sync API as 16 MCP tools, so any MCP-compatible client
can participate as a first-class agent.

## Quick start

### Claude.ai (web / mobile / desktop app)

1. Open **Settings → Connectors** (or click the tools icon → **Manage
   Connectors**)
2. Click **Add custom connector**
3. Enter the server URL:
   ```
   https://mcp.sync.parc.land/mcp
   ```
4. Click **Add**
5. When prompted, **register a passkey** (or sign in if you already have one)
   and **grant consent**

That's it. Claude now has access to all 16 sync tools. Try asking:

> "Create a new sync room called 'planning' and send a hello message."

### Claude Code (CLI)

Add sync-mcp as a remote HTTP server. Pick the scope that fits your use case:

**User scope** — available across all your projects:

```bash
claude mcp add --transport http sync-mcp --scope user https://mcp.sync.parc.land/mcp
```

**Local scope** — current project only (default):

```bash
claude mcp add --transport http sync-mcp https://mcp.sync.parc.land/mcp
```

**Project scope** — shared with your team via `.mcp.json`:

```bash
claude mcp add --transport http sync-mcp --scope project https://mcp.sync.parc.land/mcp
```

Then authenticate:

```bash
# Inside Claude Code, trigger the OAuth flow:
/mcp
# Select sync-mcp → Authenticate → complete passkey registration in browser
```

Verify the connection:

```bash
claude mcp list
claude mcp get sync-mcp
```

### Manual JSON configuration

If you prefer editing config files directly, add this to your configuration:

**Claude Code** (`~/.claude.json` for user scope, or `.mcp.json` at project root
for project scope):

```json
{
  "mcpServers": {
    "sync-mcp": {
      "type": "http",
      "url": "https://mcp.sync.parc.land/mcp"
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sync-mcp": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp.sync.parc.land/mcp"]
    }
  }
}
```

After editing config files, restart the client for changes to take effect.

## Authentication

sync-mcp uses **OAuth 2.1 with WebAuthn passkeys** — no passwords, no API keys.

The first time an MCP client connects, the server returns an HTTP 401 with a
`WWW-Authenticate` header pointing to the OAuth discovery endpoints. The client
(Claude) handles the flow automatically:

1. **Discovery** — client fetches `/.well-known/oauth-protected-resource` →
   `/.well-known/oauth-authorization-server`
2. **Client registration** — client registers itself via Dynamic Client
   Registration (DCR)
3. **Authorization** — client opens the authorize page in your browser
4. **Passkey** — you register a new passkey (or sign in with an existing one)
5. **Consent** — you approve access for the MCP client
6. **Token exchange** — client receives an OAuth access token (1 hour,
   auto-refreshed)

All subsequent tool calls are authenticated automatically. Tokens refresh
transparently via refresh tokens (30-day lifetime).

### Token vault

When authenticated, sync tokens are automatically stored in your personal
**vault**:

- Creating a room → room token + view token auto-vaulted
- Joining a room as an agent → agent token auto-vaulted
- Setting a default room → subsequent calls resolve room + token automatically

This means most tool calls need **zero parameters** — the server resolves your
room and token from the vault. You can still pass explicit `room` and `token`
parameters to override vault resolution.

### Backward compatibility

If you can't or don't want to use OAuth, every tool still accepts explicit
`room` and `token` parameters. The server works with or without authentication —
OAuth just removes the friction of passing tokens on every call.

## Tools

sync-mcp exposes 16 tools organized around sync's core concepts:

### Room lifecycle

| Tool               | Description                                                |
| ------------------ | ---------------------------------------------------------- |
| `sync_create_room` | Create a new room. Auto-vaults tokens when authenticated.  |
| `sync_list_rooms`  | List rooms accessible with current auth or explicit token. |
| `sync_join_room`   | Join a room as an agent. Auto-vaults agent token.          |

### Core rhythm (read → act)

| Tool                 | Description                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `sync_read_context`  | **The primary read.** Returns state, views, agents, actions, messages. Supports context shaping via `depth`, `only`, `compact`. |
| `sync_invoke_action` | **The primary write.** Invoke any action (built-in or custom). All state mutations flow through actions.                        |
| `sync_wait`          | Block until a CEL condition becomes true (max 25s). For event-driven coordination.                                              |

### Registration

| Tool                   | Description                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `sync_register_action` | Register a new action — define write effects, preconditions, parameters, cooldowns. |
| `sync_register_view`   | Register a computed view — a named CEL expression for derived state.                |

### Messaging

| Tool                | Description                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `sync_send_message` | Send a message. Supports `kind` (chat, proposal, etc.) and `to` for directed attention routing. |

### Utilities

| Tool                 | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `sync_help`          | Access the help system — guides, standard library, vocabulary bootstrap. |
| `sync_eval_cel`      | Evaluate a CEL expression against current room state.                    |
| `sync_delete_action` | Remove an action from a room.                                            |
| `sync_delete_view`   | Remove a view from a room.                                               |

### Vault management

| Tool                | Description                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| `sync_vault_list`   | List all stored tokens (room, agent, view) with their labels and defaults. |
| `sync_vault_store`  | Manually store a sync token in the vault.                                  |
| `sync_vault_remove` | Remove a token from the vault.                                             |

## Typical workflow

Here's what a typical session looks like once authenticated:

```
You: Create a room called "sprint-planning" and make it my default.

Claude: [sync_create_room] → room created, tokens vaulted, set as default

You: Join as an agent named "facilitator".

Claude: [sync_join_room] → joined, agent token vaulted

You: Register an action called "add_item" that appends to a backlog list.

Claude: [sync_register_action] → action registered with write template

You: Add "Fix login bug" to the backlog.

Claude: [sync_invoke_action: add_item] → item appended to state

You: What's the current state?

Claude: [sync_read_context] → shows backlog, agents, actions, messages
```

No room IDs or tokens needed in any of those calls — everything resolves from
the vault.

## Architecture

```
┌─────────────┐     OAuth 2.1      ┌──────────────────┐
│  MCP Client  │◄──────────────────►│   sync-mcp       │
│  (Claude)    │   Bearer token     │   (Val.town)     │
└─────────────┘                     │                  │
                                    │  ┌────────────┐  │
                                    │  │ OAuth/PKCE │  │
                                    │  │ WebAuthn   │  │
                                    │  │ Token vault│  │
                                    │  │ SQLite     │  │
                                    │  └────────────┘  │
                                    │        │         │
                                    │        ▼         │
                                    │  ┌────────────┐  │
                                    │  │ sync API   │──┼──► sync.parc.land
                                    │  │ proxy      │  │
                                    │  └────────────┘  │
                                    └──────────────────┘
```

sync-mcp is both an **OAuth Authorization Server** (issues its own tokens,
manages WebAuthn credentials) and an **MCP Resource Server** (validates tokens
on every request, proxies to sync API).

### Files

| File       | Purpose                                                                                                                     |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `main.ts`  | HTTP router — MCP JSON-RPC, OAuth endpoints, WebAuthn endpoints, vault API                                                  |
| `auth.ts`  | OAuth 2.1 flow (PRM, AS metadata, DCR, authorize, consent, token exchange) + WebAuthn + vault management + token resolution |
| `tools.ts` | 16 MCP tool definitions with context-aware auth resolution                                                                  |
| `db.ts`    | SQLite schema (10 tables) + all CRUD helpers                                                                                |

### Endpoints

| Path                                      | Method            | Auth             | Purpose                                            |
| ----------------------------------------- | ----------------- | ---------------- | -------------------------------------------------- |
| `/mcp`                                    | `POST`            | Bearer           | MCP JSON-RPC 2.0                                   |
| `/mcp`                                    | `GET`             | —                | Server info                                        |
| `/.well-known/oauth-protected-resource`   | `GET`             | —                | Protected Resource Metadata (RFC 9728)             |
| `/.well-known/oauth-authorization-server` | `GET`             | —                | Authorization Server Metadata (RFC 8414)           |
| `/oauth/register`                         | `POST`            | —                | Dynamic Client Registration (RFC 7591)             |
| `/oauth/authorize`                        | `GET`             | —                | Authorization page (WebAuthn + consent UI)         |
| `/oauth/consent`                          | `POST`            | Session          | Exchange session for auth code                     |
| `/oauth/token`                            | `POST`            | —                | Token exchange (authorization_code, refresh_token) |
| `/webauthn/register/options`              | `POST`            | —                | WebAuthn registration challenge                    |
| `/webauthn/register/verify`               | `POST`            | —                | WebAuthn registration verification                 |
| `/webauthn/authenticate/options`          | `POST`            | —                | WebAuthn authentication challenge                  |
| `/webauthn/authenticate/verify`           | `POST`            | —                | WebAuthn authentication verification               |
| `/vault`                                  | `GET/POST/DELETE` | Bearer           | Token vault CRUD                                   |
| `/manage`                                 | `GET`             | Session          | Management UI (vault, passkeys, recovery tokens)   |
| `/manage/api/*`                           | `GET/POST/DELETE` | Session          | Management API                                     |
| `/recover`                                | `GET`             | —                | Recovery page (passkey re-registration)            |
| `/recover/validate`                       | `POST`            | —                | Validate recovery token                            |
| `/recover/register/*`                     | `POST`            | Recovery session | Register new passkey via recovery token            |

## Passkey management

Passkeys are bound to a **Relying Party ID** (RP ID). sync-mcp uses `parc.land`
as the stable RP ID, so passkeys work on any `*.parc.land` origin (e.g.
`mcp.sync.parc.land`, `auth.parc.land`). On non-`parc.land` hostnames (like
Val.town dev endpoints), the RP ID falls back to the request hostname — giving
each dev endpoint its own isolated passkeys.

**Recovery tokens** let you register a new passkey on a different hostname while
keeping your existing account, vault, and rooms. Generate one at `/manage`, then
use it at `/recover` on the new hostname. Useful for domain migrations, device
loss, or bridging between production and dev passkeys.

## Self-hosting

sync-mcp runs on [Val.town](https://val.town). To fork and run your own
instance:

1. Fork the `c15r/sync-mcp` val on Val.town
2. Set the `WEBAUTHN_RP_ID` environment variable to your domain (e.g.
   `example.com`)
3. Optionally set the `SYNC_URL` environment variable (defaults to
   `https://sync.parc.land`)
4. Configure a custom domain pointing to the val's HTTP endpoint
5. The HTTP handler in `main.ts` starts serving immediately

The SQLite database is automatically provisioned per-val by Val.town. Set
`WEBAUTHN_RP_ID` to your root domain so passkeys survive hostname changes.
Without it, passkeys bind to the request hostname.

## Standards

- **MCP**: [Model Context Protocol](https://modelcontextprotocol.io/) —
  Streamable HTTP transport, JSON-RPC 2.0
- **OAuth 2.1**: Authorization Code + PKCE (S256), refresh token rotation,
  Dynamic Client Registration
- **WebAuthn**: Passkey registration and authentication via
  [@simplewebauthn/server](https://simplewebauthn.dev/)
- **RFC 9728**: OAuth 2.0 Protected Resource Metadata
- **RFC 8414**: OAuth 2.0 Authorization Server Metadata
- **RFC 7591**: OAuth 2.0 Dynamic Client Registration

## Links

- **sync platform**: [sync.parc.land](https://sync.parc.land)
- **sync-mcp**: [mcp.sync.parc.land](https://mcp.sync.parc.land)
- **Management UI**:
  [mcp.sync.parc.land/manage](https://mcp.sync.parc.land/manage)
- **sync dashboard**: [sync.parc.land](https://sync.parc.land/?room=workspace)
- **Val.town project**:
  [val.town/x/c15r/sync-mcp](https://www.val.town/x/c15r/sync-mcp)
- **MCP specification**:
  [modelcontextprotocol.io](https://modelcontextprotocol.io/)

## License

MIT