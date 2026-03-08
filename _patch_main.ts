// Temporary script to patch main.ts with docs SSR changes — run once then delete
const VAL_ID = "93e19588-0ebb-11f1-a6cd-42dde27851f2";
const TOKEN = Deno.env.get("valtown");

// Fetch current main.ts source
const getResp = await fetch(
  `https://api.val.town/v2/vals/${VAL_ID}/files/content?path=main.ts`,
  { headers: { Authorization: `Bearer ${TOKEN}` } },
);
const src = await getResp.text();
const lines = src.split("\n");
console.log(`Read ${lines.length} lines from main.ts`);

// ── Change blocks (stored as arrays of lines to insert) ─────────────────

const ESSAY_LOADING_BLOCK = [
  '// Essay/design docs',
  'const DOC_ESSAY_FILES: Record<string, string> = {};',
  'for (const name of [',
  '  "what-becomes-true.md", "introducing-sync.md", "the-substrate-thesis.md",',
  '  "SUBSTRATE.md", "isnt-this-just-react.md", "pressure-field.md",',
  '  "sigma-calculus.md", "surfaces-design.md", "agent-sync-technical-design.md",',
  '  "agency-and-identity.md", "frontend-unify.md",',
  ']) {',
  '  const docUrl = new URL(`./docs/${name}`, import.meta.url);',
  '  DOC_ESSAY_FILES[name] = await fetch(docUrl).then((r) => r.text());',
  '}',
  '// Unified doc registry: slug -> metadata + raw content',
  'interface DocEntry { title: string; content: string; category: string; rawPath: string }',
  'const DOC_REGISTRY: Record<string, DocEntry> = {};',
  'const _refTitles: Record<string, string> = {',
  '  "api": "API Reference", "cel": "CEL Reference", "examples": "Examples",',
  '  "v6": "Architecture", "views": "Views Reference", "help": "Help Reference",',
  '  "surfaces": "Surfaces Reference", "landing": "Landing",',
  '};',
  'for (const [slug, title] of Object.entries(_refTitles)) {',
  '  DOC_REGISTRY[slug] = { title, content: REFERENCE_FILES[`${slug}.md`], category: "reference", rawPath: `/reference/${slug}.md` };',
  '}',
  'DOC_REGISTRY["SKILL"] = { title: "Skill Guide", content: README, category: "reference", rawPath: "/SKILL.md" };',
  'const _essayTitles: Record<string, string> = {',
  '  "what-becomes-true": "What Becomes True", "introducing-sync": "Introducing Sync",',
  '  "the-substrate-thesis": "The Substrate Thesis", "SUBSTRATE": "Substrate (Compact)",',
  "  \"isnt-this-just-react\": \"Isn't This Just ReAct?\", \"pressure-field\": \"The Pressure Field\",",
  '  "sigma-calculus": "\u03A3-calculus", "surfaces-design": "Surfaces as Substrate",',
  '  "agent-sync-technical-design": "Technical Design", "agency-and-identity": "Agency and Identity",',
  '  "frontend-unify": "Frontend Unification",',
  '};',
  'for (const [slug, title] of Object.entries(_essayTitles)) {',
  '  DOC_REGISTRY[slug] = { title, content: DOC_ESSAY_FILES[`${slug}.md`], category: "essay", rawPath: `/docs/${slug}.md` };',
  '}',
];

const DOCS_ROUTES_BLOCK = [
  '    // /docs \u2014 SSR index and rendered pages',
  '    if (method === "GET" && (url.pathname === "/docs" || url.pathname === "/docs/")) {',
  '      const docList = Object.entries(DOC_REGISTRY).map(([slug, d]) => ({ slug, title: d.title, category: d.category }));',
  '      return renderDocsIndex(docList);',
  '    }',
  '    if (method === "GET" && url.pathname.startsWith("/docs/") && parts.length === 2) {',
  '      const rawSlug = parts[1];',
  '      // /docs/slug.md \u2192 raw markdown text',
  '      if (rawSlug.endsWith(".md")) {',
  '        const bareSlug = rawSlug.replace(/\\.md$/, "");',
  '        const doc = DOC_REGISTRY[bareSlug];',
  '        if (doc) return new Response(doc.content, { headers: { "Content-Type": "text/plain; charset=utf-8" } });',
  '        return json({ error: "doc not found" }, 404);',
  '      }',
  '      // /docs/slug \u2192 SSR rendered page',
  '      const doc = DOC_REGISTRY[rawSlug];',
  '      if (doc) return renderDocPage(rawSlug, doc.title, mdToHtml(doc.content), doc.rawPath);',
  '      return json({ error: "doc not found" }, 404);',
  '    }',
  '    // Root \u2014 SSR per-page (replaces SPA shell)',
  '    if (url.pathname === "/" || url.pathname === "") {',
  '      const roomId = url.searchParams.get("room");',
  '      const docId = url.searchParams.get("doc");',
  '      if (roomId) return renderDashboardPage(roomId);',
  '      // Backward compat: /?doc=filename.md \u2192 301 /docs/slug',
  '      if (docId) {',
  '        const slug = docId.replace(/\\.md$/, "");',
  '        return new Response(null, { status: 301, headers: { "Location": `/docs/${slug}` } });',
  '      }',
  '      return renderLandingPage();',
  '    }',
];

// ── Apply changes ───────────────────────────────────────────────────────

const result: string[] = [];
let i = 0;
let changes = 0;

while (i < lines.length) {
  const line = lines[i];

  // Change 1: Update pages.tsx import + add mdToHtml import
  if (line.includes("renderLandingPage, renderDashboardPage, renderDocPage") && line.includes("./frontend/pages.tsx")) {
    result.push('import { renderLandingPage, renderDashboardPage, renderDocPage, renderDocsIndex } from "./frontend/pages.tsx";');
    result.push('import { mdToHtml } from "./frontend/markdown.ts";');
    changes++;
    i++;
    continue;
  }

  // Change 2: After closing } of REFERENCE_FILES loop
  if (line.trim() === "}" && i > 0 && lines[i - 1].includes("REFERENCE_FILES[name]")) {
    result.push(line); // keep }
    result.push(...ESSAY_LOADING_BLOCK);
    changes++;
    i++;
    continue;
  }

  // Change 3: Replace root route handler
  if (line.includes("// Root \u2014 SSR per-page (replaces SPA shell)")) {
    result.push(...DOCS_ROUTES_BLOCK);
    changes++;
    // Skip old 8 lines
    i += 8;
    continue;
  }

  result.push(line);
  i++;
}

console.log(`Applied ${changes} changes, new content: ${result.length} lines`);
if (changes !== 3) {
  console.error(`ERROR: Expected 3 changes, got ${changes}. Aborting!`);
  Deno.exit(1);
}

const newContent = result.join("\n");

// Write back via API
const putResp = await fetch(
  `https://api.val.town/v2/vals/${VAL_ID}/files?path=main.ts`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: newContent, type: "http" }),
  },
);
const putStatus = putResp.status;
const putBody = await putResp.text();
console.log(`PUT response: ${putStatus}`);
if (putStatus >= 200 && putStatus < 300) {
  console.log("SUCCESS: main.ts updated!");
} else {
  console.error(`FAILED: ${putBody.slice(0, 500)}`);
}
