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
 *
 * Quick lookup: rg -n "CID:server-" packages/adapter-mcp/src/server.ts
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
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
export async function startMcpHttpServer(
  server: McpServer,
  config: { readonly host: string; readonly port: number },
): Promise<McpHttpServerHandle> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);

  const httpServer = createServer((req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "not found" } }));
      return;
    }
    const addr = httpServer.address();
    const bound = typeof addr === "object" && addr !== null ? addr.port : config.port;
    void handleTransportRequest(req, res, transport, config.host, bound);
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
      await transport.close();
    },
  };
}

async function handleTransportRequest(
  req: IncomingMessage,
  res: ServerResponse,
  transport: WebStandardStreamableHTTPServerTransport,
  host: string,
  port: number,
): Promise<void> {
  try {
    const webReq = toWebRequest(req, host, port);
    const ctx: RequestCtx = { token: extractBearer(webReq.headers.get("authorization")) };
    const response = await requestCtxStore.run(ctx, () => transport.handleRequest(webReq));
    await writeWebResponse(res, response);
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" } }));
  }
}
