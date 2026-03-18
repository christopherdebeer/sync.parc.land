---
name: oblique
description: Draw an Oblique Strategy card to break creative blocks, force perspective shifts, and introduce productive constraints during design, exploration, and problem-solving work.
---

# Oblique Strategies

A creative constraint tool. Draw a card when you're stuck, circling, or need to break a pattern. The card is not an answer — it's a lens. Apply it to whatever you're working on and see what shifts.

Based on Brian Eno and Peter Schmidt's 1975 card deck. 51 strategies.

---

## When to draw

Draw a card when you notice any of these:

- **Stuck between options** — you've been comparing two approaches without committing
- **The work feels stale** — you're producing correct but uninspired output
- **Exploring divergently** — you want a constraint to shape open-ended exploration
- **Perfectionism is blocking progress** — you keep refining instead of finishing
- **A collaboration has converged too early** — the group needs a disruption
- **You've been asked to be creative** — and your first instinct is to be systematic

Do NOT draw when you need precision, correctness, or are following a specification. This is a divergence tool, not a convergence tool.

---

## API

Base URL: `https://c15r--973f9a7222ca11f1a32e42dde27851f2.web.val.run`

### Draw a card

```
GET /api/random
GET /api/random?mode=MODE
GET /api/random?mode=deterministic&seed=SEED
```

Response:

```json
{
  "mode": "original",
  "strategy": "Honor thy error as a hidden intention",
  "index": 27,
  "apply": "Look at what just went wrong or sideways. Treat it as a deliberate choice. What does the work look like if this 'mistake' was the point?"
}
```

### Modes

| Mode | Use when... |
|------|-------------|
| `original` | You want pure divergence. A new card every draw. |
| `deterministic` | You want reproducibility. Same seed → same card. Use your task ID or session ID as the seed. |
| `hourly` | Multiple agents sharing a creative session. Everyone gets the same constraint for the hour. |
| `daily` | A team working on the same problem across a day. Shared daily lens. |
| `weekly` | Long-running exploration. One constraint shapes the whole week. |

For multi-agent work, prefer `hourly` or `deterministic` with a shared seed so agents can reference the same card.

### Other endpoints

```
GET /api/strategies         Full list of all 51 strategies
GET /api/modes              Available modes
```

---

## Workflow: draw → interpret → apply → reflect

This is the core loop. A card alone does nothing — the value is in the interpretation.

### 1. Draw

```bash
curl -s $BASE/api/random?mode=hourly
```

### 2. Interpret

Read the `apply` hint. Then restate it in terms of your current problem:

> **Card:** "Emphasize differences"
> **Apply hint:** "Find two elements that are similar and push them apart. What if they were opposites?"
> **My interpretation:** "The two API endpoints I'm designing have almost identical signatures. What if I made them radically different — one synchronous and minimal, one async and rich?"

### 3. Apply

Actually do it. Follow the constraint for at least one iteration. Don't evaluate whether it's "good" yet — just see where it leads.

### 4. Reflect

After applying, note:
- What shifted in my thinking?
- Did this surface something I wasn't seeing?
- Should I keep this direction or return to the original path?

The reflection is the real output. The card is just the catalyst.

---

## Strategy categories

The 51 cards cluster into creative moves. When you know what kind of shift you need, scan the full list (`GET /api/strategies`) and filter by intent:

| Move | Examples | When useful |
|------|----------|-------------|
| **Subtraction** | "Simple subtraction", "Use fewer notes", "Mute and continue" | Over-engineered, too many features, cluttered |
| **Reversal** | "Reverse", "Turn it upside down", "Change nothing and continue" | Assumptions feel fixed, need to challenge direction |
| **Perspective shift** | "Use an old idea", "You are an engineer", "What is the reality of the situation?" | Tunnel vision, can't see the forest |
| **Embrace error** | "Honor thy error as a hidden intention", "Emphasize the flaws", "Be dirty" | Perfectionism, fear of shipping |
| **Tempo change** | "Work at a different speed", "Do nothing for as long as possible", "Take a break" | Rushing, or stuck in analysis paralysis |
| **Physicality** | "Ask your body", "Breathe more deeply", "Do the washing up" | Over-thinking, need to get out of your head |
| **Acceptance** | "Just carry on", "Trust in the you of now", "Is it finished?" | Second-guessing, unable to commit |

---

## Example: agent using oblique strategies in a design task

```
Agent is designing a dashboard layout. Three iterations have all looked similar.

Agent draws: "Make a blank valuable by putting it in an exquisite frame"

Apply hint: "Take the emptiest part of your design and treat it as the
centerpiece. What if the whitespace IS the feature?"

Agent interpretation: "I've been filling every panel with data. What if the
dashboard had a single large empty area that only populates when something
needs attention? Silence as signal."

→ This produces a fundamentally different design: a calm-by-default dashboard
  that only shows information when it matters.
```

---

## Example: multi-agent creative session

```
Three agents in a sync room, hourly mode.

All three draw the same card: "Repetition is a form of change"

Agent A (writer): Rewrites the same paragraph three times, each time from a
different character's perspective.

Agent B (coder): Takes the same function and implements it three ways —
imperative, functional, declarative — then picks the one that reveals the
clearest intent.

Agent C (designer): Tiles the same component in a grid, varying only color,
and discovers the palette was the missing piece.

The shared constraint produced divergent interpretations — which is the point.
```

---

## Integration with sync

In a sync room, you can wire this into the coordination layer:

```bash
# Register an action that draws and shares a card
POST /rooms/my-room/actions/_register_action/invoke
{
  "params": {
    "id": "draw_strategy",
    "description": "Draw an oblique strategy and share it with the room",
    "params": { "mode": { "type": "string", "default": "hourly" } }
  }
}

# Register a view that shows the current shared strategy
POST /rooms/my-room/actions/_register_view/invoke
{
  "params": {
    "id": "current_strategy",
    "expr": "state['_shared']['strategy']",
    "render": { "type": "markdown", "label": "Current Strategy" }
  }
}
```

An agent draws a card via the API, writes it to shared state via the action, and all agents see it via the view. The constraint becomes part of the room's shared context.

---

## `apply` hints

The `apply` field in the API response is a one-sentence bridge from poetic prompt to actionable constraint. It helps agents (and humans) move from "what does this mean?" to "what do I do with this?"

If the `apply` field is absent (current API), interpret the strategy yourself using this heuristic:

1. Read the strategy literally
2. Find the verb or imperative
3. Apply it to the most obvious element of your current work
4. If it doesn't fit, apply it to the element you've been ignoring

---

## Design notes

This tool is deliberately small. 51 cards. No AI interpretation layer. No personalization. The value is in the constraint being external and un-negotiable — you don't get to pick a card that confirms what you already wanted to do.

The `deterministic` mode exists so creative processes can be reproduced and discussed. The time-seeded modes exist so groups can share constraints without coordination overhead. That's it.
