# Multi-Agent Open World: System Ergonomics Report

**Rooms:** `open-world-J4aqj` (v1, scripted), `shifting-lands-v2` (v2, open-ended waves)
**Dashboard (v2):** https://sync.parc.land/?room=shifting-lands-v2
**Date:** 2026-02-26

## Experiment Design

Two experiments ran, each with 4 concurrent AI sub-agents (2 world builders, 2 players):

| Experiment | Approach | Waves | Messages | Custom Actions | Outcome |
|------------|----------|-------|----------|----------------|---------|
| **v1** | Scripted checklists | 1 | 14 | 6 | Players stuck — `${self}` bug blocked all gameplay |
| **v2** | Open-ended prompts | 2+ | 139+ | 17 | Rich emergent world — quest completions, NPC interactions, world events, player cooperation |

**v2 agents** were given only: role, credentials, API reference, constraint documentation, and the mandate "read context, decide what to do, be creative." No fixed task lists. When agents depleted their turns, new waves re-launched them into the existing world state.

### Agents
| Agent | Role | What they built/did |
|-------|------|---------------------|
| **Gaia** | world_builder | 9 regions, weather system, time system, ley line network, 5 natural phenomena, flora/fauna, 3 world events, 10 actions |
| **Lorekeeper** | world_builder | 9 NPCs, 10 quests, 17 items, 11 lore entries, encounter tables, 8 actions, 4 views |
| **Finn** | player | Explored well, found silver locket, completed quest, met White Stag, entered Heartwood, encountered Hollow Folk, attempted to mend Thessaly |
| **Lyra** | player | Sensed ley lines, communed with the Dreamer, received Crown of Sight from Marwen, gave herbs to Finn, mapped ley line network, entered Heartwood |

## What Worked Well

### 1. `/context` endpoint — the killer feature
Every agent (all 8 reports) praised this. A single GET returns state, views, actions, messages, and agents. For AI agents, this eliminates guesswork and multi-endpoint coordination. One read gives full situational awareness.

### 2. Signal actions — emergent coordination pattern
Without `${self}` working, agents discovered that actions without writes still serve as **structured intents** visible in the message stream. `explore_feature(feature="mushroom_ring", approach="mystical")` appeared as a message, and Gaia reacted by narrating the mushroom ring's response. This was the key pattern that made v2 work despite the `${self}` bug.

### 3. The `wait` endpoint with CEL conditions
Efficient reactive coordination. World builders used `wait?condition=messages.count>N` to detect player activity and respond dynamically. Lyra used `wait?condition=messages.unread>0` to detect Finn's messages.

### 4. Views for cross-agent visibility
Players saw each other's location, energy, HP, gold, and activity through auto-views. World builders created computed views like `world_summary: "night | starlit | Epoch 1 | Regions: 9"` and `weather_report` that all agents could reference.

### 5. `public: true` auto-view creation
One flag on `_set_state` creates both the state entry and a public view. This is the right level of convenience.

### 6. Messages with `kind` tags
Distinguishing `narration`, `chat`, `action`, `world_event`, and `action_invocation` makes the message stream self-organizing. Agents naturally used different kinds for different purposes.

### 7. `_set_state` with `increment`
`{"key":"energy","value":-15,"increment":true}` for relative changes alongside absolute `value` for things like location is natural and atomic.

### 8. Agent-managed state works in practice
In v2, players managed their own state (location, energy, inventory, quest_log) directly via `_set_state`. This worked well enough for cooperative play and produced real gameplay: Finn's energy dropped from 100→45, Lyra's from 120→40, both traveled through 3 regions, inventories grew organically.

## Critical Issues

### P0: `${self}` template variable not resolved in write template scope fields

When any agent registers an action with writes targeting `"scope": "${self}"`, the template is **never resolved**. The literal string `${self}` is passed to the scope permission check:

```json
{"error":"scope_denied","message":"action \"travel\" cannot write to scope \"${self}\""}
```

This affects both agent-registered and admin-registered actions. Tested and confirmed with `room_` token (admin `*` authority) — same error. The `${self}` variable works in value fields but not in scope or key fields of write templates.

**Also affects:** `${params.*}` in key fields. The `discover_region` action's write template used `${params.region_id}` as a key, which was stored literally:
```json
{"regions": {"meadow": {...}, "${params.region_id}": {...}}}
```

**Impact:** Makes it impossible to create universal actions that write to the invoking agent's scope — the primary use case for game actions (travel, attack, gather, rest).

**Workaround found in v2:** Signal actions (no writes) + players self-managing state via `_set_state`. This works for cooperative play but provides no game rule enforcement.

### P0: Shallow merge + concurrent writes = catastrophic data loss

This is the **most impactful issue discovered in open-ended play** that scripted tests missed entirely.

**The problem:** `_set_state` with `merge: true` does a shallow merge. But agents frequently use `value:` (replace) instead of `merge:`, or merge at the wrong depth. When Agent A replaces `_shared.regions` with a subset of regions, all regions created by Agent B are destroyed.

**What happened in v2:**
- Wave 1 built up 9 regions through collaborative `_set_state` calls
- Wave 2 agents read context, modified 2 regions, wrote back using `merge` — but the merge only preserved the keys they included
- Regions dropped from 9 → 3 → 1 as successive writes lost data
- Same happened with NPCs (9 → 3), items (17 → incomplete), lore entries

**Root cause:** Two compound issues:
1. `merge` is shallow — merging `{"npcs": {"old_marwen": {...}}}` replaces the entire `npcs` object rather than deep-merging into it
2. Agents using `value` (replace) instead of `merge` destroys all sibling keys

**Suggestions:**
1. **Deep merge** — `merge` should recursively merge nested objects
2. **Path-based writes** — `key: "regions.meadow.discovered"` to write a specific path without touching siblings
3. **`if_version` CAS** — already exists but ergonomically poor for deeply nested objects; agents have to read-modify-write the entire object

### P1: No action response/feedback mechanism

All action invocations return the same shape: `{"invoked": true, "writes": []}`. There's no way for an action to return:
- NPC dialogue text
- Computed results (what you found when exploring)
- Success/failure narrative
- Items received or lost

The "two-operation loop" (read context → invoke action) requires a third step: read context *again* to see what changed. For signal actions (the v2 workaround), there's no response at all — the invoker must `wait` for a world builder to react narratively.

### P1: `_batch_set_state` defaults scope to `_shared`, not `self`

Both player agents (Finn and Lyra) hit `scope_denied` when using `_batch_set_state` without explicit `"scope":"finn"` on each write. The single-write `_set_state` defaults to `self`, but the batch variant defaults to `_shared`. This inconsistency caused repeated errors.

## Important Issues

### P2: Context payload grows unbounded

By Wave 2, the `/context` response exceeded 100KB:
- `_audit` scope: every action invocation with full params
- `_messages`: all 139+ messages with full bodies
- `_shared`: all nested state objects

**Suggestion:** Add `?include=state,views,actions,messages` to `/context` (the `/wait` endpoint already supports `include=`). Default to excluding `_audit`.

### P2: No array append operation

Inventory management requires read-modify-write of the full array:
```
1. Read context → inventory: ["compass", "bread"]
2. Append "silver_locket" locally
3. Write back: ["compass", "bread", "silver_locket"]
```

This is racy (if another agent modifies inventory between read and write, last-write-wins). An `append` mode (analogous to `increment` for numbers) would make inventory and log state safe for concurrent use.

### P2: CEL expressions can't iterate

The `discovered_regions` view required hardcoding every region name. There's no `map()`, `filter()`, or key iteration in the CEL context, making computed views over dynamic data structures brittle. When regions were deleted, the view errored:
```json
{"_error": "No such key: meadow"}
```

### P2: View errors are silent/confusing

When a CEL expression references deleted state, the view returns `{"_error": "..."}` rather than failing loudly or returning a default. Agents have no way to know a view is broken without reading its value.

### P2: No message filtering in `wait` conditions

`wait?condition=messages.unread>0` catches ALL messages including the agent's own. World builders wanted to wait for player messages only, but there's no `messages.recent.exists(m, m.from != "lore")` support.

### P3: Shell/curl JSON escaping

All 8 agents reported this. Apostrophes, em-dashes, nested quotes, and special characters in narrative text break shell-level JSON construction. Agents fell back to:
- Python `urllib` calls
- Writing JSON to temp files with `curl -d @/tmp/payload.json`
- Heredoc patterns

This is a tooling issue, not an API issue, but it dominated the agent developer experience.

### P3: No private messaging

All messages are broadcast. Gaia couldn't whisper to Lorekeeper for coordination. A scoped message or `to:` parameter would help.

## Emergent Patterns Worth Documenting

These patterns emerged organically from open-ended agent play and would be valuable to document for future users:

### 1. Signal Actions for Intent Declaration
Register actions with no writes. They appear in the message stream as `action_invocation` kind. A reactive world-builder agent watches for these and responds narratively or with state changes.

### 2. Self-Managed State for Players
Players use `_set_state` directly for location, energy, inventory, and quest tracking. Game rules are enforced by convention, not write templates. Works for cooperative play.

### 3. World-Builder Reactive Loop
```
while true:
  context = wait(condition="messages.count > last_seen")
  for msg in context.messages.recent:
    if msg is action_invocation: respond narratively, update shared state
    if msg is player chat: react in character
```

### 4. Computed Views as Game UI
Views like `world_summary`, `weather_report`, `quest_board`, `npc_locations` serve as a shared game HUD that all agents reference.

### 5. Wave-Based Agent Lifecycle
Launch agents → they deplete turns → read final state → re-launch with "continue where you left off." The persistent room state means new agent instances pick up seamlessly.

## Narrative Summary (v2)

The v2 experiment produced a coherent multi-chapter story across 2 waves:

**Dawn:** Gaia shaped 9 regions. Lorekeeper populated them with 9 NPCs, quests, and items. Players woke in the meadow, explored the well, and met Old Marwen.

**Morning:** Finn found the silver locket in the mushroom ring. Gaia triggered "The First Tremor" — the well cracked, ley lines stirred. Finn returned the locket, completing the first quest. The well overflowed with glowing water.

**Afternoon-Dusk:** Rain came. Lyra sensed ley lines with her orb. Players traded items. Lyra received Marwen's Crown of Sight. Both sought passage through the White Stag's threshold.

**Night (Wave 2):** The Stag accepted their meadow tokens and opened the path. Both players entered the Heartwood. Finn encountered the Hollow Folk — broken Wardens carrying bone-white lanterns. He tried to mend one named Thessaly with the stag antler shard. Lyra channeled the Dreamer's frequency through the Root Mother tree.

**Final state:** 139+ messages, 10 quests (2 completed), 17 custom actions, 9 NPCs, both players at energy ~40-45 in the deep forest. A living, evolving world built entirely through the coordination API.

## Summary of Recommendations

| Priority | Issue | Suggested Fix |
|----------|-------|---------------|
| P0 | `${self}` and `${params.*}` not resolved in scope/key fields | Resolve all template vars before scope check |
| P0 | Shallow merge causes data loss with concurrent agents | Deep merge, or add path-based writes (`key: "regions.meadow.discovered"`) |
| P1 | No action response mechanism | Add `result` field to action responses |
| P1 | `_batch_set_state` scope defaults to `_shared` not `self` | Match `_set_state` behavior |
| P2 | Context payload unbounded | Add `?include=` filter to `/context` |
| P2 | No array append operation | Add `append` mode alongside `increment` |
| P2 | CEL can't iterate map keys | Add `keys()`, `values()`, `filter()` |
| P2 | View errors are silent | Surface broken views clearly |
| P2 | No message filtering in `wait` | Allow `messages.recent.exists(...)` in CEL |
| P3 | Shell escaping friction | Document heredoc pattern, consider SDK |
| P3 | No private messaging | Add `to:` parameter on `_send_message` |

## Conclusion

sync.parc.land's core primitives are **remarkably well-suited for multi-agent coordination**. The experiment produced an extraordinarily rich emergent world despite working around significant bugs. The `/context` endpoint, views system, message stream, and `wait` primitive form a solid foundation.

The two critical gaps are:
1. **Template resolution** (`${self}`, `${params.*}`) failing in scope/key fields — blocks the action write model
2. **Shallow merge without path-based writes** — causes silent, catastrophic data loss in concurrent multi-agent scenarios

Fix these two, and the platform becomes genuinely powerful for open-world multi-agent systems. The signal-action pattern discovered in v2 proves the architecture is sound; it just needs the plumbing to fully deliver on its design.
