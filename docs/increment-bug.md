# Bug: `increment` causes NOT NULL constraint failure

## Summary

The `increment` write operation on `state/batch` and action invocations fails
with `SQLITE_CONSTRAINT: NOT NULL constraint failed: state.value`. This is a
regression — `increment` worked in previous runs (v3/v4 of our multi-agent
game reached turn 8+).

## Reproduction

### 1. Create a room

```bash
curl -s -X POST https://sync.parc.land/rooms \
  -H 'Content-Type: application/json' \
  -d '{"id":"increment-repro"}'
# → {"id":"increment-repro","token":"room_xxx..."}
```

### 2. Seed an integer key

```bash
curl -s -X PUT https://sync.parc.land/rooms/increment-repro/state/batch \
  -H "Authorization: Bearer room_xxx" \
  -H "Content-Type: application/json" \
  -d '{"writes":[{"scope":"_shared","key":"counter","value":0}]}'
```

**Output:** `{"ok":true,"count":1,...}` — works fine.

### 3. Try to increment it (FAILS)

```bash
curl -s -X PUT https://sync.parc.land/rooms/increment-repro/state/batch \
  -H "Authorization: Bearer room_xxx" \
  -H "Content-Type: application/json" \
  -d '{"writes":[{"scope":"_shared","key":"counter","increment":1}]}'
```

**Output:**
```json
{
  "error": {
    "name": "LibsqlError",
    "message": "SQLITE_CONSTRAINT: SQLite error: NOT NULL constraint failed: state.value",
    "stack": "...at async batchSetState (main.ts:635:30)..."
  }
}
```

### 4. Also fails via action invocation

```bash
# Register an action that uses increment
curl -s -X PUT https://sync.parc.land/rooms/increment-repro/actions \
  -H "Authorization: Bearer room_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "bump",
    "description": "increment counter",
    "writes": [{"scope":"_shared","key":"counter","increment":1}]
  }'

# Invoke it
curl -s -X POST https://sync.parc.land/rooms/increment-repro/actions/bump/invoke \
  -H "Authorization: Bearer room_xxx" \
  -H "Content-Type: application/json" \
  -d '{"params":{}}'
```

**Output:** Same `NOT NULL constraint failed: state.value` error, at `invokeAction (main.ts:997)`.

### 5. Combining value + increment — increment silently ignored

```bash
curl -s -X PUT https://sync.parc.land/rooms/increment-repro/state/batch \
  -H "Authorization: Bearer room_xxx" \
  -H "Content-Type: application/json" \
  -d '{"writes":[{"scope":"_shared","key":"counter","value":0,"increment":1}]}'
```

**Output:** `{"ok":true,...,"value":0}` — returns `0`, not `1`. The increment is ignored.

## Error locations

- **Direct writes:** `batchSetState` at `main.ts:635`
- **Action invocation:** `invokeAction` at `main.ts:997`

## Root cause (likely)

When a write spec has `increment` but no `value`, the SQL INSERT/UPDATE sets
the `value` column to NULL. The `state` table has a NOT NULL constraint on
`value`.

## Suggested fix

The increment code path needs to handle the value column:

```sql
-- For existing keys (UPDATE path):
SET value = COALESCE(state.value, 0) + ?

-- For new keys (INSERT path):
INSERT INTO state (room_id, scope, key, value, version)
VALUES (?, ?, ?, ?, 1)
ON CONFLICT (room_id, scope, key)
DO UPDATE SET value = COALESCE(state.value, 0) + ?, version = version + 1
```

When `increment` is specified without `value`, the INSERT should use the
increment amount as the initial value (not NULL).

## Impact

Blocks any action or batch write that uses `increment` without `value`.
In our test, this prevented all game actions from executing — the game
never progressed past turn 0.
