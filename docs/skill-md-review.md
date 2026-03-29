# SKILL.md Review — Empirical Findings

Reviewed 2026-03-17 by exercising the live API at `https://sync.parc.land/` and
reading the SKILL.md as a cold consumer (the target audience: an LLM agent
encountering sync for the first time).

---

## Executive summary

The SKILL.md is well-structured and fits its ~2300-token budget. The workflow
walkthrough (Steps 1–6) is the strongest section — clear, copy-pasteable, and
progressive. However, live testing reveals several documentation/API
inconsistencies, a significant auth gap on read endpoints, version drift in
reference docs, and some ergonomic friction that would trip up an LLM agent
following the doc literally.

---

## 1. Auth inconsistency on read endpoints (security / correctness)

**Finding:** `GET /rooms/:id/context`, `GET /rooms/:id/wait`, `POST /rooms/:id/eval`,
`GET /rooms/:id/replay/:seq`, and `GET /rooms/:id/history/:scope/:key` all return
data without any authentication. Meanwhile, `POST /rooms/:id/actions/:id/invoke`
(even `help`), `GET /rooms`, `POST /rooms`, `GET /rooms/:id/salience`, and
`DELETE /rooms/:id` all require auth.

**Impact:**
- Any room's full state, views, agents, messages, and action definitions are
  readable by anyone who can guess or enumerate room IDs.
- The SKILL.md documents auth as seemingly required ("Bearer tok_xxx" in the
  Step 3 curl example) but the server happily serves context without it.
- Room enumeration is trivial: `GET /rooms/demo/context` returns real state;
  `GET /rooms/nonexistent/context` returns built-in actions with empty state.
  An observer can distinguish real rooms from nonexistent ones.

**Recommendation:** Either:
- (a) Make context/wait/eval/replay/history require auth (matching the doc), or
- (b) Explicitly document that read endpoints are public by design and explain
  the security model (e.g., "rooms are public namespaces; use scoped tokens
  for write isolation").

The current state is ambiguous — the doc implies auth is needed, the server
doesn't enforce it.

## 2. Phantom rooms on context endpoint (bug / confusing)

**Finding:** `GET /rooms/nonexistent/context` returns `200 OK` with built-in
actions, empty state, and a valid `_shaping` block. But `GET /rooms/nonexistent`
returns `404 {"error":"room not found"}`.

An agent following the SKILL.md workflow literally could:
1. Create a room (requires auth)
2. Read context to verify — but context returns 200 even for non-existent rooms

There's no way to distinguish "room exists but is empty" from "room doesn't
exist" via the context endpoint.

**Recommendation:** Return 404 from `/rooms/:id/context` when the room doesn't
exist, consistent with `/rooms/:id`.

## 3. Version drift in reference docs

**Finding:**
- SKILL.md says "sync v9"
- `reference/api.md` says "sync v7 API Reference"
- `reference/cel.md` says "CEL Reference — sync v6"
- `reference/v6.md` says "sync v6 — Architecture & Design"
- `reference/examples.md` says "sync v6 Examples"
- `reference/views.md` has no version tag

The SKILL.md links to these with labels like "Architecture (reference/v6.md)"
which is honest about the filename, but an agent following the link gets a doc
that describes a potentially different version of the system. The v6→v9 gap
is three major versions.

**Recommendation:** Either update the reference docs to v9 or add a note in the
SKILL.md that reference docs describe the v6 foundation and may not reflect
v9's `{ value, _meta }` wrapper shape.

## 4. Raw stack traces in error responses (security / ergonomics)

**Finding:** `POST /rooms/nonexistent/agents` with a well-formed body returns:

```json
{
  "error": {
    "name": "LibsqlError",
    "message": "SQLITE_CONSTRAINT: SQLite error: FOREIGN KEY constraint failed",
    "stack": "LibsqlError: SQLITE_CONSTRAINT: ...\n    at Object.execute (https://esm.town/v/std/sqlite?v=6:47:11)\n    at async joinRoom (https://esm.town/v/c15r/sync@639-main/agents.ts:77:3)..."
  }
}
```

This leaks:
- Internal file paths (`agents.ts:77`)
- Val Town infrastructure details (`esm.town/v/std/sqlite?v=6`)
- Val account namespace (`c15r/sync@639-main`)

**Recommendation:** Catch FK constraint errors and return a structured error
like `{"error":"room_not_found","message":"Room does not exist"}`.

## 5. Error format inconsistency

**Finding:** Auth error responses vary across endpoints:

| Endpoint | Error body |
|----------|-----------|
| `POST /rooms` | `{"error":"authentication_required","message":"Room creation requires auth..."}` |
| `GET /rooms` | `{"error":"authentication_required","message":"include Authorization: Bearer <token> to list your rooms"}` |
| `POST .../invoke` | `{"error":"authentication_required","message":"include Authorization: Bearer <token>"}` |
| `DELETE /rooms/:id` | `{"error":"authentication_required"}` (no message) |

The `DELETE` endpoint omits the `message` field entirely. The help text varies
in tone and specificity.

**Recommendation:** Standardize error shape: always include `error` and
`message`. Consider a consistent message like
`"Authentication required. Include Authorization: Bearer <token>."`.

## 6. MCP tool count mismatch

**Finding:** The section header says "MCP tools (18)" but I count 18 tools in
the table, which is correct now. However, earlier the CLAUDE.md in this repo
mentions "16 tools" — this is stale.

*Minor, but worth keeping consistent if the number is advertised.*

## 7. OAuth scope mismatch with SKILL.md scope table

**Finding:** `GET /.well-known/oauth-authorization-server` returns `scopes_supported`
including:
- `sync:rooms` — not in the SKILL.md scope table
- `rooms:{room_id}:admin` — not in the SKILL.md scope table

These scopes exist in the OAuth discovery but are undocumented for the SKILL.md
audience.

**Recommendation:** Either add these to the scope table or remove them from the
OAuth metadata.

## 8. `depth` parameter behavior underdocumented

**Finding:**
- Default depth = lean (only `available`, `builtin`, `description`)
- `depth=full` adds `enabled` and `params`
- `depth=usage` appears identical to `depth=full` in practice (no additional
  invocation data in the `value` — invocation counts are already in `_meta`)
- Invalid depth values silently fall back to default (no error)

The SKILL.md says:
- `depth=lean` → "available + description"
- `depth=full` → "+ writes, params, if conditions"
- `depth=usage` → "+ invocation counts"

But `writes` and `if` were not present in `depth=full` responses on the demo
room. And invocation data is always in `_meta` regardless of depth.

**Recommendation:** Clarify that `depth` controls what appears in the action
`value` (not `_meta`), and verify that `writes`/`if` actually appear in
`depth=full` for rooms with custom actions that have those fields defined.

## 9. `self` field is empty string when unauthenticated

**Finding:** Unauthenticated context responses include `"self": ""` rather than
omitting the field or returning `null`.

An agent using CEL like `written_by(state._shared, self)` with an empty `self`
would get unexpected results.

**Recommendation:** Document that `self` is the agent identity and is empty
when not authenticated/embodied. Or return `null` instead of `""`.

## 10. Relative links in SKILL.md won't resolve for skill consumers

**Finding:** The "Reference" section at the bottom uses relative links:
```markdown
- [Architecture](reference/v6.md)
- [API Reference](reference/api.md)
```

When an LLM fetches SKILL.md via `https://sync.parc.land/SKILL.md`, it receives
plain text. These relative links are not clickable and the LLM has no way to
resolve them unless it knows the base URL and constructs absolute URLs.

**Recommendation:** Use absolute URLs:
```markdown
- [Architecture](https://sync.parc.land/reference/v6.md)
```

Or, since the base URL is already stated at the top, add a note that reference
paths are relative to the base URL.

## 11. Step 2 (Embody) auth requirement unclear

**Finding:** The SKILL.md shows agent creation both "Via MCP" (implies auth) and
"Or via HTTP" with a curl that has no `Authorization` header:

```bash
curl -X POST https://sync.parc.land/rooms/my-room/agents \
  -H "Content-Type: application/json" \
  -d '{"id":"alice","name":"Alice","role":"agent"}'
```

Testing this without auth hits the database directly and returns a raw FK
constraint error (see finding #4). It's unclear whether this endpoint is meant
to be public or requires auth.

**Recommendation:** Add the `Authorization` header to the Step 2 curl example,
matching the pattern in Step 1.

## 12. `_dashboard` state key vs surfaces narrative

**Finding:** The demo room still has a `_shared._dashboard` config blob with
classic tab layout. The SKILL.md describes surfaces (views with `render` hints)
as the way dashboards work in v9, but the real deployed room uses the legacy
`_dashboard` pattern.

This isn't wrong — the SKILL.md mentions both — but it creates confusion about
which approach is current.

---

## What works well

- **Workflow-first structure.** Steps 1–6 are the right way to teach an API to an LLM.
  Copy-paste curl commands with expected responses. This is the gold standard.
- **Token budget.** ~14KB / ~1737 words fits comfortably within 4K tokens.
- **Frontmatter.** Clean `name` + `description` in YAML. The description is
  dense and informative.
- **CEL section.** Domain helpers are well-documented with examples. The
  validation error format with `hint` and `help` key is excellent UX.
- **Help system.** Self-documenting via `help({ key: "..." })` is clever and
  gives agents a way to go deeper without bloating the SKILL.md.
- **Conflict detection.** Automatically flagging contention between actions is
  a strong design choice, and it's documented clearly.
- **`_shaping` summary.** Including shaping metadata in every response is
  great for agent self-awareness about what it can't see.
- **API surface table.** Comprehensive, well-organized by category.

---

## Priority ranking

| Priority | Issue | Type |
|----------|-------|------|
| P0 | Auth inconsistency on read endpoints (#1) | Security |
| P0 | Raw stack traces (#4) | Security |
| P1 | Phantom rooms on context (#2) | Bug |
| P1 | Error format inconsistency (#5) | Ergonomics |
| P1 | Step 2 missing auth header (#11) | Doc accuracy |
| P2 | Version drift in reference docs (#3) | Doc staleness |
| P2 | OAuth scope mismatch (#7) | Doc completeness |
| P2 | `depth` param behavior (#8) | Doc accuracy |
| P2 | Relative links (#10) | Ergonomics |
| P3 | `self` empty string (#9) | Ergonomics |
| P3 | MCP tool count (#6) | Doc nit |
| P3 | `_dashboard` vs surfaces (#12) | Doc clarity |

---

## Part 2: Authenticated testing

Obtained a device token (`rooms:* create_rooms` scope) and exercised the full
workflow end-to-end: room creation, agent embodiment, action registration,
invocation, views, messages, wait, contest detection, token minting, and cleanup.

### 13. `registered_by` is always null

**Finding:** When registering actions with either a `tok_` (user token) or
`as_` (agent token), the `registered_by` field in the response is always `null`.

```json
{
  "id": "test_reg",
  "registered_by": null,
  ...
}
```

This defeats provenance tracking — you can't tell who registered an action.

**Recommendation:** Populate `registered_by` from the authenticated identity
(agent name or user ID).

### 14. `self` is empty string with user token, populated with agent token

**Finding:**
- `Authorization: Bearer tok_xxx` → `"self": ""`
- `Authorization: Bearer as_xxx` → `"self": "reviewer"`

This is correct behavior but undocumented. An LLM agent using a `tok_` token
that tries `${self}` interpolation in action writes will get empty strings.

**Recommendation:** Document in the auth section that `self` identity requires
either an agent-scoped token (`as_` prefix) or a `rooms:room:agent:name` scoped
`tok_` token. User-level tokens don't have agent identity.

### 15. Room creation returns legacy tokens

**Finding:** `POST /rooms` returns:
```json
{
  "id": "my-room",
  "created_at": "...",
  "token": "room_...",
  "view_token": "view_..."
}
```

Agent join returns:
```json
{
  "id": "reviewer",
  "token": "as_..."
}
```

These legacy prefixed tokens are mentioned in the SKILL.md ("Legacy tokens"
section) but the room creation response shape including `token` and `view_token`
is not documented. An LLM agent wouldn't know these are usable tokens unless
it infers from the prefix.

**Recommendation:** Either document the creation response shape (showing that
tokens are included) or remove them from the response if the intent is to
deprecate legacy tokens.

### 16. `_send_message` response differs from custom action responses

**Finding:** Custom action invocation returns:
```json
{
  "invoked": true,
  "action": "submit_result",
  "agent": "reviewer",
  "writes": [{ ... }]
}
```

But `_send_message` returns:
```json
{
  "ok": true,
  "action": "_send_message",
  "seq": 2,
  "from": "reviewer",
  "kind": "chat"
}
```

Different keys (`invoked` vs `ok`), different structure (no `writes`, adds
`seq`/`from`/`kind`). An LLM checking for `response.invoked` after sending a
message would see undefined/null.

**Recommendation:** Consider normalizing built-in action responses to match
custom action shape, or document the difference.

### 17. `depth=full` includes `writes` for custom actions (correcting #8)

**Finding:** My initial test used only built-in actions which don't have user-
defined `writes`. With custom actions registered, `depth=full` correctly includes
`writes`, `params`, and `enabled` in the action value. `depth=usage` is identical
to `depth=full` — both show the same keys. The SKILL.md claim that `depth=usage`
adds "invocation counts" is misleading since invocation data lives in `_meta`
at all depth levels.

**Updated recommendation:** Document that `depth=usage` = `depth=full` + (invocation
counts already in `_meta`), or clarify what `depth=usage` adds beyond `depth=full`.

### 18. CEL `string.replace()` not available

**Finding:** Attempting to use `.replace()` in a view expression:
```
k.replace(".result", "")
```
Returns: `found no matching overload for 'dyn.replace(string, string)'`

The SKILL.md CEL section doesn't document which string methods are available.
Standard CEL has `startsWith`, `endsWith`, `contains`, `matches`, `size` —
these all work. But `replace`, `split`, `trim`, `toLowerCase` etc. are not
available.

The help system (`help({ key: "expressions" })`) also doesn't list available
string methods.

**Recommendation:** Add a brief note in the CEL section or help doc listing
available string methods: `startsWith`, `endsWith`, `contains`, `matches`, `size`.

### 19. `GET /manage` returns 404

**Finding:** The API surface table lists `GET /manage` as "Management UI" but
it returns 404.

### 20. Invite endpoint requires `username` (undocumented)

**Finding:** `POST /rooms/:id/invite` returns `{"error":"username is required"}`
but the SKILL.md only lists it as "Invite user" with no documented params.

### 21. `GET /rooms` response lacks role information

**Finding:** Room listing returns `[{id, created_at, meta}]` with no role
field. The MCP tool `sync_lobby` is described as showing "rooms, agents, roles"
but the raw HTTP endpoint doesn't include role data.

### 22. Contest detection works exactly as documented

**Finding:** Registering two actions that write to the same `(scope, key)`:
- Second registration includes `"warning": "competing_write_targets"` and
  `"contested_targets"` / `"competing_actions"` in the response
- Both actions show each other in `_meta.contested` in context
- `contested(actions)` CEL helper works

This is one of the best-documented features — the behavior matches the docs
exactly.

### 23. `if` guard (precondition) works correctly

**Finding:** Registering an action with an `if` expression and invoking when
the guard evaluates to false returns:
```json
{
  "error": "precondition_failed",
  "action": "guarded_write",
  "expression": "has(state._shared.phase) && state._shared.phase.value == \"active\""
}
```

Clean, informative error. The expression is echoed back for debugging.

### 24. Read-only token enforcement works

**Finding:** A `rooms:demo:read` scoped token can read context but cannot
invoke actions — returns `{"error":"read_only_token","message":"view tokens cannot
perform mutations"}`. Scope narrowing works correctly.

---

## Updated priority ranking

| Priority | Issue | Type |
|----------|-------|------|
| P0 | Auth inconsistency on read endpoints (#1) | Security |
| P0 | Raw stack traces (#4) | Security |
| P1 | Phantom rooms on context (#2) | Bug |
| P1 | Error format inconsistency (#5) | Ergonomics |
| P1 | Step 2 missing auth header (#11) | Doc accuracy |
| P1 | `registered_by` always null (#13) | Bug |
| P1 | `_send_message` response differs from custom actions (#16) | Ergonomics |
| P2 | Version drift in reference docs (#3) | Doc staleness |
| P2 | OAuth scope mismatch (#7) | Doc completeness |
| P2 | `depth=usage` vs `depth=full` identical (#17) | Doc accuracy |
| P2 | Relative links (#10) | Ergonomics |
| P2 | CEL string methods undocumented (#18) | Doc completeness |
| P2 | `/manage` returns 404 (#19) | Bug/stale |
| P2 | Invite params undocumented (#20) | Doc completeness |
| P2 | Room list lacks role (#21) | Doc/API gap |
| P2 | `self` identity requires agent token (#14) | Doc clarity |
| P2 | Room creation returns legacy tokens (#15) | Doc completeness |
| P3 | `self` empty string (#9) | Ergonomics |
| P3 | MCP tool count (#6) | Doc nit |
| P3 | `_dashboard` vs surfaces (#12) | Doc clarity |
