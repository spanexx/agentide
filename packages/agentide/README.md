# @spanexx/agentide

Composition meta-package. wires gateway-core + capability-registry + session-manager + plugin-manager + platform-capabilities + both adapters (mcp on 7100, websocket on 7300) + optional backend-runtime into a single `createPlatform()` call. ships the `agentide` CLI binary for operator day-2 ops.

## install

```bash
npm install @spanexx/agentide
```

## usage

```typescript
import { createPlatform } from '@spanexx/agentide';
import * as fs from 'node:fs/promises';

const platform = await createPlatform({
  fs: {
    readFile: (p) => fs.readFile(p, 'utf8'),
    writeFile: (p, d, m) => fs.writeFile(p, d, { encoding: 'utf8', mode: m }),
    exists: async (p) => { try { await fs.access(p); return true; } catch { return false; } },
  },
  dataDir: './data',
  defaultTenant: { id: 'acme', name: 'Acme' },
  adapterMcp: { host: '127.0.0.1', port: 7100 },
  adapterWs: { host: '127.0.0.1', port: 7300 },
  backendRuntimePort: 0,  // optional, auto-creates backend-runtime
});
```

## CLI

the package exposes a `bin` entry — once installed globally, `agentide` is on PATH:

```bash
agentide init                                       # initialize data dir + bootstrap tenant
agentide status                                     # show gateway status
agentide tenant create --id acme --name "Acme"      # manage tenants
agentide token issue --tenant acme --caller app --scope '*' --origin https://app.example.com
agentide capability list                            # list registered caps
agentide capability describe --name product.list
agentide plugin list                                # list installed plugins
```

the CLI spins up a short-lived `Platform` per invocation, runs the command, tears down. CLIs do NOT bind :7100 / :7300 (would race across back-to-back invocations).

## public surface

- `createPlatform(config)` → `Platform` handle with `{ gateway, eventBus, capabilityRegistry, sessionManager, pluginManager, mcpAdapter?, wsAdapter?, backendRuntime?, stop() }`
- `runCli(argv, opts)` → `CliResult` with `{ stdout, stderr, exitCode }`
- `installGlobalErrorHandlers(sink?)` — sets up uncaughtException / unhandledRejection loggers

## integration

the top-level composer. depends on every other internal package. this is the only package that end users typically install.