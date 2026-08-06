/*
 * Code Map: dashboard static server (D3 lock).
 *
 * Own HTTP server in the dashboard package; binds 127.0.0.1 by default.
 * Routes:
 *   GET /          →  index.html with the minted token injected
 *   GET /assets/*  →  served from this package's assets dir (app.js, theme.css)
 *   anything else  →  404
 *
 * No data API: the adapter-websocket is the only door. The server's job is
 * "serve the page + per-load token mint." Per the D2 lock (kernel stays
 * dashboard-agnostic), this lives in dashboard-core; the composition root
 * wires it via createPlatform().
 *
 * CID Index:
 *   CID:server-001 -> createDashboardServer
 *   CID:server-002 -> DASHBOARD_DEFAULT_PORT (in config.ts)
 *
 * Quick lookup: rg -n "CID:server-" packages/dashboard-core/src/
 */

import * as http from "node:http";
import type { Gateway, Clock } from "@spanexx/gateway-core";
import { mintDashboardToken } from "./token.js";
import { DASHBOARD_DEFAULT_PORT } from "./config.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveAssetsDir } from "./fileloc.js";

// CID:server-filename-001 - removed direct fileURLToPath(import.meta.url).
// CJS bundles (esbuild --format=cjs) make import.meta.url undefined; using it
// at module top-level crashed every agentide CLI subcommand. Now resolves
// via ./fileloc.js which handles ESM source, CJS bundled, and env-override
// modes.

const ASSETS_DIR = resolveAssetsDir();

// Load the served index.html from the assets directory (P4). Falls back to
// the inline placeholder if the file isn't shipped (defensive — for old
// builds or partial installs).
const INDEX_HTML = (() => {
  const indexPath = join(ASSETS_DIR, "index.html");
  if (existsSync(indexPath)) {
    return readFileSync(indexPath, "utf8");
  }
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Agentide Dashboard</title>
<link rel="stylesheet" href="/assets/theme.css"></head>
<body>
<div id="root">
  <header><h1>Agentide Dashboard</h1><span id="conn">connecting</span></header>
  <div id="panels"></div>
  <script>window.__AGENTIDE_TOKEN__ = "__AGENTIDE_TOKEN__";</script>
  <script src="/assets/app.js"></script>
</div>
</body></html>`;
})();

// Minimal assets so the route returns real content during tests. P4 will
// replace these with the full dashboard UX.
const PLACEHOLDER_APP_JS = "// P3 placeholder — P4 will replace with the full vanilla-JS dashboard client.\n";
const PLACEHOLDER_THEME_CSS = "/* P3 placeholder — P4 will replace with the full dark theme + scrollbar styling. */\n";

export interface DashboardServer {
  readonly port: number;
  stop(): Promise<void>;
}

// CID:server-001 - createDashboardServer
// Purpose: start the static server; mint a fresh dashboard-bot token on
// every GET / and inject it into the page. Routes are limited — no data API.
export async function createDashboardServer(opts: {
  readonly gateway: Gateway;
  readonly clock: Clock;
  readonly port?: number;
}): Promise<DashboardServer> {
  const port = opts.port ?? DASHBOARD_DEFAULT_PORT;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (req.method === "GET" && url.pathname === "/") {
        // Per-load mint — every GET / produces a fresh token. Memory only;
        // the page holds it in window.__AGENTIDE_TOKEN__, never localStorage.
        const minted = await mintDashboardToken(opts.gateway, { clock: opts.clock, port });
        // Replace BOTH occurrences of the placeholder (the variable name
        // and the literal string assigned to it). Using a regex with the
        // global flag handles both in one pass.
        const body = INDEX_HTML.replace(/__AGENTIDE_TOKEN__/g, minted.token);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(body);
        return;
      }
      if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
        const file = url.pathname.replace("/assets/", "");
        const path = join(ASSETS_DIR, file);
        if (existsSync(path) && path.startsWith(ASSETS_DIR)) {
          const content = readFileSync(path);
          const ct = file.endsWith(".js") ? "application/javascript"
            : file.endsWith(".css") ? "text/css"
            : file.endsWith(".html") ? "text/html; charset=utf-8"
            : "text/plain";
          res.writeHead(200, { "content-type": ct });
          res.end(content);
          return;
        }
        // Fallback to the inline placeholder only when the asset isn't
        // shipped in the package (defensive — shouldn't happen post-P4).
        if (file === "app.js") {
          res.writeHead(200, { "content-type": "application/javascript" });
          res.end(PLACEHOLDER_APP_JS);
          return;
        }
        if (file === "theme.css") {
          res.writeHead(200, { "content-type": "text/css" });
          res.end(PLACEHOLDER_THEME_CSS);
          return;
        }
      }
      // Anything else (including /api/* and unknown GETs) → 404.
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`server error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Bind 127.0.0.1; surfaces EADDRINUSE cleanly to the caller.
  await new Promise<void>((resolve, reject) => {
    server.once("error", (err) => reject(err));
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const actualPort = (server.address() as { port: number } | null)?.port ?? port;
  return {
    port: actualPort,
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}