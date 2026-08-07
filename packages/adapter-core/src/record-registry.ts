/*
 * Code Map: adapter-core generic RecordRegistry (A1)
 * - RecordRegistry<T>: pure in-memory record store over a caller-supplied
 *   record shape. The WS door's ConnectionRegistry becomes a thin wrapper
 *   that keeps the ConnectionRecord shape + `ws-<n>` id generation local.
 * - add is a template hook: the door supplies the record factory (it owns
 *   transport-visible fields); the registry owns only the id counter + map.
 *
 * CID Index:
 * CID:adapter-core-004 -> RecordRegistry + RecordRegistryOptions
 */

export interface RecordRegistryOptions<T, E = never> {
  /** Factory producing a record for the given id (door owns the shape). */
  readonly create: (id: string, extra: E) => T;
  /** Id prefix, e.g. "ws" for ws-1, ws-2, ... (door-owned naming). */
  readonly prefix: string;
  /** Optional id generator override; defaults to `${prefix}-<n>`. */
  readonly generateId?: (n: number, prefix: string) => string;
}

// CID:adapter-core-004 - RecordRegistry
// Purpose: shared bookkeeping primitives (A1). add/get/remove/snapshot/clear/
//   count with auto-incrementing ids. Door supplies the record factory so the
//   registry stays generic and the door keeps its byte-level record shape.
// E = extra payload the door passes per add() (e.g. {socket, origin}); the
// default is `never` so records that don't need extra data keep a no-arg API.
export class RecordRegistry<T, E = never> {
  private readonly records = new Map<string, T>();
  private nextId = 1;

  constructor(private readonly options: RecordRegistryOptions<T, E>) {}

  add(extra?: E): T {
    const id = (this.options.generateId ?? defaultId)(this.nextId, this.options.prefix);
    this.nextId += 1;
    const record = this.options.create(id, extra as E);
    this.records.set(id, record);
    return record;
  }

  get(id: string): T | undefined {
    return this.records.get(id);
  }

  remove(id: string): T | undefined {
    const record = this.records.get(id);
    this.records.delete(id);
    return record;
  }

  snapshot(): T[] {
    return [...this.records.values()];
  }

  clear(): T[] {
    const records = this.snapshot();
    this.records.clear();
    return records;
  }

  count(): number {
    return this.records.size;
  }
}

function defaultId(n: number, prefix: string): string {
  return `${prefix}-${n}`;
}
