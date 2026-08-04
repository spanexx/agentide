# @spanexx/backend-runtime

Gateway-side counterpart to `@spanexx/sdk-node` and `@spanexx/sdk-browser`. Accepts SDK WebSocket connections, performs the HS256 JWT handshake (same secret as gateway-core), accumulates caps per connection, atomically re-registers the full list with the capability registry on each cap message. Routes inbound `sdk.invoke` calls to the right SDK handler based on `callId`.

## install

```bash
npm install @spanexx/backend-runtime
```

## usage

```typescript
import { createBackendRuntime } from '@spanexx/backend-runtime';

const runtime = createBackendRuntime({
  port: 0,
  tokenSecret: gatewaySecret,  // same Uint8Array as gateway-core
  eventBus,
  capabilityRegistry,
  clock: systemClock(),
});
await runtime.start();  // auto-binds to OS-assigned port
```

## wire protocol

```
SDK → runtime:  {type:"sdk.auth", token}
runtime → SDK:  {type:"auth.ok", tokenRotationMinutes:60} | {type:"auth.error", code, message}
SDK → runtime:  {type:"register", capabilities:[{name,version,permissions,tier}]}
runtime → SDK: {type:"register.ok", accepted:[...]}|{type:"register.error", code, message}
gateway → SDK: {type:"invoke", callId, name, input, sessionId?}
SDK → gateway: {type:"invoke.result", callId, payload}|{type:"invoke.error", callId, code, message}
```

## error mapping

`HANDLER_NOT_FOUND` → `GATEWAY_CAPABILITY_NOT_FOUND`; `HANDLER_ERROR` → `GATEWAY_INTERNAL_ERROR`; 30s timeout → `GATEWAY_HANDLER_TIMEOUT retryable:true`; mid-invoke socket close → `GATEWAY_SDK_UNREACHABLE retryable:true`.

## replace semantics

same `appId` reconnect closes the prior socket + drops its caps atomically. `stop()` does the same for every connected appId.

## integration

depends on capability-registry + event-bus + application + errors + origin. wired into `@platform/agentide`'s `createPlatform()` when `backendRuntimePort` is set.