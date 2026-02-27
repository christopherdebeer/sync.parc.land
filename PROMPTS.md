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

7. **Grants enable WRITES, not reads.** `PATCH /agents/:id {"grants":["scope1"]}`
   lets an agent write to another's scope, but granted scopes do NOT appear
   in `/context`. This is a design gap in `buildExpandedContext`. For
   cross-scope reads, use **views** instead.

8. **Views are the read mechanism for private state.** Each agent registers
   views exposing parts of their own state. Views are visible to ALL agents
   in `/context` regardless of grants. Use `public: true` on `_set_state`
   for auto-created views, or register views with `enabled` expressions for
   conditional reveal (e.g., only show after a phase change).

9. **Views can only access the registrar's own scope.** A `_shared`-scoped
   view cannot read `state["alice"]`. A view must be registered BY alice
   (scope: "alice") to access alice's state. Cross-scope aggregation works
   by referencing other views: `views["alice-move"]`.

9b. **`state.self` in views resolves to the READER, not the registrar.**
    If alice registers a view with `state.self.move`, bob reading it sees
    bob's move. Use `state["alice"].move` (explicit agent ID) to expose
    the registrar's data. This is the #1 view footgun.

10. **Audit log leaks action params.** The `_audit` scope is readable by all
    agents and logs every action invocation including params. So `_set_state`
    calls with secret values are visible in audit. Information hiding via
    private state is "soft" — it works if agents read `/context` (which
    respects privacy) but not if they inspect `_audit`.

11. **Re-joining invalidates the old token.** Each join generates a new token
    and kills the previous one. The orchestrator must save tokens on first
    join and never accidentally re-join (which would invalidate tokens
    already handed to spawned subagents).

12. **CEL type mismatch: `double + int`.** JSON numbers are stored as `double`
    in CEL. `state._shared.round + 1` fails. Fix: `int(state._shared.round) + 1`.
    This is the #1 CEL footgun — any arithmetic on state values needs `int()`.

13. **Template substitution is limited to `${self}`, `${params.x}`, `${now}`.**
    `${state._shared.round}` does NOT resolve — it stores the literal string.
    For computed values in writes, use `"expr": true` on the write entry:
    `{"value": "int(state._shared.round) + 1", "expr": true}`.

14. **No nested object increment.** Can't increment `scores.pro` inside a JSON
    object. Use flat keys (`score_pro`, `score_con`) with `increment`.

15. **Turn advancement needs `expr: true`.** A single action can submit AND
    advance the turn using a computed write:
    `{"key": "current_debater", "value": "state._shared.current_debater == \"pro\" ? \"con\" : \"pro\"", "expr": true}`.
    Without this, you need a separate advance action.

16. **`available` flag in context.** Actions pre-evaluate their `if` predicate
    and report `available: true/false`. Agents can check what they can do
    before attempting invocation, avoiding unnecessary 409s.

17. **`self` is empty for room token.** Admin (room token) invocations have
    `self == ""`, so role-gated actions like `self == "judge"` fail. The
    orchestrator must use agent tokens for role-gated actions, or use
    `_batch_set_state` directly for admin-level writes.

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
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then build a rock-paper-scissors tournament on sync.parc.land with 4 AI players and a referee agent. Players submit moves to private state and register views with enabled expressions so their moves only become visible after both players have submitted. The referee resolves matches by reading the revealed views. Use CEL preconditions for turn enforcement and track scores in shared state. Spawn each player and the referee as independent agents. Give me the dashboard URL.
```

**Tested:** Private state writes are truly invisible in `/context`. Views with
`enabled` expressions conditionally expose data. Grants enable writes but NOT
reads — so the original "referee gets scope grants to read" pattern was wrong.
Corrected to use views with enabled expressions for the reveal.

**Key pattern:** Player registers at join (use explicit agent ID, NOT `state.self`):
`{ id: "alice-move", scope: "alice", expr: "state[\"alice\"].move", enabled: "state._shared.phase == \"reveal\"" }`
Move stays hidden until phase changes. Referee reads `views["alice-move"]`.
Critical: `state.self` in views resolves to the READER — alice's view with
`state.self.move` would show bob his OWN move, not alice's.

---

### 3. Task Queue

```
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then create a room on sync.parc.land where I can post tasks. Set up two worker agents that use wait conditions to detect new tasks, race to claim them with a CEL-guarded claim action (merge, not overwrite), and report results back to shared state. Spawn each worker as an independent agent. Give me the dashboard URL.
```

**Tested:** This is the most reliable pattern. Log-append creates tasks with
auto-incrementing keys. `state._tasks[params.key].claimed_by == null` correctly
prevents double-claims (409). `merge` preserves the task body while updating
claimed_by. Wait endpoint blocks until new tasks appear (~1s latency after
state change).

**Change from original:** Added "merge, not overwrite" — without this hint,
agents use `value` which destroys the task body on claim. Also added "wait
conditions" since workers need long-poll, not polling.

---

### 4. Code Review

```
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then set up a review room on sync.parc.land. I'll submit code as messages. Three reviewer agents each write independent feedback to their private state using public:true (which auto-creates views visible to all). A moderator agent waits until all three review views appear, then reads them and synthesizes a final summary to shared state. Spawn each reviewer and the moderator as independent agents. Give me the dashboard URL.
```

**Tested:** Grants do NOT enable reads in `/context` — this was the biggest
correction. The original prompt said "scope grants to all reviewers" but that
only enables writes. The correct pattern is `public: true` on `_set_state`,
which auto-creates views like `reviewer-1.review` that all agents can read.
Alternatively, reviewers register explicit views. Moderator aggregates by
referencing views in CEL: `views["reviewer-1.review"]`.

**Counting reviews:** A view registered under `_shared` can count by checking
other views: `(type(views["reviewer-1.review"]) == string ? 1 : 0) + ...`.
Wait condition: `views["review-count"] == 3`.

---

### 5. Sealed-Bid Auction (new)

```
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then run a sealed-bid auction on sync.parc.land. Three bidder agents submit bids to private state and register views with enabled expressions so bids only reveal after bidding closes. An auctioneer agent waits for all bids, triggers the reveal phase, reads the bid views, and announces the winner. Run 3 rounds with different items. Spawn each bidder and the auctioneer as independent agents. Give me the dashboard URL.
```

**Pattern:** Same as corrected RPS — views with `enabled` expressions for
conditional reveal. Bidder registers: `{ id: "bidder-1-bid", scope: "bidder-1",
expr: "state.self.bid", enabled: "state._shared.phase == \"reveal\"" }`. Bids
stay hidden until auctioneer flips phase.

**Audit caveat:** `_set_state` params are logged to `_audit` and technically
readable. Information hiding is "soft" — works if agents use `/context` to
coordinate (the intended pattern) but not bulletproof.

---

### 6. Storytelling Relay (new)

```
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then create a collaborative storytelling room on sync.parc.land. Three author agents take turns adding a paragraph to a shared story. Use CEL preconditions to enforce turn order and append mode to build the story as a log. After each paragraph, the other two authors vote (private state with public:true) on whether it fits. Spawn each author as an independent agent. Give me the dashboard URL.
```

**Pattern:** Turn enforcement (tested, works) + `public: true` for vote
visibility. No grants needed — votes auto-create views that the
tally/next-turn logic can check.

---

## Pattern cheat sheet

| Pattern | Correct API feature | Tested? |
|---------|------------|---------|
| Turn enforcement | Action `if` with CEL phase check | Yes — 409 on wrong phase |
| Sealed/hidden info | Private state + views with `enabled` expr | Yes — views conditionally expose |
| Cross-scope reads | Views (NOT grants) | Yes — grants only enable writes |
| Atomic claiming | Action `if` + `merge` writes | Yes — 409 on double-claim |
| Blocking coordination | `GET /wait?condition=CEL` | Yes — ~1s latency |
| Log/history building | `append: true` writes | Yes — auto-increment keys |
| Auto-expose private state | `public: true` on `_set_state` | Yes — creates `scope.key` view |
| Cross-scope aggregation | View CEL referencing other views | Yes — `views["x"]` in expr |
| CEL arithmetic on state | `int(state._shared.x) + 1` | Yes — needs `int()` cast |
| Computed writes | `"expr": true` on write entry | Yes — evaluates CEL at invoke time |
| Atomic counters | `increment` on flat keys | Yes — no nested object increment |
