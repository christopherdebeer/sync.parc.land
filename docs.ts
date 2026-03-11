/**
 * docs.ts — Document registry.
 *
 * Single list of filenames per directory. Titles extracted from # headers.
 * To add a doc: add its filename to the array below. That's it.
 */

export interface DocEntry {
  title: string;
  content: string;
  category: string;
  rawPath: string;
}

/** Extract title from first markdown # heading, or humanize the filename. */
function extractTitle(content: string, filename: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return filename.replace(/\.md$/, "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/** Fetch a file's content relative to this module. */
async function fetchFile(path: string): Promise<string> {
  const url = new URL(`./${path}`, import.meta.url);
  return fetch(url).then(r => r.text());
}

// ── Load content ──

export const README = await fetchFile("README.md");

// One array per directory. Add a filename and it works.
const REF_FILES = [
  "api.md", "cel.md", "examples.md", "surfaces.md",
  "v6.md", "help.md", "views.md", "landing.md",
];
const DOC_FILES = [
  "what-becomes-true.md", "introducing-sync.md", "the-substrate-thesis.md",
  "SUBSTRATE.md", "isnt-this-just-react.md", "pressure-field.md",
  "sigma-calculus.md", "surfaces-design.md", "agent-sync-technical-design.md",
  "agency-and-identity.md", "frontend-unify.md", "adaptive-salience.md",
  "the-self-assembling-harness.md",
];

export const REFERENCE_FILES: Record<string, string> = {};
await Promise.all(REF_FILES.map(async name => {
  REFERENCE_FILES[name] = await fetchFile(`reference/${name}`);
}));

export const DOC_ESSAY_FILES: Record<string, string> = {};
await Promise.all(DOC_FILES.map(async name => {
  DOC_ESSAY_FILES[name] = await fetchFile(`docs/${name}`);
}));

// ── Build registry — titles derived from content, not a second map ──

export const DOC_REGISTRY: Record<string, DocEntry> = {};

for (const [name, content] of Object.entries(REFERENCE_FILES)) {
  const slug = name.replace(/\.md$/, "");
  DOC_REGISTRY[slug] = { title: extractTitle(content, name), content, category: "reference", rawPath: `/reference/${name}` };
}

DOC_REGISTRY["SKILL"] = { title: "Skill Guide", content: README, category: "reference", rawPath: "/SKILL.md" };

for (const [name, content] of Object.entries(DOC_ESSAY_FILES)) {
  const slug = name.replace(/\.md$/, "");
  DOC_REGISTRY[slug] = { title: extractTitle(content, name), content, category: "essay", rawPath: `/docs/${name}` };
}
