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
  /* ── Unified theme: light default, dark via toggle or system pref ── */
  :root {
    --bg: #ffffff; --fg: #1a1a1a; --dim: #6b7280;
    --accent: #2563eb; --border: #e5e7eb; --surface: #f4f4f5;
    --accent-soft: #dbeafe;
    --green: #16a34a; --yellow: #ca8a04; --red: #dc2626;
    --purple: #7c3aed; --orange: #ea580c;
    --surface2: #e4e4e7;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0d1117; --fg: #c9d1d9; --dim: #484f58;
      --accent: #58a6ff; --border: #21262d; --surface: #161b22;
      --accent-soft: #1e3a5f;
      --green: #3fb950; --yellow: #d29922; --red: #f85149;
      --purple: #bc8cff; --orange: #f0883e;
      --surface2: #1c2129;
    }
  }
  [data-theme="dark"] {
    --bg: #0d1117; --fg: #c9d1d9; --dim: #484f58;
    --accent: #58a6ff; --border: #21262d; --surface: #161b22;
    --accent-soft: #1e3a5f;
    --green: #3fb950; --yellow: #d29922; --red: #f85149;
    --purple: #bc8cff; --orange: #f0883e;
    --surface2: #1c2129;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  code {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--accent);
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.88em;
  }
</style>
<script>
  // Apply theme before paint to prevent flash
  (function(){
    var t = localStorage.getItem("sync-theme");
    if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t);
  })();
</script>
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
