# Agent Design Patterns — Dark Room

This document describes the design of the two agent types that drive the
dark-room text adventure: the **narrator** and the **wanderers**. It also
catalogues the prompt-engineering patterns that shape their behaviour and the
emergent phenomena observed across eight waves of play.

---

## Narrator Agent

The narrator is the single authoritative voice of the world. It owns the
setting, the NPCs, the mechanics, and the pacing. There is one narrator per
wave (though the narrator prompt grows with each wave as the story-so-far
section expands).

### Input contract

The narrator receives:

| Section | Purpose |
|---------|---------|
| **Story-so-far summary** | Compressed history of every prior wave so the narrator never contradicts established lore. Grows each wave. |
| **Current state** | Latest key-value pairs from the sync layer — turn counter, location, resource levels, NPC phases. |
| **World-building guidelines** | Tone, geography, cosmology. Constrains invention without prescribing it. |
| **Character details** | Who is present, their traits, trust levels, unresolved tensions. |
| **Mechanics** | Exact curl commands for reading and writing state. The narrator must be able to operate the sync API autonomously. |

### Output contract

The narrator writes the following keys to the sync layer:

| Key | Description |
|-----|-------------|
| `narrator_text` | The prose output — what the wanderer (and the reader) sees. Second person, present tense. |
| `nN_*` (prefixed) | World state keys scoped to the current wave. Example: `n2_stranger_phase`, `n6_font_status`. The `nN_` prefix prevents collisions across waves. |
| `turn` | Monotonically increasing turn counter. |
| `location` | Current scene / area name. |

### Polling behaviour

The narrator polls the wanderer's scope for new `action` values every **30
seconds**. When it finds a new action (identified by a changed `action_turn`),
it incorporates the action into the next beat of prose, updates world state,
and increments `turn`.

### Voice

- Second person, present tense ("You kneel beside the fire.")
- Sparse, literary — short sentences, sensory detail, no exposition dumps
- Interior thoughts rendered as perception, not explanation
- NPCs speak in their own cadence; the narrator never ventriloquises the wanderer

### Responsibilities

1. **World building** — Introduce geography, objects, lore at a pace that
   rewards attention. Never explain what can be shown.
2. **NPC dialogue** — Each NPC has a distinct voice. The stranger speaks in
   fragments; the bell keeper in patient, measured sentences; the child in
   unsettling clarity.
3. **Resource tracking** — Fire status, wood count, water, light. Mechanical
   state is the skeleton the prose hangs on.
4. **Tension management** — Escalate, plateau, release. The quiet is always
   present but its pressure varies. Dramatic seeds in the prompt suggest
   inflection points; the narrator decides when and how to use them.

---

## Wanderer Agent

Each wave introduces a new wanderer with a distinct character identity. The
wanderer is the player — the one who acts. Wanderers do not control the world;
they propose actions and the narrator adjudicates.

### Input contract

The wanderer receives:

| Section | Purpose |
|---------|---------|
| **Story summary** | Same compressed history the narrator gets, but briefer — the wanderer knows less than the narrator. |
| **Character brief** | Who this wanderer is: name, role, core trait, voice. |
| **Action examples** | 3-5 example actions that demonstrate the expected style and granularity. These shape behaviour without prescribing it. |
| **Mechanics** | Exact curl commands for writing `action` and `action_turn`, and for reading `narrator_text`. |

### Output contract

The wanderer writes exactly two keys to its scoped namespace:

| Key | Scope | Description |
|-----|-------|-------------|
| `action` | `wanderer-N` | A single action in first person, present tense, lowercase. |
| `action_turn` | `wanderer-N` | The turn number this action responds to. Lets the narrator detect new input. |

### Timing

The wanderer waits **60 seconds** before its first read of the narrator's
output. This gives the narrator time to set the opening scene. After that, the
wanderer reads on a regular cadence and submits actions in response.

### Voice

- First person, present tense ("i kneel beside the fire.")
- Lowercase throughout
- Terse — actions are 1-3 sentences
- Internal state bleeds through word choice, not explicit emotion

---

## Character Evolution Across Waves

Each wanderer embodies a different facet of what it means to be human in a
world that trends toward silence.

| Wave | Wanderer | Role | Core Trait |
|------|----------|------|------------|
| 1 | *(unnamed)* | Survivor | Instinct |
| 2 | wanderer-2 | The Wanderer Returns | Empathy |
| 3 | wanderer-3 | The Delver | Curiosity |
| 4 | wanderer-4 | The Keeper | Stewardship |
| 5 | wanderer-5 | The Leader | Authority |
| 6 | wanderer-6 | The Expedition Leader | Courage |
| 7 | wanderer-7 | The Mediator | Wisdom |
| 8 | wanderer-8 | The Truth-Bearer | Honesty |

The progression is deliberate: the story begins with raw survival instinct and
ascends through social virtues (empathy, curiosity, stewardship) into
leadership and finally into the hardest virtues — wisdom, honesty, acceptance.
Each wanderer's core trait determines what they notice, what they attempt, and
what they are willing to sacrifice.

---

## Prompt Engineering Patterns

### 1. Story-so-far summary grows each wave

The summary section of both narrator and wanderer prompts is additive. Wave 1
has no summary. Wave 2 gets a paragraph about wave 1. By wave 8 the summary is
several pages — a compressed epic. This gives later agents richer context and
prevents contradictions, but it also means later prompts are significantly
longer. The summaries are hand-written between waves to control what is
emphasised and what is allowed to fade.

### 2. Action examples shape behaviour without prescribing it

Rather than telling the wanderer "you should explore cautiously," the prompt
provides example actions:

```
- i press my hand against the cold stone and wait.
- i take one step forward. just one.
- i hold the branch out toward the dark and listen.
```

The wanderer infers tone, granularity, and risk appetite from these examples.
Different example sets produce radically different play styles.

### 3. Mechanics section gives exact curl commands

Both agents receive copy-pasteable curl commands for every sync operation they
need. This eliminates ambiguity about the API contract:

```
curl -X PUT https://sync.parc.land/state/dark-room/narrator/turn \
  -H "Content-Type: application/json" \
  -d '{"value": "13"}'
```

Agents do not need to infer endpoints, headers, or payload shapes.

### 4. Character voice descriptions constrain tone

Each wanderer prompt includes a short paragraph describing voice:

> You speak in first person, present tense, always lowercase. Your sentences
> are short. You do not explain yourself. You act, and the action says what
> words would hide.

This is more effective than a list of rules because it *demonstrates* the voice
in the description itself.

### 5. Dramatic seeds guide but do not dictate

The narrator prompt includes a "seeds" section — suggested elements, tensions,
or revelations that could appear in this wave:

> - The stranger may reveal knowledge of the ruins.
> - Dawn is possible but not guaranteed.
> - Something lives in the well.

Seeds are framed as possibilities, not requirements. The narrator can ignore
them, reorder them, or transform them. This preserves authorial agency while
ensuring each wave has dramatic raw material.

---

## Emergent Behaviours

The following phenomena were not designed into the prompts but arose from the
interaction of narrator and wanderer agents across waves.

### Spontaneous world-building accumulation

Agents build on each other's inventions without coordination. The "remembering
water" introduced by narrator-3 becomes a tool in wave 6. The bell chain from
wave 4 becomes a warning system in wave 7. Neither later narrator was told to
reuse these elements — they picked them up from the story-so-far summary and
found them useful.

### Unscripted character arcs

Characters develop trajectories not present in the original prompts. Senn
arrives in wave 7 as a builder and skeptic, grieving lost family. His arc from
doubt ("what if the quiet holds the lost?") to defiant hope ("I knew walls
would fall. Built them anyway. That's the whole point.") was not scripted. It
emerged from the narrator responding to Senn's established personality under
pressure.

### The memory-cost mechanic

The idea that doors cost one freely-given memory originated in the narrator-6
prompt as a dramatic seed. But the mechanic was enriched by subsequent agents:

- Wave 6 established the rule: one memory, freely given.
- Wave 7 complicated it: what if the memory is of someone you love?
- Wave 8 inverted it: what if the truth the door shows is worse than the cost?

Each narrator found new dramatic possibilities in the mechanic without being
told to elaborate on it.

### Dashboard sync at scale

As the number of active keys grew across waves, the sync layer's dashboard had
to be adapted. Early waves wrote a handful of keys; by wave 5, dozens of
prefixed keys coexisted. The `nN_` prefix convention was introduced in wave 2
to prevent collisions, but the dashboard's rendering and the narrator's
state-reading patterns had to evolve to handle the growing keyspace. This was a
systems-level emergent challenge, not a narrative one.

---

## Design Principles (Summary)

1. **Separation of concerns**: the narrator owns the world; the wanderer owns
   the action. Neither crosses into the other's domain.
2. **Constraints enable creativity**: voice rules, timing windows, and scoped
   keys create structure that the agents fill with invention.
3. **History is curated**: the story-so-far summary is human-edited between
   waves, controlling what persists and what fades.
4. **Mechanics are literal**: agents get curl commands, not abstractions. This
   eliminates a class of failure.
5. **Seeds, not scripts**: dramatic possibilities are offered, never mandated.
   The best moments in the story were unplanned.
