/*
 * Code Map: platform-capabilities public API
 * - registerPlatformCapabilities: registers all 25 platform-cap records under their real owners
 *
 * CID Index:
 * CID:index-001 -> registerPlatformCapabilities
 *
 * Quick lookup: rg -n "CID:index-" packages/platform-capabilities/src/index.ts
 */
export * from "./caps.js";
export * from "./register.js";
