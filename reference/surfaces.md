# Surfaces Reference

Surfaces are declarative UI components rendered by the dashboard. In v6, the
canonical way to create surfaces is via **views with render hints** — register a
view with a `render` object and the dashboard renders it automatically.

See [Views Reference](views.md) for the full views + render hints documentation.

## Two mechanisms (backward compatible)

### v6: Views with render hints (recommended)

Register a view with a `render` object:

```
POST /rooms/my-room/actions/_register_view/invoke
{ "params": {
    "id": "score",
    "expr": "state[\"_shared\"][\"score\"]",
    "render": { "type": "metric", "label": "Score" },
    "enabled": "state[\"_shared\"][\"phase\"] == \"active\""
}}
```

The dashboard queries views with `render` defined and renders them as surfaces.
No `_dashboard` config blob needed. `enabled` expressions are evaluated server-side.

### Legacy: `_dashboard` config in state

Existing rooms may use the older pattern of storing a `DashboardConfig` object
at `state._shared._dashboard`. The dashboard detects this and renders the
`surfaces` array. This still works for backward compatibility.

## Surface types

Every surface has `id` (unique string), `type`, and optional `enabled`
(CEL expression — surface is hidden when false). Most have an optional `label`.

### markdown

Renders a view's string value as Markdown.

```json
{ "id": "story", "type": "markdown", "view": "narrative", "label": "Story" }
```

- `view` — ID of a registered view whose resolved value is a string.

### metric

Large single-value display. Good for KPIs and counters.

```json
{ "id": "score", "type": "metric", "view": "player-score", "label": "Score" }
```

- `view` — ID of a registered view.

### view-grid

Horizontal card row showing multiple view values.

```json
{ "id": "stats", "type": "view-grid", "views": ["fire-status", "wood-count", "temperature"], "label": "Status" }
```

- `views` — array of view IDs. Each renders as a card with label + value.

### view-table

Vertical key/value table layout for multiple views.

```json
{ "id": "info", "type": "view-table", "views": ["location", "health", "mana"] }
```

- `views` — array of view IDs. Each renders as a row: label | value.

### action-bar

Row of buttons, one per action. Auto-hides actions where `available: false`.

```json
{ "id": "explore", "type": "action-bar", "actions": ["look_around", "try_door"], "label": "Explore" }
```

- `actions` — array of action IDs.

### action-form

Single action, always expanded with its parameter form visible.

```json
{ "id": "chat", "type": "action-form", "action": "send_message", "label": "Say something" }
```

- `action` — single action ID.

### action-choice

Mutually exclusive buttons (no-param actions only).

```json
{ "id": "direction", "type": "action-choice", "actions": ["go_north", "go_south"], "label": "Which way?" }
```

- `actions` — array of action IDs.

### feed

Filtered message stream with optional compose input.

```json
{ "id": "chat", "type": "feed", "kinds": ["chat"], "compose": true, "label": "Chat" }
```

- `kinds` — filter messages by `kind` field. Omit for all.
- `compose` — show/hide the compose input. Defaults to `true`.

### watch

Raw state key/value display.

```json
{ "id": "inv", "type": "watch", "keys": ["inventory", "equipment"], "label": "Inventory" }
```

- `keys` — array of strings (`_shared` scope) or `{ "scope": "...", "key": "..." }` objects.

### section

Container that groups child surfaces with conditional visibility.

```json
{
  "id": "outdoor-section", "type": "section", "label": "Outside",
  "enabled": "state._shared.outside == true",
  "surfaces": [
    { "id": "gather", "type": "action-bar", "actions": ["gather_wood"] }
  ]
}
```

- `surfaces` — nested array of any surface types.

## Design patterns

See [Surfaces as Substrate](../docs/surfaces-design.md) for the full design
principles: absence is signal, locality of reasoning, additive composition,
gate state vs display state, self-describing components.
