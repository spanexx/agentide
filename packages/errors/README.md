# @spanexx/errors

Structured error type used across every Agentide package. Replaces thrown `Error` with `{ code, message, details? }` shape so callers can pattern-match on stable codes instead of parsing messages.

## install

```bash
npm install @spanexx/errors
```

## usage

```typescript
import { AgentideError } from '@spanexx/errors';

throw new AgentideError('CAPABILITY_NOT_FOUND', `capability "${name}" not registered`, { name });
```

## when you'll see it

every layer of the platform uses these. gateway-core for `GATEWAY_*` codes, plugin-manager for `PLUGIN_*`, capability-registry for `CAPABILITY_*`, adapter-websocket for `AUTH_*` / `CONNECT_*`, etc. catch by code, not by message.

## public surface

- `AgentideError` — base class with `code: string`, `message: string`, `details?: unknown`
- re-exports `ERROR_CODES` const maps per-package
- serializes to JSON as `{ code, message, details }` for cross-process transport (e.g. WS invoke.error frames)

## integration

leaf package — no internal deps. every other package depends on it.