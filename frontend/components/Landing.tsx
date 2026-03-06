/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useCallback, useEffect, useState } from "https://esm.sh/react@18.2.0";
import { keyframes, styled } from "../styled.ts";
import { processMermaidBlocks, runMermaid } from "../mermaid.ts";
import { Nav } from "./Nav.tsx";

// ── Layout ──────────────────────────────────────────────────────────────────

const Page = styled.div`
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.6;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  a {
    color: var(--accent);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
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
  color: var(--dim);
  font-size: 1.15rem;
  margin-bottom: 1.5rem;
  line-height: 1.5;
  max-width: 75%;
  @media (max-width: 480px) {
    font-size: 1.05rem;
    margin-bottom: 1.25rem;
  }
`;

const Intro = styled.p`
  font-size: 1.02rem;
  margin-bottom: 2.5rem;
  color: var(--fg);
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
  color: var(--dim);
  font-size: 0.95rem;
  margin-bottom: 1rem;
  line-height: 1.55;
`;

// ── Tabs ────────────────────────────────────────────────────────────────────

const TabBar = styled.div`
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 0;
`;

const Tab = styled.button<{ $active: boolean }>`
  background: ${({ $active }) => ($active ? "var(--surface)" : "transparent")};
  border: 1px solid ${({ $active }) => ($active ? "var(--border)" : "transparent")};
  border-bottom: ${({ $active }) => ($active ? "1px solid var(--surface)" : "1px solid var(--border)")};
  border-radius: 6px 6px 0 0;
  padding: 0.5rem 1rem;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: ${({ $active }) => ($active ? "600" : "400")};
  color: ${({ $active }) => ($active ? "var(--accent)" : "var(--dim)")};
  transition: color 0.15s;
  margin-bottom: -1px;
  &:hover {
    color: var(--fg);
  }
  @media (max-width: 480px) {
    padding: 0.45rem 0.7rem;
    font-size: 0.8rem;
  }
`;

const TabContent = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 8px 8px;
  padding: 1.1rem 1.25rem;
  font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
  font-size: 0.82rem;
  line-height: 1.65;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
  @media (max-width: 480px) {
    padding: 0.85rem 0.9rem;
    font-size: 0.76rem;
  }
`;

// ── Copy button ─────────────────────────────────────────────────────────────

const CopyBtn = styled.button`
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--dim);
  font-size: 0.78rem;
  padding: 0.3rem 0.6rem;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  transition: all 0.15s;
  &:hover {
    color: var(--fg);
    border-color: var(--dim);
  }
  @media (max-width: 480px) {
    align-self: flex-end;
    padding: 0.4rem 0.8rem;
  }
`;

// ── Prompt cards ────────────────────────────────────────────────────────────

const PromptCard = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1rem 1.25rem;
  margin-bottom: 0.75rem;
  cursor: pointer;
  transition: border-color 0.15s;
  &:hover {
    border-color: var(--accent);
  }
  @media (max-width: 480px) {
    padding: 0.85rem 1rem;
  }
`;

const PromptLabel = styled.div`
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--accent);
  margin-bottom: 0.35rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
`;

const PromptText = styled.div`
  font-size: 0.9rem;
  color: var(--fg);
  line-height: 1.5;
  @media (max-width: 480px) {
    font-size: 0.85rem;
    line-height: 1.55;
  }
`;

const CopiedTag = styled.span`
  font-size: 0.72rem;
  color: var(--dim);
  font-weight: 400;
  white-space: nowrap;
`;

// ── Prose (rendered markdown body) ──────────────────────────────────────────

const Prose = styled.div`
  line-height: 1.7;
  font-size: 0.95rem;
  color: var(--fg);

  h2 {
    font-size: 1.15rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 2rem 0 0.75rem;
  }
  h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 1.25rem 0 0.4rem;
  }

  p {
    margin: 0.5rem 0 0.9rem;
  }

  a {
    color: var(--accent);
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }

  strong {
    color: var(--fg);
    font-weight: 600;
  }

  ul, ol {
    margin: 0.5rem 0 0.9rem;
    padding-left: 1.5rem;
  }
  li {
    margin: 0.3rem 0;
  }

  pre {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem 1.25rem;
    overflow-x: auto;
    font-size: 0.82rem;
    margin: 0.75rem 0 1.25rem;
    line-height: 1.55;
    -webkit-overflow-scrolling: touch;
    code {
      background: none;
      border: none;
      padding: 0;
      color: var(--fg);
      font-size: inherit;
    }
  }

  code {
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.88em;
    color: var(--accent);
  }

  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 2rem 0;
  }

  .mermaid {
    margin: 1.25rem 0;
    text-align: center;
    overflow-x: auto;
    svg {
      max-width: 100%;
      height: auto;
    }
  }

  @media (max-width: 480px) {
    font-size: 0.9rem;
    pre {
      padding: 0.75rem 0.9rem;
      font-size: 0.75rem;
    }
  }
`;

const Footer = styled.footer`
  text-align: center;
  padding: 2rem;
  color: var(--dim);
  font-size: 0.8rem;
  border-top: 1px solid var(--border);
`;

// ── Create Room ─────────────────────────────────────────────────────────────

const CreateBox = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
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
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.55rem 0.8rem;
  color: var(--fg);
  font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
  font-size: 0.85rem;
  outline: none;
  &:focus {
    border-color: var(--accent);
  }
  &::placeholder {
    color: var(--dim);
    opacity: 0.6;
  }
`;

const CreateBtn = styled.button`
  background: var(--accent);
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
  &:hover {
    opacity: 0.88;
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const CreateError = styled.div`
  color: #e5534b;
  font-size: 0.82rem;
  margin-top: 0.5rem;
`;

const ResultBox = styled.div`
  margin-top: 1rem;
  padding: 1rem 1.1rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
`;

const ResultLabel = styled.div`
  font-size: 0.75rem;
  color: var(--dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.3rem;
  margin-top: 0.75rem;
  &:first-child {
    margin-top: 0;
  }
`;

const ResultValue = styled.div`
  font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
  font-size: 0.82rem;
  color: var(--accent);
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
  color: var(--accent);
  font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
  font-size: 0.82rem;
  word-break: break-all;
`;

const PromptBlock = styled.div`
  margin-top: 0.75rem;
  padding: 0.85rem 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.85rem;
  line-height: 1.55;
  color: var(--fg);
  cursor: pointer;
  transition: border-color 0.15s;
  &:hover {
    border-color: var(--accent);
  }
`;

const PromptBlockLabel = styled.div`
  font-size: 0.72rem;
  color: var(--dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 0.4rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const Lockup = styled.div`
  display: flex;
  gap: 2em;
  align-items: center;
  margin-bottom: 2em;
`;

const ManageLink = styled.p`
  margin-top: 0.75rem;
  color: var(--dim);
  font-size: 0.88rem;
  a {
    color: var(--accent);
  }
`;

// ── Data ────────────────────────────────────────────────────────────────────

const SKILL_URL = "https://sync.parc.land/SKILL.md";
const BASE = globalThis.location?.origin || "https://sync.parc.land";

const TAB_KEYS = ["curl", "claude_code", "mcp"] as const;
const TAB_LABELS: Record<string, string> = {
  curl: "curl / REST",
  claude_code: "Claude Code",
  mcp: "MCP",
};

interface LandingData {
  version: string;
  tagline: string;
  intro: string;
  prompts: { label: string; text: string }[];
  gettingStarted: Record<string, string>;
  bodyHtml: string;
}

const DEFAULT_DATA: LandingData = {
  version: "v6",
  tagline: "Shared rooms where AI agents coordinate through state, not messages",
  intro: "sync is a coordination substrate for multi-agent systems.",
  prompts: [],
  gettingStarted: {},
  bodyHtml: "",
};

declare const marked: { parse: (md: string, opts?: any) => string };

/** Rewrite *.md hrefs to /?doc=filename — same logic as DocViewer */
function rewriteDocLinks(html: string): string {
  return html.replace(
    /href="([^"]*?)([^"/]+\.md)"/g,
    (_match, _prefix, filename) => `href="/?doc=${filename}"`,
  );
}

/** Parse ---frontmatter--- + ```getting_started``` + ```prompts``` + body from landing.md */
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

  // Extract ```getting_started JSON block
  const gsMatch = raw.match(/```getting_started\r?\n([\s\S]*?)```/);
  if (gsMatch) {
    try {
      const parsed = JSON.parse(gsMatch[1].trim());
      if (typeof parsed === "object" && parsed !== null) {
        data.gettingStarted = parsed;
      }
    } catch {}
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

  // Extract body — strip frontmatter and fenced blocks, render remainder
  try {
    let body = raw;
    body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
    body = body.replace(/```getting_started\r?\n[\s\S]*?```\r?\n?/, "");
    body = body.replace(/```prompts\r?\n[\s\S]*?```\r?\n?/, "");
    body = body.trim();

    if (body) {
      data.bodyHtml = rewriteDocLinks(
        processMermaidBlocks(marked.parse(body, { gfm: true })),
      );
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
  const [landingData, setLandingData] = useState<LandingData>(DEFAULT_DATA);
  const [activeTab, setActiveTab] = useState<string>("curl");

  useEffect(() => {
    fetchLandingData().then(setLandingData);
  }, []);

  useEffect(() => {
    if (landingData.bodyHtml) runMermaid();
  }, [landingData.bodyHtml]);

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
        setCreateError(
          d.error === "room_exists"
            ? `Room "${trimmed}" already exists. Try a different name.`
            : d.error || "Failed to create room",
        );
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
      <Nav active="home" />
      <Container>
        {/* ── 1. Hero ── */}
        <Lockup>
          <img src={"/static/favicon.svg"} style={{ height: "7em" }} />
          <div>
            <H1>/sync</H1>
            <Subtitle>{landingData.tagline}</Subtitle>
          </div>
        </Lockup>
        <Intro>{landingData.intro}</Intro>

        {/* ── 2. Getting Started (tabs) ── */}
        <Section>
          <H2>Getting started</H2>
          {Object.keys(landingData.gettingStarted).length > 0 && (
            <>
              <TabBar>
                {TAB_KEYS.map((k) =>
                  landingData.gettingStarted[k] ? (
                    <Tab
                      key={k}
                      $active={activeTab === k}
                      onClick={() => setActiveTab(k)}
                    >
                      {TAB_LABELS[k] || k}
                    </Tab>
                  ) : null,
                )}
              </TabBar>
              <TabContent>
                {landingData.gettingStarted[activeTab] || ""}
              </TabContent>
            </>
          )}
        </Section>

        {/* ── 3. Body prose (How it works, Core concepts, API, Reference, Writing) ── */}
        {landingData.bodyHtml && (
          <Prose
            dangerouslySetInnerHTML={{ __html: landingData.bodyHtml }}
          />
        )}

        {/* ── 4. Try it — create a room ── */}
        <Section>
          <H2>Try it — create a room</H2>
          <SectionIntro>
            Create a room right here, then hand the credentials to an agent.
          </SectionIntro>
          <CreateBox>
            {!created
              ? (
                <>
                  <CreateRow>
                    <RoomInput
                      type="text"
                      placeholder="room name (optional, auto-generated if blank)"
                      value={roomIdInput}
                      onChange={(e) => setRoomIdInput(e.target.value)}
                      onKeyDown={(e) =>
                        e.key === "Enter" && !creating && createRoom()}
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <CreateBtn onClick={createRoom} disabled={creating}>
                      {creating ? "creating\u2026" : "Create room"}
                    </CreateBtn>
                  </CreateRow>
                  {createError && <CreateError>{createError}</CreateError>}
                </>
              )
              : (
                <ResultBox>
                  <ResultLabel>Dashboard</ResultLabel>
                  <ResultLink href={dashboardUrl} target="_blank">
                    {dashboardUrl}
                  </ResultLink>

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

                  <PromptBlock
                    onClick={() => copyField(orchestratorPrompt, "prompt")}
                  >
                    <PromptBlockLabel>
                      Orchestrator prompt — paste into Claude Code
                      <CopiedTag>
                        {copiedField === "prompt" ? "copied" : "tap to copy"}
                      </CopiedTag>
                    </PromptBlockLabel>
                    <span style={{ whiteSpace: "pre-wrap" }}>
                      {orchestratorPrompt}
                    </span>
                  </PromptBlock>

                  <div style={{ marginTop: "0.75rem" }}>
                    <CopyBtn
                      onClick={() => {
                        setCreated(null);
                        setRoomIdInput("");
                      }}
                    >
                      create another
                    </CopyBtn>
                  </div>
                </ResultBox>
              )}
          </CreateBox>
          <ManageLink>
            For MCP setup, passkeys, and token management: <a href="/manage">/manage</a>
          </ManageLink>
        </Section>

        {/* ── 5. Example prompts ── */}
        {PROMPTS.length > 0 && (
          <Section>
            <H2>Example prompts</H2>
            <SectionIntro>
              Copy any of these into Claude Code to spin up a multi-agent workflow.
            </SectionIntro>
            {PROMPTS.map((p, i) => (
              <PromptCard
                key={i}
                onClick={() => copyText(p.text, i)}
              >
                <PromptLabel>
                  {p.label}
                  <CopiedTag>
                    {copiedIdx === i ? "copied" : "tap to copy"}
                  </CopiedTag>
                </PromptLabel>
                <PromptText>{p.text}</PromptText>
              </PromptCard>
            ))}
          </Section>
        )}
      </Container>
      <Footer>
        sync {landingData.version} ·{" "}
        <a href="https://github.com/christopherdebeer">@christopherdebeer</a>
      </Footer>
    </Page>
  );
}
