/*
 * Code Map: session resource tracking
 * - ResourceTracker: per-session opaque resource registry
 *   - attach:  register a resource against an active or suspended session
 *   - detach:  remove a resource registration (idempotent on missing id)
 *   - list:    return a copy of the resource list
 *   - clear:   drop the resource list for a session (called on destroy)
 *
 * CID Index:
 * CID:resources-001 -> ResourceTracker
 * CID:resources-002 -> ResourceTracker.attach
 * CID:resources-003 -> ResourceTracker.detach
 * CID:resources-004 -> ResourceTracker.list
 * CID:resources-005 -> ResourceTracker.clear
 *
 * Quick lookup: rg -n "CID:resources-" packages/session-manager/src/resources.ts
 */

import {
  DuplicateResourceError,
  SessionNotActiveError,
  SessionNotFoundError,
  type ResourceRecord,
} from "./types.js";

// CID:resources-001 - ResourceTracker
// Purpose: per-session opaque resource registry; session existence is checked by the caller
// Uses: ResourceRecord, SessionNotActiveError, DuplicateResourceError, SessionNotFoundError
// Used by: createSessionManager public attach/detach/list and the destroy cleanup path
export class ResourceTracker {
  private readonly resources = new Map<string, ResourceRecord[]>();

  // CID:resources-002 - attach
  attach(sessionId: string, resource: ResourceRecord, status: string | undefined): void {
    if (!status || status === "archived") throw new SessionNotActiveError(sessionId);
    const current = this.resources.get(sessionId) ?? [];
    if (current.some((item) => item.id === resource.id)) throw new DuplicateResourceError(resource.id);
    current.push({ ...resource });
    this.resources.set(sessionId, current);
  }

  // CID:resources-003 - detach
  detach(sessionId: string, resourceId: string): void {
    const current = this.resources.get(sessionId);
    if (!current) return;
    this.resources.set(sessionId, current.filter((resource) => resource.id !== resourceId));
  }

  // CID:resources-004 - list
  list(sessionId: string, exists: boolean): ResourceRecord[] {
    if (!exists) throw new SessionNotFoundError(sessionId);
    return [...(this.resources.get(sessionId) ?? [])];
  }

  // CID:resources-005 - clear
  clear(sessionId: string): void {
    this.resources.delete(sessionId);
  }
}
