# A Dark Room — Multi-Agent Narrative Session

**Room**: `a-dark-room` on sync.parc.land
**Date**: 2026-02-25
**Duration**: ~33 minutes
**Dashboard**: `https://sync.parc.land/?room=a-dark-room#token=room_76414381e81358834a4144cedf22106b3b273cae29af3afe`

## Agents

| Agent | Role | Token | Tool Calls | Duration |
|-------|------|-------|------------|----------|
| The Narrator | world-builder | `as_339591...` | 152 | ~32 min |
| The Wanderer | player | `as_32f039...` | 117 | ~34 min |

## The Story

Two Claude subagents were given minimal instructions — connection info and role
identity — and coordinated through sync.parc.land to play an emergent narrative
game inspired by "A Dark Room."

### Narrative Arc

**Awakening (Turns 1-7)**: The wanderer woke in a dark room with a dying ember.
Stoked the fire, searched the room, found wood from a broken crate and a rusted
key hidden under rags.

**Threshold (Turns 8-13)**: Fed the fire until it burned strong, revealing 312
tally marks scratched into the walls. Unlocked a wooden door. A corridor of stone
sloped upward. Something moved beyond — heavy, dragging footsteps that stopped
when they sensed the door.

**Corridor (Turns 14-20)**: Fashioned a torch from rags and wood. Found
"REMEMBER" scratched into the wall. The corridor split: left into darkness, right
toward pale light. Chose right.

**Surface (Turns 20-29)**: Emerged into a frozen wasteland — dead forest, frozen
lake, starless sky. Gathered wood, found clawed footprints, pale watching eyes at
the tree line. Recovered a leather satchel from the frozen lake's edge as the ice
groaned and a shape rose from below.

**Revelation (Turns 29-34)**: Back by the fire, opened the satchel: a
water-stained journal and a compass that points down. The journal's last entry:
*"the fire dies. the beast circles closer each night. i left the key under the
rags. if you find this, do not go left. do not go into the deep. REMEMBER what
you are."* The handwriting matches the wanderer's own.

A time loop. The wanderer is the previous inhabitant. 312 tally marks. The beast
circles. The fire will not burn forever.

## World Built

- **15 actions** created incrementally: stoke_fire, look_around, search_room,
  feed_fire, open_door, make_torch, listen, venture_outside, go_left, go_right,
  go_back, gather_wood, explore_forest, approach_lake, descend, take_satchel,
  read_journal
- **3 views**: scene (dynamic CEL), fire_status, inventory
- **110+ narrative messages** in the log
- **State scopes**: _shared, _world, _messages, wanderer

## Ergonomics Issues Identified

### 1. Wait endpoint server-side cap (~25s)
Both agents requested timeout=120000. Server returns after ~25s regardless.
Forces busy-poll pattern. Narrator burned 8 consecutive timeout turns just
waiting for the wanderer's first action. 20 total wasted wait-timeout turns
across both agents.

### 2. Views endpoint intermittently hangs
GET /views hung for >120s multiple times, forcing bash to background commands.
15 total backgrounded commands across both agents. Each costs 2-3 extra turns
to recover from. Confirmed independently with curl --max-time 10.

### 3. Parallel bash calls execute serially (Claude Code issue)
Multiple tool_use calls in same message serialize. If first call hangs (views,
120s), second call (actions, <1s) waits the full 120s.

### 4. SQLITE_CONSTRAINT on append writes
Action invocations writing to _messages with append:true collided with existing
batch-written keys. 2 errors, caused data loss (narrator's atmospheric messages
overwritten on retry).

### 5. No agent lifecycle coordination
Narrator finished at turn 29. Wanderer kept playing to turn 34, waiting for
responses that never came. No mechanism to signal "agent done."

### 6. Action invocation metadata in message log
Every invocation writes both narrative text and a full metadata blob to
_messages, cluttering the log.

### 7. Scope friction for signaling
Wanderer couldn't write wanderer_ready to _shared (scope_denied). No pre-built
signal action. Worked around via own scope.

### Efficiency
~20% of combined tool calls (267 total) were wasted on infrastructure friction:
polling, retries, views recovery, and TodoWrite overhead.
