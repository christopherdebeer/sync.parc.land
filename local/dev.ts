/**
 * Local dev server for sync.parc.land.
 *
 * Run with:  deno task dev
 *
 * Replaces the Val Town runtime with:
 *  - Local SQLite via better-sqlite3 (shimmed by local/sqlite.ts + import map)
 *  - On-the-fly TSX/TS transpilation via esbuild (replaces esm.town CDN proxy)
 *  - Direct file serving for frontend assets
 *
 * All API routes delegate to main.ts — zero business logic changes.
 */
import { Hono } from "npm:hono";
import * as esbuild from "npm:esbuild@0.24";
import apiHandler from "../main.ts";

const app = new Hono();

// ---- Frontend module transpilation (replaces esm.town CDN proxy) ----
// Root route (/) falls through to main.ts which does SSR rendering.
app.get("/frontend/*", async (c) => {
  const reqPath = new URL(c.req.url).pathname;
  const filePath = new URL(".." + reqPath, import.meta.url);

  try {
    const source = await Deno.readTextFile(filePath);
    const ext = reqPath.split(".").pop() ?? "";

    if (ext === "tsx" || ext === "ts") {
      const result = await esbuild.transform(source, {
        loader: ext as "tsx" | "ts",
        jsx: "automatic",
        jsxImportSource: "https://esm.sh/react@18.2.0",
      });
      return new Response(result.code, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    }

    // Non-TS assets (CSS, HTML, etc.)
    const types: Record<string, string> = {
      css: "text/css",
      html: "text/html",
      json: "application/json",
    };
    return new Response(source, {
      headers: {
        "Content-Type": `${types[ext] ?? "text/plain"}; charset=utf-8`,
      },
    });
  } catch {
    return c.json({ error: "not found", path: reqPath }, 404);
  }
});

// ---- All other routes → main.ts API handler ----
app.all("*", (c) => apiHandler(c.req.raw));

// ---- Start server ----
const port = parseInt(Deno.env.get("PORT") ?? "8787");
console.log(`\n  sync.parc.land dev server`);
console.log(`  http://localhost:${port}\n`);
Deno.serve({ port }, app.fetch);
