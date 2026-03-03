import { Hono } from "npm:hono";
import { serveFile } from "https://esm.town/v/std/utils@85-main/index.ts"; // see: https://www.val.town/x/std/utils
import apiHandler from "../main.ts";

const app = new Hono();

// Serve the React app for the root route (landing + dashboard via ?room= param)
app.get("/", c => serveFile("/frontend/index.html", import.meta.url));

// Serve all frontend assets (TSX, TS, HTML)
app.get("/frontend/*", c => serveFile(c.req.path, import.meta.url));

// Delegate everything else to the existing API handler
app.all("*", c => apiHandler(c.req.raw));

export default app.fetch;
