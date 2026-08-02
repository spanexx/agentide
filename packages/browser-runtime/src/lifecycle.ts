/*
 * Code Map: session lifecycle wiring — ONE event-bus listener (T5).
 *
 * D-42 (real event names, session-manager EventPublisher):
 *   session.suspended / session.resumed  -> no-op (browser stays alive,
 *                                            DOM intact)
 *   session.destroyed                    -> close context (teardown)
 *   session.cleanup_resources            -> purge screenshot resource files
 *   session.created                      -> no-op (session is lazy)
 *
 * The bus is injected (structural `{ subscribe }` — the shipped EventBus
 * conforms) so browser-runtime has no compile-time coupling to
 * session-manager/event-bus packages.
 *
 * Zombie exit handler: SIGINT/SIGTERM while a browser is launched ->
 * close the context, then exit (no orphan chromium).
 *
 * CID Index:
 * CID:lifecycle-001 -> attachLifecycle
 *
 * Quick lookup: rg -n "CID:lifecycle-" packages/browser-runtime/src/lifecycle.ts
 */

import type { Session } from "./session.js";
import { readdir, rm } from "node:fs/promises";

/** Minimal structural subset of @platform/event-bus subscribe. */
export interface LifecycleBus {
  subscribe(event: string, handler: (payload?: object) => void): { unsubscribe(): void };
}

// CID:lifecycle-001 - attachLifecycle
// Purpose: subscribe one listener to the session lifecycle events and
//   register the zombie exit handler. Returns dispose() to detach.
// Uses: Session (driver), node:fs/promises
// Used by: index.ts (createBrowserRuntime wiring)
export function attachLifecycle(
  session: Session,
  bus: LifecycleBus,
): { dispose(): void } {
  const subs = [
    bus.subscribe("session.created", () => {
      /* no-op: session is lazy — browser launches on first cap (T5) */
    }),
    bus.subscribe("session.suspended", () => {
      /* no-op: keep alive, DOM intact (T5) */
    }),
    bus.subscribe("session.resumed", () => {
      /* no-op: nothing to restore (T5) */
    }),
    bus.subscribe("session.destroyed", () => {
      void session.driver.close(); // context teardown (never kills shared process)
    }),
    bus.subscribe("session.cleanup_resources", () => {
      void purgeResources(session);
    }),
  ];

  const onSignal = (): void => {
    void session.driver.close();
    process.exit(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  return {
    dispose() {
      for (const sub of subs) sub.unsubscribe();
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    },
  };
}

async function purgeResources(session: Session): Promise<void> {
  const dir = session.state.resourceDir;
  try {
    const entries = await readdir(dir);
    const shots = entries.filter((name: string) => name.startsWith("shot-"));
    await Promise.all(
      shots.map((name: string) => rm(`${dir}/${name}`, { force: true })),
    );
  } catch {
    // resource dir absent or unreadable — nothing to purge
  }
}
