/** Shared mermaid utilities for DocViewer and Landing */

let _initialized = false;
let _mermaid: any = null;

async function getMermaid(): Promise<any> {
  if (_mermaid) return _mermaid;
  // @ts-ignore — dynamic CDN import
  const mod = await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs");
  _mermaid = mod.default;
  return _mermaid;
}

/** Detect light vs dark from the landing CSS variable */
function currentTheme(): "default" | "dark" {
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--lbg").trim();
    // dark mode sets --lbg to a very dark value (#0a0a0c)
    return bg.startsWith("#0") || bg.startsWith("rgb(1") ? "dark" : "default";
  } catch {
    return "default";
  }
}

/**
 * Call after dangerouslySetInnerHTML renders. Finds .mermaid divs and renders them.
 * Safe to call multiple times — re-initializes theme each time to catch dark/light changes.
 */
export async function runMermaid(): Promise<void> {
  try {
    const m = await getMermaid();
    if (!_initialized) {
      m.initialize({ startOnLoad: false });
      _initialized = true;
    }
    // Re-run with current theme
    await m.run({
      querySelector: ".mermaid",
      suppressErrors: true,
    });
  } catch (_e) {
    // silent — mermaid failure shouldn't break the page
  }
}

/**
 * Rewrite marked's `<pre><code class="language-mermaid">…</code></pre>`
 * into `<div class="mermaid">…</div>` so mermaid.run() picks them up.
 *
 * Content stays HTML-encoded — the browser decodes it when setting innerHTML,
 * and mermaid reads .textContent (decoded), so this round-trip is correct.
 */
export function processMermaidBlocks(html: string): string {
  return html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    '<div class="mermaid">$1</div>',
  );
}
