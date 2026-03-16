/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Overview / Vision & Architecture page — SSR-compatible, uses project theme vars.
 *
 * Typography: Newsreader (serif body), Playfair Display (display quote),
 * SF Mono/Fira Code (monospace). Loaded via headScripts in pages.tsx.
 */
import { useState } from "https://esm.sh/react@18.2.0";
import { styled } from "../styled.ts";
import { Nav } from "./Nav.tsx";

// ── Section definitions ──────────────────────────────────────────────────────

interface SectionDef {
  id: string;
  label: string;
  title: string;
  subtitle: string;
}

const SECTIONS: SectionDef[] = [
  { id: "thesis", label: "Thesis", title: "The Substrate Thesis", subtitle: "Programs execute. Ecosystems emerge." },
  { id: "algebra", label: "Algebra", title: "The Sync Algebra", subtitle: "Two operations. Ten endpoints. One substrate." },
  { id: "room", label: "Room", title: "Anatomy of a Room", subtitle: "Shared state observed by self-activating participants." },
  { id: "convergence", label: "Convergence", title: "Three Projects, One Architecture", subtitle: "ctxl · sync · playtest" },
  { id: "salience", label: "Salience", title: "Adaptive Salience", subtitle: "The missing reward signal." },
];

// ── Typography ───────────────────────────────────────────────────────────────

const SERIF = '"Newsreader", Georgia, "Times New Roman", serif';
const DISPLAY = '"Playfair Display", Georgia, serif';
const MONO = '"SF Mono", "Fira Code", "Cascadia Code", monospace';
const SYSTEM = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

// ── Layout ───────────────────────────────────────────────────────────────────

const Page = styled.div`
  font-family: ${SERIF};
  background: var(--bg);
  color: var(--fg);
  line-height: 1.6;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

const Header = styled.div`
  padding: 3rem 3rem 2rem;
  border-bottom: 1px solid var(--border);
  @media (max-width: 640px) { padding: 2rem 1.25rem 1.25rem; }
`;

const Mono = styled.span`
  font-family: ${MONO};
`;

const Breadcrumb = styled.span`
  font-family: ${MONO};
  font-size: 0.72rem;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--dim);
  margin-bottom: 0.75rem;
  display: block;
  a { color: var(--dim); }
  a:hover { color: var(--accent); }
`;

const PageTitle = styled.h1`
  font-family: ${SERIF};
  font-size: 2.25rem;
  font-weight: 600;
  letter-spacing: -0.03em;
  margin: 0;
  line-height: 1.2;
  @media (max-width: 640px) { font-size: 1.65rem; }
`;

const PageSub = styled.p`
  font-family: ${SERIF};
  color: var(--dim);
  font-size: 1.05rem;
  margin-top: 0.4rem;
  font-style: italic;
  @media (max-width: 640px) { font-size: 0.92rem; }
`;

const Layout = styled.div`
  display: flex;
  flex: 1;
  @media (max-width: 768px) { flex-direction: column; }
`;

const Sidebar = styled.nav`
  width: 210px;
  flex-shrink: 0;
  padding: 1.5rem 0.85rem;
  border-right: 1px solid var(--border);
  position: sticky;
  top: 48px;
  height: calc(100vh - 48px - 120px);
  overflow-y: auto;
  @media (max-width: 768px) {
    width: 100%;
    height: auto;
    position: static;
    border-right: none;
    border-bottom: 1px solid var(--border);
    padding: 0.6rem 1.25rem;
    display: flex;
    gap: 0.25rem;
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
  }
`;

const SideBtn = styled.button<{ $active: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.6rem 0.85rem;
  margin-bottom: 0.25rem;
  background: ${({ $active }) => ($active ? "var(--surface)" : "transparent")};
  border: none;
  border-radius: 6px;
  border-left: 2px solid ${({ $active }) => ($active ? "var(--accent)" : "transparent")};
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
  &:hover { background: var(--surface); }
  @media (max-width: 768px) {
    width: auto;
    flex-shrink: 0;
    padding: 0.4rem 0.7rem;
    border-left: none;
    border-bottom: 2px solid ${({ $active }) => ($active ? "var(--accent)" : "transparent")};
    border-radius: 4px 4px 0 0;
    margin-bottom: 0;
  }
`;

const SideBtnLabel = styled.span<{ $active: boolean }>`
  font-family: ${MONO};
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: ${({ $active }) => ($active ? "var(--accent)" : "var(--dim)")};
  display: block;
`;

const SideBtnSub = styled.div<{ $active: boolean }>`
  font-family: ${SERIF};
  font-size: 0.73rem;
  color: var(--dim);
  opacity: ${({ $active }) => ($active ? 1 : 0.55)};
  margin-top: 0.15rem;
  font-style: italic;
  @media (max-width: 768px) { display: none; }
`;

const Main = styled.main`
  flex: 1;
  padding: 2.25rem 3rem;
  max-width: 760px;
  @media (max-width: 768px) { padding: 1.75rem 1.25rem; }
`;

const SectionTitle = styled.h2`
  font-family: ${SERIF};
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: -0.025em;
  margin: 0 0 0.2rem;
  line-height: 1.25;
  @media (max-width: 640px) { font-size: 1.35rem; }
`;

const SectionSub = styled.p`
  font-family: ${SERIF};
  color: var(--dim);
  font-size: 0.95rem;
  font-style: italic;
  margin-bottom: 1.75rem;
`;

const Body = styled.p`
  font-family: ${SERIF};
  font-size: 1.02rem;
  line-height: 1.8;
  margin-bottom: 1.75rem;
`;

const BodyDim = styled(Body)`
  color: var(--dim);
  font-size: 0.92rem;
  line-height: 1.75;
`;

const BodySmall = styled.p`
  font-family: ${SERIF};
  font-size: 0.88rem;
  line-height: 1.7;
  color: var(--dim);
  margin-bottom: 1.25rem;
  a { color: var(--accent); }
`;

const Footer = styled.footer`
  font-family: ${SYSTEM};
  text-align: center;
  padding: 2.5rem;
  color: var(--dim);
  font-size: 0.8rem;
  border-top: 1px solid var(--border);
  a { color: var(--accent); }
`;

// ── Blocks ───────────────────────────────────────────────────────────────────

const QuoteBlock = styled.div`
  background: linear-gradient(135deg, rgba(88, 166, 255, 0.08), transparent);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.75rem 2rem;
  margin-bottom: 2rem;
  font-family: ${DISPLAY};
  font-size: 1.35rem;
  font-style: italic;
  line-height: 1.6;
  color: var(--accent);
  @media (max-width: 640px) { font-size: 1.1rem; padding: 1.25rem 1.4rem; }
`;

const Callout = styled.div<{ $color: string; $tint?: string }>`
  padding: 1.15rem 1.5rem;
  border-left: 3px solid ${({ $color }) => $color};
  background: ${({ $tint }) => $tint ?? "var(--surface)"};
  border-radius: 0 8px 8px 0;
  margin-bottom: 1.75rem;
  font-family: ${SERIF};
  font-size: 0.92rem;
  line-height: 1.75;
  color: var(--dim);
`;

const Card = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem 1.4rem;
  position: relative;
  overflow: hidden;
`;

const CardAccentTop = styled.div<{ $color: string }>`
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2.5px;
  background: ${({ $color }) => $color};
  opacity: 0.75;
`;

const CardAccentLeft = styled.div<{ $color: string }>`
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: ${({ $color }) => $color};
  opacity: 0.75;
`;

const Grid2 = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem;
  margin-bottom: 2rem;
  @media (max-width: 560px) { grid-template-columns: 1fr; }
`;

const Grid3 = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.85rem;
  margin-bottom: 2rem;
  @media (max-width: 560px) { grid-template-columns: 1fr; }
`;

const SectionLabel = styled.span`
  font-family: ${MONO};
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--dim);
  display: block;
  margin-bottom: 0.75rem;
`;

const CardLabel = styled.span<{ $color?: string }>`
  font-family: ${MONO};
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: ${({ $color }) => $color ?? "var(--dim)"};
  display: block;
  margin-bottom: 0.65rem;
`;

const CardTitle = styled.div`
  font-family: ${SERIF};
  font-size: 1.08rem;
  font-weight: 600;
  margin-bottom: 0.45rem;
`;

const CardDesc = styled.div`
  font-family: ${SERIF};
  font-size: 0.85rem;
  color: var(--dim);
  line-height: 1.65;
`;

const CodeBlock = styled.div`
  font-family: ${MONO};
  font-size: 0.82rem;
  padding: 0.85rem 1.15rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  display: block;
  line-height: 1.9;
  margin-bottom: 1.75rem;
  overflow-x: auto;
  color: var(--fg);
`;

const EndpointGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
  margin-bottom: 1.75rem;
  @media (max-width: 560px) { grid-template-columns: 1fr; }
`;

const EndpointRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.5rem 0.75rem;
  background: var(--surface);
  border-radius: 4px;
  font-family: ${MONO};
  font-size: 0.78rem;
`;

const EndpointPath = styled.span`
  color: var(--accent);
  min-width: 7.5rem;
`;

const EndpointPurpose = styled.span`
  font-family: ${SERIF};
  color: var(--dim);
`;

const Dot = styled.span<{ $color: string }>`
  width: 8px; height: 8px;
  border-radius: 50%;
  background: ${({ $color }) => $color};
  opacity: 0.75;
  flex-shrink: 0;
  display: inline-block;
`;

// ── Primitives interactive ───────────────────────────────────────────────────

const PrimitiveGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.7rem;
  margin-bottom: 1.25rem;
  @media (max-width: 560px) { grid-template-columns: repeat(2, 1fr); }
`;

const PrimitiveBtn = styled.button<{ $active: boolean; $color: string }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  padding: 1.1rem 0.75rem;
  background: ${({ $active }) => ($active ? "var(--surface)" : "transparent")};
  border: 1px solid ${({ $active, $color }) => ($active ? $color + "55" : "transparent")};
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s;
  &:hover { background: var(--surface); }
`;

const PrimitiveLabel = styled.span<{ $active: boolean; $color: string }>`
  font-family: ${MONO};
  font-size: 0.72rem;
  color: ${({ $active, $color }) => ($active ? $color : "var(--dim)")};
  transition: color 0.2s;
`;

const PrimitiveDetail = styled.div<{ $active: boolean }>`
  min-height: 4rem;
  padding: 1rem 1.15rem;
  border-radius: 6px;
  margin-bottom: 1.5rem;
  font-family: ${SERIF};
  font-size: 0.88rem;
  line-height: 1.75;
  color: var(--dim);
  background: ${({ $active }) => ($active ? "var(--surface)" : "transparent")};
  transition: background 0.2s;
`;

const PrimitiveName = styled.span<{ $color: string }>`
  color: ${({ $color }) => $color};
  font-weight: 600;
`;

// ── Convergence ──────────────────────────────────────────────────────────────

const ProjectCard = styled(Card)`
  display: flex;
  gap: 1.15rem;
  padding: 1.2rem 1.35rem;
`;

const ProjectName = styled.span<{ $color: string }>`
  font-family: ${MONO};
  font-size: 1.05rem;
  font-weight: 700;
  color: ${({ $color }) => $color};
`;

const ProjectTagline = styled.div`
  font-family: ${SERIF};
  font-size: 0.92rem;
  font-weight: 600;
  margin-bottom: 0.2rem;
`;

const LayerRow = styled.div<{ $color: string }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.7rem 1.15rem;
  background: var(--surface);
  border-radius: 5px;
  margin-bottom: 0.25rem;
  &:last-child { margin-bottom: 0; }
`;

const LayerName = styled.span<{ $color: string }>`
  font-family: ${SERIF};
  font-weight: 600;
  font-size: 0.92rem;
  color: ${({ $color }) => $color};
`;

const LayerSub = styled.span`
  font-family: ${SERIF};
  font-size: 0.8rem;
  color: var(--dim);
`;

// ── Salience ─────────────────────────────────────────────────────────────────

const DomainRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.85rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
`;

const DomainName = styled.div`
  font-family: ${SERIF};
  font-size: 0.88rem;
  font-weight: 600;
`;

const DomainFocus = styled.div`
  font-family: ${SERIF};
  font-size: 0.75rem;
  color: var(--dim);
`;

const StackCard = styled(Card)`
  padding: 1.25rem 1.5rem;
`;

const StackContent = styled.div`
  font-family: ${SERIF};
  font-size: 0.85rem;
  color: var(--dim);
  line-height: 1.85;
`;

// ── SVG Glyphs ───────────────────────────────────────────────────────────────

function Glyph({ type, color }: { type: string; color: string }) {
  const s = 34;
  const h = s / 2;
  const st = { width: s, height: s, flexShrink: 0 } as any;

  if (type === "state") return (
    <svg viewBox={`0 0 ${s} ${s}`} style={st}>
      <rect x={7} y={8} width={s-14} height={s-16} rx={2} fill="none" stroke={color} strokeWidth={1.2} />
      <line x1={11} y1={14} x2={s-11} y2={14} stroke={color} strokeWidth={0.8} opacity={0.5} />
      <line x1={11} y1={19} x2={s-15} y2={19} stroke={color} strokeWidth={0.8} opacity={0.3} />
      <line x1={11} y1={24} x2={s-13} y2={24} stroke={color} strokeWidth={0.8} opacity={0.3} />
    </svg>
  );
  if (type === "action") return (
    <svg viewBox={`0 0 ${s} ${s}`} style={st}>
      <polygon points={`${h},6 ${s-6},${h} ${h},${s-6} 6,${h}`} fill="none" stroke={color} strokeWidth={1.4} />
      <circle cx={h} cy={h} r={2.5} fill={color} opacity={0.8} />
    </svg>
  );
  if (type === "view") return (
    <svg viewBox={`0 0 ${s} ${s}`} style={st}>
      <ellipse cx={h} cy={h} rx={h-5} ry={h-9} fill="none" stroke={color} strokeWidth={1.4} />
      <circle cx={h} cy={h} r={3} fill={color} opacity={0.6} />
    </svg>
  );
  if (type === "agent") return (
    <svg viewBox={`0 0 ${s} ${s}`} style={st}>
      <circle cx={h} cy={12} r={4.5} fill="none" stroke={color} strokeWidth={1.3} />
      <path d={`M${h-8},${s-7} Q${h-8},17 ${h},17 Q${h+8},17 ${h+8},${s-7}`} fill="none" stroke={color} strokeWidth={1.3} />
    </svg>
  );
  return null;
}

// ── Section: Thesis ──────────────────────────────────────────────────────────

function ThesisSection() {
  return (
    <div>
      <Body>
        Every multi-agent coordination framework starts from the same assumption:
        agents need to <em>talk to each other</em>. Sync starts from a different premise.
      </Body>

      <QuoteBlock>
        Agents don't need to talk to each other.<br />They can share reality.
      </QuoteBlock>

      <Grid2>
        {[
          { label: "Traditional", accent: false, items: ["Message passing", "Orchestration layers", "Rigid schemas", "Predefined workflows"] },
          { label: "Substrate", accent: true, items: ["Stigmergic traces", "Self-activation", "Open-world state", "Emergent coordination"] },
        ].map(col => (
          <Card key={col.label}>
            <CardLabel $color={col.accent ? "var(--accent)" : undefined}>{col.label}</CardLabel>
            {col.items.map(item => (
              <CardDesc key={item} style={{ lineHeight: 2.1, paddingLeft: "0.35rem" }}>{item}</CardDesc>
            ))}
          </Card>
        ))}
      </Grid2>

      <BodyDim>
        The insight comes from an old lineage: Nii's blackboard architectures (1986), Selfridge's
        Pandemonium (1959), Linda tuple spaces. But those systems required rigid schemas and
        deterministic programs. Language models change the condition — they tolerate open worlds, interpret
        partially structured environments, and act meaningfully within them. Stigmergy becomes computationally viable.
      </BodyDim>

      <Callout $color="var(--green)" $tint="rgba(63, 185, 80, 0.06)">
        The system behaves less like software and more like an ecosystem.
        A reef rather than a workflow.
      </Callout>

      <BodySmall>
        Read the full argument: <a href="/docs/the-substrate-thesis">The Substrate Thesis</a> · <a href="/docs/what-becomes-true">What Becomes True</a> · <a href="/docs/introducing-sync">Introducing Sync</a>
      </BodySmall>
    </div>
  );
}

// ── Section: Algebra ─────────────────────────────────────────────────────────

function AlgebraSection() {
  const ops = [
    { name: "read context", endpoint: "GET /context", desc: "Returns everything: state, views, agents, actions with schemas, messages. The world as perceived.", color: "var(--green)" },
    { name: "invoke action", endpoint: "POST /actions/:id/invoke", desc: "The only write path. Built-in and custom. Every invocation logged to _audit.", color: "var(--red)" },
  ];

  const endpoints = [
    { path: "POST /rooms", purpose: "Create room" },
    { path: "POST /agents", purpose: "Join room" },
    { path: "GET /context", purpose: "Read everything" },
    { path: "POST /invoke", purpose: "Write anything" },
    { path: "GET /wait", purpose: "Block until condition" },
    { path: "POST /eval", purpose: "Evaluate CEL" },
    { path: "GET /rooms", purpose: "List rooms" },
    { path: "GET /agents", purpose: "List agents" },
    { path: "GET /docs/*", purpose: "Dynamic docs" },
    { path: "GET /", purpose: "Dashboard" },
  ];

  return (
    <div>
      <Body>
        Every multi-agent system, regardless of domain, reduces to two operations.
        Everything else is wiring.
      </Body>

      <Grid2>
        {ops.map(op => (
          <Card key={op.name} style={{ padding: "1.4rem 1.5rem" }}>
            <CardAccentTop $color={op.color} />
            <Mono style={{ fontSize: "0.82rem", color: op.color, display: "block", marginBottom: "0.35rem" }}>{op.endpoint}</Mono>
            <CardTitle>{op.name}</CardTitle>
            <CardDesc>{op.desc}</CardDesc>
          </Card>
        ))}
      </Grid2>

      <SectionLabel>10 Total Endpoints</SectionLabel>
      <EndpointGrid>
        {endpoints.map(ep => (
          <EndpointRow key={ep.path}>
            <EndpointPath>{ep.path}</EndpointPath>
            <EndpointPurpose>{ep.purpose}</EndpointPurpose>
          </EndpointRow>
        ))}
      </EndpointGrid>

      <Callout $color="var(--purple)" $tint="rgba(188, 140, 255, 0.06)">
        The kernel reduction (<Mono style={{ color: "var(--accent)" }}>reference/kernel.ts</Mono>) expresses
        this full algebra in ~300 lines of pure TypeScript. No dependencies. The proof that the surface area
        is genuinely minimal. See <a href="/docs/v6">Architecture docs</a> · <a href="/docs/sigma-calculus">Σ-calculus</a>
      </Callout>
    </div>
  );
}

// ── Section: Room ────────────────────────────────────────────────────────────

function RoomSection() {
  const [active, setActive] = useState<string | null>(null);

  const primitives = [
    { id: "state", icon: "state", name: "State", color: "var(--green)",
      desc: "Scoped key-value entries. _shared is public; agent scopes are private. Absence is signal — a key that doesn't exist yet is not an error, it's information. State grows by accretion." },
    { id: "actions", icon: "action", name: "Actions", color: "var(--red)",
      desc: "Delegated write capabilities. Registered by Alice, scoped to Alice, invokable by Bob — Bob's invocation writes to Alice's scope using Alice's authority. Capability delegation without an auth framework." },
    { id: "views", icon: "view", name: "Views", color: "var(--yellow)",
      desc: "Declarative CEL expressions projecting private state into public meaning. Registered dynamically, scoped to registrar's authority, evaluated lazily at read time. Interpretation as a composable runtime layer." },
    { id: "agents", icon: "agent", name: "Agents", color: "var(--accent)",
      desc: "Humans and AI are equivalent participants, distinguished not by kind but by observation modality. MCP clients are first-class agents with embodiment identity." },
  ];

  const activePrim = primitives.find(p => p.id === active);

  return (
    <div>
      <Body>
        A room is the fundamental unit. Shared state observed by self-activating participants.
        No controller. No router. The room's structure <em>is</em> the protocol.
      </Body>

      <Card style={{ padding: "1.75rem", marginBottom: "1.5rem" }}>
        <SectionLabel style={{ textAlign: "center", marginBottom: "1.15rem" }}>
          Room Primitives — {active ? "tap to deselect" : "tap to explore"}
        </SectionLabel>

        <PrimitiveGrid>
          {primitives.map(p => (
            <PrimitiveBtn key={p.id} $active={active === p.id} $color={p.color}
              onClick={() => setActive(active === p.id ? null : p.id)}>
              <Glyph type={p.icon} color={active === p.id ? p.color : "var(--dim)"} />
              <PrimitiveLabel $active={active === p.id} $color={p.color}>{p.name}</PrimitiveLabel>
            </PrimitiveBtn>
          ))}
        </PrimitiveGrid>

        <PrimitiveDetail $active={!!activePrim}>
          {activePrim
            ? <><PrimitiveName $color={activePrim.color}>{activePrim.name}</PrimitiveName> — {activePrim.desc}</>
            : <span style={{ display: "block", textAlign: "center", opacity: 0.45, fontSize: "0.82rem", paddingTop: "0.5rem" }}>Select a primitive to see how it works</span>
          }
        </PrimitiveDetail>
      </Card>

      <Grid3>
        {[
          { scope: "_shared", desc: "Public truth. Visible to all.", color: "var(--green)" },
          { scope: "alice", desc: "Alice's private scope.", color: "var(--accent)" },
          { scope: "_audit", desc: "Every invocation. Immutable.", color: "var(--dim)" },
        ].map(s => (
          <Card key={s.scope}>
            <Mono style={{ fontSize: "0.8rem", color: s.color, display: "block", marginBottom: "0.3rem" }}>{s.scope}</Mono>
            <CardDesc style={{ fontSize: "0.8rem" }}>{s.desc}</CardDesc>
          </Card>
        ))}
      </Grid3>

      <BodyDim>
        CEL (Common Expression Language) is the universal evaluation layer. Enabled expressions,
        wait conditions, view projections, action preconditions — all CEL. One expression language
        for the entire system.
      </BodyDim>

      <CodeBlock>
        <span style={{ color: "var(--dim)" }}>{"// view: project meaning from raw state"}</span><br />
        <span style={{ color: "var(--yellow)" }}>status</span> = state.alice.health {"<"} 20 ? "critical" : "stable"<br />
        <span style={{ color: "var(--dim)" }}>{"// action: enabled only when relevant"}</span><br />
        <span style={{ color: "var(--red)" }}>enabled</span> = state._shared.phase == "combat" && state.alice.health {">"} 0
      </CodeBlock>

      <BodySmall>
        See <a href="/docs/cel">CEL reference</a> · <a href="/docs/api">API reference</a> · <a href="/docs/views">Views reference</a> · <a href="/docs/surfaces-design">Surfaces design principles</a>
      </BodySmall>
    </div>
  );
}

// ── Section: Convergence ─────────────────────────────────────────────────────

function ConvergenceSection() {
  const projects = [
    { name: "ctxl", tagline: "Intelligence inside a component", color: "var(--red)",
      desc: "The interface remains alive to reasoning. Components don't use intelligence — they are intelligent. useReasoning hooks, self-modifying React." },
    { name: "sync", tagline: "Intelligence across shared state", color: "var(--accent)",
      desc: "Shared state is the execution environment. Agents observe and modify a common substrate. The reef emerges from local rules." },
    { name: "playtest", tagline: "Experience emerging from observers", color: "var(--yellow)",
      desc: "Game mechanics as bounded engines. Organs resolving constraints, emitting stable facts back into shared reality. 192 BGG-sourced mechanics formalized." },
  ];

  const layers = [
    { layer: "Participants", sub: "Humans / Agents / MCP Clients", color: "var(--accent)" },
    { layer: "Surfaces", sub: "Declarative observers, self-activating", color: "var(--yellow)" },
    { layer: "Derived Meaning", sub: "Views, CEL projections, interpretation", color: "var(--purple)" },
    { layer: "State", sub: "Scoped key-value substrate", color: "var(--green)" },
    { layer: "Organs", sub: "Localized state machines (Playtest)", color: "var(--red)" },
  ];

  return (
    <div>
      <Body>
        Three projects. One architecture. The convergence became clear: they all describe the same
        structure at different scales.
      </Body>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "2rem" }}>
        {projects.map(p => (
          <ProjectCard key={p.name}>
            <CardAccentLeft $color={p.color} />
            <div style={{ minWidth: "4.75rem", paddingLeft: "0.5rem" }}>
              <ProjectName $color={p.color}>{p.name}</ProjectName>
            </div>
            <div>
              <ProjectTagline>{p.tagline}</ProjectTagline>
              <CardDesc>{p.desc}</CardDesc>
            </div>
          </ProjectCard>
        ))}
      </div>

      <Card style={{ padding: "1.75rem" }}>
        <SectionLabel style={{ textAlign: "center", marginBottom: "1.15rem" }}>Unified Architecture</SectionLabel>
        {layers.map(l => (
          <LayerRow key={l.layer} $color={l.color}>
            <LayerName $color={l.color}>{l.layer}</LayerName>
            <LayerSub>{l.sub}</LayerSub>
          </LayerRow>
        ))}
      </Card>

      <Callout $color="var(--red)" $tint="rgba(248, 81, 73, 0.06)" style={{ marginTop: "1.75rem" }}>
        When these conditions hold: new surfaces can be added without modifying existing ones, new actions
        introduce new realities without rewrites, agents and humans collaborate without coordination logic.
        Design shifts from scripting behavior to shaping conditions under which behavior can arise.
      </Callout>

      <BodySmall>
        Read the essays: <a href="/docs/what-becomes-true">What Becomes True</a> · <a href="/docs/the-substrate-thesis">The Substrate Thesis</a> · <a href="/docs/isnt-this-just-react">Isn't This Just ReAct?</a>
      </BodySmall>
    </div>
  );
}

// ── Section: Salience ────────────────────────────────────────────────────────

function SalienceSection() {
  const domains = [
    { name: "Auftragstaktik", focus: "Intent-based delegation", color: "var(--red)" },
    { name: "Bjork/Vygotsky", focus: "Scaffolded challenge", color: "var(--yellow)" },
    { name: "Lakatos/Popper", focus: "Falsifiable design", color: "var(--purple)" },
    { name: "Gibson", focus: "Affordance perception", color: "var(--green)" },
    { name: "Dorigo", focus: "Swarm intelligence", color: "var(--accent)" },
    { name: "Argyris", focus: "Double-loop learning", color: "var(--red)" },
    { name: "RWML/RAGEN", focus: "RL world models", color: "var(--yellow)" },
  ];

  return (
    <div>
      <Body>
        The deepest theoretical move: sync rooms are structurally isomorphic to RL world models.
        Adaptive salience fills the missing reward signal role.
      </Body>

      <Card style={{ padding: "1.5rem 1.75rem", marginBottom: "1.75rem", background: "linear-gradient(135deg, rgba(88, 166, 255, 0.06), transparent)" }}>
        <Body style={{ marginBottom: "0.85rem" }}>
          The gap identified as most important: aggregating signals across the vocabulary
          into a room-level assessment — not just surfacing individual problems, but synthesizing
          a coherent field of relevance that guides agent attention.
        </Body>
        <Mono style={{ fontSize: "0.82rem", color: "var(--accent)", opacity: 0.85, display: "block" }}>
          room state → observation │ action invocation → policy │ salience → reward signal
        </Mono>
      </Card>

      <SectionLabel>Seven Grounding Domains</SectionLabel>

      <Grid2>
        {domains.map(d => (
          <DomainRow key={d.name}>
            <Dot $color={d.color} />
            <div>
              <DomainName>{d.name}</DomainName>
              <DomainFocus>{d.focus}</DomainFocus>
            </div>
          </DomainRow>
        ))}
      </Grid2>

      <BodyDim>
        The demo infrastructure tests this with a stigmergic ant colony scenario — genuinely
        independent subagents (narrator, scout, analyst, architect) coordinating through
        environmental traces, not messages. Each agent's action modifies the perceptual
        environment for others. Understanding accumulates socially.
      </BodyDim>

      <StackCard>
        <SectionLabel style={{ marginBottom: "0.55rem" }}>Implementation Stack</SectionLabel>
        <StackContent>
          <span style={{ color: "var(--green)" }}>TypeScript/Deno</span> on Val.town ·{" "}
          <span style={{ color: "var(--yellow)" }}>SQLite</span> persistence ·{" "}
          <span style={{ color: "var(--purple)" }}>CEL</span> expressions ·{" "}
          <span style={{ color: "var(--red)" }}>MCP</span> native protocol ·{" "}
          <span style={{ color: "var(--accent)" }}>SSR React</span> dashboard<br />
          Codebase decomposed from monolith to 10+ domain modules. 51 tests.<br />
          Single domain: <a href="https://sync.parc.land" style={{ color: "var(--accent)" }}>sync.parc.land</a>
        </StackContent>
      </StackCard>

      <BodySmall style={{ marginTop: "1.5rem" }}>
        Read more: <a href="/docs/the-pressure-field">The Pressure Field</a> · <a href="/docs/examples">Examples</a> · <a href="/docs/help">Help reference</a>
      </BodySmall>
    </div>
  );
}

// ── Section registry ─────────────────────────────────────────────────────────

const SECTION_COMPONENTS: Record<string, () => JSX.Element> = {
  thesis: ThesisSection,
  algebra: AlgebraSection,
  room: RoomSection,
  convergence: ConvergenceSection,
  salience: SalienceSection,
};

// ── Main export ──────────────────────────────────────────────────────────────

export function Overview() {
  const [activeSection, setActiveSection] = useState("thesis");
  const ActiveComponent = SECTION_COMPONENTS[activeSection] ?? ThesisSection;
  const sec = SECTIONS.find(s => s.id === activeSection)!;

  return (
    <Page>
      <Nav active="overview" />
      <Header>
        <Breadcrumb><a href="/">/sync</a> / overview</Breadcrumb>
        <PageTitle>Vision &amp; Architecture</PageTitle>
        <PageSub>A room-based multi-agent coordination substrate</PageSub>
      </Header>
      <Layout>
        <Sidebar>
          {SECTIONS.map(s => (
            <SideBtn key={s.id} $active={activeSection === s.id} onClick={() => setActiveSection(s.id)}>
              <SideBtnLabel $active={activeSection === s.id}>{s.label}</SideBtnLabel>
              <SideBtnSub $active={activeSection === s.id}>{s.subtitle}</SideBtnSub>
            </SideBtn>
          ))}
        </Sidebar>
        <Main>
          <SectionTitle>{sec.title}</SectionTitle>
          <SectionSub>{sec.subtitle}</SectionSub>
          <ActiveComponent />
        </Main>
      </Layout>
      <Footer>
        sync · <a href="https://github.com/christopherdebeer">@christopherdebeer</a> · Edinburgh
      </Footer>
    </Page>
  );
}
