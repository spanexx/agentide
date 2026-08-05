// ============================================================================
// start-gateway.mjs — local dev bootstrap for the Agentide gateway.
//
// What this does:
//   Spins up the full Agentide platform in-process: gateway-core (auth, rate
//   limit, audit, dispatch), the capability registry, session manager,
//   plugin manager, plus the MCP and WebSocket adapters that clients connect
//   to. Data is persisted under ./data (gateway secret, tenant records,
//   installed plugins, audit log).
//
// What this is NOT:
//   - Not the production deployment shape — production uses the `agentide`
//     CLI or a Docker image (see `docs/architecture/Agentide.md` §15).
//   - Not a multi-tenant operator tool — it auto-creates a single default
//     tenant `acme` so the nest demo can mint tokens against it.
//
// Network surface when running:
//   - 127.0.0.1:7100 — MCP adapter (JSON-RPC, for AI agents)
//   - 127.0.0.1:7300 — WebSocket adapter (for CLI, dashboard, agents)
//   - 127.0.0.1:7350 — Backend runtime (for sdk-node/sdk-browser — the
//                       SDK door; first-frame protocol is {type:"sdk.auth"})
//
// Auth:
//   The gateway signs JWTs with a secret stored in ./data/gateway-secret.
//   Mint a token via the gateway's issueToken API (see the agentide CLI
//   `agentide token issue`) — the demo's hardcoded "dev-bootstrap-token"
//   in example/.env is a placeholder, not a real JWT.
//
// Usage (from the agentide repo root):
//   pnpm run gateway       # foreground, logs to stdout
//   pnpm run gateway:log   # background-friendly, logs to /tmp/gateway.log
//   Ctrl-C                 # graceful shutdown via SIGINT
// ============================================================================

import { createPlatform, installGlobalErrorHandlers } from '../packages/agentide/dist/index.js';
import * as fs from 'node:fs/promises';

// Ensure the data dir exists before the platform factory tries to read or
// create files under it. The factory's loadOrCreateSecret uses raw
// writeFile() which does NOT auto-create parent directories.
await fs.mkdir('./data', { recursive: true });

// Install a process-level error handler so uncaught exceptions/rejections
// are logged with a stack instead of crashing silently.
installGlobalErrorHandlers();

// The platform factory needs a FileSystem interface for reading/writing the
// gateway secret, tenant records, and audit log. We pass a thin adapter over
// node's fs/promises so the demo uses real disk under ./data.
const platform = await createPlatform({
  fs: {
    readFile: (path) => fs.readFile(path, 'utf8'),
    writeFile: (path, data, mode) => fs.writeFile(path, data, { encoding: 'utf8', mode }),
    exists: async (path) => {
      try { await fs.access(path); return true; } catch { return false; }
    },
  },
  // Where the gateway stores its secret + tenant records + audit log.
  dataDir: './data',
  // Auto-create one tenant so the demo SDK can mint tokens without a separate
  // provisioning step. In production, tenants are created via tenant.create.
  defaultTenant: { id: 'acme', name: 'Acme' },
  // Both adapters default to ON; explicit here for clarity.
  adapterMcp: { host: '127.0.0.1', port: 7100 },
  adapterWs: { host: '127.0.0.1', port: 7300 },
  // BI[cjs-sdk-bootstrap] Phase 1: the canonical dev bootstrap opens the
  // SDK door so the example app (and any back-end consumer) has a reachable
  // target. CLI `agentide start` keeps the door closed by default; opt-in
  // via --port-sdk (start.ts:52-72). The factory accepts a bare port number;
  // --bind cannot be plumbed through to backend-runtime in v1 (server.ts:277
  // hardcodes host "127.0.0.1") — flagged as a follow-up.
  backendRuntimePort: 7350,
});

console.log('[gateway] platform up — mcp :7100, ws :7300, sdk :7350');

// Graceful shutdown — closes the adapters (releasing the ports) and lets
// in-flight invocations drain before the process exits.
const stop = async () => {
  console.log('[gateway] stopping...');
  await platform.stop();
  process.exit(0);
};
process.on('SIGINT', stop);   // Ctrl-C in foreground
process.on('SIGTERM', stop);  // pkill / docker stop / systemd stop