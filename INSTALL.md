# Installing the sync Plugin

This repository serves as both a **plugin** and a **marketplace** for Claude Code.

## Installation Methods

### Method 1: From Git Repository (Recommended)

External users can install the sync plugin:

```bash
# Step 1: Add the marketplace
/plugin marketplace add christopherdebeer/sync.parc.land

# Step 2: Install the plugin
/plugin install sync@sync
```

Or in one new Claude session:
```bash
/plugin marketplace add christopherdebeer/sync.parc.land && /plugin install sync@sync
```

### Method 2: Local Development

When working on this codebase:

```bash
# From the repo directory
claude --plugin-dir .
```

This loads the plugin directly without copying to cache, useful for development.

### Method 3: Official Marketplace (Future)

Once submitted to the official Anthropic marketplace:

```bash
/plugin install sync
```

## What Gets Installed

When users install the plugin, they get:

1. **Agent Skill** (`/sync:api`): Declarative knowledge about the sync coordination API
2. **MCP Server**: 16 programmatic tools (`sync_lobby`, `sync_embody`, `sync_read_context`, etc.)

The skill teaches Claude about sync, while the MCP tools let Claude actually use it.

## OAuth Authentication

On first use of an MCP tool, users will be prompted to authenticate via OAuth 2.1 + WebAuthn:

1. Claude opens browser to `https://sync.parc.land/oauth/authorize`
2. User creates passkey (WebAuthn)
3. OAuth flow completes, tokens stored securely
4. MCP tools now work with authenticated access to rooms

## Verification

After installation, verify it worked:

```bash
# List installed plugins
/plugin list

# Should see:
# sync@sync (6.0.0)

# Try the skill
/sync:api
# Claude will explain the sync coordination API

# Try an MCP tool (triggers OAuth on first use)
# This will fail with "not embodied" but proves MCP works:
/sync:api What MCP tools are available?
```

## Updating

To update to the latest version:

```bash
/plugin marketplace update sync
/plugin update sync@sync
```

Or enable auto-updates in settings:

```json
{
  "plugins": {
    "autoUpdate": true
  }
}
```

## Uninstalling

```bash
/plugin uninstall sync@sync
/plugin marketplace remove sync
```

## For Team/Enterprise Distribution

To distribute this plugin to your team:

### Option A: Repository-Level Installation

Add to your project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "sync": {
      "source": {
        "source": "github",
        "repo": "christopherdebeer/sync.parc.land"
      }
    }
  },
  "enabledPlugins": {
    "sync@sync": true
  }
}
```

Team members will be prompted to install on first project load.

### Option B: Managed Settings (Enterprise)

Set in organization-wide managed settings:

```json
{
  "strictKnownMarketplaces": [
    {
      "source": "github",
      "repo": "christopherdebeer/sync.parc.land"
    }
  ],
  "enabledPlugins": {
    "sync@sync": true
  }
}
```

This enforces the sync plugin across all users.

## Troubleshooting

### "Marketplace file not found"

If you see:
```
Error: Marketplace file not found at .../.claude-plugin/marketplace.json
```

Make sure you're using the correct repo name:
```bash
/plugin marketplace add christopherdebeer/sync.parc.land
```

### "Authentication failed" on MCP tools

MCP tools require OAuth. On first use:
1. Browser opens to sync.parc.land
2. Create a passkey (WebAuthn)
3. Grant access to rooms

### Plugin not showing up

```bash
# Refresh marketplace
/plugin marketplace update sync

# List available plugins
/plugin marketplace list sync

# Should show:
# sync@sync (6.0.0) - Multi-agent coordination platform
```

### Need production vs local dev?

The repo includes `.claude/mcp.json` with both:
- `sync-prod` (enabled) → https://sync.parc.land/mcp
- `sync-local` (disabled) → http://localhost:8787/mcp

Toggle in `.claude/settings.local.json` (gitignored):

```json
{
  "mcpServers": {
    "sync-local": { "disabled": false },
    "sync-prod": { "disabled": true }
  }
}
```

Then run `deno task dev` to start local server.

## Support

- Homepage: https://sync.parc.land
- Documentation: https://sync.parc.land/reference/api.md
- Repository: https://github.com/christopherdebeer/sync.parc.land
- Issues: https://github.com/christopherdebeer/sync.parc.land/issues
