/*
 * Behavior spec for the Streamable HTTP server seam (src/server.ts):
 *  - binds the given port (0 = OS-assigned), exposes it via the handle
 *  - routes /mcp through WebStandardStreamableHTTPServerTransport (stateless,
 *    JSON responses) with the MCP Server connected
 *  - malformed JSON -> JSON-RPC parse error envelope (-32700)
 *  - valid JSON-RPC with no handler -> -32601 (MethodNotFound) on HTTP 200
 *  - GET without SSE Accept -> 406 -32000
 *  - stop() closes the port (idempotent)
 * A bare Server (no handlers) is enough — this seam owns no kernel knowledge.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { startMcpHttpServer, type McpHttpServerHandle } from "../server.js";

const JSON_RPC_ACCEPT = "application/json, text/event-stream";

function bareServer(): McpServer {
  return new McpServer({ name: "probe", version: "0.0.0" }, { capabilities: { tools: {} } });
}

async function postJson(
  handle: McpHttpServerHandle,
  body: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: JSON_RPC_ACCEPT, ...headers },
    body,
  });
  return { status: res.status, json: await res.json() };
}

const handles: McpHttpServerHandle[] = [];

async function start(): Promise<McpHttpServerHandle> {
  const handle = await startMcpHttpServer({
    host: "127.0.0.1",
    port: 0,
    // D-123: per-request server factory — the SDK Server is not reusable
    // across connections (fresh protocol state per request).
    createServer: bareServer,
  });
  handles.push(handle);
  return handle;
}

afterEach(async () => {
  while (handles.length > 0) {
    const h = handles.pop();
    await h?.stop();
  }
});

describe("startMcpHttpServer", () => {
  it("binds an OS-assigned port and exposes it", async () => {
    const handle = await start();
    expect(handle.port).toBeGreaterThan(0);
  });

  it("answers a valid tools/list request with -32601 (no handler registered)", async () => {
    const handle = await start();
    const res = await postJson(handle, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
    expect(res.status).toBe(200);
    const body = res.json as { error?: { code?: number } };
    expect(body.error?.code).toBe(-32601);
  });

  it("returns a JSON-RPC parse error envelope for malformed JSON", async () => {
    const handle = await start();
    const res = await postJson(handle, "not json at all");
    expect(res.status).toBe(400);
    const body = res.json as { error?: { code?: number } };
    expect(body.error?.code).toBe(-32700);
  });

  it("rejects POSTs without the JSON content type", async () => {
    const handle = await start();
    const res = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: "POST",
      headers: { Accept: JSON_RPC_ACCEPT },
      body: "{}",
    });
    expect(res.status).toBe(415);
  });

  it("rejects GET requests without SSE Accept (406 -32000)", async () => {
    const handle = await start();
    const res = await fetch(`http://127.0.0.1:${handle.port}/mcp`, { method: "GET" });
    expect(res.status).toBe(406);
  });

  it("404s non-/mcp paths", async () => {
    const handle = await start();
    const res = await fetch(`http://127.0.0.1:${handle.port}/other`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("stop() closes the port and is idempotent", async () => {
    const handle = await start();
    await handle.stop();
    await handle.stop();
    await expect(fetch(`http://127.0.0.1:${handle.port}/mcp`)).rejects.toThrow();
  });
});
