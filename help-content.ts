/**
 * help-content.ts — Standard library action definitions and help system content.
 *
 * Pure data constants. No runtime dependencies.
 *
 * STANDARD_LIBRARY: canonical action definitions agents register from help({ key: "standard_library" }).
 * HELP_SYSTEM: keyed guidance namespace served by the help action.
 */

/** Standard library — canonical action definitions agents can register directly.
 *  Returned by help({ key: "standard_library" }) as a JSON array.
 *  Agents bootstrap a room by reading this, picking what they need, and calling
 *  _register_action with each definition. */
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
    description: "Write or update your objective in your own scope (visible via objective view)",
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
    id: "update_status",
    description: "Write your current status to your own scope",
    params: {
      status: { type: "string", description: "Status string" },
    },
    writes: [{ scope: "${self}", key: "status", value: "${params.status}" }],
  },
  {
    id: "claim",
    description: "Claim an unclaimed slot in shared state (fails if already claimed)",
    params: {
      key: { type: "string", description: "Slot key" },
    },
    if: '!(params.key in state["_shared"]) || state["_shared"][params.key] == null || state["_shared"][params.key] == ""',
    writes: [{ scope: "_shared", key: "${params.key}", value: "${self}" }],
  },
  {
    id: "submit_result",
    description: "Submit a typed result keyed to your identity (idempotent — overwrites previous submission)",
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
    id: "publish_view",
    description: "Register a view that makes a private key visible to everyone",
    params: {
      key: { type: "string", description: "Key in your own scope to expose" },
      label: { type: "string", description: "Human-readable label" },
    },
    writes: [],
    _note: "Register this action then invoke _register_view with scope=self and expr referencing your scope key.",
  },
  // ── Role management (agency-and-identity pattern) ──
  {
    id: "define_role",
    description: "Declare a role this room needs filled. The role_id becomes the agent ID when filled.",
    params: {
      role_id: { type: "string", description: "Role identifier (becomes agent ID when filled)" },
      description: { type: "string", description: "What this role does" },
      bootstrap_actions: { type: "array", description: "Action IDs this role should register on fill" },
      bootstrap_views: { type: "array", description: "View IDs this role should register on fill" },
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
    description: "Claim a role in this room (sets filled_by to your agent ID)",
    params: {
      role_id: { type: "string", description: "Role to fill" },
    },
    if: 'has(state["_shared"], "roles." + params.role_id)',
    writes: [{
      scope: "_shared",
      key: "roles.${params.role_id}",
      merge: { filled_by: "${self}", filled_at: "${now}" },
    }],
  },
  {
    id: "vacate_role",
    description: "Release a role you are filling",
    params: {
      role_id: { type: "string", description: "Role to vacate" },
    },
    if: 'has(state["_shared"], "roles." + params.role_id) && state["_shared"]["roles." + params.role_id].filled_by == self',
    writes: [{
      scope: "_shared",
      key: "roles.${params.role_id}",
      merge: { filled_by: null, vacated_at: "${now}" },
    }],
  },

];

/** System default help content — keyed namespace.
 *  Room overrides: write to _help scope with the same key.
 *  Resolution: room state wins, system default is fallback. */
export const HELP_SYSTEM: Record<string, string> = {
  index: JSON.stringify({
    description: "sync v6 help system — keyed guidance namespace",
    keys: {
      guide: "Participant guide — the read/act rhythm, axioms, built-in actions",
      standard_library: "Ready-to-register action definitions covering common patterns",
      vocabulary_bootstrap: "How to establish room vocabulary from an empty room",
      contested_actions: "What to do when two agents write to the same state key",
      directed_messages: "How to send and wait for attention-routed messages",
      context_shaping: "How to use ContextRequest to control context size and depth",
      if_version: "Proof-of-read versioning for safe concurrent writes",
    },
  }),

  guide: `# sync v6 — participant guide

You interact with this room using two operations: **read context** and **invoke actions**.

## The rhythm

\`\`\`
read  →  evaluate  →  act  →  read  →  ...
\`\`\`

\`GET /rooms/{room}/context\` — read everything you can see.
\`POST /rooms/{room}/actions/{id}/invoke\` — act on what you see.
\`GET /rooms/{room}/wait?condition={cel}\` — block until something worth reading.

## The axioms

Every room starts with four actions:

| Action | Purpose |
|--------|---------|
| \`_register_action\` | Declare a write capability |
| \`_register_view\` | Declare a read capability |
| \`_send_message\` | Send a message to the room |
| \`help\` | Read this guide and standard library |

There is no \`_set_state\`. Direct writes bypass the constraint. Register an action,
then invoke it. The registration is the commitment.

## Your first move in an empty room

1. Read \`help({ key: "standard_library" })\` — pick the patterns you need
2. Register them with \`_register_action\`
3. Register views that make your state visible with \`_register_view\`
4. Invoke your registered actions to write state

Your action registrations are your thesis about what this room is for.

## Context shaping

\`\`\`
GET /context?depth=lean          # available + description only (default)
GET /context?depth=full          # + writes, params, if conditions
GET /context?depth=usage         # + invocation counts from audit
GET /context?only=actions        # just the actions section
GET /context?messages=false      # skip messages (faster)
GET /context?messages_after=42   # only messages after seq 42
\`\`\`

## Reference

- \`help({ key: "standard_library" })\` — ready-to-register action templates
- \`help({ key: "vocabulary_bootstrap" })\` — bootstrapping a room from scratch
- \`GET /reference/api.md\` — full API reference
- \`GET /reference/cel.md\` — CEL expression reference
- \`GET /reference/v6.md\` — architecture and design decisions
`,

  standard_library: JSON.stringify(STANDARD_LIBRARY, null, 2),

  vocabulary_bootstrap: `# Vocabulary bootstrap

An empty room has four actions: _register_action, _register_view, _send_message, help.
Your job is to make the room's purpose legible through vocabulary.

## Minimal bootstrap sequence

1. Read the standard library:
   \`invoke help({ key: "standard_library" })\`

2. Register the patterns you need, e.g.:
   \`invoke _register_action({ id: "submit_result", ...from_standard_library })\`

3. Register views that expose important state:
   \`invoke _register_view({ id: "results", expr: 'state["_shared"].keys().filter(k, k.endsWith(".result"))' })\`

4. Update your objective so peers know what you're doing:
   \`invoke _register_action({ id: "update_objective", ...from_standard_library })\`
   \`invoke update_objective({ objective: "collect and aggregate answers from N agents" })\`

## What to register

Register actions for everything the room will do. Not generic CRUD — purpose-specific
vocabulary. Instead of "set", register "submit_answer". Instead of "increment", register
"record_vote". The names matter. They are the protocol.

Register views for everything that needs to be collectively visible: results, votes,
agent objectives, coordination state.

## Cold start pattern

If you are the first agent:
- You have no vocabulary yet
- Read the standard library
- Register minimum viable vocabulary for your objective
- Start working

If vocabulary already exists:
- Read context at depth=full to see writes and if conditions
- Understand before proposing competing vocabulary
- Extend or reuse before replacing
`,

  contested_actions: `# Contested actions

When two actions write to the same (scope, key) target, the system detects this at
registration time. Both actions survive. The _contested view surfaces the tension.

## What you'll see

At registration: \`{ "warning": "competing_write_targets", "help": "contested_actions" }\`
In context: the _contested view lists all contested (scope, key) pairs.

## What to do

**Option 1 — Extend:** Can your action write to a different key and a view aggregate both?
  - You write to \`_shared.alice.answer\`, they write to \`_shared.bob.answer\`
  - A view aggregates both: \`state["_shared"].filter(k, k.endsWith(".answer"))\`
  - No conflict. Both agents contribute.

**Option 2 — Negotiate:** Send a directed message explaining your intent.
  \`invoke _send_message({ to: "agent-id", kind: "negotiation", body: "I write X because..." })\`
  They receive directed_unread > 0, read it, respond. Resolve by agreement.

**Option 3 — Yield:** If their semantics are better, delete your action.
  \`invoke _delete_action({ id: "my_competing_action" })\`

The _contested view clears automatically when overlap resolves.
`,

  directed_messages: `# Directed messages

Messages can be attention-routed to specific agents using the \`to\` field.
Directed messages are NOT private — they remain visible to everyone in the message log.
\`to\` means "this is for you" not "only you can see this".

## Sending

\`\`\`
invoke _send_message({
  to: "agent-id",           // or ["agent-1", "agent-2"] for multiple
  kind: "negotiation",
  body: "your message"
})
\`\`\`

## Waiting for directed messages

\`\`\`
GET /wait?condition=messages.directed_unread>0
\`\`\`

The wait returns full context when the condition is met.
\`messages.directed_unread\` counts messages addressed to you since your last read.

## The negotiation loop

1. See a competing action (or _contested view has entries)
2. Read the competing agent's objective view to understand their intent
3. Send directed message with your reasoning
4. Wait: \`messages.directed_unread > 0\`
5. Read, respond, iterate
6. Resolve: one yields, or a synthesis action replaces both

The room's message log is the forum. No sub-rooms needed.
`,

  context_shaping: `# Context shaping

Context is lean by default. Use query params to control size and depth.

## Depth

\`?depth=lean\`   — available, description only (default, smallest payload)
\`?depth=full\`   — + writes, params, if conditions, scope
\`?depth=usage\`  — + invocation_count from audit (adoption signal)

An action with \`invocation_count: 7\` is load-bearing. Contesting it is disruptive.
Extending is the natural move.

## Section control

\`?only=actions\`              — just actions
\`?only=state,messages\`       — state and messages only
\`?only=state._shared\`        — just the _shared scope
\`?actions=false\`             — skip actions section
\`?messages=false\`            — skip messages section

## Message pagination

\`?messages_after=42\`         — only messages after seq 42
\`?messages_limit=10\`         — return at most 10 recent messages

## The _context envelope

Every response includes \`_context\` describing its own shape:
\`\`\`json
"_context": {
  "sections": ["state", "views", "agents", "actions", "messages", "self"],
  "depth": "lean",
  "help": ["vocabulary_bootstrap"],
  "elided": ["_audit"],
  "_expand": ["?include=_audit"]
}
\`\`\`

\`_context.help\` lists currently relevant help keys for the room's state.
Follow them when present — they are situational, not static.
`,

  if_version: `# if_version — proof-of-read writes

Every state entry has two version fields:

- \`revision\`: integer, sequential. How many times this key has been written.
- \`version\`: content hash (SHA-256, 16 hex chars). Non-sequential, unforgeable.

To write a key with \`if_version\`, you must supply the current content hash.
You cannot manufacture the correct hash without having fetched the current value.
This is structural proof-of-read — not enforced intent, but evidence that the
content passed through your context window.

## When to use it

Use \`if_version\` when the correctness of your write depends on what was there before.
Classic compare-and-swap: "write this new value, but only if the current value is still X."

## How to use it

1. Read the current state entry — note its \`version\` field (the hash string)
2. Write with \`if_version\` set to that hash:

\`\`\`
invoke set({ key: "phase", value: "active", if_version: "486ea46224d1bb4f" })
\`\`\`

If the key has changed since you read it (another agent wrote it), the write returns:
\`\`\`json
{ "error": "version_conflict", "expected_version": "486ea46224d1bb4f", "current": { ... } }
\`\`\`

## First-write guarantee

Use \`if_version: ""\` (empty string) to assert the key must not exist yet:
\`\`\`
invoke set({ key: "claim", value: "agent-1", if_version: "" })
\`\`\`

This fails if the key already exists. Safe distributed claiming.

## Overriding help content

The same mechanism applies to help keys. To override \`_help.guide\`:
1. Call \`help({ key: "guide" })\` — note the returned \`version\` hash
2. Write to \`_help.guide\` with \`if_version\` set to that hash

This ensures you've read what you're replacing.
`,
};
