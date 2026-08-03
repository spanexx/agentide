/*
 * Code Map: adapter-websocket error codes
 * - WS_ERROR_CODES: 5 stable WS_* string identifiers (adapter-native errors)
 *
 * The adapter speaks two error vocabularies, never mixes them:
 *   1. WS_* codes (this file) — wire-shape problems the adapter owns:
 *      invalid topic, forbidden, invalid frame, internal, frame too large.
 *   2. Gateway/capability codes — passthrough verbatim on invoke.error
 *      (no third vocabulary; PRD Scenario 11).
 * Auth failures use AUTH_ERROR_CODES (types.ts) — lowercase phrases.
 *
 * CID Index:
 * CID:errors-001 -> WS_ERROR_CODES
 *
 * Quick lookup: rg -n "CID:errors-" packages/adapter-websocket/src/errors.ts
 */

// CID:errors-001 - WS_ERROR_CODES
// Purpose: adapter-native error identifiers (locked W4 sub-Q 3). Deliberately
//   WS_-prefixed so they can never collide with GATEWAY_* codes from
//   @platform/errors or capability-defined codes. Close-code mapping:
//   WS_FRAME_TOO_LARGE → close 1009; everything else is a frame, not a close.
export const WS_ERROR_CODES = {
  WS_INVALID_TOPIC: "WS_INVALID_TOPIC",
  WS_FORBIDDEN: "WS_FORBIDDEN",
  WS_INVALID_FRAME: "WS_INVALID_FRAME",
  WS_INTERNAL: "WS_INTERNAL",
  WS_FRAME_TOO_LARGE: "WS_FRAME_TOO_LARGE",
} as const;
