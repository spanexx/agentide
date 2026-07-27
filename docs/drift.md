# Drift Log
**Last updated:** 2026-07-27  **Open:** 1  **Resolved:** 0  **Critical/High:** 0

## Open

- **D-1** (Medium, 2026-07-27, reporter: session-manager implementation) — session-manager pipeline documents disagree on touch visibility, resource attach state, and minimum timeout values.
  - Doc claim: `SessionManager` interface omits `touch()`, while FLOW requires every capability call to reset the idle timer (`docs/features/session-manager/TRD-session-manager.md:194-220`, `docs/features/session-manager/FLOW-session-manager.md:39-42`)
  - Code reality: public API includes `touch(sessionId)`, and attach permits suspended sessions (`packages/session-manager/src/types.ts:70-82`, `packages/session-manager/src/resources.ts:8-16`)
  - Why matters: Gateway integration and timeout tests need one consistent contract.
  - Owner: session-manager
  - To fix: reconcile PRD/TRD/FLOW/IMPL in follow-up doc pass.
  - Related: none

## Resolved
