/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Page renderers for main.ts — SSR each page to a Response.
 *
 * main.ts calls these instead of serving the SPA shell.
 * Each function returns a complete HTML Response with SSR + hydration.
 */
import { renderPage } from "./ssr.ts";
import { Landing } from "./components/Landing.tsx";
import { Dashboard } from "./components/Dashboard.tsx";
import { DocViewer } from "./components/DocViewer.tsx";

const MARKED_SCRIPT = '<script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"></script>';

export function renderLandingPage(): Response {
  return renderPage({
    element: <Landing />,
    entry: "/frontend/pages/landing/client.tsx",
    title: "sync — Multi-Agent Coordination for AI Workflows",
    headScripts: MARKED_SCRIPT,
  });
}

export function renderDashboardPage(roomId: string): Response {
  return renderPage({
    element: <Dashboard roomId={roomId} />,
    entry: "/frontend/pages/dashboard/client.tsx",
    props: { roomId },
    title: `${roomId} — sync dashboard`,
  });
}

export function renderDocPage(docId: string): Response {
  return renderPage({
    element: <DocViewer docId={docId} />,
    entry: "/frontend/pages/docs/client.tsx",
    props: { docId },
    title: `${docId} — sync docs`,
    headScripts: MARKED_SCRIPT,
  });
}
