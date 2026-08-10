# Changelog

## [0.7.2](https://github.com/spanexx/agentide/compare/gateway-core-v0.7.1...gateway-core-v0.7.2) (2026-08-10)


### Bug Fixes

* **agentide:** CLI fs must append — reuse nodeFileSystem (D-128 audit log truncation) ([cc49119](https://github.com/spanexx/agentide/commit/cc49119dbb509f76e01617cf24c8d2b4fc753761))

## [0.7.1](https://github.com/spanexx/agentide/compare/gateway-core-v0.7.0...gateway-core-v0.7.1) (2026-08-08)


### Bug Fixes

* **release:** restore real npm deps in package.json (CI lockfile break) ([d2fdd41](https://github.com/spanexx/agentide/commit/d2fdd41ab84d540982852118c1fadd0d9e7cd3bd))

## [0.7.0](https://github.com/spanexx/agentide/compare/gateway-core-v0.6.0...gateway-core-v0.7.0) (2026-08-07)


### Features

* **agentide:** CLI quality-of-life — init mkdir, JSON pid file, stop rc 0, client help (D-78, D-81, D-83, D-84) ([e880560](https://github.com/spanexx/agentide/commit/e880560b0934f7b45398caa14d17424ceb5d52d3))


### Bug Fixes

* **release:** bump local versions for next publish ([#56](https://github.com/spanexx/agentide/issues/56)) ([85727ca](https://github.com/spanexx/agentide/commit/85727ca4e86d24b04f1b0c2f1e572dba85c604cc))

## [0.6.0](https://github.com/spanexx/agentide/compare/gateway-core-v0.5.1...gateway-core-v0.6.0) (2026-08-06)


### Features

* **cli:** client subcommand (create/grant/list/revoke/rotate/redeem) (CID:cli-001..008, CID:types-022) ([60544e4](https://github.com/spanexx/agentide/commit/60544e46995302aa113e35270e06f97643deff0b))
* **dashboard-core:** P1 skeleton + extraOwners seam (BI[13]) ([#41](https://github.com/spanexx/agentide/issues/41)) ([48ee2cc](https://github.com/spanexx/agentide/commit/48ee2cca3ae1700c9358f487b7157b357732ce29))
* **dashboard-core:** P6 agentide factory wiring (BI[13] P6 of 6) ([#46](https://github.com/spanexx/agentide/issues/46)) ([fbdd847](https://github.com/spanexx/agentide/commit/fbdd84788d05aaeb33e3523952061dfa0881c7e0))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **gateway-core,adapter-mcp:** add OIDC auth-code grant (gated by --enable-oidc) (CID:oidc-001..003, CID:types-023, CID:server-005, CID:server-006) ([4334c84](https://github.com/spanexx/agentide/commit/4334c846c7f1d5db6ab24d5b5266fbfb3af355d4))
* **gateway-core,adapter-mcp:** add POST /oauth/token endpoint (CID:oauth-001..003, CID:cs-008) ([d36a2af](https://github.com/spanexx/agentide/commit/d36a2af69deedd7636d743b783e9077a9f8a3bc6))
* **gateway-core:** add ClientRecord + RegistrationCode types (CID:types-018..020) ([68fb637](https://github.com/spanexx/agentide/commit/68fb6373d011b782ebfec7868b889503eea0165c))
* **gateway-core:** add ClientService (CID:cs-002..006) ([9d2d48b](https://github.com/spanexx/agentide/commit/9d2d48b905acad6da0e84b4717b6f7ded1388a3d))
* **gateway-core:** add FileSystemClientStore (CID:cs-001) ([dea4345](https://github.com/spanexx/agentide/commit/dea43457a7ca5272f5492af63dca1c0225815176))
* **gateway-core:** harden kernel with JWT tenant scoping, file-backed secret, and audit tenantId ([a875867](https://github.com/spanexx/agentide/commit/a87586745d97bee67148d42149865f12de3e33a4))
* **gateway-core:** mint expectedOrigins claim via issueToken + auth.token.issue ([c77a32a](https://github.com/spanexx/agentide/commit/c77a32a8876687679cb2f88cdddcd860a8fbbe13))
* **gateway-core:** register client.* capabilities (CID:cap-001..004, CID:cs-007) ([3e6cf2f](https://github.com/spanexx/agentide/commit/3e6cf2f85db44cf339bdfe2a07499ba104de71d3))
* **gateway-core:** ship control-plane kernel with authn, authz, audit, rate limit, dispatch, tenant lifecycle ([407f2f3](https://github.com/spanexx/agentide/commit/407f2f31d1811092a9081dfa1fe291c5dab6ea6b))
* **gateway-sdk-dispatch:** Phase 4 dispatch path + Phase 5 kernel wiring ([0af5705](https://github.com/spanexx/agentide/commit/0af5705dfa520cd310ece3236a22883722d74377))
* implement BI[8a] gateway plugin dispatch ([fa50832](https://github.com/spanexx/agentide/commit/fa50832c0e013785c846f205121517b8a5856982))
* **permission-tiering:** BI[7] tier field + validator + convention + 25 platform caps ([f617092](https://github.com/spanexx/agentide/commit/f6170921e310bc48e1de936bc888c6398c7b0ef9))
* **permission-tiering:** ship BI[7] — phases 4-8 + reconcile + drift log ([4f9ee2b](https://github.com/spanexx/agentide/commit/4f9ee2b6aafaa126a46b655a1d3c0bd83a1f7520))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([83b8b94](https://github.com/spanexx/agentide/commit/83b8b94af666c33f6ad8591f1e8fd8990c5fdbd3))
* **plugin-manager,gateway-core:** AUDIT F10 — preserve handler originalErrorCode + retryable through GATEWAY_HANDLER_ERROR envelope ([5ee1cab](https://github.com/spanexx/agentide/commit/5ee1cab48277fecf0975afd75603690223ce37fc))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* **websocket-adapter:** ship BI[24] — 16-frame WS adapter, agentide wiring, post-impl sim, drift close ([f7fe324](https://github.com/spanexx/agentide/commit/f7fe32438bc5bef529916f41bea698031b252446))


### Bug Fixes

* **agentide:** capabilities alias passes operator scope to capability.list ([#29](https://github.com/spanexx/agentide/issues/29)) ([da10df0](https://github.com/spanexx/agentide/commit/da10df0901e15317da01fe1d35070481cfa8c58f))
* **backend-runtime:** enforce expectedOrigins origin binding post-verify (drift D-54) ([21648d0](https://github.com/spanexx/agentide/commit/21648d0ee0bf7a3b3de52d476fafcb932a4c80d7))
* **build:** extract @platform/errors package, fix dep graph, use tsc --build ([3e55487](https://github.com/spanexx/agentide/commit/3e55487a766902374f0b1466a1328bb1f2172852))
* **cli,gateway-core:** close D-70 (audit), D-72 (active revocation), D-73 (--no-tls) ([a78f059](https://github.com/spanexx/agentide/commit/a78f059ea871759657de9336e4d3c2e376513da6))
* double timestamp push (createClient + checkCreateRateLimit both ([9d2d48b](https://github.com/spanexx/agentide/commit/9d2d48b905acad6da0e84b4717b6f7ded1388a3d))
* **gateway-core,plugin-manager:** serialize concurrent file writes ([66310b6](https://github.com/spanexx/agentide/commit/66310b6ff06fdd899d5f74c5ac795d6b8963ee5d))
* **gateway-core:** accept leeway window on token expiry ([612c0ab](https://github.com/spanexx/agentide/commit/612c0ab587e14893e9ad88f4c3460e026ae57ff4))
* **gateway-core:** enforce capability input/output JSON Schema ([a3a5667](https://github.com/spanexx/agentide/commit/a3a5667d5c0f2cd779d5903d5ee4afa2ea02c385))
* **gateway-core:** evict idle rate-limit buckets via sweep ([341d2fe](https://github.com/spanexx/agentide/commit/341d2fe2163c05f7c8640ab370df35d05d2ddf49))
* **gateway-core:** preserve rate-limit progress under sub-interval retries ([e99b0fe](https://github.com/spanexx/agentide/commit/e99b0fe56c45f8b2c93b6a491e1a04e407f224c4))
* **gateway-core:** real gateway.metrics counters (D-46 closeout) ([#35](https://github.com/spanexx/agentide/issues/35)) ([02e9e3b](https://github.com/spanexx/agentide/commit/02e9e3be73178db1eef6239e875e0138cc3fa40e))
* **platform-capabilities:** address gap-report findings (AC-3 test, drift 1/2, session.list caveat) ([f0e8258](https://github.com/spanexx/agentide/commit/f0e8258e9b5368d7bcd987c1800d619ac84f1ba9))
* **platform-capabilities:** session.list description no longer claims v1 stub ([#32](https://github.com/spanexx/agentide/issues/32)) ([427bd0a](https://github.com/spanexx/agentide/commit/427bd0a0780422ecf6f99b0ed9e20187b979445a))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **release:** sync package.json + manifest to npm state ([#52](https://github.com/spanexx/agentide/issues/52)) ([302d205](https://github.com/spanexx/agentide/commit/302d205a9b4ca6a7c8343c477f7fc8fdcd7a31f1))
* **session-manager:** real session.list snapshot (D-45 closeout) ([#30](https://github.com/spanexx/agentide/issues/30)) ([daa0ec3](https://github.com/spanexx/agentide/commit/daa0ec36c209f36522670d6ba22aaabb5866a20e))


### CI/CD

* types-018, CID:types-019, CID:types-020. ([68fb637](https://github.com/spanexx/agentide/commit/68fb6373d011b782ebfec7868b889503eea0165c))

## [0.5.0](https://github.com/spanexx/agentide/compare/gateway-core-v0.4.0...gateway-core-v0.5.0) (2026-08-06)


### Features

* **dashboard-core:** P1 skeleton + extraOwners seam (BI[13]) ([#41](https://github.com/spanexx/agentide/issues/41)) ([48ee2cc](https://github.com/spanexx/agentide/commit/48ee2cca3ae1700c9358f487b7157b357732ce29))
* **dashboard-core:** P6 agentide factory wiring (BI[13] P6 of 6) ([#46](https://github.com/spanexx/agentide/issues/46)) ([fbdd847](https://github.com/spanexx/agentide/commit/fbdd84788d05aaeb33e3523952061dfa0881c7e0))


### Bug Fixes

* **gateway-core:** real gateway.metrics counters (D-46 closeout) ([#35](https://github.com/spanexx/agentide/issues/35)) ([02e9e3b](https://github.com/spanexx/agentide/commit/02e9e3be73178db1eef6239e875e0138cc3fa40e))

## [0.4.0](https://github.com/spanexx/agentide/compare/gateway-core-v0.3.1...gateway-core-v0.4.0) (2026-08-06)


### Features

* **cli:** client subcommand (create/grant/list/revoke/rotate/redeem) (CID:cli-001..008, CID:types-022) ([60544e4](https://github.com/spanexx/agentide/commit/60544e46995302aa113e35270e06f97643deff0b))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **gateway-core,adapter-mcp:** add OIDC auth-code grant (gated by --enable-oidc) (CID:oidc-001..003, CID:types-023, CID:server-005, CID:server-006) ([4334c84](https://github.com/spanexx/agentide/commit/4334c846c7f1d5db6ab24d5b5266fbfb3af355d4))
* **gateway-core,adapter-mcp:** add POST /oauth/token endpoint (CID:oauth-001..003, CID:cs-008) ([d36a2af](https://github.com/spanexx/agentide/commit/d36a2af69deedd7636d743b783e9077a9f8a3bc6))
* **gateway-core:** add ClientRecord + RegistrationCode types (CID:types-018..020) ([68fb637](https://github.com/spanexx/agentide/commit/68fb6373d011b782ebfec7868b889503eea0165c))
* **gateway-core:** add ClientService (CID:cs-002..006) ([9d2d48b](https://github.com/spanexx/agentide/commit/9d2d48b905acad6da0e84b4717b6f7ded1388a3d))
* **gateway-core:** add FileSystemClientStore (CID:cs-001) ([dea4345](https://github.com/spanexx/agentide/commit/dea43457a7ca5272f5492af63dca1c0225815176))
* **gateway-core:** harden kernel with JWT tenant scoping, file-backed secret, and audit tenantId ([a875867](https://github.com/spanexx/agentide/commit/a87586745d97bee67148d42149865f12de3e33a4))
* **gateway-core:** mint expectedOrigins claim via issueToken + auth.token.issue ([c77a32a](https://github.com/spanexx/agentide/commit/c77a32a8876687679cb2f88cdddcd860a8fbbe13))
* **gateway-core:** register client.* capabilities (CID:cap-001..004, CID:cs-007) ([3e6cf2f](https://github.com/spanexx/agentide/commit/3e6cf2f85db44cf339bdfe2a07499ba104de71d3))
* **gateway-core:** ship control-plane kernel with authn, authz, audit, rate limit, dispatch, tenant lifecycle ([407f2f3](https://github.com/spanexx/agentide/commit/407f2f31d1811092a9081dfa1fe291c5dab6ea6b))
* **gateway-sdk-dispatch:** Phase 4 dispatch path + Phase 5 kernel wiring ([0af5705](https://github.com/spanexx/agentide/commit/0af5705dfa520cd310ece3236a22883722d74377))
* implement BI[8a] gateway plugin dispatch ([fa50832](https://github.com/spanexx/agentide/commit/fa50832c0e013785c846f205121517b8a5856982))
* **permission-tiering:** BI[7] tier field + validator + convention + 25 platform caps ([f617092](https://github.com/spanexx/agentide/commit/f6170921e310bc48e1de936bc888c6398c7b0ef9))
* **permission-tiering:** ship BI[7] — phases 4-8 + reconcile + drift log ([4f9ee2b](https://github.com/spanexx/agentide/commit/4f9ee2b6aafaa126a46b655a1d3c0bd83a1f7520))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([83b8b94](https://github.com/spanexx/agentide/commit/83b8b94af666c33f6ad8591f1e8fd8990c5fdbd3))
* **plugin-manager,gateway-core:** AUDIT F10 — preserve handler originalErrorCode + retryable through GATEWAY_HANDLER_ERROR envelope ([5ee1cab](https://github.com/spanexx/agentide/commit/5ee1cab48277fecf0975afd75603690223ce37fc))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* **websocket-adapter:** ship BI[24] — 16-frame WS adapter, agentide wiring, post-impl sim, drift close ([f7fe324](https://github.com/spanexx/agentide/commit/f7fe32438bc5bef529916f41bea698031b252446))


### Bug Fixes

* **agentide:** capabilities alias passes operator scope to capability.list ([#29](https://github.com/spanexx/agentide/issues/29)) ([da10df0](https://github.com/spanexx/agentide/commit/da10df0901e15317da01fe1d35070481cfa8c58f))
* **backend-runtime:** enforce expectedOrigins origin binding post-verify (drift D-54) ([21648d0](https://github.com/spanexx/agentide/commit/21648d0ee0bf7a3b3de52d476fafcb932a4c80d7))
* **build:** extract @platform/errors package, fix dep graph, use tsc --build ([3e55487](https://github.com/spanexx/agentide/commit/3e55487a766902374f0b1466a1328bb1f2172852))
* **cli,gateway-core:** close D-70 (audit), D-72 (active revocation), D-73 (--no-tls) ([a78f059](https://github.com/spanexx/agentide/commit/a78f059ea871759657de9336e4d3c2e376513da6))
* double timestamp push (createClient + checkCreateRateLimit both ([9d2d48b](https://github.com/spanexx/agentide/commit/9d2d48b905acad6da0e84b4717b6f7ded1388a3d))
* **gateway-core,plugin-manager:** serialize concurrent file writes ([66310b6](https://github.com/spanexx/agentide/commit/66310b6ff06fdd899d5f74c5ac795d6b8963ee5d))
* **gateway-core:** accept leeway window on token expiry ([612c0ab](https://github.com/spanexx/agentide/commit/612c0ab587e14893e9ad88f4c3460e026ae57ff4))
* **gateway-core:** enforce capability input/output JSON Schema ([a3a5667](https://github.com/spanexx/agentide/commit/a3a5667d5c0f2cd779d5903d5ee4afa2ea02c385))
* **gateway-core:** evict idle rate-limit buckets via sweep ([341d2fe](https://github.com/spanexx/agentide/commit/341d2fe2163c05f7c8640ab370df35d05d2ddf49))
* **gateway-core:** preserve rate-limit progress under sub-interval retries ([e99b0fe](https://github.com/spanexx/agentide/commit/e99b0fe56c45f8b2c93b6a491e1a04e407f224c4))
* **platform-capabilities:** address gap-report findings (AC-3 test, drift 1/2, session.list caveat) ([f0e8258](https://github.com/spanexx/agentide/commit/f0e8258e9b5368d7bcd987c1800d619ac84f1ba9))
* **platform-capabilities:** session.list description no longer claims v1 stub ([#32](https://github.com/spanexx/agentide/issues/32)) ([427bd0a](https://github.com/spanexx/agentide/commit/427bd0a0780422ecf6f99b0ed9e20187b979445a))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **session-manager:** real session.list snapshot (D-45 closeout) ([#30](https://github.com/spanexx/agentide/issues/30)) ([daa0ec3](https://github.com/spanexx/agentide/commit/daa0ec36c209f36522670d6ba22aaabb5866a20e))


### CI/CD

* types-018, CID:types-019, CID:types-020. ([68fb637](https://github.com/spanexx/agentide/commit/68fb6373d011b782ebfec7868b889503eea0165c))

## [0.3.0](https://github.com/spanexx/agentide/compare/gateway-core-v0.2.1...gateway-core-v0.3.0) (2026-08-06)


### Features

* **cli:** client subcommand (create/grant/list/revoke/rotate/redeem) (CID:cli-001..008, CID:types-022) ([60544e4](https://github.com/spanexx/agentide/commit/60544e46995302aa113e35270e06f97643deff0b))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **gateway-core,adapter-mcp:** add OIDC auth-code grant (gated by --enable-oidc) (CID:oidc-001..003, CID:types-023, CID:server-005, CID:server-006) ([4334c84](https://github.com/spanexx/agentide/commit/4334c846c7f1d5db6ab24d5b5266fbfb3af355d4))
* **gateway-core,adapter-mcp:** add POST /oauth/token endpoint (CID:oauth-001..003, CID:cs-008) ([d36a2af](https://github.com/spanexx/agentide/commit/d36a2af69deedd7636d743b783e9077a9f8a3bc6))
* **gateway-core:** add ClientRecord + RegistrationCode types (CID:types-018..020) ([68fb637](https://github.com/spanexx/agentide/commit/68fb6373d011b782ebfec7868b889503eea0165c))
* **gateway-core:** add ClientService (CID:cs-002..006) ([9d2d48b](https://github.com/spanexx/agentide/commit/9d2d48b905acad6da0e84b4717b6f7ded1388a3d))
* **gateway-core:** add FileSystemClientStore (CID:cs-001) ([dea4345](https://github.com/spanexx/agentide/commit/dea43457a7ca5272f5492af63dca1c0225815176))
* **gateway-core:** harden kernel with JWT tenant scoping, file-backed secret, and audit tenantId ([a875867](https://github.com/spanexx/agentide/commit/a87586745d97bee67148d42149865f12de3e33a4))
* **gateway-core:** mint expectedOrigins claim via issueToken + auth.token.issue ([c77a32a](https://github.com/spanexx/agentide/commit/c77a32a8876687679cb2f88cdddcd860a8fbbe13))
* **gateway-core:** register client.* capabilities (CID:cap-001..004, CID:cs-007) ([3e6cf2f](https://github.com/spanexx/agentide/commit/3e6cf2f85db44cf339bdfe2a07499ba104de71d3))
* **gateway-core:** ship control-plane kernel with authn, authz, audit, rate limit, dispatch, tenant lifecycle ([407f2f3](https://github.com/spanexx/agentide/commit/407f2f31d1811092a9081dfa1fe291c5dab6ea6b))
* **gateway-sdk-dispatch:** Phase 4 dispatch path + Phase 5 kernel wiring ([0af5705](https://github.com/spanexx/agentide/commit/0af5705dfa520cd310ece3236a22883722d74377))
* implement BI[8a] gateway plugin dispatch ([fa50832](https://github.com/spanexx/agentide/commit/fa50832c0e013785c846f205121517b8a5856982))
* **permission-tiering:** BI[7] tier field + validator + convention + 25 platform caps ([f617092](https://github.com/spanexx/agentide/commit/f6170921e310bc48e1de936bc888c6398c7b0ef9))
* **permission-tiering:** ship BI[7] — phases 4-8 + reconcile + drift log ([4f9ee2b](https://github.com/spanexx/agentide/commit/4f9ee2b6aafaa126a46b655a1d3c0bd83a1f7520))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([83b8b94](https://github.com/spanexx/agentide/commit/83b8b94af666c33f6ad8591f1e8fd8990c5fdbd3))
* **plugin-manager,gateway-core:** AUDIT F10 — preserve handler originalErrorCode + retryable through GATEWAY_HANDLER_ERROR envelope ([5ee1cab](https://github.com/spanexx/agentide/commit/5ee1cab48277fecf0975afd75603690223ce37fc))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* **websocket-adapter:** ship BI[24] — 16-frame WS adapter, agentide wiring, post-impl sim, drift close ([f7fe324](https://github.com/spanexx/agentide/commit/f7fe32438bc5bef529916f41bea698031b252446))


### Bug Fixes

* **agentide:** capabilities alias passes operator scope to capability.list ([#29](https://github.com/spanexx/agentide/issues/29)) ([da10df0](https://github.com/spanexx/agentide/commit/da10df0901e15317da01fe1d35070481cfa8c58f))
* **backend-runtime:** enforce expectedOrigins origin binding post-verify (drift D-54) ([21648d0](https://github.com/spanexx/agentide/commit/21648d0ee0bf7a3b3de52d476fafcb932a4c80d7))
* **build:** extract @platform/errors package, fix dep graph, use tsc --build ([3e55487](https://github.com/spanexx/agentide/commit/3e55487a766902374f0b1466a1328bb1f2172852))
* **cli,gateway-core:** close D-70 (audit), D-72 (active revocation), D-73 (--no-tls) ([a78f059](https://github.com/spanexx/agentide/commit/a78f059ea871759657de9336e4d3c2e376513da6))
* double timestamp push (createClient + checkCreateRateLimit both ([9d2d48b](https://github.com/spanexx/agentide/commit/9d2d48b905acad6da0e84b4717b6f7ded1388a3d))
* **gateway-core,plugin-manager:** serialize concurrent file writes ([66310b6](https://github.com/spanexx/agentide/commit/66310b6ff06fdd899d5f74c5ac795d6b8963ee5d))
* **gateway-core:** accept leeway window on token expiry ([612c0ab](https://github.com/spanexx/agentide/commit/612c0ab587e14893e9ad88f4c3460e026ae57ff4))
* **gateway-core:** enforce capability input/output JSON Schema ([a3a5667](https://github.com/spanexx/agentide/commit/a3a5667d5c0f2cd779d5903d5ee4afa2ea02c385))
* **gateway-core:** evict idle rate-limit buckets via sweep ([341d2fe](https://github.com/spanexx/agentide/commit/341d2fe2163c05f7c8640ab370df35d05d2ddf49))
* **gateway-core:** preserve rate-limit progress under sub-interval retries ([e99b0fe](https://github.com/spanexx/agentide/commit/e99b0fe56c45f8b2c93b6a491e1a04e407f224c4))
* **platform-capabilities:** address gap-report findings (AC-3 test, drift 1/2, session.list caveat) ([f0e8258](https://github.com/spanexx/agentide/commit/f0e8258e9b5368d7bcd987c1800d619ac84f1ba9))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **session-manager:** real session.list snapshot (D-45 closeout) ([#30](https://github.com/spanexx/agentide/issues/30)) ([daa0ec3](https://github.com/spanexx/agentide/commit/daa0ec36c209f36522670d6ba22aaabb5866a20e))


### CI/CD

* types-018, CID:types-019, CID:types-020. ([68fb637](https://github.com/spanexx/agentide/commit/68fb6373d011b782ebfec7868b889503eea0165c))

## [0.2.0](https://github.com/spanexx/agentide/compare/gateway-core-v0.1.1...gateway-core-v0.2.0) (2026-08-05)


### Features

* **cli:** client subcommand (create/grant/list/revoke/rotate/redeem) (CID:cli-001..008, CID:types-022) ([60544e4](https://github.com/spanexx/agentide/commit/60544e46995302aa113e35270e06f97643deff0b))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **gateway-core,adapter-mcp:** add OIDC auth-code grant (gated by --enable-oidc) (CID:oidc-001..003, CID:types-023, CID:server-005, CID:server-006) ([4334c84](https://github.com/spanexx/agentide/commit/4334c846c7f1d5db6ab24d5b5266fbfb3af355d4))
* **gateway-core,adapter-mcp:** add POST /oauth/token endpoint (CID:oauth-001..003, CID:cs-008) ([d36a2af](https://github.com/spanexx/agentide/commit/d36a2af69deedd7636d743b783e9077a9f8a3bc6))
* **gateway-core:** add ClientRecord + RegistrationCode types (CID:types-018..020) ([68fb637](https://github.com/spanexx/agentide/commit/68fb6373d011b782ebfec7868b889503eea0165c))
* **gateway-core:** add ClientService (CID:cs-002..006) ([9d2d48b](https://github.com/spanexx/agentide/commit/9d2d48b905acad6da0e84b4717b6f7ded1388a3d))
* **gateway-core:** add FileSystemClientStore (CID:cs-001) ([dea4345](https://github.com/spanexx/agentide/commit/dea43457a7ca5272f5492af63dca1c0225815176))
* **gateway-core:** harden kernel with JWT tenant scoping, file-backed secret, and audit tenantId ([a875867](https://github.com/spanexx/agentide/commit/a87586745d97bee67148d42149865f12de3e33a4))
* **gateway-core:** mint expectedOrigins claim via issueToken + auth.token.issue ([c77a32a](https://github.com/spanexx/agentide/commit/c77a32a8876687679cb2f88cdddcd860a8fbbe13))
* **gateway-core:** register client.* capabilities (CID:cap-001..004, CID:cs-007) ([3e6cf2f](https://github.com/spanexx/agentide/commit/3e6cf2f85db44cf339bdfe2a07499ba104de71d3))
* **gateway-core:** ship control-plane kernel with authn, authz, audit, rate limit, dispatch, tenant lifecycle ([407f2f3](https://github.com/spanexx/agentide/commit/407f2f31d1811092a9081dfa1fe291c5dab6ea6b))
* **gateway-sdk-dispatch:** Phase 4 dispatch path + Phase 5 kernel wiring ([0af5705](https://github.com/spanexx/agentide/commit/0af5705dfa520cd310ece3236a22883722d74377))
* implement BI[8a] gateway plugin dispatch ([fa50832](https://github.com/spanexx/agentide/commit/fa50832c0e013785c846f205121517b8a5856982))
* **permission-tiering:** BI[7] tier field + validator + convention + 25 platform caps ([f617092](https://github.com/spanexx/agentide/commit/f6170921e310bc48e1de936bc888c6398c7b0ef9))
* **permission-tiering:** ship BI[7] — phases 4-8 + reconcile + drift log ([4f9ee2b](https://github.com/spanexx/agentide/commit/4f9ee2b6aafaa126a46b655a1d3c0bd83a1f7520))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([83b8b94](https://github.com/spanexx/agentide/commit/83b8b94af666c33f6ad8591f1e8fd8990c5fdbd3))
* **plugin-manager,gateway-core:** AUDIT F10 — preserve handler originalErrorCode + retryable through GATEWAY_HANDLER_ERROR envelope ([5ee1cab](https://github.com/spanexx/agentide/commit/5ee1cab48277fecf0975afd75603690223ce37fc))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* **websocket-adapter:** ship BI[24] — 16-frame WS adapter, agentide wiring, post-impl sim, drift close ([f7fe324](https://github.com/spanexx/agentide/commit/f7fe32438bc5bef529916f41bea698031b252446))


### Bug Fixes

* **backend-runtime:** enforce expectedOrigins origin binding post-verify (drift D-54) ([21648d0](https://github.com/spanexx/agentide/commit/21648d0ee0bf7a3b3de52d476fafcb932a4c80d7))
* **build:** extract @platform/errors package, fix dep graph, use tsc --build ([3e55487](https://github.com/spanexx/agentide/commit/3e55487a766902374f0b1466a1328bb1f2172852))
* **cli,gateway-core:** close D-70 (audit), D-72 (active revocation), D-73 (--no-tls) ([a78f059](https://github.com/spanexx/agentide/commit/a78f059ea871759657de9336e4d3c2e376513da6))
* double timestamp push (createClient + checkCreateRateLimit both ([9d2d48b](https://github.com/spanexx/agentide/commit/9d2d48b905acad6da0e84b4717b6f7ded1388a3d))
* **gateway-core,plugin-manager:** serialize concurrent file writes ([66310b6](https://github.com/spanexx/agentide/commit/66310b6ff06fdd899d5f74c5ac795d6b8963ee5d))
* **gateway-core:** accept leeway window on token expiry ([612c0ab](https://github.com/spanexx/agentide/commit/612c0ab587e14893e9ad88f4c3460e026ae57ff4))
* **gateway-core:** enforce capability input/output JSON Schema ([a3a5667](https://github.com/spanexx/agentide/commit/a3a5667d5c0f2cd779d5903d5ee4afa2ea02c385))
* **gateway-core:** evict idle rate-limit buckets via sweep ([341d2fe](https://github.com/spanexx/agentide/commit/341d2fe2163c05f7c8640ab370df35d05d2ddf49))
* **gateway-core:** preserve rate-limit progress under sub-interval retries ([e99b0fe](https://github.com/spanexx/agentide/commit/e99b0fe56c45f8b2c93b6a491e1a04e407f224c4))
* **platform-capabilities:** address gap-report findings (AC-3 test, drift 1/2, session.list caveat) ([f0e8258](https://github.com/spanexx/agentide/commit/f0e8258e9b5368d7bcd987c1800d619ac84f1ba9))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))


### CI/CD

* types-018, CID:types-019, CID:types-020. ([68fb637](https://github.com/spanexx/agentide/commit/68fb6373d011b782ebfec7868b889503eea0165c))

## [0.1.0](https://github.com/spanexx/agentide/compare/gateway-core-v0.0.2...gateway-core-v0.1.0) (2026-08-05)


### Features

* **cli:** client subcommand (create/grant/list/revoke/rotate/redeem) (CID:cli-001..008, CID:types-022) ([60544e4](https://github.com/spanexx/agentide/commit/60544e46995302aa113e35270e06f97643deff0b))
* **gateway-core,adapter-mcp:** add OIDC auth-code grant (gated by --enable-oidc) (CID:oidc-001..003, CID:types-023, CID:server-005, CID:server-006) ([4334c84](https://github.com/spanexx/agentide/commit/4334c846c7f1d5db6ab24d5b5266fbfb3af355d4))
* **gateway-core,adapter-mcp:** add POST /oauth/token endpoint (CID:oauth-001..003, CID:cs-008) ([d36a2af](https://github.com/spanexx/agentide/commit/d36a2af69deedd7636d743b783e9077a9f8a3bc6))
* **gateway-core:** add ClientRecord + RegistrationCode types (CID:types-018..020) ([68fb637](https://github.com/spanexx/agentide/commit/68fb6373d011b782ebfec7868b889503eea0165c))
* **gateway-core:** add ClientService (CID:cs-002..006) ([9d2d48b](https://github.com/spanexx/agentide/commit/9d2d48b905acad6da0e84b4717b6f7ded1388a3d))
* **gateway-core:** add FileSystemClientStore (CID:cs-001) ([dea4345](https://github.com/spanexx/agentide/commit/dea43457a7ca5272f5492af63dca1c0225815176))
* **gateway-core:** harden kernel with JWT tenant scoping, file-backed secret, and audit tenantId ([a875867](https://github.com/spanexx/agentide/commit/a87586745d97bee67148d42149865f12de3e33a4))
* **gateway-core:** mint expectedOrigins claim via issueToken + auth.token.issue ([c77a32a](https://github.com/spanexx/agentide/commit/c77a32a8876687679cb2f88cdddcd860a8fbbe13))
* **gateway-core:** register client.* capabilities (CID:cap-001..004, CID:cs-007) ([3e6cf2f](https://github.com/spanexx/agentide/commit/3e6cf2f85db44cf339bdfe2a07499ba104de71d3))
* **gateway-core:** ship control-plane kernel with authn, authz, audit, rate limit, dispatch, tenant lifecycle ([407f2f3](https://github.com/spanexx/agentide/commit/407f2f31d1811092a9081dfa1fe291c5dab6ea6b))
* **gateway-sdk-dispatch:** Phase 4 dispatch path + Phase 5 kernel wiring ([0af5705](https://github.com/spanexx/agentide/commit/0af5705dfa520cd310ece3236a22883722d74377))
* implement BI[8a] gateway plugin dispatch ([fa50832](https://github.com/spanexx/agentide/commit/fa50832c0e013785c846f205121517b8a5856982))
* **permission-tiering:** BI[7] tier field + validator + convention + 25 platform caps ([f617092](https://github.com/spanexx/agentide/commit/f6170921e310bc48e1de936bc888c6398c7b0ef9))
* **permission-tiering:** ship BI[7] — phases 4-8 + reconcile + drift log ([4f9ee2b](https://github.com/spanexx/agentide/commit/4f9ee2b6aafaa126a46b655a1d3c0bd83a1f7520))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([83b8b94](https://github.com/spanexx/agentide/commit/83b8b94af666c33f6ad8591f1e8fd8990c5fdbd3))
* **plugin-manager,gateway-core:** AUDIT F10 — preserve handler originalErrorCode + retryable through GATEWAY_HANDLER_ERROR envelope ([5ee1cab](https://github.com/spanexx/agentide/commit/5ee1cab48277fecf0975afd75603690223ce37fc))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **websocket-adapter:** ship BI[24] — 16-frame WS adapter, agentide wiring, post-impl sim, drift close ([f7fe324](https://github.com/spanexx/agentide/commit/f7fe32438bc5bef529916f41bea698031b252446))


### Bug Fixes

* **backend-runtime:** enforce expectedOrigins origin binding post-verify (drift D-54) ([21648d0](https://github.com/spanexx/agentide/commit/21648d0ee0bf7a3b3de52d476fafcb932a4c80d7))
* **build:** extract @platform/errors package, fix dep graph, use tsc --build ([3e55487](https://github.com/spanexx/agentide/commit/3e55487a766902374f0b1466a1328bb1f2172852))
* **cli,gateway-core:** close D-70 (audit), D-72 (active revocation), D-73 (--no-tls) ([a78f059](https://github.com/spanexx/agentide/commit/a78f059ea871759657de9336e4d3c2e376513da6))
* double timestamp push (createClient + checkCreateRateLimit both ([9d2d48b](https://github.com/spanexx/agentide/commit/9d2d48b905acad6da0e84b4717b6f7ded1388a3d))
* **gateway-core,plugin-manager:** serialize concurrent file writes ([66310b6](https://github.com/spanexx/agentide/commit/66310b6ff06fdd899d5f74c5ac795d6b8963ee5d))
* **gateway-core:** accept leeway window on token expiry ([612c0ab](https://github.com/spanexx/agentide/commit/612c0ab587e14893e9ad88f4c3460e026ae57ff4))
* **gateway-core:** enforce capability input/output JSON Schema ([a3a5667](https://github.com/spanexx/agentide/commit/a3a5667d5c0f2cd779d5903d5ee4afa2ea02c385))
* **gateway-core:** evict idle rate-limit buckets via sweep ([341d2fe](https://github.com/spanexx/agentide/commit/341d2fe2163c05f7c8640ab370df35d05d2ddf49))
* **gateway-core:** preserve rate-limit progress under sub-interval retries ([e99b0fe](https://github.com/spanexx/agentide/commit/e99b0fe56c45f8b2c93b6a491e1a04e407f224c4))
* **platform-capabilities:** address gap-report findings (AC-3 test, drift 1/2, session.list caveat) ([f0e8258](https://github.com/spanexx/agentide/commit/f0e8258e9b5368d7bcd987c1800d619ac84f1ba9))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))


### CI/CD

* types-018, CID:types-019, CID:types-020. ([68fb637](https://github.com/spanexx/agentide/commit/68fb6373d011b782ebfec7868b889503eea0165c))
