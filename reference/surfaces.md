# Surfaces Reference

Surfaces are declarative UI components driven entirely by room state. Write a
`_dashboard` config to `_shared` state and the dashboard renders a composed
interface — no frontend code needed.

## How it works

Store a `DashboardConfig` object at `state._shared._dashboard`:

```bash
POST /rooms/my-room/actions/_batch_set_state/invoke
Authorization: Bearer room_abc123...
{ "params": { "writes": [
  { "scope": "_shared", "key": "_dashboard", "value": {
    "title": "My App",
    "subtitle": "A surfaces-powered interface",
    "surfaces": [
      { "id": "main", "type": "markdown", "view": "narrative" },
      { "id": "controls", "type": "action-bar", "actions": ["do_thing"] }
    ]
  }}
]}}
```

The dashboard detects `_dashboard` in state and switches from the debug tab
view to rendering the surfaces array. A collapsible debug panel remains
available underneath (unless `hide_debug: true`).

## Dashboard config shape

```typescript
interface DashboardConfig {
  title?: string;          // Header title (replaces "agent-sync")
  subtitle?: string;       // Subtitle (replaces room ID)
  surfaces?: Surface[];    // Ordered list of surfaces to render
  default_tab?: string;    // Default debug tab (agents, state, etc.)
  tabs?: string[];         // Restrict which debug tabs are visible
  hide_debug?: boolean;    // Hide the debug panel entirely
}
```

## Surface types

Every surface has `id` (unique string), `type`, and optional `enabled`
(CEL expression — surface is hidden when false). Most have an optional `label`.

### markdown

Renders a view's string value as Markdown (via marked.js if loaded, otherwise
plain text with line breaks).

```json
{ "id": "story", "type": "markdown", "view": "narrative", "label": "Story" }
```

- `view` — ID of a registered view whose resolved value is a string.

### metric

Large single-value display. Good for KPIs and counters.

```json
{ "id": "score", "type": "metric", "view": "player-score", "label": "Score" }
```

- `view` — ID of a registered view. Displays numbers, strings, booleans
  as large text; objects as collapsed JSON.

### view-grid

Horizontal card row showing multiple view values. Responsive, wraps on mobile.

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

Row of buttons, one per action. Clicking opens a param form (or confirms
directly for no-param actions). Auto-hides actions where `available: false`.

```json
{ "id": "explore", "type": "action-bar", "actions": ["look_around", "try_door", "examine_shelf"], "label": "Explore" }
```

- `actions` — array of action IDs. Renders available actions as green buttons.

### action-form

Single action, always expanded with its parameter form visible. Good for
primary interactions.

```json
{ "id": "chat", "type": "action-form", "action": "send_message", "label": "Say something" }
```

- `action` — single action ID. Shows param inputs inline, sends on Enter.

### action-choice

Mutually exclusive buttons (like multiple-choice). Each button invokes its
action directly (only works for no-param actions).

```json
{ "id": "direction", "type": "action-choice", "actions": ["go_north", "go_south", "go_east"], "label": "Which way?" }
```

- `actions` — array of action IDs. Renders as equal-width buttons in a row.

### feed

Filtered message stream with optional compose input.

```json
{ "id": "chat", "type": "feed", "kinds": ["chat"], "compose": true, "label": "Chat" }
```

- `kinds` — filter messages by `kind` field (e.g., `["chat", "task"]`). Omit for all.
- `compose` — show/hide the compose input. Defaults to `true`.

### watch

Raw state key/value display. Shows specific state entries by scope + key.

```json
{ "id": "inv", "type": "watch", "keys": ["inventory", "equipment"], "label": "Inventory" }
```

- `keys` — array of either strings (shorthand for `_shared` scope) or
  `{ "scope": "...", "key": "..." }` objects.

### section

Container that groups child surfaces. Supports `enabled` for conditional
visibility of entire groups.

```json
{
  "id": "outdoor-section", "type": "section", "label": "Outside",
  "enabled": "state._shared.outside == true",
  "surfaces": [
    { "id": "gather", "type": "action-bar", "actions": ["gather_wood", "explore_path"] },
    { "id": "nav", "type": "action-bar", "actions": ["go_inside"] }
  ]
}
```

- `surfaces` — nested array of any surface types (including other sections).

## Enabled expressions

Any surface can have an `enabled` field containing a CEL-like expression.
When it evaluates to false, the surface (and all children for sections) is
hidden from the UI.

The client-side evaluator supports:

```
state.<scope>.<key> == <value>       # equality (loose: undefined == false)
state.<scope>.<key> != <value>       # inequality
state.<scope>.<key> > <value>        # comparison (numbers)
state.<scope>.<key> < <value>
state.<scope>.<key> >= <value>
state.<scope>.<key> <= <value>
views["<id>"] == <value>             # view value comparison
<expr> && <expr>                     # logical AND
<expr> || <expr>                     # logical OR
```

Values can be: `true`, `false`, `null`, numbers, or quoted strings
(`"value"` or `'value'`).

**Important:** Missing/undefined state keys are treated as falsy. So
`state._shared.has_key == false` returns true when `has_key` doesn't exist.
This lets you gate on discovery flags without initializing them.

**Fail-closed:** Unrecognized expressions evaluate to `false` (surface hidden).
This is intentional — unknown conditions should hide rather than show.

## Design patterns

### Gate state vs display state

Separate state keys used for gating (boolean flags like `door_open`,
`has_key`) from state used for display (narrative text, inventory lists).
Gate state drives `enabled` expressions. Display state drives view content.

```bash
# Gate state — controls what surfaces appear
state._shared.outside = true
state._shared.has_compass = true

# Display state — shown inside surfaces via views
state._shared.narrative = "You step outside into blinding sunlight..."
state._shared.inventory = "dried herbs, iron key"
```

### Additive composition

New surfaces and actions don't modify existing ones. To extend the world,
register new actions, new views, add new surfaces to the `_dashboard` config.
Existing surfaces remain unchanged.

### Locality of reasoning

Each surface gates on simple, local conditions. A surface's `enabled`
expression should reference 1-2 state keys at most. Complex multi-condition
logic belongs in server-side CEL (action `if` expressions), not in surface
visibility.

### Repeatable actions

Actions like `gather_wood` or `stoke_fire` can be invoked multiple times.
Use `increment` in write templates for counters. The action stays visible
as long as its `if` condition holds.

## Worked example: text adventure

A complete interactive fiction game using only state, actions, views, and surfaces.

### State grain

```
at          — location identifier (string)
outside     — location flag (boolean, gates section visibility)
phase       — game phase (string: "room", "outside", "endgame")
door_open   — discovery flag (boolean)
has_key     — item flag (boolean)
narrative   — display text (string, shown via markdown surface)
inventory   — display text (string, shown via watch surface)
wood        — counter (number, incremented by gather_wood)
fire        — counter (number, incremented by stoke_fire)
```

### Action with writes and gating

```json
{
  "id": "unlock_door",
  "description": "Use the iron key on the heavy door",
  "if": "state._shared.has_key == true && state._shared.door_open == false",
  "writes": [
    { "scope": "_shared", "key": "door_open", "value": true },
    { "scope": "_shared", "key": "narrative", "value": "The key turns with a satisfying click..." }
  ]
}
```

### Surfaces config

```json
{
  "title": "The Dark Room",
  "surfaces": [
    { "id": "narrative", "type": "markdown", "view": "narrative" },
    { "id": "status", "type": "view-grid", "views": ["fire-status", "wood-count", "location"] },
    {
      "id": "room-explore", "type": "section", "label": "Explore",
      "enabled": "state._shared.outside == false",
      "surfaces": [
        { "id": "room-actions", "type": "action-bar", "actions": ["look_around", "try_door", "examine_shelf"] },
        { "id": "door-actions", "type": "action-bar", "actions": ["unlock_door", "go_outside"],
          "enabled": "state._shared.tried_door == true" }
      ]
    },
    {
      "id": "outside-explore", "type": "section", "label": "Wilderness",
      "enabled": "state._shared.outside == true",
      "surfaces": [
        { "id": "outside-actions", "type": "action-bar", "actions": ["gather_wood", "explore_path", "go_inside"] }
      ]
    },
    {
      "id": "inventory", "type": "watch", "keys": ["inventory"],
      "label": "Inventory",
      "enabled": "state._shared.has_jar == true || state._shared.has_key == true"
    }
  ]
}
```

Surfaces appear and disappear as the player progresses. No frontend changes
needed — the entire game is driven by state mutations through actions.
