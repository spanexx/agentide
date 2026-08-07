# Changelog

## [0.6.0](https://github.com/spanexx/agentide/compare/session-manager-v0.5.1...session-manager-v0.6.0) (2026-08-07)


### Features

* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* **session-manager:** ship session lifecycle manager ([4a48622](https://github.com/spanexx/agentide/commit/4a48622aabcb804e611eef17e2b8917bcff9bf50))


### Bug Fixes

* **platform-capabilities:** session.list description no longer claims v1 stub ([#32](https://github.com/spanexx/agentide/issues/32)) ([427bd0a](https://github.com/spanexx/agentide/commit/427bd0a0780422ecf6f99b0ed9e20187b979445a))
* **plugin-manager,session-manager:** address strict-mode type errors in clock adapter + stub ([66d4362](https://github.com/spanexx/agentide/commit/66d4362adcff846536adcca7f6a45406e35a9dc6))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **release:** sync package.json + manifest to npm state ([29765f4](https://github.com/spanexx/agentide/commit/29765f4edaf1b5d8f18b9df7054833e74f16e3d4))
* **release:** sync package.json + manifest to npm state ([#52](https://github.com/spanexx/agentide/issues/52)) ([302d205](https://github.com/spanexx/agentide/commit/302d205a9b4ca6a7c8343c477f7fc8fdcd7a31f1))
* **session-manager:** align docs and per-symbol CID blocks, fix detach contract ([ee65769](https://github.com/spanexx/agentide/commit/ee657694df4eb41d4015f246ff4f3e334d555ac5))
* **session-manager:** clear timers map entry on archive ttl ([599f856](https://github.com/spanexx/agentide/commit/599f8565fe0456fa185e01e9057d82b8985dc779))
* **session-manager:** drop unused [@ts-expect-error](https://github.com/ts-expect-error) directive ([a946942](https://github.com/spanexx/agentide/commit/a9469428b2edadac9e60ab8bf366e51c3e2ec84b))
* **session-manager:** real session.list snapshot (D-45 closeout) ([#30](https://github.com/spanexx/agentide/issues/30)) ([daa0ec3](https://github.com/spanexx/agentide/commit/daa0ec36c209f36522670d6ba22aaabb5866a20e))

## [0.5.0](https://github.com/spanexx/agentide/compare/session-manager-v0.4.1...session-manager-v0.5.0) (2026-08-06)


### Features

* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* **session-manager:** ship session lifecycle manager ([4a48622](https://github.com/spanexx/agentide/commit/4a48622aabcb804e611eef17e2b8917bcff9bf50))


### Bug Fixes

* **platform-capabilities:** session.list description no longer claims v1 stub ([#32](https://github.com/spanexx/agentide/issues/32)) ([427bd0a](https://github.com/spanexx/agentide/commit/427bd0a0780422ecf6f99b0ed9e20187b979445a))
* **plugin-manager,session-manager:** address strict-mode type errors in clock adapter + stub ([66d4362](https://github.com/spanexx/agentide/commit/66d4362adcff846536adcca7f6a45406e35a9dc6))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **release:** sync package.json + manifest to npm state ([#52](https://github.com/spanexx/agentide/issues/52)) ([302d205](https://github.com/spanexx/agentide/commit/302d205a9b4ca6a7c8343c477f7fc8fdcd7a31f1))
* **session-manager:** align docs and per-symbol CID blocks, fix detach contract ([ee65769](https://github.com/spanexx/agentide/commit/ee657694df4eb41d4015f246ff4f3e334d555ac5))
* **session-manager:** clear timers map entry on archive ttl ([599f856](https://github.com/spanexx/agentide/commit/599f8565fe0456fa185e01e9057d82b8985dc779))
* **session-manager:** drop unused [@ts-expect-error](https://github.com/ts-expect-error) directive ([a946942](https://github.com/spanexx/agentide/commit/a9469428b2edadac9e60ab8bf366e51c3e2ec84b))
* **session-manager:** real session.list snapshot (D-45 closeout) ([#30](https://github.com/spanexx/agentide/issues/30)) ([daa0ec3](https://github.com/spanexx/agentide/commit/daa0ec36c209f36522670d6ba22aaabb5866a20e))

## [0.4.0](https://github.com/spanexx/agentide/compare/session-manager-v0.3.1...session-manager-v0.4.0) (2026-08-06)


### Features

* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* **session-manager:** ship session lifecycle manager ([4a48622](https://github.com/spanexx/agentide/commit/4a48622aabcb804e611eef17e2b8917bcff9bf50))


### Bug Fixes

* **platform-capabilities:** session.list description no longer claims v1 stub ([#32](https://github.com/spanexx/agentide/issues/32)) ([427bd0a](https://github.com/spanexx/agentide/commit/427bd0a0780422ecf6f99b0ed9e20187b979445a))
* **plugin-manager,session-manager:** address strict-mode type errors in clock adapter + stub ([66d4362](https://github.com/spanexx/agentide/commit/66d4362adcff846536adcca7f6a45406e35a9dc6))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **session-manager:** align docs and per-symbol CID blocks, fix detach contract ([ee65769](https://github.com/spanexx/agentide/commit/ee657694df4eb41d4015f246ff4f3e334d555ac5))
* **session-manager:** clear timers map entry on archive ttl ([599f856](https://github.com/spanexx/agentide/commit/599f8565fe0456fa185e01e9057d82b8985dc779))
* **session-manager:** drop unused [@ts-expect-error](https://github.com/ts-expect-error) directive ([a946942](https://github.com/spanexx/agentide/commit/a9469428b2edadac9e60ab8bf366e51c3e2ec84b))
* **session-manager:** real session.list snapshot (D-45 closeout) ([#30](https://github.com/spanexx/agentide/issues/30)) ([daa0ec3](https://github.com/spanexx/agentide/commit/daa0ec36c209f36522670d6ba22aaabb5866a20e))

## [0.3.0](https://github.com/spanexx/agentide/compare/session-manager-v0.2.1...session-manager-v0.3.0) (2026-08-06)


### Features

* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* **session-manager:** ship session lifecycle manager ([4a48622](https://github.com/spanexx/agentide/commit/4a48622aabcb804e611eef17e2b8917bcff9bf50))


### Bug Fixes

* **plugin-manager,session-manager:** address strict-mode type errors in clock adapter + stub ([66d4362](https://github.com/spanexx/agentide/commit/66d4362adcff846536adcca7f6a45406e35a9dc6))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **session-manager:** align docs and per-symbol CID blocks, fix detach contract ([ee65769](https://github.com/spanexx/agentide/commit/ee657694df4eb41d4015f246ff4f3e334d555ac5))
* **session-manager:** clear timers map entry on archive ttl ([599f856](https://github.com/spanexx/agentide/commit/599f8565fe0456fa185e01e9057d82b8985dc779))
* **session-manager:** drop unused [@ts-expect-error](https://github.com/ts-expect-error) directive ([a946942](https://github.com/spanexx/agentide/commit/a9469428b2edadac9e60ab8bf366e51c3e2ec84b))
* **session-manager:** real session.list snapshot (D-45 closeout) ([#30](https://github.com/spanexx/agentide/issues/30)) ([daa0ec3](https://github.com/spanexx/agentide/commit/daa0ec36c209f36522670d6ba22aaabb5866a20e))

## [0.2.0](https://github.com/spanexx/agentide/compare/session-manager-v0.1.1...session-manager-v0.2.0) (2026-08-05)


### Features

* **engines:** bump all 14 ESM packages + root to Node &gt;=22.12 (Phase 3/5) ([d6323b5](https://github.com/spanexx/agentide/commit/d6323b589ab646aabd70c1613a2b2554cfaac9f2))
* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **sdk:** add require condition to all 14 ESM exports maps (Phase 1a/5) ([afa3182](https://github.com/spanexx/agentide/commit/afa3182e7cdadc9db80ba86faacc6143ab66123e))
* **session-manager:** ship session lifecycle manager ([4a48622](https://github.com/spanexx/agentide/commit/4a48622aabcb804e611eef17e2b8917bcff9bf50))


### Bug Fixes

* **plugin-manager,session-manager:** address strict-mode type errors in clock adapter + stub ([66d4362](https://github.com/spanexx/agentide/commit/66d4362adcff846536adcca7f6a45406e35a9dc6))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **session-manager:** align docs and per-symbol CID blocks, fix detach contract ([ee65769](https://github.com/spanexx/agentide/commit/ee657694df4eb41d4015f246ff4f3e334d555ac5))
* **session-manager:** clear timers map entry on archive ttl ([599f856](https://github.com/spanexx/agentide/commit/599f8565fe0456fa185e01e9057d82b8985dc779))
* **session-manager:** drop unused [@ts-expect-error](https://github.com/ts-expect-error) directive ([a946942](https://github.com/spanexx/agentide/commit/a9469428b2edadac9e60ab8bf366e51c3e2ec84b))

## [0.1.0](https://github.com/spanexx/agentide/compare/session-manager-v0.0.2...session-manager-v0.1.0) (2026-08-05)


### Features

* **platform-capabilities:** ship 25 platform caps with real owners + authz wildcard + CLI filters ([300fb44](https://github.com/spanexx/agentide/commit/300fb44a107aaaf3a5b10e8280ba295f079b4dfd))
* **sdk-node:** Phase 7 — event bus wiring + post-impl drift doc fixes ([b78109e](https://github.com/spanexx/agentide/commit/b78109e0aa82957d2d0a1918b6e213cbc26abb86))
* **session-manager:** ship session lifecycle manager ([4a48622](https://github.com/spanexx/agentide/commit/4a48622aabcb804e611eef17e2b8917bcff9bf50))


### Bug Fixes

* **plugin-manager,session-manager:** address strict-mode type errors in clock adapter + stub ([66d4362](https://github.com/spanexx/agentide/commit/66d4362adcff846536adcca7f6a45406e35a9dc6))
* **publish:** 12 npm packages shipped — fixes from publish dry-run ([710ed0b](https://github.com/spanexx/agentide/commit/710ed0b43694bf4206ccc2ace50dc9a914411aef))
* **session-manager:** align docs and per-symbol CID blocks, fix detach contract ([ee65769](https://github.com/spanexx/agentide/commit/ee657694df4eb41d4015f246ff4f3e334d555ac5))
* **session-manager:** clear timers map entry on archive ttl ([599f856](https://github.com/spanexx/agentide/commit/599f8565fe0456fa185e01e9057d82b8985dc779))
* **session-manager:** drop unused [@ts-expect-error](https://github.com/ts-expect-error) directive ([a946942](https://github.com/spanexx/agentide/commit/a9469428b2edadac9e60ab8bf366e51c3e2ec84b))
