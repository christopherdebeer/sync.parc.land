/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Page renderers for main.ts — SSR each page to a Response. */
import { renderPage } from "./ssr.ts";
import { Landing, parseLandingMd } from "./components/Landing.tsx";
import { Dashboard } from "./components/Dashboard.tsx";
import { DocPage, DocsIndex } from "./components/DocViewer.tsx";
import { mdToHtml } from "./markdown.ts";

const LANDING_MD_URL = new URL("../reference/landing.md", import.meta.url);
const LANDING_RAW = await fetch(LANDING_MD_URL).then(r => r.text()).catch(() => "");

export function renderLandingPage(): Response {
  const data = parseLandingMd(LANDING_RAW, mdToHtml);
  return renderPage({
    element: <Landing data={data} />,
    entry: "https://esm.town/v/c15r/sync/frontend/pages/landing/client.tsx",
    props: { data },
    title: "sync — Multi-Agent Coordination for AI Workflows",
  });
}

export function renderDashboardPage(roomId: string): Response {
  return renderPage({
    element: <Dashboard roomId={roomId} />,
    entry: "https://esm.town/v/c15r/sync/frontend/pages/dashboard/client.tsx",
    props: { roomId },
    title: `${roomId} — sync dashboard`,
  });
}

/** Render a single doc page — markdown is already converted to HTML server-side. */
export function renderDocPage(slug: string, title: string, html: string, rawPath?: string): Response {
  return renderPage({
    element: <DocPage slug={slug} title={title} html={html} rawPath={rawPath} />,
    entry: "https://esm.town/v/c15r/sync/frontend/pages/docs/client.tsx",
    props: { slug, title, html, rawPath },
    title: `${title} — sync docs`,
  });
}

/** Render the docs index page listing all available docs. */
export function renderDocsIndex(docs: Array<{ slug: string; title: string; category: string }>): Response {
  return renderPage({
    element: <DocsIndex docs={docs} />,
    entry: "https://esm.town/v/c15r/sync/frontend/pages/docs/client.tsx",
    props: { docs },
    title: "Documentation — sync",
  });
}
