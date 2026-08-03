// Re-exports for the public surface of @platform/gateway-core.
// Phases 1-7 progressively add more exports; this stays the single entry point.

export type { BackendRuntime } from "@platform/backend-runtime";
export * from "./types.js";
export * from "./errors.js";
export * from "./audit.js";
export * from "./auth.js";
export * from "./origin.js";
export * from "./rate-limit.js";
export * from "./tenant-store.js";
export * from "./authz.js";
export * from "./dispatch.js";
export * from "./handle-invocation.js";
export * from "./factory.js";