# @spanexx/adapter-mcp

MCP (Model Context Protocol) adapter. exposes the gateway over Streamable HTTP + JSON-RPC 2.0 so any MCP-compatible agent (Claude Desktop, MCP-CLI, custom clients) can discover and invoke capabilities as MCP tools. First way an agent actually reaches a connected app.

## install

```bash
npm install @spanexx/adapter-mcp
```

## usage

```typescript
import { createMcpAdapter } from '@spanexx/adapter-mcp';

const adapter = createMcpAdapter(gateway, { host: '127.0.0.1', port: 7100 });
await adapter.start();
```

## wire protocol

JSON-RPC 2.0 over HTTP POST. `tools/list` → returns all reachable caps (filtered by the caller's token scope). `tools/call` → forwards to `gateway.handleInvocation()`, returns `{ output }` or `{ error }`. error code mapping: -32001 capability not found, -32002 handler timeout, -32003 internal, -32004 unauthorized, -32005 rate-limited, -32006 invalid input.

## when you'll see it

default ON in `createPlatform()`. CLIs opt out per subcommand because the CLI is short-lived per invocation. ports default to 7100.

## public surface

- `createMcpAdapter(gateway, opts)` → `{ start, stop, address }`
- `McpAdapter`, `McpAdapterConfig` types

## integration

depends on gateway-core + capability-registry (for tools/list). wired into `@platform/agentide` via `adapterMcp` config.