import {
  DuplicateResourceError,
  SessionNotActiveError,
  SessionNotFoundError,
  type ResourceRecord,
} from "./types.js";

/*
 * Code Map: session resource tracking
 * - ResourceTracker: owns per-session opaque resource registrations
 * CID Index: resources-001 ResourceTracker
 */

export class ResourceTracker {
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
    if (!current) throw new SessionNotFoundError(sessionId);
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
