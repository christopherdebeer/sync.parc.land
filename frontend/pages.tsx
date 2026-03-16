/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Page renderers for main.ts — SSR each page to a Response. */
import { renderPage } from "./ssr.ts";
import { Landing, parseLandingMd } from "./components/Landing.tsx";
import { Dashboard } from "./components/Dashboard.tsx";
import { DocPage, DocsIndex } from "./components/DocViewer.tsx";
import { Overview } from "./components/Overview.tsx";
import { mdToHtml } from "./markdown.ts";

// Derive ESM base URL from import.meta.url — branch-aware on val.town
// e.g. https://esm.town/v/c15r/sync@153-v8/frontend/pages.tsx → https://esm.town/v/c15r/sync@153-v8
const ESM_BASE = (() => {
  const u = import.meta.url;
  // Strip /frontend/pages.tsx (or similar trailing path)
  const match = u.match(/^(https:\/\/esm\.town\/v\/[^/]+\/[^/]+)/);
  return match ? match[1] : "https://esm.town/v/c15r/sync";
})();

const LANDING_MD_URL = new URL("../reference/landing.md", import.meta.url);
const LANDING_RAW = await fetch(LANDING_MD_URL).then(r => r.text()).catch(() => "");

export function renderLandingPage(): Response {
  const data = parseLandingMd(LANDING_RAW, mdToHtml);
  return renderPage({
    element: <Landing data={data} />,
    entry: `${ESM_BASE}/frontend/pages/landing/client.tsx`,
    props: { data },
    title: "sync — Multi-Agent Coordination for AI Workflows",
  });
}

export function renderDashboardPage(roomId: string): Response {
  return renderPage({
    element: <Dashboard roomId={roomId} />,
    entry: `${ESM_BASE}/frontend/pages/dashboard/client.tsx`,
    props: { roomId },
    title: `${roomId} — sync dashboard`,
    // v8: Load marked.js for prose rendering and mermaid.js for diagram rendering.
    // Surfaces.tsx renderMarkdown() checks for globalThis.marked — this makes it work.
    headScripts: `<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/15.0.7/marked.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.4.1/mermaid.min.js"></script><script>if(typeof mermaid!=='undefined')mermaid.initialize({startOnLoad:false,theme:'dark',themeVariables:{primaryColor:'#161b22',primaryBorderColor:'#30363d',primaryTextColor:'#c9d1d9',lineColor:'#484f58',secondaryColor:'#1c2129',tertiaryColor:'#21262d'}});</script>`,
  });
}

/** Render a single doc page — markdown is already converted to HTML server-side. */
export function renderDocPage(slug: string, title: string, html: string, rawPath?: string): Response {
  return renderPage({
    element: <DocPage slug={slug} title={title} html={html} rawPath={rawPath} />,
    entry: `${ESM_BASE}/frontend/pages/docs/client.tsx`,
    props: { slug, title, html, rawPath },
    title: `${title} — sync docs`,
  });
}

/** Render the docs index page listing all available docs. */
export function renderDocsIndex(docs: Array<{ slug: string; title: string; category: string }>): Response {
  return renderPage({
    element: <DocsIndex docs={docs} />,
    entry: `${ESM_BASE}/frontend/pages/docs/client.tsx`,
    props: { docs },
    title: "Documentation — sync",
  });
}

/** Render the overview / vision & architecture page. */
export function renderOverviewPage(): Response {
  return renderPage({
    element: <Overview />,
    entry: `${ESM_BASE}/frontend/pages/overview/client.tsx`,
    props: {},
    title: "Vision & Architecture — sync",
    headScripts: `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,600;1,6..72,400&family=Playfair+Display:ital@1&display=swap" rel="stylesheet">`,
  });
}
