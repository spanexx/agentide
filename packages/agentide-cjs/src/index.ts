// Re-exports for the public surface of @platform/agentide.
// The meta-package composes Tier 1 components + gateway-core into a single Platform handle,
// and ships the `agentide` CLI for operator day-2 operations.

export type { CreatePlatformConfig, Platform } from "./types";
export { createPlatform } from "./factory";
export { runCli, installGlobalErrorHandlers } from "./cli";
export type { ErrorSink } from "./cli";
export type { CliOptions, CliResult } from "./cli-types";

// CID:agentide-index-001 - MCP adapter re-exports (BI[9] Phase 5)
// Expose the McpAdapter/McpAdapterConfig types so consumers wiring their
// own platform can refer to the same shape the meta-package auto-registers.
export type { McpAdapter, McpAdapterConfig } from "@spanexx/adapter-mcp";
export type { WebSocketAdapter, WebSocketAdapterConfig } from "@spanexx/adapter-websocket";
