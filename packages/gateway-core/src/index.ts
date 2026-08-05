// Re-exports for the public surface of @platform/gateway-core.
// Phases 1-7 progressively add more exports; this stays the single entry point.

export type { BackendRuntime } from "@spanexx/backend-runtime";
export * from "./types.js";
export * from "./errors.js";
export * from "./audit.js";
export * from "./auth.js";
export { originMatches } from "@spanexx/origin";
export * from "./rate-limit.js";
export * from "./tenant-store.js";
export * from "./authz.js";
export * from "./dispatch.js";
export * from "./handle-invocation.js";
export * from "./factory.js";export type {
  ClientRecord,
  RegistrationCode,
  ClientStore,
} from "./types.js";
export { FileSystemClientStore } from "./client-store.js";
export { ClientService } from "./client-service.js";
export * from "./oauth-token-handler.js";
