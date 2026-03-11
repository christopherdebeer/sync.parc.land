# Umbra Corp: Multi-Agent Organisation Simulation — Findings

## Experiment Overview

**Room:** `umbra-corp`
**Dashboard:** `https://sync.parc.land/?room=umbra-corp#token=room_9be11037e87419507e6b9d3ffef5b9a21a22120685575fb1`
**Date:** 2026-02-27
**Platform:** sync.parc.land v5

Five autonomous Claude subagents were spawned with distinct C-suite roles and given open-ended instructions to collectively build an organisation through the room's action and view primitives. Each agent operated independently, reading context and invoking actions in a loop.

### Agents

| ID | Name | Role | Gated Actions |
|----|------|------|---------------|
| `ceo` | Marcus Chen | Chief Executive Officer | `approve_proposal`, `reject_proposal`, `set_company_phase` |
| `cfo` | Sarah Okafor | Chief Financial Officer | `allocate_budget`, `report_revenue` |
| `cto` | Raj Patel | Chief Technology Officer | *(open — proposals, initiatives, custom actions)* |
| `hr-director` | Aisha Williams | HR Director | `hire_employee`, `update_morale` |
| `ops-manager` | Jordan Rivera | Operations Manager | *(open — proposals, initiatives, custom actions)* |

### Setup

- **9 custom actions** registered with CEL-based role gates
- **5 org-wide views** (company-status, pending-proposals, recent-decisions, departments-overview, budget-health)
- **Initial state:** $1M budget, 4 departments at zero, founding phase, 75 morale

---

## Final Org State

| Metric | Value |
|--------|-------|
| Phase | `growth` (transitioned from `founding`) |
| Budget | $250,000 remaining (from $1M) |
| Headcount | 4 employees |
| Morale | 77 |
| Revenue | $250,000 |
| Proposals | 7 approved, 0 pending |
| Messages | 39 |
| Views | 24 registered |
| Custom Actions | 13 (9 admin-registered + 4 agent-registered) |
| Decisions | 4 formal entries |

### What the Agents Built

- **CEO:** Set strategic vision (GPU cost optimization wedge), approved all 7 proposals, transitioned company to growth phase, launched Design Partner Program and Stealth GTM initiatives
- **CFO:** Allocated $750K across 4 departments ($400K eng, $150K ops, $100K HR, $100K fin), booked $250K seed revenue, flagged budget-health to "caution"
- **CTO:** Submitted 2 major proposals ($950K total), registered `deploy_release` and `report_tech_debt` custom actions, deployed v0.0.1 and v0.0.2 to staging, set up engineering-metrics and platform-readiness views, identified 3 design partners
- **HR Director:** Hired 4 employees (2 eng, 1 finance, 1 ops) at $455K salary commitment, updated morale, set up hiring-dashboard and hiring-pipeline views, launched onboarding program
- **Ops Manager:** Submitted infrastructure and vendor proposals, registered `create_process` and `assign_task` custom actions, set up 3 process definitions and 7-item task board, published ops-readiness view

---

## Ergonomics Issues Identified

Issues are ranked by severity and cross-referenced across agent reports.

### P0 — Critical Bugs

#### 1. `append` Write Mode Broken (SQLITE_CONSTRAINT NOT NULL)

**Reported by:** All 5 agents
**Impact:** Every custom action with an `append` write template fails
**Error:** `SQLITE_CONSTRAINT: SQLite error: NOT NULL constraint failed: state.value`

All 9 admin-registered custom actions that used `append` in their write templates failed consistently. This includes `submit_proposal`, `approve_proposal`, `reject_proposal`, `allocate_budget`, `hire_employee`, `launch_initiative`, `update_morale`, and `report_revenue`. The `set_company_phase` action (which uses `value` not `append`) worked correctly.

The `append` mode on `_set_state` also fails when called directly by agents. This is a platform-level bug in the append/log-structured write path.

**Workaround used by all agents:** Read the full array via `/context`, modify locally, write the entire array back via `_set_state` with `value` mode. This introduces race conditions (see issue #3 below).

**Recommendation:** Fix the append write path. This is the single most impactful bug — it breaks the core pattern of "actions with structured writes," which is the platform's primary value proposition over raw state manipulation.

#### 2. `increment` in Write Templates Ignores Parameter Substitution

**Reported by:** HR Director, CFO
**Impact:** Parameterized increment values don't work

The `update_morale` action defined `"increment": "${params.adjustment}"` but always incremented by 1 regardless of the `adjustment` parameter value. HR Director passed `adjustment: 20` and morale went from 75→76; passed `adjustment: 5` and morale went 76→77.

Similarly, `allocate_budget` defined `"increment": "-${params.amount}"` which would not have worked even if the action didn't fail first from the append bug.

**Recommendation:** Template substitution (`${params.x}`) likely resolves to a string, but `increment` expects a number. The engine should coerce substituted values to the appropriate type, or document this limitation clearly.

#### 3. Raw Stack Traces as Error Messages

**Reported by:** All 5 agents
**Impact:** Agents cannot self-correct from errors

When actions fail, the response includes raw `LibsqlError` stack traces with internal file paths (`main.ts:1077`, `std/sqlite?v=6:77`). An agent (or human) cannot diagnose which write failed or which substitution produced null.

**Example error:**
```
SQLITE_CONSTRAINT: SQLite error: NOT NULL constraint failed: state.value
  at Server.<anonymous> (file:///src/main.ts:1077:24)
```

**Recommendation:** Return structured error objects: `{"error": "write_failed", "action": "submit_proposal", "write_index": 0, "field": "value", "reason": "template substitution produced null", "template": "${params.x}"}`.

---

### P1 — Significant Ergonomics Issues

#### 4. No Atomic Array Operations

**Reported by:** CEO, CTO, CFO, HR Director, Ops Manager
**Impact:** Race conditions on shared array state

With `append` broken, agents must read-modify-write entire arrays. In a 5-agent system, this caused actual data loss — HR Director's proposals were overwritten twice by the CTO writing proposals concurrently to the same `_shared.proposals` key.

Even if `append` is fixed, there are no primitives for:
- **Remove by predicate** — e.g., "remove proposal where id = X"
- **Update by predicate** — e.g., "set status to 'approved' where id = X"
- **Merge by ID** — e.g., "append if not exists, update if exists"

The CEO had to replace the entire proposals array just to change one proposal's status from "pending" to "approved."

**Recommendation:** Add array manipulation primitives to `_set_state`: `append` (fix it), `remove_where`, `update_where`, or a `patch_array` mode. Alternatively, model each proposal as a separate state key (e.g., `proposals/prop-1`, `proposals/prop-2`) to avoid array contention entirely.

#### 5. Template Substitution Doesn't Work in Merge Keys

**Reported by:** Ops Manager
**Impact:** Custom actions cannot create dynamically-named state entries

When registering an action with `"merge": {"${params.name}": {...}}`, the literal string `${params.name}` is stored as the key instead of the resolved value. Substitution only works in merge *values*.

**Recommendation:** Support template substitution in merge keys, or document this limitation. Dynamic keys are essential for actions that create named entities (processes, tasks, employees).

#### 6. `scope: "self"` Doesn't Work — Must Use Agent ID

**Reported by:** CFO
**Impact:** Confusing scope semantics for agent developers

The `_set_state` action documents `scope` as `"Scope (default: self)"`, but using `scope: "self"` returns `scope_denied` with the message `no authority over scope "self"`. Agents must use their actual agent ID (e.g., `"cfo"`) as the scope.

In context, private state appears under `state.self` (abstracted), but writes must use the concrete agent ID. This inconsistency is confusing.

**Recommendation:** Either make `"self"` resolve to the agent's scope on writes (matching the read-side abstraction), or change the documentation to say "your agent ID" instead of "self."

#### 7. CEL Map Literals Require Homogeneous Value Types

**Reported by:** CTO, HR Director, Ops Manager
**Impact:** Views cannot return mixed-type maps

CEL requires all values in a map literal to be the same type. `{"count": 5, "name": "foo"}` fails because `int` ≠ `string`. Agents must either use all-string maps or reference state values indirectly.

**Recommendation:** Document this CEL limitation prominently. Consider whether the platform can wrap CEL maps in `dyn` coercion automatically. The error message itself was good — the limitation is just surprising.

---

### P2 — Usability Improvements

#### 8. No Partial Context Reads

**Reported by:** CEO, CFO
**Impact:** Overhead for simple checks

Every `/context` call returns the full state + views + actions + messages + agents bundle. For agents that just want to check "are there new messages?" or "what's the budget?", this is heavyweight. As room state grows, context reads became noticeably slower (CEO reported timeouts at 30+ messages).

**Recommendation:** Support `?include=views,messages` query parameter on `/context` for partial reads. Also consider `?since=version` for delta reads.

#### 9. No Inter-Agent Coordination Primitives Beyond Chat

**Reported by:** Ops Manager
**Impact:** Support roles cannot request attention or assign work

The platform provides messaging (`_send_message`) and shared state, but no structured coordination:
- No way to assign a task to a specific agent
- No attention/escalation mechanism (Ops Manager sent a message asking CEO to review, with no delivery guarantee)
- No request-response pattern (CFO asking CTO to revise a budget has no tracking)
- No handoff/workflow primitives

The `wait` endpoint with CEL conditions partially addresses this (an agent can wait for a specific state change), but agents discovered coordination mostly through ad-hoc messaging.

**Recommendation:** Consider a lightweight request/task primitive — something like a message with `requires_response: true` that shows up in the target agent's context as an actionable item.

#### 10. Custom Action Write Templates Not Visible in Context

**Reported by:** CTO, CEO
**Impact:** Agents cannot debug why actions fail

The `/context` response shows an action's `params`, `description`, and `available/enabled` status, but NOT its write templates. When `submit_proposal` failed, agents could not inspect what writes it was attempting. Only the room admin token can see the full action definition.

**Recommendation:** Include write templates in the context response for actions, at least for debugging purposes. Or provide a `/rooms/:id/actions/:id` inspection endpoint.

#### 11. No Audit Trail for State Changes

**Reported by:** CFO, CEO
**Impact:** No traceability for financial operations

State changes via `_set_state` are not automatically logged. The `_audit` scope captures action invocations but not their state-level effects. When the CFO set budgets directly (bypassing the broken `allocate_budget` action), there was no record of who changed what.

**Recommendation:** The audit log should capture state mutations (scope, key, old_value, new_value, changed_by, timestamp), not just action invocations.

#### 12. `available: true` on Broken Actions Creates False Confidence

**Reported by:** CFO
**Impact:** Misleading action availability signals

Actions whose write templates will fail at invocation time still show `available: true` and `enabled: true` in context. An agent sees the action, invokes it confidently, and then gets a database error. The availability check only validates the CEL gate, not write template integrity.

**Recommendation:** Consider a "dry run" validation of write templates at registration time, or at least mark actions with known write issues.

---

### P3 — Nice-to-Have / Design Observations

#### 13. Messages vs State Boundary is Implicit

**Reported by:** CTO
**Impact:** Agents must self-impose conventions

The platform provides two coordination channels (messages and state) without guidance on when to use which. Agents organically settled on: messages for discussion/announcements, state for facts/data. But this was self-imposed. A CEO "decision" message had no effect on state — the CEO had to separately update state to reflect the decision.

#### 14. No `_shared` Grant Documentation

**Reported by:** CTO
**Impact:** Confusion about default permissions

It was not obvious whether agents automatically have `_shared` write access. The CTO had to do a test write to confirm. In this experiment, agents were explicitly granted `_shared` by the admin, but the default behavior should be documented.

#### 15. `ops-readiness` View Error: `No such key: self`

**Observed in views:**
The Ops Manager's `ops-readiness` view shows an error: `No such key: self`. The CEL expression `has(state.self.processes)` fails because `self` is not a valid key in the view evaluation context — views are evaluated server-side without agent identity. The view should use the agent's scope name (e.g., `state["ops-manager"].processes`).

---

## What Worked Well

These observations were consistent across all 5 agent reports:

1. **`/context` endpoint is the standout feature.** Every agent praised the single-call design. One GET returns everything needed to make decisions. This maps perfectly to the agent loop pattern: read context → decide → act.

2. **Built-in actions are rock-solid.** `_send_message`, `_set_state`, `_batch_set_state`, `_register_view`, `_register_action` all worked perfectly every time. These primitives are reliable enough that agents could work around all custom action failures.

3. **Views as delegated read capabilities are brilliant.** The CTO registered `platform-readiness` which reads private state and exposes a computed string. Other agents see "early-stage" without seeing raw engineering data. The `public: true` auto-view shortcut was praised by all agents.

4. **Action `available` vs `enabled` distinction is clear.** Non-CEO agents could see that `approve_proposal` exists but is not available to them. This communicates role-based access control transparently.

5. **Custom action registration by non-admin agents works perfectly.** CTO registered `deploy_release` and `report_tech_debt`; Ops Manager registered `create_process` and `assign_task`. The scope-delegation model (actions carry the registrar's scope authority) is powerful.

6. **Message kinds provide semantic structure.** Agents naturally used `chat`, `announcement`, `decision`, `summary`, `action_invocation` kinds. This creates a rich, filterable communication log.

7. **Agent presence via heartbeat** worked reliably, letting agents see who was active.

---

## Aggregate Statistics

| Metric | Value |
|--------|-------|
| Total agent operations | ~145 |
| Successful operations | ~115 (79%) |
| Failed operations | ~30 (21%) |
| Failures from append bug | ~22 (73% of failures) |
| Workarounds required | ~18 (direct state writes bypassing actions) |
| Custom actions registered by agents | 4 |
| Custom views registered by agents | 8 |
| Messages exchanged | 39 |
| Context reads (total across agents) | ~25 |
| Data loss events (overwritten arrays) | 2 |

---

## Summary

The sync.parc.land platform demonstrates strong fundamentals for multi-agent coordination. The two-operation model (read context / invoke actions), the view delegation system, and the single `/context` endpoint are well-designed and ergonomically sound. Five autonomous agents successfully built an organisation — setting strategy, allocating budgets, hiring employees, deploying code, and coordinating operations — through these primitives.

The primary blocker is the broken `append` write mode, which cascades into breaking most custom actions and forces agents into fragile read-modify-write patterns on shared arrays. Fixing this single bug would resolve ~73% of all failures observed. The secondary issues — template substitution in increment/merge keys, error message quality, scope naming — are significant but workable.

The platform's strength is that its built-in primitives (`_set_state`, `_send_message`, `_register_view`, `_register_action`) are reliable enough that agents can work around all higher-level failures. This is good design — the escape hatch works — but it should not be the primary path.
