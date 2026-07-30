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
// Purpose: factory — wires config into the server, exposes the public shape.
// Phases 2-4 land: start/stop + address + connectionCount + dispatchInvocation.
//   dispatchInvocation passes `capability.name` through to the dispatcher
//   (the SDK looks up handlers by name; the rest of the CapabilityRecord
//   is metadata the dispatcher doesn't need).
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
      owner: string,
      capability: CapabilityRecord,
      input: BackendValue,
      sessionId: string | undefined,
    ): Promise<BackendValue> {
      return server.dispatchInvocation(owner, capability.name, input, sessionId);
    },

    connectionCount(): number {
      return server.connectionCount();
    },

    address() {
      return server.address();
    },
  };
}