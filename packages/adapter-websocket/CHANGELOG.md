# Changelog

## [0.7.0](https://github.com/spanexx/agentide/compare/adapter-websocket-v0.6.0...adapter-websocket-v0.7.0) (2026-08-07)


### Features

* **adapter-core:** ship shared server pipeline + migrate WS onto it ([0bc1046](https://github.com/spanexx/agentide/commit/0bc10463f5f41a85763018caa67dc5e87eb14cbc))


### Bug Fixes

* **adapter-websocket:** add adapter-core to tsconfig references (CI typecheck on fresh clone) ([1639f67](https://github.com/spanexx/agentide/commit/1639f670cc7c8d958583a147ad723568ade4fbdf))

## [0.6.0](https://github.com/spanexx/agentide/compare/adapter-websocket-v0.5.0...adapter-websocket-v0.6.0) (2026-08-07)


### Features

* **agentide:** CLI consumer UX — auto-mint session, default port, wrong-door error (D-79, D-80) ([1a6bfca](https://github.com/spanexx/agentide/commit/1a6bfca5d444ec362db0a2bf6d83cd25c78af37e))

## [0.5.0](https://github.com/spanexx/agentide/compare/adapter-websocket-v0.4.1...adapter-websocket-v0.5.0) (2026-08-06)


### Features

* **cli:** ship agentide-cli-consumer (BI[28]) — remote consumer commands + retire rust cli-adapter ([0eacb26](https://github.com/spanexx/agentide/commit/0eacb2626a215c7c1c0d10af7a7c7dfbdb993662))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **release:** drop CJS residue from config, READMEs, CODEOWNERS, workspace (Phase 4/5) ([89ebfb2](https://github.com/spanexx/agentide/commit/89ebfb2404150ecdc49dc9358a79d710ca52310e))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* **websocket-adapter:** ship BI[24] — 16-frame WS adapter, agentide wiring, post-impl sim, drift close ([f7fe324](https://github.com/spanexx/agentide/commit/f7fe32438bc5bef529916f41bea698031b252446))


### Bug Fixes

* **backend-runtime:** enforce expectedOrigins origin binding post-verify (drift D-54) ([21648d0](https://github.com/spanexx/agentide/commit/21648d0ee0bf7a3b3de52d476fafcb932a4c80d7))
* **cli:** resolve BI[28] drift review gaps (D-66, D-67) ([de1086c](https://github.com/spanexx/agentide/commit/de1086c2ecde13192fb351c3e5660e3321715453))
* **platform-capabilities:** session.list description no longer claims v1 stub ([#32](https://github.com/spanexx/agentide/issues/32)) ([427bd0a](https://github.com/spanexx/agentide/commit/427bd0a0780422ecf6f99b0ed9e20187b979445a))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **release:** sync package.json + manifest to npm state ([#52](https://github.com/spanexx/agentide/issues/52)) ([302d205](https://github.com/spanexx/agentide/commit/302d205a9b4ca6a7c8343c477f7fc8fdcd7a31f1))

## [0.4.0](https://github.com/spanexx/agentide/compare/adapter-websocket-v0.3.1...adapter-websocket-v0.4.0) (2026-08-06)


### Features

* **cli:** ship agentide-cli-consumer (BI[28]) — remote consumer commands + retire rust cli-adapter ([0eacb26](https://github.com/spanexx/agentide/commit/0eacb2626a215c7c1c0d10af7a7c7dfbdb993662))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **release:** drop CJS residue from config, READMEs, CODEOWNERS, workspace (Phase 4/5) ([89ebfb2](https://github.com/spanexx/agentide/commit/89ebfb2404150ecdc49dc9358a79d710ca52310e))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* **websocket-adapter:** ship BI[24] — 16-frame WS adapter, agentide wiring, post-impl sim, drift close ([f7fe324](https://github.com/spanexx/agentide/commit/f7fe32438bc5bef529916f41bea698031b252446))


### Bug Fixes

* **backend-runtime:** enforce expectedOrigins origin binding post-verify (drift D-54) ([21648d0](https://github.com/spanexx/agentide/commit/21648d0ee0bf7a3b3de52d476fafcb932a4c80d7))
* **cli:** resolve BI[28] drift review gaps (D-66, D-67) ([de1086c](https://github.com/spanexx/agentide/commit/de1086c2ecde13192fb351c3e5660e3321715453))
* **platform-capabilities:** session.list description no longer claims v1 stub ([#32](https://github.com/spanexx/agentide/issues/32)) ([427bd0a](https://github.com/spanexx/agentide/commit/427bd0a0780422ecf6f99b0ed9e20187b979445a))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))

## [0.3.0](https://github.com/spanexx/agentide/compare/adapter-websocket-v0.2.1...adapter-websocket-v0.3.0) (2026-08-06)


### Features

* **cli:** ship agentide-cli-consumer (BI[28]) — remote consumer commands + retire rust cli-adapter ([0eacb26](https://github.com/spanexx/agentide/commit/0eacb2626a215c7c1c0d10af7a7c7dfbdb993662))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **release:** drop CJS residue from config, READMEs, CODEOWNERS, workspace (Phase 4/5) ([89ebfb2](https://github.com/spanexx/agentide/commit/89ebfb2404150ecdc49dc9358a79d710ca52310e))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* **websocket-adapter:** ship BI[24] — 16-frame WS adapter, agentide wiring, post-impl sim, drift close ([f7fe324](https://github.com/spanexx/agentide/commit/f7fe32438bc5bef529916f41bea698031b252446))


### Bug Fixes

* **backend-runtime:** enforce expectedOrigins origin binding post-verify (drift D-54) ([21648d0](https://github.com/spanexx/agentide/commit/21648d0ee0bf7a3b3de52d476fafcb932a4c80d7))
* **cli:** resolve BI[28] drift review gaps (D-66, D-67) ([de1086c](https://github.com/spanexx/agentide/commit/de1086c2ecde13192fb351c3e5660e3321715453))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))

## [0.2.0](https://github.com/spanexx/agentide/compare/adapter-websocket-v0.1.1...adapter-websocket-v0.2.0) (2026-08-05)


### Features

* **cli:** ship agentide-cli-consumer (BI[28]) — remote consumer commands + retire rust cli-adapter ([0eacb26](https://github.com/spanexx/agentide/commit/0eacb2626a215c7c1c0d10af7a7c7dfbdb993662))
* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **release:** drop CJS residue from config, READMEs, CODEOWNERS, workspace (Phase 4/5) ([89ebfb2](https://github.com/spanexx/agentide/commit/89ebfb2404150ecdc49dc9358a79d710ca52310e))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* **websocket-adapter:** ship BI[24] — 16-frame WS adapter, agentide wiring, post-impl sim, drift close ([f7fe324](https://github.com/spanexx/agentide/commit/f7fe32438bc5bef529916f41bea698031b252446))


### Bug Fixes

* **backend-runtime:** enforce expectedOrigins origin binding post-verify (drift D-54) ([21648d0](https://github.com/spanexx/agentide/commit/21648d0ee0bf7a3b3de52d476fafcb932a4c80d7))
* **cli:** resolve BI[28] drift review gaps (D-66, D-67) ([de1086c](https://github.com/spanexx/agentide/commit/de1086c2ecde13192fb351c3e5660e3321715453))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))

## [0.1.0](https://github.com/spanexx/agentide/compare/adapter-websocket-v0.0.2...adapter-websocket-v0.1.0) (2026-08-05)


### Features

* **cli:** ship agentide-cli-consumer (BI[28]) — remote consumer commands + retire rust cli-adapter ([0eacb26](https://github.com/spanexx/agentide/commit/0eacb2626a215c7c1c0d10af7a7c7dfbdb993662))
* **websocket-adapter:** ship BI[24] — 16-frame WS adapter, agentide wiring, post-impl sim, drift close ([f7fe324](https://github.com/spanexx/agentide/commit/f7fe32438bc5bef529916f41bea698031b252446))


### Bug Fixes

* **backend-runtime:** enforce expectedOrigins origin binding post-verify (drift D-54) ([21648d0](https://github.com/spanexx/agentide/commit/21648d0ee0bf7a3b3de52d476fafcb932a4c80d7))
* **cli:** resolve BI[28] drift review gaps (D-66, D-67) ([de1086c](https://github.com/spanexx/agentide/commit/de1086c2ecde13192fb351c3e5660e3321715453))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
