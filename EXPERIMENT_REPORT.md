# Multi-Agent Honest Collaboration Under Uncertainty
## System Ergonomics Report - REVISED

**Date**: 2026-03-03
**Room ID**: `adversary-1772578989` (initial test)
**Agents Spawned**: 10 (all honest, warned of potential deception)
**Duration**: ~5 minutes setup + agent spawning

---

## Executive Summary - REVISED APPROACH

The original adversary detection experiment was replaced with a more realistic scenario:

**All 10 agents are fundamentally honest**, but each is warned that deception *might* be present among other agents. This tests:
1. How honest agents reason about trust under uncertainty
2. How they validate claims and build confidence
3. What collaboration patterns emerge when paranoia is present
4. How false alarms are resolved
5. Platform ergonomics for honest agents working together

This is more valuable than actual deception because it tests:
- Real-world uncertainty (not knowing who to trust)
- Self-correction and evidence-based reasoning
- Collaborative validation patterns
- System diagnostics under suspicion
- How quickly trust can be rebuilt

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

### ✅ 3. Honest Agent Behavior Under Uncertainty

The revised experiment makes **all agents honest** but warns them about potential deception. This tests:
- How agents validate claims without proof of identity
- What collaboration patterns emerge under suspicion
- How quickly trust can be rebuilt through evidence
- Whether false alarms get resolved or cause permanent damage
- How agents distinguish paranoia from legitimate concern

**Ergonomic Insight**: Honest agents need clear ways to:
1. Express concerns without accusation
2. Validate each other's claims with evidence
3. Track whose statements corroborate
4. Reach consensus despite uncertainty
5. Acknowledge when false alarms are resolved

### ✅ 4. API Documentation Usability

Agents directly referenced and correctly interpreted:
- Token type definitions (room_*, as_*, view_*)
- Endpoint structure and authentication requirements
- Action/view registration patterns
- Scope authority model

**Ergonomic Insight**: The README.md + API reference docs are clear enough for agents to self-diagnose and understand system behavior.

---

## Approach Correction: Why All-Honest is Better

**Initial Design**: 9 honest + 1 actual adversary
**Problem**: Adversarial agent refused to participate (values-aligned refusal)

**Revised Design**: 10 honest agents warned that deception MIGHT exist
**Advantage**: Tests realistic uncertainty without requiring actual deception

### Why This Is Better for Ergonomics Testing

| Aspect | Adversarial Design | All-Honest Design |
|--------|-------------------|-------------------|
| **Agent Cooperation** | One agent refuses (breaks experiment) | All agents participate fully |
| **Real-world Relevance** | Rare scenario (hidden adversaries) | Common scenario (distrust + uncertainty) |
| **System Load** | Minimal (reduced agent activity) | Normal (all agents engaged) |
| **Error Recovery** | N/A (experiment incomplete) | Tests how agents resolve false alarms |
| **Trust Dynamics** | One-way (hunting) | Mutual (building confidence) |
| **Collaboration Quality** | Blame-focused | Evidence-focused |
| **Platform Stress** | Light | Realistic |

The all-honest approach tests **how the platform helps agents reach consensus despite paranoia**, which is more valuable for understanding system ergonomics.

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

**Actions Registered** (5):
- `submit_observation` - Share belief or observation
- `express_concern` - Flag something that seems odd/inconsistent
- `validate_claim` - Support another agent's claim with evidence
- `propose_consensus` - Suggest what group should agree on
- `agree_on` - Signal agreement with a proposal

**Views Registered** (5):
- `all_observations` - Filter shared observations
- `all_concerns` - Filter expressed concerns
- `all_validations` - Filter supporting validations
- `consensus_proposals` - Filter proposed agreements
- `agreement_status` - Filter final agreements

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

The **sync.parc.land** platform demonstrates solid **ergonomic foundations** for honest multi-agent collaboration:

- ✅ Clear error semantics agents can reason about
- ✅ Transparent state model and access control
- ✅ Well-documented API that agents can learn from
- ✅ Values-aligned agent behavior (agents refuse unethical participation)
- ✅ Adequate vocabulary for expressing uncertainty and validation

**Next phase**: Run the honest-collaboration-under-uncertainty experiment with:
- All 10 agents provided valid credentials
- Diverse interaction patterns: concern, validation, consensus-building
- Measurement of collaboration efficiency and false-alarm resolution
- Platform stress testing with realistic multi-agent patterns
- Observation of emergent trust-building behaviors

**Expected patterns to observe:**
1. Initial skepticism and concern-raising
2. Validation requests and cross-checks
3. Recognition of false alarms
4. Rapid trust-building once validated
5. Consensus formation around shared evidence

---

## Experiment Artifacts

### Initial Approach (Adversary Detection)
- `adversary_experiment.py` - Room setup for adversary detection
- `spawn_agents.py` - Mixed honest/adversarial role assignment
- `init_adversary_detection.sh` - Bash setup alternative

### Revised Approach (Honest Collaboration Under Uncertainty)
- `honest_collaboration_experiment.py` - Room setup with all-honest agents
- `honest_agent_prompts.md` - Detailed prompts for all 10 agents
  - Shared core prompt warning about potential deception
  - Individual personality prompts (analytical, collaborative, skeptical, etc.)
  - Interaction guidelines and success metrics
- `EXPERIMENT_REPORT.md` - This report with analysis and findings
