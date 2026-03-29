# Exploration: Linking, Nesting, and Connecting Sync Rooms

*Oblique Strategy drawn: **"Give the game away"***
*Mode: hourly | Seed: 2026-2-18-22 | Index: 24*

---

## The card, interpreted

"Give the game away" is about transparency and disclosure. Stop concealing
the mechanics — reveal them. Applied to room linking:

> **What if a room could publish its entire game — its actions, views, state
> shape, and coordination logic — as a legible interface that other rooms
> can consume?**

Right now rooms are opaque to each other. An agent can read from room A and
write to room B, but the *platform* doesn't know that's happening. The agent
IS the link, and the link is invisible.

"Give the game away" says: make the link visible. Make it structural. Make
it part of the room's declared interface.

---

## The current boundary

Every room is a sealed namespace:

- State is partitioned by `room_id` in every SQL query
- CEL expressions evaluate against a single room's context
- Actions can only write to `(scope, key)` within their own room
- `/context` returns one room. `/wait` polls one room
- Auth tokens are scoped to specific rooms

Cross-room coordination is possible but **illegible** — it lives inside
agent behavior, not in the platform's data model. The platform can't see
it, audit it, or render it on a dashboard.

---

## Five models for room connection

### 1. Portals — rooms that expose state as a readable surface

**The lightest touch.** A room can declare a *portal*: a named, read-only
projection of its state that other rooms can reference in CEL expressions.

```
POST /rooms/game-engine/actions/_register_portal/invoke
{
  "params": {
    "id": "scoreboard",
    "expr": "{ scores: state['_shared']['scores'], round: state['_shared']['round'] }",
    "visibility": "public"
  }
}
```

In another room's CEL:
```cel
portal("game-engine", "scoreboard").scores["alice"]
```

**What this gives away:** The game engine reveals its score structure.
Other rooms can build views, conditions, and actions that react to it
without the game engine knowing or caring who's watching.

**Design tension:** This breaks the sealed-namespace model. CEL evaluation
now needs to reach across room boundaries. But the portal is *declared by
the source room* — it controls what's visible. The source room gives its
own game away, voluntarily.

**Implementation sketch:**
- New scope `_portals` in the source room
- Portal definitions stored as state entries with CEL expressions
- `buildContext()` gains an optional `portals` map populated by
  resolving cross-room portal expressions
- Auth: portal reader needs a token with at least `rooms:SOURCE:read`
  scope, OR portals can be marked `public` (no auth required)

---

### 2. Wormholes — bidirectional action tunnels

A *wormhole* connects an action in room A to an action in room B.
Invoking one side triggers the other.

```
POST /rooms/control-room/actions/_register_wormhole/invoke
{
  "params": {
    "local_action": "launch",
    "remote_room": "missile-silo",
    "remote_action": "fire",
    "param_map": { "target": "params.coordinates" }
  }
}
```

When `launch` is invoked in `control-room`, the platform also invokes
`fire` in `missile-silo`, mapping parameters across.

**What this gives away:** The control room reveals that its `launch`
action is not self-contained — it has an external dependency. The
audit trail shows both sides of the tunnel. No hidden agent shuttling
data between rooms.

**Design tension:** This is a *write* that crosses room boundaries.
It needs auth on both sides. The wormhole registration must prove
authority in both rooms (dual-token or a token with scope on both).

**Implementation sketch:**
- Wormhole definitions stored in `_wormholes` scope
- `invoke()` checks for wormhole config after local execution
- Remote invocation uses internal dispatch (no HTTP round-trip)
- Both invocations logged to their respective `_audit` scopes
- A synthetic `_wormhole_audit` view shows the paired events

---

### 3. Nesting — rooms as scopes within parent rooms

A room can *contain* other rooms. The child room's entire state appears
as a scope in the parent. The parent's shared state appears as a
read-only `_parent` context in the child.

```
POST /rooms/organization/actions/_nest_room/invoke
{
  "params": {
    "child_room": "team-alpha",
    "mount_as": "alpha"
  }
}
```

In the parent room:
```cel
state['alpha']['_shared']['status']   // child's shared state
```

In the child room:
```cel
state['_parent']['_shared']['directive']   // parent's shared state
```

**What this gives away:** The parent reveals its full state to children.
Children reveal their full state to the parent. The hierarchy is the
interface. Everyone can see everyone's game.

This is the most "give the game away" model — maximum transparency,
minimum encapsulation. It works when the rooms *want* to be coupled:
a project room containing workstream rooms, an organization room
containing team rooms.

**Design tension:** What about privacy? An agent's private scope in a
child room would be visible to the parent's admin. The nesting model
needs to decide: does the parent see everything, or only `_shared`?

**Implementation sketch:**
- New table `room_hierarchy(parent_id, child_id, mount_name)`
- `buildContext()` recursively includes mounted child state
- Child's `buildContext()` includes parent's `_shared` as `_parent`
- Depth limit (e.g., 3 levels) to prevent infinite recursion
- Actions stay room-local — nesting is read-only by default
  (combine with wormholes for cross-level writes)

---

### 4. Federations — rooms that share a vocabulary

Instead of sharing state, rooms share *structure*. A federation defines
a common set of action signatures, view schemas, and state key
conventions. Member rooms implement the interface.

```
POST /rooms/federation-hub/actions/_define_federation/invoke
{
  "params": {
    "id": "game-protocol",
    "required_actions": ["move", "forfeit", "status"],
    "required_views": ["board", "scores"],
    "state_schema": {
      "_shared.turn": "string",
      "_shared.moves": "list"
    }
  }
}
```

```
POST /rooms/chess-match-42/actions/_join_federation/invoke
{
  "params": {
    "federation": "federation-hub",
    "protocol": "game-protocol"
  }
}
```

**What this gives away:** The federation publishes the *rules of the game*
— what actions exist, what state looks like, what views are available.
Any room implementing the protocol is legible to any agent that knows
the protocol. The game is given away at the structural level.

This is "give the game away" as *standardization*. The individual room's
state is still private, but its *shape* is public. You know what questions
to ask and what actions to invoke without reading each room's specific
documentation.

**Design tension:** Who enforces the protocol? Is it a lint-time check
(advisory) or a runtime constraint (blocking)? Advisory is simpler and
more in the spirit of sync's permissive model.

**Implementation sketch:**
- Federation definitions stored in a hub room's `_federations` scope
- `_join_federation` action validates that required actions/views exist
- Federation membership tracked in `_config` scope
- Dashboard surface: "federation compliance" view showing which
  required elements are registered vs. missing
- No runtime enforcement — just visibility

---

### 5. Mirrors — eventual consistency across room boundaries

A *mirror* is a view in room B that tracks a value in room A. The
platform periodically evaluates the source and updates the mirror.
Not real-time — eventually consistent.

```
POST /rooms/dashboard/actions/_register_mirror/invoke
{
  "params": {
    "id": "team_status",
    "source_room": "team-alpha",
    "source_expr": "views['sprint_progress']",
    "poll_interval": 30,
    "target_key": "_shared.alpha_progress"
  }
}
```

**What this gives away:** The dashboard room declares exactly what it's
watching and where it's watching it. The dependency is visible in the
room's action/view registry. Anyone reading the dashboard's context
can see its sources.

**Design tension:** This introduces background work — the platform
needs a polling loop or change-feed mechanism. The existing timer
system (`timers.ts`) could drive this, but it's a new class of
platform-managed side effect.

**Implementation sketch:**
- Mirror definitions in `_mirrors` scope
- Timer-driven evaluation (reuse existing timer infrastructure)
- Source room auth via stored token reference (encrypted in mirror def)
- Mirror writes go through normal action invocation (auditable)
- Staleness indicator: `_mirror_meta.team_status.last_sync`

---

## What the card revealed

"Give the game away" pushed toward models where the *connection itself*
is visible data, not hidden agent behavior. Three insights:

### 1. The link should be a first-class object

Right now cross-room coordination is invisible to the platform. All five
models share this: the relationship between rooms becomes *state that can
be inspected, queried, and rendered*. An agent bridging two rooms is a
black box. A portal, wormhole, or mirror is legible.

### 2. Read-links and write-links are fundamentally different

Portals and mirrors (read) are safe and composable — they don't change
the source room. Wormholes (write) are powerful but dangerous — they
create action-at-a-distance. The platform should probably ship read-links
first and let write-links emerge from usage patterns.

### 3. Giving the game away is the auth model

The card accidentally describes the right security posture: the *source*
room decides what to expose. A portal is the source room saying "here's
my game, take it." This is better than the alternative (a consuming room
reaching into a source room's internals) because it preserves the source
room's authority over its own boundaries.

---

## Recommendation: start with portals

Portals are the smallest change that creates the most new capability:

1. **Additive** — no changes to existing room isolation
2. **Source-controlled** — the exposing room decides what's visible
3. **CEL-native** — portal references work in existing view/action expressions
4. **Auditable** — portal reads can be logged
5. **Composable** — a portal of a portal is just a view

The implementation touches three files:
- `schema.ts` — add `_portals` to reserved scopes
- `cel.ts` — add `portal()` function to CEL context
- `main.ts` or `invoke.ts` — handle `_register_portal` action

Estimated surface area: ~100 lines of new code for the core mechanism,
plus view/dashboard integration.

Mirrors are the natural second step (portals + a timer loop).
Wormholes and nesting are v2 ideas that need more design work.
Federations are orthogonal and could ship independently.

---

## Open questions

1. **Should portals be pull or push?** Pull (consumer evaluates on read)
   is simpler. Push (source evaluates and caches) is faster for
   high-read scenarios.

2. **How do portal permissions compose?** If room A has a portal and
   room B references it in a view, does a reader of room B need auth
   on room A? Or does room B's view "own" the resolved value?

3. **Can a room portal its actions, not just its state?** An "action
   portal" would let room B invoke room A's actions through a declared
   interface — which is basically a wormhole. Should these be unified?

4. **What's the dashboard surface for inter-room connections?**
   A graph view? A dependency table? This is a new surface type that
   doesn't exist yet.

5. **Does nesting imply lifecycle coupling?** If a parent room is
   deleted, are children deleted? Or do they become orphans? The
   lifecycle question is harder than the data question.

---

*This exploration was catalyzed by Oblique Strategies card #24.
The card's value was in reframing "how do rooms connect?" as
"how do rooms reveal themselves to each other?" — which led
directly to the portal model as the natural starting point.*
