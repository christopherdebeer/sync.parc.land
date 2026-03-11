# BUG: Audit log returned unbounded in /context endpoint

**Type:** System bug
**Severity:** P2 - Performance/scalability concern
**Component:** `/context` endpoint response

## Summary

The `GET /rooms/:id/context` endpoint returns the full `_audit` scope in the `state` field, containing every action invocation since room creation with full parameter bodies. There is no way to exclude, limit, or paginate this data.

## Observed Behavior

After 33 action invocations in a short session, the `_audit` section of the context response contained 33 entries, each with full parameter bodies (some containing large nested objects like region definitions, NPC data, etc.). This data is returned on every `/context` call.

In a long-running room with hundreds or thousands of actions, this would make `/context` responses extremely large and slow.

## Expected Behavior

Either:
1. The `_audit` scope should be excluded from `/context` by default (available via a separate endpoint or opt-in parameter)
2. The `/context` endpoint should support `?include=state,views,actions,messages` to let agents request only what they need
3. The audit log should have a configurable limit (e.g., last N entries)

## Note

The `/wait` endpoint documentation mentions `include=state,actions,views` as a parameter. If `/context` supported the same `include` parameter, agents could exclude `_audit` (and other unneeded data) to keep responses lean.
