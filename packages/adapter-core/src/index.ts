/*
 * Code Map: @spanexx/adapter-core — shared server-side invocation pipeline
 * - Phase 1: canonical re-exports only (additive scaffold; nothing imports yet)
 * - Later phases add: readClaims (A2/A6), error converter (A5), RecordRegistry
 *   (A1), auth policy (A2), response channel (A4), createAdapterPipeline (A1),
 *   capability lookup (A6).
 *
 * Own-bytes rule (A1): doors (adapter-websocket, adapter-mcp, future adapters)
 * import ONLY this package for shared logic. Wire frames, config, transport,
 * and door-native error tables stay in the door.
 *
 * CID Index:
 * CID:adapter-core-001 -> re-export surface (errors)
 */

// Re-export the shared error envelope (A5): the GatewayErrorPayload IS the
// shared envelope across doors — single source of truth, never redefined.
export { ERROR_CODES, GatewayError } from "@spanexx/errors";
export type { GatewayErrorPayload, GatewayErrorDetailValue } from "@spanexx/errors";

// Shared claim reader (A2/A6): decode the JWT payload once, in one place.
export { readClaims } from "./read-claims.js";
export type { Claims } from "./read-claims.js";

// Shared error converter (A5): GatewayErrorPayload → door payload; door tables
// hand in via `errors: table`, unmapped codes hit the shared default.
export { createErrorConverter } from "./error-converter.js";
export type { DoorError, ErrorTable, ErrorTableEntry, ErrorConverter, ErrorConverterOptions } from "./error-converter.js";

// Generic record store (A1): door supplies the record factory + id prefix.
export { RecordRegistry } from "./record-registry.js";
export type { RecordRegistryOptions } from "./record-registry.js";

// Auth policy (A2): shared verification pipeline; door maps canonical reasons
// to wire phrases.
export { createAuthPolicy } from "./auth-policy.js";
export type {
  AuthPolicy,
  AuthPolicyContext,
  AuthPolicyMode,
  AuthPolicyOptions,
  AuthPolicyResult,
  AuthFailure,
} from "./auth-policy.js";

// Response channel (A4): per-invocation channel; door supplies the packaging
// sink, core enforces terminal guarantees (end exactly once, emit/event only
// before end).
export { createResponseChannel } from "./response-channel.js";
export type { ResponseChannel, ResponseChannelSink } from "./response-channel.js";

// Invocation pipeline (A1): shared dispatch seam — gateway handle + door
// sink factory + shared converter. Emits no events; imports gateway-core.
export { createAdapterPipeline } from "./pipeline.js";
export type { AdapterPipeline, AdapterPipelineOptions, PipelineInvocation } from "./pipeline.js";

// Capability lookup (A6): lean shared list/describe over the kernel's
// tier-aware capability.list. Ships unwired — no discovery frames in v1.
export { createCapabilityLookup } from "./capabilities/lookup.js";
export type { CapabilityCard, CapabilityDescriptor, CapabilityLookup, CapabilityLookupOptions, LookupOutcome } from "./capabilities/lookup.js";

// Session auto-mint (D-126, 2026-08-09): one canonical mint→run→destroy
// helper for door adapters, mirroring the CLI's D-79 withAutoSession so all
// doors follow the session-manager GRILL contract (per-request short
// sessions, transparent to the client).
export { withAutoMintSession } from "./session-mint.js";
export type { AutoMintOptions } from "./session-mint.js";
