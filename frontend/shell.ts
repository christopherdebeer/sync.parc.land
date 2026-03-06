/** SSR HTML shell — wraps rendered React + extracted styled-components CSS.
 *
 * Each page calls shell() with:
 *   html  — renderToString output
 *   css   — ServerStyleSheet.getStyleTags() output
 *   props — serializable data passed to client for hydration
 *   entry — path to the page's client.tsx hydration script
 *   title — page <title>
 *   meta  — optional extra <meta> tags
 */

export interface ShellOptions {
  html: string;
  css: string;
  props?: Record<string, unknown>;
  entry: string;
  title?: string;
  meta?: string;
  /** Additional <script> tags to include in <head> (e.g. UMD bundles) */
  headScripts?: string;
}

export function shell(opts: ShellOptions): string {
  const {
    html,
    css,
    props = {},
    entry,
    title = "sync — Multi-Agent Coordination",
    meta = "",
    headScripts = "",
  } = opts;

  // Escape JSON for safe embedding in <script type="application/json">
  const serializedProps = JSON.stringify(props)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
${meta}
<style>
  :root {
    --bg: #0d1117; --fg: #c9d1d9; --dim: #484f58; --border: #21262d;
    --accent: #58a6ff; --green: #3fb950; --yellow: #d29922; --red: #f85149;
    --surface: #161b22; --surface2: #1c2129; --purple: #bc8cff; --orange: #f0883e;
    --lbg: #ffffff; --lfg: #1a1a1a; --ldim: #6b7280;
    --laccent: #2563eb; --lborder: #e5e7eb; --lsurface: #f4f4f5;
    --laccent-soft: #dbeafe;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --lbg: #0a0a0c; --lfg: #e4e4e7; --ldim: #71717a;
      --laccent: #60a5fa; --lborder: #27272a; --lsurface: #18181b;
      --laccent-soft: #1e3a5f;
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  code {
    background: var(--lsurface);
    border: 1px solid var(--lborder);
    color: var(--laccent);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.88em;
  }
</style>
${css}
${headScripts}
</head>
<body>
<div id="root">${html}</div>
<script id="__PROPS__" type="application/json">${serializedProps}</script>
<script type="module" src="${entry}"></script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}