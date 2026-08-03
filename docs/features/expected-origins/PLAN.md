# PLAN — Mint-side `expectedOrigins` (origin-bound tokens)

**Slug:** expected-origins
**Status:** Approved-for-implementation (research complete)
**Date:** 2026-08-03
**Type:** additive, cross-package: `@platform/gateway-core` + `@platform/agentide` CLI + post-impl sim + docs
**Closes drift:** D-50 (High)
**Related locked decisions:** sdk-browser T5 Q2 (permanent), adapter-websocket W2 sub-Q 4 (enforcement), dashboard-core D4 (mint pattern: `gateway.issueToken({..., expectedOrigins: [...]})` per page load)

---

## 1. Problem

Enforcement of origin-bound tokens is shipped (adapter-websocket `auth.ts` rejects
upgrade `Origin`s that don't match `claims.expectedOrigins`, deny-by-default for browsers).
The mint side does not exist: `IssueTokenRequest` has no `expectedOrigins` field, `issueToken`
never emits the claim, and the CLI has no flags. Result: no token in the wild carries the
claim, so origin binding is never exercised in practice (drift D-50).

## 2. Scope

1. `IssueTokenRequest.expectedOrigins?: readonly string[]` (additive, optional).
2. `gateway.issueToken()` closure and the `auth.token.issue` capability handler mint the
   claim into the JWT payload when present.
3. CLI `agentide token issue` gains `--origin <url>` (repeatable) and `--origins <csv>`.
4. Unit tests (gateway-core + agentide CLI).
5. Post-impl sim: new scenario S4b — mint an origin-bound token via the real CLI, connect
   from a matching origin (auth.ok), connect from a mismatched origin (auth.error
   `origin mismatch` → close 1008).
6. Docs: close drift D-50, update Feature_Backlog row 24 + row 13, add CONTEXT.md decision-log
   entry, commit chain.

## 3. Non-goals (explicit)

- **Enforcement changes.** adapter-websocket `auth.ts` / `origin.ts` / `originMatches` are
  shipped and correct. Zero changes.
- **backend-runtime sdk-browser enforcement.** backend-runtime still does not check
  `expectedOrigins` on its browser-token path (already tracked as a cross-pack follow-up in
  Feature_Backlog row 24). Minted claims are simply ignored there until that pack lands.
- **`--kind browser|node` flag.** T5 Q2 mentions it; D-50's To-fix does not. Enforcement
  keys on `Origin`-header presence (W2 sub-Q 4: "Origin absent (Node client) → no check"),
  so `--kind` adds no behavior. Decided out of scope at grill-lite; revisit only if a real
  consumer asks.
- **Mint-time pattern validation** (URL parsing / wildcard grammar checks). Invalid patterns
  are safe: they simply never match, and enforcement is deny-by-default. CLI validates only
  non-emptiness (mirrors existing `--scope` csv handling at `cli.ts:218`).
- **Dashboard mint UI.** Dashboard D4 mints in-process via `gateway.issueToken` per page
  load — that call works unchanged once the field exists. No dashboard code changes.
- **Revocation / deny-list / token refresh changes.** `auth.token.revoke` stays a v1 no-op.
- **`factory.ts` line-count refactor.** `factory.ts` is 545 lines (over the 350 rule) but
  pre-existing; splitting it balloons this pack. Flagged, not fixed here.
- **Docs drift D-52, D-45…D-49.** Unrelated open drifts; only D-50 is closed by this pack.

## 4. Phase breakdown (feature-pipeline conventions, adapted)

| Phase | Deliverable | Gate |
|---|---|---|
| 0 grill-lite | `GRILL-expected-origins.txt` (decision questions + assumed answers) | user locks the 6 questions |
| 1 gateway-core | `IssueTokenRequest` + 2 claim-build sites + tests | `pnpm exec vitest run packages/gateway-core` green |
| 2 CLI | repeatable flag parsing + `--origin`/`--origins` + tests + HELP | `pnpm exec vitest run packages/agentide` green |
| 3 sim + docs | sim S4b + sim-state fixtures + drift D-50 close + backlog + CONTEXT.md | sim runs PASS; drift header counts updated |
| 4 verification + commits | precommit chain, full suite, commits | `pnpm precommit` green, sim PASS, 5 commits |

Pre-impl sim is **skipped by design**: the design is already locked by three prior
wayfinder grills (T5 Q2, W2 Q4, D4) and this pack only connects existing seams — a
design-time sim would re-litigate locked decisions. Documented in the PRD-TRD.

### Phase 0 — grill-lite (decision questions + assumed answers)

**Q1 — Flag syntax.** `--origin <url>` repeatable AND `--origins <csv>`.
Assumed answer: both, per T5 Q2 wording ("`--origin` / `--origins` options").
Behavior: each `--origin` occurrence adds one entry; `--origins` splits on `,`;
both given → union; dedupe keeping first-occurrence order.
Why repeatable matters: multi-origin tokens are locked (W2 sub-Q 4 "dev + staging in one
token"; D4 "expectedOrigins carries BOTH localhost/127.0.0.1 forms" — two exact entries,
no wildcard trick possible).

**Q2 — Empty / whitespace values.** Assumed: entries are trimmed; empty or whitespace-only
entries are dropped silently (exactly mirrors `--scope` csv handling, `cli.ts:218`).
Resulting empty list → field omitted entirely → claim absent → behavior identical to
today (Node bypass / browser deny-by-default per W2 Q4).

**Q3 — Duplicates.** Assumed: dedupe exact strings, keep first occurrence order.
Wildcard + exact overlap (`https://*.acme.com` + `https://app.acme.com`) both kept —
an allowlist union is harmless; no conflict semantics.

**Q4 — Empty array from a direct API caller.** Assumed: `expectedOrigins: []` is
normalized to absent (claim omitted). Cosmetic: both shapes are deny-by-default for
browsers (W2 Q4: "missing/empty claim … deny-by-default").

**Q5 — Validation at mint.** Assumed: CLI-level only — trim, drop empty, dedupe.
No URL parsing, no wildcard grammar check (see Non-goals). Gateway stays
additive-no-validation, mirroring how `scope` is passed through unvalidated.

**Q6 — `--kind` flag.** Assumed: not in this pack (see Non-goals).

**Deliverable:** `docs/features/expected-origins/GRILL-expected-origins.txt` — six Q&As,
verbatim questions, assumed answers, why, source (T5 Q2 lock, W2 Q4 lock, D4 lock, code
cites). **Gate:** user locks; edits go back into the txt.

### Phase 1 — gateway-core (types + claim injection + tests)

**File: `packages/gateway-core/src/types.ts`**

1. `IssueTokenRequest` (lines 186–191) — add after `scope` (line 189):
   ```ts
   readonly expectedOrigins?: readonly string[];
   ```
2. Code Map header line 10 (`TokenClaims: JWT payload (sub: …, scope, iat, exp)`) →
   `…, expectedOrigins, iat, exp)`. `TokenClaims` itself (line 117–123) already has the
   field (line 120) — no change.

**File: `packages/gateway-core/src/factory.ts`** — two claim-build sites, identical spread:

1. `Gateway.issueToken` closure (lines 161–170). After `scope: [...req.scope],` (line 164):
   ```ts
   ...(req.expectedOrigins !== undefined ? { expectedOrigins: [...req.expectedOrigins] } : {}),
   ```
   Spread copy mirrors `[...req.scope]` so later mutation of the request array cannot
   change the minted claim. `issueToken(claims, secret, clock)` (imported from
   `./auth.js`, `factory.ts:27`) signs the whole claims object via
   `JSON.stringify(claims)` (`packages/gateway-core/src/auth.ts:37`) — the new field
   rides into the payload automatically.
2. `auth.token.issue` capability handler (lines 266–283). Extend the input cast
   (line 267): `{ tenantId?: string; callerId?: string; scope?: readonly string[]; expiresInMs?: number; expectedOrigins?: readonly string[] }`. In the claims build, after
   `scope: i.scope as readonly string[],` (line 278):
   ```ts
   ...(Array.isArray(i.expectedOrigins) ? { expectedOrigins: i.expectedOrigins } : {}),
   ```
   (`wrap` JSON-round-trips the input, so the field arrives as a plain array.)

Nothing strips the field on read: `verifyToken` parses the payload wholesale
(`packages/gateway-core/src/auth.ts:87–92`); `adapter-websocket/src/auth.ts:59` reads
`verified.claims.expectedOrigins ?? []`; `originMatches` is re-exported from the
gateway-core root (`packages/gateway-core/src/index.ts:9`). No index.ts change needed.

**New test file: `packages/gateway-core/src/__tests__/issue-token.test.ts`**
(Code Map header + `CID:issue-token-001`; under 350 lines). Boots `createGateway` with
the standard test harness (in-memory fs, FakeClock — copy the pattern from
`handle-invocation.test.ts:40–60`):

1. `"issueToken mints expectedOrigins into claims when requested"` — `issueToken({…,
   expectedOrigins: ["https://app.acme.com","https://*.dev.acme.com"]})` returns
   `{token, claims}` whose `claims.expectedOrigins` equals the request array.
2. `"claim is absent when expectedOrigins omitted"` — `claims` has no
   `expectedOrigins` key; decoded payload likewise.
3. `"empty array normalizes to absent"` — `expectedOrigins: []` → no key.
4. `"JWT round-trips the claim in exact order"` — decode the token payload
   (base64url) or `verifyToken`; array equals `["b","a","c"]` exactly as given.
5. `"later mutation of the request array does not change the minted claim"` — mutate
   `req.expectedOrigins.push(...)` after the call; `claims.expectedOrigins` unchanged
   (spread-copy guard).
6. `"auth.token.issue capability mints expectedOrigins from input"` — via
   `handleInvocation` with a bootstrap `["*"]` token invoking `auth.token.issue` with
   `expectedOrigins: ["https://app.acme.com"]`; response `claims.expectedOrigins`
   present (mirror the invocation pattern in
   `plugin-system-handlers.test.ts:60–75`).

Existing `packages/gateway-core/src/__tests__/auth.test.ts:106–113` already covers
`issueToken`/`verifyToken` claim round-trip — untouched.

**Verify:** from `agentide/` root: `pnpm exec vitest run packages/gateway-core`.

### Phase 2 — agentide CLI (`--origin` / `--origins`)

**File: `packages/agentide/src/cli.ts`**

1. **Repeatable-flag support (the key finding — see §7 Risks).** `parseArgs`
   (lines 49–72) is last-wins: line 63 `flags[key] = next` overwrites repeated flags.
   Change `ParsedArgs.flags` (line 46) to `Record<string, string | boolean | string[]>`:
   in `parseArgs`, when `flags[key]` already exists as a string and a new value arrives,
   promote to `[old, new]`; further occurrences append. Boolean form unchanged.
2. **`getFlag` backward compatibility** (lines 74–77): if `Array.isArray(v)`, return the
   LAST element — preserves today's last-wins semantics for `--scope`/`--tenant`/
   `--caller` exactly.
3. **New helper** next to `getFlag`:
   ```ts
   function getFlagAll(flags: Record<string, string | boolean | string[]>, key: string): string[] {
     const v = flags[key];
     if (Array.isArray(v)) return v;
     return typeof v === "string" ? [v] : [];
   }
   ```
4. **HELP text** (line 36): `agentide token   issue --tenant <id> --caller <id> [--scope <csv>] [--origin <url> ...] [--origins <csv>] [--data-dir <path>]`.
5. **`runToken`** (lines 206–231): after the scope parse (line 218) add:
   ```ts
   const origins = [
     ...getFlagAll(flags, "origin"),
     ...getFlag(flags, "origins", "").split(","),
   ].map((s) => s.trim()).filter(Boolean);
   const expectedOrigins = [...new Set(origins)];
   ```
   and pass at line 226:
   ```ts
   const { token } = await platform.gateway.issueToken({
     tenantId, callerId, scope,
     ...(expectedOrigins.length > 0 ? { expectedOrigins } : {}),
   });
   ```
   Empty/whitespace entries dropped (mirrors `--scope`, line 218); dedupe keeps
   first-occurrence order; no flags → field omitted → byte-identical behavior to today.
   Line budget: cli.ts 304 → ~335 lines, under the 350 rule.
   Error messages: none new — silent drop matches the existing csv convention; document
   in GRILL Q2.

**File: `packages/agentide/src/__tests__/cli.test.ts`** — add after the existing
`"token issue"` test (line 70–81). Local helper `decodeJwt(token)` = base64url-decode
part 2 → `JSON.parse` (base64url is `Buffer.toString("base64url")` — the CLI mints with
Node's built-ins; a `atob`-free helper using `Buffer` matches repo style).

1. `"token issue --origin binds the token (claim in JWT payload)"` — `["token","issue","--tenant","acme","--caller","agent-1","--origin","https://app.acme.com","--data-dir","/data"]` → payload `expectedOrigins` deep-equals `["https://app.acme.com"]`.
2. `"token issue --origins comma-separated binds multiple origins"` — `--origins "https://a.example.com,https://b.example.com"` → both present, in order.
3. `"token issue --origin repeatable collects all occurrences"` — two `--origin` flags → both present.
4. `"token issue --origin + --origins merge and dedupe"` — `--origin https://a.com --origin https://b.com --origins "https://b.com,https://c.com"` → `["https://a.com","https://b.com","https://c.com"]` (order = first occurrence).
5. `"token issue --origins drops empty and whitespace entries"` — `--origins " https://a.com ,, ,  https://b.com  "` → two entries, trimmed.
6. `"token issue without origin flags omits expectedOrigins (backward compat)"` — payload has NO `expectedOrigins` key; exit 0.
7. `"token issue with --origin round-trips through gateway verify"` — optional: reuse the integration pattern (`integration.test.ts:74`) — token minted with `--origin` verifies via `verifyToken` against the on-disk secret with the claim intact.

**Verify:** `pnpm exec vitest run packages/agentide`.

### Phase 3 — sim + docs (e2e mint-side proof)

**File: `packages/agentide/scripts/simulate-websocket-adapter.mjs`**

- Header scenario list (lines 14–29): add `S4b Mint-side origin binding (CLI-minted
  token: matching origin auth.ok; mismatched origin auth.error + 1008)`.
- Insert the scenario block after the S4 block (after line 222 `await sleep(5);`,
  before the S5 comment at line 224). Design — this closes the real gap: today S4 mints
  with a hand-rolled JWT (`mintToken`, lines 66–77), bypassing the gateway mint path
  entirely. S4b must mint through the real path:
  ```js
  // S4b: mint-side origin binding — token issued through the real CLI mint path
  {
    const cliFs = makeInMemoryFs();               // same fs instance → same secret
    const cli = await bootPlatform({ fs: cliFs, wsPort: 0 });
    try {
      const cliResult = await runCli(
        ["token", "issue", "--tenant", "default", "--caller", "sim-cli",
         "--origin", "https://app.acme.com", "--data-dir", "/data"],
        { fs: cliFs },
      );
      const token = cliResult.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
      assert("S4b CLI mint exits 0", cliResult.exitCode === 0);
      assert("S4b minted token parses as JWT", /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token));
      const decoded = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf-8"));
      assert("S4b claim expectedOrigins present", JSON.stringify(decoded.expectedOrigins) === JSON.stringify(["https://app.acme.com"]));
      // matching origin → auth.ok
      const ok = await openSocket(cli.wsAdapter.address().port, "https://app.acme.com");
      try {
        send(ok, { type: "auth", token });
        const frame = await nextMessage(ok);
        assert("S4b matching origin connects", frame.type === "auth.ok");
      } finally { closeSocket(ok); }
      await sleep(5);
      // mismatched origin → auth.error origin mismatch + 1008
      const bad = await openSocket(cli.wsAdapter.address().port, "https://evil.example.com");
      try {
        send(bad, { type: "auth", token });
        const frame = await nextMessage(bad);
        assert("S4b mismatched origin reports 'origin mismatch'", frame.code === "origin mismatch");
        const code = await nextCloseCode(bad);
        assert("S4b mismatched origin closes 1008", code === 1008);
      } finally { closeSocket(bad); }
    } finally { await cli.stop(); }
  }
  ```
  Add `runCli` to the imports from `@platform/agentide` (line 36).
  Note: the S4b platform must be booted with the same in-memory fs instance used for the
  CLI so both share the seeded `gateway-secret` (`sim-state`-style seeding via
  `makeInMemoryFs()`, line 136–147). Assertion count in the final tally
  (`passed`/`failed`) updates automatically.
- **sim-state.json fields (interconnected-simulation contract):** extend
  `packages/agentide/scripts/sim-state.mjs` (a) header comment (lines 10–18) to list
  `expectedOrigins` as an optional field of `tokens` fixtures and `channel` as
  configurable; (b) `recordAudit` (line 73–84): replace hardcoded
  `channel: "mcp"` (line 81) with `channel: "shared"` parameter defaulting to the
  caller's tag (pass `channel: "websocket-adapter"` from the ws sim's final
  `recordAudit`, line 413–418). (Pre-existing quirk: the ws sim header claims
  channel `"websocket-adapter"` but `recordAudit` hardcodes `"mcp"` — fixed here.)
  (c) S4b appends a fixture to `state.tokens`: `{ id: "origin-bound-sim-cli",
  tenant: "default", caller: "sim-cli", scope: ["platform.*.read"],
  expectedOrigins: ["https://app.acme.com"], issued: "<ISO>" }` via `mutateState`,
  demonstrating the shared-state read by sibling sims (`tokenFixtures()`).

**File: `docs/drift.md`** — close D-50:
- Move the D-50 entry (lines 6–12) to the Resolved section, format mirroring D-51
  (lines 67–74): `**D-50** (Resolved 2026-08-03, expected-origins implementation) — …`
  with a `Verified by:` line citing `packages/gateway-core/src/types.ts:186-191`,
  `packages/gateway-core/src/factory.ts:161-170,266-283`, `packages/agentide/src/cli.ts:206-231`,
  tests, and `simulate-websocket-adapter.mjs` S4b.
- Header (line 2): `Open: 7 → 6`, `Resolved: 34 → 35`, `Critical/High: 2 → 1`.

**File: `docs/Feature_Backlog.md`** — two edits:
- Row 24 (line 46): append to the cross-pack follow-up sentence: `expectedOrigins mint
  side (D-50) CLOSED 2026-08-03 — `gateway.issueToken`/`auth.token.issue` accept
  `expectedOrigins`, CLI has `--origin`/`--origins` (docs/features/expected-origins/).
  Remaining follow-up: backend-runtime browser-path enforcement.`
- Row 13 (line 78): replace `drift D-50 (origin-claim mint side) is in-pack work` →
  `drift D-50 mint side CLOSED 2026-08-03 (expected-origins pack) — dashboard D4's
  `gateway.issueToken({…expectedOrigins})` mint call works as locked; no dashboard code
  change needed`.

**File: `docs/CONTEXT.md`** — append one Decisions Log entry (format: date — topic —
decision): `2026-08-03 — expected-origins mint side (drift D-50) — IssueTokenRequest
gains optional expectedOrigins: string[]; issueToken + auth.token.issue mint the signed
claim when present (empty → absent); CLI token issue gains repeatable --origin <url> and
comma-list --origins <csv> (union, trim, dedupe, first-occurrence order; no flags →
claim omitted); no --kind flag (enforcement keys on Origin-header presence, W2 Q4);
no mint-time URL/wildcard validation (invalid patterns never match → deny-by-default is
the safety net); sdk-browser/backend-runtime enforcement remains a tracked follow-up
(backlog row 24). Source: grill-lite GRILL-expected-origins.txt; T5 Q2; W2 Q4; D4.`

**Verify:** `node packages/agentide/scripts/simulate-websocket-adapter.mjs` from
`agentide/` → `31/31` scenarios PASS (30 existing + S4b's assertions counted; expected
tally ≈ 39 assertions, `passed`, `failed 0`).

### Phase 4 — verification + commits

**Verification sequence (from `agentide/`, the git root):**
1. `git -C agentide status` — expect only intended files + the pre-existing
   `data/sim-state.json` residue (see §7 — do NOT revert or commit it without asking).
2. `pnpm exec vitest run packages/gateway-core packages/agentide` (targeted).
3. `pnpm test` (full suite — root script `vitest run --passWithNoTests`).
4. `pnpm precommit` — the chain: `bash scripts/check-banned-types.sh && npm run
   typecheck && npm run lint && npm run build`.
5. `node packages/agentide/scripts/simulate-websocket-adapter.mjs` → PASS.
6. `pnpm exec vitest run` once more post-sim (sim mutates `data/sim-state.json` only).

**Commits (repo style `type(scope): subject`, one per phase):**
1. `docs(expected-origins): grill-lite — lock flag syntax, validation, dedupe, backward-compat`
2. `feat(gateway-core): mint expectedOrigins claim via issueToken + auth.token.issue`
3. `feat(agentide): token issue gains repeatable --origin and --origins flags`
4. `feat(expected-origins): sim S4b — CLI-minted origin-bound token e2e (match ok / mismatch 1008)`
5. `docs(expected-origins): close drift D-50; update backlog rows 24/13 + CONTEXT.md decision log`

Stage only intended files per commit (`git -C agentide add <paths>`). Never commit
`data/sim-state.json` unless the user says so (it is dirty before this work starts).

**Close-out:** invoke `handoff` skill → handoff doc at `docs/handoff/` (root repo,
local-only) referencing commits; breadcrumb in `sessions/.last-handoff`. Update
`prompt-log.md` as usual.

---

## 5. Flag syntax spec (final)

```
agentide token issue --tenant <id> --caller <id>
  [--scope <csv>] [--origin <url>]... [--origins <csv>] [--data-dir <path>]
```

- `--origin <url>` — repeatable; every occurrence is one allowlist entry. Accepts exact
  origins (`https://app.acme.com`, `http://localhost:7200`) and single-label wildcards
  (`https://*.acme.com`) — no mint-side grammar check; matching follows the shipped
  `originMatches` rules (`packages/gateway-core/src/origin.ts:13-26`): exact string OR
  exactly one `*.` at a label start (after `://` or `.`); the wildcard label must be
  non-empty and contain no dot; zero-label / multi-label / typo-squat forms never match.
  No scheme, port, or path parsing at mint.
- `--origins <csv>` — comma-separated; each entry trimmed; empty/whitespace entries
  dropped (same convention as `--scope`, `cli.ts:218`).
- Both flags → union; duplicates (exact string) removed keeping first-occurrence order.
- Neither flag / all entries dropped → field omitted → claim absent → today's behavior
  exactly (Node bypass; browser deny-by-default per W2 Q4).
- Wildcard + exact overlap: both kept (allowlist union, no conflict).

## 6. Edge cases

- **Dedupe** — Set-based, order-preserving (see spec).
- **Wildcard + exact overlap** — kept; harmless.
- **Empty array → absent** — normalized in gateway (`expectedOrigins: []` → no claim);
  CLI never produces `[]` (omits instead).
- **Backward compat** — no flags → identical payload bytes; `getFlag` keeps last-wins
  for existing scalar flags; `auth.token.issue` cap input without the field → claims
  unchanged; existing JWT round-trip test untouched.
- **Claims serialization order stability** — `issueToken` signs `JSON.stringify(claims)`
  (`auth.ts:37`); key order = object insertion order (sub, scope, expectedOrigins, iat,
  exp). Deterministic for identical input; `iat`/`exp` differ per mint anyway. No
  canonicalization needed.
- **Authz interplay** — none: `expectedOrigins` is identity-context (origin allowlist),
  orthogonal to `checkAuthz(scope, permissions)` (`authz.ts:56`). Minting is not
  gated on scope; enforcement happens at auth, before authz, in the adapter
  (`adapter-websocket/src/auth.ts:59-62`).
- **Token refresh** — W2 Q3 re-checks `expectedOrigins` against the fixed upgrade
  `Origin` on refresh; a refresh token minted with the same claim passes. No adapter
  change.

## 7. Risks / unknowns (with what was actually found)

1. **`getFlag` cannot repeat flags (confirmed).** `parseArgs` is last-wins
   (`cli.ts:63`). Fallback design resolved: array-capable `flags` map + `getFlagAll`
   + `getFlag` last-element fallback (§ Phase 2). Fully backward compatible.
2. **`factory.ts` over 350 lines (545).** Pre-existing; edits are ~6 lines. Not split
   here (Non-goals). 350-line check applies to NEW files and post-edit files — cli.ts
   lands ~335, new test file well under.
3. **`data/sim-state.json` is already dirty** (`git status` shows `M`) before this work
   starts — sim-run residue. Do not revert/commit without asking (AGENTS.md rule −1).
4. **`sim-state.mjs` `recordAudit` hardcodes `channel: "mcp"`** (line 81) although the ws
   sim claims channel `"websocket-adapter"` (sim header line 12). Cosmetic; fixed
   opportunistically in Phase 3 with a channel parameter.
5. **D-52 sits in Open despite its own "Verified by" note** saying both tests are
   present (`drift.md:14-21`) — pre-existing bookkeeping quirk; out of scope, noted for
   the drift-log maintainer.
6. **backend-runtime sdk-browser path** still ignores the claim — minted browser tokens
   are not enforced there until the tracked follow-up pack (backlog row 24). Expected;
   adapter-websocket (the dashboard door) enforces.
7. **S4b timing** — the sim's `nextMessage` 2000ms timeout (line 82) is ample for the
   CLI-mint round trip (in-process); if flaky under load, bump to 4000ms.

## 8. Conventions checklist (apply at every phase)

- [ ] Code Map header + CID on every edited/new source file (`types.ts` header line 10
      text update; new `issue-token.test.ts` gets its own header/CID; `cli.ts` CID
      comment untouched, `cli-types.ts` untouched).
- [ ] Source files < 350 lines after edit (cli.ts ~335; new tests < 350; sim script is
      exempt as a non-source script? — it is a `.mjs` under `scripts/`, treated as code
      by repo practice: keep S4b block tight, file grows 434 → ~505, flag to user — the
      350 rule applies to `src` TS files; scripts/.mjs siblings
      (`simulate-sdk-browser.mjs` 500+ lines) already exceed, so no split).
- [ ] No comments unless they earn their place (repo uses Purpose/Why comments; the S4b
      block keeps the one-line "mint through the real path" note).
- [ ] CONTEXT.md terms used verbatim: `expectedOrigins` claim, origin binding, mint,
      deny-by-default, browser-held token, `Origin` header, 1008.
- [ ] Drift-log format: `**D-NN** (Resolved <date>, <who>)` + Doc claim/Code
      reality/Why matters/Verified by (mirror D-51).
- [ ] Backlog format: amend rows in place, SHIPPED/CLOSED markers with date.
- [ ] `git -C agentide` hygiene: `status`/`diff` before each commit; stage only
      intended paths; never commit sim-state residue or secrets.
- [ ] Handoff breadcrumb at end (`handoff` skill; doc → `docs/handoff/`, root repo,
      local-only).
