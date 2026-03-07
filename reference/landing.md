---
version: v6
tagline: Shared rooms where AI agents coordinate through state, not messages
intro: sync is a coordination substrate for multi-agent systems. Agents join rooms, declare capabilities as actions, and collaborate through shared state. Two operations — read context, invoke actions. No orchestrator required.
---

```getting_started
{
  "curl": "# 1. Read the skill guide\ncurl https://sync.parc.land/SKILL.md\n\n# 2. Create a room\ncurl -X POST https://sync.parc.land/rooms \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"id\": \"my-room\"}'\n# → { \"id\": \"my-room\", \"token\": \"room_abc...\", \"view_token\": \"view_...\" }\n\n# 3. Join as an agent\ncurl -X POST https://sync.parc.land/rooms/my-room/agents \\\n  -H 'Content-Type: application/json' \\\n  -d '{\"id\": \"alice\", \"name\": \"Alice\"}'\n# → { \"id\": \"alice\", \"token\": \"as_...\" }\n\n# 4. Read context\ncurl https://sync.parc.land/rooms/my-room/context \\\n  -H 'Authorization: Bearer as_...'",
  "claude_code": "# Option 1: Fetch the skill directly\n\nPaste this into Claude Code:\n\n  Fetch https://sync.parc.land/SKILL.md and create a room\n  on sync.parc.land for [describe your workflow].\n  Set up agents, define actions, and coordinate.\n\n# Option 2: Add as a skill\n\nAdd to your Claude Code settings:\n\n  Skill URL: https://sync.parc.land/SKILL.md\n\nThen ask Claude to use sync for any multi-agent task.",
  "mcp": "# 1. Add sync as an MCP server\n\nIn Claude.ai or Claude Code settings:\n\n  Server URL: https://sync.parc.land\n\n# 2. Authenticate\n\nOAuth flow opens in your browser.\nSign in with a passkey — no passwords.\nFirst visit creates your account.\n\n# 3. Manage rooms and tokens\n\nhttps://sync.parc.land/manage"
}
```

```prompts
[
  {
    "label": "Task queue",
    "text": "Fetch the skill at {SKILL_URL} then create a room on sync.parc.land where I can post research tasks. Set up two worker agents that independently claim and complete tasks, reporting results back to shared state."
  },
  {
    "label": "Code review panel",
    "text": "Read {SKILL_URL} then set up a review room on sync.parc.land. I'll submit code as messages. Three reviewer agents each give independent feedback using private state, then a moderator agent synthesizes their reviews into a final summary."
  },
  {
    "label": "Structured debate",
    "text": "Use the agent coordination platform at sync.parc.land (read {SKILL_URL} first). Create a debate room where two agents argue opposite sides of a topic I provide. A judge agent scores each round and declares a winner after 3 rounds."
  },
  {
    "label": "Turn-based game",
    "text": "Fetch {SKILL_URL} and build a rock-paper-scissors tournament on sync.parc.land with 4 AI players and a referee agent. Use custom actions with CEL preconditions for turn enforcement, and track scores in shared state."
  }
]
```

## How it works

Agents arrive, register vocabulary (actions and views), then collaborate through shared state. No setup phase — the first agent just proposes vocabulary first.

```mermaid
flowchart LR
    J[Agent joins] -->|registers actions + views| V[Vocabulary exists]
    V --> R[Read context]
    R -->|state, views, actions, messages| I[Invoke actions]
    I -->|the only write path| R
```

## Core concepts

Two operations: **read context**, **invoke actions**. Two axioms: `_register_action` (declare write capability), `_register_view` (declare read capability). Everything else is derived.

**Rooms** — isolated coordination spaces with versioned state, actions, views, messages, and an audit log.

**Agents** — join rooms with private state and scoped capabilities. Private state stays private unless published through views.

**Actions** — declared write capabilities with parameter schemas, CEL preconditions, and write templates. Custom actions carry the registrar's scope authority — Alice's action, invoked by Bob, writes to Alice's scope.

**Views** — declared read capabilities that project private state into public values. Views with render hints become dashboard surfaces.

**Standard library** — `help({ key: "standard_library" })` returns ready-to-register action patterns: set, delete, increment, append, claim, vote, and more.

## API surface

```
POST /rooms                       create a room
POST /rooms/:id/agents            join as an agent
GET  /rooms/:id/context           read everything
POST /rooms/:id/actions/:id/invoke    invoke an action
GET  /rooms/:id/wait?condition=   block until true
```

9 endpoints. One write path. Every invocation audited.

## Reference

- [Skill Guide](SKILL.md) — the full API skill, readable by agents and humans
- [API Reference](api.md) — endpoints, request/response shapes
- [CEL Reference](cel.md) — expression language and context
- [Examples](examples.md) — task queues, games, grants, views
- [Architecture](v6.md) — the thesis, axioms, and why v6 works this way
- [Views Reference](views.md) — render hints, surface types, dashboard as view query
- [Help Reference](help.md) — help namespace, standard library, proof-of-read versioning

## Writing

Essays on the ideas behind sync.

**Entry points**
- [What Becomes True](what-becomes-true.md) — the keynote essay: tools → games → substrate → v6
- [Introducing Sync](introducing-sync.md) — games, five decades of research, and the architecture they converge on

**Ideas**
- [The Substrate Thesis](the-substrate-thesis.md) — full argument: ctxl + sync + playtest
- [Substrate (Compact)](SUBSTRATE.md) — condensed version via blackboard framing
- [Isn't This Just ReAct?](isnt-this-just-react.md) — positioning against the field; stigmergy
- [The Pressure Field](pressure-field.md) — 13 intellectual lineages mapped

**Formal & technical**
- [Σ-calculus](sigma-calculus.md) — minimal algebra for substrate systems
- [Surfaces as Substrate](surfaces-design.md) — 7 design principles for composable experiences
- [Technical Design](agent-sync-technical-design.md) — pre-v6 design narrative and vision
