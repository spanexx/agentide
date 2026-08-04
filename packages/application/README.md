# @spanexx/application

Application entity — represents a developer's app connected to the platform (the `appId` you pass to `createSdk`). Provides CRUD + lifecycle for app records (create, list, get, rotate-secret, suspend, delete) and is the source of truth for the per-app connection secret used by `@spanexx/backend-runtime`.

## install

```bash
npm install @spanexx/application
```

## usage

```typescript
import { createApplication } from '@spanexx/application';

const apps = createApplication(eventBus, sessionManager);
const app = apps.register({ id: 'app_01ABC...', name: 'Acme Storefront' });
const { token } = apps.issueConnectionToken(app.id);
```

## public surface

- `createApplication(eventBus, sessionManager)` → `{ register, list, get, rotateSecret, suspend, delete }`
- app IDs are ULIDs with `app_` prefix (sortable by creation time)
- `issueConnectionToken(appId)` → short-lived token for backend-runtime handshake

## when you'll see it

this package is the registry that `@spanexx/backend-runtime` checks against when an SDK tries to connect. when `sdk-node` calls `connect()`, the runtime mints a connection token via this package, then accepts the SDK's WS connection.

## integration

depends on session-manager + event-bus. depended on by backend-runtime (every SDK connect validates against an app record here).