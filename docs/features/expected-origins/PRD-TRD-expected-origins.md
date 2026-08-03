# PRD-TRD — expected-origins (mint-side `expectedOrigins`)

**Slug:** expected-origins
**Status:** Locked 2026-08-03 (grill-lite gate passed; see `GRILL-expected-origins.txt`)
**Owner:** gateway-core + agentide CLI
**Closes drift:** D-50 (High)
**Depends on:** adapter-websocket (shipped — enforcement half, W2 sub-Q 4), sdk-browser T5 Q2 (permanent origin-binding lock), dashboard-core D4 (mint pattern)
**Type:** additive, cross-package — `@platform/gateway-core` + `@platform/agentide`

## Problem

Origin-bound tokens cannot be minted: the `expectedOrigins` claim is never
issued, so the shipped enforcement (adapter-websocket deny-by-default) has
nothing to enforce in practice. This pack makes the claim issuable end-to-end:
operator API, capability handler, and CLI.

## Non-goals

- Enforcement changes (adapter-websocket `auth.ts` / `origin.ts` — shipped, zero changes).
- backend-runtime sdk-browser enforcement (tracked follow-up, backlog row 24).
- `--kind browser|node` flag (enforcement keys on `Origin`-header presence, not a mint marker).
- Mint-time pattern validation (invalid patterns never match → deny-by-default is the safety net).
- Dashboard changes (D4's in-process `issueToken({…expectedOrigins})` works once the field exists).
- Revocation / refresh changes.

## Scenarios

### S1 — Operator mints an origin-bound token via the CLI

```
agentide token issue --tenant acme --caller agent-1 \
  --origin https://app.acme.com --origin https://*.dev.acme.com \
  --origins "https://api.acme.com, https://app.acme.com" --data-dir /data
```

Expected: exit 0; printed JWT's payload carries
`"expectedOrigins":["https://app.acme.com","https://*.dev.acme.com","https://api.acme.com"]`
(union of both flags; duplicates removed; first-occurrence order preserved).

### S2 — Matching origin authenticates; mismatched origin rejected

Mint per S1. Connect a ws client with `Origin: https://app.acme.com` →
`auth.ok`. Connect with `Origin: https://evil.example.com` → `auth.error`
`code:"origin mismatch"` then close 1008. (Runs in the post-impl sim as S4b.)

### S3 — Backward compatibility

`agentide token issue --tenant acme --caller agent-1 --scope "a,b" --data-dir /data`
(no origin flags) → exit 0; payload has NO `expectedOrigins` key — byte-identical
behavior to today. `gateway.issueToken({tenantId, callerId, scope})` likewise
omits the claim. `expectedOrigins: []` → claim omitted.

### S4 — Capability handler mints the claim

Invoke `auth.token.issue` with `{tenantId, callerId, scope, expectedOrigins:[...]}`
→ response carries `claims.expectedOrigins` = the input array.

## Acceptance

1. `IssueTokenRequest.expectedOrigins?: readonly string[]` (optional, additive).
2. `gateway.issueToken()` and `auth.token.issue` mint the signed claim when present; `[]` → absent.
3. Claim round-trips `verifyToken`; later mutation of the request array doesn't change the minted claim (spread copy).
4. CLI: `--origin` repeatable + `--origins <csv>`; trim, drop-empty, dedupe first-occurrence; no flags → claim absent.
5. Tests: 6 gateway-core + 7 CLI; full suite green; precommit chain green.
6. Sim S4b proves the real mint path (CLI-minted token → match ok / mismatch 1008).
7. Drift D-50 closed; backlog rows 24/13 + CONTEXT.md updated.

## Notes

- Pre-impl sim skipped by design: design locked by three prior wayfinder grills
  (T5 Q2, W2 Q4, D4); this pack only connects existing seams.
- Claims serialization: `issueToken` signs `JSON.stringify(claims)` — the field
  rides into the payload automatically; no canonicalization needed.
- Authz interplay: none — `expectedOrigins` is identity-context, checked at
  auth (before authz) by the adapter.
- Token refresh (W2 Q3) re-checks the claim against the fixed upgrade `Origin` —
  no adapter change.
