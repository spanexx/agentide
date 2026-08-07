# Changelog

## [0.5.0](https://github.com/spanexx/agentide/compare/agentide-v0.4.0...agentide-v0.5.0) (2026-08-07)


### Features

* **adapter-core:** A8 MCP migration + A9 REST adapter pack ([#59](https://github.com/spanexx/agentide/issues/59)) ([25ae5a0](https://github.com/spanexx/agentide/commit/25ae5a0be2825a1dfa19be02acc95d8ca974d3b9))

## [0.4.0](https://github.com/spanexx/agentide/compare/agentide-v0.3.1...agentide-v0.4.0) (2026-08-07)


### Features

* **agentide:** CLI consumer UX — auto-mint session, default port, wrong-door error (D-79, D-80) ([1a6bfca](https://github.com/spanexx/agentide/commit/1a6bfca5d444ec362db0a2bf6d83cd25c78af37e))
* **agentide:** CLI quality-of-life — init mkdir, JSON pid file, stop rc 0, client help (D-78, D-81, D-83, D-84) ([e880560](https://github.com/spanexx/agentide/commit/e880560b0934f7b45398caa14d17424ceb5d52d3))


### Bug Fixes

* **agentide:** session-mint ownerId+adapterType, session.destroy wire shape, IPv6 tests ([f2430cc](https://github.com/spanexx/agentide/commit/f2430ccf48684b44edd96430df2b18d7030819e2))
* **release:** bump local versions for next publish ([#56](https://github.com/spanexx/agentide/issues/56)) ([85727ca](https://github.com/spanexx/agentide/commit/85727ca4e86d24b04f1b0c2f1e572dba85c604cc))

## [0.3.1](https://github.com/spanexx/agentide/compare/agentide-v0.3.0...agentide-v0.3.1) (2026-08-06)


### Bug Fixes

* **agentide:** bundle crash + --dashboard-port flag ([#54](https://github.com/spanexx/agentide/issues/54)) ([e841e06](https://github.com/spanexx/agentide/commit/e841e06e362211b15c6f722bdf83d4fe14e425f3))

## [0.3.0](https://github.com/spanexx/agentide/compare/agentide-v0.2.2...agentide-v0.3.0) (2026-08-06)


### Features

* **dashboard-core:** P6 agentide factory wiring (BI[13] P6 of 6) ([#46](https://github.com/spanexx/agentide/issues/46)) ([fbdd847](https://github.com/spanexx/agentide/commit/fbdd84788d05aaeb33e3523952061dfa0881c7e0))


### Bug Fixes

* **dashboard-core:** drift review fixes (Gaps 1-4 + Drifts 3, 7) ([#48](https://github.com/spanexx/agentide/issues/48)) ([32dcd21](https://github.com/spanexx/agentide/commit/32dcd21e1759b164b35fb06322dd4028101187fb))

## [0.2.2](https://github.com/spanexx/agentide/compare/agentide-v0.2.1...agentide-v0.2.2) (2026-08-06)


### Bug Fixes

* **agentide:** capabilities alias passes operator scope to capability.list ([#29](https://github.com/spanexx/agentide/issues/29)) ([da10df0](https://github.com/spanexx/agentide/commit/da10df0901e15317da01fe1d35070481cfa8c58f))

## [0.2.1](https://github.com/spanexx/agentide/compare/agentide-v0.2.0...agentide-v0.2.1) (2026-08-06)


### Bug Fixes

* **agentide:** detached start self-kill on own pid guard ([#25](https://github.com/spanexx/agentide/issues/25)) ([95a2cb5](https://github.com/spanexx/agentide/commit/95a2cb55009388123e49fd062b2f7a062fa7d266))

## [0.2.0](https://github.com/spanexx/agentide/compare/agentide-v0.1.1...agentide-v0.2.0) (2026-08-05)


### Features

* **agentide:** ship meta-package with createPlatform() composition + CLI + install.sh ([7aecef1](https://github.com/spanexx/agentide/commit/7aecef1adf30d10675673cda81d7b70e343cb7d5))
* **agentide:** token issue gains repeatable --origin and --origins flags ([680aa0d](https://github.com/spanexx/agentide/commit/680aa0d12acdc534710c1868308f1665691560a8))
* **agentide:** unlock the SDK door (Phase 1/5) ([59289b2](https://github.com/spanexx/agentide/commit/59289b27d50ed097e0112ea029ce90c5ee39f8ef))
* **cli:** add --version / -v flag ([2affab0](https://github.com/spanexx/agentide/commit/2affab0f25ab4f407e63d3a6f961356f3d3ab7e2))
* **cli:** add agentide start subcommand (PRD S9) ([cbdf323](https://github.com/spanexx/agentide/commit/cbdf323c92d854a9908d40565e530f7c417f6393))
* **cli:** client subcommand (create/grant/list/revoke/rotate/redeem) (CID:cli-001..008, CID:types-022) ([60544e4](https://github.com/spanexx/agentide/commit/60544e46995302aa113e35270e06f97643deff0b))
* **cli:** daemon lifecycle + init token auto-clear ([b6ceba5](https://github.com/spanexx/agentide/commit/b6ceba56c8d3d0b3f79c1a1d30d9516013246b55))
* **cli:** ship agentide-cli-consumer (BI[28]) — remote consumer commands + retire rust cli-adapter ([0eacb26](https://github.com/spanexx/agentide/commit/0eacb2626a215c7c1c0d10af7a7c7dfbdb993662))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **expected-origins:** sim S4b — CLI-minted origin-bound token e2e (match ok / mismatch 1008) ([24421b7](https://github.com/spanexx/agentide/commit/24421b7951070e68a9a70f71c0d16c8a916c5503))
* **gateway-core,adapter-mcp:** add OIDC auth-code grant (gated by --enable-oidc) (CID:oidc-001..003, CID:types-023, CID:server-005, CID:server-006) ([4334c84](https://github.com/spanexx/agentide/commit/4334c846c7f1d5db6ab24d5b5266fbfb3af355d4))
* **gateway-core,adapter-mcp:** add POST /oauth/token endpoint (CID:oauth-001..003, CID:cs-008) ([d36a2af](https://github.com/spanexx/agentide/commit/d36a2af69deedd7636d743b783e9077a9f8a3bc6))
* **gateway-sdk-dispatch:** Phase 6 agentide composition ([b4338c5](https://github.com/spanexx/agentide/commit/b4338c5740bb4fac09d3e12c68448733ebfa5ba1))
* implement BI[8a] gateway plugin dispatch ([fa50832](https://github.com/spanexx/agentide/commit/fa50832c0e013785c846f205121517b8a5856982))
* **mcp-adapter:** real adapter pkg + meta-package wiring + interconnected sim ([50b0ca2](https://github.com/spanexx/agentide/commit/50b0ca2141ac9232977b5b642e73790be5da4bcb))
* **permission-tiering:** ship BI[7] — phases 4-8 + reconcile + drift log ([4f9ee2b](https://github.com/spanexx/agentide/commit/4f9ee2b6aafaa126a46b655a1d3c0bd83a1f7520))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([83b8b94](https://github.com/spanexx/agentide/commit/83b8b94af666c33f6ad8591f1e8fd8990c5fdbd3))
* **release:** drop CJS residue from config, READMEs, CODEOWNERS, workspace (Phase 4/5) ([89ebfb2](https://github.com/spanexx/agentide/commit/89ebfb2404150ecdc49dc9358a79d710ca52310e))
* **release:** drop CJS siblings entirely (Phase 2/5) ([ecce6ee](https://github.com/spanexx/agentide/commit/ecce6ee34a455c6d9078f0cbc5e7fd85b9a6ae54))
* **release:** publish sdk-node-cjs + event-bus-cjs (Phase 3/5) ([b054e7c](https://github.com/spanexx/agentide/commit/b054e7c618d059a91647310839354a41799c5246))
* **sdk-browser:** phase 6 post-impl sim; fix 1→0 unregister found by sim ([64801c7](https://github.com/spanexx/agentide/commit/64801c701946ac1dbe49ff95a9f1fe77a2d85165))
* **sdk-browser:** ship @platform/sdk-browser (BI[11]) ([7e08d09](https://github.com/spanexx/agentide/commit/7e08d090d413c1453b534932c1733150a3620855))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* ship BI[8a] gateway-plugin dispatch and update docs ([23762e8](https://github.com/spanexx/agentide/commit/23762e851ed2e919db11be145bdc5125c4ea2ba2))
* **websocket-adapter:** ship BI[24] — 16-frame WS adapter, agentide wiring, post-impl sim, drift close ([f7fe324](https://github.com/spanexx/agentide/commit/f7fe32438bc5bef529916f41bea698031b252446))


### Bug Fixes

* **agentide:** register global uncaught error handlers ([f689b86](https://github.com/spanexx/agentide/commit/f689b86a4deba1508a8aff4da3684cf2833defb9))
* **build:** extract @platform/errors package, fix dep graph, use tsc --build ([3e55487](https://github.com/spanexx/agentide/commit/3e55487a766902374f0b1466a1328bb1f2172852))
* **cli,gateway-core:** close D-70 (audit), D-72 (active revocation), D-73 (--no-tls) ([a78f059](https://github.com/spanexx/agentide/commit/a78f059ea871759657de9336e4d3c2e376513da6))
* **cli:** resolve BI[28] drift review gaps (D-66, D-67) ([de1086c](https://github.com/spanexx/agentide/commit/de1086c2ecde13192fb351c3e5660e3321715453))
* **permission-tiering:** correct filtering, docs and tests ([4a93784](https://github.com/spanexx/agentide/commit/4a9378445a853fda5d3a3f47d890a82317289ebd))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **publish:** empty deps in prepublish so tarball ships dependencies:{} ([8346410](https://github.com/spanexx/agentide/commit/834641027f977ff628ed2047920d38cb6d52645b))
* **publish:** rebuild bundle unconditionally in prepublishOnly ([34b40b8](https://github.com/spanexx/agentide/commit/34b40b87e54371cfe735c8aed27a33cd5847c1a5))
* **publish:** repair broken 0.0.2 + rewrite install.sh ([05a9288](https://github.com/spanexx/agentide/commit/05a9288b05dc41b4a4d44d1da4c077a4e782a356))
* **release:** mirror-cjs-versions.mjs handles flat-string manifest ([2afccf4](https://github.com/spanexx/agentide/commit/2afccf4b27dad76f478bbe9ae42016b1db07fb5c))

## [0.1.0](https://github.com/spanexx/agentide/compare/agentide-v0.0.6...agentide-v0.1.0) (2026-08-05)


### Features

* **agentide:** ship meta-package with createPlatform() composition + CLI + install.sh ([7aecef1](https://github.com/spanexx/agentide/commit/7aecef1adf30d10675673cda81d7b70e343cb7d5))
* **agentide:** token issue gains repeatable --origin and --origins flags ([680aa0d](https://github.com/spanexx/agentide/commit/680aa0d12acdc534710c1868308f1665691560a8))
* **cli:** add --version / -v flag ([2affab0](https://github.com/spanexx/agentide/commit/2affab0f25ab4f407e63d3a6f961356f3d3ab7e2))
* **cli:** add agentide start subcommand (PRD S9) ([cbdf323](https://github.com/spanexx/agentide/commit/cbdf323c92d854a9908d40565e530f7c417f6393))
* **cli:** client subcommand (create/grant/list/revoke/rotate/redeem) (CID:cli-001..008, CID:types-022) ([60544e4](https://github.com/spanexx/agentide/commit/60544e46995302aa113e35270e06f97643deff0b))
* **cli:** daemon lifecycle + init token auto-clear ([b6ceba5](https://github.com/spanexx/agentide/commit/b6ceba56c8d3d0b3f79c1a1d30d9516013246b55))
* **cli:** ship agentide-cli-consumer (BI[28]) — remote consumer commands + retire rust cli-adapter ([0eacb26](https://github.com/spanexx/agentide/commit/0eacb2626a215c7c1c0d10af7a7c7dfbdb993662))
* **expected-origins:** sim S4b — CLI-minted origin-bound token e2e (match ok / mismatch 1008) ([24421b7](https://github.com/spanexx/agentide/commit/24421b7951070e68a9a70f71c0d16c8a916c5503))
* **gateway-core,adapter-mcp:** add OIDC auth-code grant (gated by --enable-oidc) (CID:oidc-001..003, CID:types-023, CID:server-005, CID:server-006) ([4334c84](https://github.com/spanexx/agentide/commit/4334c846c7f1d5db6ab24d5b5266fbfb3af355d4))
* **gateway-core,adapter-mcp:** add POST /oauth/token endpoint (CID:oauth-001..003, CID:cs-008) ([d36a2af](https://github.com/spanexx/agentide/commit/d36a2af69deedd7636d743b783e9077a9f8a3bc6))
* **gateway-sdk-dispatch:** Phase 6 agentide composition ([b4338c5](https://github.com/spanexx/agentide/commit/b4338c5740bb4fac09d3e12c68448733ebfa5ba1))
* implement BI[8a] gateway plugin dispatch ([fa50832](https://github.com/spanexx/agentide/commit/fa50832c0e013785c846f205121517b8a5856982))
* **mcp-adapter:** real adapter pkg + meta-package wiring + interconnected sim ([50b0ca2](https://github.com/spanexx/agentide/commit/50b0ca2141ac9232977b5b642e73790be5da4bcb))
* **permission-tiering:** ship BI[7] — phases 4-8 + reconcile + drift log ([4f9ee2b](https://github.com/spanexx/agentide/commit/4f9ee2b6aafaa126a46b655a1d3c0bd83a1f7520))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([83b8b94](https://github.com/spanexx/agentide/commit/83b8b94af666c33f6ad8591f1e8fd8990c5fdbd3))
* **sdk-browser:** phase 6 post-impl sim; fix 1→0 unregister found by sim ([64801c7](https://github.com/spanexx/agentide/commit/64801c701946ac1dbe49ff95a9f1fe77a2d85165))
* **sdk-browser:** ship @platform/sdk-browser (BI[11]) ([7e08d09](https://github.com/spanexx/agentide/commit/7e08d090d413c1453b534932c1733150a3620855))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* ship BI[8a] gateway-plugin dispatch and update docs ([23762e8](https://github.com/spanexx/agentide/commit/23762e851ed2e919db11be145bdc5125c4ea2ba2))
* **websocket-adapter:** ship BI[24] — 16-frame WS adapter, agentide wiring, post-impl sim, drift close ([f7fe324](https://github.com/spanexx/agentide/commit/f7fe32438bc5bef529916f41bea698031b252446))


### Bug Fixes

* **agentide:** register global uncaught error handlers ([f689b86](https://github.com/spanexx/agentide/commit/f689b86a4deba1508a8aff4da3684cf2833defb9))
* **build:** extract @platform/errors package, fix dep graph, use tsc --build ([3e55487](https://github.com/spanexx/agentide/commit/3e55487a766902374f0b1466a1328bb1f2172852))
* **cli,gateway-core:** close D-70 (audit), D-72 (active revocation), D-73 (--no-tls) ([a78f059](https://github.com/spanexx/agentide/commit/a78f059ea871759657de9336e4d3c2e376513da6))
* **cli:** resolve BI[28] drift review gaps (D-66, D-67) ([de1086c](https://github.com/spanexx/agentide/commit/de1086c2ecde13192fb351c3e5660e3321715453))
* **permission-tiering:** correct filtering, docs and tests ([4a93784](https://github.com/spanexx/agentide/commit/4a9378445a853fda5d3a3f47d890a82317289ebd))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **publish:** empty deps in prepublish so tarball ships dependencies:{} ([8346410](https://github.com/spanexx/agentide/commit/834641027f977ff628ed2047920d38cb6d52645b))
* **publish:** rebuild bundle unconditionally in prepublishOnly ([34b40b8](https://github.com/spanexx/agentide/commit/34b40b87e54371cfe735c8aed27a33cd5847c1a5))
* **publish:** repair broken 0.0.2 + rewrite install.sh ([05a9288](https://github.com/spanexx/agentide/commit/05a9288b05dc41b4a4d44d1da4c077a4e782a356))
