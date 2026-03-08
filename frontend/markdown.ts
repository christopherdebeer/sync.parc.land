/**
 * Shared markdown → HTML utility. Works in both Deno (server-side) and browser.
 *
 * Uses npm:marked so it can be imported at the top level in pages.tsx for SSR,
 * eliminating the CDN marked script and the client-side "wait for marked" dance.
 */
import { marked } from "npm:marked@12";
import { processMermaidBlocks } from "./mermaid.ts";

function rewriteDocLinks(html: string): string {
  return html.replace(
    /href="([^"]*)"/g,
    (_match: string, href: string) => {
      // Already a full URL, anchor, or already a /docs/ link — leave alone
      if (href.startsWith("http") || href.startsWith("#") || href.startsWith("/docs/")) return `href="${href}"`;
      // Legacy /?doc=filename.md links in source content
      if (href.startsWith("/?doc=")) {
        const slug = href.replace("/?doc=", "").replace(/\.md$/, "");
        return `href="/docs/${slug}"`;
      }
      // Bare .md filename or relative path ending in .md → /docs/slug
      if (href.endsWith(".md")) {
        const slug = href.split("/").pop()!.replace(/\.md$/, "");
        return `href="/docs/${slug}"`;
      }
      return `href="${href}"`;
    },
  );
}

export function mdToHtml(md: string): string {
  if (!md) return "";
  try {
    const html = marked.parse(md, { gfm: true }) as string;
    return rewriteDocLinks(processMermaidBlocks(html));
  } catch {
    return "";
  }
}
