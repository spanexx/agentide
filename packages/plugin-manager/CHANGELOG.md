# Changelog

## [0.3.0](https://github.com/spanexx/agentide/compare/plugin-manager-v0.2.1...plugin-manager-v0.3.0) (2026-08-06)


### Features

* **browser-runtime:** phases 1-8 — driver, handlers, lifecycle, snapshot + drift reconcile ([627b002](https://github.com/spanexx/agentide/commit/627b00298c45ad1b99a1ace3889b5a88bf646c7d))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **permission-tiering:** BI[7] tier field + validator + convention + 25 platform caps ([f617092](https://github.com/spanexx/agentide/commit/f6170921e310bc48e1de936bc888c6398c7b0ef9))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **plugin-manager,gateway-core:** AUDIT F10 — preserve handler originalErrorCode + retryable through GATEWAY_HANDLER_ERROR envelope ([5ee1cab](https://github.com/spanexx/agentide/commit/5ee1cab48277fecf0975afd75603690223ce37fc))
* **plugin-manager:** BI[8a] Phase 2 — handler lifecycle integration tests ([b7e45f7](https://github.com/spanexx/agentide/commit/b7e45f760012421d746363d912651c9d6c07498a))
* **plugin-manager:** Phase 1 of BI[8a] gateway-plugin-dispatch ([162b4b2](https://github.com/spanexx/agentide/commit/162b4b2289b26ef1758afbff078e1a86cf21fa06))
* **plugin-manager:** ship control-plane plugin lifecycle manager ([3fc9061](https://github.com/spanexx/agentide/commit/3fc906162559c8778e7f47dc4d64c48d43b9de16))
* **sdk-browser,backend-runtime:** resolve drift D-40/D-43 — register-frame parity + per-tab gateway keys; reconcile DR-BR-10/DR-BR-11, mark browser-runtime shipped ([be314ef](https://github.com/spanexx/agentide/commit/be314ef310911828c05794a36032d01ec122c0d1))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))


### Bug Fixes

* **gateway-core,plugin-manager:** serialize concurrent file writes ([66310b6](https://github.com/spanexx/agentide/commit/66310b6ff06fdd899d5f74c5ac795d6b8963ee5d))
* **permission-tiering:** correct filtering, docs and tests ([4a93784](https://github.com/spanexx/agentide/commit/4a9378445a853fda5d3a3f47d890a82317289ebd))
* **plugin-manager,session-manager:** address strict-mode type errors in clock adapter + stub ([66d4362](https://github.com/spanexx/agentide/commit/66d4362adcff846536adcca7f6a45406e35a9dc6))
* **plugin-manager:** address feature-pipeline-review gaps ([a7f8ffd](https://github.com/spanexx/agentide/commit/a7f8ffddeccf4acf73343e7ea1ec04800a00ce18))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))

## [0.2.0](https://github.com/spanexx/agentide/compare/plugin-manager-v0.1.1...plugin-manager-v0.2.0) (2026-08-05)


### Features

* **browser-runtime:** phases 1-8 — driver, handlers, lifecycle, snapshot + drift reconcile ([627b002](https://github.com/spanexx/agentide/commit/627b00298c45ad1b99a1ace3889b5a88bf646c7d))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **permission-tiering:** BI[7] tier field + validator + convention + 25 platform caps ([f617092](https://github.com/spanexx/agentide/commit/f6170921e310bc48e1de936bc888c6398c7b0ef9))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **plugin-manager,gateway-core:** AUDIT F10 — preserve handler originalErrorCode + retryable through GATEWAY_HANDLER_ERROR envelope ([5ee1cab](https://github.com/spanexx/agentide/commit/5ee1cab48277fecf0975afd75603690223ce37fc))
* **plugin-manager:** BI[8a] Phase 2 — handler lifecycle integration tests ([b7e45f7](https://github.com/spanexx/agentide/commit/b7e45f760012421d746363d912651c9d6c07498a))
* **plugin-manager:** Phase 1 of BI[8a] gateway-plugin-dispatch ([162b4b2](https://github.com/spanexx/agentide/commit/162b4b2289b26ef1758afbff078e1a86cf21fa06))
* **plugin-manager:** ship control-plane plugin lifecycle manager ([3fc9061](https://github.com/spanexx/agentide/commit/3fc906162559c8778e7f47dc4d64c48d43b9de16))
* **sdk-browser,backend-runtime:** resolve drift D-40/D-43 — register-frame parity + per-tab gateway keys; reconcile DR-BR-10/DR-BR-11, mark browser-runtime shipped ([be314ef](https://github.com/spanexx/agentide/commit/be314ef310911828c05794a36032d01ec122c0d1))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))


### Bug Fixes

* **gateway-core,plugin-manager:** serialize concurrent file writes ([66310b6](https://github.com/spanexx/agentide/commit/66310b6ff06fdd899d5f74c5ac795d6b8963ee5d))
* **permission-tiering:** correct filtering, docs and tests ([4a93784](https://github.com/spanexx/agentide/commit/4a9378445a853fda5d3a3f47d890a82317289ebd))
* **plugin-manager,session-manager:** address strict-mode type errors in clock adapter + stub ([66d4362](https://github.com/spanexx/agentide/commit/66d4362adcff846536adcca7f6a45406e35a9dc6))
* **plugin-manager:** address feature-pipeline-review gaps ([a7f8ffd](https://github.com/spanexx/agentide/commit/a7f8ffddeccf4acf73343e7ea1ec04800a00ce18))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))

## [0.1.0](https://github.com/spanexx/agentide/compare/plugin-manager-v0.0.2...plugin-manager-v0.1.0) (2026-08-05)


### Features

* **browser-runtime:** phases 1-8 — driver, handlers, lifecycle, snapshot + drift reconcile ([627b002](https://github.com/spanexx/agentide/commit/627b00298c45ad1b99a1ace3889b5a88bf646c7d))
* **permission-tiering:** BI[7] tier field + validator + convention + 25 platform caps ([f617092](https://github.com/spanexx/agentide/commit/f6170921e310bc48e1de936bc888c6398c7b0ef9))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **plugin-manager,gateway-core:** AUDIT F10 — preserve handler originalErrorCode + retryable through GATEWAY_HANDLER_ERROR envelope ([5ee1cab](https://github.com/spanexx/agentide/commit/5ee1cab48277fecf0975afd75603690223ce37fc))
* **plugin-manager:** BI[8a] Phase 2 — handler lifecycle integration tests ([b7e45f7](https://github.com/spanexx/agentide/commit/b7e45f760012421d746363d912651c9d6c07498a))
* **plugin-manager:** Phase 1 of BI[8a] gateway-plugin-dispatch ([162b4b2](https://github.com/spanexx/agentide/commit/162b4b2289b26ef1758afbff078e1a86cf21fa06))
* **plugin-manager:** ship control-plane plugin lifecycle manager ([3fc9061](https://github.com/spanexx/agentide/commit/3fc906162559c8778e7f47dc4d64c48d43b9de16))
* **sdk-browser,backend-runtime:** resolve drift D-40/D-43 — register-frame parity + per-tab gateway keys; reconcile DR-BR-10/DR-BR-11, mark browser-runtime shipped ([be314ef](https://github.com/spanexx/agentide/commit/be314ef310911828c05794a36032d01ec122c0d1))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))


### Bug Fixes

* **gateway-core,plugin-manager:** serialize concurrent file writes ([66310b6](https://github.com/spanexx/agentide/commit/66310b6ff06fdd899d5f74c5ac795d6b8963ee5d))
* **permission-tiering:** correct filtering, docs and tests ([4a93784](https://github.com/spanexx/agentide/commit/4a9378445a853fda5d3a3f47d890a82317289ebd))
* **plugin-manager,session-manager:** address strict-mode type errors in clock adapter + stub ([66d4362](https://github.com/spanexx/agentide/commit/66d4362adcff846536adcca7f6a45406e35a9dc6))
* **plugin-manager:** address feature-pipeline-review gaps ([a7f8ffd](https://github.com/spanexx/agentide/commit/a7f8ffddeccf4acf73343e7ea1ec04800a00ce18))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
