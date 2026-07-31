# ID generation strategy

**Type:** `wayfinder:grilling` (HITL)
**Status:** closed (resolved 2026-07-31)
**Assignee:** session driver
**Blocks:** (no in-map blocks — implementation choice)

## Resolution

**Use ULID** in the format `app_<26-char-ulid>`. The `app_` prefix is a
value type discriminator, not part of the ULID itself.

**Rationale (locked):**
- The Grill's contract says "sortable by creation time preferred."
  ULID's first 10 chars are the millisecond timestamp, so string
  sort == time sort. Onboarding, audit log scans, and pagination all
  work without a secondary index.
- The `ulid` npm package is ~5KB, no native deps, no Node version
  gymnastics. Smaller than the `uuid` package with the v7 polyfill.
- Matches the Grill's example id (`app_01K2X8T6ZP4JY3N5W7R9A1B2C`).
  Locking the format keeps the example as the actual implementation.
- `monotonicFactory` guarantees strictly increasing ids within a
  single process — handles the "two SDKs of the same app connect at
  the same instant" edge case.
- No coordinator needed for generation. Compatible with future
  multi-replica deployments.

**Rules out:**
- UUIDv4 (no sortability).
- UUIDv7 (sortable like ULID, but more library complexity, no
  marginal benefit).
- Numeric auto-increment (single-process only, blocks multi-replica).
- Hash-derived (no predictability; id must be opaque, but the operator
  sometimes needs to recognize a "recent" id visually).

**Implementation seeds:**
- `packages/session-manager/src/types.ts:39-45` — uses
  `createId()` returning a UUIDv4. The `createId` function name is
  reusable; the implementation changes to the `ulid` package.
- New helper: `packages/application/src/id.ts` — `createApplicationId():
  string` returning `app_${ulid()}`. Pure function, no Clock
  dependency (ULID embeds wall-clock time).

**Tag:** `delivery: decision-only` — the format choice is the
  answer. Implementation is a `small-change` (one file, one helper,
  no design ambiguity) when the feature pipeline runs.

## Question

Of ULID, UUIDv4, and UUIDv7 — which does the Application id use,
and why? The contract locked in the Grill is "opaque, unique,
immutable, sortable by creation time preferred." This ticket picks
the implementation.

## What I know

- The Grill locked `Application.id` format as "opaque, unique,
  immutable, sortable by creation time preferred." No specific format
  chosen.
- Three candidates on the table:
  - **ULID** (26-char Crockford base32, e.g.
    `01K2X8T6ZP4JY3N5W7R9A1B2C`). Sortable by creation time natively.
    URL-safe. No central coordinator needed.
  - **UUIDv4** (random, 36-char with dashes). Universally supported.
    No natural sortability.
  - **UUIDv7** (time-ordered prefix + random suffix, 36-char). Sortable
    by creation time. Standard-blessed (RFC 9562).
- The example id in the Grill is `app_01K2X8T6ZP4JY3N5W7R9A1B2C` — ULID
  with a `app_` prefix. This is a hint, not a lock.
- Sortability matters for: operator dashboards (recent first),
  audit log scans (find by approximate time), pagination (older
  pages first).
- The `app_` prefix is a value type discriminator — useful for grep,
  log filtering, and future-proofing against other entity-id shapes
  (e.g., `tenant_`, `session_`).

## What I don't know

- **Sortability trade-off** — is the operator's "sort by creation
  time" preference strong enough to justify a non-canonical UUID?
- **Library support** — does the project's TS dep graph already pull
  in a ULID or UUIDv7 library? Adding one is a third-party dep.
- **Standard pressure** — UUIDv7 is the newest (RFC 9562, 2024).
  UUIDv4 is the most familiar. Operators may expect the latter.

## Plain-English scenario

Operator Maria opens a dashboard, sorts applications by "recently
created." The list shows `app_01HF... (analytics-prod, 2 hours ago)`,
`app_01HE... (dashboard, 3 days ago)`. The sort is correct because
the id encodes the timestamp. UUIDv4 would force Maria to load each
record's `createdAt` field and sort in memory — fine for 100 apps,
annoying for 10,000. UUIDv7 has the same benefit as ULID but is
drawn from the standard UUID namespace.

## Skeleton answer (to be grilled)

1. **Use ULID.** It hits the sortability contract natively, has a
   minimal library footprint (`ulid` npm package, ~5KB), and matches the
   Grill's example.
2. **Format**: `app_<26-char-ulid>` (the `app_` prefix is a value
   type discriminator, not part of the ULID).
3. **Generation**: monotonic within a single Node process (the
   `ulid` package's `monotonicFactory`). Multi-replica generation is
   safe (ULID generator doesn't need coordination).
4. **Defer UUIDv7** unless the user wants standard-blessed UUIDs.

## What blocks this

Nothing. Start here.
