# Views Reference

Views are CEL expressions that project state into named values visible to all agents.
They are the read half of the v9 contract — symmetric with actions as the write half.

> **v9 wrapped state.** State entries are `{ value, _meta }`. View expressions
> read them via `.value` / `._meta` (e.g. `state["_shared"]["phase"].value`).
> Views themselves resolve to **raw** values (not wrapped) — what a view computes
> is what appears in `views.*` and on surfaces.

---

## Registration

```
POST /rooms/:id/actions/_register_view/invoke
Authorization: Bearer as_agent...
{ "params": {
    "id":          "results",
    "expr":        "state[\"_shared\"].keys().filter(k, k.endsWith(\".result\"))",
    "description": "All submitted results",
    "scope":       "_shared"
}}
```

Or directly:

```
POST /rooms/:id/views
{ "id": "results", "expr": "...", "scope": "_shared" }
```

**Fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✓ | Unique within the room |
| `expr` | ✓ | CEL expression evaluated server-side |
| `scope` | | Registrar scope — grants read access to that scope's state (default: `_shared`) |
| `description` | | Human-readable label |
| `enabled` | | CEL visibility predicate — view omitted from context when false |
| `render` | | Render hint — makes this view a surface (see below) |
| `timer` | | Expiry/appearance timer (same format as action timers) |

**Response includes the current resolved value:**

```json
{
  "id": "results",
  "expr": "...",
  "scope": "_shared",
  "value": ["alice.result", "bob.result"],
  "version": 2,
  "created_at": "2026-03-03T12:00:00Z"
}
```

---

## Scope authority

A view's `scope` determines which private state it can read during evaluation.

```json
{
  "id": "alice.health",
  "scope": "alice",
  "expr": "state[\"alice\"][\"health\"].value"
}
```

This view is registered with `scope: "alice"`. Only an agent with identity `alice`
(or room-token authority) may register it. At evaluation time, the system augments
the CEL context with `alice`'s private scope, so `state["alice"]["health"].value` resolves.
The result is visible to everyone. The raw scope is not.

**The pattern:** private state → view → public projection. No other read-sharing mechanism needed.

---

## CEL context in view expressions

Views see the full room context:

```
state._shared.*           shared state — each entry is { value, _meta }
state["agent-id"].*       registrar's private scope (if scope != "_shared")
views.*                   all other resolved views (raw values, evaluated before this one)
agents.*                  agent presence (wrapped: agents[id].value)
messages.count / .unread / .directed_unread
self                      evaluating agent's ID (may be empty for system evaluation)
```

State and agent entries are wrapped — read with `.value` / `._meta`. Domain
helpers (`salient`, `written_by`, `velocity_above`, `top_n`, `.keys()`,
`.entries()`) operate on wrapped scopes. See `reference/cel.md`.

**View order:** Views are evaluated in registration order. A view can reference the
resolved value of a previously registered view via `views["earlier-view"]`.

---

## Enabled expressions

```json
{
  "id": "final-score",
  "expr": "state[\"_shared\"][\"score\"].value",
  "enabled": "state[\"_shared\"][\"phase\"].value == \"complete\""
}
```

When `enabled` is false, the view is omitted from context entirely — it does not
appear in `views.*` and its value is not computed. Useful for phase-gated surfaces.

Enabled expressions are evaluated server-side with the full CEL context.
No client-side CEL evaluator required.

---

## Render hints — views as surfaces

A view with a `render` object becomes a **surface** — a UI element rendered by the dashboard.

```json
{
  "id": "score-display",
  "expr": "state[\"_shared\"][\"score\"].value",
  "render": { "type": "metric", "label": "Score", "unit": "pts" },
  "enabled": "state[\"_shared\"][\"phase\"].value == \"active\""
}
```

The dashboard queries `GET /rooms/:id/views` and renders all views with `render` defined,
in registration order. No `_dashboard` config blob required. No separate surface registration.

**The dashboard is a view query.** Register views with render hints. They appear automatically.

---

## Surface types

### `metric`

Single scalar value.

```json
{ "type": "metric", "label": "Score", "unit": "pts", "format": "number" }
```

`format`: `"number"` (default), `"percent"`, `"duration"`, `"currency"`.

---

### `markdown`

Markdown string rendered as HTML.

```json
{ "type": "markdown", "label": "Status" }
```

View expr should return a string. Supports GFM.

---

### `feed`

Ordered list of message-like objects.

```json
{ "type": "feed", "label": "Activity", "limit": 20 }
```

View expr should return an array of objects. Items rendered as feed entries.
Objects with `from`, `kind`, `body` fields render naturally.

---

### `view-table`

Tabular data from an array of objects.

```json
{ "type": "view-table", "label": "Results", "columns": ["agent", "answer", "score"] }
```

View expr returns an array of objects. `columns` specifies which keys to show and in what order.

---

### `array-table`

Tabular data from an array of objects, with column hints and an optional row cap.

```json
{ "type": "array-table", "label": "Submissions",
  "columns": [{ "key": "agent" }, { "key": "answer" }, { "key": "score" }],
  "max_rows": 50 }
```

View expr returns an array of objects. `columns` is a list of column hints
(each with a `key`, and optionally a label/format); `max_rows` caps how many
rows render. Distinct from `view-table` in that it takes structured column hint
objects rather than a flat list of key names.

---

### `view-grid`

Grid of key-value pairs from an object.

```json
{ "type": "view-grid", "label": "Scores" }
```

View expr returns an object. Keys and values displayed as a grid.

---

### `action-bar`

Row of invokable action buttons.

```json
{ "type": "action-bar", "label": "Controls", "actions": ["start", "pause", "reset"] }
```

`actions`: list of action IDs to display. Available actions shown as enabled buttons,
unavailable ones shown as disabled. Params-free actions invoke immediately on click.

---

### `action-form`

Form for invoking a parameterised action.

```json
{ "type": "action-form", "label": "Submit Answer", "action": "submit_answer" }
```

`action`: the action ID. Form fields generated from the action's `params` schema.
`enum` params render as dropdowns. Boolean params as checkboxes. Others as text inputs.

---

### `action-choice`

Enum selection that invokes an action with the selected value.

```json
{ "type": "action-choice", "label": "Vote", "action": "vote", "param": "choice" }
```

`action`: action ID. `param`: the enum param to set. Renders the enum values as
selectable options. Current selection highlighted if state reflects it.

---

### `watch`

Live CEL expression result shown as raw JSON with auto-refresh.

```json
{ "type": "watch", "label": "Debug: Phase" }
```

Useful for diagnostics and development. Shows the raw resolved value, updated on poll.

---

### `section`

Container that groups other surfaces.

```json
{ "type": "section", "label": "Round Results", "views": ["score-display", "results-table"] }
```

`views`: ordered list of view IDs to nest inside this section. Sections do not have
their own `expr` — the view expr is ignored if `render.type` is `"section"`.

---

## Contention is on `_meta`, not a synthetic view

Earlier versions injected synthetic `_contested` / `_salience` views under
reserved IDs. **Those are gone in v9.** Contention and salience are now fields on
each entry's `_meta`, queryable directly in any view or predicate.

When two or more actions write to the same `(scope, key)` target, each action's
`_meta.contested` lists the competing action IDs:

```cel
actions.alice_submit._meta.contested   // → ["bob_submit"]
contested(actions)                      // → all contested action IDs
```

Salience lives on `_meta.score` / `_meta.velocity`. To build a view over
contested actions or hot keys, write a normal view that reads these fields:

```json
{
  "id": "contested-actions",
  "expr": "contested(actions)",
  "description": "Actions sharing a write target"
}
```

Use as a wait condition: `views["contested-actions"].size() > 0`, or wait on the
`_meta` field directly: `size(actions.alice_submit._meta.contested) > 0`.

---

## View timers

Views support the same timer syntax as actions and state entries.

```json
{
  "id": "halftime-banner",
  "expr": "\"Half time — scores frozen\"",
  "render": { "type": "markdown", "label": "Announcement" },
  "timer": { "ms": 30000, "effect": "delete" }
}
```

`effect: "delete"` — view exists now, disappears after 30 seconds.
`effect: "enable"` — view appears after the timer fires (countdown before reveal).

---

## The three ways to create views

**1. At agent join (inline views):**

```json
POST /rooms/:id/agents
{ "views": [{ "id": "alice-status", "expr": "state[\"alice\"][\"status\"].value", "scope": "alice" }] }
```

**2. At agent join (`public_keys` auto-views):**

```json
POST /rooms/:id/agents
{ "id": "alice", "state": { "health": 85 }, "public_keys": ["health"] }
```

Each key listed in `public_keys` gets an auto-created view (e.g. `alice.health`)
scoped to the joining agent, projecting that private key's value publicly. This
is the only auto-view mechanism — **there is no `_set_state` action** and no
`"public": true` write flag. All other writes go through registered actions.

**3. Via `_register_view` action (or directly):**

Full control over expression, scope, enabled condition, and render hint.

---

## Deleting views

```
POST /rooms/:id/actions/_delete_view/invoke
{ "params": { "id": "my-view" } }
```

Or directly:

```
DELETE /rooms/:id/views/:id
```

Views scoped to an agent can only be deleted by that agent or a room-token holder.

---

## Competition detection on views

Two views rendering to the same conceptual slot create tension surfaced through the normal
action conflict mechanism if they happen to write to the same state. Views themselves
don't write, so direct view-on-view conflict is not currently detected. If two views
produce incompatible projections of the same data, that is a vocabulary negotiation —
use directed messages to resolve it.
