/** @jsxImportSource https://esm.sh/react@18.2.0 */
/** Server-side rendering utility.
 *
 * Renders a React component to HTML string with styled-components CSS extraction.
 * Used by route handlers in main.ts / mcp/auth.ts to produce complete HTML pages.
 */
import { renderToString } from "https://esm.sh/react-dom@18.2.0/server";
import { ServerStyleSheet } from "https://esm.sh/styled-components@6?deps=react@18.2.0,react-dom@18.2.0";
import type { ReactElement } from "https://esm.sh/react@18.2.0";
import { shell, type ShellOptions } from "./shell.ts";

export interface RenderPageOptions {
  /** The React element to render */
  element: ReactElement;
  /** Path to the client hydration script (e.g. "/frontend/pages/recover/client.tsx") */
  entry: string;
  /** Props to serialize for client hydration */
  props?: Record<string, unknown>;
  /** Page title */
  title?: string;
  /** Additional <head> scripts (e.g. WebAuthn UMD) */
  headScripts?: string;
  /** HTTP status code (default 200) */
  status?: number;
}

/** Render a React page to a full HTML Response with SSR + styled-components CSS. */
export function renderPage(opts: RenderPageOptions): Response {
  const {
    element,
    entry,
    props = {},
    title,
    headScripts,
    status = 200,
  } = opts;

  let htmlBody: string;
  let css: string;

  const sheet = new ServerStyleSheet();
  try {
    htmlBody = renderToString(sheet.collectStyles(element));
    css = sheet.getStyleTags();
  } catch (err) {
    // Fallback: render without styled-components if SSR fails
    console.error("SSR styled-components error, falling back:", err);
    htmlBody = renderToString(element);
    css = "";
  } finally {
    sheet.seal();
  }

  const fullHtml = shell({
    html: htmlBody,
    css,
    props,
    entry,
    title,
    headScripts,
  });

  return new Response(fullHtml, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}
