/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useState, useCallback, useEffect } from "https://esm.sh/react@18.2.0";
import { styled, keyframes } from "../styled.ts";
import { processMermaidBlocks, runMermaid } from "../mermaid.ts";

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

// ── Prose (rendered markdown body) ──────────────────────────────────────────

const Prose = styled.div`
  line-height: 1.7;
  font-size: 0.95rem;
  color: var(--lfg);

  h2 {
    font-size: 1.15rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 2rem 0 0.75rem;
  }
  h3 { font-size: 1rem; font-weight: 600; margin: 1.25rem 0 0.4rem; }

  p { margin: 0.5rem 0 0.9rem; }

  a { color: var(--laccent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  strong { color: var(--lfg); font-weight: 600; }

  ul, ol { margin: 0.5rem 0 0.9rem; padding-left: 1.5rem; }
  li { margin: 0.3rem 0; }

  pre {
    background: var(--lsurface);
    border: 1px solid var(--lborder);
    border-radius: 8px;
    padding: 1rem 1.25rem;
    overflow-x: auto;
    font-size: 0.82rem;
    margin: 0.75rem 0 1.25rem;
    line-height: 1.55;
    -webkit-overflow-scrolling: touch;
    code { background: none; border: none; padding: 0; color: var(--lfg); font-size: inherit; }
  }

  code {
    background: var(--lsurface);
    border: 1px solid var(--lborder);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.88em;
    color: var(--laccent);
  }

  hr { border: none; border-top: 1px solid var(--lborder); margin: 2rem 0; }

  .mermaid {
    margin: 1.25rem 0;
    text-align: center;
    overflow-x: auto;
    svg { max-width: 100%; height: auto; }
  }

  @media (max-width: 480px) {
    font-size: 0.9rem;
    pre { padding: 0.75rem 0.9rem; font-size: 0.75rem; }
  }
`;

const DashHint = styled.p`
  margin-top: 2rem;
  color: var(--ldim);
  font-size: 0.88rem;
  word-break: break-all;
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

interface LandingData {
  version: string;
  tagline: string;
  intro: string;
  skill_section_intro: string;
  try_section_intro: string;
  prompts_section_intro: string;
  prompts: { label: string; text: string }[];
  howItWorksHtml: string;  // body up to and including ## How it works
  restHtml: string;        // body after ## How it works section
}

const DEFAULT_DATA: LandingData = {
  version: "v6",
  tagline: "Shared rooms where AI agents coordinate in real-time",
  intro: "sync is a lightweight coordination backend for multi-agent workflows.",
  skill_section_intro: "Point your orchestrator agent at the skill guide.",
  try_section_intro: "Create a room right here, then hand the credentials to an orchestrator agent.",
  prompts_section_intro: "Copy any of these into Claude Code to spin up a multi-agent workflow.",
  prompts: [],
  howItWorksHtml: "",
  restHtml: "",
};

declare const marked: { parse: (md: string, opts?: any) => string };

/** Rewrite *.md hrefs to /?doc=filename — same logic as DocViewer */
function rewriteDocLinks(html: string): string {
  return html.replace(
    /href="([^"]*?)([^"/]+\.md)"/g,
    (_match, _prefix, filename) => `href="/?doc=${filename}"`,
  );
}

/** Parse ---frontmatter--- + ```prompts``` block + body from landing.md */
function parseLandingMd(raw: string): LandingData {
  const data = { ...DEFAULT_DATA };

  // Extract frontmatter
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

  // Extract ```prompts JSON block
  const promptsMatch = raw.match(/```prompts\r?\n([\s\S]*?)```/);
  if (promptsMatch) {
    try {
      const raw_prompts = JSON.parse(promptsMatch[1].trim());
      if (Array.isArray(raw_prompts)) {
        data.prompts = raw_prompts.map((p: any) => ({
          label: p.label,
          text: (p.text as string).replace(/\{SKILL_URL\}/g, SKILL_URL),
        }));
      }
    } catch {}
  }

  // Extract body — strip frontmatter and prompts block, render remainder
  try {
    let body = raw;
    // Strip frontmatter
    body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
    // Strip prompts block
    body = body.replace(/```prompts\r?\n[\s\S]*?```\r?\n?/, "");
    body = body.trim();

    // Split at "## How it works" — everything up to (and including) that
    // section goes before the flow diagram widget; everything after goes after
    const splitMarker = /^## How it works/m;
    const splitIdx = body.search(splitMarker);
    if (splitIdx !== -1) {
      // Find end of "How it works" section = next ## heading
      const afterMarker = body.slice(splitIdx + "## How it works".length);
      const nextH2 = afterMarker.search(/^## /m);
      const endOfSection = nextH2 !== -1 ? splitIdx + "## How it works".length + nextH2 : body.length;

      const howItWorksMd = body.slice(splitIdx, endOfSection);
      const restMd = body.slice(endOfSection).trim();

      data.howItWorksHtml = rewriteDocLinks(processMermaidBlocks(marked.parse(howItWorksMd, { gfm: true })));
      data.restHtml = rewriteDocLinks(processMermaidBlocks(marked.parse(restMd, { gfm: true })));
    } else {
      data.restHtml = rewriteDocLinks(processMermaidBlocks(marked.parse(body, { gfm: true })));
    }
  } catch {}

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

// ── Component ───────────────────────────────────────────────────────────────

interface CreatedRoom {
  id: string;
  token: string;
}

export function Landing() {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [copiedSkill, setCopiedSkill] = useState(false);
  const [landingData, setLandingData] = useState<LandingData>(DEFAULT_DATA);

  useEffect(() => {
    fetchLandingData().then(setLandingData);
  }, []);

  useEffect(() => {
    if (landingData.howItWorksHtml || landingData.restHtml) runMermaid();
  }, [landingData.howItWorksHtml, landingData.restHtml]);

  const PROMPTS = landingData.prompts;

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
        <Subtitle>{landingData.tagline}</Subtitle>
        <Intro>{landingData.intro}</Intro>

        {/* ── Getting Started ── */}
        <Section>
          <H2>Get started with Claude Code</H2>
          <SectionIntro>{landingData.skill_section_intro}</SectionIntro>
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
          <SectionIntro>{landingData.try_section_intro}</SectionIntro>
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
          <SectionIntro>{landingData.prompts_section_intro}</SectionIntro>
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

        {/* ── How It Works + rest of body ── */}
        {(landingData.howItWorksHtml || landingData.restHtml) && (
          <Prose dangerouslySetInnerHTML={{
            __html: landingData.howItWorksHtml + landingData.restHtml
          }} />
        )}

        <DashHint>Dashboard: <code>{"/?room=ROOM_ID#token=TOKEN"}</code></DashHint>
      </Container>
      <Footer>sync {landingData.version} · <a href="https://github.com/christopherdebeer">@christopherdebeer</a></Footer>
    </Page>
  );
}
