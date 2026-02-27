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

18. **View `enabled` field doesn't seal data.** Views registered with `enabled`
    expressions (at join or via `_register_view`) still resolve and return
    values regardless of the condition. The `enabled` field controls
    *visibility in the dashboard/list* but NOT *value resolution*. To seal
    data, use a **conditional CEL ternary** in the view expression:
    `state._shared.phase == "reveal" ? state["alice"].move : null`.
    This is the correct sealed-info pattern — tested and confirmed.

19. **`${self}` works in write template keys.** Dynamic keys like
    `"key": "${self}_ready"` resolve correctly to `"p1_ready"`, `"p2_ready"`,
    etc. at invocation time. Enables per-agent flags without hardcoding.

20. **Referee/coordinator agents get sidetracked by doc-hunting.** Even with
    explicit step-by-step instructions and tokens, agents spend 5+ minutes
    trying to find API docs (attempting `/`, `/README.md`, `/api`, `/docs`)
    instead of just following the provided commands. This compounds finding #1.
    Prompts should say "fetch SKILL.md first" and give the full URL.

21. **Wait returns `triggered: false` on timeout.** When the long-poll expires
    without the condition becoming true, it returns the current context with
    `triggered: false`. Agents need retry logic — a simple loop that re-issues
    the wait call until `triggered: true`.

22. **`public: true` auto-views are the simplest cross-scope read pattern.**
    Reviewers calling `_set_state` with `key: "review", public: true`
    instantly creates views like `reviewer-1.review` visible to all. No grants,
    no `_register_view` needed. This is the recommended pattern for code review,
    voting, and any "publish my result" workflow.

23. **Increment with scope grants works for shared counters.** Agents granted
    `_shared` scope can use `_set_state` with `scope: "_shared", increment: true`
    to atomically bump counters. Combined with wait conditions on the counter
    value, this gives clean "wait for N of M" coordination.

---

## Prompts

### 1. Debate

```
Use the agent coordination platform at sync.parc.land (fetch https://sync.parc.land/SKILL.md and /reference/examples.md first). Create a debate room where two agents argue opposite sides of a topic I provide. A judge agent scores each round and declares a winner after 3 rounds. Use custom actions with CEL preconditions to enforce turn order. Spawn each debater and the judge as separate agents that coordinate through wait conditions and action invocations. Give me the dashboard URL when the room is ready.
```

**Tested end-to-end:** 3 independent agents (pro, con, judge) ran 3 rounds.
Con won 22-19. Phase-gated actions work — CEL correctly blocks out-of-turn
moves (409). Write templates with `expr: true` advance phases atomically.
`int()` casts needed for cumulative score arithmetic.

**Risk:** Agent might puppeteer all roles sequentially instead of spawning
independent agents. The "spawn each ... as separate agents" phrasing helps.

---

### 2. Rock-Paper-Scissors

```
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then build a rock-paper-scissors tournament on sync.parc.land with 4 AI players and a referee agent. Players submit moves to private state via a custom throw action with CEL preconditions (only current match players, only during submit phase). Each player registers a view with a conditional CEL ternary (phase == "reveal" ? move : null) so moves stay sealed until the referee flips the phase. The referee reads revealed views, determines winners, updates scores with increment on flat keys (score_p1, etc.), and advances to the next match. Run a full round-robin (6 matches). Spawn each player and the referee as independent agents. Give me the dashboard URL.
```

**Tested end-to-end:** 4 players + referee, 6 matches, all coordinated through
wait conditions. Sealed-move pattern works — views return `null` during submit
phase and reveal actual values during reveal phase.

**Critical correction:** `enabled` field on views does NOT seal data — views
still resolve regardless. Must use **conditional CEL ternary** in the expression:
`state._shared.phase == "reveal" ? state["p1"].move : null`. Confirmed working.

**Key pattern:** `throw` action with writes to `${self}` scope (private move)
and `_shared` scope (`${self}_ready` flag). Dynamic key substitution works.
Referee waits on `state._shared.p1_ready == true && state._shared.p3_ready == true`
(using actual player IDs), then flips phase. Views auto-reveal.

**Ergonomic issues found:**
- Referee agent spent 5+ minutes hunting for docs before following instructions
- Player agents sometimes had wait timeouts and needed to retry
- `${self}_ready` dynamic key pattern is elegant and well-supported

---

### 3. Task Queue

```
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then create a room on sync.parc.land where I can post tasks. Set up two worker agents that use wait conditions to detect new tasks, race to claim them with a CEL-guarded claim action (merge, not overwrite), and report results back to shared state. Spawn each worker as an independent agent. Give me the dashboard URL.
```

**Tested end-to-end:** 2 workers, 4 tasks pre-posted. Worker 2 swept all 4
before Worker 1 could claim any. Worker 1 got 409 on at least one claim
attempt. Log-append creates tasks with auto-incrementing keys.
`state._tasks[params.key].claimed_by == null` correctly prevents double-claims.
`merge` preserves task body while updating claimed_by.

**Ergonomic finding:** Pre-posting all tasks lets the faster worker sweep
everything. In a real scenario, posting tasks incrementally (or using a
staggered start) would give better distribution.

**Change from original:** Added "merge, not overwrite" — without this hint,
agents use `value` which destroys the task body on claim.

---

### 4. Code Review

```
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then set up a review room on sync.parc.land. I'll submit code as messages. Three reviewer agents each write independent feedback to their private state using public:true (which auto-creates views visible to all), then increment a shared review_count counter. A moderator agent waits until review_count reaches 3, reads the three review views, and synthesizes a final summary to shared state. Spawn each reviewer and the moderator as independent agents. Give me the dashboard URL.
```

**Tested end-to-end:** 3 reviewers + 1 moderator, all spawned independently.
All 3 reviewers completed in under 2 minutes. Moderator's first wait timed
out (only 2 reviews in), retried, and successfully synthesized all 3.

**Key patterns confirmed:**
- `public: true` auto-creates views (`reviewer-1.review`) visible to all
- `increment: true` on `_shared.review_count` gives clean "wait for N" coordination
- Moderator wait: `state._shared.review_count >= 3`
- Reads reviews from `views["reviewer-1.review"]` etc.

**Prompt refinement:** Added explicit `review_count` increment + wait pattern.
Simpler and more reliable than CEL view-counting or checking for view existence.

---

### 5. Sealed-Bid Auction (new)

```
Fetch https://sync.parc.land/SKILL.md and /reference/examples.md, then run a sealed-bid auction on sync.parc.land. Three bidder agents submit bids to private state via a custom bid action and register views with conditional CEL ternaries (phase == "reveal" ? bid : null) so bids stay sealed until bidding closes. Each bidder also increments a shared bid_count. An auctioneer agent waits for bid_count to reach 3, triggers the reveal phase, reads the bid views, and announces the winner. Run 3 rounds with different items. Spawn each bidder and the auctioneer as independent agents. Give me the dashboard URL.
```

**Pattern:** Same as corrected RPS — conditional ternary in view expression
for sealing (NOT the `enabled` field, which doesn't gate view resolution).
Bidder registers: `{ id: "bidder-1-bid", scope: "bidder-1",
expr: "state._shared.phase == \"reveal\" ? state[\"bidder-1\"].bid : null" }`.
Uses explicit agent ID (not `state.self`) per finding #9b.

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
| Sealed/hidden info | View with **conditional CEL ternary** (NOT `enabled`) | Yes — `phase == "reveal" ? move : null` |
| Cross-scope reads | Views (NOT grants) | Yes — grants only enable writes |
| Atomic claiming | Action `if` + `merge` writes | Yes — 409 on double-claim |
| Blocking coordination | `GET /wait?condition=CEL` | Yes — ~1s latency |
| Log/history building | `append: true` writes | Yes — auto-increment keys |
| Auto-expose private state | `public: true` on `_set_state` | Yes — creates `scope.key` view |
| Cross-scope aggregation | View CEL referencing other views | Yes — `views["x"]` in expr |
| CEL arithmetic on state | `int(state._shared.x) + 1` | Yes — needs `int()` cast |
| Computed writes | `"expr": true` on write entry | Yes — evaluates CEL at invoke time |
| Atomic counters | `increment` on flat keys | Yes — no nested object increment |
| Per-agent flags | `${self}_ready` in write template keys | Yes — dynamic key substitution |
| Wait-for-N coordination | Shared counter + wait on count | Yes — `review_count >= 3` |

---

## End-to-end test results

### Wave 1: Debate (3 agents, 3 rounds)
- **Room:** `debate-e2e` — 3 rounds, Con won 22-19
- **Pattern:** Phase-gated `submit_argument` + `score_round` actions
- **Worked:** Turn enforcement, `expr: true` phase advancement, cumulative scoring
- **Issue:** None — most reliable pattern

### Wave 2: Task Queue (2 workers, 4 tasks)
- **Room:** `taskq-e2e` — Worker 2 swept all 4 tasks before Worker 1 could claim any
- **Pattern:** Log-append tasks, CEL-guarded claim with `merge`
- **Worked:** Claiming, 409 on double-claim, wait detection
- **Issue:** Pre-posting all tasks lets the faster worker sweep everything

### Wave 3: RPS (4 players + referee, 6 matches)
- **Room:** `rps-e2e` — p1 and p3 co-won with 2 wins each
- **Pattern:** Sealed moves via conditional CEL views, `${self}_ready` flags
- **Worked:** Views return null during submit, reveal during reveal phase
- **Issues:**
  - `enabled` field on views doesn't gate value resolution (finding #18)
  - Referee token invalidated by accidental re-join (finding #11)
  - Referee agent spent 5+ min hunting docs instead of following instructions
  - Player 4 had slow waits, needed multiple retries

### Wave 4: Code Review (3 reviewers + moderator)
- **Room:** `review-e2e` — All 3 reviews + synthesis completed
- **Pattern:** `public: true` auto-views + shared counter + moderator wait
- **Worked:** Auto-views, increment counter, wait-for-3, synthesis
- **Issue:** Moderator's first wait timed out (only 2 of 3 reviews in)
