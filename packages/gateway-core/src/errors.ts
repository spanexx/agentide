/*
 * Code Map: gateway-core error re-exports
 * - ERROR_CODES, GatewayError: re-exported from @platform/errors so existing
 *   call sites that import from "@platform/gateway-core" continue to work.
 *
 * The actual definitions live in packages/errors/src/index.ts because
 * both gateway-core and backend-runtime need them, and a circular dep
 * between the two packages would break the build.
 *
 * CID Index:
 * CID:errors-001 -> ERROR_CODES (re-export)
 * CID:errors-002 -> GatewayError (re-export)
 *
 * Quick lookup: rg -n "CID:errors-" packages/gateway-core/src/errors.ts
 */

export { ERROR_CODES, GatewayError } from "@platform/errors";
