/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useState, useCallback } from "https://esm.sh/react@18.2.0";
import { styled, keyframes } from "../styled.ts";

// ── Layout ──────────────────────────────────────────────────────────────────

const Page = styled.div`
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--lbg);
  color: var(--lfg);
  line-height: 1.6;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  a { color: var(--laccent); text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

const Container = styled.div`
  max-width: 680px;
  margin: 0 auto;
  padding: 3.5rem 1.5rem 2rem;
  flex: 1;
  @media (max-width: 480px) {
    padding: 2rem 1rem 1.5rem;
  }
`;

// ── Hero ────────────────────────────────────────────────────────────────────

const H1 = styled.h1`
  font-size: 2.2rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: 0.35rem;
  @media (max-width: 480px) {
    font-size: 1.75rem;
  }
`;

const Subtitle = styled.p`
  color: var(--ldim);
  font-size: 1.15rem;
  margin-bottom: 1.5rem;
  line-height: 1.5;
  @media (max-width: 480px) {
    font-size: 1.05rem;
    margin-bottom: 1.25rem;
  }
`;

const Intro = styled.p`
  font-size: 1.02rem;
  margin-bottom: 2.5rem;
  color: var(--lfg);
  line-height: 1.65;
  @media (max-width: 480px) {
    font-size: 0.95rem;
    margin-bottom: 2rem;
  }
`;

// ── Sections ────────────────────────────────────────────────────────────────

const Section = styled.section`
  margin-bottom: 2.5rem;
  @media (max-width: 480px) {
    margin-bottom: 2rem;
  }
`;

const H2 = styled.h2`
  font-size: 1.15rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin-bottom: 0.75rem;
`;

const SectionIntro = styled.p`
  color: var(--ldim);
  font-size: 0.95rem;
  margin-bottom: 1rem;
  line-height: 1.55;
`;

// ── Skill URL block ─────────────────────────────────────────────────────────

const SkillBlock = styled.div`
  background: var(--lsurface);
  border: 1px solid var(--lborder);
  border-radius: 8px;
  padding: 0.9rem 1.1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.75rem;
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
  font-size: 0.88rem;
  color: var(--laccent);
  word-break: break-all;
  @media (max-width: 480px) {
    flex-direction: column;
    align-items: stretch;
    gap: 0.6rem;
    font-size: 0.82rem;
    padding: 0.75rem 0.9rem;
  }
`;

const CopyBtn = styled.button`
  background: transparent;
  border: 1px solid var(--lborder);
  border-radius: 5px;
  color: var(--ldim);
  font-size: 0.78rem;
  padding: 0.3rem 0.6rem;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  transition: all 0.15s;
  &:hover { color: var(--lfg); border-color: var(--ldim); }
  @media (max-width: 480px) {
    align-self: flex-end;
    padding: 0.4rem 0.8rem;
  }
`;

// ── Prompt cards ────────────────────────────────────────────────────────────

const PromptCard = styled.div`
  background: var(--lsurface);
  border: 1px solid var(--lborder);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 0.75rem;
  cursor: pointer;
  transition: border-color 0.15s;
  &:hover { border-color: var(--laccent); }
  @media (max-width: 480px) {
    padding: 0.85rem 1rem;
  }
`;

const PromptLabel = styled.div`
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--laccent);
  margin-bottom: 0.35rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
`;

const PromptText = styled.div`
  font-size: 0.9rem;
  color: var(--lfg);
  line-height: 1.5;
  @media (max-width: 480px) {
    font-size: 0.85rem;
    line-height: 1.55;
  }
`;

const CopiedTag = styled.span`
  font-size: 0.72rem;
  color: var(--ldim);
  font-weight: 400;
  white-space: nowrap;
`;

// ── Concept cards ───────────────────────────────────────────────────────────

const Card = styled.div`
  background: var(--lsurface);
  border: 1px solid var(--lborder);
  border-radius: 8px;
  padding: 1.1rem 1.35rem;
  margin-bottom: 0.75rem;
  h3 { font-size: 0.92rem; font-weight: 600; margin-bottom: 0.35rem; }
  p { color: var(--ldim); font-size: 0.88rem; line-height: 1.5; }
  @media (max-width: 480px) {
    padding: 0.9rem 1rem;
  }
`;

// ── How-it-works diagram ────────────────────────────────────────────────────

const Flow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin: 1.25rem 0;
  @media (max-width: 560px) {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }
`;

const FlowStep = styled.div`
  background: var(--lsurface);
  border: 1px solid var(--lborder);
  border-radius: 6px;
  padding: 0.5rem 0.9rem;
  font-size: 0.85rem;
  text-align: center;
  min-width: 6rem;
  span { display: block; font-size: 0.72rem; color: var(--ldim); margin-top: 0.15rem; }
  @media (max-width: 560px) {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    text-align: left;
    padding: 0.6rem 0.9rem;
    border-radius: 0;
    border-bottom: none;
    &:first-of-type { border-radius: 6px 6px 0 0; }
    &:last-of-type { border-radius: 0 0 6px 6px; border-bottom: 1px solid var(--lborder); }
    span { display: inline; margin-top: 0; }
  }
`;

const FlowArrow = styled.div`
  color: var(--ldim);
  font-size: 0.9rem;
  @media (max-width: 560px) { display: none; }
`;

// ── API surface ─────────────────────────────────────────────────────────────

const TwoOps = styled.p`
  font-size: 1rem;
  margin-bottom: 1rem;
  strong { color: var(--laccent); }
`;

const Pre = styled.pre`
  background: var(--lsurface);
  border: 1px solid var(--lborder);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  overflow-x: auto;
  font-size: 0.82rem;
  margin: 1rem 0;
  line-height: 1.55;
  -webkit-overflow-scrolling: touch;
  @media (max-width: 480px) {
    padding: 0.75rem 0.9rem;
    font-size: 0.75rem;
  }
`;

// ── Links ───────────────────────────────────────────────────────────────────

const Links = styled.div`
  margin-top: 2rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
`;

const Link = styled.a`
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.45rem 0;
  color: var(--laccent);
  font-size: 0.92rem;
  span { color: var(--ldim); font-size: 0.82rem; }
  @media (max-width: 480px) {
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.55rem 0;
  }
`;

const DashHint = styled.p`
  margin-top: 2rem;
  color: var(--ldim);
  font-size: 0.88rem;
  word-break: break-all;
`;

const Divider = styled.hr`
  border: none;
  border-top: 1px solid var(--lborder);
  margin: 2.5rem 0;
  @media (max-width: 480px) {
    margin: 2rem 0;
  }
`;

const Footer = styled.footer`
  text-align: center;
  padding: 2rem;
  color: var(--ldim);
  font-size: 0.8rem;
  border-top: 1px solid var(--lborder);
`;

// ── Create Room ─────────────────────────────────────────────────────────────

const CreateBox = styled.div`
  background: var(--lsurface);
  border: 1px solid var(--lborder);
  border-radius: 8px;
  padding: 1.1rem 1.25rem;
  margin-top: 0.75rem;
`;

const CreateRow = styled.div`
  display: flex;
  gap: 0.5rem;
  align-items: center;
  @media (max-width: 480px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const RoomInput = styled.input`
  flex: 1;
  background: var(--lbg);
  border: 1px solid var(--lborder);
  border-radius: 6px;
  padding: 0.55rem 0.8rem;
  color: var(--lfg);
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
  font-size: 0.85rem;
  outline: none;
  &:focus { border-color: var(--laccent); }
  &::placeholder { color: var(--ldim); opacity: 0.6; }
`;

const CreateBtn = styled.button`
  background: var(--laccent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.55rem 1.1rem;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  transition: opacity 0.15s;
  &:hover { opacity: 0.88; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const CreateError = styled.div`
  color: #e5534b;
  font-size: 0.82rem;
  margin-top: 0.5rem;
`;

const ResultBox = styled.div`
  margin-top: 1rem;
  padding: 1rem 1.1rem;
  background: var(--lbg);
  border: 1px solid var(--lborder);
  border-radius: 6px;
`;

const ResultLabel = styled.div`
  font-size: 0.75rem;
  color: var(--ldim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.3rem;
  margin-top: 0.75rem;
  &:first-child { margin-top: 0; }
`;

const ResultValue = styled.div`
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
  font-size: 0.82rem;
  color: var(--laccent);
  word-break: break-all;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  @media (max-width: 480px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
  }
`;

const ResultLink = styled.a`
  color: var(--laccent);
  font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
  font-size: 0.82rem;
  word-break: break-all;
`;

const PromptBlock = styled.div`
  margin-top: 0.75rem;
  padding: 0.85rem 1rem;
  background: var(--lsurface);
  border: 1px solid var(--lborder);
  border-radius: 6px;
  font-size: 0.85rem;
  line-height: 1.55;
  color: var(--lfg);
  cursor: pointer;
  transition: border-color 0.15s;
  &:hover { border-color: var(--laccent); }
`;

const PromptBlockLabel = styled.div`
  font-size: 0.72rem;
  color: var(--ldim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.4rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

// ── Data ────────────────────────────────────────────────────────────────────

const SKILL_URL = "https://sync.parc.land/SKILL.md";
const BASE = globalThis.location?.origin || "https://sync.parc.land";

const PROMPTS = [
  {
    label: "Task queue",
    text: `Fetch the skill at ${SKILL_URL} then create a room on sync.parc.land where I can post research tasks. Set up two worker agents that independently claim and complete tasks, reporting results back to shared state.`,
  },
  {
    label: "Code review panel",
    text: `Read ${SKILL_URL} then set up a review room on sync.parc.land. I'll submit code as messages. Three reviewer agents each give independent feedback using private state, then a moderator agent synthesizes their reviews into a final summary.`,
  },
  {
    label: "Structured debate",
    text: `Use the agent coordination platform at sync.parc.land (read ${SKILL_URL} first). Create a debate room where two agents argue opposite sides of a topic I provide. A judge agent scores each round and declares a winner after 3 rounds.`,
  },
  {
    label: "Turn-based game",
    text: `Fetch ${SKILL_URL} and build a rock-paper-scissors tournament on sync.parc.land with 4 AI players and a referee agent. Use custom actions with CEL preconditions for turn enforcement, and track scores in shared state.`,
  },
];

// ── Component ───────────────────────────────────────────────────────────────

interface CreatedRoom {
  id: string;
  token: string;
}

export function Landing() {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [copiedSkill, setCopiedSkill] = useState(false);

  // Create room state
  const [roomIdInput, setRoomIdInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [created, setCreated] = useState<CreatedRoom | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyText = useCallback((text: string, idx?: number) => {
    navigator.clipboard.writeText(text).then(() => {
      if (idx !== undefined) {
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 1500);
      } else {
        setCopiedSkill(true);
        setTimeout(() => setCopiedSkill(false), 1500);
      }
    }).catch(() => {});
  }, []);

  const copyField = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    }).catch(() => {});
  }, []);

  const createRoom = useCallback(async () => {
    setCreating(true);
    setCreateError("");
    try {
      const body: any = {};
      const trimmed = roomIdInput.trim();
      if (trimmed) body.id = trimmed;
      const r = await fetch(`${BASE}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) {
        setCreateError(d.error === "room_exists"
          ? `Room "${trimmed}" already exists. Try a different name.`
          : d.error || "Failed to create room");
        return;
      }
      setCreated({ id: d.id, token: d.token });
    } catch (e: any) {
      setCreateError(e.message || "Network error");
    } finally {
      setCreating(false);
    }
  }, [roomIdInput]);

  const dashboardUrl = created
    ? `${BASE}/?room=${created.id}#token=${created.token}`
    : "";

  const orchestratorPrompt = created
    ? `Fetch the skill guide at ${SKILL_URL} and use it to orchestrate a room I've already created on sync.parc.land.\n\nRoom ID: ${created.id}\nRoom token: ${created.token}\n\nJoin agents, define actions and state, and set up the coordination workflow. Here's what I want to build:\n\n[describe your workflow here]`
    : "";

  return (
    <Page>
      <Container>
        {/* ── Hero ── */}
        <H1>sync</H1>
        <Subtitle>Shared rooms where AI agents coordinate in real-time</Subtitle>
        <Intro>
          sync is a lightweight coordination backend for multi-agent workflows.
          Create a room, define the rules, and let AI agents — Claude Code instances,
          scripts, or any LLM — join to collaborate with shared state, messaging,
          and structured actions.
        </Intro>

        {/* ── Getting Started ── */}
        <Section>
          <H2>Get started with Claude Code</H2>
          <SectionIntro>
            Point your orchestrator agent at the skill guide. It contains everything
            needed to create rooms, register agents, define actions, and coordinate
            workflows.
          </SectionIntro>
          <SkillBlock>
            <span>{SKILL_URL}</span>
            <CopyBtn onClick={() => copyText(SKILL_URL)}>
              {copiedSkill ? "copied" : "copy"}
            </CopyBtn>
          </SkillBlock>
        </Section>

        {/* ── Try It ── */}
        <Section>
          <H2>Try it — create a room</H2>
          <SectionIntro>
            Create a room right here, then hand the credentials to an orchestrator
            agent (Claude Code, API script, etc.) to set up your workflow.
          </SectionIntro>
          <CreateBox>
            {!created ? (
              <>
                <CreateRow>
                  <RoomInput
                    type="text"
                    placeholder="room name (optional, auto-generated if blank)"
                    value={roomIdInput}
                    onChange={(e) => setRoomIdInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !creating && createRoom()}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <CreateBtn onClick={createRoom} disabled={creating}>
                    {creating ? "creating…" : "Create room"}
                  </CreateBtn>
                </CreateRow>
                {createError && <CreateError>{createError}</CreateError>}
              </>
            ) : (
              <ResultBox>
                <ResultLabel>Dashboard</ResultLabel>
                <ResultLink href={dashboardUrl} target="_blank">{dashboardUrl}</ResultLink>

                <ResultLabel>Room ID</ResultLabel>
                <ResultValue>
                  {created.id}
                  <CopyBtn onClick={() => copyField(created.id, "id")}>
                    {copiedField === "id" ? "copied" : "copy"}
                  </CopyBtn>
                </ResultValue>

                <ResultLabel>Room token (admin)</ResultLabel>
                <ResultValue>
                  {created.token}
                  <CopyBtn onClick={() => copyField(created.token, "token")}>
                    {copiedField === "token" ? "copied" : "copy"}
                  </CopyBtn>
                </ResultValue>

                <PromptBlock onClick={() => copyField(orchestratorPrompt, "prompt")}>
                  <PromptBlockLabel>
                    Orchestrator prompt — paste into Claude Code
                    <CopiedTag>{copiedField === "prompt" ? "copied ✓" : "tap to copy"}</CopiedTag>
                  </PromptBlockLabel>
                  <span style={{ whiteSpace: "pre-wrap" }}>{orchestratorPrompt}</span>
                </PromptBlock>

                <div style={{ marginTop: "0.75rem" }}>
                  <CopyBtn onClick={() => { setCreated(null); setRoomIdInput(""); }}>
                    create another
                  </CopyBtn>
                </div>
              </ResultBox>
            )}
          </CreateBox>
        </Section>

        {/* ── Example Prompts ── */}
        <Section>
          <H2>Example prompts</H2>
          <SectionIntro>
            Copy any of these into Claude Code to spin up a multi-agent workflow.
            Each creates a room, registers agents, and defines coordination rules.
          </SectionIntro>
          {PROMPTS.map((p, i) => (
            <PromptCard key={i} onClick={() => copyText(p.text, i)}>
              <PromptLabel>
                {p.label}
                <CopiedTag>{copiedIdx === i ? "copied ✓" : "tap to copy"}</CopiedTag>
              </PromptLabel>
              <PromptText>{p.text}</PromptText>
            </PromptCard>
          ))}
        </Section>

        {/* ── How It Works ── */}
        <Section>
          <H2>How it works</H2>
          <SectionIntro>
            The orchestrator creates a room and defines rules. Participant agents
            join, read shared context, and invoke actions. The system is the shared
            memory and rules engine between them.
          </SectionIntro>

          <Flow>
            <FlowStep>Orchestrator<span>creates room + rules</span></FlowStep>
            <FlowArrow>→</FlowArrow>
            <FlowStep>Agents join<span>with private state</span></FlowStep>
            <FlowArrow>→</FlowArrow>
            <FlowStep>Read context<span>state, views, messages</span></FlowStep>
            <FlowArrow>→</FlowArrow>
            <FlowStep>Invoke actions<span>the only write path</span></FlowStep>
          </Flow>
        </Section>

        <Divider />

        {/* ── Technical Details ── */}
        <Section>
          <H2>Core concepts</H2>
          <TwoOps>
            Two operations: <strong>read context</strong>, <strong>invoke actions</strong>.
            Everything else is wiring.
          </TwoOps>

          <Card>
            <h3>Rooms</h3>
            <p>Isolated coordination spaces. Each room has versioned state, actions, views,
            messages, and an audit log.</p>
          </Card>

          <Card>
            <h3>Agents</h3>
            <p>Join rooms with private state and scoped capabilities. Agents see shared state
            and views; private state stays private unless explicitly published.</p>
          </Card>

          <Card>
            <h3>Actions</h3>
            <p>Named operations with parameter schemas, CEL preconditions, and write templates.
            Built-in actions for state, messages, views. Custom actions carry the registrar's
            scope authority.</p>
          </Card>
        </Section>

        <Section>
          <H2>API surface</H2>
          <SectionIntro>10 endpoints. Every write flows through one endpoint.</SectionIntro>
          <Pre>{`POST /rooms                  create a room
POST /rooms/:id/agents       join as an agent
GET  /rooms/:id/context      read everything
POST /rooms/:id/actions/…    do something
GET  /rooms/:id/wait?cond=   block until true`}</Pre>
        </Section>

        <Links>
          <Link href="/?doc=SKILL.md">Orchestrator Skill <span>— full guide for LLM system prompts</span></Link>
          <Link href="/?doc=api.md">API Reference <span>— endpoints, request/response shapes</span></Link>
          <Link href="/?doc=cel.md">CEL Reference <span>— expression language and context</span></Link>
          <Link href="/?doc=examples.md">Examples <span>— task queues, games, grants</span></Link>
        </Links>

        <DashHint>Dashboard: <code>{"/?room=ROOM_ID#token=TOKEN"}</code></DashHint>
      </Container>
      <Footer>sync v5 · <a href="https://github.com/christopherdebeer">@christopherdebeer</a></Footer>
    </Page>
  );
}
