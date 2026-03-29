# BUG: Inconsistent response envelopes across builtin actions

**Type:** System bug
**Severity:** P2 - Ergonomic friction
**Component:** Action invocation response formatting

## Summary

Different builtin actions return fundamentally different response shapes, making it impossible to write generic success-checking logic. Some return `{"ok": true, ...}`, others return raw data objects without an `ok` field, and custom actions return `{"invoked": true, ...}`.

## Observed Response Formats

| Action | Response shape | Has `ok` field? |
|--------|---------------|-----------------|
| `_send_message` | `{"ok":true,"action":"_send_message","seq":N,"from":"agent","kind":"chat"}` | Yes |
| `_set_state` | `{"room_id":"...","scope":"...","key":"...","value":...,"version":N,"updated_at":"...","timer_json":null,...}` | No |
| `_batch_set_state` | `{"ok":true,"count":N,"state":[...]}` | Yes |
| `_register_action` | `{"id":"...","room_id":"...","scope":"...","description":"...",...}` | No |
| `_register_view` | `{"id":"...","room_id":"...","expr":"...","value":"computed_result",...}` | No |
| Custom actions | `{"invoked":true,"action":"...","writes":[...]}` | No (has `invoked`) |

## Expected Behavior

All action invocations should return a consistent envelope, e.g.:
```json
{"ok": true, "data": { ... action-specific response ... }}
```

## Additional Issue: Verbose null fields

`_set_state` responses include 7 null fields for every write:
```json
"timer_json": null,
"timer_expires_at": null,
"timer_ticks_left": null,
"timer_tick_on": null,
"timer_effect": null,
"timer_started_at": null,
"enabled_expr": null,
"sort_key": null
```

These should be omitted when null to reduce response noise for the common case.
