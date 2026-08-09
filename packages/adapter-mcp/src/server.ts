/*
 * Code Map: Streamable HTTP server seam (no kernel knowledge)
 * - startMcpHttpServer: node:http server that converts IncomingMessage <-> web
 *   Request/Response and forwards /mcp traffic to the MCP transport
 * - requestCtxStore: AsyncLocalStorage carrying the per-request bearer token
 *   so MCP handler callbacks can read it (Authorization header -> RequestCtx)
 *
 * Transport choice (BI[9] GRILL Q1): WebStandardStreamableHTTPServerTransport
 * in STATELESS mode (sessionIdGenerator: undefined) — no session header dance,
 * no init requirement, raw JSON-RPC POSTs work. enableJsonResponse: true keeps
 * the wire format plain JSON (matches PRD-TRD envelopes).
 *
 * CID Index:
 * CID:server-001 -> McpHttpServerHandle
 * CID:server-002 -> requestCtxStore / getRequestCtx
 * CID:server-003 -> startMcpHttpServer
 * CID:server-004 -> handleOAuthTokenRoute (POST /oauth/token)
 *
 * Quick lookup: rg -n "CID:server-" packages/adapter-mcp/src/server.ts
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import type { OAuthTokenHandler, OidcResponse } from "@spanexx/gateway-core";
import type { RequestCtx } from "./types.js";

// CID:server-001 - McpHttpServerHandle
// Purpose: running server handle — bound port + idempotent stop.
export interface McpHttpServerHandle {
  readonly port: number;
  stop(): Promise<void>;
}

// CID:server-002 - requestCtxStore / getRequestCtx
// Purpose: per-request context (bearer token) readable from MCP handler callbacks.
export const requestCtxStore = new AsyncLocalStorage<RequestCtx>();

export function getRequestCtx(): RequestCtx | undefined {
  return requestCtxStore.getStore();
}

function extractBearer(auth: string | null): string | null {
  if (auth === null) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m?.[1] ?? null;
}

function toWebRequest(req: IncomingMessage, host: string, port: number): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }
  const url = `http://${host}:${port}${req.url ?? "/"}`;
  if (req.method === "GET" || req.method === "HEAD") {
    return new Request(url, { method: req.method, headers });
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      req.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      req.on("end", () => controller.close());
      req.on("error", (err: Error) => controller.error(err));
    },
  });
  return new Request(url, { method: req.method, headers, body, duplex: "half" } as RequestInit);
}

async function writeWebResponse(res: ServerResponse, web: Response): Promise<void> {
  res.writeHead(web.status, Object.fromEntries(web.headers.entries()));
  if (web.body === null) {
    res.end();
    return;
  }
  res.end(Buffer.from(await web.arrayBuffer()));
}

// CID:server-003 - startMcpHttpServer
// Purpose: bind one HTTP server on config.host/port (0 = OS-assigned) and route
//   /mcp through the MCP transport; all other paths -> 404.
// Uses: WebStandardStreamableHTTPServerTransport (stateless, JSON responses)
// Used by: index.ts createMcpAdapter start()
//
// D-123 (2026-08-09): the SDK Server keeps protocol state across connections —
//   one shared Server + one transport served only the FIRST connection, every
//   later connection failed -32603 (silently). Fix: per-request transport AND
//   per-request Server (config.createServer) — stateless sessions with zero
//   carryover; the transport instance is per-request too.
export async function startMcpHttpServer(
  config: {
    readonly host: string;
    readonly port: number;
    readonly oauth?: OAuthTokenHandler;
    readonly createServer: () => McpServer;
    // BI[29] Phase 7: OIDC auth-code grant routes (GET /oauth/authorize + /oauth/callback).
    // Wired when the gateway is started with --enable-oidc. Handlers are
    // closures over the gateway's codes map / secret / clock (see factory.ts).
    readonly oidc?: {
      readonly authorize: (env: {
        readonly query: { client_id?: string; redirect_uri?: string; scope?: string; response_type?: string };
      }) => Promise<OidcResponse>;
      readonly callback: (env: {
        readonly query: { code?: string; redirect_uri?: string };
      }) => Promise<OidcResponse>;
    };
  },
): Promise<McpHttpServerHandle> {
  const httpServer = createServer((req, res) => {
    // CID:server-004 - POST /oauth/token route (BI[29] Phase 4)
    // Enabled when the gateway exposed its oauthTokenHandler. Body may be
    // JSON or form-encoded; isTls comes from the socket or x-forwarded-proto.
    if (req.method === "POST" && req.url === "/oauth/token" && config.oauth !== undefined) {
      void handleOAuthTokenRoute(req, res, config.oauth);
      return;
    }
    // CID:server-005 - OIDC routes (BI[29] Phase 7): GET /oauth/authorize and
    // GET /oauth/callback. Both delegate to the gateway's OIDC handlers; the
    // dev-stub-approve page itself is served by the gateway CLI, not here.
    if (req.method === "GET" && config.oidc !== undefined) {
      const url = new URL(req.url ?? "/", `http://${config.host}:${config.port}`);
      if (url.pathname === "/oauth/authorize") {
        const query = Object.fromEntries(url.searchParams.entries());
        void writeOidcResponse(res, config.oidc.authorize({ query }));
        return;
      }
      if (url.pathname === "/oauth/callback") {
        const query = Object.fromEntries(url.searchParams.entries());
        void writeOidcResponse(res, config.oidc.callback({ query }));
        return;
      }
    }
    if (req.url !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "not found" } }));
      return;
    }
    const addr = httpServer.address();
    const bound = typeof addr === "object" && addr !== null ? addr.port : config.port;
    // D-123: fresh server + transport per request (see header note).
    void handleTransportRequest(req, res, config, bound);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, config.host, () => resolve());
  });

  const address = httpServer.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : config.port;

  let stopped = false;
  return {
    port: boundPort,
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      // D-123: transports are per-request now — nothing shared to close.
    },
  };
}

// CID:server-004 - handleOAuthTokenRoute
// Purpose: read POST /oauth/token body (JSON or form-encoded), resolve isTls,
//   delegate to the gateway's OAuthTokenHandler, write the JSON response.
// Used by: startMcpHttpServer (POST /oauth/token branch)
async function handleOAuthTokenRoute(
  req: IncomingMessage,
  res: ServerResponse,
  oauth: OAuthTokenHandler,
): Promise<void> {
  try {
    const raw = await readBody(req);
    let body: Record<string, string>;
    try {
      const contentType = req.headers["content-type"] ?? "";
      if (contentType.includes("application/x-www-form-urlencoded")) {
        body = Object.fromEntries(new URLSearchParams(raw));
      } else {
        body = JSON.parse(raw) as Record<string, string>;
      }
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_request", error_description: "body must be JSON or form-encoded" }));
      return;
    }
    const forwardedProto = req.headers["x-forwarded-proto"];
    const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    const isTls =
      (req.socket as { encrypted?: boolean }).encrypted === true ||
      (proto ?? "").toLowerCase() === "https";
    const result = await oauth({ body, isTls });
    res.writeHead(result.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.body));
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "internal_error", error_description: "oauth handler failed" }));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

// CID:server-006 - writeOidcResponse
// Purpose: write an OIDC handler result (302 redirect with Location header,
//   or a JSON error body) to the HTTP response. Never throws.
// Used by: startMcpHttpServer (GET /oauth/authorize + GET /oauth/callback)
async function writeOidcResponse(res: ServerResponse, result: Promise<OidcResponse>): Promise<void> {
  try {
    const r = await result;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (r.headers?.Location !== undefined) headers.Location = r.headers.Location;
    res.writeHead(r.status, headers);
    res.end(JSON.stringify(r.body ?? {}));
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "internal_error", error_description: "oidc handler failed" }));
  }
}

// CID:server-006 - handleTransportRequest
// Purpose: serve ONE /mcp request with a FRESH server + stateless transport
//   (D-123 — the SDK Server is not reusable across connections). Auth: the
//   bearer token is extracted into the per-request AsyncLocalStorage context
//   so the tools handlers can read it without parsing headers themselves.
async function handleTransportRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: {
    readonly host: string;
    readonly port: number;
    readonly createServer: () => McpServer;
  },
  boundPort: number,
): Promise<void> {
  try {
    const webReq = toWebRequest(req, config.host, boundPort);
    const ctx: RequestCtx = { token: extractBearer(webReq.headers.get("authorization")) };
    const server = config.createServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const response = await requestCtxStore.run(ctx, () => transport.handleRequest(webReq));
    await writeWebResponse(res, response);
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" } }));
  }
}
