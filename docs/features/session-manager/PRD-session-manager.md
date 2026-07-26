# PRD: Session Manager

## Status

- Type: Product requirements document
- Audience: Platform engineering, QA
- Scope: In-process session lifecycle manager that creates, tracks, suspends, resumes, and destroys execution contexts for AI agent interactions across the platform.
- Status: Draft 2026-07-26 — grill answers locked; awaiting user approval before moving into TRD/FLOW/IMPL.

## Summary

The Session Manager is the platform's execution context manager. Every AI agent interaction happens inside a session — a container that owns runtime resources (browser tabs, authentication tokens, temporary files, running containers) and auto-cleans them when the session ends. The Session Manager creates sessions on demand, keeps them alive across multi-step agent workflows, suspends them after idle periods to preserve resources, and destroys them with full cleanup on explicit request or timeout expiry. It is part of the Control Plane, called by the Gateway and invisible to AI agents and applications.

## Problem

Without a Session Manager, every component that needs an execution context either builds its own lifecycle or leaks resources when an agent disconnects:

- A Browser Runtime launches a tab for an agent, the agent goes idle, the tab stays open indefinitely.
- A Backend Runtime holds an authentication token for a multi-step workflow; if the workflow is interrupted, the token has no owner to revoke it.
- The Dashboard has no single source of truth for "what is happening right now" — active sessions, their owners, their resources.
- The Gateway cannot enforce session-level permissions or timeouts without a dedicated manager.
- Long-running agent workflows (browser automation, human-in-the-loop approvals) have no defined boundary between "still working" and "abandoned."

The cost of leaving this unsolved: resource leaks accumulate, the Dashboard is always outdated, long-running workflows lack a reliable lifecycle, and every new runtime reimplements its own cleanup.

## Product Goals

1. Create a session when the Gateway requests one, returning a unique session ID that all subsequent capability calls in that interaction use.
2. Track every session's status through its lifecycle: Active (running), Suspended (paused, resources preserved), Archived (soft-delete, metadata retained for configurable TTL).
3. Automatically suspend a session after a configurable idle timeout (default 5 minutes) — activity resets the timer, suspension preserves all runtime resources.
4. Resume a suspended session by ID when the Gateway receives a new capability call from the same agent, restoring the execution context without re-launching resources.
5. Automatically archive (soft-delete) a session after a configurable suspended TTL (default 30 minutes) — resources are cleaned up, but the session record is retained for debugging and billing.
6. Allow explicit destroy from either Active or Suspended state, triggered by the Gateway (adapter disconnect) or by Session Manager policy.
7. Track runtime resources per session — runtimes register owned resources against the session ID, and Session Manager signals cleanup on destroy.
8. Emit lifecycle events (session.created, session.suspended, session.resumed, session.destroyed, session.cleanup_resources) so other platform components can react — Dashboard for live view, Plugin Manager for billing, runtimes for cleanup.
9. Clean up resources before marking the session as destroyed — cleanup_resources fires before destroyed, so consumers of destroyed know cleanup was at least signaled.

## Non-Goals

- **Persistent storage across restarts.** Sessions are in-memory. On restart, all sessions are lost; agents reconnect and create new sessions. The archive TTL is within a single process lifetime.
- **Agent-facing session API.** Agents never call session lifecycle functions directly. Session lifecycle is handled by the Gateway and Session Manager internally.
- **Cross-process or cross-network session management.** v1 runs in-process with the Gateway. Multi-gateway session coordination is a future concern.
- **Resource types or runtime-specific logic.** Session Manager tracks resources by ID and type, but does not understand what a "browser tab" or "temp file" is. Each runtime owns its resource semantics.
- **Chat history or execution logs.** Sessions are execution contexts, not chat history. Logging and history belong to separate components.

## Canonical Product Language

All terms defined in docs/CONTEXT.md. This PRD binds the following glossary entries to concrete behaviour:

- **Session** — execution context, not chat history. Owns runtime resources. Lifecycle: Active/Suspended/Archived.
- **Session Manager** — creates/resumes/suspends/destroys sessions. Tracks runtime resources per session. Part of the Control Plane.
- **Session Suspend** — Active to Suspended transition. Resources preserved, execution paused. Triggered by idle timeout or Gateway policy.
- **Session Resume** — Suspended to Active transition. Resources restored, execution continues. Called by Gateway via session ID.
- **Session Archive** — soft-delete after destroy. Metadata retained for TTL, resources already cleaned up.
- **Resource** — anything owned by a session (browser tab, temp file, auth token, container). Registered against a session ID. Cleaned up when the session is destroyed.

No new glossary terms are introduced by this PRD.

## Product Scope

### Creating a session

When the Gateway receives an inbound request from an adapter (MCP, CLI, REST, WebSocket) that requires a new execution context, it calls Session Manager's internal create() function. Session Manager generates a unique session ID, stores the owner ID and adapter type, sets the initial status to Active, and emits session.created. The Gateway passes the session ID to the downstream capability execution chain so that every subsequent call in that interaction uses the same session.

The Gateway decides when a new session is needed and when an existing session should be reused — Session Manager does not make that decision.

### Session lifecycle and timeout policy

Each session carries an idle timer and a suspended TTL, both configurable via metadata at creation time. Defaults: 5 minutes idle, 30 minutes suspended TTL.

Every capability call that uses a session resets the idle timer (lastActivityAt). If the timer fires, Session Manager transitions the session to Suspended — resources are preserved, but no capability execution is happening. If a new call arrives for a suspended session, the Gateway calls resume() and the session returns to Active.

If a suspended session's TTL expires without a resume, Session Manager transitions the session to Archived: session.cleanup_resources is published, runtimes clean up their resources, then session.destroyed is published. The session metadata record is retained for the configured archive TTL (default 7 days) then purged.

Explicit destroy (from either Active or Suspended) follows the same flow — cleanup signal, then destroyed event, then archive.

### Resource tracking

Runtimes register resources they create on behalf of a session by calling attachResource(sessionId, resourceRecord) directly on Session Manager. The resource record contains a type string, a runtime identifier, and an optional resource-specific ID. Session Manager stores these in a per-session resource list.

On destroy, Session Manager does not clean up resources directly. Instead it publishes session.cleanup_resources on the Event Bus. Each runtime subscribes to this event and cleans up its own resource types. Session Manager then clears its resource tracking records for that session.

### Event surface

Session Manager publishes five lifecycle events:

- session.created — session created. Subscribers: Dashboard live view, audit trail.
- session.suspended — idle timeout fires. Subscribers: Dashboard, resource-aware components.
- session.resumed — Gateway calls resume. Subscribers: Dashboard live view.
- session.destroyed — destroy completes. Subscribers: billing, Dashboard cleanup, audit.
- session.cleanup_resources — destroy begins. Subscribers: runtimes (clean up owned resources).

These events are published after the state transition is complete, so a listener that immediately reads the session record sees the new state. The sole exception is cleanup_resources, which fires before the session is archived but after the status is set — this guarantees runtimes receive the signal even if the archiving fails.

### Resume model

Resume is session ID only — no resume token. The Gateway is the sole caller of resume(). Authentication is handled by the Gateway before it reaches Session Manager. The session ID is an internal identifier never exposed to the agent or external clients.

## User Stories

1. As the **Gateway**, I want to create a session when a new agent request arrives, so that every subsequent capability call from that agent shares an execution context.
2. As the **Gateway**, I want to resume a suspended session by ID, so that the agent does not lose its browser tab, auth state, or temp files when it pauses between requests.
3. As a **Runtime** (Browser, Backend, Docker), I want to register resources against a session, so that the session owns those resources and I can clean them up on destroy.
4. As a **Runtime**, I want to subscribe to session.cleanup_resources, so that I know when to tear down the resources I own for a given session.
5. As the **Dashboard**, I want to subscribe to session.* events, so that the live session view (active, suspended, recently destroyed) stays current without polling.
6. As a **Plugin Manager**, I want to subscribe to session.destroyed for billing, so that I can meter session duration without calling Session Manager on a timer.
7. As a **platform operator**, I want configurable idle timeout and suspended TTL per session, so that long-running agent workflows (human-in-the-loop, batch processing) can set appropriate limits.
8. As a **platform operator**, I want sessions to auto-suspend after idle, so that abandoned agent interactions do not hold runtime resources indefinitely.
9. As a **platform operator**, I want archived session records to be retained for a configurable period, so that I can debug failed sessions and generate billing reports after the session is destroyed.
10. As a **future developer**, I want session cleanup to fire before the destroyed event, so that I can rely on session.destroyed meaning "resources are gone" for auditing.

## Acceptance Criteria

- [ ] Calling create() returns a unique session ID with status set to Active.
- [ ] Calling create() with metadata sets the idle timeout and suspended TTL from the metadata, falling back to defaults when absent.
- [ ] A session with no activity for its idle timeout duration transitions to Suspended automatically.
- [ ] Any capability call using a session resets its idle timer (lastActivityAt is updated).
- [ ] Calling resume() with an existing suspended session ID transitions it to Active and emits session.resumed.
- [ ] Calling resume() with a non-existent or archived session ID returns an error.
- [ ] A suspended session whose TTL expires transitions to Archived: session.cleanup_resources fires, then session.destroyed fires, then the metadata record is retained.
- [ ] Calling destroy() from Active state transitions the session to Archived with the same cleanup flow.
- [ ] Calling destroy() from Suspended state transitions the session to Archived with the same cleanup flow.
- [ ] Calling destroy() on an already-archived session is a no-op (no error, no duplicate events).
- [ ] attachResource(sessionId, resource) adds the resource to the session's resource list.
- [ ] attachResource to a non-existent or archived session returns an error.
- [ ] On destroy, session.cleanup_resources is published before session.destroyed.
- [ ] On destroy, the resource tracking list is cleared after cleanup_resources is published.
- [ ] Events are not published for a failed operation (invalid session ID, no-op on archived).
- [ ] The archive TTL (default 7 days) is configurable, after which the metadata record is purged.
- [ ] Session ID is the only credential needed for resume() — no token validation.

## Rollout and Risk

- **Migration risk**: none at the Session Manager layer — no consumer depends on session management today. The Event Bus and Capability Registry packs are already shipped. Future consumers (Gateway, Dashboard) will use the documented event surface.
- **Compatibility risk**: low. Session Manager publishes events but no other component subscribes to them yet. Adding subscribers later is additive.
- **Rollout strategy**: ship as a single npm workspace package @platform/session-manager inside agentide/packages/, with @platform/event-bus as a workspace dependency. Land it behind no flag — it has no behaviour until something calls create or subscribes to its events.
- **Drift watch**: the Gateway is the sole caller of create/resume/destroy. If the Gateway's session lifecycle design changes (e.g., Gateway decides to manage sessions differently), update this PRD before locking the TRD.
- **Suspend/resume complexity**: suspend/resume is the riskiest feature in this pack. If implementation reveals that resource preservation across suspend is impractical for most runtime types, the state machine can be simplified to Active -> Archived (removing suspend/resume) without changing the rest of the API surface.

## Out of Scope

| Item | Reason deferred |
|---|---|
| Persistent storage of session records across restarts | v1 is in-memory. Adding persistence is a separate decision about the storage backend. |
| Agent-facing session.create / resume / destroy capabilities | The agent never manages sessions directly. Gateway middleware owns session lifecycle. If a future pack (platform-capabilities) needs agent-facing session capabilities, it wraps Session Manager's read surface. |
| Resume token / auth on resume | Gateway is the sole caller and already authenticated the request. A token would add complexity with no threat to mitigate in v1. |
| Cross-process session coordination | The Gateway and Session Manager are in-process in v1. Multi-gatepoint session sharing is a future concern. |
| Resource-type awareness | Session Manager tracks resources by opaque ID. Each runtime knows its own resource semantics. |
| Chat history or execution logs | Sessions are execution contexts. Logging and execution history are separate features owned by other components. |
| Tenant-isolated session views | Multi-tenant filtering of the session list depends on the Tenant design still flagged as open in CONTEXT.md. |

## Further Notes

### Resolved design decisions (from grilling)

- **State machine**: Active / Suspended / Archived (soft-delete). Options were binary, with-expiry, and suspend/resume. Chosen: suspend/resume (Option C).
- **Suspend/destroy policy**: Gateway (adapter disconnect) + Session Manager (idle timer/TTL). Combined, no conflict.
- **Resume model**: session ID only. Gateway is the sole caller; auth already handled.
- **Timeout defaults**: 5 min idle, 30 min suspended TTL. Both configurable per-session via metadata.
- **Resource tracking**: direct registration (attachResource), cleanup triggered via Event Bus (session.cleanup_resources).
- **Event surface**: created, suspended, resumed, destroyed, cleanup_resources.
- **Cleanup ordering**: cleanup_resources before destroyed.

### Related documents

- Grill notes: GRILL-session-manager.txt
- Glossary: ../../CONTEXT.md
- Event bus contract: ../event-bus/PRD-event-bus.md
- Capability registry: ../capability-registry/PRD-capability-registry.md
- Session Manager in architecture: ../../architecture/Agentide.md (Section 5 and Section 11)
- Terminology: ../../architecture/Terminology.md (Session, Session Manager, Resource)
