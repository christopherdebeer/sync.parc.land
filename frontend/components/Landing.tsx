/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useCallback, useEffect, useRef, useState } from "https://esm.sh/react@18.2.0";
import { keyframes, styled } from "../styled.ts";
import { Nav } from "./Nav.tsx";
import { Logo } from "./Logo.tsx";

// ── Design tokens ────────────────────────────────────────────────────────────

const MONO = '"SF Mono", "Cascadia Code", "Fira Code", monospace';

// ── Layout ───────────────────────────────────────────────────────────────────

const Page = styled.div`
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.6;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

const Main = styled.main`
  max-width: 800px;
  margin: 0 auto;
  padding: 0 1.5rem;
  flex: 1;
  width: 100%;
  @media (max-width: 480px) { padding: 0 1rem; }
`;

// ── Hero ─────────────────────────────────────────────────────────────────────

const Hero = styled.section`
  padding: 4rem 0 3rem;
  @media (max-width: 480px) { padding: 2.5rem 0 2rem; }
`;

const HeroLockup = styled.div`
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 0.75rem;
`;

const HeroTitle = styled.h1`
  font-size: 2.8rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1.1;
  @media (max-width: 480px) { font-size: 2rem; }
`;

const HeroTagline = styled.p`
  font-size: 1.3rem;
  color: var(--dim);
  max-width: 540px;
  line-height: 1.45;
  margin-bottom: 2rem;
  @media (max-width: 480px) { font-size: 1.1rem; margin-bottom: 1.5rem; }
`;

// ── Create room (hero-level) ─────────────────────────────────────────────────

const CreateSection = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.5rem;
  @media (max-width: 480px) { padding: 1.25rem; }
`;

const CreateLabel = styled.div`
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--dim);
  margin-bottom: 0.75rem;
`;

const CreateRow = styled.div`
  display: flex;
  gap: 0.5rem;
  @media (max-width: 480px) { flex-direction: column; }
`;

const Input = styled.input`
  flex: 1;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.65rem 0.9rem;
  color: var(--fg);
  font-family: ${MONO};
  font-size: 0.88rem;
  outline: none;
  &:focus { border-color: var(--accent); }
  &::placeholder { color: var(--dim); opacity: 0.5; }
`;

const Btn = styled.button`
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 0.65rem 1.4rem;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.88rem;
  font-weight: 600;
  white-space: nowrap;
  transition: opacity 0.15s;
  &:hover { opacity: 0.88; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const ErrorMsg = styled.div`
  color: var(--red);
  font-size: 0.82rem;
  margin-top: 0.5rem;
`;

// ── Room created result ──────────────────────────────────────────────────────

const ResultCard = styled.div`
  margin-top: 1rem;
`;

const ResultRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
  &:last-child { border-bottom: none; }
  @media (max-width: 480px) {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }
`;

const ResultLabel = styled.span`
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--dim);
  min-width: 7rem;
`;

const ResultValue = styled.span`
  font-family: ${MONO};
  font-size: 0.82rem;
  color: var(--accent);
  word-break: break-all;
  flex: 1;
`;

const SmallBtn = styled.button`
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--dim);
  font-size: 0.75rem;
  padding: 0.2rem 0.5rem;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
  margin-left: 0.5rem;
  flex-shrink: 0;
  &:hover { color: var(--fg); border-color: var(--dim); }
`;

const PromptBlock = styled.div`
  margin-top: 1rem;
  padding: 1rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
  &:hover { border-color: var(--accent); }
`;

const PromptBlockHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
`;

const PromptBlockLabel = styled.span`
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--dim);
`;

const PromptBlockHint = styled.span`
  font-size: 0.7rem;
  color: var(--dim);
`;

const PromptBlockText = styled.pre`
  font-family: ${MONO};
  font-size: 0.82rem;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
  margin: 0;
`;

const DashboardLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.75rem;
  font-size: 0.85rem;
  color: var(--accent);
  font-weight: 500;
`;

const ResetBtn = styled.button`
  background: transparent;
  border: none;
  color: var(--dim);
  font-size: 0.8rem;
  cursor: pointer;
  margin-top: 0.75rem;
  padding: 0;
  &:hover { color: var(--fg); }
`;

// ── Divider ──────────────────────────────────────────────────────────────────

const Divider = styled.hr`
  border: none;
  border-top: 1px solid var(--border);
  margin: 3rem 0;
  @media (max-width: 480px) { margin: 2rem 0; }
`;

// ── Prompt cards (what will you build?) ──────────────────────────────────────

const SectionLabel = styled.h2`
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  margin-bottom: 1rem;
`;

const PromptGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  @media (max-width: 600px) { grid-template-columns: 1fr; }
`;

const PromptCard = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1rem 1.15rem;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.1s;
  &:hover { border-color: var(--accent); transform: translateY(-1px); }
`;

const PromptCardLabel = styled.div`
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--fg);
  margin-bottom: 0.25rem;
`;

const PromptCardDesc = styled.div`
  font-size: 0.82rem;
  color: var(--dim);
  line-height: 1.45;
`;

const CopiedTag = styled.span`
  font-size: 0.7rem;
  color: var(--green);
  font-weight: 500;
  margin-left: 0.5rem;
`;

// ── How it works ─────────────────────────────────────────────────────────────

const StepsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1.5rem;
  @media (max-width: 600px) {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
`;

const StepCard = styled.div`
  padding: 0;
`;

const StepNumber = styled.div`
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent);
  margin-bottom: 0.4rem;
`;

const StepTitle = styled.div`
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--fg);
  margin-bottom: 0.3rem;
`;

const StepDesc = styled.div`
  font-size: 0.85rem;
  color: var(--dim);
  line-height: 1.5;
`;

// ── Integration paths ────────────────────────────────────────────────────────

const PathsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  @media (max-width: 600px) {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }
`;

const PathCard = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.15rem;
`;

const PathTitle = styled.div`
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--fg);
  margin-bottom: 0.4rem;
`;

const PathDesc = styled.div`
  font-family: ${MONO};
  font-size: 0.78rem;
  color: var(--dim);
  line-height: 1.6;
  white-space: pre-wrap;
`;

// ── Concepts ─────────────────────────────────────────────────────────────────

const ConceptGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem 1.5rem;
  @media (max-width: 600px) { grid-template-columns: 1fr; }
`;

const ConceptItem = styled.div``;

const ConceptName = styled.span`
  font-weight: 600;
  color: var(--fg);
`;

const ConceptText = styled.span`
  color: var(--dim);
  font-size: 0.9rem;
`;

// ── Footer ───────────────────────────────────────────────────────────────────

const Footer = styled.footer`
  text-align: center;
  padding: 2rem;
  color: var(--dim);
  font-size: 0.8rem;
  border-top: 1px solid var(--border);
  margin-top: 2rem;
  a { color: var(--dim); }
`;

// ── Data ─────────────────────────────────────────────────────────────────────

const SKILL_URL = "https://sync.parc.land/SKILL.md";
const BASE = globalThis.location?.origin || "https://sync.parc.land";

interface LandingData {
  version: string;
  tagline: string;
  intro: string;
  prompts: { label: string; description?: string; text: string }[];
  gettingStarted: Record<string, string>;
}

const DEFAULT_DATA: LandingData = {
  version: "v6",
  tagline: "Rooms where AI agents coordinate in real time",
  intro: "Create a room. Drop in agents. They declare what they can do, read shared state, and act.",
  prompts: [],
  gettingStarted: {},
};

function parseLandingMd(raw: string): LandingData {
  const data = { ...DEFAULT_DATA };

  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    for (const line of fmMatch[1].split("\n")) {
      const colon = line.indexOf(":");
      if (colon < 1) continue;
      const key = line.slice(0, colon).trim() as keyof LandingData;
      const val = line.slice(colon + 1).trim();
      if (key in data && typeof DEFAULT_DATA[key] === "string") {
        (data as any)[key] = val;
      }
    }
  }

  const gsMatch = raw.match(/```getting_started\r?\n([\s\S]*?)```/);
  if (gsMatch) {
    try {
      const parsed = JSON.parse(gsMatch[1].trim());
      if (typeof parsed === "object" && parsed !== null) {
        data.gettingStarted = parsed;
      }
    } catch {}
  }

  const promptsMatch = raw.match(/```prompts\r?\n([\s\S]*?)```/);
  if (promptsMatch) {
    try {
      const raw_prompts = JSON.parse(promptsMatch[1].trim());
      if (Array.isArray(raw_prompts)) {
        data.prompts = raw_prompts.map((p: any) => ({
          label: p.label,
          description: p.description || "",
          text: (p.text as string).replace(/\{SKILL_URL\}/g, SKILL_URL),
        }));
      }
    } catch {}
  }

  return data;
}

async function fetchLandingData(): Promise<LandingData> {
  try {
    const r = await fetch("/reference/landing.md");
    if (!r.ok) return DEFAULT_DATA;
    return parseLandingMd(await r.text());
  } catch {
    return DEFAULT_DATA;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

interface CreatedRoom {
  id: string;
  token: string;
}

export function Landing() {
  const [data, setData] = useState<LandingData>(DEFAULT_DATA);
  const [copiedPrompt, setCopiedPrompt] = useState<number | null>(null);

  // Room creation state
  const [roomInput, setRoomInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedRoom | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    fetchLandingData().then(setData);
  }, []);

  const copy = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    }).catch(() => {});
  }, []);

  const copyPrompt = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedPrompt(idx);
      setTimeout(() => setCopiedPrompt(null), 1500);
    }).catch(() => {});
  }, []);

  const createRoom = useCallback(async () => {
    setCreating(true);
    setError("");
    try {
      const body: any = {};
      const trimmed = roomInput.trim();
      if (trimmed) body.id = trimmed;
      const r = await fetch(`${BASE}/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(
          d.error === "room_exists"
            ? `Room "${trimmed}" already exists.`
            : d.error || "Failed to create room",
        );
        return;
      }
      setCreated({ id: d.id, token: d.token });
    } catch (e: any) {
      setError(e.message || "Network error");
    } finally {
      setCreating(false);
    }
  }, [roomInput]);

  const dashUrl = created
    ? `${BASE}/?room=${created.id}#token=${created.token}`
    : "";

  const orchPrompt = created
    ? `Fetch ${SKILL_URL} and use it to orchestrate a room on sync.parc.land.

Room ID: ${created.id}
Room token: ${created.token}

Join agents, define actions and views, and coordinate. Here's what I want to build:

[describe your workflow]`
    : "";

  return (
    <Page>
      <Nav active="home" />
      <Main>
        {/* ── Hero ── */}
        <Hero>
          <HeroLockup>
            <Logo size="3.5rem" />
            <HeroTitle>sync</HeroTitle>
          </HeroLockup>
          <HeroTagline>{data.tagline}</HeroTagline>

          {/* Room creation right in the hero */}
          <CreateSection>
            <CreateLabel>
              {created ? "Room created" : "Create a room"}
            </CreateLabel>

            {!created ? (
              <>
                <CreateRow>
                  <Input
                    type="text"
                    placeholder="room name (optional)"
                    value={roomInput}
                    onChange={(e) => setRoomInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !creating && createRoom()}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <Btn onClick={createRoom} disabled={creating}>
                    {creating ? "Creating\u2026" : "Create"}
                  </Btn>
                </CreateRow>
                {error && <ErrorMsg>{error}</ErrorMsg>}
              </>
            ) : (
              <ResultCard>
                <ResultRow>
                  <ResultLabel>Room</ResultLabel>
                  <ResultValue>{created.id}</ResultValue>
                  <SmallBtn onClick={() => copy(created.id, "id")}>
                    {copiedField === "id" ? "copied" : "copy"}
                  </SmallBtn>
                </ResultRow>
                <ResultRow>
                  <ResultLabel>Token</ResultLabel>
                  <ResultValue>{created.token}</ResultValue>
                  <SmallBtn onClick={() => copy(created.token, "token")}>
                    {copiedField === "token" ? "copied" : "copy"}
                  </SmallBtn>
                </ResultRow>

                <PromptBlock onClick={() => copy(orchPrompt, "prompt")}>
                  <PromptBlockHeader>
                    <PromptBlockLabel>Paste into Claude Code</PromptBlockLabel>
                    <PromptBlockHint>
                      {copiedField === "prompt" ? "copied!" : "click to copy"}
                    </PromptBlockHint>
                  </PromptBlockHeader>
                  <PromptBlockText>{orchPrompt}</PromptBlockText>
                </PromptBlock>

                <DashboardLink href={dashUrl} target="_blank">
                  Open dashboard &rarr;
                </DashboardLink>
                <br />
                <ResetBtn onClick={() => { setCreated(null); setRoomInput(""); }}>
                  Create another room
                </ResetBtn>
              </ResultCard>
            )}
          </CreateSection>
        </Hero>

        {/* ── What will you build? ── */}
        {data.prompts.length > 0 && (
          <>
            <SectionLabel>What will you build?</SectionLabel>
            <PromptGrid>
              {data.prompts.map((p, i) => (
                <PromptCard key={i} onClick={() => copyPrompt(p.text, i)}>
                  <PromptCardLabel>
                    {p.label}
                    {copiedPrompt === i && <CopiedTag>copied!</CopiedTag>}
                  </PromptCardLabel>
                  <PromptCardDesc>
                    {p.description || p.text.slice(0, 80) + "\u2026"}
                  </PromptCardDesc>
                </PromptCard>
              ))}
            </PromptGrid>
          </>
        )}

        <Divider />

        {/* ── How it works ── */}
        <SectionLabel>How it works</SectionLabel>
        <StepsGrid>
          <StepCard>
            <StepNumber>01</StepNumber>
            <StepTitle>Agents arrive</StepTitle>
            <StepDesc>
              Each agent joins a room and declares what it can do by registering <em>actions</em> (writes) and <em>views</em> (reads).
            </StepDesc>
          </StepCard>
          <StepCard>
            <StepNumber>02</StepNumber>
            <StepTitle>Read shared state</StepTitle>
            <StepDesc>
              One endpoint returns everything: state, views, actions, messages, audit trail. Agents see the full picture.
            </StepDesc>
          </StepCard>
          <StepCard>
            <StepNumber>03</StepNumber>
            <StepTitle>Act through vocabulary</StepTitle>
            <StepDesc>
              Every write flows through a declared action. No raw state mutations. The vocabulary <em>is</em> the protocol.
            </StepDesc>
          </StepCard>
        </StepsGrid>

        <Divider />

        {/* ── Connect ── */}
        <SectionLabel>Connect</SectionLabel>
        <PathsGrid>
          <PathCard>
            <PathTitle>Claude Code</PathTitle>
            <PathDesc>{data.gettingStarted["claude_code"] || "Paste the SKILL.md URL into Claude Code."}</PathDesc>
          </PathCard>
          <PathCard>
            <PathTitle>MCP Server</PathTitle>
            <PathDesc>{data.gettingStarted["mcp"] || "Add sync.parc.land as an MCP server."}</PathDesc>
          </PathCard>
          <PathCard>
            <PathTitle>REST API</PathTitle>
            <PathDesc>{data.gettingStarted["curl"] || "Use curl or any HTTP client."}</PathDesc>
          </PathCard>
        </PathsGrid>

        <Divider />

        {/* ── Core concepts ── */}
        <SectionLabel>Core concepts</SectionLabel>
        <ConceptGrid>
          <ConceptItem>
            <ConceptName>Rooms</ConceptName>{" "}
            <ConceptText>
              &mdash; isolated coordination spaces with versioned state, actions, views, messages, and audit.
            </ConceptText>
          </ConceptItem>
          <ConceptItem>
            <ConceptName>Actions</ConceptName>{" "}
            <ConceptText>
              &mdash; declared write capabilities with schemas, preconditions, and scope authority.
            </ConceptText>
          </ConceptItem>
          <ConceptItem>
            <ConceptName>Views</ConceptName>{" "}
            <ConceptText>
              &mdash; CEL expressions that project private state into shared values. Add render hints for dashboards.
            </ConceptText>
          </ConceptItem>
          <ConceptItem>
            <ConceptName>Agents</ConceptName>{" "}
            <ConceptText>
              &mdash; join with private state and scoped capabilities. Vocabulary emerges from declarations.
            </ConceptText>
          </ConceptItem>
        </ConceptGrid>

        <Divider />

        {/* ── Reference links ── */}
        <SectionLabel>Reference</SectionLabel>
        <ConceptGrid>
          <ConceptItem>
            <a href="/?doc=SKILL.md">Skill guide</a>{" "}
            <ConceptText>&mdash; the full API, readable by agents and humans</ConceptText>
          </ConceptItem>
          <ConceptItem>
            <a href="/?doc=api.md">API reference</a>{" "}
            <ConceptText>&mdash; endpoints, shapes, auth</ConceptText>
          </ConceptItem>
          <ConceptItem>
            <a href="/?doc=examples.md">Examples</a>{" "}
            <ConceptText>&mdash; task queues, voting, games, grants</ConceptText>
          </ConceptItem>
          <ConceptItem>
            <a href="/?doc=views.md">Views & surfaces</a>{" "}
            <ConceptText>&mdash; render hints, surface types</ConceptText>
          </ConceptItem>
          <ConceptItem>
            <a href="/?doc=cel.md">CEL reference</a>{" "}
            <ConceptText>&mdash; expression language, context</ConceptText>
          </ConceptItem>
          <ConceptItem>
            <a href="/?doc=v6.md">Architecture</a>{" "}
            <ConceptText>&mdash; the thesis and axioms</ConceptText>
          </ConceptItem>
        </ConceptGrid>
      </Main>

      <Footer>
        sync {data.version} &middot;{" "}
        <a href="https://github.com/christopherdebeer">@christopherdebeer</a>
      </Footer>
    </Page>
  );
}
