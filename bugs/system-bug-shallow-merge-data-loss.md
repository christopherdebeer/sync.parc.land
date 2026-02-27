# BUG: Shallow merge causes catastrophic data loss with concurrent agents

**Type:** System bug
**Severity:** P0 - Silent data destruction
**Component:** `_set_state` merge behavior
**Reproducible:** 100% in multi-agent concurrent writes

## Summary

`_set_state` with `merge: true` performs a shallow merge, replacing the entire object at the target key rather than recursively merging nested structures. When multiple agents concurrently update different subkeys of the same shared object (e.g., `_shared.regions`), each write silently destroys sibling keys created by other agents. Even without `merge`, agents using `value` (replace) to update a nested object naturally lose all keys they didn't include.

## Observed Impact

In a 2-wave multi-agent experiment with 4 concurrent agents:

- **9 regions** created collaboratively in Wave 1 → **reduced to 1** by Wave 2
  - Gaia created meadow, forest_edge, deep_forest, crystal_peaks, salt_flats, sunken_ruins, twilight_coast, shifting_canyon
  - Wave 2 agent wrote `_shared.regions` with only `deep_forest` and `forest_edge`, losing 6 regions
  - Subsequent write included only `meadow`, losing everything else
- **9 NPCs** → **3 NPCs** lost when Lorekeeper merged a subset
- **17 items** → partial loss through same mechanism
- **11 lore entries** → partial loss

This is **silent** — no error, no warning, no conflict detection. The overwriting agent receives a success response. Other agents only discover the loss on their next `/context` read.

## Steps to Reproduce

```bash
# Setup: create room, set nested shared state
curl -X POST .../actions/_set_state/invoke -d '{
  "params": {"scope":"_shared", "key":"things", "value":{
    "a": {"name": "Alpha", "x": 1},
    "b": {"name": "Beta", "x": 2},
    "c": {"name": "Gamma", "x": 3}
  }}
}'

# Agent 1: merge update to "a" only
curl -X POST .../actions/_set_state/invoke -d '{
  "params": {"scope":"_shared", "key":"things", "merge":{
    "a": {"name": "Alpha Updated", "x": 10}
  }}
}'
# Expected: things = {a: {name: "Alpha Updated", x: 10}, b: {name: "Beta", x: 2}, c: {name: "Gamma", x: 3}}
# Actual: things = {a: {name: "Alpha Updated", x: 10}}  ← "b" and "c" are GONE
```

## Root Cause

The `merge` operation replaces the value at the target key with a shallow merge of old + new top-level keys. If the new value only includes key "a", the result is `{"a": ...}` — keys "b" and "c" are discarded.

## Suggested Fixes

1. **Deep merge** — recursively merge nested objects so that providing `{"a": {"x": 10}}` only updates `things.a.x` without touching `things.b` or `things.c`
2. **Path-based key addressing** — allow `"key": "things.a.x"` to write directly to a nested path without touching siblings
3. **If neither:** clearly document that `merge` is shallow and all sibling keys must be included, and add a warning in the response when keys are being removed

## Why This Is P0

Unlike the `${self}` bug (which produces a visible error), this bug **succeeds silently**. The agent believes the write worked correctly. Data loss is only discovered later by other agents reading context. In a long-running multi-agent system, this makes shared nested state fundamentally unreliable.

The combination of:
- Multiple agents writing to the same `_shared` key
- Nested object values (the natural structure for regions, NPCs, quests, items)
- Shallow merge semantics

...means data loss is **inevitable** in any multi-agent scenario using nested shared state. This is the default pattern for any game, simulation, or collaborative system.
