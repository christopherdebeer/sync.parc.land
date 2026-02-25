# Ergonomics Findings — dark-room-v3

Observations from running two Claude agents (narrator + player) against
sync.parc.land v5, using the proactive world-building pattern.

## What Worked

### 1. `enabled` expressions for progressive disclosure
Actions gated with `enabled: "state._shared.fire_level >= 2"` appeared
automatically when the player built the fire. The player never saw hidden
actions — they just materialized at the right moment. This is the strongest
pattern in the system.

### 2. Pre-registered gated actions (parallel world-building)
The narrator registered `gather_wood`, `explore_path`, `return_inside` with
`enabled: location == "outside"` while the player was still in the room.
When the player opened the door, outside actions appeared instantly —
zero lag, no narrator reaction needed.

### 3. Action cooldowns (`on_invoke.timer` with `effect: "enable"`)
`feel_around` with a 15s cooldown worked perfectly — disappeared after use,
reappeared after the timer. Prevents action spam without any agent logic.

### 4. `if` vs `enabled` distinction
- `if`: precondition — action is visible but fails if unmet ("not enough wood")
- `enabled`: visibility gate — action is hidden until condition is true
Both are useful and agents understood the difference.

### 5. Auto-logged action invocations in `_messages`
The system automatically writes `action_invocation` entries to `_messages`
when actions are invoked. This gives the narrator full context on what happened
without the player needing to manually report.

### 6. Views as contextual interface
The `surroundings` view dynamically reflected the current state ("darkness.
the faint glow of an ember." → "a clearing. trees press close. cold wind
bites."). Agents used views as their primary orientation tool.

### 7. Terse narrator voice
The 80-char event limit produced good writing: "flame takes hold. warm light
floods the room. shadows retreat to the corners." Constraints enabled style.

---

## What Didn't Work

### 1. CRITICAL: Turn-counter deadlock
**Both agents waited on `turn > N` — but only action invocations increment
turn.** After the player acted and waited for the narrator's "response turn",
and the narrator posted events (which don't touch turn), both stalled.

**Fix options:**
- Player should NOT wait after acting — just read state/actions and act again
- Use `messages.count > N` or `after=N` on messages scope instead of turn
- Add a separate `narrator_ack` key the narrator bumps after reacting
- Or: player prompt should say "act, read, act — never wait for turn"

### 2. Timer API format error derailed proactive building
The narrator tried to set a fire-decay timer:
```json
{"key":"fire_decay","value":true,"timer":{"ms":120000,"effect":"delete"}}
```
Got: `{"error":"invalid_timer","detail":"timer.effect must be 'delete' or 'enable'"}`

The error message says the effect IS valid but rejected it anyway. After
this failure, the narrator abandoned timer-based world-building and fell
into reactive mode. **One API error undermined the core design goal.**

**Fix**: Better error messages + narrator prompt should include working timer
examples and a fallback strategy.

### 3. Player used background tasks for waits (complexity explosion)
The player agent tried to run `wait` calls as background tasks, then poll
their output files. This added ~3 iterations of overhead per wait cycle
(spawn task → sleep → read output). The `wait` endpoint should be called
directly with a timeout, not wrapped in background task management.

**Fix**: Player prompt should explicitly say "call wait directly in the main
loop, do not use background tasks."

### 4. Narrator batch-reacts instead of per-action
The player acted 3 times (feel_around, feed_ember, look) before the narrator
responded once. The narrator reacted to all 3 at once instead of each
individually. This makes narrative flow feel chunky.

**Cause**: The `wait` endpoint returns when the condition first becomes true,
but by the time the narrator processes and responds, the player has already
acted again (since there's no turn-based lock).

**Fix options:**
- Accept async rhythm — it's fine for this game style
- Or: add CAS-based turns where narrator must ack before player can act again
  (would slow things down but enforce turn discipline)

### 5. Duplicate speak messages
The `speak` action writes to `_messages` (the action's write), AND the system
logs the invocation as `action_invocation`. Result: two entries for one speak.

**Fix**: Either remove the action's write to `_messages` (rely on system log),
or the system should skip logging invocations for actions that already write
to `_messages`.

---

## Iteration Budget Analysis

Each agent had ~25 iterations. Actual usage:

| Agent | Productive iterations | Wasted on waits/timeouts | Overhead |
|-------|----------------------|--------------------------|----------|
| Narrator | ~10 (events, actions, state) | ~8 (30s wait timeouts) | ~2 (reads) |
| Player | ~8 (actions, reads) | ~10 (wait timeouts + bg tasks) | ~7 (bg task mgmt) |

**The wait-timeout-retry pattern consumed ~40% of both agents' iteration
budgets.** The deadlock made this worse, but even without deadlock, waiting
30s per cycle means 25 iterations covers only ~12 minutes of real time.

---

## Recommendations for v4

1. **Remove turn-counter waits from player prompt.** Player should: read →
   act → read → act. Never block.
2. **Use `after=N` on messages scope** for both agents to detect new activity
   without waiting on turn.
3. **Include working timer examples** in narrator prompt. One API error
   shouldn't break the world-building loop.
4. **Explicitly ban background tasks** in agent prompts. The `wait` endpoint
   with timeout is sufficient.
5. **Consider a `narrator_seq` key** that the narrator bumps when it reacts.
   Player can check `narrator_seq` to know if the narrator has caught up.
6. **Accept async rhythm** for the game — strict turn-taking isn't needed and
   the natural async feel adds to the atmosphere.
