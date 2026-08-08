# Changelog

## [0.2.1](https://github.com/spanexx/agentide/compare/sdk-browser-v0.2.0...sdk-browser-v0.2.1) (2026-08-08)


### Bug Fixes

* **release:** restore real npm deps in package.json (CI lockfile break) ([d2fdd41](https://github.com/spanexx/agentide/commit/d2fdd41ab84d540982852118c1fadd0d9e7cd3bd))

## [0.2.0](https://github.com/spanexx/agentide/compare/sdk-browser-v0.1.0...sdk-browser-v0.2.0) (2026-08-05)


### Features

* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **release:** drop CJS residue from config, READMEs, CODEOWNERS, workspace (Phase 4/5) ([89ebfb2](https://github.com/spanexx/agentide/commit/89ebfb2404150ecdc49dc9358a79d710ca52310e))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))

## [0.1.0](https://github.com/spanexx/agentide/compare/sdk-browser-v0.0.3...sdk-browser-v0.1.0) (2026-08-05)


### Features

* **browser-runtime:** phases 1-8 — driver, handlers, lifecycle, snapshot + drift reconcile ([627b002](https://github.com/spanexx/agentide/commit/627b00298c45ad1b99a1ace3889b5a88bf646c7d))
* **sdk-browser,backend-runtime:** resolve drift D-40/D-43 — register-frame parity + per-tab gateway keys; reconcile DR-BR-10/DR-BR-11, mark browser-runtime shipped ([be314ef](https://github.com/spanexx/agentide/commit/be314ef310911828c05794a36032d01ec122c0d1))
* **sdk-browser:** phase 1 skeleton, types, createSdk stub ([03dad96](https://github.com/spanexx/agentide/commit/03dad9651a23458bef4ed562fe125ab87c138630))
* **sdk-browser:** phase 2 observer + count-based dedup (T2) ([7bd1154](https://github.com/spanexx/agentide/commit/7bd1154e666c9f3d797d64e14f327ad816721bf6))
* **sdk-browser:** phase 3 dispatch + form-fill fallback (T1, T2Q5) ([0366285](https://github.com/spanexx/agentide/commit/03662854fc232856fdb33ac202f7c9ba0ae01d7d))
* **sdk-browser:** phase 4 ws client, auth-first, backoff, 1008 terminal (T3, T5) ([cfbc75f](https://github.com/spanexx/agentide/commit/cfbc75fe2754207a4490972676390fa844e4ac88))
* **sdk-browser:** phase 5 lifecycle, state, events, register-on-connect (T2, T3, T4) ([404eb0a](https://github.com/spanexx/agentide/commit/404eb0a87f8defb1657632d5045bd06df2e37c74))
* **sdk-browser:** phase 6 post-impl sim; fix 1→0 unregister found by sim ([64801c7](https://github.com/spanexx/agentide/commit/64801c701946ac1dbe49ff95a9f1fe77a2d85165))
* **sdk-browser:** ship @platform/sdk-browser (BI[11]) ([7e08d09](https://github.com/spanexx/agentide/commit/7e08d090d413c1453b534932c1733150a3620855))
