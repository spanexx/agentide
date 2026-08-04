# @spanexx/session-manager

Lifecycle manager for execution contexts. Active ⇄ Suspended → Archived (soft-delete, metadata retained for TTL). Sessions own their runtime resources (browser tabs, temp files, DB transactions) — destroying a session cleans them up automatically. Timeouts: 5 min idle → Suspended, 30 min TTL → Archived (both configurable per-session).

## install

```bash
npm install @spanexx/session-manager
```

## usage

```typescript
import { createSessionManager } from '@spanexx/session-manager';

const sm = createSessionManager(eventBus, { idleTimeoutMs: 5 * 60_000, archiveTtlMs: 30 * 60_000 });
const session = sm.create({ tenantId, owner: 'gateway', metadata: { userId: 'u-1' } });
const resource = session.attachResource({ kind: 'browser-tab', id: 't-123' });
sm.suspend(session.id);
sm.resume(session.id);
sm.destroy(session.id);  // fires session.cleanup_resources BEFORE session.destroyed
```

## public surface

- `createSessionManager(eventBus, opts)` → `{ create, get, list, suspend, resume, destroy, attachResource, detachResource }`
- `Session` — has `.id`, `.tenantId`, `.state`, `.resources[]`, `.metadata`
- `SessionState = 'active' | 'suspended' | 'archived'`

## when you'll see it

gateway creates a session for every `business.*` / `plugin:*` / `runtime:*` invocation that requires one. read-only discovery caps (`session.list`, `plugin.list`, `gateway.status`, `system.*`, `auth.token.*`) are session-less.

## integration

depends on `@spanexx/event-bus`. emits `session.created` / `suspended` / `resumed` / `destroyed` / `cleanup_resources`. used by gateway-core for session checks in the dispatch pipeline.