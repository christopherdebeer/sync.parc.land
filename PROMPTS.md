# sync.parc.land — Starter Prompts

## Findings from live testing

Tested each pattern against the real API. Key findings that informed the
refinements:

1. **#1 failure mode: agents can't find the docs.** They search `/`,
   `/README.md`, `/api`, `/help` — none work. Only `/SKILL.md` has the
   API reference. The reference docs at `/reference/examples.md` are also
   critical. Every prompt must explicitly say to fetch SKILL.md.

2. **CEL `has()` doesn't work for map key checks.** Use `"key" in map`
   instead. e.g. `"review" in state["reviewer-1"]` not
   `has(state["reviewer-1"].review)`.

3. **`merge` is essential for claiming patterns.** Using `value` in write
   templates overwrites the entire object. `merge` updates specific fields
   while preserving the rest (like `body`).

4. **Log-append keys are auto-incrementing strings** — `"1"`, `"2"`, `"3"`.
   Predictable and referenceable in CEL via `state._tasks[params.key]`.

5. **Agents must be spawned independently** to get real concurrency. A single
   orchestrator puppeteering all tokens sequentially works but isn't
   impressive. Spawn each agent as a separate subagent with its own token
   and a wait loop.

6. **Wait/long-poll works well.** Blocks until CEL condition becomes true,
   returns full context. This is how spawned agents should coordinate —
   not by polling.

7. **Scope grants work.** `PATCH /agents/:id {"grants":["scope1"]}` lets
   an agent read another's private state. Essential for referee/moderator
   patterns.

8. **Re-joining an existing agent returns the token.** Token management is
   still the trickiest part for agents — they must save tokens from join
   responses carefully.

---

## Prompts

### 1. Debate

```
Use the agent coordination platform at sync.parc.land (fetch https://sync.parc.land/SKILL.md and /reference/examples.md first). Create a debate room where two agents argue opposite sides of a topic I provide. A judge agent scores each round and declares a winner after 3 rounds. Use custom actions with CEL preconditions to enforce turn order. Spawn each debater and the judge as separate agents that coordinate through wait conditions and action invocations. Give me the dashboard URL when the room is ready.
```

**Tested:** Phase-gated actions work — CEL `state._shared.phase == "pro_argument"` correctly blocks out-of-turn moves and returns 409. Write templates correctly advance the phase.

**Risk:** Agent might puppeteer all roles sequentially instead of spawning independent agents. The "spawn each ... as separate agents" phrasing tries to prevent this.

---

### 2. Rock-Paper-Scissors

```
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then build a rock-paper-scissors tournament on sync.parc.land with 4 AI players and a referee agent. Players submit moves to private state. The referee gets scope grants to read moves and resolve matches. Use CEL preconditions for turn enforcement and track scores in shared state. Spawn each player and the referee as independent agents. Give me the dashboard URL.
```

**Tested:** Private state writes are truly invisible to other agents. Scope grants correctly expose private state to granted agents. The sealed-move → grant → reveal pattern works end-to-end.

**Risk:** Original didn't mention private state or grants, so agents might put moves in shared state (defeating the purpose). Added "private state" and "scope grants" as hints.

---

### 3. Task Queue

```
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then create a room on sync.parc.land where I can post tasks. Set up two worker agents that use wait conditions to detect new tasks, race to claim them with a CEL-guarded claim action (merge, not overwrite), and report results back to shared state. Spawn each worker as an independent agent. Give me the dashboard URL.
```

**Tested:** This is the most reliable pattern. Log-append creates tasks with auto-incrementing keys. `state._tasks[params.key].claimed_by == null` correctly prevents double-claims (409). `merge` preserves the task body while updating claimed_by. Wait endpoint blocks until new tasks appear (~1s latency after state change).

**Change from original:** Added "merge, not overwrite" — without this hint, agents use `value` which destroys the task body on claim. Also added "wait conditions" since workers need long-poll, not polling.

---

### 4. Code Review

```
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then set up a review room on sync.parc.land. I'll submit code as messages. Three reviewer agents each write independent feedback to their private state. A moderator agent with scope grants to all reviewers synthesizes their reviews into a final summary. Use wait conditions so the moderator blocks until all reviews are in. Spawn each reviewer and the moderator as independent agents. Give me the dashboard URL.
```

**Tested:** Scope grants work — `PATCH /agents/moderator {"grants":["reviewer-1","reviewer-2","reviewer-3"]}` lets moderator see all private reviews. CEL for counting reviews: use `"review" in state["reviewer-1"]` (not `has()`). Views scoped to _shared can read granted private state.

**Change from original:** Made scope grants explicit. Original said "private state" but didn't mention how the moderator reads them. Without the grants hint, agents try to use views or messages as workarounds.

---

### 5. Sealed-Bid Auction (new)

```
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then run a sealed-bid auction on sync.parc.land. Three bidder agents submit bids to their private state. An auctioneer agent with scope grants reveals the winner after all bids are in. Run 3 rounds with different items. Spawn each bidder and the auctioneer as independent agents. Give me the dashboard URL.
```

**Why this is strong:** Same proven pattern as RPS (private state → grants → reveal) but more dramatic. Bidding is universally understood. The "who won?" reveal moment is inherently compelling in the dashboard audit log.

---

### 6. Storytelling Relay (new)

```
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then create a collaborative storytelling room on sync.parc.land. Three author agents take turns adding a paragraph to a shared story. Use CEL preconditions to enforce turn order and append mode to build the story as a log. After each paragraph, the other two authors vote (private state) on whether it fits. Spawn each author as an independent agent. Give me the dashboard URL.
```

**Why this is strong:** Produces a readable creative artifact. Turn enforcement + private voting combines two tested patterns. The growing story in the dashboard is visually satisfying.

---

## Pattern cheat sheet

| Pattern | API feature | Tested? |
|---------|------------|---------|
| Turn enforcement | Action `if` with CEL phase check | Yes — 409 on wrong phase |
| Sealed/hidden info | Private state + scope grants | Yes — grants expose state |
| Atomic claiming | Action `if` + `merge` writes | Yes — 409 on double-claim |
| Blocking coordination | `GET /wait?condition=CEL` | Yes — ~1s latency |
| Log/history building | `append: true` writes | Yes — auto-increment keys |
| Computed projections | Views with CEL `expr` | Partially — basic views work |
