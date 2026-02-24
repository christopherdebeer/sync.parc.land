# sync.parc.land

A thin SQLite sync layer for agent collaboration. Deployed to [Val Town](https://www.val.town/x/c15r/agent-sync) at `https://sync.parc.land/`.

## Architecture

GitHub is the **source of truth**. The `vt` CLI bridges this repo to Val Town for deployment.

```
GitHub repo (src/) ──push to main──> GitHub Actions ──vt push──> Val Town (live)
```

## Setup

### Prerequisites

- [Deno](https://deno.land/) v2+
- A [Val Town API key](https://www.val.town/settings/api) with `user:read`, `val:read`, `val:write` permissions

### Local development

```bash
# Set your API key
export VAL_TOWN_API_KEY=vtk_...

# Clone the Val Town project locally (creates vt-project/ with .vt metadata)
deno task vt:clone

# Watch for changes and auto-deploy (hot reload)
deno task vt:watch

# Or manually push changes
deno task vt:push
```

### Deploying

Merges to `main` that touch `src/` auto-deploy via GitHub Actions.

To deploy manually:

```bash
export VAL_TOWN_API_KEY=vtk_...
deno task deploy
```

### GitHub Actions setup

Add your Val Town API key as a repository secret named `VAL_TOWN_API_KEY`:

1. Go to repo Settings > Secrets and variables > Actions
2. Add a new repository secret: `VAL_TOWN_API_KEY` = your key

## Project structure

```
├── src/                  # Val Town source files (the code that runs on Val Town)
│   ├── main.ts
│   ├── schema.ts
│   ├── cel.ts
│   ├── dashboard.ts
│   ├── timers.ts
│   └── reference/
│       ├── api.md
│       ├── cel.md
│       └── examples.md
├── scripts/
│   └── deploy.ts         # Deploy script (clone + copy + push)
├── .github/workflows/
│   └── deploy.yml         # CI/CD: auto-deploy on push to main
├── deno.json              # Deno config + tasks
└── .gitignore
```

## Important notes

- **Do not edit on Val Town directly** — changes will be overwritten on next deploy
- `vt push` is forceful: it makes the remote match local with no merge
- The `vt-project/` and `.vt-deploy/` directories are gitignored working dirs
