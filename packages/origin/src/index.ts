/**
 * Code Map: @platform/origin
 * - originMatches: RFC 6125 §6.4.3 single-label wildcard matching for
 *   expectedOrigins JWT claims. Extracted from gateway-core so both doors
 *   (backend-runtime, adapter-websocket) share one primitive without a
 *   package cycle (gateway-core depends on backend-runtime).
 */

export { originMatches } from "./origin.js";
