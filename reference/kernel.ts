/**
 * sync/kernel.ts — the substrate algebra
 *
 * The entire model in pure functions. No I/O, no framework,
 * no persistence. Bring your own storage and transport.
 *
 * Five types. Seven operations. One loop.
 *
 *   read → evaluate → act → read → ...
 *
 * Everything else is a shell built around this kernel.
 */

// ── Types ──────────────────────────────────────────────

/** A located key: scope + name. The scope is the authority boundary. */
export type Loc = { scope: string; key: string };

/** The substrate: a finite partial function from located keys to values. */
export type State = Map<string, Map<string, Entry>>;

/** A state entry: value + version for compare-and-swap. */
export type Entry = {
  value: unknown;
  version: number;     // monotonic revision counter
  hash: string;        // content hash — proof-of-read token
};

/** An action: a named state transition with preconditions and write templates. */
export type Action = {
  id: string;
  scope: string;       // authority scope — constrains where writes can land
  intent?: string;     // natural-language purpose (survives implementation failure)
  pred?: Pred;         // precondition — must hold for invocation to proceed
  writes: WriteTemplate[];
  params?: ParamSchema;
};

/** A view: a named derived computation over state. */
export type View = {
  id: string;
  scope: string;       // registrar scope — determines what state is visible
  compute: (state: State, views: Record<string, unknown>) => unknown;
};

/** A room: state + vocabulary. The world model. */
export type Room = {
  state: State;
  actions: Map<string, Action>;
  views: Map<string, View>;
  agents: Set<string>;
  seq: number;         // global sequence number for ordering
};

/** The context envelope: what an agent perceives on a read. */
export type Context = {
  state: Record<string, Record<string, unknown>>;
  views: Record<string, unknown>;
  actions: Record<string, { available: boolean; description?: string; intent?: string }>;
  agents: string[];
  self: string | null;
  seq: number;
};

/** Predicate over state. */
export type Pred = (state: State, params: Record<string, unknown>) => boolean;

/** Write template: declarative state mutation. */
export type WriteTemplate = {
  scope: string;       // target scope (may contain ${self})
  key: string;         // target key (may contain ${params.x})
  value: unknown | ((params: Record<string, unknown>, state: State) => unknown);
  append?: boolean;    // append to sequence rather than overwrite
  merge?: boolean;     // shallow-merge into existing object
  ifVersion?: string;  // compare-and-swap guard
};

/** Parameter schema for an action. */
export type ParamSchema = Record<string, { type?: string; description?: string }>;

/** Result of an invocation. */
export type InvokeResult =
  | { ok: true; room: Room; writes: Array<{ scope: string; key: string; value: unknown }> }
  | { ok: false; error: string; detail?: unknown };

// ── Constructors ───────────────────────────────────────

/** Empty room. Four built-in actions. Nothing else. */
export function createRoom(): Room {
  return {
    state: new Map(),
    actions: new Map(),
    views: new Map(),
    agents: new Set(),
    seq: 0,
  };
}

/** Hash a value for content-addressable versioning. */
function hash(value: unknown): string {
  const str = typeof value === "string" ? value : JSON.stringify(value);
  // djb2 — good enough for the kernel. Real impl uses SHA-256.
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

// ── State operations ───────────────────────────────────

/** Read a value from the substrate. Returns undefined for absent keys. */
export function read(state: State, scope: string, key: string): unknown | undefined {
  return state.get(scope)?.get(key)?.value;
}

/** Read an entry (value + version + hash). */
export function readEntry(state: State, scope: string, key: string): Entry | undefined {
  return state.get(scope)?.get(key);
}

/** Write a value to the substrate. Returns a new State (immutable). */
export function write(state: State, scope: string, key: string, value: unknown): State {
  const next = cloneState(state);
  if (!next.has(scope)) next.set(scope, new Map());
  const scopeMap = next.get(scope)!;
  const existing = scopeMap.get(key);
  scopeMap.set(key, {
    value,
    version: existing ? existing.version + 1 : 1,
    hash: hash(value),
  });
  return next;
}

/** Write with compare-and-swap. Fails if current hash doesn't match. */
export function writeIfVersion(
  state: State, scope: string, key: string, value: unknown, expectedHash: string
): State | { conflict: true; current: Entry | undefined } {
  const current = readEntry(state, scope, key);
  const currentHash = current?.hash ?? "";
  if (currentHash !== expectedHash) return { conflict: true, current };
  return write(state, scope, key, value);
}

/** Append to a log scope (auto-incrementing key). */
export function append(state: State, scope: string, value: unknown, seq: number): State {
  return write(state, scope, String(seq), value);
}

/** Merge an object into an existing object value. */
export function merge(state: State, scope: string, key: string, patch: Record<string, unknown>): State {
  const existing = read(state, scope, key);
  const base = (existing && typeof existing === "object" && !Array.isArray(existing))
    ? existing as Record<string, unknown>
    : {};
  return write(state, scope, key, { ...base, ...patch });
}

/** List all keys in a scope. */
export function keys(state: State, scope: string): string[] {
  const scopeMap = state.get(scope);
  return scopeMap ? [...scopeMap.keys()] : [];
}

/** List all scopes. */
export function scopes(state: State): string[] {
  return [...state.keys()];
}

// ── Room operations ────────────────────────────────────

/** Register an action. Idempotent — same ID overwrites. */
export function registerAction(room: Room, action: Action): Room {
  const actions = new Map(room.actions);
  actions.set(action.id, action);
  return { ...room, actions };
}

/** Delete an action. */
export function deleteAction(room: Room, id: string): Room {
  const actions = new Map(room.actions);
  actions.delete(id);
  return { ...room, actions };
}

/** Register a view. Idempotent — same ID overwrites. */
export function registerView(room: Room, view: View): Room {
  const views = new Map(room.views);
  views.set(view.id, view);
  return { ...room, views };
}

/** Delete a view. */
export function deleteView(room: Room, id: string): Room {
  const views = new Map(room.views);
  views.delete(id);
  return { ...room, views };
}

/** Join a room as an agent. */
export function join(room: Room, agentId: string): Room {
  const agents = new Set(room.agents);
  agents.add(agentId);
  return { ...room, agents };
}

/** Leave a room. State persists. */
export function leave(room: Room, agentId: string): Room {
  const agents = new Set(room.agents);
  agents.delete(agentId);
  return { ...room, agents };
}

// ── View resolution ────────────────────────────────────

/** Resolve all views, producing a map of view ID → computed value.
 *  Views that error get { _error: message }. */
export function resolveViews(room: Room): Record<string, unknown> {
  const results: Record<string, unknown> = {};
  for (const [id, view] of room.views) {
    try {
      results[id] = view.compute(room.state, results);
    } catch (e: unknown) {
      results[id] = { _error: e instanceof Error ? e.message : String(e) };
    }
  }
  return results;
}

// ── Context assembly ───────────────────────────────────

/** Build the context envelope — what an agent sees on a read.
 *  Respects scope privacy: only _shared, self scope, and _system scopes visible. */
export function context(room: Room, self: string | null = null): Context {
  // Resolve views
  const views = resolveViews(room);

  // Build visible state
  const visibleState: Record<string, Record<string, unknown>> = {};
  for (const [scope, entries] of room.state) {
    const isShared = scope === "_shared";
    const isSystem = scope.startsWith("_");
    const isSelf = self !== null && scope === self;
    if (!isShared && !isSystem && !isSelf) continue;
    const obj: Record<string, unknown> = {};
    for (const [key, entry] of entries) obj[key] = entry.value;
    const contextScope = isSelf && !isShared ? "self" : scope;
    visibleState[contextScope] = obj;
  }

  // Build action availability
  const actions: Record<string, { available: boolean; description?: string; intent?: string }> = {};
  for (const [id, action] of room.actions) {
    let available = true;
    if (action.pred) {
      try { available = action.pred(room.state, {}); }
      catch { available = false; }
    }
    actions[id] = {
      available,
      ...(action.intent ? { intent: action.intent } : {}),
    };
  }

  return {
    state: visibleState,
    views,
    actions,
    agents: [...room.agents],
    self,
    seq: room.seq,
  };
}

// ── Invocation ─────────────────────────────────────────

/** Invoke an action. Pure function: room in, room out.
 *
 *  1. Find the action.
 *  2. Check the precondition.
 *  3. Resolve write templates against params.
 *  4. Check scope authority.
 *  5. Apply writes.
 *  6. Return new room + executed writes. */
export function invoke(
  room: Room,
  actionId: string,
  params: Record<string, unknown> = {},
  agent: string | null = null,
): InvokeResult {

  const action = room.actions.get(actionId);
  if (!action) return { ok: false, error: "action_not_found", detail: actionId };

  // Check precondition
  if (action.pred) {
    try {
      if (!action.pred(room.state, params)) {
        return { ok: false, error: "precondition_failed", detail: action.id };
      }
    } catch (e: unknown) {
      return { ok: false, error: "predicate_error", detail: e instanceof Error ? e.message : String(e) };
    }
  }

  // Execute writes
  let state = room.state;
  let seq = room.seq;
  const executedWrites: Array<{ scope: string; key: string; value: unknown }> = [];

  for (const w of action.writes) {
    // Resolve scope template
    const scope = resolveTemplate(w.scope, params, agent);

    // Authority check: action scope constrains write scope
    if (scope !== "_shared" && !scope.startsWith("_")) {
      if (scope !== action.scope && scope !== agent) {
        return { ok: false, error: "scope_denied", detail: { action: actionId, scope } };
      }
    }

    // Resolve key template
    const key = w.append ? String(++seq) : resolveTemplate(w.key, params, agent);

    // Resolve value
    const value = typeof w.value === "function" ? w.value(params, state) : resolveTemplate(w.value, params, agent);

    // Compare-and-swap guard
    if (w.ifVersion !== undefined) {
      const result = writeIfVersion(state, scope, key, value, w.ifVersion);
      if ("conflict" in result) {
        return { ok: false, error: "version_conflict", detail: { scope, key, expected: w.ifVersion } };
      }
      state = result;
    } else if (w.merge) {
      state = merge(state, scope, key, value as Record<string, unknown>);
    } else {
      state = write(state, scope, key, value);
    }

    executedWrites.push({ scope, key, value });
  }

  // Append invocation to audit log
  seq++;
  state = append(state, "_audit", { agent, action: actionId, params, writes: executedWrites, at: seq }, seq);

  return {
    ok: true,
    room: { ...room, state, seq },
    writes: executedWrites,
  };
}

// ── Template resolution ────────────────────────────────

/** Resolve ${params.x}, ${self}, ${now} in a value. Recursive for objects. */
function resolveTemplate(value: unknown, params: Record<string, unknown>, agent: string | null): any {
  if (typeof value === "string") {
    return value.replace(/\$\{(params\.(\w+)|self|now)\}/g, (_match, full, paramName) => {
      if (paramName !== undefined) return String(params[paramName] ?? "");
      if (full === "self") return agent ?? "";
      if (full === "now") return new Date().toISOString();
      return _match;
    });
  }
  if (Array.isArray(value)) return value.map(v => resolveTemplate(v, params, agent));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveTemplate(v, params, agent);
    return out;
  }
  return value;
}

// ── Utilities ──────────────────────────────────────────

/** Deep clone a State map. */
function cloneState(state: State): State {
  const next = new Map<string, Map<string, Entry>>();
  for (const [scope, entries] of state) {
    next.set(scope, new Map(entries));
  }
  return next;
}

// ── Wait (the only impure operation) ───────────────────

/** Wait for a predicate to become true. The substrate's only blocking operation.
 *  In a real system this polls or subscribes. Here it's a contract. */
export type WaitHandle = {
  predicate: Pred;
  resolve: (ctx: Context) => void;
};

/** Create a wait handle. The shell is responsible for checking it on each state change. */
export function wait(pred: Pred): { promise: Promise<Context>; handle: WaitHandle } {
  let handle: WaitHandle;
  const promise = new Promise<Context>((resolve) => {
    handle = { predicate: pred, resolve };
  });
  return { promise, handle: handle! };
}

/** Check all pending waits against current state. Fire those whose predicates hold. */
export function checkWaits(room: Room, waits: WaitHandle[], self: string | null = null): WaitHandle[] {
  const remaining: WaitHandle[] = [];
  for (const w of waits) {
    try {
      if (w.predicate(room.state, {})) {
        w.resolve(context(room, self));
      } else {
        remaining.push(w);
      }
    } catch {
      remaining.push(w);
    }
  }
  return remaining;
}

// ── Contested targets (synthetic view) ─────────────────

/** Compute which state keys are written by 2+ actions. */
export function contested(room: Room): Record<string, string[]> {
  const targets: Record<string, string[]> = {};
  for (const [id, action] of room.actions) {
    for (const w of action.writes) {
      if (w.append) continue; // append writes don't contest
      const target = `${w.scope}:${w.key}`;
      if (!targets[target]) targets[target] = [];
      targets[target].push(id);
    }
  }
  const result: Record<string, string[]> = {};
  for (const [target, ids] of Object.entries(targets)) {
    if (ids.length >= 2) result[target] = ids;
  }
  return result;
}

// ── That's it. ─────────────────────────────────────────
//
//  Five types:   State, Action, View, Room, Context
//  Seven ops:    read, write, register, invoke, context, wait, resolve
//  One loop:     read → evaluate → act → read
//
//  Everything else — HTTP, SQL, OAuth, MCP, dashboards,
//  timers, surfaces, help, audit — is a shell around this kernel.
//
//  The room is the world model.
//  Actions are the transition function.
//  Views are the observation function.
//  Context is the affordance map.
//  The audit log is the trajectory.
//
//  What's missing? The reward signal.
//  That's adaptive salience.
//
