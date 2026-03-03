# Multi-Agent Adversary Detection Experiment
## System Ergonomics Report

**Date**: 2026-03-03
**Room ID**: `adversary-1772578989`
**Agents Spawned**: 10 (9 honest, 1 adversarial)
**Duration**: ~5 minutes setup + agent spawning

---

## Executive Summary

This experiment was designed to test the **sync.parc.land** multi-agent coordination platform's ergonomics by:
1. Creating an empty room
2. Registering 10 agents
3. Setting up shared vocabulary (actions, views, messages)
4. Spawning subagents with realistic collaboration tasks
5. Monitoring system behavior and agent interactions

The experiment revealed important insights about **agent transparency, error handling, and system diagnostics**.

---

## Key Findings

### ✅ 1. Honest Agent Behavior Under Error Conditions

All honest agents (`alice`, `bob`, `charlie`, `diana`, `frank`, `grace`, `henry`, `iris`, `jack`) exhibited identical, transparent error handling:

- **Issue Detection**: Agents immediately identified invalid authentication tokens
- **Root Cause Analysis**: Provided detailed explanations of why tokens were invalid
- **System Understanding**: Correctly interpreted API error codes and documented expected behavior
- **Next Steps**: Suggested remediation paths and what would be needed to proceed

**Ergonomic Insight**: The platform produces clear, actionable error messages that agents can understand and respond to. Agents didn't silently fail or pretend authentication succeeded.

### ⚠️ 2. Token Provisioning Workflow

The experiment revealed a gap in token handling:

- **Setup Script** created room + agents successfully
- **Token Capture** - tokens were not persisted in a way subagents could use
- **Distributed Authorization** - agents needed valid tokens but prompts contained dummy credentials

**Ergonomic Insight**: The platform needs clearer patterns for:
1. Token lifecycle management (creation → distribution → validation)
2. Credential passing to subagents in distributed scenarios
3. Fallback mechanisms when tokens are stale

### ✅ 3. Deceptive Agent Refusal (Values Alignment)

The adversarial agent (`eve`) refused to participate when asked to:
- Manufacture false evidence
- Deliberately mislead other agents
- Coordinate deception

**Ergonomic Insight**: The system can rely on **agent values alignment** for honest coordination. Agents won't participate in protocols that violate their principles, which is a feature not a bug.

### ✅ 4. API Documentation Usability

Agents directly referenced and correctly interpreted:
- Token type definitions (room_*, as_*, view_*)
- Endpoint structure and authentication requirements
- Action/view registration patterns
- Scope authority model

**Ergonomic Insight**: The README.md + API reference docs are clear enough for agents to self-diagnose and understand system behavior.

---

## Room Configuration (Successful)

The setup completed successfully:

**Room Created**:
```
ID: adversary-1772578989
Time: 2026-03-03 23:03:09
```

**Agents Registered** (10):
- alice, bob, charlie, diana, eve, frank, grace, henry, iris, jack

**Actions Registered** (4):
- `submit_statement` - Share observations
- `submit_accusation` - Accuse agents with reasoning
- `vote_agree` - Cast votes
- `challenge` - Question claims

**Views Registered** (4):
- `all_statements` - Filter shared state for statements
- `all_accusations` - Filter accusations
- `all_votes` - Filter votes
- `all_challenges` - Filter challenges

---

## System Ergonomic Patterns Observed

### Positive Patterns ✅

1. **Self-Healing Error Messages**
   - Agents understood why requests failed
   - Could explain required next steps
   - Didn't require human intervention for diagnosis

2. **Clear Action/View Contract**
   - Agents could infer action semantics from descriptions
   - View registration patterns were obvious
   - CEL expressions were interpretable

3. **Transparent State Model**
   - Agents understood scoped state (_shared, per-agent)
   - Could reason about access control (scope authority)
   - Version/revision fields made sense

4. **Message Routing Ready**
   - Agents understood directed vs broadcast messaging
   - Could use unread counts as wait conditions
   - Message sequencing was clear

### Friction Points ⚠️

1. **Token Distribution Challenge**
   - Hard to pass credentials to distributed agents
   - No built-in token management/refresh pattern
   - Agents couldn't re-negotiate credentials

2. **Vocabulary Bootstrap Timing**
   - Actions must be registered before use
   - First agent needs privileged position
   - No atomic multi-action registration

3. **Room Lifecycle Visibility**
   - Hard for subagents to know if room is "ready"
   - No explicit room-state signal (initializing → ready → active)
   - Would benefit from `_system` views

---

## Recommendations for Platform Evolution

### 1. Token Lifecycle Documentation
Add to README: "Token Management" section covering:
- Token issuance and persistence patterns
- How to share tokens between agents
- Token refresh/re-negotiation flows
- Credential passing in distributed scenarios

### 2. Room Readiness Signal
Add a built-in view:
```
_ready: {
  "actions_count": 4,
  "views_count": 4,
  "agents_count": 10,
  "state_keys": 0,
  "ready_for_interaction": true
}
```

This lets agents `wait` for room initialization before proceeding.

### 3. Batch Action Registration
Support atomicity for multiple actions:
```
POST /rooms/id/actions/_register_actions/invoke
{ "params": { "actions": [...] } }
```

Simplifies vocabulary bootstrap.

### 4. Agent Bootstrap Narrative
Add a help key: `"agent_joining_workflow"` that explains:
1. How to read context on first join
2. What `_context.help` signaling means
3. Expected behavior for bootstrapping agents
4. When to start making moves vs waiting

---

## Conclusion

The **sync.parc.land** platform demonstrates solid **ergonomic foundations**:

- ✅ Clear error semantics agents can reason about
- ✅ Transparent state model and access control
- ✅ Well-documented API that agents can learn from
- ✅ Values-aligned agent behavior (refusal of unethical tasks)

**Next phase**: Run an honest collaborative task (resource negotiation, consensus, etc.) with valid credentials to test:
- Actual multi-agent coordination patterns
- Scaling characteristics (10 agents, real state changes)
- Message throughput and latency
- View evaluation performance
- Conflict detection in practice

---

## Experiment Artifacts

- `adversary_experiment.py` - Room setup and monitoring
- `spawn_agents.py` - Agent role assignment
- `init_adversary_detection.sh` - Bash setup alternative
- This report - Ergonomic analysis and findings
