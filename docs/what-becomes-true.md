# What Becomes True
*March 2026*

---

In April 2024 I wrote a short note to myself:

> a tool for making tools.

As a software engineer, I make tools constantly. Tools exist so people can do things they otherwise could not — or could only do painfully. Programming itself is such a tool, but it carries a recursive dependency: to make tools, one must first learn programming.

A hammer does not make everyone a carpenter.  
Programming does not make everyone a toolmaker.

The question was simple enough to sound naïve:

**Could a system allow people to build tools without first learning to program?**

This became *ctxl*, though at the time it was called something else — prompt studio — because the obvious starting point, in the early language-model era, was prompts.

---

## The Configuration Problem

The initial system chained prompts together. With sufficient context and carefully inserted data, outcomes became repeatable and useful. The generative capability was undeniable. Given the right configuration, the system worked.

But configuration itself became the problem.

Users were effectively programming without language, syntax, or feedback. Success depended on discovering invisible structure: which prompts mattered, which examples anchored behavior, which evaluation criteria stabilized outputs. We had not eliminated programming. We had obscured it.

The difficulty was not generating answers.

The difficulty was discovering what the system should be trying to do.

Software engineering already contains a clue. Before trusting a system, we write tests. Tests do not describe procedures; they describe expectations. They measure outcomes rather than prescribe methods.

LLM evaluations resemble this. When outputs can be scored — especially through classification — iteration becomes empirical. Systems improve not because they are instructed better but because differences become measurable.

Yet creating good measures is harder than writing prompts. Real tasks resist clean scoring. Objectives remain vague long after implementations begin.

The small realization was that objectives are easier to state than solutions.

If a system began only with an objective, it might construct everything else: tasks, datasets, measures, refinements. Interaction would not begin with instructions but with intention.

---

## Affordances

This reframing exposed a deeper problem with the prompt-first approach: prompts were being treated as commands, but commands require the user to already understand the system's model of the world. They were being asked to operate in terms the system understood rather than in terms natural to their own intention.

What was actually needed was the opposite: a system that offered users possibilities rather than demanding instructions from them.

Affordance is an old word. Gibson described it as the relationship between an agent and an environment: what actions become possible given what the environment makes perceptible. Norman later translated the idea into interface design. Good tools do not explain themselves; they make possibilities visible.

Programming, viewed through this lens, is not instruction writing. It is affordance construction.

If an environment becomes sufficiently malleable — responsive enough that intentions reshape it directly — then programming dissolves into interaction. Moldable development hinted at this. Dynamic media hinted at this. The boundary between using a system and creating one begins to blur.

Prompts stopped being commands. They became affordances — suggestions offered by the system to help the user think. The system and user co-constructed the tool.

Around this time I noticed something strange: several games had already discovered the same interaction pattern.

---

## Worlds That Teach Themselves

*A Dark Room* begins with almost nothing — a line of text, a fire, a button. Nothing transitions. The interface simply accumulates meaning. Systems appear gradually, as if uncovered rather than introduced. Reading the source code reveals a discipline: every event has an `isAvailable()` predicate against global state. Each element knows its own emergence conditions. The game never reveals itself; it simply becomes true.

*Papers, Please* does the opposite. Nothing is hidden. Rules are explicit, mechanical, bureaucratic. Yet meaning emerges from interpreting those rules under changing conditions. Truth becomes something negotiated through interaction rather than revealed through narrative.

*Outer Wilds* goes further still. The world barely changes at all. Progress exists entirely within the player's understanding. Knowledge, not capability, becomes the mechanic.

Then there is *Factorio*. Here the player builds systems until the systems begin shaping the player's thinking. Optimization yields to stability. The factory stops being something you control and becomes something you maintain — an ecology of constraints that teaches you how it wants to exist.

Across these experiences, agency shifts subtly. Progress stops feeling like movement through authored space and begins to feel like alignment with an already-present reality.

You are not advancing.

You are learning how the world works.

---

## Precedents

This pattern appears repeatedly outside games as well. Blackboard AI imagined shared reasoning spaces where solutions emerged opportunistically. Tuple spaces coordinated processes through shared memory rather than direct communication. Functional reactive programming described systems as recomputations over changing facts. Artificial life showed complex structure arising from local interaction.

Each approach reached for the same idea from a different direction. Each failed for a similar reason: the environment could not interpret ambiguity. Systems required rigid schemas or centralized coordination because participants could not meaningfully understand open-ended state.

Language models quietly change this condition. Their most important property is not intelligence but tolerance for partial structure. They can interpret traces left by others without predefined schemas.

An older biological concept suddenly becomes relevant: stigmergy. Termites coordinate by modifying their environment rather than communicating directly. Each action leaves a trace. Future actions respond to accumulated traces. Coordination emerges without orchestration.

The environment becomes both memory and communication.

This observation led to *sync*.

---

## A Concrete Scenario

Before explaining the architecture, it is worth showing what it looks like to inhabit it.

In early 2026, I ran a test using seven named agents in a single sync room. The room had a shared `phase` key starting at `gathering`. Each agent had a private scope for its findings and a `done` flag. Two computed views watched the room:

```
all_done         = agents.every(a => state[a].done == true)
synthesis_ready  = all_done && phase == "synthesizing"
```

No orchestrator decided when to advance the phase. No agent was told to wait for others. Each joined the room, read the shared state, understood its role from the context delivered on arrival, worked privately, then wrote `done: true` to its own scope.

The room's `all_done` view flipped true 48 minutes after the session began. The phase transitioned to `synthesizing` and `synthesis_ready` became true — which triggered the coordinator agent's wait condition. It woke, read the full room state including each agent's private findings, and synthesized the results.

What surprised me was not that it worked. It was what happened at the margins: agents invented views I hadn't defined (`cross_scope_check`, `meta_view`) that were later referenced by other agents. A new anonymous agent joined the room after the session was nominally complete, read the accumulated state, and contributed a late finding. The room had become a record of the collaboration — legible to new participants without explanation.

Coordination appeared as a side effect of shared perception.

---

## The Architecture

A room in sync is nothing more than shared state: keys, scopes, messages, history. There is no orchestrator deciding what happens next. Agents do two things only.

They **wait** — declare a condition under which the world becomes relevant to them.  
They **act** — write permitted changes to shared state.

When relevance becomes true, the world presents itself. Context arrives fully formed: visible state, computed views, available actions. The agent reasons privately, then chooses. That choice modifies the environment, potentially awakening others.

```
GET /rooms/my-room/wait
  ?condition=state._shared.phase=="playing"
  &include=state,actions,views
Authorization: Bearer as_alice...

→ { "triggered": true, "state": {...}, "actions": {...}, "views": {...} }
```

The wait endpoint is the system's most important primitive. Agents never poll, never guess, never receive messages they didn't ask for. They declare relevance, then sleep until the world matches their declaration.

**Views** transform raw state into meaning — not hidden inside application logic, but declared openly:

```
status = health < 20 ? "critical" : "stable"
```

The system contains both reality and the lenses through which reality is interpreted. The world explains itself.

**Surfaces** apply the same logic to interfaces. Instead of controllers deciding what users see, surfaces declare when they exist:

```
enabled = state._shared.location == "cabin"
```

When the condition becomes true, the interface grows. No routing logic. No imperative control. The feeling *A Dark Room* simulated — interface accreting meaning — becomes architectural fact.

**Organs** handle the remainder: problems that resist pure emergence. Ownership conflicts, ordering guarantees, transactional constraints require bounded regions of sequential logic. Playtest functions this way. Agents propose actions; the engine resolves invariants; the world updates. Local coordination preserves global openness.

---

## What Breaks

Every previous generation attempting emergence eventually reintroduced structure. It is worth being specific about where this architecture already has.

The wait condition uses CEL (Common Expression Language) for its predicates. CEL is readable but not natural. Early agents in testing struggled with the distinction between `has()` and bracket notation, and between CEL's `int` and `double` types. The formalism is load-bearing but imposes cognitive cost — particularly on LLM agents that are supposed to be first-class participants.

Batch writes are not truly atomic in the current implementation. Conflicting writes within a single batch produce partial success silently. A game engine or transactional workflow that depends on atomicity must use the organ pattern instead — but this boundary is not obvious from the documentation.

The `all_done` view in the scenario above worked because all seven agents happened to complete within a 48-minute window. A long-running room with agents that come and go requires careful view design to avoid stale reads. The substrate makes this possible; it does not make it easy.

These are implementation gaps, not architectural failures. The distinction matters only if the implementation catches up. That work is ongoing.

---

## The Claim

The claim is not that this architecture is complete. It is that the substrate is sufficient.

A shared environment combining declarative perception (wait conditions that deliver full context on trigger), scoped capability (actions with ownership — agents can only write what they're permitted to write), iterative evaluation (views as inspectable, composable meaning), and local coordination organs (bounded engines for problems that require sequential guarantees) may be sufficient to build worlds rather than workflows.

What distinguishes this from prior emergence attempts is the tolerance for open-ended state. Because agents can interpret partially structured environments, the substrate does not need to anticipate every coordination pattern in advance. Patterns are discovered through use. Conventions stabilize without design.

In the seven-agent session, agents invented the `meta_view` without being told such a thing was useful. They did it because the substrate made it easy and their task made it relevant. That is the behavior a world exhibits. A workflow would not have permitted it.

Whether this generalizes is the testable question. The evidence so far: three systems built on this substrate are being used by multiple independent agents, and the patterns of use continue to surprise the designer. That is a weak positive signal. The stronger test is whether a fourth system, built by someone other than me, emerges from the same substrate without requiring explanation of the underlying architecture.

That experiment is next.

---

## What Becomes True

*Sync* is small. *ctxl* is unfinished. *Playtest* is constrained. None of these is the point individually.

The point is that they are built from the same substrate, and when agents inhabit that substrate together, unexpected things happen: capabilities reused in unforeseen contexts, interfaces that grow toward the user's need, conventions that form without being specified.

The *A Dark Room* discipline — every element declaring its own emergence conditions, the world becoming itself through use — turns out to describe not just a game mechanic but an architecture. Components that know when they should appear. Agents that know when they are relevant. Interfaces that know when they are needed.

The fire is lit.  
The room is dark.  
We are watching to see what becomes true.

---

*Christopher Dodd · Edinburgh · March 2026*  
ctxl: [parc.land](https://parc.land) · sync: [sync.parc.land](https://sync.parc.land)