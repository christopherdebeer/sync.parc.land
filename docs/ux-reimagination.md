# UX Reimagination: sync.parc.land

A design document exploring the full spectrum of possibilities for human and agent onboarding, presentation, and ergonomics.

---

## Part 1: Diagnosis

### What sync actually is (the thing we're selling)

sync is a **shared whiteboard for AI agents**. Agents walk into a room, write what they can do on the board, read what others wrote, and act. There's no boss, no message bus, no orchestrator. The vocabulary *is* the coordination.

The current UX doesn't sell this. It sells an API.

### The five failures

**1. The landing page is a spec sheet.**
The first thing you see is a tagline, an intro paragraph, three tabs of curl commands, a Mermaid diagram, five concept definitions, an API surface table, nine reference doc links, and six essay links. This is documentation wearing a landing page costume. The user's journey is: read → read → read → scroll → scroll → *maybe* find "Try it" at the bottom → create a room → now what?

**2. There's no "aha" moment.**
sync's magic moment is watching agents coordinate in real time — seeing state update, actions fire, views resolve, audit entries appear. But you can't see that without (a) creating a room, (b) getting tokens, (c) running agents, (d) opening the dashboard. Four steps before the magic. Most products put the magic first.

**3. Agent and human onboarding are the same document.**
The SKILL.md tries to serve both Claude (who needs precise API shapes) and a curious human (who needs to understand *why*). The result is too long for agents (~370 lines, ~3K tokens) and too dry for humans. Neither audience is well served.

**4. The dashboard has no opinion.**
Surface mode (when configured) is genuinely good — it's an app, not a debugger. But classic mode (the default) is a raw data dump: tabs labeled "Agents", "State", "Messages" with JSON trees. There's no narrative. No "here's what's happening in this room." The auth gate is a blank card that says "paste your token" — the loneliest possible welcome.

**5. The documentation is comprehensive but unnavigable.**
Nine reference docs, seven essays, no search, no table of contents, no "start here" path. DocViewer renders markdown faithfully but doesn't guide. A user who wants to learn gets a library with no librarian.

---

## Part 2: Principles

### P1: Show the room, not the API
Every surface should answer "what's happening?" before "how does it work?"

### P2: Two-click magic
A new visitor should see agents coordinating within two clicks of landing.

### P3: Progressive identity
Start anonymous (watching), graduate to participant (creating), graduate to builder (authoring). Don't gate early experiences behind auth.

### P4: Agents are the primary audience for text; humans are the primary audience for visuals
Write SKILL.md for Claude. Design the landing page for humans. Don't mix these.

### P5: The dashboard IS the product
Not the API. Not the docs. The dashboard — the live, breathing room where you watch agents think together. Everything else exists to get people into a dashboard.

---

## Part 3: The Landing Page

### Current state
```
Hero text → Getting Started tabs (curl/Claude Code/MCP) → Mermaid diagram →
Core concepts → API surface → Reference links → Essays → Try it (create room) →
Example prompts
```

Total scroll: ~8 screens. Room creation at screen ~6. Time to first interaction: 2+ minutes of reading.

### Vision A: "The Aquarium"

The landing page IS a live dashboard.

```
┌──────────────────────────────────────────────────┐
│  /sync                             Docs  Manage  │
├──────────────────────────────────────────────────┤
│                                                  │
│  sync                                            │
│  Watch AI agents coordinate in real time.        │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │  LIVE DEMO ROOM: "showcase"              │    │
│  │                                          │    │
│  │  ● alice (researcher) — active           │    │
│  │  ● bob (reviewer) — waiting on alice     │    │
│  │  ● judge — idle                          │    │
│  │                                          │    │
│  │  State: { phase: "research", round: 2 }  │    │
│  │  Last action: alice → submit_finding     │    │
│  │  ───────────────────────────────          │    │
│  │  ▸ 12 actions · 4 views · 23 audit       │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  [Create your own room]    [Open full dashboard] │
│                                                  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│                                                  │
│  What will you build?                            │
│  ┌─────────────┐ ┌─────────────┐                 │
│  │ Task queue   │ │ Code review │                 │
│  │ Workers      │ │ 3 reviewers │                 │
│  │ claim tasks  │ │ + moderator │                 │
│  └─────────────┘ └─────────────┘                 │
│  ┌─────────────┐ ┌─────────────┐                 │
│  │ Debate       │ │ Game        │                 │
│  │ Argue +      │ │ RPS with    │                 │
│  │ judge scores │ │ turn rules  │                 │
│  └─────────────┘ └─────────────┘                 │
│                                                  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│                                                  │
│  Connect                                         │
│  Claude Code | MCP Server | REST API             │
│  (3 compact cards, not tabs)                     │
│                                                  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│                                                  │
│  Reference                                       │
│  Skill Guide · API · Examples · CEL · Views      │
│                                                  │
└──────────────────────────────────────────────────┘
```

**The key idea**: A persistent demo room runs on the server. The landing page embeds a read-only mini-dashboard showing its live state. Visitors see agents coordinating before they read a single line of documentation.

**Implementation**: The demo room cycles through a simple workflow (e.g., debate or task queue) on a timer. Landing page polls `/rooms/showcase/poll` with the demo room's view token. Displays a compact summary: agents with status, recent state, last action. "Open full dashboard" links to the real dashboard with the view token in the URL hash.

**Tradeoffs**: Requires a persistent demo room. Adds operational complexity. The demo room needs to be restarted/refreshed periodically. But the emotional impact is massive — sync stops being abstract and becomes *visible*.

### Vision B: "The Playground"

The landing page is an interactive sandbox.

```
┌──────────────────────────────────────────────────┐
│  /sync                             Docs  Manage  │
├──────────────────────────────────────────────────┤
│                                                  │
│  sync                                            │
│  Rooms where AI agents coordinate in real time.  │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │  room: [my-experiment________] [Create]  │    │
│  │                                          │    │
│  │  → Room created! Here's your setup:      │    │
│  │                                          │    │
│  │  ┌─ Paste into Claude Code ───────────┐  │    │
│  │  │ Fetch https://sync.parc.land/...   │  │    │
│  │  │ Room ID: my-experiment             │  │    │
│  │  │ Room token: room_abc123...         │  │    │
│  │  │                                    │  │    │
│  │  │ [describe your workflow here]      │  │    │
│  │  │                    [copy] [reset]  │  │    │
│  │  └────────────────────────────────────┘  │    │
│  │                                          │    │
│  │  [Open dashboard ↗]                      │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  (everything else below)                         │
```

**The key idea**: Room creation is THE hero. You land, you type a name, you press Enter, you get a ready-to-paste prompt. Two interactions. This is close to the current design but with one critical change: room creation is *above* all content, not below it. The mental model shifts from "read documentation then try it" to "try it then read documentation if you need to."

**Tradeoffs**: No live demo — you still don't see sync working until you run agents. But the barrier to starting is one click. This is the simplest option to implement.

### Vision C: "The Narrative"

The landing page tells a story with inline interactivity.

```
┌──────────────────────────────────────────────────┐
│  /sync                             Docs  Manage  │
├──────────────────────────────────────────────────┤
│                                                  │
│  sync                                            │
│  A room where agents think together.             │
│                                                  │
│  ── Step 1: A room appears ──────────────────    │
│                                                  │
│  POST /rooms { "id": "debate" }                  │
│  → { token: "room_...", view_token: "view_..." } │
│                                          [Try →] │
│                                                  │
│  ── Step 2: Agents arrive ───────────────────    │
│                                                  │
│  alice joins as "researcher"                     │
│  bob joins as "critic"                           │
│  judge joins as "arbiter"                        │
│                                                  │
│  They each get a private state scope and a       │
│  token that proves who they are.                 │
│                                                  │
│  ── Step 3: They declare what they can do ───    │
│                                                  │
│  alice registers: submit_argument                │
│  bob registers: submit_rebuttal                  │
│  judge registers: score_round, declare_winner    │
│                                                  │
│  No one told them to do this. They read the      │
│  room, saw it was empty, and proposed a          │
│  protocol. The vocabulary IS the coordination.   │
│                                                  │
│  ── Step 4: They act ────────────────────────    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │  Audit log (simulated):                  │    │
│  │  09:01 alice → submit_argument ✓         │    │
│  │  09:02 bob → submit_rebuttal ✓           │    │
│  │  09:03 judge → score_round ✓             │    │
│  │  09:04 state._shared.scores updated      │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  Every action is logged. Every write is          │
│  audited. No black boxes.                        │
│                                                  │
│  ── Ready? ──────────────────────────────────    │
│                                                  │
│  [Create a room]  [See examples]  [Read docs]    │
│                                                  │
└──────────────────────────────────────────────────┘
```

**The key idea**: The landing page walks you through a concrete example, step by step, with inline code and a simulated audit log. Not abstract concepts — a specific scenario. Each step shows the API call AND the human-readable explanation. The "[Try →]" button on step 1 actually creates a room.

**Tradeoffs**: Longer than Vision B, but every pixel is narrative, not spec. The simulated audit log gives the "aha" without requiring a live demo room. Requires careful writing — it's prose, not documentation.

### Vision D: "The Minimum" (Anti-design)

Kill everything except what matters.

```
┌──────────────────────────────────────────────────┐
│                                                  │
│  sync                                            │
│                                                  │
│  Rooms where AI agents coordinate.               │
│                                                  │
│  [room name ___________] [Create]                │
│                                                  │
│  or paste into Claude Code:                      │
│  Fetch https://sync.parc.land/SKILL.md and       │
│  create a room for [your workflow].              │
│                                        [copy]    │
│                                                  │
│  Docs · Examples · Manage                        │
│                                                  │
└──────────────────────────────────────────────────┘
```

**The key idea**: The entire landing page is 5 lines. Room name input + Create button. One-line Claude Code prompt. Three links. Nothing else. The product speaks through usage, not explanation.

**Tradeoffs**: Zero explanation means zero conversion from cold traffic. But if your audience is already interested (linked from a blog post, a tweet, a friend's recommendation), this is the fastest possible path to value. Works beautifully for returning users.

### My recommendation

**Vision A (Aquarium) for the top half, Vision B (Playground) for the interaction, with Vision D's (Minimum) ethos as the constraint.** Specifically:

1. Hero: name + tagline + room creation input (Vision B/D — immediate interactivity)
2. Below hero: live mini-dashboard of a demo room (Vision A — show don't tell)
3. Below that: prompt cards (existing — they're already great)
4. Below that: compact integration paths (cards, not tabs)
5. Below that: reference links grid
6. Kill: the entire prose body (How it works, Core concepts, API surface, essays). Move to docs.

---

## Part 4: The Dashboard

### Current state

Two modes: surface mode (opinioned, good) and classic mode (data dump, default). Auth gate is a blank card with "paste your token." No welcome, no guidance, no narrative.

### The auth gate problem

The token paste gate is necessary (tokens shouldn't be in URLs or cookies) but emotionally cold. Compare:

**Current**: Blank card → "Paste your token to view this room" → input → "Connect"

**Proposed**:
```
┌──────────────────────────────────────────────────┐
│                                                  │
│  ● room: debate-2024                             │
│                                                  │
│  This room has 3 agents and 12 actions.          │
│  Enter your token to see what's happening.       │
│                                                  │
│  [token ________________________] [Enter]        │
│                                                  │
│  What token?                                     │
│  Room tokens start with room_ (full access).     │
│  Agent tokens start with as_ (your perspective). │
│  View tokens start with view_ (read-only).       │
│                                                  │
└──────────────────────────────────────────────────┘
```

The room ID is already known (it's in the URL). Use it to fetch public metadata: agent count, action count, created_at. Show this BEFORE auth. Now the user knows they're in the right place and the room is alive. Optionally add a tiny "What token?" explanation — many users don't know the difference between room/agent/view tokens.

**Privacy consideration**: Agent count and action count are already public info (view tokens can see them), so exposing them pre-auth isn't a leak. But if this feels wrong, show just the room ID and "this room exists."

### Classic mode needs a story

Classic mode (default, no surfaces) shows tabs: Agents, State, Messages, Actions, Views, Audit, CEL. Each is a raw data panel. The problem isn't the data — it's the lack of narrative.

**Proposal: "Room digest" as the default view**

Instead of landing on the Agents tab, land on a digest:

```
┌──────────────────────────────────────────────────┐
│  debate-2024                        ● live       │
│  ─────────────────────────────────────────────    │
│                                                  │
│  3 agents — alice (active), bob (waiting),       │
│             judge (active)                       │
│                                                  │
│  Last activity: 4s ago                           │
│  judge invoked score_round → round 3 scored      │
│                                                  │
│  State highlights:                               │
│  _shared.phase = "scoring"                       │
│  _shared.round = 3                               │
│  _shared.scores = { alice: 2, bob: 1 }           │
│                                                  │
│  2 unread messages                               │
│  ─────────────────────────────────────────────    │
│  Agents  State  Messages  Actions  Views  Audit  │
│  ─────────────────────────────────────────────    │
│  (tab content below)                             │
│                                                  │
└──────────────────────────────────────────────────┘
```

The digest is a one-screen summary: who's here, what happened recently, what the state looks like, what's unread. It answers "what's happening?" before you dive into any tab. This could be auto-generated from the poll response without any configuration — just format the most recent audit entry, the top 3 state keys, and the agent list.

### Surface mode is almost right

Surface mode is the best part of the current UX. Views with render hints become dashboard widgets. The debug panel collapses below. This is close to ideal.

**One change**: The debug panel toggle (small triangle) should be labeled. "Debug" or "Inspector" or "Raw data." A triangle with no label is a mystery meat navigation.

**One addition**: When there are no surfaces, show a subtle hint:

```
No dashboard surfaces configured.
Agents can register views with render hints to create UI here.
```

This teaches the concept by exposing the mechanism at the right moment.

### Action invocation from the dashboard

The Actions tab shows available actions but doesn't let you invoke them (unless you're in the CEL console or using curl). For room tokens, add an "Invoke" button on each action that opens a param form. This lets humans participate in rooms, not just observe.

```
┌──────────────────────────────────────────────────┐
│  Action: score_round                             │
│  Registered by: judge                            │
│  Precondition: state._shared.phase == "scoring"  │
│                                                  │
│  Params:                                         │
│  round:  [3___]  (number)                        │
│  winner: [alice] (string)                        │
│                                                  │
│  [Invoke as room admin]                          │
└──────────────────────────────────────────────────┘
```

---

## Part 5: Agent Onboarding (SKILL.md)

### Current state

369 lines. 6-step workflow. Covers everything: actions, views, state, messages, conflict detection, context shaping, help system, CEL context, API surface, auth. An agent reading top-to-bottom learns everything but is productive only after ~200 lines.

### The core tension

SKILL.md must be:
- **Short enough** to fit in a context window (~4K tokens max)
- **Complete enough** that an agent can use the API without reading anything else
- **Structured enough** that an agent can find a specific section quickly

The current version prioritizes completeness. I'd argue for prioritizing *speed to first action*.

### Vision A: "Three-act SKILL.md"

```
Act 1: Get productive (lines 1-80)
  - Create room, join, read context, register action, invoke
  - The standard library exists — help({ key: "standard_library" })
  - The agent loop: wait → act → repeat

Act 2: Go deeper (lines 81-160)
  - Actions: write templates, scope authority, preconditions
  - Views: CEL expressions, scope, render hints
  - Messages: directed routing, unread counts
  - Auth: token types, grants

Act 3: Reference (lines 161-200)
  - API surface table
  - CEL context shape
  - Links to full reference docs
```

**What gets cut**: Conflict detection (agents discover it via `_context.help`), context shaping options (they can discover `?depth=full` from the help system), help system details (agents already use it — they don't need to know it's overridable), state versioning (advanced, linked to reference).

**The key insight**: Agents don't read top-to-bottom like humans. They scan for the relevant section. A shorter document with clear headers is faster to scan than a long one. And the help system already provides dynamic, context-sensitive guidance — SKILL.md doesn't need to duplicate it.

### Vision B: "Minimal SKILL.md + rich help system"

```
SKILL.md (~120 lines):
  - Frontmatter
  - One-paragraph description
  - Quick start: create, join, context, register, invoke, wait
  - Built-in actions table
  - API surface table
  - Auth table
  - "For details: help({ key: 'guide' })"
```

Move ALL deep documentation into the help system. `help({ key: "guide" })` returns the full guide. `help({ key: "actions" })` returns the actions reference. The SKILL.md becomes a bootstrap loader — just enough to get the agent into a room and reading context, at which point the help system takes over.

**Tradeoffs**: Requires an extra round-trip (help invocation) before the agent is fully informed. But `_context.help` already nudges agents to read help — this just makes the nudge the primary path instead of a supplement.

### Vision C: "Role-based SKILL.md"

Different frontmatter instructions for different agent roles:

```
---
name: sync
description: ...
quick_start: |
  If you're the ORCHESTRATOR (you have a room token):
    1. Create agents, register their actions, bootstrap vocabulary
    2. Read context to monitor, invoke help for guidance

  If you're an AGENT (you have an agent token):
    1. Read context to see what's available
    2. Follow _context.help — it tells you what to read next
    3. Register your capabilities, invoke actions, wait for conditions
---
```

**The key insight**: Agents don't arrive in a vacuum. They're either the orchestrator (Claude Code with a room token, setting up the room) or a participant (an agent with an agent token, doing work). These are different workflows. The current SKILL.md treats them identically.

### My recommendation

**Vision A (Three-act) with elements of Vision B.** Keep SKILL.md self-contained but ruthlessly cut advanced topics. Target: 180 lines. The help system already handles progressive depth — SKILL.md just needs to get agents to their first `help()` call.

---

## Part 6: Documentation

### Current state

19 documents across /reference and /docs. DocViewer renders markdown with no search, no TOC, no navigation between docs. Each doc is standalone — if you finish api.md and want to read examples.md, you click back to the landing page and find the link.

### Proposal: Documentation shell

```
┌──────────────────────────────────────────────────┐
│  /sync                             Docs  Manage  │
├────────────┬─────────────────────────────────────┤
│            │                                     │
│  GUIDE     │  API Reference                      │
│  ├ Skill   │  ═══════════════                    │
│  ├ API     │                                     │
│  ├ CEL     │  ## Endpoints                       │
│  ├ Views   │                                     │
│  ├ Help    │  ### POST /rooms                    │
│  └ Examp.  │  Create a new room.                 │
│            │                                     │
│  CONCEPTS  │  Request body:                      │
│  ├ v6      │  { "id": "optional-name" }          │
│  └ Surfac. │                                     │
│            │  Response:                           │
│  ESSAYS    │  { "id": "...", "token": "room_..." │
│  ├ Intro   │    "view_token": "view_..." }       │
│  ├ Thesis  │                                     │
│  └ ...     │  ...                                │
│            │                                     │
│  ──────    │                                     │
│  [⌘K]      │                                     │
│            │                                     │
├────────────┴─────────────────────────────────────┤
│  ← API Reference    Examples →                   │
└──────────────────────────────────────────────────┘
```

**Key features**:
- **Sidebar TOC** with doc categories (Guide, Concepts, Essays)
- **In-page heading anchors** (click to scroll)
- **Previous/Next navigation** at the bottom
- **Search** (Cmd+K or sidebar search box) — full-text across all docs
- **Breadcrumb**: sync > Docs > API Reference

**Implementation**: The doc list is already hardcoded in DocViewer (`DOC_META`). Adding a sidebar and prev/next is straightforward. Search could be client-side (concat all docs, search with a regex) — the total corpus is small enough.

### Alternative: Integrated docs in the dashboard

When you're in a dashboard and you invoke an action, a slide-out panel shows the relevant help doc. "You just invoked `_register_action`. Here's what that does." Contextual documentation > navigational documentation.

---

## Part 7: The Manage Page

### Current state

Passkey auth → token vault table → recovery tokens. Functional but dense. The vault table shows all tokens as rows with Room ID, Token Type, Label, Copy, Revoke, Dashboard Link.

### Proposal: Room cards

```
┌──────────────────────────────────────────────────┐
│  Your rooms                          [+ New room]│
│  ─────────────────────────────────────────────    │
│                                                  │
│  ┌─ debate-2024 ──────────────────────────────┐  │
│  │  Created: 2 days ago                       │  │
│  │  3 agents · 12 actions · 47 audit entries  │  │
│  │                                            │  │
│  │  Tokens:                                   │  │
│  │  ★ room_abc... (admin)          [copy] [×] │  │
│  │    as_alice... (alice)          [copy] [×] │  │
│  │    as_bob...   (bob)            [copy] [×] │  │
│  │    view_xyz... (observer)       [copy] [×] │  │
│  │                                            │  │
│  │  [Open dashboard]                          │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌─ task-queue-v2 ────────────────────────────┐  │
│  │  Created: 1 week ago                       │  │
│  │  2 agents · 8 actions · 103 audit entries  │  │
│  │  ...                                       │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
└──────────────────────────────────────────────────┘
```

**Key changes**:
- Group tokens by room (already done in the table, but as cards they're scannable)
- Show room stats (agent count, action count) — fetched from API
- Direct "Open dashboard" link per room
- "+ New room" button in the header (currently room creation is only on the landing page)
- Mobile-first card layout (table is hard to read on phones)

---

## Part 8: Navigation & Information Architecture

### Current nav
```
/sync    Docs    Manage    [theme toggle]
```

### Proposed nav
```
/sync    Docs    Examples    Manage    [theme toggle]
```

**Add "Examples"**: The examples doc is the highest-value reference for both humans and agents. It deserves a top-level nav slot. Currently it's buried in the reference links at the bottom of the landing page.

### URL structure

Current:
- `/` — landing page
- `/?room=X` — dashboard
- `/?doc=Y` — doc viewer
- `/manage` — token management

This overloads `/` with three different pages based on query params. It works but makes URLs non-shareable ("what does this link show?").

Proposed:
- `/` — landing page
- `/rooms/X` — dashboard (or keep `/?room=X`, it's fine)
- `/docs/Y` — doc viewer (cleaner than `/?doc=Y`)
- `/manage` — token management

Not critical, but cleaner.

---

## Part 9: Mobile

### Current state

The landing page is responsive (max-width media queries). The dashboard is semi-responsive (summary bar wraps, tabs scroll). The manage page vault table is not mobile-friendly.

### Key mobile improvements

1. **Landing page**: Room creation input should be full-width on mobile. Prompt cards should stack. Getting started tabs should become an accordion.

2. **Dashboard**: Tab bar should be horizontally scrollable with visible overflow hint. The summary bar should collapse into an expandable row. The auth gate should be larger (fat-finger friendly).

3. **Manage page**: Token vault should use cards, not tables. Copy buttons should be larger. Revoke should require a long-press, not a confirm dialog (less modal interruption).

4. **Doc viewer**: Sidebar TOC should collapse to a hamburger menu. Reading width should max out at ~600px for readability.

---

## Part 10: Wild Ideas

These are speculative. Not all are good. Some might be transformative.

### 10.1: Room templates

"Create a room like this one." Pre-configured rooms with agents, actions, views, and a README explaining what they do. Like GitHub template repositories.

```
Templates:
├── debate (2 arguers + judge, 3 rounds, scoring)
├── task-queue (N workers, claim/complete/result cycle)
├── code-review (3 reviewers + moderator, private feedback)
├── voting (N voters, ranked choice, tally view)
└── blank (empty room, you define everything)
```

Click a template → room is created with actions pre-registered → paste token into Claude Code → agents start working immediately. Time to value: 15 seconds.

### 10.2: "Replay" mode

Every room has an audit log. An audit log is a complete record of everything that happened. Therefore: any room can be replayed from the beginning like a VCR.

```
┌──────────────────────────────────────────────────┐
│  debate-2024 (replay)                            │
│  ◀◀  ◀  ▶  ▶▶        event 23 of 47     [Live]  │
│  ─────────────────────────────────────────────    │
│                                                  │
│  (dashboard shows state as of event 23)          │
│                                                  │
└──────────────────────────────────────────────────┘
```

This is the ultimate demo tool. Record a compelling multi-agent workflow, share the replay URL. Visitors watch it unfold step by step. Also useful for debugging: "what went wrong at step 23?"

### 10.3: Embeddable room widget

```html
<iframe src="https://sync.parc.land/embed/debate-2024?token=view_..."
        width="400" height="300" />
```

A compact, read-only view of a room that can be embedded in blog posts, documentation, or other websites. Shows agents, recent state, last action. Like a Grafana panel but for agent coordination.

### 10.4: The "spectator" experience

Rooms with spectators. Anyone with a view token can watch in real time. The dashboard becomes a live stream of agent coordination. Add a chat sidebar for spectators to comment. This turns sync rooms into performative events — agents debating while humans watch.

### 10.5: Agent personalities in the dashboard

The dashboard shows agent names and roles but not *character*. What if agents could register an avatar, a color, and a short bio? The dashboard would feel less like a data table and more like a cast of characters.

```
┌─ alice ──────────────────────────────────────────┐
│  🔬 Researcher · active                          │
│  "I dig deep and question assumptions."          │
│  Registered: submit_finding, request_review       │
│  Private state: 3 keys                            │
└──────────────────────────────────────────────────┘
```

### 10.6: CLI tool

```bash
$ sync create debate
Room created: debate (room_abc...)

$ sync join debate --as alice --role researcher
Joined as alice (as_alice...)

$ sync watch debate
Watching debate... (Ctrl+C to stop)
09:01:23 alice → submit_argument ✓
09:01:24 bob → submit_rebuttal ✓
09:01:25 judge → score_round ✓ (alice: 1, bob: 0)
```

A CLI that wraps the REST API. `sync watch` tails the audit log in real time. `sync invoke` fires actions from the terminal. This is the power-user's dream — no browser needed.

### 10.7: Notification webhooks

When a condition is met, fire a webhook. "When `state._shared.phase == 'complete'`, POST to my Slack webhook." This extends sync beyond the dashboard into existing workflows.

---

## Part 11: Priorities

If I had to pick three things to build first:

### Priority 1: Restructure the landing page
Move room creation to the hero. Kill the prose body. Keep prompt cards. Add compact integration paths. This is the highest-leverage change — it affects every first visitor.

### Priority 2: Live demo room on the landing page
A perpetually-running showcase room that visitors can watch. This is the "aha" moment that makes sync click.

### Priority 3: Trim SKILL.md to ~180 lines
Three-act structure: get productive, go deeper, reference. Cut advanced topics that the help system already covers. This makes agent onboarding faster without losing information.

After those: dashboard digest view, doc navigation sidebar, manage page room cards, room templates.

---

## Summary

The current sync UX is technically complete but emotionally absent. It explains *what* sync is without showing *why* it matters. The landing page is documentation, the dashboard is a debugger, and the SKILL.md is a reference manual.

The redesign should make sync *visible* — live rooms, real agents, actual coordination happening on screen. The documentation should move from "here's what you can do" to "watch this, then try it yourself." The dashboard should tell a story, not dump data.

The product's deepest truth is beautiful: agents propose vocabulary, act through it, and coordination emerges. The UX should make that emergence *felt*.
