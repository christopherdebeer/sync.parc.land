/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** SSR-friendly doc page — receives pre-rendered HTML from the server.
 *  No client-side markdown fetching or parsing needed. */
import { useState, useEffect, useCallback } from "https://esm.sh/react@18.2.0";
import { styled } from "../styled.ts";
import { runMermaid } from "../mermaid.ts";
import { Nav } from "./Nav.tsx";

// ── Styled ──────────────────────────────────────────────────────────────────

const Page = styled.div`
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--bg);
  color: var(--fg);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
`;

const TopBar = styled.div`
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 1.5rem;
  gap: 0.75rem;
  @media (max-width: 480px) {
    padding: 0.5rem 0.75rem;
  }
`;

const BackLink = styled.a`
  color: var(--dim);
  text-decoration: none;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
  &:hover { color: var(--fg); }
`;

const DocTitle = styled.span`
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  @media (max-width: 480px) {
    font-size: 0.82rem;
  }
`;

const Actions = styled.div`
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
`;

const Btn = styled.button`
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--dim);
  font-size: 0.75rem;
  padding: 0.3rem 0.55rem;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  transition: all 0.15s;
  &:hover { color: var(--fg); border-color: var(--dim); }
  @media (max-width: 480px) {
    font-size: 0.72rem;
    padding: 0.3rem 0.45rem;
  }
`;

const Container = styled.div`
  max-width: 780px;
  margin: 0 auto;
  padding: 2rem 1.5rem 3rem;
  flex: 1;
  width: 100%;
  @media (max-width: 480px) {
    padding: 1.25rem 1rem 2rem;
  }
`;

const Prose = styled.div`
  line-height: 1.7;
  font-size: 0.95rem;

  h1 {
    font-size: 1.6rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 2rem 0 0.75rem;
    color: var(--fg);
    &:first-child { margin-top: 0; }
  }
  h2 {
    font-size: 1.2rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 2rem 0 0.6rem;
    color: var(--fg);
    padding-bottom: 0.35rem;
    border-bottom: 1px solid var(--border);
  }
  h3 {
    font-size: 1.02rem;
    font-weight: 600;
    margin: 1.5rem 0 0.4rem;
    color: var(--fg);
  }
  h4 {
    font-size: 0.92rem;
    font-weight: 600;
    margin: 1.25rem 0 0.35rem;
    color: var(--dim);
  }

  p { margin: 0.6rem 0; }

  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  strong { color: var(--fg); font-weight: 600; }
  em { color: var(--dim); }

  ul, ol {
    margin: 0.6rem 0;
    padding-left: 1.5rem;
  }
  li { margin: 0.25rem 0; }

  code {
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    font-size: 0.88em;
    color: var(--accent);
  }

  pre {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem 1.15rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    margin: 1rem 0;
    line-height: 1.5;
    code {
      background: none;
      border: none;
      padding: 0;
      border-radius: 0;
      font-size: 0.85rem;
      color: var(--fg);
    }
  }

  blockquote {
    border-left: 3px solid var(--accent);
    padding: 0.4rem 0 0.4rem 1rem;
    margin: 1rem 0;
    color: var(--dim);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1rem 0;
    font-size: 0.88rem;
    display: block;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  th, td {
    border: 1px solid var(--border);
    padding: 0.45rem 0.7rem;
    text-align: left;
  }
  th {
    background: var(--surface);
    font-weight: 600;
    color: var(--fg);
    white-space: nowrap;
  }
  td { color: var(--dim); }
  td code {
    font-size: 0.82rem;
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
    svg { max-width: 100%; height: auto; }
  }

  img { max-width: 100%; border-radius: 6px; }

  @media (max-width: 480px) {
    font-size: 0.9rem;
    h1 { font-size: 1.35rem; }
    h2 { font-size: 1.1rem; }
    pre { padding: 0.75rem 0.85rem; }
    pre code { font-size: 0.78rem; }
  }
`;

const ErrorMsg = styled.div`
  color: #f85149;
  font-size: 0.9rem;
  padding: 2rem;
  text-align: center;
  a { color: var(--accent); }
`;

// ── DocPage component (SSR-rendered) ────────────────────────────────────────

export interface DocPageProps {
  slug: string;
  title: string;
  html: string;
  rawPath?: string;
}

export function DocPage({ slug, title, html, rawPath }: DocPageProps) {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (html) runMermaid();
  }, [html]);

  const copy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => {});
  }, []);

  const origin = typeof globalThis.location !== "undefined" ? globalThis.location.origin : "";
  const pageUrl = `${origin}/docs/${slug}`;

  return (
    <Page>
      <Nav active="docs" />
      <TopBar>
        <BackLink href="/docs">{"\u2190"} docs</BackLink>
        <DocTitle>{title}</DocTitle>
        <Actions>
          <Btn onClick={() => copy(pageUrl, "url")}>
            {copied === "url" ? "copied \u2713" : "copy URL"}
          </Btn>
          {rawPath && (
            <Btn as="a" href={rawPath} target="_blank" style={{ textDecoration: "none" }}>
              source
            </Btn>
          )}
        </Actions>
      </TopBar>
      <Container>
        <Prose dangerouslySetInnerHTML={{ __html: html }} />
      </Container>
    </Page>
  );
}

// ── DocsIndex component ─────────────────────────────────────────────────────

const IndexContainer = styled.div`
  max-width: 680px;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 3rem;
  width: 100%;
  @media (max-width: 480px) {
    padding: 1.5rem 1rem 2rem;
  }
`;

const IndexTitle = styled.h1`
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--fg);
  margin-bottom: 0.3rem;
`;

const IndexSub = styled.p`
  font-size: 0.88rem;
  color: var(--dim);
  margin-bottom: 2rem;
`;

const SectionLabel = styled.h2`
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--dim);
  margin: 1.8rem 0 0.6rem;
  &:first-of-type { margin-top: 0; }
`;

const DocLink = styled.a`
  display: block;
  padding: 0.5rem 0.7rem;
  margin: 0.15rem 0;
  border-radius: 6px;
  color: var(--fg);
  text-decoration: none;
  font-size: 0.92rem;
  transition: background 0.12s;
  &:hover { background: var(--surface); }
`;

export interface DocsIndexProps {
  docs: Array<{ slug: string; title: string; category: string }>;
}

export function DocsIndex({ docs }: DocsIndexProps) {
  const reference = docs.filter(d => d.category === "reference");
  const essays = docs.filter(d => d.category === "essay");

  return (
    <Page>
      <Nav active="docs" />
      <IndexContainer>
        <IndexTitle>Documentation</IndexTitle>
        <IndexSub>Reference guides and essays on the substrate thesis.</IndexSub>
        <SectionLabel>Reference</SectionLabel>
        {reference.map(d => (
          <DocLink key={d.slug} href={`/docs/${d.slug}`}>{d.title}</DocLink>
        ))}
        <SectionLabel>Essays &amp; Design</SectionLabel>
        {essays.map(d => (
          <DocLink key={d.slug} href={`/docs/${d.slug}`}>{d.title}</DocLink>
        ))}
      </IndexContainer>
    </Page>
  );
}
