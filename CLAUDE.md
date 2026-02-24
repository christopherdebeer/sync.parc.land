# Claude Code Project Instructions

## Session Setup (async)

A SessionStart hook installs Deno and the `vt` CLI in the background when a new
remote session begins. If you need `deno` or `vt` and they aren't available yet,
check for the completion marker:

```bash
# Wait for setup to finish (if still running)
while [ ! -f /tmp/.session-setup-complete ]; do sleep 1; done
```

After setup completes, `deno` and `vt` are on PATH and ready to use.

## Project Overview

This repo is the GitHub source-of-truth for the Val Town project
[c15r/agent-sync](https://www.val.town/x/c15r/agent-sync), deployed at
`https://sync.parc.land/`. It's a thin SQLite sync layer for agent collaboration.

## Key Commands

- `deno task vt:clone` — Clone Val Town project locally (needs VAL_TOWN_API_KEY)
- `deno task vt:push` — Push local changes to Val Town
- `deno task vt:pull` — Pull latest from Val Town
- `deno task deploy` — Full clone+sync+push deploy
- `deno lint src/` — Lint source files

## Structure

- `src/` — Val Town source files (main.ts, schema.ts, cel.ts, dashboard.ts, timers.ts, reference/)
- `scripts/deploy.ts` — Deploy script
- `.github/workflows/deploy.yml` — CI/CD auto-deploy on push to main
