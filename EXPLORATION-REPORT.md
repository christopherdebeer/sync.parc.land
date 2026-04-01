# agent-sync API Ergonomics Report

**Room:** `claude-exploration`
**Dashboard:** https://c15r--019c9231f70f7754b733e1b3e12d3423.web.val.run/?room=claude-exploration
**Date:** 2026-02-25
**Method:** 5 autonomous Claude sub-agents explored the API in parallel, each with a different role and focus area, coordinating through the sync room itself.

## Agents & Focus Areas

| Agent | Role | Focus | API Calls | Duration |
|-------|------|-------|-----------|----------|
| **Architect** | coordinator | State design, views, CEL eval, /wait | 56 | ~10 min |
| **Explorer** | scout | CAS, increment, conditional writes, conflicts | 43 | ~8 min |
| **Timekeeper** | timer-specialist | Wall-clock/logical timers, cooldowns, renewal | 56 | ~11 min |
| **Messenger** | courier | Messages, claims, threads, filtered queries | 46 | ~10 min |
| **Tactician** | strategist | Actions, params, enabled, scoped writes | 97 | ~19 min |

**Total: 298 API calls, 6 discoveries logged, 46KB of room state generated.**

---

## Overall Rating: Excellent (8.5/10)

The agent-sync API is exceptionally well-designed for multi-agent coordination. All 5 agents independently rated it "excellent." The API surface is coherent, errors are rich and actionable, and the primitives compose cleanly.

---

## Top Strengths

### 1. Best-in-class error responses
Every error type returns structured, actionable context:
- **409 CAS conflict** returns the *full current state* of the conflicting key — eliminates a retry round-trip
- **409 precondition_failed** echoes back the CEL expression and its evaluated result
- **403 scope_denied** shows both the denied scope AND the agent's actual grants
- **400 invalid_param** lists the allowed enum values
- **CEL parse errors** include caret-positioned source location (`^`)

### 2. Actions as cross-scope capability bridge
The scoped action system is the standout design feature. Agents can only write to their own scope, but actions registered by privileged users carry the registrar's authority. This creates a clean capability-based security model:
```
Architect registers action → writes to _shared scope
Explorer invokes action → _shared state updated (delegated authority)
Explorer tries direct write to _shared → 403 denied
```

### 3. Composable temporal primitives
Two effects (`delete`, `enable`) x two clock types (`ms`/`at` wall-clock, `ticks`/`tick_on` logical-clock) cover every temporal pattern:
- **Ephemeral state**: `timer: {ms: 10000, effect: "delete"}` — auto-vanishes
- **Delayed reveal**: `timer: {ms: 8000, effect: "enable"}` — dormant then appears
- **Turn-based expiry**: `timer: {ticks: 3, tick_on: "state._shared.turn", effect: "delete"}`
- **Action cooldown**: `on_invoke: {timer: {ms: 10000, effect: "enable"}}` — dormant after use, re-enables

### 4. /wait with `include` is a coordination superpower
```
GET /wait?condition=state._shared.phase == "scoring"&include=state,agents,views&timeout=25000
```
Returns a full snapshot when the condition triggers. During the wait, the agent's `status` changes to `"waiting"` with `waiting_on` showing the expression — visible to other agents. This creates natural observability.

### 5. expand_params for action availability
```
GET /actions?expand_params=true
→ availability_by_param: { item: { trap: {available: true}, hut: {available: false} } }
```
Per-enum-value availability computed server-side — a killer feature for building agent UIs.

### 6. Atomic increment without CAS overhead
```
PUT /state { "key": "counter", "value": 1, "increment": true }
```
No version conflicts, no read-modify-write. Server adds deltas atomically.

---

## Bugs Found

### 1. Template substitution inconsistency (Messenger agent)
`${params.X}` template interpolation works in action write **keys** but values are stored literally unless `"expr": true` is set. The key `rating_${params.feature}` resolves to `rating_messages`, but the value `"${params.rating}"` is stored as the literal string `"${params.rating}"`.

**However**, the Tactician agent found that template interpolation **does** work in values in some cases. This inconsistency needs investigation.

### 2. Greedy template interpolation (Tactician agent)
`${self}` and `${now}` are interpolated in ALL string values during action invocation, including user-provided param content. Literal mentions of `${self}` in a message body were replaced with the agent ID. This could cause unexpected mutations in user data.

---

## Ergonomics Friction Points

### 1. Cooldown semantics are inverted
`on_invoke: {timer: {effect: "enable"}}` means "go dormant now, re-enable when timer expires." Agents expected `"disable"` for cooldown behavior. The naming reflects the timer's *eventual action* (enable), not its *immediate effect* (disable). Three agents independently struggled with this.

### 2. Cooldown error message is misleading
When an action is on cooldown (dormant via `enable` timer), the error is:
```json
{"error": "action not found (expired)"}
```
This suggests the action is permanently gone. Better: `"action on cooldown, available at <time>"` or `"action dormant (timer pending)"`.

### 3. CEL type coercion foot-gun
JSON numbers become `double` in CEL. Expressions like `state._shared.discoveries + 10` fail with `"no such overload: dyn<double> + int"`. Must use `10.0` or cast. This tripped up the Architect agent.

### 4. Verbose null fields in responses
Every state entry returns 7 timer columns and `enabled_expr`/`sort_key` even when null. A `?compact=true` or sparse representation would reduce payload sizes significantly.

### 5. enabled_expr + timer enable are independent gates
Both must pass for visibility. Setting `enabled: "1 == 0"` with `timer: {effect: "enable"}` means the key is *never* visible — the timer enables the timer gate, but the CEL gate still blocks. This interaction isn't documented and surprised the Timekeeper.

### 6. No /messages endpoint on deployed v5
The documentation references `POST /rooms/:id/messages`, but the deployed endpoint returns 404. Messages require either:
- State writes to `_messages` scope (needs room token — agents can't)
- Action-based messaging (agent invokes a pre-registered action)

This adds friction for basic agent-to-agent communication.

### 7. Shell escaping with CEL expressions
CEL expressions containing `==`, `\"`, and other shell-sensitive characters break inline curl `-d` strings. File-based JSON (`-d @file.json`) is the practical workaround, but this is a real ergonomic concern for CLI-driven agents.

---

## Recommendations

1. **Document the cooldown pattern prominently** — `on_invoke: {timer: {effect: "enable"}}` with a clear explanation of why "enable" means "cooldown"
2. **Add a cooldown-specific error response** — distinguish dormant-from-cooldown vs truly-not-found
3. **Fix template substitution** — apply `${params.X}` consistently to both keys and values, or document that `expr: true` is required for value interpolation
4. **Add `?compact=true`** — omit null fields from state responses
5. **Document enabled_expr + timer interaction** — both are independent visibility gates
6. **Consider CEL type helpers** — auto-coerce or provide `int()` / `double()` cast functions
7. **Scope `${self}` and `${now}` interpolation** — only apply to template-designated fields, not raw user strings

---

## The Collaboration Experience

The most striking finding: **the agents naturally coordinated through the system they were exploring.** The Architect registered actions that the Explorer and Tactician invoked. The Timekeeper set timers that affected state visibility for all agents. The Messenger created tasks that could be claimed. Each agent's `discoveries` increments were visible to others in real-time.

The `/wait` + `include` pattern is the key coordination primitive. An agent can say "wake me when X changes" and get a full state snapshot when it does. Combined with scoped actions for safe cross-agent writes, this creates a complete coordination toolkit.

The security model (scope isolation + delegated action authority) strikes the right balance: agents are sandboxed by default but can be granted specific capabilities through the action system. The room token serves as a root credential for bootstrapping.

**For LLM agents specifically**, the API is highly ergonomic: JSON in/out, CEL for server-side logic, atomic operations that avoid read-modify-write races, and rich error messages that enable self-correction without human intervention.
