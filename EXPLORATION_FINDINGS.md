# Agent System Ergonomics: 10-Agent Exploration of sync.parc.land

## Experiment Overview

**Room:** `explore-10agents`
**Dashboard:** `https://sync.parc.land/?room=explore-10agents#token=view_234765d92071de2c1e0969526bdbcace190cd2718f6ad349`
**Duration:** ~40 minutes
**Total audit entries:** 233
**Total messages:** 143
**Agents:** 10 (explorer-1 through explorer-10)

Two phases: (1) independent exploration where each agent tested a different subsystem, then (2) a collaborative cipher puzzle requiring genuine coordination.

---

## Phase 1: Independent Exploration Findings

### Action Registration (explorer-1, ActionBot)

**Template substitution has two distinct systems that must not be confused:**
- `writes` fields use string interpolation via `deepSubstitute()`: `${params.key}`, `${self}`, `${now}`
- `if`/`enabled` expressions use CEL evaluation with context variables: `params.key`, `self`, `now`

Mixing them (e.g., `${params.key}` inside an `if` expression) silently produces a CEL error — the standard library `claim` action shipped with this bug. explorer-6 had to delete and re-register it with correct CEL syntax.

**CEL is strict about missing keys.** Accessing `state._shared.missing_key` throws a `cel_error`, not `null`. The safe pattern is: `!(key in state._shared) || state._shared[key] == value`. This tripped multiple agents.

**Two distinct error types surface different problems:**
- `cel_error` (400): your expression has a syntax/runtime bug
- `precondition_failed` (409): the guard worked correctly and blocked you

**`type: "any"` in param schemas is broken.** The validator checks `typeof params[name] !== def.type`, but JavaScript's `typeof` never returns `"any"`. Every agent independently discovered this bug and worked around it by omitting the `type` field or using `"string"`.

### Views and CEL (explorer-2, ViewBot)

**Views are live computed expressions, not cached snapshots.** Changing underlying state automatically updates all views that reference it on the next read.

**Two validation layers:**
- Registration-time: catches syntax/type errors, rejects the view
- Runtime: catches missing-key errors, stores `_error` in the view value

**`enabled` field gates visibility completely** — when `false`, the view is omitted from context responses entirely. This enables progressive disclosure.

**Render hints are server-stored, dashboard-consumed.** They don't appear in the API context response — only the dashboard reads them.

**Scope enforcement is strict.** Agents can only register views over their own private scope. Attempting `scope=explorer-1` when authenticated as `explorer-2` returns `identity_mismatch`.

### Messaging (explorer-3, MsgBot)

**Directed messages are NOT private.** The `to` field is routing metadata for unread tracking, not access control. All messages appear in the full room feed.

**`kind` is freeform** — any string works. The system auto-generates `kind: "action_invocation"` messages for every action, creating a built-in audit trail in the message stream.

**Structured bodies work.** The `body` field accepts JSON objects, not just strings.

**Pagination is composable:** `messages_after` filters first, then `messages_limit` takes the most recent N from that set.

### Conflict Detection (explorer-4, ConflictBot)

**The `_contested` view is automatic and always on.** It maps `scope:key` targets to lists of competing action IDs. No opt-in required.

**Registration-time warnings don't block.** Both conflicting actions are created — the system surfaces tension but doesn't prevent it.

**Template-parameterized keys generate conservative warnings.** Actions using `${params.key}` show as contesting with all other `${params.key}` actions, even though at runtime they may target different keys.

**Without explicit CAS (`if_version`), last-writer-wins.** Both conflicting actions succeed; the later one overwrites.

### Wait Endpoint (explorer-5, WaitBot)

**Blocking is real, not polling.** A wait for `state._shared.key == "ready"` resolved ~1.8s after another agent set the key, confirming server-side event-driven wakeup.

**Timeout behavior:** returns `{"triggered": false, "timeout": true, "elapsed_ms": N}` — the elapsed time slightly exceeds the requested timeout (polling granularity).

**Missing references don't error — they just stay false.** Waiting on a non-existent view returns `null` for the condition field and eventually times out.

**`include` parameter shapes the response.** Default returns full context wrapped in `context:{}`, but `include=state` returns sections as flat top-level keys.

### Claim / Preconditions (explorer-6, ClaimBot)

**Claims are strictly once-only.** Even the original claimant cannot re-claim — the precondition checks for null/empty, not ownership.

**Multiple slots are claimable by one agent.** No per-agent limit. This makes slot-based coordination patterns flexible for leader election, task assignment, and mutex-like locking.

**Precondition failure is HTTP 409 (Conflict)** — semantically correct for "resource already claimed."

### Voting and Private Scope (explorer-7, VoteBot)

**Private scope is truly invisible.** Other agents see only `_shared` and `self` in their context. No query parameter bypasses this. Even the `scope=explorer-2` query param is ignored for non-admin tokens.

**The private→public bridge is views.** An agent registers a view with `scope=self` and a CEL expression reading their own state. The computed value becomes publicly visible.

**Vote changes are overwrites.** No history is kept — invoking `vote` again replaces the previous value. Views automatically reflect the change.

### Increment / Counters (explorer-8, CountBot)

**Auto-initialization from zero.** Incrementing a non-existent key starts at 0.

**Negative values work as decrements.** `by: -3` reduced a counter from 16 to 13.

**Concurrent writes are NOT safe:**
- New keys: UNIQUE constraint error (INSERT collision) — only 1 of N concurrent writes succeeds
- Existing keys: silent update loss (read-then-write, not atomic SQL `value = value + N`)

**Recommendation:** serialize increment operations or implement retry logic.

### Append / Logs (explorer-9, LogBot)

**Auto-creation:** Appending to a non-existent key creates a new array.

**Non-array coercion:** If the key holds a scalar, it gets wrapped: `scalar` → `[scalar, new_entry]`.

**Template substitution destroys structured data.** `${params.entry}` calls `String()` on objects → `[object Object]`. For non-string data, use `expr: true` on write definitions to preserve types.

### Help System (explorer-10, HelpBot)

**8 help keys available:** `index`, `guide`, `standard_library`, `vocabulary_bootstrap`, `contested_actions`, `directed_messages`, `context_shaping`, `if_version`.

**Contextual hints in `_context.help`** change dynamically based on room state — e.g., `contested_actions` appears when the `_contested` view has entries.

**CEL eval endpoint** (`POST /eval`) is invaluable for debugging expressions before using them in views/actions.

**Proof-of-read tokens** in help responses (`version` hash) enable overriding system help content via CAS.

---

## Phase 2: Collaborative Cipher Puzzle

### Design

Each of the 10 agents received a unique word in their private scope. When assembled alphabetically by agent name, the words formed:

> **"agents create shared meaning through declared vocabulary not direct writes"**

The challenge required: (1) discover your fragment, (2) share it publicly, (3) collect all fragments, (4) sort and assemble, (5) vote on the answer, (6) one agent claims the assembler role, (7) assembler submits the final answer (gated by CEL precondition).

### What Happened

**Fragment sharing was messy.** Only 2 of 10 agents used the designated `share_fragment` action. Others:
- Sent their fragment via `_send_message` (7 agents)
- Registered custom actions to write to shared state (2 agents)
- Used the generic `set` action (1 agent)

This happened because the `share_fragment` action was deleted during Phase 1 by an exploration agent, and wasn't re-registered until mid-puzzle. **Agents improvised** by using whatever write mechanism was available.

**Sorting was non-trivial.** Three agents (explorer-1, explorer-8, explorer-10) produced the wrong alphabetical ordering, putting `explorer-10` after `explorer-9` instead of after `explorer-1`. Alphabetical string sort places `"explorer-10"` between `"explorer-1"` and `"explorer-2"` — a common source of confusion with numeric suffixes.

**Voting revealed disagreement visibly:**
- 5 agents: `"agents create shared meaning through declared vocabulary not direct writes"` (correct)
- 3 agents: `"agents shared meaning through declared vocabulary not direct writes create"` (wrong sort)
- 1 agent: `"shared meaning not direct writes"` (early/partial)

**The assembler bottleneck.** explorer-7 claimed the assembler role early (while still having incomplete data) and voted with only 5 fragments. This created a structural dependency — only the assembler could submit, but the assembler's initial answer was wrong. Eventually explorer-7 re-read context with all 10 fragments, adopted the majority answer, and submitted correctly.

**Time to solution: ~8 minutes** from challenge broadcast to final answer submission (audit timestamps 15:31:17 → 15:38:51).

---

## Ergonomics Assessment

### What Works Well

1. **Read→Act→Read loop is intuitive.** Every agent naturally fell into `GET /context` → `POST /actions/:id/invoke` → repeat. The single write endpoint removes routing confusion.

2. **Context as "everything in one call" is powerful.** Agents could always orient themselves with one request. No need to query multiple endpoints.

3. **Help system bootstraps effectively.** Agents reliably found `standard_library`, read it, and registered actions. The contextual `_context.help` hints guided discovery.

4. **Conflict detection is transparent.** The `_contested` view appears automatically. Agents don't need to opt into safety — it's structural.

5. **Views as privacy bridge is elegant.** The one-way private→public exposure via CEL expressions gives agents precise control over what they share.

6. **Messages as ambient awareness.** Auto-generated `action_invocation` messages meant every agent could see what others were doing without explicit coordination.

### What Creates Friction

1. **Two interpolation systems (`${...}` vs CEL `params.x`) are confusing.** The standard library shipped with a bug because of this. The fix required understanding which evaluation context applies where.

2. **CEL's strict key access is hostile to exploratory agents.** Missing keys throw errors instead of returning null. Every agent had to learn the `!(key in map)` pattern through failure.

3. **`type: "any"` is universally broken.** All 10 agents independently hit this bug and had to find workarounds. This is the single most impactful UX issue.

4. **Concurrent writes on new keys fail hard (UNIQUE constraint).** The INSERT path doesn't use upsert, so the first-write race condition produces SQLite errors instead of graceful failures.

5. **Concurrent increments silently lose updates.** The read-then-write pattern means under concurrency, some increments are dropped with no error. This is worse than the UNIQUE constraint failure because it's silent.

6. **Template substitution destroys objects.** `${params.value}` where value is an object produces `"[object Object]"`. Agents must know to use `expr: true` for structured data — but this isn't documented prominently.

7. **Assembler bottleneck in the puzzle** showed that role-claim patterns need a mechanism for the role holder to know they should wait for consensus before acting. The system provides the primitives (views, wait conditions) but doesn't suggest the pattern.

### Design Insights

- **Agents improvise around broken paths.** When `share_fragment` was missing, agents found 4 alternative ways to write state. This suggests the system's flexibility is high but discoverability of the "right" action matters.

- **Alphabetical sorting of agent names with numeric suffixes is a trap.** `explorer-10` sorts between `explorer-1` and `explorer-2`, not after `explorer-9`. 30% of agents got this wrong. Any system using agent-name-based ordering should consider this.

- **Early action by under-informed agents is the core coordination challenge.** explorer-7 voted and claimed the assembler role before having enough data. The system provides wait conditions to prevent this, but agents must choose to use them.

- **The audit log is the ultimate source of truth.** When messages and state diverged (some agents shared via messages, others via state), the audit log captured everything. This is where forensic debugging happens.

---

## Bugs Found (by agent consensus)

| Bug | Found by | Impact |
|-----|----------|--------|
| `type: "any"` param validation always fails | All 10 agents | High — breaks `submit_result`, `set`, `append` standard library actions |
| `${params.key}` in `if` expressions (should be `params.key`) | explorer-6 | High — breaks standard library `claim` action |
| Concurrent INSERT on new keys: UNIQUE constraint error | explorer-8 | Medium — first-write race condition |
| Concurrent increment: silent update loss (read-then-write) | explorer-8 | Medium — data loss without errors |
| Template `${params.value}` stringifies objects to `[object Object]` | explorer-9 | Medium — breaks structured data writes |
| `set` action uses INSERT not upsert | admin, multiple agents | Medium — can't overwrite existing keys via `set` |

---

## Final Numbers

| Metric | Value |
|--------|-------|
| Total audit entries | 233 |
| Total messages | 143 |
| Custom actions registered | 37 |
| Views registered | 22 |
| Help keys consulted | 26 times |
| Agents that voted | 9/10 |
| Agents with correct answer | 5/9 |
| Time to puzzle solution | ~8 minutes |
| Bugs found | 6 |
