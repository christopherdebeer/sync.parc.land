# sync.parc.land — Starter Prompts

Refined prompts for demoing multi-agent coordination on sync.parc.land.
Each prompt is designed to be self-contained and produce a working, visually
inspectable result via the dashboard.

---

## 1. Structured Debate

```
Fetch https://sync.parc.land/SKILL.md to learn the sync platform API.
Build a 3-round debate room on sync.parc.land.

Setup:
- Create a room. Initialize _shared state: round=1, phase="argument",
  and a scores object for tracking points.
- Register custom actions with CEL preconditions that enforce the debate
  flow: "submit_argument" (gated on phase=="argument" and it being that
  debater's turn), "submit_rebuttal" (gated on phase=="rebuttal"), and
  "score_round" (judge only, gated on phase=="scoring", writes score and
  advances to next round).
- Register a "scoreboard" view that shows the running total for each side.

Agents:
- "pro" — argues in favor
- "con" — argues against
- "judge" — scores each round 1-10 with a one-sentence rationale

Topic: "AI will create more jobs than it eliminates in the next decade."

Run all 3 rounds to completion: pro argues, con rebuts, judge scores.
After round 3, the judge declares a winner via message.
Print the dashboard URL so I can read the full transcript.
```

### Why this works

- **Turn enforcement via CEL** — the platform's strongest feature gets showcased
  with phase-gated actions that prevent out-of-order moves.
- **Views for aggregation** — the scoreboard view is a live computation, not just
  static state.
- **Self-contained** — concrete topic means the agent doesn't need to wait for
  user input. All 3 rounds run automatically.
- **Clear deliverable** — dashboard URL at the end for visual inspection.

---

## 2. Rock-Paper-Scissors Tournament

```
Fetch https://sync.parc.land/SKILL.md to learn the sync platform API.
Build a round-robin rock-paper-scissors tournament on sync.parc.land.

Setup:
- Create a room. Track in _shared state: current match (player pair),
  match results log, and a wins/losses/draws tally per player.
- Register a "throw" action: players write their choice (rock/paper/scissors)
  to their private state. CEL precondition: the player is in the current
  match and hasn't thrown yet.
- Register a "resolve_match" action (referee only): CEL precondition checks
  that both players in the current match have thrown. Reads both moves via
  views, determines winner, updates scores, advances to next match.
- Register views: "standings" (win counts), and per-player "last_move"
  views that only reveal the move after the match resolves.

Agents: 4 players ("alice", "bob", "carol", "dave") and a "referee".

Run a full round-robin (6 matches). Each match: both players throw, referee
resolves. After all matches, referee posts final standings as a message.
Print the dashboard URL.
```

### Why this works

- **Private state → reveal** — sealed moves using private state, only visible
  after resolution. This is the canonical "hidden information" pattern.
- **CEL-gated resolution** — referee can only resolve after both players submit,
  preventing premature reveals.
- **Concrete scale** — 4 players × round-robin = 6 matches, enough to be
  impressive without being unwieldy.
- **Views for information hiding** — standings are public, unresolved moves are not.

---

## 3. Task Queue with Worker Agents

```
Fetch https://sync.parc.land/SKILL.md to learn the sync platform API.
Build a task dispatch system on sync.parc.land.

Setup:
- Create a room. Use _shared state for a task counter.
- Register a "post_task" action: appends a task entry (with description,
  status="pending", claimed_by=null) to a _tasks scope using log-append.
- Register a "claim_task" action with a CEL precondition:
  state._tasks[params.key].claimed_by == null. On success, merges
  claimed_by=${self} and status="in_progress".
- Register a "complete_task" action gated on the invoker being the one
  who claimed it. Merges status="done" and a result field.
- Register a "task_board" view showing a summary of task statuses.

Agents: "dispatcher" (posts tasks) and two workers ("worker-1", "worker-2").

Demo: Dispatcher posts 4 tasks with distinct descriptions (e.g., "summarize
the benefits of remote work", "list 3 sorting algorithms", "explain
photosynthesis in one sentence", "name 5 world capitals"). Workers use wait
conditions to detect unclaimed tasks, race to claim them, write a short
result, then mark them complete. Print the dashboard URL.
```

### Why this works

- **Claiming with CEL guards** — atomic claim-or-fail is a first-class platform
  pattern (shown in the examples doc). High confidence this works correctly.
- **Concrete tasks** — specific task descriptions mean the agent can generate
  real completions, not placeholders.
- **Race condition showcase** — two workers competing for tasks demonstrates
  real coordination, not just sequential execution.
- **wait conditions** — workers blocking until tasks appear shows the long-poll
  pattern working in practice.

---

## 4. Private Code Review Pipeline

```
Fetch https://sync.parc.land/SKILL.md to learn the sync platform API.
Build a code review pipeline on sync.parc.land.

Setup:
- Create a room. Initialize _shared state: phase="accepting",
  submission=null, reviews_needed=3.
- Register a "submit_code" action (room token only) that writes a code
  snippet to _shared.submission and sets phase="reviewing".
- Register a "submit_review" action: each reviewer writes feedback to
  their own private state with public=false. CEL precondition: phase is
  "reviewing" and this reviewer hasn't already submitted (check via a
  self-scoped "reviewed" flag).
- Register a "reviews_ready" view (scoped to _shared) that counts how
  many reviewers have submitted by checking each reviewer's state via
  granted scope access.
- Register a "synthesize" action (moderator only, gated on all 3 reviews
  being in). Moderator reads all reviews and writes a combined summary
  to _shared.final_review.

Agents: 3 reviewers ("reviewer-1", "reviewer-2", "reviewer-3") and a
"moderator". Grant the moderator read access to all reviewer scopes.

Demo: Submit this function for review:
  function dedupe(arr) { return [...new Set(arr)]; }
Each reviewer independently critiques it (style, correctness, edge cases).
The moderator synthesizes a final review. Print the dashboard URL.
```

### Why this works

- **Private state for independence** — reviewers can't see each other's feedback
  until the moderator synthesizes, preventing groupthink.
- **Scope grants** — moderator getting read access to reviewer scopes is a
  clean demo of the grants system.
- **CEL-gated synthesis** — moderator can only act once all reviews are in,
  showing conditional coordination.
- **Concrete code** — a real function to review means real feedback, not
  generic placeholder text.

---

## 5. Sealed-Bid Auction (New)

```
Fetch https://sync.parc.land/SKILL.md to learn the sync platform API.
Run a 3-round sealed-bid auction on sync.parc.land.

Setup:
- Create a room. Track in _shared: current item, auction phase
  (bidding/revealing/complete), round number, and results history.
- Register a "place_bid" action: bidders write their bid amount to their
  private state. CEL precondition: phase=="bidding" and bidder hasn't
  already bid this round (check a self-scoped round flag).
- Register a "bids_in" view that counts how many bidders have submitted
  (without revealing amounts).
- Register a "close_bidding" action (auctioneer only, gated on all bids
  being in): reads bids via granted scope, determines winner (highest bid),
  publishes result to _shared, advances to next item.
- After each round, a "round_result" gets appended to a results log
  in _shared showing item, winner, and winning bid.

Agents: 3 bidders ("bidder-1", "bidder-2", "bidder-3") and an "auctioneer".
Grant auctioneer read access to all bidder scopes.

Demo: Auction off 3 items ("Vintage Guitar", "First Edition Book",
"Signed Baseball"). Each bidder independently decides a bid amount based
on their perceived value. Auctioneer reveals results after each round.
Print the dashboard URL.
```

### Why this works

- **Sealed bids are the killer demo** — private state that gets revealed by a
  trusted third party is exactly what the platform's scope model is built for.
- **Dramatic reveal** — each round has a clear tension-and-resolution arc.
- **Simple mechanics, rich interaction** — bidding is easy to understand but
  the coordination (count bids, prevent double-bidding, reveal atomically) is
  genuinely non-trivial.
- **Log-structured results** — appending round results to a log shows the
  append feature working naturally.

---

## 6. Storytelling Relay with Voting (New)

```
Fetch https://sync.parc.land/SKILL.md to learn the sync platform API.
Create a collaborative storytelling room on sync.parc.land with voting.

Setup:
- Create a room. _shared state: story (array of paragraphs),
  current_phase ("writing"/"voting"/"resolved"), round number (1-5),
  current_writer agent ID.
- Register a "write_paragraph" action: the current writer appends a
  paragraph to the story array. CEL precondition: self==current_writer
  and phase=="writing". After writing, phase advances to "voting".
- Register a "cast_vote" action: other agents vote thumbs-up or
  thumbs-down on the paragraph (written to private state). CEL gate:
  phase=="voting" and voter hasn't voted yet and voter!=current_writer.
- Register a "tally_votes" action (room token): counts votes, appends
  result to a "feedback" log, rotates to next writer, sets phase back
  to "writing". If majority thumbs-down, the paragraph gets a [contested]
  tag in the story.
- Register a "story_so_far" view that concatenates all paragraphs.

Agents: 3 authors ("author-1", "author-2", "author-3").

Opening line: "The lighthouse had been dark for thirty years when the
new keeper arrived and found the logbook still open to the last entry."

Run 5 rounds. Each round: one author writes, the other two vote. Rotate
writers. Print the dashboard URL to read the full story.
```

### Why this works

- **Creative + mechanical** — the story is engaging to read, and the voting
  mechanism adds genuine coordination.
- **Turn rotation with CEL** — enforcing who writes when is a clean use of
  `self==state._shared.current_writer`.
- **Private voting** — votes are hidden until tallied, preventing influence.
- **Cumulative artifact** — the growing story in the dashboard is visually
  satisfying to scroll through.

---

## Design Principles Applied

These prompts were refined with the following principles:

1. **Always read SKILL.md first** — every prompt starts with this. The agent
   needs the API reference to succeed.

2. **Name specific platform features** — CEL preconditions, private state,
   views, wait conditions, append mode, scope grants. This steers the agent
   toward patterns that are well-supported and documented.

3. **Concrete data, not placeholders** — specific debate topics, specific task
   descriptions, specific auction items. This prevents the agent from generating
   vague stub content and lets the demo feel real.

4. **Self-contained demos** — each prompt runs to completion without waiting
   for user input mid-flow. The agent plays all roles. This maximizes the
   chance of a complete, working result.

5. **Dashboard URL as deliverable** — every prompt ends by requesting the
   dashboard URL. This gives the user a visual artifact to inspect and share.

6. **Bounded scope** — 3-5 agents, 3-6 rounds. Complex enough to be
   impressive, small enough to complete reliably.

7. **One showcase feature per prompt** — debate (turn enforcement), RPS
   (sealed moves), tasks (claiming races), review (scope grants), auction
   (sealed bids + reveal), story (voting + creative output).
