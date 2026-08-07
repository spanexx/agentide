/*
 * Code Map: REST HTTP server + router (Phase 5)
 * - createRestAdapter: phase-1 stub replaced with a real node:http server
 *   that binds 127.0.0.1 only and routes:
 *     POST /invoke           → handleInvoke (Phase 3)
 *     GET  /capabilities     → handleGetCapabilities (Phase 4)
 *     anything else          → 404 + INVALID_REQUEST body
 *   `GET /capabilities/{name}` is deliberately NOT registered (D-100).
 * - No framework. Mirrors the dashboard-core/server.ts pattern: own
 *   http.createServer, bind 127.0.0.1, surface EADDRINUSE cleanly, expose
 *   the bound port (tests boot on port 0).
 *
 * CID Index:
 * CID:adapter-rest-server-001 -> createRestAdapter
 */

import * as http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Gateway, Adapter, YamlValue } from "@spanexx/gateway-core";
import type { GatewayErrorPayload } from "@spanexx/errors";
import { ERROR_CODES } from "@spanexx/errors";
import type { RestAdapter, RestAdapterConfig } from "./types.js";
import { handleInvoke } from "./invoke.js";
import { handleGetCapabilities } from "./capabilities.js";
import { restErrorConverter } from "./errors.js";

export const DEFAULT_REST_ADAPTER_HOST = "127.0.0.1";
export const DEFAULT_REST_ADAPTER_PORT = 7400;

const HEADER_CONTENT_TYPE = "content-type";
const CONTENT_TYPE_JSON = "application/json; charset=utf-8";

function writeJson(res: ServerResponse, status: number, body: YamlValue): void {
  res.writeHead(status, { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON });
  res.end(JSON.stringify(body));
}

function writeRouteNotFound(req: IncomingMessage, res: ServerResponse): void {
  const path = req.url ?? "/";
  const fabricated: GatewayErrorPayload = {
    code: ERROR_CODES.INVALID_REQUEST,
    message: `route not found: ${req.method ?? "UNKNOWN"} ${path}`,
    details: { method: req.method ?? "UNKNOWN", path },
    retryable: false,
  };
  // 404 per the IMPL Phase 5 router spec — the locked table maps
  // INVALID_REQUEST to 400 for kernel errors; this is a door-routing
  // decision (route not found → 404) using the INVALID_REQUEST envelope.
  writeJson(res, 404, {
    code: fabricated.code,
    message: fabricated.message,
    details: fabricated.details,
    retryable: fabricated.retryable,
  });
}

// CID:adapter-rest-server-001 - createRestAdapter
// Purpose: Adapter-shaped factory that starts the HTTP server. Returns a
//   handle with the bound port; tests boot on port 0 to get a free port.
export function createRestAdapter(gateway: Gateway, config: RestAdapterConfig = {}): Adapter & RestAdapter {
  const host = config.host ?? DEFAULT_REST_ADAPTER_HOST;
  const requestedPort = config.port ?? DEFAULT_REST_ADAPTER_PORT;
  // restErrorConverter is the door's converter — pre-built so the router
  // renders the door-fabricated route-not-found body without going through
  // the pipeline. The handlers use the same instance via the shared seam.
  const errors = restErrorConverter;
  void errors; // router doesn't reference it directly; document for future ops

  let server: http.Server | undefined;
  let boundPort = requestedPort;

  const handle: Adapter & RestAdapter = {
    name: "adapter-rest",
    get port(): number {
      return boundPort;
    },
    async start(): Promise<void> {
      if (server !== undefined) {
        throw new Error("createRestAdapter: server already started");
      }
      server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url ?? "/", `http://${host}:${requestedPort}`);
          const path = url.pathname;
          const method = req.method ?? "UNKNOWN";

          // Router — locked by Phase 5 IMPL.
          if (method === "POST" && path === "/invoke") {
            await handleInvoke(req, res, gateway);
            return;
          }
          if (method === "GET" && path === "/capabilities") {
            await handleGetCapabilities(req, res, gateway);
            return;
          }
          // GET /capabilities/{name} is intentionally NOT registered — D-100
          // deferred until createCapabilityLookup.describe() is fixed.
          writeRouteNotFound(req, res);
        } catch (err) {
          // Defensive — every unhandled throw in a handler becomes a 500 with
          // a HANDLER_ERROR payload (runtime family). The pipeline normally
          // surfaces errors via the channel; this catch is for transport
          // surprises (write errors, malformed request lines, etc.).
          const message = err instanceof Error ? err.message : String(err);
          writeJson(res, 500, {
            code: ERROR_CODES.HANDLER_ERROR,
            message,
            details: {},
            retryable: true,
          });
        }
      });

      await new Promise<void>((resolve, reject) => {
        server!.once("error", (err: NodeJS.ErrnoException) => reject(err));
        server!.listen(requestedPort, host, () => resolve());
      });
      const address = server.address();
      if (address !== null && typeof address === "object" && "port" in address) {
        boundPort = address.port;
      }
    },
    async stop(): Promise<void> {
      if (server === undefined) return;
      const s = server;
      server = undefined;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    },
  };
  return handle;
}