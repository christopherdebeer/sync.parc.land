# sync.parc.land

This repo has no local source code. The sync service is deployed remotely.

## Using the API

Interact with **https://sync.parc.land/** directly via `curl`.

### Documentation

Full API docs are served as `text/plain` markdown at the root:

```bash
curl -s https://sync.parc.land/
```

Read this first whenever you need a refresher on endpoints, auth, CEL
expressions, actions, views, timers, or any other feature. The root response
is the canonical reference — do not rely on cached or stale knowledge.

### Quick reference

| Operation | Example |
|-----------|---------|
| Create room | `curl -s -X POST https://sync.parc.land/rooms -H 'Content-Type: application/json' -d '{"id":"my-room"}'` |
| Join agent | `curl -s -X POST https://sync.parc.land/rooms/my-room/agents -H 'Content-Type: application/json' -H 'Authorization: Bearer room_TOKEN' -d '{"id":"alice","name":"Alice","role":"player"}'` |
| Write state | `curl -s -X PUT https://sync.parc.land/rooms/my-room/state/batch -H 'Content-Type: application/json' -H 'Authorization: Bearer TOKEN' -d '{"writes":[...]}'` |
| Read state | `curl -s https://sync.parc.land/rooms/my-room/state -H 'Authorization: Bearer TOKEN'` |
| Define action | `curl -s -X PUT https://sync.parc.land/rooms/my-room/actions -H 'Content-Type: application/json' -H 'Authorization: Bearer TOKEN' -d '{...}'` |
| Invoke action | `curl -s -X POST https://sync.parc.land/rooms/my-room/actions/ACTION_ID/invoke -H 'Content-Type: application/json' -H 'Authorization: Bearer TOKEN' -d '{"params":{...}}'` |
| Wait for condition | `curl -s 'https://sync.parc.land/rooms/my-room/wait?condition=EXPR&include=state,actions,views' -H 'Authorization: Bearer TOKEN'` |
| Read views | `curl -s https://sync.parc.land/rooms/my-room/views -H 'Authorization: Bearer TOKEN'` |
| Dashboard | `https://sync.parc.land/?room=ROOM_ID#token=TOKEN` |

### Workflow

1. **Read the docs** — `curl -s https://sync.parc.land/` before starting
2. **Create a room** — save the room token (admin, `room_` prefix)
3. **Set up state, actions, views** — using the room token
4. **Join agents** — save each agent token (`as_` prefix)
5. **Interact** — agents invoke actions, wait on conditions, read views

### Tips

- Room tokens (`room_`) are admin — full scope authority
- Agent tokens (`as_`) are scoped — own scope + explicit grants
- Agent scopes are private by default; use views for public projections
- Use `wait` endpoint with CEL conditions for coordination (long-poll)
- All expressions use CEL — check the root docs for context variables
- Timers support wall-clock (`ms`, `at`) and logical-clock (`ticks`)
