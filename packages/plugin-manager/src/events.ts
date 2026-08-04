/*
 * Code Map: plugin-manager event publisher
 * - EventPublisher: maps install/update/reload/uninstall/enable/disable/cleanup to Event Bus payloads
 *   - installed:   plugin.installed
 *   - updated:     plugin.updated
 *   - reloaded:    plugin.reloaded
 *   - uninstalled: plugin.uninstalled
 *   - enabled:     plugin.enabled
 *   - disabled:    plugin.disabled
 *   - cleanup:     plugin.cleanup
 *
 * BI[8a] gateway-plugin-dispatch: adds handlerLoadFailed and handlerInvokeFailed
 *   for surfacing handler-loading/invocation errors to subscribers. Both are
 *   fire-and-forget — the synchronous code path doesn't await them.
 *
 * CID Index:
 * CID:events-001 -> EventPublisher
 * CID:events-002 -> EventPublisher.installed
 * CID:events-003 -> EventPublisher.updated
 * CID:events-004 -> EventPublisher.reloaded
 * CID:events-005 -> EventPublisher.uninstalled
 * CID:events-006 -> EventPublisher.enabled
 * CID:events-007 -> EventPublisher.disabled
 * CID:events-008 -> EventPublisher.cleanup
 * CID:events-009 -> EventPublisher.handlerLoadFailed
 * CID:events-010 -> EventPublisher.handlerInvokeFailed
 *
 * Quick lookup: rg -n "CID:events-" packages/plugin-manager/src/events.ts
 */

import type { EventBus } from "@spanexx/event-bus";
import type {
  InstallRecord,
  PluginCleanupPayload,
  PluginDisabledPayload,
  PluginEnabledPayload,
  PluginHandlerErrorPayload,
  PluginHandlerLoadedPayload,
  PluginInstalledPayload,
  PluginReloadedPayload,
  PluginUninstalledPayload,
  PluginUpdatedPayload,
} from "./types.js";

// CID:events-001 - EventPublisher
// Purpose: maps install/update/reload/uninstall/enable/disable/cleanup to Event Bus payloads (fire-and-forget)
// Uses: EventBus, payload interfaces from types.ts
// Used by: createPluginManager (state transition call sites)
export class EventPublisher {
  constructor(private readonly eventBus: EventBus) {}

  // CID:events-002 - installed
  installed(record: InstallRecord): void {
    const payload: PluginInstalledPayload = {
      id: record.id,
      type: record.type,
      version: record.version,
      source: record.source,
      installedAt: record.installedAt,
    };
    void this.eventBus.publish<PluginInstalledPayload>("plugin.installed", payload);
  }

  // CID:events-003 - updated
  updated(id: string, oldVersion: string, newVersion: string, source: string, updatedAt: number): void {
    const payload: PluginUpdatedPayload = { id, oldVersion, newVersion, source, updatedAt };
    void this.eventBus.publish<PluginUpdatedPayload>("plugin.updated", payload);
  }

  // CID:events-004 - reloaded
  reloaded(id: string, version: string, reloadedAt: number): void {
    const payload: PluginReloadedPayload = { id, version, reloadedAt };
    void this.eventBus.publish<PluginReloadedPayload>("plugin.reloaded", payload);
  }

  // CID:events-005 - uninstalled
  uninstalled(id: string, uninstalledAt: number): void {
    const payload: PluginUninstalledPayload = { id, uninstalledAt };
    void this.eventBus.publish<PluginUninstalledPayload>("plugin.uninstalled", payload);
  }

  // CID:events-006 - enabled
  enabled(id: string, enabledAt: number): void {
    const payload: PluginEnabledPayload = { id, enabledAt };
    void this.eventBus.publish<PluginEnabledPayload>("plugin.enabled", payload);
  }

  // CID:events-007 - disabled
  disabled(id: string, disabledAt: number): void {
    const payload: PluginDisabledPayload = { id, disabledAt };
    void this.eventBus.publish<PluginDisabledPayload>("plugin.disabled", payload);
  }

  // CID:events-008 - cleanup
  cleanup(id: string): void {
    const payload: PluginCleanupPayload = { id };
    void this.eventBus.publish<PluginCleanupPayload>("plugin.cleanup", payload);
  }

  // CID:events-009 - handlerLoadFailed
  // Purpose: fire-and-forget notification when a plugin's entry module fails
  //   to load (HANDLER_LOAD_FAILED). The install record's `lastError` is the
  //   primary signal; this event is for subscribers (dashboards, alerts) that
  //   need to react without polling the store.
  handlerLoadFailed(record: InstallRecord | null, err: Error): void {
    if (record === null) return;
    const payload: PluginHandlerLoadedPayload = {
      id: record.id,
      version: record.version,
      loadedAt: Date.now(),
      ok: false,
      error: err.message,
    };
    void this.eventBus.publish<PluginHandlerLoadedPayload>("plugin.handler.loaded", payload);
  }

  // CID:events-010 - handlerInvokeFailed
  // Purpose: fire-and-forget notification when a plugin's handler throws
  //   during invocation (HANDLER_ERROR). The caller already gets the
  //   structured PluginManagerError; this event is for ops tooling that
  //   wants to track which plugin handlers are flaky.
  handlerInvokeFailed(record: InstallRecord | null, capability: string, err: Error): void {
    if (record === null) return;
    const payload: PluginHandlerErrorPayload = {
      id: record.id,
      capability,
      at: Date.now(),
      error: err.message,
    };
    void this.eventBus.publish<PluginHandlerErrorPayload>("plugin.handler.error", payload);
  }
}