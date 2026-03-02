Introducing Sync: A Substrate for Emergent Software

  The Problem With Orchestration

  Most multi-agent systems are built like call centres. A central coordinator receives requests, dispatches workers, collects results, and assembles a response.
   The orchestrator knows the plan. The agents execute it. This works — until it doesn't. The coordinator becomes a bottleneck, a single point of failure, and
  worst of all, a single point of understanding. Every new capability must be wired into the plan. Every new agent must be introduced to the dispatcher. The
  system scales in complexity faster than it scales in capability.

  Sync starts from a different premise: what if there were no orchestrator at all?

  State as Substrate

  The core insight of sync — and of the broader substrate thesis it instantiates — is that software need not be a sequence of commands. It can be a shared field
   of facts that self-interested observers watch and act upon.

  In sync, a room is a shared key-value store partitioned into scopes. There is _shared state visible to everyone, private scopes belonging to individual
  agents, a _messages log, and an _audit trail. All of these live in the same underlying table. All of them support the same mechanisms: versioning, timers,
  enabled expressions. There is no special subsystem for messaging, no separate audit framework, no bespoke presence protocol. There is only state, and the
  universal operations that apply to it.

  An agent's entire lifecycle reduces to two operations:

  1. Wait — block until a condition over the room's state becomes true.
  2. Act — invoke an action that writes to state.

  That's it. No event subscriptions. No callback registration. No message routing. An agent observes the world, decides something needs doing, and does it. Then
   it waits again.

  Actions as Delegated Capabilities

  Actions in sync are not remote procedure calls. They are scoped write templates — pre-registered patterns that describe what state changes are permitted and
  under what conditions. When Alice registers an action scoped to her own namespace, she is saying: "Here is a capability I am offering. Anyone with access may
  invoke it, and when they do, the writes will happen under my authority, in my scope."

  This is capability delegation through structure. Bob can invoke Alice's "heal" action, but the writes land in Alice's state, using Alice's permissions. No
  access-control list is consulted. No policy engine fires. The authority is architectural — encoded in the scope boundary itself. This small mechanism turns
  out to be sufficient for trust hierarchies, role-based access, game mechanics, and multi-party workflows without any additional authorization framework.

  Surfaces: Self-Activating Observers

  If state is the substrate, surfaces are the organisms that grow on it. A surface is a UI component — a markdown panel, a metric display, an action button, a
  data table — that carries its own activation contract. Each surface declares a CEL expression (a sandboxed predicate over room state) that determines when it
  appears. No controller decides what the user sees. The room's state is the UI specification. Agents mutate state; the interface reflects those mutations
  automatically.

  This produces a property the project calls additive composition: new surfaces can be added to a room without modifying any existing surface. A game master can
   introduce a new panel, a new set of buttons, a new feed — and nothing already present needs to know about it. The system grows by accretion, not by rewiring.

  Seven design principles govern how surfaces should be authored — among them, absence is signal (an unset key is meaningful, not an error), locality of
  reasoning (each surface understandable in isolation), and display versus gate state (what determines visibility should be separate from what determines
  appearance). These aren't arbitrary style guidelines. They're the conditions under which additive composition actually holds.

  Interpretation as a First-Class Layer

  Raw state is not always legible. A key like alice.health containing the integer 3 is a fact, but not yet a meaning. Sync introduces views — declarative CEL
  expressions that project private state into public interpretations. A view might compute "critical" when health drops below a threshold, or "ready" when all
  prerequisites are met. Views are computed per-agent, respecting scope privacy: each agent sees the room through the lens of what they're permitted to know,
  with interpretive layers making raw facts semantically useful.

  This is a deliberate architectural choice. In most systems, interpretation is buried inside application logic — a conditional somewhere that maps a number to
  a status label. In sync, interpretation is a declared, inspectable, reusable layer sitting between state and observation. It is, in the language of the
  substrate thesis, what makes the shift from "command-response" software to "perception-adaptation" software possible.

  The Intellectual Genealogy

  Sync did not emerge from nowhere. The pressure field document traces thirteen intellectual lineages that each arrived at something close to the substrate
  thesis but lacked a final ingredient.

  The blackboard architectures of the 1970s and 80s — HEARSAY-II, HASP — had the shared workspace and the independent knowledge sources, but their observers
  were hand-coded pattern matchers, too brittle for open-ended coordination. Linda tuple spaces (Gelernter, 1985) had the associative shared memory but no
  interpretation layer — processes deposited and withdrew tuples without any mechanism for meaning to emerge from their combination. Functional reactive
  programming had continuous observation of changing values but assumed a single coherent observer, not multiple autonomous agents with private state.

  The actor model took the opposite path entirely — isolating state inside processes and coordinating through message passing — and gained safety at the cost of
   shared understanding. Event-Condition-Action systems in databases had guarded writes but operated at the infrastructure level, invisible to the entities they
   served. Harel's statecharts showed that purely reactive systems eventually need phase structure — sequential narrative imposed on concurrent observation —
  which sync addresses through its timer system and action preconditions.

  The document's central claim is that language models supply most of the missing ingredients simultaneously. An LLM can be a knowledge source that reads a
  blackboard, interprets ambiguous state, decides what to do, and acts — all without brittle pattern matching or hand-coded rules. The substrate thesis becomes
  viable not because the architecture is new, but because the observers finally are.

  Toward a Formal Foundation

  The most ambitious document in the collection is the sigma calculus — an attempt to give the substrate thesis the same kind of minimal formal foundation that
  lambda calculus gives to computation and pi calculus gives to concurrent communication.

  The calculus has five term forms: fact (a situated datum), write (a guarded state transition), observe (a guarded observation that reads without modifying),
  parallel composition, and scope (an authority boundary). Two reduction rules govern all dynamics: activation (when a write's guard is satisfied, its write
  function fires) and observation (when an observer's guard is satisfied, it emits output).

  From these primitives, seven algebraic laws follow — among them, that composition is commutative (order of assembly doesn't matter), that observers are
  independent (adding an observer cannot change the substrate's evolution), and that monotonic writes are confluent (they can be applied in any order and reach
  the same result, which is the CALM theorem recast as an algebraic property).

  The distinction between monotonic and non-monotonic operations turns out to be architecturally load-bearing. Monotonic writes — those that only add
  information — can proceed without coordination. Non-monotonic writes — those that retract or overwrite — require serialisation. The sigma calculus introduces
  organs: bounded regions of non-monotonic computation whose internal complexity is hidden behind a monotonic (additive) external interface. This is how sync
  reconciles the permissionless growth of a shared substrate with the need for coherent local state machines.

  Four Lean files begin to mechanize these ideas. Three theorems are proved: observers preserve the substrate, adding observers preserves reachability, and the
  activation set is a deterministic function of state. Three more are stated with proof strategies but remain open — monotonic confluence, scope authority, and
  organ encapsulation.

  What Sync Is For

  Sync is a coordination platform for AI agents, but that description undersells it. It is an attempt to build software according to a different metaphysics —
  one where the program is not a sequence of instructions but a living substrate of shared facts, watched by autonomous observers who act when they see
  something that matters to them.

  A game master agent sets up a room with characters, locations, and rules encoded in state. Player agents observe the world through views and act through
  capability-delegated actions. The dashboard assembles itself from surfaces that activate and deactivate as the game state evolves. No agent knows the whole
  plan. No orchestrator holds the whole picture. The experience emerges from independent observations of shared truth.

  This is the substrate thesis made concrete: ten HTTP endpoints, a single SQLite table, a CEL expression engine, and a conviction that if you get the shared
  state right, coordination takes care of itself.

  ---
  Want me to adjust the tone, length, emphasis, or add/remove any particular threads?