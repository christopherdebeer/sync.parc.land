# CLAUDE.md

This is agent-sync, a multi-agent coordination platform at https://sync.parc.land/.

## Source of truth

**This repo is a local clone, not the authoritative source.** The canonical
version lives on Val Town as project `sync` (val ID `93e19588-0ebb-11f1-a6cd-42dde27851f2`)
and is deployed/hosted via the Val Town platform. Use `vt pull` to sync from
upstream, `vt push` to publish changes back to Val Town.

The Val Town runtime provides the SQLite database, frontend TSX transpilation
(via esm.town CDN), and static file serving that this code depends on. See
"Running locally" below for how to decouple from Val Town infrastructure.

## Key architectural fact

The `README.md` is served as the root response (`GET /`) and doubles as the
remote SKILL.md for Claude's skill system. It is fetched at module load time
and served as `text/plain`.

This means README.md must:
- Follow SKILL.md formatting conventions (frontmatter with `name` and `description`, concise workflow-first structure)
- Be self-contained enough for an LLM to use the API without reading reference docs
- Stay under ~4K tokens so it fits comfortably in a context window alongside other skills
- Link to `reference/api.md`, `reference/cel.md`, `reference/examples.md` for deeper detail

When editing README.md, you are editing the skill definition that other Claude
instances will read to learn how to use this platform. Write for that audience.

## v6 architecture (context-first, vocabulary-first)

Two operations: **read context**, **invoke actions**. Two axioms:
`_register_action` (declare write capability), `_register_view` (declare read capability).

- `GET /context` — returns everything (state, views, agents, actions with defs, messages with bodies)
- `POST /actions/:id/invoke` — the only write endpoint (builtin and custom actions)
- `GET /wait` — blocks until condition, returns full context

10 total endpoints. Every write flows through action invocation.
Every invocation is logged to `_audit` scope.

There is no `_set_state`. Agents declare write capabilities as actions, then invoke them.
The standard library (`help({ key: "standard_library" })`) provides ready-to-register
patterns for common operations (set, delete, increment, append, etc.).

## Project structure

```
main.ts          — HTTP router, all endpoint handlers, built-in actions, audit logging
auth.ts          — Token generation, hashing, scope authority checks
cel.ts           — CEL context builder, expression evaluation, view context
schema.ts        — SQLite schema and migrations
timers.ts        — Wall-clock and logical-clock timer lifecycle
mcp/             — MCP server (OAuth 2.1 + WebAuthn + token vault + 16 tools)
frontend/        — React SPA (SSR + hydration: landing, dashboard, docs, auth pages)
README.md        — Skill definition (served at root as SKILL.md)
reference/       — Detailed docs (api.md, cel.md, examples.md, views.md, help.md, v6.md)
docs/            — Essays and design documents
```

## Dashboard tabs

Agents, State, Messages, Actions, Views, Audit, CEL Console.
The Audit tab shows every action invocation with success/failure status.

## Surfaces (views with render hints)

In v6, surfaces are views with a `render` hint — no separate `_dashboard`
config blob required. Register a view with `render: { type: "metric", label: "Score" }`
and the dashboard renders it automatically.

Key files:

- `frontend/types.ts` — Surface type definitions and `DashboardConfig` interface
- `frontend/components/panels/Surfaces.tsx` — Renderer for all 10 surface types
- `frontend/components/Dashboard.tsx` — Renders views with `render` defined,
  falls back to classic tab mode when no surfaces exist
- `reference/views.md` — Views reference including render hints

### Surface types

`markdown`, `metric`, `view-grid`, `view-table`, `action-bar`, `action-form`,
`action-choice`, `feed`, `watch`, `section` (nesting container).

All defined in `types.ts` as a discriminated union on the `type` field.

## Running locally

```
deno task dev
```

This starts a local dev server at `http://localhost:8787` (override with `PORT`
env var). The server uses a local SQLite database at `local/sync.db` (override
with `SYNC_DB_PATH`).

### How it works

Three Val Town dependencies are shimmed without modifying any source files:

1. **SQLite** — `local/sqlite.ts` wraps `deno.land/x/sqlite` (WASM) to match Val Town's
   `sqlite.execute()` / `sqlite.batch()` API. Swapped via `local/import_map.json`.
2. **Frontend transpilation** — `local/dev.ts` uses esbuild to transpile
   TSX/TS on the fly (replaces the esm.town CDN proxy in main.ts:2204-2216).
3. **Static file serving** — `local/dev.ts` serves `frontend/index.html` and
   assets directly (bypasses `backend/index.ts` and its Val Town `serveFile`).

The import map redirects `https://esm.town/v/std/sqlite` → `local/sqlite.ts`
so all 5 files that import it (main.ts, schema.ts, auth.ts, cel.ts, timers.ts)
get the local adapter with zero edits.

### Files

```
local/
  dev.ts            — Hono dev server (frontend transpilation + API delegation)
  sqlite.ts         — Local SQLite adapter (WASM x/sqlite → Val Town API shape)
  import_map.json   — Remaps Val Town imports to local shims
  sync.db           — SQLite database (gitignored, created on first run)
```
