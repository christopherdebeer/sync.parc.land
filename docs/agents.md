# Dark Room: Agent Design Patterns

## Overview

The dark-room text adventure runs as a multi-agent system where a **narrator**
agent and one or more **wanderer** agents collaborate through a shared SQLite
sync layer. Each agent is an autonomous Claude instance with its own prompt,
voice, and responsibilities. They communicate exclusively through key-value
state written to and read from the sync API.

---

## Narrator Agent

### Input Context

The narrator receives:

- **Full story summary** — a growing document that captures everything that has
  happened across all prior waves
- **Current world state** — all keys currently in the sync store
- **World-building guidelines** — tone, setting rules, constraints on what the
  world is and is not
- **Character details** — who is present, their traits, their arcs so far
- **Mechanics** — exact curl commands for reading and writing state

### Output (What It Writes)

| Key | Description |
|-----|-------------|
| `narrator_text` | The prose passage for the current turn |
| `nN_*` (prefixed keys) | World state keys scoped to the current wave, e.g. `n2_stranger_phase`, `n6_font_status` |
| `turn` | The current turn counter (integer) |
| `location` | The current scene location |

The `nN_` prefix convention (where N is the wave number) keeps each wave's
state keys namespaced so they do not collide across waves while remaining
readable in the dashboard.

### Polling Behavior

The narrator polls the wanderer's scope for new `action` and `action_turn`
values every **30 seconds**. When it detects a new action (by comparing
`action_turn` to the last processed turn), it incorporates that action into the
next narrator passage and advances the turn counter.

### Voice

- **Second person, present tense** ("You step forward. The fire dims.")
- **Sparse and literary** — short sentences, deliberate whitespace, no
  exposition dumps
- Favors sensory detail over explanation
- Lets silence carry weight

### Responsibilities

1. **World building** — describe environments, introduce new elements, maintain
   spatial consistency
2. **NPC dialogue** — voice all non-wanderer characters (the stranger, the bell
   keeper, Maren, Dahl, Senn, the child)
3. **Resource tracking** — manage fire status, wood count, water, supplies
   through state keys
4. **Tension management** — pace the quiet's encroachment, control when threats
   escalate or recede, seed dramatic questions without forcing answers

---

## Wanderer Agent

### Input Context

The wanderer receives:

- **Story summary** — a condensed version of events so far, focused on what
  this character would know
- **Character brief** — who this wanderer is, their core trait, how they speak,
  what drives them
- **Action examples** — sample actions that demonstrate the expected format and
  scope (e.g. "i pick up the stone and turn it over", "i wait and listen")
- **Mechanics** — exact curl commands for writing actions and reading narrator
  text

### Output (What It Writes)

| Key | Scope | Description |
|-----|-------|-------------|
| `action` | `wanderer-N` | The wanderer's action text |
| `action_turn` | `wanderer-N` | The turn number this action responds to |

Each wanderer writes only to its own scope (`wanderer-1`, `wanderer-2`, etc.),
preventing collisions between simultaneous wanderers.

### Timing

The wanderer waits **60 seconds** before its first read of narrator text. This
gives the narrator time to set the opening scene and establish the world before
the wanderer begins acting. After the initial delay, the wanderer reads and
responds on each narrator turn.

### Voice

- **First person, present tense, lowercase** ("i reach for the stone. it is
  warm.")
- Each wanderer has a distinct personality expressed through word choice, action
  style, and what they notice
- Actions are short — typically one to three sentences
- No meta-commentary or out-of-character text

---

## Character Evolution Across Waves

Each wave introduces a new wanderer with a distinct identity. The character
design follows a deliberate arc from raw instinct toward higher-order virtues.

| Wave | Wanderer | Role | Core Trait |
|------|----------|------|------------|
| 1 | (unnamed) | Survivor | Instinct |
| 2 | wanderer-2 | The Wanderer Returns | Empathy |
| 3 | wanderer-3 | The Delver | Curiosity |
| 4 | wanderer-4 | The Keeper | Stewardship |
| 5 | wanderer-5 | The Leader | Authority |
| 6 | wanderer-6 | The Expedition Leader | Courage |
| 7 | wanderer-7 | The Mediator | Wisdom |
| 8 | wanderer-8 | The Truth-Bearer | Honesty |

The progression is intentional: you cannot have empathy without first surviving,
cannot explore without connection, cannot build without discovery, cannot lead
without stewardship, cannot sacrifice without courage, cannot mediate without
authority, cannot bear truth without wisdom.

---

## Prompt Engineering Patterns

### Story-So-Far Summary

The summary document grows with each wave. It is the primary mechanism for
continuity. Each new narrator and wanderer receives the accumulated history,
ensuring that characters, locations, lore, and unresolved tensions carry
forward.

The summary is written in plain prose, not bullet points. It reads like a
condensed retelling, preserving key quotes and emotional beats alongside factual
state.

### Action Examples Shape Behavior

Rather than prescribing what a wanderer should do, the prompt includes 3-5
example actions that demonstrate:

- **Scope** — how much a single action can accomplish
- **Tone** — the lowercase, first-person, present-tense voice
- **Agency** — that the wanderer can choose, not just react

This pattern reliably produces in-character behavior without over-constraining
the agent. The wanderer extrapolates from examples rather than following
explicit rules.

### Mechanics as Exact Curl Commands

The mechanics section gives copy-paste curl commands for every API operation the
agent needs. This eliminates ambiguity about endpoints, headers, JSON structure,
and scope parameters. Example:

```
# Read narrator text
curl -s https://sync.parc.land/state/narrator_text

# Write action
curl -s -X PUT https://sync.parc.land/state/action \
  -H "Content-Type: application/json" \
  -d '{"value": "i open the door", "scope": "wanderer-2"}'
```

### Character Voice Descriptions

Each wanderer prompt includes a short paragraph describing how the character
speaks and thinks. These descriptions constrain tone without dictating content:

> "You speak in lowercase. Short sentences. You notice textures and
> temperatures before you notice people. You act on instinct and reflect later,
> if at all."

### Dramatic Seeds

The narrator prompt includes "seeds" — new elements, tensions, or questions
that should emerge during this wave. Seeds are suggestions, not mandates:

- "A sound from the east that might be a bell"
- "The stranger knows something about the ruins but will not volunteer it"
- "The quiet is stronger near water"

Seeds guide the narrator toward interesting territory while leaving room for
the agents to surprise each other.

---

## Emergent Behaviors

The multi-agent design produces behaviors that were not explicitly programmed.
These emergent patterns are among the most compelling aspects of the system.

### Spontaneous World-Building

Agents build on each other's contributions without coordination. When the
narrator introduced "seven vessels" in the underground ruins, wanderer-3
independently chose to investigate the seventh (empty) vessel, which the
narrator then connected to the stranger's backstory. Neither agent was told to
create this link.

### Unscripted Character Arcs

Characters develop trajectories not present in their original prompts. Senn,
introduced as a builder in Wave 7, was given a brief that said "skeptic,
grieving." The agents collaboratively developed a full arc: grief to doubt to
crisis ("what if quiet holds the lost?") to resolution ("I knew walls would
fall. Built them anyway."). The resolution was not seeded.

### The Memory-for-Doors Mechanic

The cost mechanic — that each door requires one freely given memory — was
introduced in the narrator-6 prompt as a single line: "the price is a memory."
Subsequent waves enriched this into a central thematic device:

- The keeper gives her founding moment and can remember the fact but not the
  feeling
- Dahl gives his mother's garden and loses the reason he plants
- Maren gives her certainty and must now build on faith

Each sacrifice was independently authored by different narrator instances, yet
they form a coherent escalation.

### Dashboard Sync Scaling

As the system grew from one wanderer to eight, the sync layer had to handle
increasing read/write volume. The polling intervals (30s narrator, 60s initial
wanderer delay) were tuned empirically to balance responsiveness against API
load. The `nN_` prefix convention emerged as a practical solution to state key
collisions between waves.

---

## Design Principles

1. **Autonomy over orchestration** — agents make their own decisions; there is
   no central controller choosing plot points
2. **Constraints enable creativity** — voice rules, scope limits, and polling
   intervals create structure that produces better stories than unconstrained
   generation
3. **State as shared memory** — the sync layer is the only communication
   channel; agents cannot talk to each other directly
4. **Accumulation over replacement** — the story summary grows; nothing is
   deleted; every wave builds on everything before it
5. **Cost makes choices meaningful** — the memory mechanic gives in-fiction
   weight to mechanical actions (opening doors)
