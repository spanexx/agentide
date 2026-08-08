# Changelog

## [0.7.1](https://github.com/spanexx/agentide/compare/adapter-mcp-v0.7.0...adapter-mcp-v0.7.1) (2026-08-08)


### Bug Fixes

* **release:** restore real npm deps in package.json (CI lockfile break) ([d2fdd41](https://github.com/spanexx/agentide/commit/d2fdd41ab84d540982852118c1fadd0d9e7cd3bd))

## [0.7.0](https://github.com/spanexx/agentide/compare/adapter-mcp-v0.6.0...adapter-mcp-v0.7.0) (2026-08-07)


### Features

* **adapter-core:** A8 MCP migration + A9 REST adapter pack ([#59](https://github.com/spanexx/agentide/issues/59)) ([25ae5a0](https://github.com/spanexx/agentide/commit/25ae5a0be2825a1dfa19be02acc95d8ca974d3b9))

## [0.6.0](https://github.com/spanexx/agentide/compare/adapter-mcp-v0.5.1...adapter-mcp-v0.6.0) (2026-08-07)


### Features

* **cli:** client subcommand (create/grant/list/revoke/rotate/redeem) (CID:cli-001..008, CID:types-022) ([60544e4](https://github.com/spanexx/agentide/commit/60544e46995302aa113e35270e06f97643deff0b))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **gateway-core,adapter-mcp:** add OIDC auth-code grant (gated by --enable-oidc) (CID:oidc-001..003, CID:types-023, CID:server-005, CID:server-006) ([4334c84](https://github.com/spanexx/agentide/commit/4334c846c7f1d5db6ab24d5b5266fbfb3af355d4))
* **gateway-core,adapter-mcp:** add POST /oauth/token endpoint (CID:oauth-001..003, CID:cs-008) ([d36a2af](https://github.com/spanexx/agentide/commit/d36a2af69deedd7636d743b783e9077a9f8a3bc6))
* **mcp-adapter:** real adapter pkg + meta-package wiring + interconnected sim ([50b0ca2](https://github.com/spanexx/agentide/commit/50b0ca2141ac9232977b5b642e73790be5da4bcb))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))


### Bug Fixes

* **platform-capabilities:** session.list description no longer claims v1 stub ([#32](https://github.com/spanexx/agentide/issues/32)) ([427bd0a](https://github.com/spanexx/agentide/commit/427bd0a0780422ecf6f99b0ed9e20187b979445a))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **release:** sync package.json + manifest to npm state ([29765f4](https://github.com/spanexx/agentide/commit/29765f4edaf1b5d8f18b9df7054833e74f16e3d4))
* **release:** sync package.json + manifest to npm state ([#52](https://github.com/spanexx/agentide/issues/52)) ([302d205](https://github.com/spanexx/agentide/commit/302d205a9b4ca6a7c8343c477f7fc8fdcd7a31f1))

## [0.5.0](https://github.com/spanexx/agentide/compare/adapter-mcp-v0.4.1...adapter-mcp-v0.5.0) (2026-08-06)


### Features

* **cli:** client subcommand (create/grant/list/revoke/rotate/redeem) (CID:cli-001..008, CID:types-022) ([60544e4](https://github.com/spanexx/agentide/commit/60544e46995302aa113e35270e06f97643deff0b))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **gateway-core,adapter-mcp:** add OIDC auth-code grant (gated by --enable-oidc) (CID:oidc-001..003, CID:types-023, CID:server-005, CID:server-006) ([4334c84](https://github.com/spanexx/agentide/commit/4334c846c7f1d5db6ab24d5b5266fbfb3af355d4))
* **gateway-core,adapter-mcp:** add POST /oauth/token endpoint (CID:oauth-001..003, CID:cs-008) ([d36a2af](https://github.com/spanexx/agentide/commit/d36a2af69deedd7636d743b783e9077a9f8a3bc6))
* **mcp-adapter:** real adapter pkg + meta-package wiring + interconnected sim ([50b0ca2](https://github.com/spanexx/agentide/commit/50b0ca2141ac9232977b5b642e73790be5da4bcb))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))


### Bug Fixes

* **platform-capabilities:** session.list description no longer claims v1 stub ([#32](https://github.com/spanexx/agentide/issues/32)) ([427bd0a](https://github.com/spanexx/agentide/commit/427bd0a0780422ecf6f99b0ed9e20187b979445a))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **release:** sync package.json + manifest to npm state ([#52](https://github.com/spanexx/agentide/issues/52)) ([302d205](https://github.com/spanexx/agentide/commit/302d205a9b4ca6a7c8343c477f7fc8fdcd7a31f1))

## [0.4.0](https://github.com/spanexx/agentide/compare/adapter-mcp-v0.3.1...adapter-mcp-v0.4.0) (2026-08-06)


### Features

* **cli:** client subcommand (create/grant/list/revoke/rotate/redeem) (CID:cli-001..008, CID:types-022) ([60544e4](https://github.com/spanexx/agentide/commit/60544e46995302aa113e35270e06f97643deff0b))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **gateway-core,adapter-mcp:** add OIDC auth-code grant (gated by --enable-oidc) (CID:oidc-001..003, CID:types-023, CID:server-005, CID:server-006) ([4334c84](https://github.com/spanexx/agentide/commit/4334c846c7f1d5db6ab24d5b5266fbfb3af355d4))
* **gateway-core,adapter-mcp:** add POST /oauth/token endpoint (CID:oauth-001..003, CID:cs-008) ([d36a2af](https://github.com/spanexx/agentide/commit/d36a2af69deedd7636d743b783e9077a9f8a3bc6))
* **mcp-adapter:** real adapter pkg + meta-package wiring + interconnected sim ([50b0ca2](https://github.com/spanexx/agentide/commit/50b0ca2141ac9232977b5b642e73790be5da4bcb))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))


### Bug Fixes

* **platform-capabilities:** session.list description no longer claims v1 stub ([#32](https://github.com/spanexx/agentide/issues/32)) ([427bd0a](https://github.com/spanexx/agentide/commit/427bd0a0780422ecf6f99b0ed9e20187b979445a))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))

## [0.3.0](https://github.com/spanexx/agentide/compare/adapter-mcp-v0.2.1...adapter-mcp-v0.3.0) (2026-08-06)


### Features

* **cli:** client subcommand (create/grant/list/revoke/rotate/redeem) (CID:cli-001..008, CID:types-022) ([60544e4](https://github.com/spanexx/agentide/commit/60544e46995302aa113e35270e06f97643deff0b))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **gateway-core,adapter-mcp:** add OIDC auth-code grant (gated by --enable-oidc) (CID:oidc-001..003, CID:types-023, CID:server-005, CID:server-006) ([4334c84](https://github.com/spanexx/agentide/commit/4334c846c7f1d5db6ab24d5b5266fbfb3af355d4))
* **gateway-core,adapter-mcp:** add POST /oauth/token endpoint (CID:oauth-001..003, CID:cs-008) ([d36a2af](https://github.com/spanexx/agentide/commit/d36a2af69deedd7636d743b783e9077a9f8a3bc6))
* **mcp-adapter:** real adapter pkg + meta-package wiring + interconnected sim ([50b0ca2](https://github.com/spanexx/agentide/commit/50b0ca2141ac9232977b5b642e73790be5da4bcb))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))


### Bug Fixes

* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))

## [0.2.0](https://github.com/spanexx/agentide/compare/adapter-mcp-v0.1.1...adapter-mcp-v0.2.0) (2026-08-05)


### Features

* **cli:** client subcommand (create/grant/list/revoke/rotate/redeem) (CID:cli-001..008, CID:types-022) ([60544e4](https://github.com/spanexx/agentide/commit/60544e46995302aa113e35270e06f97643deff0b))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **gateway-core,adapter-mcp:** add OIDC auth-code grant (gated by --enable-oidc) (CID:oidc-001..003, CID:types-023, CID:server-005, CID:server-006) ([4334c84](https://github.com/spanexx/agentide/commit/4334c846c7f1d5db6ab24d5b5266fbfb3af355d4))
* **gateway-core,adapter-mcp:** add POST /oauth/token endpoint (CID:oauth-001..003, CID:cs-008) ([d36a2af](https://github.com/spanexx/agentide/commit/d36a2af69deedd7636d743b783e9077a9f8a3bc6))
* **mcp-adapter:** real adapter pkg + meta-package wiring + interconnected sim ([50b0ca2](https://github.com/spanexx/agentide/commit/50b0ca2141ac9232977b5b642e73790be5da4bcb))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))


### Bug Fixes

* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))

## [0.1.0](https://github.com/spanexx/agentide/compare/adapter-mcp-v0.0.2...adapter-mcp-v0.1.0) (2026-08-05)


### Features

* **cli:** client subcommand (create/grant/list/revoke/rotate/redeem) (CID:cli-001..008, CID:types-022) ([60544e4](https://github.com/spanexx/agentide/commit/60544e46995302aa113e35270e06f97643deff0b))
* **gateway-core,adapter-mcp:** add OIDC auth-code grant (gated by --enable-oidc) (CID:oidc-001..003, CID:types-023, CID:server-005, CID:server-006) ([4334c84](https://github.com/spanexx/agentide/commit/4334c846c7f1d5db6ab24d5b5266fbfb3af355d4))
* **gateway-core,adapter-mcp:** add POST /oauth/token endpoint (CID:oauth-001..003, CID:cs-008) ([d36a2af](https://github.com/spanexx/agentide/commit/d36a2af69deedd7636d743b783e9077a9f8a3bc6))
* **mcp-adapter:** real adapter pkg + meta-package wiring + interconnected sim ([50b0ca2](https://github.com/spanexx/agentide/commit/50b0ca2141ac9232977b5b642e73790be5da4bcb))


### Bug Fixes

* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
