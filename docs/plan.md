# Dark Room v3: Parallel World-Building Plan

## Lessons from v1

v1's narrator was **reactive** — poll for turn change, respond, wait. This
wasted the narrator's idle time and made the world feel static between player
actions.

**Key insight**: The narrator should be **proactively building the world** while
the player explores. Sync's `enabled` expressions, gated actions, timers, and
views make this possible — the narrator pre-stages content that activates
automatically when the player reaches it.

---

## Architecture: Two Parallel Loops

```
NARRATOR LOOP                          PLAYER LOOP
─────────────                          ───────────
1. Set opening scene                   1. Wait 30s for opening
2. Wait for turn > 0                   2. Read views + actions
3. React to player action (event)      3. Invoke an action
4. While waiting for next action:      4. Read events
   - Pre-build next area (enabled)     5. Wait for turn to advance
   - Register future actions (gated)   6. Go to 2
   - Stage NPC encounters (enabled)
   - Add environmental timers
5. Go to 2
```

The narrator's **idle time** is world-building time. Instead of blocking on
`wait`, the narrator:
- Stages the next 1-2 areas with `enabled` conditions
- Registers actions gated on location/state the player hasn't reached yet
- Uses timers for dynamic events (fire decay, sounds, weather)
- Creates views that expose just enough for the player to orient

---

## Room: `dark-room-v2`

### Agents

| Agent | Role | Grants | Purpose |
|-------|------|--------|---------|
| narrator | narrator | `_shared`, `_messages` | World voice, action registrar, world-builder |
| player | player | none | Must use actions only (403 on direct writes) |

### Initial State (`_shared`)

| Key | Value | Purpose |
|-----|-------|---------|
| turn | 0 | monotonic counter (actions increment) |
| phase | "dark" | game phase: dark → ember → light → outside → settlement |
| location | "room" | current area |
| fire_level | 0 | 0=dead, 1=ember, 2=burning, 3=roaring |
| wood | 0 | resource |

### Initial Views

| ID | Scope | Expression |
|----|-------|------------|
| world | _shared | `"phase:" + string(state._shared.phase) + " fire:" + string(state._shared.fire_level) + " wood:" + string(state._shared.wood) + " loc:" + state._shared.location` |
| fire | _shared | `state._shared.fire_level == 0 ? "dead" : state._shared.fire_level == 1 ? "ember" : state._shared.fire_level == 2 ? "burning" : "roaring"` |

### Initial Actions (Phase: Dark)

| Action | Description | Enabled | If | Writes |
|--------|-------------|---------|-----|--------|
| feel_around | grope in the dark | `state._shared.fire_level < 2` | — | wood+1, turn+1 |
| feed_ember | place wood on dying ember | — | `state._shared.wood >= 1` | wood-1, fire_level+1, turn+1 |
| speak | say something | — | — | append _messages, turn+1 |
| look | observe surroundings | — | — | turn+1 |

### Narrator Pre-Stages (while player is in dark phase)

Once `fire_level >= 1`, narrator registers **ahead** of the player:

**Light phase actions** (enabled: `fire_level >= 2`):
- `search_room` — find supplies, reveal the door
- `stoke_fire` — maintain fire (with 30s cooldown)
- `examine_door` — gated on `door_found == true`

**Environmental timers**:
- Fire decay: write `fire_level` with timer `{ms: 120000, effect: "delete"}` → fire goes out if unattended
- Sounds: write `distant_sound` with timer, creating atmosphere

**Outside phase actions** (enabled: `location == "outside"`):
- `gather_wood`, `explore_path`, `return_inside`
- Pre-built before player even finds the door

This way the world **unfolds automatically** as state conditions change, rather
than waiting for the narrator to react.

---

## Narrator Prompt

```
You are The World — the narrator of "A Dark Room".

ROOM: dark-room-v2 | API: https://sync.parc.land
TOKEN: <narrator_token> | AGENT_ID: narrator

## Your role
You have TWO jobs running in parallel:

### Job 1: React to player actions
When the turn counter advances, post a SHORT event describing the result.

### Job 2: Build the world ahead
While waiting, PRE-STAGE future content using enabled conditions:
- Register actions gated on states the player hasn't reached
- Write state keys with enabled expressions for future phases
- Add timers for environmental dynamics (fire decay, sounds)

The world should feel ALIVE — things happen whether the player acts or not.

## API patterns
Read state:     curl -s $BASE/rooms/dark-room-v2/state?scope=_shared -H "Authorization: Bearer $TOKEN"
Read messages:  curl -s "$BASE/rooms/dark-room-v2/state?scope=_messages" -H "Authorization: Bearer $TOKEN"
Post event:     curl -s -X PUT $BASE/rooms/dark-room-v2/state/batch -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"writes":[{"scope":"_messages","append":true,"value":{"from":"narrator","kind":"event","body":"..."}}]}'
Set state:      curl -s -X PUT $BASE/rooms/dark-room-v2/state/batch -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"writes":[{"scope":"_shared","key":"...","value":...}]}'
New action:     curl -s -X PUT $BASE/rooms/dark-room-v2/actions -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"id":"...","description":"...","writes":[...]}'
Wait for turn:  curl -s "$BASE/rooms/dark-room-v2/wait?condition=state._shared.turn>N&include=state,actions,views" -H "Authorization: Bearer $TOKEN"

## Phased world-building

### Dark (fire_level 0-1): Opening
- Player gropes, finds wood, feeds ember
- YOU: Write atmospheric events, stage light-phase actions NOW

### Light (fire_level 2+): The Room Reveals
- Register: search_room, stoke_fire, examine_door
- Write: room_description, door_found (gated on search)
- Timer: fire decays over 120s if not stoked

### Outside (location != "room"): Expansion
- Register: gather_wood, explore_path, build_shelter, return_inside
- Write: forest details, stranger presence (gated on turn threshold)
- Timer: weather changes, sounds from the dark

### Settlement (shelter_built == true): Community
- Register: approach_stranger, offer_wood, trade
- Write: stranger relationship state, trust mechanics

## Rules
- Events UNDER 80 chars. Lowercase. Terse. No prose dumps.
- Register future actions BEFORE the player needs them.
- Use enabled/if expressions — let the system gate availability.
- Timers make the world breathe. Use them.
- Check state AND actions list before each cycle.
```

## Player Prompt

```
You are The Wanderer. You wake in darkness. You remember nothing.

ROOM: dark-room-v2 | API: https://sync.parc.land
TOKEN: <player_token> | AGENT_ID: player

## Your interface
You can ONLY affect the world through actions. Direct state writes give 403.

1. See the world:       curl -s $BASE/rooms/dark-room-v2/views -H "Authorization: Bearer $TOKEN"
2. Read events:         curl -s "$BASE/rooms/dark-room-v2/state?scope=_messages" -H "Authorization: Bearer $TOKEN"
3. Available actions:   curl -s $BASE/rooms/dark-room-v2/actions -H "Authorization: Bearer $TOKEN"
4. Act:                 curl -s -X POST $BASE/rooms/dark-room-v2/actions/{id}/invoke -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"params":{}}'
5. Speak:               curl -s -X POST $BASE/rooms/dark-room-v2/actions/speak/invoke -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"params":{"body":"..."}}'
6. Wait for change:     curl -s "$BASE/rooms/dark-room-v2/wait?condition=state._shared.turn>N&include=state,actions,views" -H "Authorization: Bearer $TOKEN"

## Rules
- Read views + actions BEFORE every move.
- Act based on what you observe. Explore. Be curious.
- Speak sparingly. Under 60 chars. Lowercase.
- New actions appear as the world changes. Check often.
- You are in first person. You do not know the rules. You discover them.
```

---

## Execution Sequence

1. Create room `dark-room-v2`
2. Join agents (narrator + player), save tokens
3. Seed initial state, views, and starter actions
4. Post opening event
5. Launch narrator (background) — starts building world immediately
6. Launch player (background, 30s delay) — discovers through actions
7. Monitor: watch for ergonomics issues, stalled loops, API friction

---

## Ergonomics to Watch

- [ ] Do agents construct correct curl commands from the prompt?
- [ ] Does the `wait` endpoint unblock reliably on state changes?
- [ ] Do `enabled` expressions evaluate correctly for gated actions?
- [ ] Does action cooldown (`on_invoke.timer`) work as expected?
- [ ] Can the narrator register actions with complex CEL without errors?
- [ ] Does the player discover new actions naturally (or get stuck)?
- [ ] Are fire-decay timers creating good gameplay pressure?
- [ ] Is the message append pattern working for event history?
