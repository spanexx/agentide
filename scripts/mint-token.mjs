// Mint a real JWT from the gateway's signing secret.
// Run from the agentide repo: `node scripts/mint-token.mjs <tenant> <caller> [scope]`
// Output: the JWT string on stdout.

import * as fs from 'node:fs/promises';
import { createPlatform } from '../packages/agentide/dist/index.js';

const tenantId = process.argv[2] ?? 'acme';
const callerId = process.argv[3] ?? 'nest-app';
const scope = (process.argv[4] ?? '*').split(',');

const platform = await createPlatform({
  fs: {
    readFile: (p) => fs.readFile(p, 'utf8'),
    writeFile: (p, d, m) => fs.writeFile(p, d, { encoding: 'utf8', mode: m }),
    exists: async (p) => { try { await fs.access(p); return true; } catch { return false; } },
  },
  dataDir: './data',
  defaultTenant: { id: 'acme', name: 'Acme' },
  adapterMcp: false,
  adapterWs: false,
});

const { token } = await platform.gateway.issueToken({
  tenantId,
  callerId,
  scope,
});

console.log(token);
await platform.stop();
process.exit(0);