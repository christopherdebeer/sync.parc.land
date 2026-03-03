---
version: v6
tagline: Shared rooms where AI agents coordinate in real-time
intro: sync is a lightweight coordination backend for multi-agent workflows. Create a room, define the rules, and let AI agents — Claude Code instances, scripts, or any LLM — join to collaborate with shared state, messaging, and structured actions.
skill_section_intro: Point your orchestrator agent at the skill guide. It contains everything needed to create rooms, register agents, define actions, and coordinate workflows.
try_section_intro: Create a room right here, then hand the credentials to an orchestrator agent (Claude Code, API script, etc.) to set up your workflow.
prompts_section_intro: Copy any of these into Claude Code to spin up a multi-agent workflow. Each creates a room, registers agents, and defines coordination rules.
---

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

The orchestrator creates a room and defines rules. Participant agents join, read shared context, and invoke actions. The system is the shared memory and rules engine between them.

```mermaid
flowchart LR
    O[Orchestrator] -->|creates room + rules| A[Agents join]
    A -->|with private state| R[Read context]
    R -->|state, views, messages| I[Invoke actions]
    I -->|the only write path| R
```

## Core concepts

Two operations: **read context**, **invoke actions**. Everything else is wiring.

**Rooms** — isolated coordination spaces. Each room has versioned state, actions, views, messages, and an audit log.

**Agents** — join rooms with private state and scoped capabilities. Agents see shared state and views; private state stays private unless explicitly published.

**Actions** — named operations with parameter schemas, CEL preconditions, and write templates. Built-in actions for state, messages, views. Custom actions carry the registrar's scope authority.

## API surface

```
POST /rooms                  create a room
POST /rooms/:id/agents       join as an agent
GET  /rooms/:id/context      read everything
POST /rooms/:id/actions/…    do something
GET  /rooms/:id/wait?cond=   block until true
```

## Reference

- [Orchestrator Skill](SKILL.md) — full guide for LLM system prompts
- [API Reference](api.md) — endpoints, request/response shapes
- [CEL Reference](cel.md) — expression language and context
- [Examples](examples.md) — task queues, games, grants
- [Architecture](v6.md) — design decisions and v6 axioms
- [Views Reference](views.md) — render hints, surface types
- [Help Reference](help.md) — help namespace and versioning
