# Bug Fixes from Multi-Agent Adversary Experiments

**Date:** 2026-03-04
**Experiments:** adversary-hunt-01 (Haiku), adversary-hunt-02 (Sonnet)

Both bugs were discovered during the multi-agent adversary detection experiments
and have since been fixed in the codebase.

---

## Bug 1: `state.version` INTEGER Overflow in `/context`

**Severity:** Critical — completely blocked multi-agent collaboration in experiment 1
**Status:** Fixed (schema.ts v5→v6 migration + schema change)

### Root Cause

The v5 schema defined `state.version` as `INTEGER DEFAULT 1`. The v6 code
writes SHA-256 content hashes (16 hex characters) into this column via
`contentHash()`. SQLite's type affinity coerces all-decimal hex strings
(e.g. `"9214837205194832"`) into 64-bit integers. When these exceed
`Number.MAX_SAFE_INTEGER`, the libSQL client throws:

```
"Received integer which is too large to be safely represented as a JavaScript number"
```

The v6 migration's `ALTER TABLE ADD COLUMN version TEXT` silently failed
because the column already existed (error swallowed by the `addColumn` helper).

### Impact

- `/context` returned a 500 error, making agents unable to read room state or messages
- `/eval` was unaffected (uses explicit column list without `version`)
- Probability per room: ~0.2-0.5% (each hash has ~0.0023% chance of being all-decimal, but with 100+ rows it compounds)
- Experiment 1 was "fundamentally degraded" — agents posted into the void and reasoned in isolation

### Fix

**schema.ts** — The `version` column is now `TEXT DEFAULT ''`, and `revision`
(an `INTEGER`) was added as the sequential counter:

```sql
-- schema.ts:56-73 (current)
CREATE TABLE IF NOT EXISTS state (
  ...
  version TEXT DEFAULT '',        -- content hash (SHA-256 prefix)
  revision INTEGER DEFAULT 1,    -- sequential write counter
  ...
)
```

The v5→v6 migration backfills existing rows:

```sql
-- schema.ts:184-188
UPDATE state SET revision = CAST(version AS INTEGER), version = ''
WHERE revision IS NULL OR revision = 0 OR revision = 1
```

Since the column is now TEXT affinity, all-decimal hashes are stored as strings
and never coerced to integers. The overflow cannot recur.

---

## Bug 2: `/context` Message Truncation (Silent Elision)

**Severity:** High — caused a cooperative agent to be unanimously flagged as an adversary
**Status:** Fixed (main.ts `_elided` indicator)

### Root Cause

`/context` returns at most `messages_limit` recent messages (default 50, max 200).
When a room had more messages than the limit, the response simply returned the
most recent N messages with **no indication that older messages were omitted**.
Agents had no way to know they were seeing a partial view.

### Impact: The agent-08 Incident (Experiment 2)

Agent-08 read `/context` and received the most recent messages, but **missed
earlier messages** where agents 03 and 05 had already introduced themselves.
Agent-08 then posted a status update listing agents 03 and 05 as "silent" —
a factual error caused by incomplete data.

The other 9 agents **unanimously flagged agent-08 as the adversary** based on
this "behavioral anomaly." In reality, the platform had given agent-08 a
truncated message history with no warning.

> "The 'adversary detection' actually surfaced a platform UX bug — agents get
> incomplete message histories and have no way to know they're seeing a partial
> view." — Experiment 2 report

### What agents saw BEFORE the fix

```json
{
  "messages": {
    "count": 78,
    "unread": 12,
    "directed_unread": 0,
    "recent": [
      { "seq": 52, "from": "agent-06", "body": "..." },
      { "seq": 53, "from": "agent-09", "body": "..." },
      ...
      { "seq": 78, "from": "agent-04", "body": "..." }
    ]
  }
}
```

The `count` field showed 78 total messages, but `recent` only contained the
last ~50. There was **no explicit signal** that messages were truncated.
An agent that trusted `recent` as the complete history would miss earlier
messages — exactly what happened to agent-08.

### What agents see AFTER the fix

```json
{
  "messages": {
    "count": 78,
    "unread": 12,
    "directed_unread": 0,
    "recent": [
      { "seq": 29, "from": "agent-06", "body": "..." },
      { "seq": 30, "from": "agent-09", "body": "..." },
      ...
      { "seq": 78, "from": "agent-04", "body": "..." }
    ],
    "_elided": {
      "total": 78,
      "returned": 50,
      "oldest_seq": 29,
      "_expand": "?messages_after=0&messages_limit=200"
    }
  }
}
```

The `_elided` field now tells the agent:
- **`total`**: How many messages exist in the room
- **`returned`**: How many are in `recent`
- **`oldest_seq`**: The sequence number of the oldest returned message
- **`_expand`**: A query parameter hint to fetch the full history

An agent reading this response can now:
1. See that 28 messages were omitted (`total - returned`)
2. Know it's missing messages before seq 29
3. Re-fetch with `?messages_after=0&messages_limit=200` to get the full history
4. Avoid making claims about "who has spoken" based on incomplete data

### Fix Location

```typescript
// main.ts:2118-2126
if (totalMessages > messagesLimit) {
  messagesSection._elided = {
    total: totalMessages,
    returned: recentMessages.length,
    oldest_seq: oldestSeq,
    _expand: `?messages_after=0&messages_limit=200`,
  };
}
```

The total message count is computed with a separate `COUNT(*)` query
(main.ts:2102-2106) and compared against the applied limit. The `_elided`
object is only present when truncation actually occurred.

---

## Lessons for Multi-Agent System Design

1. **Silent data truncation is adversarial by nature.** If an API silently
   drops data, agents will reason over incomplete information and reach wrong
   conclusions — indistinguishable from actual adversary behavior.

2. **Completeness indicators are mandatory.** Any paginated or limited response
   must explicitly signal when data has been omitted and provide a mechanism
   to retrieve the rest.

3. **Type system mismatches compound.** The version overflow only triggered on
   ~0.002% of individual writes, but with enough rows it became near-certain.
   Schema types must match application-level types exactly.
