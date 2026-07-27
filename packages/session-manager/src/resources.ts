/*
 * Code Map: session resource tracking
 * - ResourceTracker: owns per-session opaque resource registrations
 *
 * CID Index:
 * CID:resources-001 -> ResourceTracker
 *
 * Quick lookup: rg -n "CID:resources-" packages/session-manager/src/resources.ts
 */

import {
  DuplicateResourceError,
  SessionNotActiveError,
  SessionNotFoundError,
  type ResourceRecord,
} from "./types.js";

export class ResourceTracker {
  // CID:resources-001 - ResourceTracker
  // Purpose: per-session opaque resource registry. `attach` enforces that
  //   the session is not archived; `detach` is idempotent on missing
  //   resources but throws if the session itself is unknown. `list` returns
  //   a copy so callers cannot mutate internal state.
  // discovery/issues: `attach` accepts a non-active status string (rather
  //   than asserting) so the factory can pass `undefined` for missing
  //   sessions without an extra lookup.
  // Uses: ResourceRecord, SessionNotActiveError, DuplicateResourceError,
  //   SessionNotFoundError.
  // Used by: createSessionManager public attach/detach/list and the
  //   destroy cleanup path.
  private readonly resources = new Map<string, ResourceRecord[]>();

  attach(sessionId: string, resource: ResourceRecord, status: string | undefined): void {
    if (!status || status === "archived") throw new SessionNotActiveError(sessionId);
    const current = this.resources.get(sessionId) ?? [];
    if (current.some((item) => item.id === resource.id)) throw new DuplicateResourceError(resource.id);
    current.push({ ...resource });
    this.resources.set(sessionId, current);
  }

  detach(sessionId: string, resourceId: string): void {
    const current = this.resources.get(sessionId);
    if (!current) return;
    this.resources.set(sessionId, current.filter((resource) => resource.id !== resourceId));
  }

  list(sessionId: string, exists: boolean): ResourceRecord[] {
    if (!exists) throw new SessionNotFoundError(sessionId);
    return [...(this.resources.get(sessionId) ?? [])];
  }

  clear(sessionId: string): void {
    this.resources.delete(sessionId);
  }
}
