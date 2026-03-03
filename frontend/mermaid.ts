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

/**
 * Call after dangerouslySetInnerHTML renders. Finds .mermaid divs and renders them.
 */
export async function runMermaid(): Promise<void> {
  try {
    const m = await getMermaid();
    if (!_initialized) {
      m.initialize({ startOnLoad: false });
      _initialized = true;
    }
    await m.run({ querySelector: ".mermaid", suppressErrors: true });
  } catch (_e) {
    // silent — mermaid failure shouldn't break the page
  }
}

/**
 * Rewrite marked's `<pre><code class="language-mermaid">…</code></pre>`
 * into `<div class="mermaid">…</div>` so mermaid.run() picks them up.
 */
export function processMermaidBlocks(html: string): string {
  return html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    '<div class="mermaid">$1</div>',
  );
}
