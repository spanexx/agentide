# Changelog

## [0.3.0](https://github.com/spanexx/agentide/compare/backend-runtime-v0.2.1...backend-runtime-v0.3.0) (2026-08-06)


### Features

* **backend-runtime:** Phase 1+2+3 scaffold lifecycle capability-bridge ([9255fdd](https://github.com/spanexx/agentide/commit/9255fdd591df6d1e685d889278c3af8d38fbeaed))
* **backend-runtime:** send sdk.auth.ack with protocolVersion on auth ([2efa6c3](https://github.com/spanexx/agentide/commit/2efa6c353139370ff7cb215946931d27f09d0e9a))
* **browser-runtime:** phases 1-8 — driver, handlers, lifecycle, snapshot + drift reconcile ([627b002](https://github.com/spanexx/agentide/commit/627b00298c45ad1b99a1ace3889b5a88bf646c7d))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **gateway-sdk-dispatch:** Phase 4 dispatch path + Phase 5 kernel wiring ([0af5705](https://github.com/spanexx/agentide/commit/0af5705dfa520cd310ece3236a22883722d74377))
* **sdk-browser,backend-runtime:** resolve drift D-40/D-43 — register-frame parity + per-tab gateway keys; reconcile DR-BR-10/DR-BR-11, mark browser-runtime shipped ([be314ef](https://github.com/spanexx/agentide/commit/be314ef310911828c05794a36032d01ec122c0d1))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))


### Bug Fixes

* **backend-runtime:** enforce expectedOrigins origin binding post-verify (drift D-54) ([21648d0](https://github.com/spanexx/agentide/commit/21648d0ee0bf7a3b3de52d476fafcb932a4c80d7))
* **build:** extract @platform/errors package, fix dep graph, use tsc --build ([3e55487](https://github.com/spanexx/agentide/commit/3e55487a766902374f0b1466a1328bb1f2172852))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))

## [0.2.0](https://github.com/spanexx/agentide/compare/backend-runtime-v0.1.1...backend-runtime-v0.2.0) (2026-08-05)


### Features

* **backend-runtime:** Phase 1+2+3 scaffold lifecycle capability-bridge ([9255fdd](https://github.com/spanexx/agentide/commit/9255fdd591df6d1e685d889278c3af8d38fbeaed))
* **backend-runtime:** send sdk.auth.ack with protocolVersion on auth ([2efa6c3](https://github.com/spanexx/agentide/commit/2efa6c353139370ff7cb215946931d27f09d0e9a))
* **browser-runtime:** phases 1-8 — driver, handlers, lifecycle, snapshot + drift reconcile ([627b002](https://github.com/spanexx/agentide/commit/627b00298c45ad1b99a1ace3889b5a88bf646c7d))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **gateway-sdk-dispatch:** Phase 4 dispatch path + Phase 5 kernel wiring ([0af5705](https://github.com/spanexx/agentide/commit/0af5705dfa520cd310ece3236a22883722d74377))
* **sdk-browser,backend-runtime:** resolve drift D-40/D-43 — register-frame parity + per-tab gateway keys; reconcile DR-BR-10/DR-BR-11, mark browser-runtime shipped ([be314ef](https://github.com/spanexx/agentide/commit/be314ef310911828c05794a36032d01ec122c0d1))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))


### Bug Fixes

* **backend-runtime:** enforce expectedOrigins origin binding post-verify (drift D-54) ([21648d0](https://github.com/spanexx/agentide/commit/21648d0ee0bf7a3b3de52d476fafcb932a4c80d7))
* **build:** extract @platform/errors package, fix dep graph, use tsc --build ([3e55487](https://github.com/spanexx/agentide/commit/3e55487a766902374f0b1466a1328bb1f2172852))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))

## [0.1.0](https://github.com/spanexx/agentide/compare/backend-runtime-v0.0.2...backend-runtime-v0.1.0) (2026-08-05)


### Features

* **backend-runtime:** Phase 1+2+3 scaffold lifecycle capability-bridge ([9255fdd](https://github.com/spanexx/agentide/commit/9255fdd591df6d1e685d889278c3af8d38fbeaed))
* **backend-runtime:** send sdk.auth.ack with protocolVersion on auth ([2efa6c3](https://github.com/spanexx/agentide/commit/2efa6c353139370ff7cb215946931d27f09d0e9a))
* **browser-runtime:** phases 1-8 — driver, handlers, lifecycle, snapshot + drift reconcile ([627b002](https://github.com/spanexx/agentide/commit/627b00298c45ad1b99a1ace3889b5a88bf646c7d))
* **gateway-sdk-dispatch:** Phase 4 dispatch path + Phase 5 kernel wiring ([0af5705](https://github.com/spanexx/agentide/commit/0af5705dfa520cd310ece3236a22883722d74377))
* **sdk-browser,backend-runtime:** resolve drift D-40/D-43 — register-frame parity + per-tab gateway keys; reconcile DR-BR-10/DR-BR-11, mark browser-runtime shipped ([be314ef](https://github.com/spanexx/agentide/commit/be314ef310911828c05794a36032d01ec122c0d1))


### Bug Fixes

* **backend-runtime:** enforce expectedOrigins origin binding post-verify (drift D-54) ([21648d0](https://github.com/spanexx/agentide/commit/21648d0ee0bf7a3b3de52d476fafcb932a4c80d7))
* **build:** extract @platform/errors package, fix dep graph, use tsc --build ([3e55487](https://github.com/spanexx/agentide/commit/3e55487a766902374f0b1466a1328bb1f2172852))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
