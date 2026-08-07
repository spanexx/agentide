import type { Gateway, YamlValue } from "@spanexx/gateway-core";

/**
 * REST adapter configuration.
 *
 * CID:adapter-rest-types-001 — defaults, port, host, optional headers.
 * Source: docs/features/rest-adapter/PRD-TRD-rest-adapter.md §"API Contracts".
 */
export interface RestAdapterConfig {
  /**
   * TCP port to bind. Default 7400 — confirmed unallocated by A9-R1 §11
   * (MCP 7100, dashboard 7200, WS 7300, backend-runtime 7350 are taken).
   */
  readonly port?: number;

  /**
   * Host to bind. Default "127.0.0.1" — loopback only. Operators front
   * with a reverse proxy for production access.
   */
  readonly host?: string;
}

/**
 * Adapter handle returned by createRestAdapter.
 * Mirrors the `Adapter` shape from gateway-core (`packages/gateway-core/src/types.ts:197-201`).
 */
export interface RestAdapter {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** The bound port — useful for tests that boot on port 0. */
  readonly port?: number;
}

/**
 * The HTTP-side request envelope. The door-local shape — the canonical
 * `CanonicalInvocation` is built inside the adapter-core pipeline.
 */
export interface RestInvokeRequest {
  readonly capability: string;
  readonly input?: Readonly<Record<string, YamlValue>>;
  readonly sessionId?: string;
}

/**
 * Status map entry: a GatewayErrorPayload `code` prefix → HTTP status.
 * Locked by A9 Q4; the table is the door's `errors.ts` data.
 */
export interface StatusMapEntry {
  readonly gatewayCodePrefix: string;
  readonly httpStatus: number;
}

/**
 * Re-export of the `Gateway` interface — keeps the door-public surface
 * cohesive without making consumers import gateway-core directly.
 */
export type { Gateway };
