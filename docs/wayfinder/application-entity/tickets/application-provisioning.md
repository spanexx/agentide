# Application provisioning: auto-provision on first connect

**Type:** `wayfinder:grilling` (HITL)
**Status:** closed (resolved 2026-07-31)
**Assignee:** session driver
**Blocks:** T5, T6

## Resolution

**Default to permissive (auto-provision on first connect).** Operators
who want strict mode use `application.auto_provision: false` in the
backend-runtime config; they must `agentide app create` first.

- The decision is recorded at issuance time (auto-provision log line
  in the audit), and the `application.created` event is emitted.
- The auto-provision path uses the token's `applicationName` as the
  initial name. Subsequent renames update the Application record.
- **Token issuance is the recommended path** (operator pre-creates
  the app, mints the token). Auto-provision is a fallback for dev /
  forgotten-pre-create scenarios.

**Rules out:**
- Strict-only default (no auto-provision). Allows dev friction;
  unconfigured dev environments fail at first connect.
- Per-environment default flip (no config flag). Operators with
  mixed dev/prod environments need a per-process knob.

**Tag:** `delivery: decision-only` — the trigger decision is the
  answer. The implementation is in the feature-pipeline
  feature-pipeline.

## Question

When an SDK connects with a token whose `applicationId` is unknown
to the Application store, does the server auto-provision an Application
on the fly (using `applicationName` from the token claim), or reject
the connection with `GATEWAY_APPLICATION_UNKNOWN`?

## What I know

- The Grill locked: the Application is the new identity; the SDK
  presents the token; the server never re-resolves identity. This
  ticket doesn't question that — it asks what happens when the token
  presents an id the server doesn't know about.
- Today, no Application entity exists. The SDK shows up with a token;
  the server registers the connection under `appId = callerId`. There
  is no "create app" step.
- The Grill's "Not yet specified" list (now in the map) flagged
  "Provisioning trigger" as open.
- The Grill Q9 (deletion) is silent on the connect-time path. Two
  interpretations:
  - **Permissive**: at any time, an unknown id is auto-provisioned.
    Hot removal rejects the connection (handled separately).
  - **Strict**: an unknown id is always rejected; the operator must
    pre-create via CLI.
- The `agentide token issue` CLI accepts `--application-id` today
  via the implementation ticket (T3 in the old draft). The CLI also
  has `--caller` already, which the Grill renames.

## What I don't know

- **Dev vs prod default** — auto-provision is great for dev (no
  operator step), terrible for prod (operators want audit trail of
  app creation). Is there a per-environment config, or is one
  default for everyone?
- **Token issuance as the only path** — should `auth.token.issue`
  ALWAYS pre-resolve the application (auto-create if name is new),
  making the runtime path always strict? This would push the
  auto-provision decision to issuance time, not connect time.
- **Race on first connect** — two SDKs of the same app connect
  simultaneously. Auto-provision-on-first-connect could create two
  Applications if the names are similar-but-not-equal (typo from the
  operator). Token issuance centralizes the resolution.
- **Audit story** — auto-provision emits a `application.created` event
  without explicit operator action. Is the audit log sufficient, or
  do dashboards need a separate "auto-provisioned" marker?

## Plain-English scenario

**Scenario A (permissive default):** Developer Dan is testing. He
mints a token with `--application-id app_NEW123`. The server has
never seen `app_NEW123`. The server creates the Application on the
fly with name "test-app" (from the token claim), emits
`application.created`, registers the SDK. Dan's tests pass.

**Scenario B (strict default):** Operator Maria runs prod. She
pre-creates `app_01K2X8T6ZP4` via `agentide app create`. She mints
a token with that id. The SDK connects. The server validates the
id is in the store, registers the SDK. If a token with a bogus id
shows up, the server rejects with `GATEWAY_APPLICATION_UNKNOWN`.

**Scenario C (mixed):** server has a config flag
`application.auto_provision: boolean`. Default `true` in dev, `false`
in prod. The flag is set per `createBackendRuntime` config.

## Skeleton answer (to be grilled)

1. **Default to permissive** (auto-provision on first connect). The
  decision is recorded at issuance time (auto-provision log line in
  the audit), and the `application.created` event is emitted.
2. **Operators who want strict** use `application.auto_provision: false`
  in the backend-runtime config. They must `agentide app create` first.
3. **The auto-provision path uses the token's `applicationName`** as
  the initial name. Subsequent renames update the Application record.
4. **Token issuance is the recommended path** (operator pre-creates
  the app, mints the token). Auto-provision is a fallback for dev /
  forgotten-pre-create scenarios.

## What blocks this

T1 (need the id format to generate the auto-provisioned record).
