/*
 * simulate-server.mjs — REST adapter post-impl sim server helper.
 *
 * Boots a real `createRestAdapter` (no mocks) on 127.0.0.1 with a
 * deterministic fake gateway so the bash sim can drive all 10 PRD-TRD
 * scenarios via curl. Runs as a background process; the bash sim kills
 * it on exit (SIGTERM) and asserts the HTTP responses.
 *
 * Test-token convention (recognized by the fake gateway):
 *   "EXPIRED_TEST_TOKEN"        → TOKEN_EXPIRED          (Scenario 4)
 *   "NOSCOPE_TEST_TOKEN"        → INSUFFICIENT_SCOPE     (Scenario 5)
 *   anything else               → routed by capability name
 *
 * Run:  node docs/features/rest-adapter/simulate-server.mjs
 */

// Relative import — pnpm doesn't hoist workspace packages to the monorepo
// root, so `@spanexx/adapter-rest` isn't resolvable from this script's
// location. The dist file is the published surface; we use it directly.
import { createRestAdapter } from "../../../packages/adapter-rest/dist/index.js";

const ERROR_CODES = {
  TOKEN_EXPIRED: "GATEWAY_TOKEN_EXPIRED",
  INSUFFICIENT_SCOPE: "GATEWAY_INSUFFICIENT_SCOPE",
  SESSION_REQUIRED: "GATEWAY_SESSION_REQUIRED",
  CAPABILITY_NOT_FOUND: "GATEWAY_CAPABILITY_NOT_FOUND",
  RATE_LIMIT_EXCEEDED: "GATEWAY_RATE_LIMIT_EXCEEDED",
  HANDLER_TIMEOUT: "GATEWAY_HANDLER_TIMEOUT",
};

const fakeGateway = {
  handleInvocation: async (req) => {
    const { name } = req.capability;
    const { sessionId } = req;
    const token = req.token;

    // Scenario 4: expired token (the door forwards the token verbatim).
    if (token === "EXPIRED_TEST_TOKEN") {
      return { error: { code: ERROR_CODES.TOKEN_EXPIRED, message: "token expired at 2026-08-06", details: { exp: 1 }, retryable: false } };
    }
    // Scenario 5: insufficient scope.
    if (token === "NOSCOPE_TEST_TOKEN") {
      return { error: { code: ERROR_CODES.INSUFFICIENT_SCOPE, message: "caller lacks required scope", details: {}, retryable: false } };
    }

    if (name === "capability.list") {
      return {
        output: [
          { name: "capability.list", description: "List registered capabilities", tier: "read" },
          { name: "session.list", description: "List active sessions", tier: "read" },
          { name: "product.list", description: "List products", tier: "read" },
        ],
      };
    }
    if (name === "product.list") {
      if (sessionId === "s-1") {
        return { output: [{ id: "p1", name: "Widget" }, { id: "p2", name: "Gizmo" }] };
      }
      // Scenario 6: missing sessionId for a session-required capability.
      return { error: { code: ERROR_CODES.SESSION_REQUIRED, message: "product.list requires a sessionId", details: {}, retryable: false } };
    }
    if (name === "does.not.exist") {
      return { error: { code: ERROR_CODES.CAPABILITY_NOT_FOUND, message: "unknown capability: does.not.exist", details: { capability: "does.not.exist" }, retryable: false } };
    }
    // Scenario 9: rate limit (test trigger capability).
    if (name === "test.rate-limit") {
      return { error: { code: ERROR_CODES.RATE_LIMIT_EXCEEDED, message: "token bucket empty", details: {}, retryable: false } };
    }
    // Scenario 10: handler timeout (test trigger capability).
    if (name === "test.handler-error") {
      return { error: { code: ERROR_CODES.HANDLER_TIMEOUT, message: "handler exceeded 30000ms", details: { timeoutMs: 30000 }, retryable: true } };
    }
    return { error: { code: ERROR_CODES.CAPABILITY_NOT_FOUND, message: `unknown: ${name}`, details: {}, retryable: false } };
  },
};

// Encode a JWT-like token (base64url-encoded payload) so the lookup's
// readClaims(token).scope reads a real scope from a real-shape token.
const enc = (claims) => Buffer.from(JSON.stringify(claims), "utf-8").toString("base64url");
const JWT_PLATFORM_READ = `hdr.${enc({ scope: ["platform.*.read"] })}.sig`;
const JWT_PRODUCT_READ = `hdr.${enc({ scope: ["product.read"] })}.sig`;

const requestedPort = Number(process.env.SIM_PORT ?? 7400);
const adapter = createRestAdapter(fakeGateway, { port: requestedPort, host: "127.0.0.1" });
await adapter.start();
console.log(`READY port=${adapter.port} pid=${process.pid} platformReadToken=${JWT_PLATFORM_READ} productReadToken=${JWT_PRODUCT_READ}`);

const stop = async (signal) => {
  try {
    await adapter.stop();
  } catch (err) {
    console.error(`stop error: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(0);
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));