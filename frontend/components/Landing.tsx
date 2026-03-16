/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useEffect, useState } from "https://esm.sh/react@18.2.0";
import { styled } from "../styled.ts";
import { runMermaid } from "../mermaid.ts";
import { Nav } from "./Nav.tsx";
import { Logo } from "./Logo.tsx";
import { ReplayWidget } from "./Replay.tsx";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DemoEntry {
  id: string;
  label: string;
  room: string;
  token: string;
  description?: string;
}

export interface LandingData {
  version: string;
  tagline: string;
  intro: string;
  demo_room: string;
  demo_token: string;
  demos: DemoEntry[];
  /** Pre-rendered HTML body (server-side via npm:marked) */
  bodyHtml: string;
  /** Pre-rendered HTML for each getting_started tab */
  tabHtml: Record<string, string>;
  /** Raw tab keys present (for tab bar rendering) */
  tabKeys: string[];
  prompts: { label: string; text: string }[];
}

export const DEFAULT_DATA: LandingData = {
  version: "v6",
  tagline: "Shared rooms where AI agents coordinate through state, not messages",
  intro: "sync is a coordination substrate for multi-agent systems.",
  demo_room: "",
  demo_token: "",
  demos: [],
  bodyHtml: "",
  tabHtml: {},
  tabKeys: [],
  prompts: [],
};

const SKILL_URL = "https://sync.parc.land/SKILL.md";

/**
 * Parse landing.md → LandingData.
 * Pass a `renderMd` function to produce HTML. Safe to call server-side.
 *
 * IMPORTANT: Fenced-block regexes anchor the closing ``` to start-of-line
 * (\n```) so that backticks embedded inside JSON string values (e.g. the
 * curl tab's ```bash code block) don't short-circuit the match.
 */
export function parseLandingMd(raw: string, renderMd: (md: string) => string): LandingData {
  const data = { ...DEFAULT_DATA };

  // Frontmatter
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    for (const line of fmMatch[1].split("\n")) {
      const colon = line.indexOf(":");
      if (colon < 1) continue;
      const key = line.slice(0, colon).trim();
      const val = line.slice(colon + 1).trim();
      if (key === "version") data.version = val;
      else if (key === "tagline") data.tagline = val;
      else if (key === "intro") data.intro = val;
      else if (key === "demo_room") data.demo_room = val;
      else if (key === "demo_token") data.demo_token = val;
    }
  }

  // ```getting_started JSON block
  // Closing fence must be at start of line to avoid matching backticks inside JSON strings
  const gsMatch = raw.match(/```getting_started\r?\n([\s\S]*?)\n```/);
  let gettingStarted: Record<string, string> = {};
  if (gsMatch) {
    try {
      const parsed = JSON.parse(gsMatch[1].trim());
      if (typeof parsed === "object" && parsed !== null) gettingStarted = parsed;
    } catch {}
  }

  // ```prompts JSON block
  const promptsMatch = raw.match(/```prompts\r?\n([\s\S]*?)\n```/);
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

  // ```demos JSON block — array of { id, label, room, token, description? }
  const demosMatch = raw.match(/```demos\r?\n([\s\S]*?)\n```/);
  if (demosMatch) {
    try {
      const raw_demos = JSON.parse(demosMatch[1].trim());
      if (Array.isArray(raw_demos)) {
        data.demos = raw_demos.filter((d: any) => d.room && d.token).map((d: any) => ({
          id: d.id || d.room,
          label: d.label || d.room,
          room: d.room,
          token: d.token,
          description: d.description,
        }));
      }
    } catch {}
  }

  // Backward compat: if no demos block but demo_room/demo_token exist, synthesize single entry
  if (data.demos.length === 0 && data.demo_room && data.demo_token) {
    data.demos = [{ id: data.demo_room, label: data.demo_room, room: data.demo_room, token: data.demo_token }];
  }

  // Body markdown — strip frontmatter + fenced blocks, render
  let body = raw;
  body = body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  body = body.replace(/```getting_started\r?\n[\s\S]*?\n```\r?\n?/g, "");
  body = body.replace(/```prompts\r?\n[\s\S]*?\n```\r?\n?/g, "");
  body = body.replace(/```demos\r?\n[\s\S]*?\n```\r?\n?/g, "");
  body = body.trim();
  data.bodyHtml = body ? renderMd(body) : "";

  // Render tab content
  const TAB_KEYS = ["mcp", "claude_code", "curl"];
  data.tabKeys = TAB_KEYS.filter(k => gettingStarted[k]);
  data.tabHtml = {};
  for (const k of data.tabKeys) {
    data.tabHtml[k] = renderMd(gettingStarted[k]);
  }

  return data;
}

// ── Styles ────────────────────────────────────────────────────────────────────

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

const Container = styled.div`
  max-width: 680px;
  margin: 0 auto;
  padding: 3.5rem 1.5rem 2rem;
  flex: 1;
  @media (max-width: 480px) { padding: 2rem 1rem 1.5rem; }
`;

const Lockup = styled.div`
  display: flex;
  gap: 2em;
  align-items: center;
  margin-bottom: 2em;
`;

const H1 = styled.h1`
  font-size: 2.2rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: 0.35rem;
  @media (max-width: 480px) { font-size: 1.75rem; }
`;

const Tagline = styled.p`
  color: var(--dim);
  font-size: 1.15rem;
  line-height: 1.5;
  max-width: 75%;
  @media (max-width: 480px) { font-size: 1.05rem; max-width: 100%; }
`;

const Intro = styled.p`
  font-size: 1.02rem;
  margin-bottom: 2.5rem;
  color: var(--fg);
  line-height: 1.7;
  @media (max-width: 480px) { font-size: 0.95rem; margin-bottom: 2rem; }
`;

const Section = styled.section`
  margin-bottom: 2.5rem;
  @media (max-width: 480px) { margin-bottom: 2rem; }
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

const Prose = styled.div`
  line-height: 1.7;
  font-size: 0.95rem;
  color: var(--fg);
  margin-bottom: 2.5rem;
  h2 { font-size: 1.15rem; font-weight: 600; letter-spacing: -0.01em; margin: 2rem 0 0.75rem; }
  h3 { font-size: 1rem; font-weight: 600; margin: 1.25rem 0 0.4rem; }
  p { margin: 0.5rem 0 0.9rem; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  strong { color: var(--fg); font-weight: 600; }
  ul, ol { margin: 0.5rem 0 0.9rem; padding-left: 1.5rem; }
  li { margin: 0.3rem 0; }
  pre {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 1rem 1.25rem; overflow-x: auto; font-size: 0.82rem;
    margin: 0.75rem 0 1.25rem; line-height: 1.55;
    code { background: none; border: none; padding: 0; color: var(--fg); font-size: inherit; }
  }
  code {
    background: var(--surface); border: 1px solid var(--border);
    padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.88em; color: var(--accent);
  }
  hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
  .mermaid { margin: 1.25rem 0; text-align: center; overflow-x: auto; svg { max-width: 100%; height: auto; } }
  @media (max-width: 480px) { font-size: 0.9rem; pre { padding: 0.75rem 0.9rem; font-size: 0.75rem; } }
`;

const ReplayPlaceholder = styled.div`
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  height: 340px; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 0.5rem; color: var(--dim); font-size: 0.88rem;
`;

const ReplayLabel = styled.div`
  font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--dim); opacity: 0.5;
`;

const DemoSelector = styled.div`
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.65rem;
  flex-wrap: wrap;
`;

const DemoPill = styled.button<{ $active: boolean }>`
  background: ${p => p.$active ? "rgba(88,166,255,0.12)" : "transparent"};
  border: 1px solid ${p => p.$active ? "var(--accent)" : "var(--border)"};
  border-radius: 100px;
  padding: 0.3rem 0.75rem;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: ${p => p.$active ? "600" : "400"};
  color: ${p => p.$active ? "var(--accent)" : "var(--dim)"};
  transition: all 0.15s;
  white-space: nowrap;
  line-height: 1.3;
  &:hover { color: var(--fg); border-color: var(--dim); }
  @media (max-width: 480px) { padding: 0.25rem 0.6rem; font-size: 0.72rem; }
`;

const TabBar = styled.div`
  display: flex; border-bottom: 1px solid var(--border);
`;

const Tab = styled.button<{ $active: boolean }>`
  background: ${p => p.$active ? "var(--surface)" : "transparent"};
  border: 1px solid ${p => p.$active ? "var(--border)" : "transparent"};
  border-bottom: ${p => p.$active ? "1px solid var(--surface)" : "1px solid var(--border)"};
  border-radius: 6px 6px 0 0;
  padding: 0.5rem 1rem; cursor: pointer; font-family: inherit; font-size: 0.85rem;
  font-weight: ${p => p.$active ? "600" : "400"};
  color: ${p => p.$active ? "var(--accent)" : "var(--dim)"};
  transition: color 0.15s; margin-bottom: -1px;
  &:hover { color: var(--fg); }
  @media (max-width: 480px) { padding: 0.45rem 0.7rem; font-size: 0.8rem; }
`;

const TabProse = styled.div`
  background: var(--surface); border: 1px solid var(--border); border-top: none;
  border-radius: 0 0 8px 8px; padding: 1.25rem 1.4rem; font-size: 0.9rem;
  line-height: 1.65; color: var(--fg);
  h3 { font-size: 0.95rem; font-weight: 600; margin: 0 0 0.65rem; letter-spacing: -0.01em; }
  p { margin: 0 0 0.75rem; color: var(--dim); }
  a { color: var(--accent); } a:hover { text-decoration: underline; }
  pre {
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 0.85rem 1rem; overflow-x: auto;
    font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
    font-size: 0.8rem; line-height: 1.6; margin: 0.5rem 0 0.75rem;
    code { background: none; border: none; padding: 0; font-size: inherit; color: var(--fg); }
  }
  code {
    background: var(--bg); border: 1px solid var(--border); padding: 0.1em 0.35em;
    border-radius: 3px; font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
    font-size: 0.85em; color: var(--accent);
  }
  @media (max-width: 480px) { padding: 1rem; font-size: 0.85rem; pre { font-size: 0.75rem; } }
`;

const ApiTable = styled.table`
  width: 100%; border-collapse: collapse;
  font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace; font-size: 0.82rem;
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
  tr { border-bottom: 1px solid var(--border); &:last-child { border-bottom: none; } }
  td { padding: 0.55rem 0.9rem; vertical-align: top; }
  @media (max-width: 480px) { font-size: 0.75rem; td { padding: 0.45rem 0.65rem; } }
`;
const ApiMethod = styled.td`color: var(--accent); white-space: nowrap; font-weight: 600; width: 3.5rem;`;
const ApiPath = styled.td`color: var(--fg); white-space: nowrap; @media (max-width: 480px) { white-space: normal; word-break: break-all; }`;
const ApiDesc = styled.td`color: var(--dim);`;

const RefGrid = styled.div`
  display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2.5rem;
  @media (max-width: 560px) { grid-template-columns: 1fr; gap: 1.5rem; }
`;
const RefCol = styled.div``;
const RefList = styled.ul`list-style: none; margin: 0; padding: 0;`;
const RefItem = styled.li`
  margin-bottom: 0.75rem;
  a { color: var(--accent); font-size: 0.9rem; font-weight: 500; text-decoration: none; &:hover { text-decoration: underline; } }
`;
const RefItemDesc = styled.div`font-size: 0.82rem; color: var(--dim); line-height: 1.4; margin-top: 0.1rem;`;

const Footer = styled.footer`
  text-align: center; padding: 2rem; color: var(--dim); font-size: 0.8rem;
  border-top: 1px solid var(--border);
`;

// ── Tab labels ────────────────────────────────────────────────────────────────

const TAB_LABELS: Record<string, string> = { mcp: "MCP", claude_code: "Claude Code", curl: "curl / REST" };

// ── Component ─────────────────────────────────────────────────────────────────

interface LandingProps {
  data?: LandingData;
}

export function Landing({ data = DEFAULT_DATA }: LandingProps) {
  const [activeTab, setActiveTab] = useState(data.tabKeys[0] ?? "mcp");
  const [activeDemo, setActiveDemo] = useState(0);

  const demos = data.demos;
  const currentDemo = demos[activeDemo] ?? null;

  // Run mermaid once on mount if bodyHtml has mermaid blocks
  useEffect(() => {
    if (data.bodyHtml?.includes('class="mermaid"')) runMermaid();
  }, []);

  return (
    <Page>
      <Nav active="home" />
      <Container>

        {/* 1. Hero */}
        <Lockup>
          <Logo size="7em" />
          <div>
            <H1>/sync</H1>
            <Tagline>{data.tagline}</Tagline>
          </div>
        </Lockup>
        <Intro>{data.intro}</Intro>

        {/* 2. How it works */}
        {data.bodyHtml && (
          <Prose dangerouslySetInnerHTML={{ __html: data.bodyHtml }} />
        )}

        {/* 3. Replay widget */}
        <Section>
          <H2>See it in action</H2>
          <SectionIntro>A recorded run of a real room, replayed live from the audit log.</SectionIntro>
          {demos.length > 1 && (
            <DemoSelector>
              {demos.map((d, i) => (
                <DemoPill key={d.id} $active={activeDemo === i} onClick={() => setActiveDemo(i)}>
                  {d.label}
                </DemoPill>
              ))}
            </DemoSelector>
          )}
          {currentDemo
            ? <ReplayWidget key={currentDemo.id} roomId={currentDemo.room} viewToken={currentDemo.token} height={420} />
            : <ReplayPlaceholder>
                <ReplayLabel>replay widget</ReplayLabel>
                <span style={{ opacity: 0.4, fontSize: "0.8rem" }}>configure demos in landing.md</span>
              </ReplayPlaceholder>
          }
        </Section>

        {/* 4. Getting started */}
        {data.tabKeys.length > 0 && (
          <Section>
            <H2>Getting started</H2>
            <TabBar>
              {data.tabKeys.map(k => (
                <Tab key={k} $active={activeTab === k} onClick={() => setActiveTab(k)}>
                  {TAB_LABELS[k] ?? k}
                </Tab>
              ))}
            </TabBar>
            <TabProse dangerouslySetInnerHTML={{ __html: data.tabHtml[activeTab] ?? "" }} />
          </Section>
        )}

        {/* 5. API surface */}
        <Section>
          <H2>API surface</H2>
          <SectionIntro>Five endpoints. One write path. Every invocation audited.</SectionIntro>
          <ApiTable><tbody>
            {([
              ["POST", "/rooms", "create a room"],
              ["POST", "/rooms/:id/agents", "join as an agent"],
              ["GET",  "/rooms/:id/context", "read everything"],
              ["POST", "/rooms/:id/actions/:id/invoke", "invoke an action"],
              ["GET",  "/rooms/:id/wait?condition=", "block until a CEL condition is true"],
            ] as [string,string,string][]).map(([m,p,d]) => (
              <tr key={p}><ApiMethod>{m}</ApiMethod><ApiPath>{p}</ApiPath><ApiDesc>{d}</ApiDesc></tr>
            ))}
          </tbody></ApiTable>
        </Section>

        {/* 6. Reference + Writing */}
        <RefGrid>
          <RefCol>
            <H2>Reference</H2>
            <RefList>
              {([
                ["SKILL.md", "SKILL.md", "Full API skill — readable by agents and humans"],
                ["api.md", "API reference", "Endpoints, request/response shapes"],
                ["cel.md", "CEL reference", "Expression language and context"],
                ["views.md", "Views reference", "Render hints, surface types, dashboard"],
                ["examples.md", "Examples", "Task queues, games, grants, views"],
                ["v6.md", "Architecture", "The thesis, axioms, and why v6 works this way"],
                ["help.md", "Help reference", "Standard library, proof-of-read versioning"],
              ] as [string,string,string][]).map(([doc,label,desc]) => (
                <RefItem key={doc}>
                  <a href={`/?doc=${doc}`}>{label}</a>
                  <RefItemDesc>{desc}</RefItemDesc>
                </RefItem>
              ))}
            </RefList>
          </RefCol>
          <RefCol>
            <H2>Writing</H2>
            <RefList>
              {([
                ["what-becomes-true.md", "What Becomes True", "Tools → games → substrate → v6. Start here."],
                ["introducing-sync.md", "Introducing Sync", "Games, five decades of research, and the architecture they converge on"],
                ["the-substrate-thesis.md", "The Substrate Thesis", "Full argument: ctxl + sync + playtest"],
                ["isnt-this-just-react.md", "Isn't This Just ReAct?", "Stigmergy and positioning against the field"],
                ["the-pressure-field.md", "The Pressure Field", "13 intellectual lineages mapped"],
                ["sigma-calculus.md", "Σ-calculus", "Minimal algebra for substrate systems"],
                ["surfaces-design.md", "Surfaces as Substrate", "7 design principles for composable experiences"],
              ] as [string,string,string][]).map(([doc,label,desc]) => (
                <RefItem key={doc}>
                  <a href={`/?doc=${doc}`}>{label}</a>
                  <RefItemDesc>{desc}</RefItemDesc>
                </RefItem>
              ))}
            </RefList>
          </RefCol>
        </RefGrid>

      </Container>
      <Footer>
        sync {data.version} · <a href="https://github.com/christopherdebeer">@christopherdebeer</a>
      </Footer>
    </Page>
  );
}
