// Re-exports for the public surface of @platform/agentide.
// The meta-package composes Tier 1 components + gateway-core into a single Platform handle,
// and ships the `agentide` CLI for operator day-2 operations.

export type { CreatePlatformConfig, Platform } from "./types.js";
export { createPlatform } from "./factory.js";
export { runCli, installGlobalErrorHandlers } from "./cli.js";
export type { ErrorSink } from "./cli.js";
export type { CliOptions, CliResult } from "./cli-types.js";