/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useState, useEffect, useCallback } from "https://esm.sh/react@18.2.0";
import { styled } from "../styled.ts";
import { processMermaidBlocks, runMermaid } from "../mermaid.ts";

// ── Raw URL mapping ─────────────────────────────────────────────────────────

const DOC_META: Record<string, { title: string; rawPath: string }> = {
  "SKILL.md":    { title: "Orchestrator Skill",  rawPath: "/SKILL.md" },
  "api.md":      { title: "API Reference",        rawPath: "/reference/api.md" },
  "cel.md":      { title: "CEL Reference",        rawPath: "/reference/cel.md" },
  "examples.md": { title: "Examples",             rawPath: "/reference/examples.md" },
  "v6.md":       { title: "Architecture",         rawPath: "/reference/v6.md" },
  "views.md":    { title: "Views Reference",      rawPath: "/reference/views.md" },
  "help.md":     { title: "Help Reference",       rawPath: "/reference/help.md" },
  "landing.md":  { title: "Landing",              rawPath: "/reference/landing.md" },
};

/** Rewrite *.md hrefs in rendered HTML to /?doc=filename so links work
 *  in DocViewer. Strips any path prefix (e.g. reference/api.md → api.md).
 *  Raw links between files at /reference/*.md keep working because the
 *  server serves them at their natural paths — only DocViewer-rendered
 *  links need rewriting. */
function rewriteDocLinks(html: string): string {
  return html.replace(
    /href="([^"]*?)([^"/]+\.md)"/g,
    (_match, _prefix, filename) => `href="/?doc=${filename}"`,
  );
}

// ── Styled ──────────────────────────────────────────────────────────────────

const Page = styled.div`
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--lbg);
  color: var(--lfg);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
`;

const TopBar = styled.div`
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--lsurface);
  border-bottom: 1px solid var(--lborder);
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
  color: var(--ldim);
  text-decoration: none;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
  &:hover { color: var(--lfg); }
`;

const DocTitle = styled.span`
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--lfg);
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
  border: 1px solid var(--lborder);
  border-radius: 5px;
  color: var(--ldim);
  font-size: 0.75rem;
  padding: 0.3rem 0.55rem;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
  transition: all 0.15s;
  &:hover { color: var(--lfg); border-color: var(--ldim); }
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
    color: var(--lfg);
    &:first-child { margin-top: 0; }
  }
  h2 {
    font-size: 1.2rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 2rem 0 0.6rem;
    color: var(--lfg);
    padding-bottom: 0.35rem;
    border-bottom: 1px solid var(--lborder);
  }
  h3 {
    font-size: 1.02rem;
    font-weight: 600;
    margin: 1.5rem 0 0.4rem;
    color: var(--lfg);
  }
  h4 {
    font-size: 0.92rem;
    font-weight: 600;
    margin: 1.25rem 0 0.35rem;
    color: var(--ldim);
  }

  p { margin: 0.6rem 0; }

  a { color: var(--laccent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  strong { color: var(--lfg); font-weight: 600; }
  em { color: var(--ldim); }

  ul, ol {
    margin: 0.6rem 0;
    padding-left: 1.5rem;
  }
  li { margin: 0.25rem 0; }

  code {
    background: var(--lsurface);
    border: 1px solid var(--lborder);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    font-size: 0.88em;
    color: var(--laccent);
  }

  pre {
    background: var(--lsurface);
    border: 1px solid var(--lborder);
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
      color: var(--lfg);
    }
  }

  blockquote {
    border-left: 3px solid var(--laccent);
    padding: 0.4rem 0 0.4rem 1rem;
    margin: 1rem 0;
    color: var(--ldim);
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
    border: 1px solid var(--lborder);
    padding: 0.45rem 0.7rem;
    text-align: left;
  }
  th {
    background: var(--lsurface);
    font-weight: 600;
    color: var(--lfg);
    white-space: nowrap;
  }
  td { color: var(--ldim); }
  td code {
    font-size: 0.82rem;
  }

  hr {
    border: none;
    border-top: 1px solid var(--lborder);
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

const Loading = styled.div`
  color: var(--ldim);
  font-size: 0.9rem;
  padding: 3rem 0;
  text-align: center;
`;

const ErrorMsg = styled.div`
  color: #f85149;
  font-size: 0.9rem;
  padding: 2rem;
  text-align: center;
  a { color: var(--laccent); }
`;

// ── Component ───────────────────────────────────────────────────────────────

declare const marked: { parse: (md: string, opts?: any) => string };

export function DocViewer({ docId }: { docId: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const meta = DOC_META[docId];
  const rawUrl = meta ? `${location.origin}${meta.rawPath}` : null;

  useEffect(() => {
    if (html) runMermaid();
  }, [html]);

  useEffect(() => {
    if (!meta || !rawUrl) {
      setError(`Unknown document: ${docId}`);
      return;
    }
    setHtml(null);
    setError(null);
    fetch(meta.rawPath)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.text();
      })
      .then((md) => {
        const rendered = rewriteDocLinks(processMermaidBlocks(marked.parse(md, { breaks: false, gfm: true })));
        setHtml(rendered);
      })
      .catch((e) => setError(`Failed to load ${docId}: ${e.message}`));
  }, [docId]);

  const copy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    }).catch(() => {});
  }, []);

  if (!meta) {
    return (
      <Page>
        <Container>
          <ErrorMsg>
            Unknown document "{docId}". <a href="/">← Back</a>
          </ErrorMsg>
        </Container>
      </Page>
    );
  }

  return (
    <Page>
      <TopBar>
        <BackLink href="/">← sync</BackLink>
        <DocTitle>{meta.title}</DocTitle>
        <Actions>
          <Btn onClick={() => copy(rawUrl!, "url")}>
            {copied === "url" ? "copied ✓" : "copy URL"}
          </Btn>
          <Btn as="a" href={meta.rawPath} target="_blank" style={{ textDecoration: "none" }}>
            source
          </Btn>
        </Actions>
      </TopBar>
      <Container>
        {error && <ErrorMsg>{error}</ErrorMsg>}
        {!error && !html && <Loading>Loading…</Loading>}
        {html && <Prose dangerouslySetInnerHTML={{ __html: html }} />}
      </Container>
    </Page>
  );
}
