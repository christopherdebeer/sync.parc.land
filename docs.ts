/**
 * docs.ts — Static content loading and document registry.
 *
 * Loads README, reference docs, and essay/design docs at module init time.
 * Builds a unified DOC_REGISTRY keyed by slug for serving /docs/* routes.
 */

export interface DocEntry {
  title: string;
  content: string;
  category: string;
  rawPath: string;
}

const README_URL = new URL("./README.md", import.meta.url);
export const README = await fetch(README_URL).then((r) => r.text());

export const REFERENCE_FILES: Record<string, string> = {};
for (const name of ["api.md", "cel.md", "examples.md", "surfaces.md", "v6.md", "help.md", "views.md", "landing.md"]) {
  const refUrl = new URL(`./reference/${name}`, import.meta.url);
  REFERENCE_FILES[name] = await fetch(refUrl).then((r) => r.text());
}

// Essay/design docs
export const DOC_ESSAY_FILES: Record<string, string> = {};
for (const name of [
  "what-becomes-true.md", "introducing-sync.md", "the-substrate-thesis.md",
  "SUBSTRATE.md", "isnt-this-just-react.md", "pressure-field.md",
  "sigma-calculus.md", "surfaces-design.md", "agent-sync-technical-design.md",
  "agency-and-identity.md", "frontend-unify.md",
]) {
  const docUrl = new URL(`./docs/${name}`, import.meta.url);
  DOC_ESSAY_FILES[name] = await fetch(docUrl).then((r) => r.text());
}

// Unified doc registry: slug -> metadata + raw content
export const DOC_REGISTRY: Record<string, DocEntry> = {};

const _refTitles: Record<string, string> = {
  "api": "API Reference", "cel": "CEL Reference", "examples": "Examples",
  "v6": "Architecture", "views": "Views Reference", "help": "Help Reference",
  "surfaces": "Surfaces Reference", "landing": "Landing",
};
for (const [slug, title] of Object.entries(_refTitles)) {
  DOC_REGISTRY[slug] = { title, content: REFERENCE_FILES[`${slug}.md`], category: "reference", rawPath: `/reference/${slug}.md` };
}
DOC_REGISTRY["SKILL"] = { title: "Skill Guide", content: README, category: "reference", rawPath: "/SKILL.md" };

const _essayTitles: Record<string, string> = {
  "what-becomes-true": "What Becomes True", "introducing-sync": "Introducing Sync",
  "the-substrate-thesis": "The Substrate Thesis", "SUBSTRATE": "Substrate (Compact)",
  "isnt-this-just-react": "Isn't This Just ReAct?", "pressure-field": "The Pressure Field",
  "sigma-calculus": "Σ-calculus", "surfaces-design": "Surfaces as Substrate",
  "agent-sync-technical-design": "Technical Design", "agency-and-identity": "Agency and Identity",
  "frontend-unify": "Frontend Unification",
};
for (const [slug, title] of Object.entries(_essayTitles)) {
  DOC_REGISTRY[slug] = { title, content: DOC_ESSAY_FILES[`${slug}.md`], category: "essay", rawPath: `/docs/${slug}.md` };
}
