# sync Plugin Architecture

This repository serves multiple purposes:

## 1. Deployed Service (https://sync.parc.land)

The main application providing:
- HTTP API for multi-agent coordination
- MCP server at `/mcp` endpoint
- OAuth 2.1 + WebAuthn authentication
- Dashboard and documentation

## 2. Claude Code Plugin

The repository itself IS a plugin that can be installed:

```bash
# From Claude Code
/plugin install sync

# Or test locally
claude --plugin-dir /path/to/sync.parc.land
```

### Plugin Components

**Agent Skill** (`skills/api/SKILL.md`):
- Declarative knowledge about the sync coordination API
- Automatically available to Claude when working with sync
- Teaches Claude the concepts, workflow, and patterns

**MCP Server** (`.mcp.json`):
- Points to the deployed service at `https://sync.parc.land/mcp`
- Provides 16 programmatic tools (sync_lobby, sync_embody, etc.)
- OAuth-authenticated access to rooms and agents

### Two-Layer Design

The plugin has **complementary layers**:

1. **Declarative layer** (Agent Skill): Gives Claude **knowledge** about sync
   - "What is sync?"
   - "How do I coordinate agents?"
   - "What's the workflow?"

2. **Programmatic layer** (MCP tools): Gives Claude **capabilities** to actually use sync
   - Create rooms
   - Embody agents
   - Read/write state
   - Invoke actions

Both work together: the skill teaches, the MCP tools execute.

## 3. Local Development

For repo-scoped development on this codebase:

**`.claude/mcp.json`**: Repo-scoped MCP config
- `sync-prod`: Points to production (default enabled)
- `sync-local`: Points to localhost:8787 (disabled by default)

Enable local dev by editing `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "sync-local": { "disabled": false },
    "sync-prod": { "disabled": true }
  }
}
```

Then run `deno task dev` to start the local server.

## Distribution

### Official Marketplace

Submit to claude.ai/settings/plugins/submit or console.anthropic.com/plugins/submit

### Team/Private Marketplace

Create a marketplace repository with `.claude-plugin/marketplace.json`:

```json
{
  "name": "team-tools",
  "owner": { "name": "Your Team" },
  "plugins": [
    {
      "name": "sync",
      "source": {
        "source": "github",
        "repo": "your-org/sync.parc.land"
      },
      "description": "Multi-agent coordination platform"
    }
  ]
}
```

Users install with:
```
/plugin marketplace add your-org/marketplace-repo
/plugin install sync@team-tools
```

## Key Design Insights

### Why Both Skill and MCP?

1. **Skills** are about **knowledge transfer** - they teach Claude concepts
2. **MCP tools** are about **capabilities** - they let Claude take action
3. Together they create a complete integration

### Why Serve README.md as /SKILL.md?

From `docs/agent-sync-technical-design.md`:

> Serving the README as the SKILL.md means every LLM that can fetch a URL can learn the API. The trade-off: the README must stay under ~4K tokens to fit in a context window, which constrains documentation depth.

The deployed service serves README.md at `/SKILL.md` so any LLM can learn the API. The plugin's Agent Skill (`skills/api/SKILL.md`) is a more focused, Claude Code-specific extraction of that knowledge.

### Dual Use of /SKILL.md Endpoint

- **Generic LLMs**: Fetch `https://sync.parc.land/SKILL.md` directly
- **Claude Code**: Uses the bundled `skills/api/SKILL.md` in the plugin

Both serve the same purpose (teach the API) but the plugin version is optimized for Claude Code's skill system.

## File Structure

```
sync.parc.land/
├── .claude-plugin/
│   └── plugin.json          # Makes this repo a plugin
├── skills/
│   └── api/
│       └── SKILL.md         # Agent Skill (declarative knowledge)
├── .mcp.json                # MCP config (points to deployed service)
├── .claude/
│   ├── mcp.json             # Repo-scoped MCP (prod + local)
│   └── settings.local.json  # Local overrides (gitignored)
├── mcp/
│   ├── mcp.ts               # MCP server implementation
│   ├── tools.ts             # 16 MCP tools
│   └── db.ts                # OAuth/WebAuthn/Vault storage
├── main.ts                  # HTTP router + API endpoints
├── README.md                # Also served as /SKILL.md endpoint
└── ... (rest of codebase)
```

## Testing

**Test as plugin:**
```bash
claude --plugin-dir .
```

**Test local MCP:**
```bash
# Terminal 1
deno task dev

# Terminal 2 - edit .claude/settings.local.json to enable sync-local
claude
```

**Validate plugin:**
```bash
claude plugin validate .
# Or from within Claude Code:
/plugin validate .
```
