# Ergonomics Findings — dark-room v3 & v4

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

## Recommendations (from v3)

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

---

## v4 Results (deadlock fixes applied)

### Changes from v3
- Player uses read→act→sleep(8s)→repeat loop. **No `wait` endpoint at all.**
- Narrator registers ALL phase actions upfront (dark, light, outside, settlement)
- Narrator uses `after=N` on messages scope (not turn counter)
- Working timer and action examples in prompts
- Background tasks explicitly banned

### What improved

**Deadlock eliminated.** Player reached outside (turn 8) without stalling.
The read→act→sleep loop is reliable — the player never blocked waiting for
the narrator. v3 deadlocked at turn 10; v4 kept flowing.

**Upfront action registration worked perfectly.** The narrator registered
search_room, stoke_fire, examine_door, open_door, gather_wood, explore_path,
build_shelter, return_inside — ALL in the first 3-4 iterations. These appeared
automatically as conditions were met. The player progressed through 4 phases
(dark → ember → lit room → outside) and always had actions available.

**Atmospheric timers.** The narrator successfully set `distant_howl` as a
dormant timer state key that enabled after 60s. Dynamic world events work.

**Player had in-character moments.** "scratches on the outside. something
wanted in." — the player noticed lore details and spoke in character.

### New issues found in v4

#### 6. CEL scope inconsistency — `messages.count` vs `state._shared.*`
The narrator used `state._messages.count > 1` which **never triggers**. The
correct expression is `messages.count > 1` (top-level, no `state.` prefix).
But all state references use `state._shared.*`, so agents naturally assume
messages follow the same pattern.

**Impact**: Narrator's wait loop never fired. It only reacted on 20s timeouts,
wasting iterations and delaying narrative responses.

**Fix**: Either make `state._messages.count` work, or document the exception
prominently. Better: have the API return a clear error when an expression
references an invalid path.

#### 7. View CEL fails on missing keys
The narrator registered a surroundings view with:
```
state._shared.shelter_built == true ? "..." : "..."
```
But `shelter_built` didn't exist as a state key yet. CEL threw:
`No such key: shelter_built`

**Impact**: The `surroundings` view returned an error object instead of a
string. The player could still function (it used `status` view instead) but
lost its primary orientation tool for the outside phase.

**Fix**: Seed all keys referenced in CEL expressions before registering views,
OR use CEL's `has()` macro: `has(state._shared.shelter_built) && state._shared.shelter_built == true`.

#### 8. Duplicate narrator events
The narrator posted the open_door reaction twice with slightly different text:
- "cold air rushes in. beyond the door: a forest clearing under a pale sky. snow."
- "cold air rushes in. a forest clearing under pale sky. snow on the ground."

**Cause**: The narrator's wait timed out, it read messages, reacted, then its
wait loop triggered again on the same batch. No dedup.

**Fix**: Narrator should track the last message sort_key it reacted to and
skip already-processed messages.

#### 9. Iteration budget is the real constraint
Each player game turn costs ~5 tool calls (3 reads + 1 invoke + 1 sleep).
With 25 max turns and multi-call turns, the player got through 8 game turns.
The narrator used ~44 tool calls total.

| Agent | Tool calls | Game turns covered | Efficiency |
|-------|-----------|-------------------|------------|
| v3 narrator | 44 | 10 (then deadlock) | ~4.4 calls/turn |
| v3 player | 29 | 10 (then deadlock) | ~2.9 calls/turn |
| v4 narrator | ~40 | 8 (still going) | ~5 calls/turn |
| v4 player | ~38 | 8 (budget limit) | ~4.8 calls/turn |

**Fix options**:
- Batch reads: read views+messages+actions in a single tool call (pipe 3 curls)
- Reduce sleep from 8s to 3-4s
- Player could skip reads when nothing has changed (check message count first)
- Increase max_turns

---

## v3 → v4 Summary

| Issue | v3 | v4 |
|-------|----|----|
| Turn-counter deadlock | CRITICAL — game stalled | FIXED — no waits |
| Background task overhead | Wasted ~7 iterations | FIXED — banned |
| Narrator pre-builds world | Late, after errors | FIXED — all upfront |
| Timer API error | Broke proactive building | Partially fixed (example worked) |
| CEL scope inconsistency | N/A | NEW — messages.count vs state.* |
| View missing keys | N/A | NEW — shelter_built error |
| Iteration budget | Wasted on waits | Tight but productive |
| Game progression | Dark→outside, stalled | Dark→outside, budget limit |

---

## v5 Attempt (increment regression)

### Changes from v4
- Pre-seeded ALL 10 state keys (turn, phase, location, fire_level, wood,
  door_found, shelter_built, room_description, stranger_appeared, last_event)
  to prevent CEL "No such key" errors
- Views use pre-seeded keys instead of `has()` guards (keys always exist)
- Narrator uses `messages.count > N` (correct CEL, not `state._messages.count`)
- Narrator tracks last sort_key to avoid duplicate event reactions
- Player uses read→act→sleep(4s) loop with batched reads
- Both agents at max_turns=35
- Background tasks banned in both prompts

### Blocker: `increment` broken (server regression)

**Every action invocation failed** with:
```
SQLITE_CONSTRAINT: SQLite error: NOT NULL constraint failed: state.value
```

The `increment` write operation is broken at the database level. When an action
write specifies `{"scope":"_shared","key":"turn","increment":1}` (no `value`
field), the SQL sets `value` to NULL, violating the NOT NULL constraint.

**Reproduction:**
```bash
# Seed a key
curl -s -X PUT BASE/rooms/ROOM/state/batch -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"writes":[{"scope":"_shared","key":"counter","value":0}]}'
# → OK

# Try to increment it
curl -s -X PUT BASE/rooms/ROOM/state/batch -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"writes":[{"scope":"_shared","key":"counter","increment":1}]}'
# → SQLITE_CONSTRAINT: NOT NULL constraint failed: state.value

# With both value + increment, increment is silently ignored
curl -s -X PUT BASE/rooms/ROOM/state/batch -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"writes":[{"scope":"_shared","key":"counter","value":0,"increment":1}]}'
# → value stays 0, increment ignored
```

**Error locations:**
- `batchSetState` at main.ts:635 (direct writes)
- `invokeAction` at main.ts:997 (action invocation)

**Impact:** Game never progressed past turn 0. All 4 starter actions (feel_around,
feed_ember, look, speak) used `increment` for the turn counter. The player
exhausted 16 tool calls retrying actions. The narrator registered 10 future
actions and entered its wait loop, but never received any player actions.

### What worked despite the blocker

1. **Room setup pattern is solid.** 10 state keys seeded, 4 views registered,
   4 starter actions + 10 future-phase actions all created without errors.
2. **Narrator registered all actions in one burst** — search_room, stoke_fire,
   examine_door, open_door, gather_wood, explore_path, build_shelter,
   return_inside, approach_stranger — all with correct `enabled` expressions.
3. **Atmospheric timer worked.** `distant_howl` appeared in state with timer.
4. **Views evaluated correctly** on pre-seeded keys (no missing-key errors).
5. **Agent prompts were followed well.** Narrator read state, registered actions
   in parallel, entered wait loop. Player waited 15s, read views+actions,
   tried to act. Both followed the v5 loop design.

### Workaround attempted

Restructured actions to use event-sourcing: actions only append to `_messages`,
narrator manually updates `_shared` state. This was applied mid-run but both
agents had already exhausted most of their iteration budget on the broken actions.

### v5 verdict

**Blocked by platform regression.** The `increment` operation worked in v3/v4
(player reached turn 8+ in v4). All v5 prompt/design fixes are validated at
the setup level — just needs `increment` fixed to rerun.

### Recommendations for server fix

The `batchSetState` function needs to handle `increment`-only writes:
```sql
-- When increment is specified without value:
INSERT INTO state (room_id, scope, key, value, version)
  VALUES (?, ?, ?, ?, 1)
  ON CONFLICT (room_id, scope, key)
  DO UPDATE SET value = COALESCE(state.value, 0) + ?, version = version + 1
```
The `value` column in the INSERT should default to `0 + increment_amount`
(or the increment amount itself), not NULL.
