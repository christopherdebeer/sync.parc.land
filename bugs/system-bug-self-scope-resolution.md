# BUG: `${self}` template variable not resolved in action write scope field

**Type:** System bug
**Severity:** P0 - Blocks core functionality
**Component:** Action write template resolution / scope authority check
**Reproducible:** 100%

## Summary

When a custom action registered by Agent A includes a write template with `"scope": "${self}"`, and Agent B invokes that action, the system returns `scope_denied` with the error message containing the literal unresolved string `${self}` rather than the invoking agent's ID. The `${self}` template variable is not resolved before the scope permission check.

## Steps to Reproduce

```bash
# 1. Create room
curl -s -X POST https://sync.parc.land/rooms -H 'Content-Type: application/json' \
  -d '{"id":"bug-repro"}'
# → save room_TOKEN

# 2. Join agent "alice"
curl -s -X POST https://sync.parc.land/rooms/bug-repro/agents \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer room_TOKEN' \
  -d '{"id":"alice","name":"Alice","role":"builder","state":{"x":0}}'
# → save as_ALICE

# 3. Join agent "bob"
curl -s -X POST https://sync.parc.land/rooms/bug-repro/agents \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer room_TOKEN' \
  -d '{"id":"bob","name":"Bob","role":"player","state":{"x":0}}'
# → save as_BOB

# 4. Alice registers an action with ${self} in writes scope
curl -s -X POST https://sync.parc.land/rooms/bug-repro/actions/_register_action/invoke \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer as_ALICE' \
  -d '{"params":{
    "id":"move",
    "description":"Move the invoker",
    "params":{"x":{"type":"number"}},
    "writes":[{"scope":"${self}","key":"x","value":"${params.x}"}]
  }}'
# → action registered successfully

# 5. Bob invokes the action
curl -s -X POST https://sync.parc.land/rooms/bug-repro/actions/move/invoke \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer as_BOB' \
  -d '{"params":{"x":5}}'
```

## Expected Result

```json
{"invoked": true, "action": "move", "writes": [{"scope": "bob", "key": "x", "value": 5}]}
```

Bob's state `bob.x` should be updated to `5`. The `${self}` template should resolve to `"bob"` (the invoking agent), and the scope check should allow this because Bob is writing to his own scope.

## Actual Result

```json
{"error": "scope_denied", "message": "action \"move\" cannot write to scope \"${self}\""}
```

The literal string `${self}` appears in the error message, proving it was never resolved. The scope check fails because no agent has authority over a scope literally named `${self}`.

## Analysis

The documentation states:
> Actions carry the registrar's scope authority: an action registered by Alice can write to Alice's private scope when invoked by Bob.

And write templates support `${self}` substitution. However, the scope resolution appears to work for `${params.x}` in value fields but NOT for `${self}` in scope fields. The scope permission check runs before template resolution.

## Impact

This bug makes it impossible to implement the documented action pattern where one agent creates actions that modify the invoking agent's state. This is the primary use case for:
- Game actions (travel, attack, use item)
- Delegated operations (admin creates actions for users)
- Any "shared behavior" pattern where the action's effect targets the invoker

## Observed In

- Room: `open-world-J4aqj`
- Agents: Gaia (world_builder) registered `travel`, `explore`, `rest` with `${self}` writes
- Agents: Lorekeeper (world_builder) registered `gather_item` with `${self}` writes
- Both player agents (Finn, Lyra) received `scope_denied` on all 4 actions
- 100% reproduction rate across both players and all 4 affected actions

## Workaround

Register actions using the room token (`room_` prefix) which has `*` (admin) authority over all scopes. This is not ideal as it requires the admin token for action registration rather than delegating to world builder agents.
