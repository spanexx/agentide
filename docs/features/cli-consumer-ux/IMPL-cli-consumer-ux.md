# IMPL: cli-consumer-ux

**Slug:** cli-consumer-ux
**Status:** Complete
**Date:** 2026-08-06

## Phase Plan

5 phases. Each is small, with a single-file scope. Phases 1, 2, 3 are independent infrastructure; phases 4, 5 add the UX layer.

### Phase 1: URL port defaulting (consumer.ts)

**Build:**
- New file `packages/agentide/src/url-default.ts` with `applyPortDefault(rawUrl: string): string`. Uses `new URL()` (WHATWG). If `.port === ''`, returns `url.protocol + '//' + url.host + ':7300' + url.pathname + url.search + url.hash`. Otherwise returns the input unchanged. Throws `ConfigError("invalid URL: <rawUrl>", 2)` on parse failure.
- Export from `consumer.ts` and call it in `runConsumer` after `resolveConfig` returns: `url = applyPortDefault(url)`.
- Update `packages/agentide/src/__tests__/url-default.test.ts` (new file): 4 cases — already has port, no port, malformed URL, IPv6 host.

**Verify:**
- [ ] `pnpm --filter @spanexx/agentide test src/__tests__/url-default.test.ts` — 4 tests pass.
- [ ] `agentide sessions --url ws://127.0.0.1/ws --token ...` against a gateway on `:7300` returns the session list (was previously failing with the wrong-url error).
- [ ] `agentide sessions --url ws://127.0.0.1:7300/ws --token ...` (already has port) — behavior unchanged.

**Blocked by:** nothing.

### Phase 2: WS client handshake timeout + door-mismatch error (adapter-websocket)

**Build:**
- `packages/adapter-websocket/src/client.ts`: add `authTimeoutMs?: number` (default `3000`) to `WsClientOptions`. After `client.open()` completes the WS upgrade, start a timer. If `auth.ok` doesn't arrive within `authTimeoutMs`, reject with new `WsDoorMismatchError` (extends `Error`, has `code: "GATEWAY_DOOR_MISMATCH"`).
- Export `WsDoorMismatchError` from `packages/adapter-websocket/src/index.ts`.
- Test file `packages/adapter-websocket/src/__tests__/client-timeout.test.ts`: 3 cases — happy path (auth.ok arrives), timeout fires (server stays silent), explicit `authTimeoutMs: 100`.

**Verify:**
- [ ] `pnpm --filter @spanexx/adapter-websocket test src/__tests__/client-timeout.test.ts` — 3 tests pass.
- [ ] Full adapter-websocket test suite still green (`pnpm --filter @spanexx/adapter-websocket test`).

**Blocked by:** nothing.

### Phase 3: Wire wrong-door error message in consumer (consumer.ts)

**Build:**
- In `runConsumer`, the existing `client.open()` catch (L186-188) now also catches `WsDoorMismatchError` and emits the locked message (Q2): `error: --url points to the SDK door (port 7350); the CLI consumer needs the websocket adapter (port 7300). Override with --url ws://...:7300/ws.` Exit 2 (pre-flight).
- Update `packages/agentide/src/__tests__/consumer.test.ts`: 1 new case — feed a fake WS server that completes the WS upgrade but sends no `auth.ok`. Assert the stderr message matches verbatim and exit code is 2.

**Verify:**
- [ ] `pnpm --filter @spanexx/agentide test src/__tests__/consumer.test.ts` — all tests pass (existing + new).
- [ ] Manual: `agentide sessions --url ws://127.0.0.1:7350/ws --token ...` against a gateway with both doors proves the SDK door case in the e2e test now exits 2 with the locked message.

**Blocked by:** Phase 2 (needs `WsDoorMismatchError`).

### Phase 4: session auto-mint for invoke (consumer.ts)

**Build:**
- New file `packages/agentide/src/session-mint.ts` with `withAutoSession(client, fn, opts: { timeoutMs?: number })`. Calls `client.invoke("session.create", {})` → captures `result.id` → calls `fn(sessionId)` → best-effort `client.invoke("session.destroy", { sessionId })` in a `finally` (errors are logged to a warnings array, not thrown).
- In `runInvoke` (consumer.ts L236-274), branch on `flagValue(flags, "session")`:
  - If supplied: existing path (no auto-mint).
  - If omitted: wrap the `client.invoke(name, ...)` call in `withAutoSession`. The function signature is unchanged; the internal invoke is wrapped.
- Update `packages/agentide/src/__tests__/consumer.test.ts`: 2 new cases — invoke with no --session auto-mints + destroys (assert the scripted gateway saw `session.create` then `session.destroy`); invoke with --session supplied does NOT auto-mint.

**Verify:**
- [ ] `pnpm --filter @spanexx/agentide test src/__tests__/consumer.test.ts` — all tests pass.
- [ ] E2E: `agentide invoke product.list --args '{}' --url ws://127.0.0.1:7300/ws --token ...` against the gateway + example app now returns the product list (exit 0) instead of `GATEWAY_SESSION_REQUIRED`.

**Blocked by:** nothing.

### Phase 5: watch session destroy on clean exit (consumer.ts runWatch)

**Build:**
- In `runWatch` (consumer.ts L276-340), after the auto-mint succeeds (re-uses `withAutoSession` from Phase 4), wrap the watch loop in a `try/finally`. The finally block sends `session.destroy` only if the watch exited cleanly (via `settle()` with exit 0); non-clean exits (close before SIGINT) skip the destroy to avoid spamming errors.
- Update `packages/agentide/src/__tests__/consumer.test.ts`: 1 new case — `agentide watch sessions` against a scripted gateway, invoke the signal handler, assert the gateway saw `session.destroy` after `session.create` + `subscribe`.

**Verify:**
- [ ] `pnpm --filter @spanexx/agentide test src/__tests__/consumer.test.ts` — all tests pass.
- [ ] Manual: `agentide watch sessions --url ws://127.0.0.1:7300/ws --token ...` then Ctrl-C. Gateway log shows `session.create` → snapshot invoke → subscribe → (events) → `session.destroy`. Exit 0.

**Blocked by:** Phase 4 (uses `withAutoSession`).

## Phase Dependencies

```
Phase 1 (URL default)  ──┐
                         ├─→ Phase 3 (Wire wrong-door)  ──┐
Phase 2 (WS timeout)  ───┘                                │
                                                          ├─→ Phase 5 (Watch)
Phase 4 (Invoke auto-mint) ───────────────────────────────┘
```

Phases 1 and 2 can ship in parallel. Phase 3 needs both. Phase 4 can ship independently. Phase 5 needs Phase 4.

## Test Strategy

- **Unit tests** in `packages/agentide/src/__tests__/` — vitest, like the existing consumer.test.ts. New files: `url-default.test.ts`. Expanded: `consumer.test.ts` (3 new cases).
- **Adapter tests** in `packages/adapter-websocket/src/__tests__/` — vitest. New file: `client-timeout.test.ts`.
- **Integration / e2e** — re-run `agentide/docs/testing/e2e-2026-08-06.sh` and expect all 6 scenarios from the PRD-TRD to PASS.
- **Full suite** — `pnpm -r test` must stay green.
- **Typecheck** — `pnpm -r typecheck` (already on AGENTS.md rule 7).
- **Lint** — `pnpm -r lint` (per repo convention).

## Dependency Analysis

No new external deps. The pack uses:

- `node:url` WHATWG parser — already used in the repo (e.g. `packages/agentide/src/cli.ts`).
- `node:timers` for the handshake timeout — built-in.

## Rollout

- All phases ship in a single release (e.g. `agentide@0.3.2` or `0.4.0`).
- No migration needed — the changes are additive (auto-mint when omitted is the new default; the existing `--session` flag still works).
- No flag flips.
- The help text update for `--url` is part of Phase 1 (consumer.ts comment) — see `packages/agentide/src/cli.ts` L52 for the help string.

## Risk Notes

- **Phase 2 timeout heuristic is timer-based.** If the SDK door's silent-ignore behavior ever changes (e.g. a server-side config adds a fast "wrong protocol" reject), the timeout would still work but the error message would be less targeted. Acceptable for v1.
- **Phase 4 secondary destroy failure.** If `session.destroy` fails after the invoke succeeded, the result still returns to the operator; the destroy error is logged to `warnings` and printed to stderr (Q1: "best-effort destroy"). The session leaks until idle timeout. Same as the SDK.
- **Phase 5 watch reconnect.** Non-clean exit (network drop, gateway restart) skips the destroy intentionally. The session leaks until the session manager's idle timeout. Matches the parent GRILL's "watch reconnect is out of scope." Documented in the runtime warnings output.
- **The pre-impl sim's URL parser is naive.** IMPL must use `new URL()`. The reason the pre-impl sim produced `ws://7300//localhost/ws` is the sim's regex — irrelevant to IMPL, but the warning is in the PRD-TRD.
