# WORLD DESIGN: Actions missing writes and preconditions

**Type:** World design bug (not system bug)
**Context:** Open world pattern - actions need game logic wiring

## Summary

Several custom actions registered by world builders were missing write templates and CEL preconditions, resulting in no-op actions and missing game rule enforcement.

## Issue 1: `talk_to_npc` and `accept_quest` have no writes

These actions were registered with no `writes` array:
```json
{"id": "talk_to_npc", "description": "Talk to an NPC", "params": {"npc_id": {"type": "string"}}}
```

When invoked, the response is:
```json
{"invoked": true, "action": "talk_to_npc", "writes": []}
```

**What should happen:**
- `talk_to_npc` should record the interaction (e.g., append to `${self}.npc_interactions`)
- `accept_quest` should add to `${self}.quest_log`

**Why it didn't:** The `${self}` scope_denied bug (see system-bug-self-scope-resolution.md) means even if writes were added, they would fail. But even without that bug, these actions were registered without writes.

**Note:** This also reveals a **system limitation** - there's no action response/feedback mechanism. Even with writes, `talk_to_npc` can't return NPC dialogue to the invoker. The action can only do static writes; it can't compute a response based on game state.

## Issue 2: No location enforcement on NPC interactions

Players could talk to NPCs in different regions:
- Lyra (in `meadow`) successfully invoked `talk_to_npc(npc_id="shadow_fox")` despite Shadow Fox being at `forest_edge`

**Fix:** Add a CEL `if` precondition (though this requires knowing all NPC locations at registration time, or using a dynamic CEL expression):
```json
{
  "id": "talk_to_npc",
  "if": "state._shared.npcs[params.npc_id].location == state[self].location",
  "..."
}
```

## Issue 3: `rest` has no weather precondition

The description says "Cannot rest during storms" but no `if` or `enabled` expression enforces this:
```json
{"id": "rest", "description": "Rest to recover 25 energy. Cannot rest during storms."}
```

**Fix:**
```json
{
  "id": "rest",
  "if": "state._shared.weather != 'storm'",
  "..."
}
```

## Issue 4: `travel` doesn't validate destination is discovered

Players could potentially travel to undiscovered regions. The `travel` action has no precondition checking whether the destination is in the player's `discovered_regions` list.

## Broader Observation

Building correct game logic on top of sync.parc.land requires manually wiring every precondition and side effect into actions via CEL expressions and write templates. This is powerful but error-prone. The open world pattern would benefit from:
1. Example documentation showing location-gated, state-validating actions
2. An action "handler" mechanism for dynamic responses (not just static writes)
3. A way for world builders' actions to write to invoker scope (blocked by the `${self}` system bug)
