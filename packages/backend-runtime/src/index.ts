/*
 * Code Map: Backend Runtime factory
 * - createBackendRuntime: composes the ServerHandle from server.ts with the
 *   public BackendRuntime shape. start/stop delegate to the server.
 * - dispatchInvocation: Phase 1 stub (throws); Phase 4 implements.
 * - connectionCount: delegates to the server's registry.
 * - address: delegates to the server's bound address.
 *
 * Re-exports every public type from types.ts and the connection lifecycle
 * event payloads from events.ts.
 *
 * CID Index:
 * CID:index-001 -> createBackendRuntime
 */

import type {
  BackendRuntime,
  BackendRuntimeConfig,
  BackendValue,
  CapabilityRecord,
} from "./types.js";
import { createServer } from "./server.js";

export type {
  BackendRuntime,
  BackendRuntimeConfig,
  BackendConnection,
  RegisteredCapability,
  BackendValue,
  ConnectionAcceptedPayload,
  ConnectionClosedPayload,
  Clock,
} from "./types.js";

// CID:index-001 - createBackendRuntime
// Purpose: factory — wires config into the server, exposes the public shape
// Phase 2: start/stop + address + connectionCount live. dispatchInvocation
//   remains a stub (throws) until Phase 4 lands the SDK round-trip.
// Uses: server.ts (ServerHandle), types.ts
// Used by: agentide composition (Phase 6), tests
export function createBackendRuntime(config: BackendRuntimeConfig): BackendRuntime {
  const server = createServer(config);

  return {
    async start(): Promise<void> {
      await server.start();
    },

    async stop(): Promise<void> {
      await server.stop();
    },

    async dispatchInvocation(
      _owner: string,
      _capability: CapabilityRecord,
      _input: BackendValue,
      _sessionId: string | undefined,
    ): Promise<BackendValue> {
      throw new Error("Backend Runtime dispatch not yet implemented (Phase 4 stub)");
    },

    connectionCount(): number {
      return server.connectionCount();
    },

    address() {
      return server.address();
    },
  };
}