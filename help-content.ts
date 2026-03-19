/**
 * help-content.ts — v9 help system.
 *
 * Pure data constants. No runtime dependencies.
 *
 * STANDARD_LIBRARY: canonical action definitions for room bootstrapping.
 * HELP_SYSTEM: keyed guidance namespace served by the help action.
 *
 * v9: Updated for wrapped state model { value, _meta }.
 * All CEL expressions use .value for data access, ._meta for metadata.
 * New help keys: expressions, shaping, functions, wrapped_entries.
 */

/** Standard library — canonical action definitions agents can register.
 *  v9: CEL expressions updated for { value, _meta } wrapped shape. */
export const STANDARD_LIBRARY: any[] = [
  {
    id: "set",
    description: "Write a named value to shared state",
    params: {
      key: { type: "string", description: "State key" },
      value: { description: "Value to set (any type)" },
    },
    writes: [{ scope: "_shared", key: "${params.key}", value: "params.value", expr: true }],
  },
  {
    id: "delete",
    description: "Remove a key from shared state (write null to signal deletion)",
    params: {
      key: { type: "string", description: "State key to clear" },
    },
    writes: [{ scope: "_shared", key: "${params.key}", value: null }],
  },
  {
    id: "increment",
    description: "Increment a named counter in shared state",
    params: {
      key: { type: "string", description: "Counter key" },
      by: { type: "number", description: "Amount to increment (default 1)" },
    },
    writes: [{ scope: "_shared", key: "${params.key}", increment: "${params.by}" }],
  },
  {
    id: "append",
    description: "Append an entry to a named log in shared state",
    params: {
      key: { type: "string", description: "Log key" },
      entry: { description: "Entry to append (any type)" },
    },
    writes: [{ scope: "_shared", key: "${params.key}", append: true, value: "params.entry", expr: true }],
  },
  {
    id: "update_objective",
    description: "Write or update your objective in your own scope",
    params: {
      objective: { type: "string", description: "Your current objective" },
      status: { type: "string", description: "Current status (optional)" },
    },
    writes: [
      { scope: "${self}", key: "objective", value: "${params.objective}" },
      { scope: "${self}", key: "status", value: "${params.status}" },
    ],
  },
  {
    id: "claim",
    description: "Claim an unclaimed slot in shared state (fails if already claimed)",
    params: {
      key: { type: "string", description: "Slot key" },
    },
    if: '!has(state._shared[params.key]) || state._shared[params.key].value == null',
    writes: [{ scope: "_shared", key: "${params.key}", value: "${self}" }],
  },
  {
    id: "submit_result",
    description: "Submit a typed result keyed to your identity (idempotent)",
    params: {
      result: { description: "Your result (any type)" },
    },
    writes: [{
      scope: "_shared",
      key: "${self}.result",
      value: "params.result",
      expr: true,
    }],
  },
  {
    id: "vote",
    description: "Cast or change your vote. One vote per agent.",
    params: {
      choice: { type: "string", description: "Your choice" },
    },
    writes: [{ scope: "${self}", key: "vote", value: "${params.choice}" }],
  },
  {
    id: "define_role",
    description: "Declare a role this room needs filled",
    params: {
      role_id: { type: "string", description: "Role identifier (becomes agent ID when filled)" },
      description: { type: "string", description: "What this role does" },
    },
    writes: [{
      scope: "_shared",
      key: "roles.${params.role_id}",
      merge: {
        description: "${params.description}",
        filled_by: null,
        defined_at: "${now}",
      },
    }],
  },
  {
    id: "fill_role",
    description: "Claim a role in this room",
    params: {
      role_id: { type: "string", description: "Role to fill" },
    },
    if: 'has(state._shared["roles." + params.role_id])',
    writes: [{
      scope: "_shared",
      key: "roles.${params.role_id}",
      merge: { filled_by: "${self}", filled_at: "${now}" },
    }],
  },
  {
    id: "gate_on_stability",
    description: "Example: an action only available when no shared keys are being rapidly written",
    params: {
      key: { type: "string", description: "Key to write" },
      value: { description: "Value to write" },
    },
    if: 'size(velocity_above(state._shared, 0.3)) == 0',
    writes: [{ scope: "_shared", key: "${params.key}", value: "params.value", expr: true }],
  },
  {
    id: "gate_on_writer",
    description: "Example: only invoke if the target key was NOT last written by you",
    params: {
      key: { type: "string", description: "Key to refine" },
      value: { description: "New value" },
    },
    if: 'state._shared[params.key]._meta.writer != self',
    writes: [{ scope: "_shared", key: "${params.key}", value: "params.value", expr: true }],
  },
];

/** Help keys that validation errors can reference.
 *  Used by validateExpression and registerAction/registerView responses. */
export const HELP_KEYS = {
  EXPR_SYNTAX: "expressions",
  EXPR_WRAPPED: "wrapped_entries",
  EXPR_FUNCTIONS: "functions",
  SHAPING: "shaping",
  CONTEST: "contested_actions",
  BOOTSTRAP: "vocabulary_bootstrap",
  MESSAGES: "directed_messages",
  IF_VERSION: "if_version",
} as const;

/** System default help content — keyed namespace. */
export const HELP_SYSTEM: Record<string, string> = {
  index: JSON.stringify({
    description: "sync v9 help system",
    keys: {
      guide: "Participant guide — read/act rhythm, axioms, built-in actions",
      expressions: "CEL expression guide — .value, ._meta, domain helpers, common patterns",
      wrapped_entries: "The { value, _meta } entry shape — why and how",
      functions: "Domain helper function reference — salient(), elided(), written_by(), etc.",
      shaping: "Context shaping — elision, expand, thresholds",
      standard_library: "Ready-to-register action definitions",
      vocabulary_bootstrap: "How to establish room vocabulary from an empty room",
      contested_actions: "What to do when two agents write to the same state key",
      directed_messages: "Attention-routed messages",
      if_version: "Proof-of-read versioning for safe concurrent writes",
    },
  }),

  guide: `# sync v9 — participant guide

Two operations: **read context** and **invoke actions**.

## The rhythm

  read → evaluate → act → read → ...

sync_read_context({ room }) — read the room as { value, _meta } entries.
sync_invoke_action({ room, action, params }) — act on what you see.
sync_wait({ room, condition }) — block until a CEL condition is true.

## The axioms

Every room starts with: _register_action, _register_view, _send_message, help.
There is no _set_state. Register an action, then invoke it.

## Entry shape (v9)

Every state entry is { value, _meta }:
  state._shared.phase.value           → "executing"
  state._shared.phase._meta.writer    → "architect"
  state._shared.phase._meta.score     → 0.85
  state._shared.phase._meta.velocity  → 0.1

Use .value for the data. Use ._meta for provenance, trajectory, salience.
See help({ key: "expressions" }) for the full CEL guide.

## Shaping

Context is shaped by salience. High-score entries get full values and metadata.
Low-score entries are elided (value: null, _meta.expand tells you how to get them).
Override: sync_read_context({ room, elision: "none" }) to see everything.
See help({ key: "shaping" }) for details.

## First move in an empty room

1. help({ key: "standard_library" }) — pick patterns you need
2. _register_action — register them
3. _register_view — make your state visible
4. Invoke your actions to write state

## Reference

help({ key: "expressions" }) — CEL expression guide
help({ key: "functions" }) — domain helper reference
help({ key: "shaping" }) — context shaping
help({ key: "standard_library" }) — action templates
`,

  expressions: `# CEL expressions in v9

Every state entry is wrapped: { value, _meta: { ... } }.
CEL expressions in views, action if/enabled gates, and result expressions
all operate on this wrapped shape.

## Value access

  state._shared.phase.value == "executing"
  state._shared.turn.value > 2
  state._shared["concepts.substrate"].value.name == "substrate"

One .value per key, always at the same depth. Everything inside .value is raw.

## Meta access

  state._shared.phase._meta.writer == self
  state._shared.phase._meta.revision > 5
  state._shared.phase._meta.velocity > 0.3
  state._shared.phase._meta.score > 0.5

Available _meta fields: revision, updated_at, writer, via, seq, score,
velocity, writers (list), first_at, elided.
Action _meta adds: invocations, last_invoked_at, last_invoked_by, contested.

## Shorthand functions

  val(state._shared.phase) == "executing"     → extracts .value
  meta(state._shared.phase, "writer")         → extracts ._meta field

## Collection queries

Map macros iterate keys. Access values via re-lookup:

  state._shared.exists(k, state._shared[k]._meta.writer == "explorer")
  state._shared.filter(k, k.startsWith("concepts"))
  state._shared.map(k, k.startsWith("concepts"), state._shared[k]._meta.writer)

Or use .keys()/.entries() for list operations:

  state._shared.keys().filter(k, state._shared[k]._meta.score > 0.5)
  state._shared.entries().filter(e, e.entry._meta.writer != null).map(e, e.key)

## Domain helpers

  salient(state._shared, 0.5)            → keys above score threshold
  elided(state._shared)                  → keys with elided values
  written_by(state._shared, self)        → keys you last wrote
  focus(state._shared)                   → high-tier keys
  velocity_above(state._shared, 0.3)     → keys being actively written
  contested(actions)                     → actions with shared write targets
  top_n(state._shared, 5)               → top 5 keys by score

See help({ key: "functions" }) for full reference.

## Common mistakes

WRONG: state._shared.phase == "executing"       → compares wrapped entry to string (always false)
RIGHT: state._shared.phase.value == "executing"  → compares the value

WRONG: state._shared["concepts.substrate"].name  → "name" not found on wrapped entry
RIGHT: state._shared["concepts.substrate"].value.name

WRONG: state._shared.phase.meta.score            → "meta" not found (underscore required)
RIGHT: state._shared.phase._meta.score

## Safe access

  has(state._shared.phase)                        → true if key exists (even if elided)
  state._shared.phase.value != null               → true if not elided
  has(state._shared.maybe_key) ? state._shared.maybe_key.value : "default"

## Note on writes

Write templates are unaffected. You write raw values:
  writes: [{ scope: "_shared", key: "phase", value: "complete" }]
The wrapping is read-side only.
`,

  wrapped_entries: `# Wrapped entries: { value, _meta }

Every entry in the room — state, agents, actions, views — is wrapped.

## Shape

  {
    "value": <the stored data>,
    "_meta": {
      "revision": 7,
      "updated_at": "2026-03-16T14:00:00Z",
      "writer": "explorer",
      "via": "add_concept",
      "seq": 247,
      "score": 0.82,
      "velocity": 0.4,
      "writers": ["explorer", "synthesist"],
      "first_at": "2026-03-15T12:00:00Z",
      "elided": false
    }
  }

## Why

_meta makes the substrate's observation function part of the observed state.
A view can say "show me keys being rapidly written" (velocity).
An action gate can say "only invoke if I didn't write this" (writer).
An agent can ask "what am I not seeing?" (elided).

## Elided entries

When an entry's salience score is below the threshold, it appears as:

  { "value": null, "_meta": { "score": 0.04, "elided": true, "expand": "?expand=_shared.key" } }

The key exists. You know its score. You can expand it by adding the expand
param to your next sync_read_context call.

## Action _meta

Actions carry additional metadata:

  invocations     — total invoke count
  last_invoked_at — timestamp of most recent invocation
  last_invoked_by — agent who last invoked
  contested       — list of other action IDs sharing write targets

## Three layers

  Storage:    raw values in SQLite (unchanged)
  Engine:     full _meta on every entry (views and action predicates see this)
  Projection: shaped _meta for the agent (elided entries, trimmed meta)

Engine-layer _meta is always complete. Projection-layer _meta may be trimmed
based on salience tier (focus gets everything, peripheral gets score/revision/updated_at).
`,

  functions: `# Domain helper functions

Registered in the CEL Environment. Available in all expressions.

## Scope queries (map → list of keys)

  salient(scope, threshold)     Keys with _meta.score > threshold
  elided(scope)                 Keys where _meta.elided == true  ⚠ see note
  active(scope)                 Keys where _meta.elided != true  ⚠ see note
  written_by(scope, agent)      Keys where _meta.writer == agent
  velocity_above(scope, thr)    Keys where _meta.velocity > threshold
  top_n(scope, n)               Top N keys by _meta.score (descending)
  focus(scope)                  Keys in focus tier (score > 0.5)
  peripheral(scope)             Keys in peripheral tier (0.1 < score <= 0.5)

⚠ Engine vs. Projection: Views and action predicates evaluate at the engine
layer where all entries have full _meta and nothing is elided. So elided()
always returns [] in views, and focus() returns all keys above 0.5 regardless
of the agent's projection. Use salient(scope, threshold) for score-based
filtering in views — it works identically at both layers.

## Action queries (actions map → list of action IDs)

  contested(actions)            Actions with non-empty _meta.contested
  stale(actions, n)             Actions with _meta.invocations < n

## Entry shorthands

  val(entry)                    Extracts entry.value (same as .value)
  meta(entry, field)            Extracts entry._meta[field]

## Receiver methods (registered on map type)

  scope.keys()                  All keys as a list
  scope.values()                All wrapped entries as a list
  scope.entries()               List of { key, entry } objects

## Combining patterns

  // "High-salience concept keys I haven't written"
  salient(state._shared, 0.5).filter(k, k.startsWith("concepts") && state._shared[k]._meta.writer != self)

  // "Count of actively-written entries"
  size(velocity_above(state._shared, 0.3))

  // "Writers of all non-elided entries"
  state._shared.entries().filter(e, !e.entry._meta.elided).map(e, e.entry._meta.writer)

  // "Gate: only enable when all concepts have stabilized"
  size(velocity_above(state._shared, 0.3)) == 0
`,

  shaping: `# Context shaping (v9)

Context is shaped by salience. Each entry gets a score (0-1) based on:
recency, dependency (your views reference it), authorship, directed messages,
contested write targets, and delta (changed since your last read).

## Three tiers

  Focus       score >= focus_threshold    Full value + full _meta
  Peripheral  score >= elide_threshold    Full value + minimal _meta (score, revision, updated_at)
  Elided      score <  elide_threshold    value: null + _meta with elided: true and expand hint

Default thresholds: focus = 0.5, elide = 0.1.

## Override params

  sync_read_context({ room, elision: "none" })          Disable elision entirely
  sync_read_context({ room, expand: "_shared.some_key" })  Force specific key to Focus
  sync_read_context({ room, focus_threshold: 0.3 })     Lower the Focus bar
  sync_read_context({ room, elide_threshold: 0.0 })     Nothing gets elided

## Expand hints

Elided entries include _meta.expand — a query param string:
  "_meta": { "elided": true, "expand": "?expand=_shared.old_concept" }

Add that param to your next read to see the full entry.

## _shaping summary

Every response includes _shaping:
  {
    "focus_threshold": 0.5,
    "elide_threshold": 0.1,
    "elision": "auto",
    "state_entries": { "focus": 5, "peripheral": 8, "elided": 12, "total": 25 }
  }

## Section control (unchanged)

  ?depth=lean|full|usage
  ?only=actions
  ?messages=false
  ?messages_after=42
  ?messages_limit=10

## Depth

  lean   — action available + description (default)
  full   — + writes, params, if conditions, scope
  usage  — + invocation_count from audit

## Invoke feedback

After invoking an action, the response includes wrapped entries for every
written key — with _meta showing post-write score, writer, velocity.
This closes the feedback loop: write → see consequences.
`,

  standard_library: JSON.stringify(STANDARD_LIBRARY, null, 2),

  vocabulary_bootstrap: `# Vocabulary bootstrap

An empty room has: _register_action, _register_view, _send_message, help.

## Minimal bootstrap

1. help({ key: "standard_library" }) — read action templates
2. _register_action — register what you need
3. _register_view — make state visible
4. Invoke actions to start writing state

## What to register

Purpose-specific vocabulary, not generic CRUD.
Instead of "set", register "submit_answer".
Instead of "increment", register "record_vote".
Names are the protocol.

## v9 patterns

Register views that use _meta for self-awareness:

  // "Concepts being actively written"
  _register_view({ id: "hot_concepts", expr: 'velocity_above(state._shared, 0.3).filter(k, k.startsWith("concepts"))' })

  // "What am I not seeing?"
  _register_view({ id: "my_blind_spots", expr: 'elided(state._shared)' })

  // "Who wrote what"
  _register_view({ id: "provenance", expr: 'state._shared.entries().filter(e, e.entry._meta.writer != null).map(e, e.key + ": " + e.entry._meta.writer)' })

Register actions with meta-aware gates:

  // Only allow refinement if someone else wrote the target
  _register_action({ id: "refine", if: 'state._shared[params.key]._meta.writer != self', ... })

  // Only synthesize when concepts have stabilized
  _register_action({ id: "synthesize", if: 'size(velocity_above(state._shared, 0.3)) == 0', ... })
`,

  contested_actions: `# Contested actions

When two actions write to the same (scope, key), the system detects this.
Both survive. The contention is visible in each action's _meta.contested.

## What you see

At registration: { "warning": "competing_write_targets", ... }
In context: actions.add_concept._meta.contested → ["refine_concept"]

In expressions:
  contested(actions)             → list of contested action IDs
  size(actions.my_action._meta.contested) > 0   → is this action contested?

## Resolving

Extend: write to different keys, aggregate with a view.
Negotiate: send a directed message explaining intent.
Yield: delete your action if theirs is better.

Contention clears when overlap resolves.
`,

  directed_messages: `# Directed messages

Messages can be attention-routed with the "to" field.
Directed messages are NOT private — everyone sees them.
"to" means "this is for you" not "only you can see this".

## Sending

  _send_message({ to: "agent-id", kind: "negotiation", body: "..." })

## Waiting

  sync_wait({ room, condition: "messages.directed_unread > 0" })

## The negotiation loop

1. See contention (actions._meta.contested, or contested(actions))
2. Read the other agent's views/objective
3. Send directed message
4. Wait for response
5. Iterate → one yields or both agree on a synthesis
`,

  if_version: `# if_version — proof-of-read writes

Every state entry has:
  revision — integer write count
  version  — content hash (SHA-256, 16 hex)

Supply the current version hash in a write to prove you've read the current value:

  invoke set({ key: "phase", value: "active", if_version: "486ea46224d1bb4f" })

If changed since your read: { "error": "version_conflict", "current": { ... } }

Use if_version: "" to assert the key must not exist yet (first-write guarantee).

In v9, the version hash is available in _meta:
  state._shared.phase._meta — includes revision for the write count
  The version hash itself is the content hash of the stored value.
`,
};
