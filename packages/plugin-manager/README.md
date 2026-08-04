# @spanexx/plugin-manager

Install/update/uninstall plugins from a Plugin Manifest. Three plugin types: `runtime:` (executes caps — the future browser-runtime, docker-runtime, etc.), `service:` (observe-only, no caps), `developer:` (developer tooling, no caps). v1 supports local-source installs; registry-id installs stub out with `PLUGIN_MARKETPLACE_UNAVAILABLE` until the marketplace pack ships.

## install

```bash
npm install @spanexx/plugin-manager
```

## usage

```typescript
import { createPluginManager } from '@spanexx/plugin-manager';

const pm = await createPluginManager(eventBus, capabilityRegistry, {
  installRecordPath: './data/installed-plugins.json',
});
await pm.install({
  manifest: { runtime: { id: 'browser', version: '1.0.0' } },
  source: './plugins/browser',
});
```

## public surface

- `createPluginManager(eventBus, registry, opts)` → `{ install, installFromRegistry, update, reload, disable, enable, uninstall, list, get }`
- install records persist to `./data/installed-plugins.json`; startup re-installs each, sets `lastError` on failure (does NOT fire `plugin.installed`)
- `disable` = soft pause (caps stay registered, new invocations rejected, in-flight finish)
- `update` = swap install record + re-register caps; in-flight invocations finish against the old version, new invocations route to the new
- tier inference via verb convention (`read`/`act`/`destructive`) in plugin manifests

## when you'll see it

gateway's `plugin.*` caps route to this. CLI's `agentide plugin list` reads from here. dashboard's "Installed Plugins" view uses the same data.

## integration

depends on capability-registry + event-bus. depended on by gateway-core (registers built-in `plugin.*` caps through this).