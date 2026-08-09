/*
 * Code Map: browser-runtime unit tests (real chromium, headless).
 *
 * Coverage per IMPL-browser-runtime.md Phase 3-7 Verify lists:
 * - launch/tab lifecycle (F1: tab 0 at launch, ascending ids, ALREADY_LAUNCHED)
 * - navigate (F2, F7 NAVIGATION_DESTRUCTIVE, T2 timeout/hard-fail codes)
 * - DOM-read settle (F11: stability re-read -> settled; timeout -> unsettled)
 * - capability.list per tab (Q5: runtime never touches capability-registry)
 * - query/click F8: 1-based instance, AMBIGUOUS, NOT_FOUND, addresses
 * - wait T6: selector timeout + time mode
 * - screenshot T3: inline <= 256 KiB, resource mode, SCREENSHOT_TOO_LARGE
 * - crash Q4: kill() -> CRASHED retryable, relaunch resets tab counter
 * - lifecycle D-42: session.destroyed closes, cleanup_resources purges,
 *   suspended/resumed no-ops, dispose() unsubscribes
 *
 * Fixtures are served over real HTTP (playwright's selector engine does
 * not poll reliably on data: URLs). BrowserError codes are asserted via
 * err.code (BROWSER_* table, errors.ts) / err.retryable.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium } from "playwright-core";
import { createServer, type Server } from "node:http";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrowserRuntime, createSession, attachLifecycle, type BrowserRuntime, type LifecycleBus } from "../index.js";
import type { Session } from "../session.js";
import type { BrowserDriver, JsonValue } from "../index.js";
import type { CapabilitySnapshot } from "../types.js";

// ---------------------------------------------------------------------------
// binary-availability gate (skip, don't fail)
// Every test below launches a REAL headless chromium via playwright-core. When
// the browser binary isn't installed, the suite would fail at launch with
// "Executable doesn't exist at ..." — 27 red tests that say nothing about the
// code. Instead: detect the binary once, SKIP the whole suite, and surface one
// explicitly-named skipped test carrying the install command.
// Fix to re-run: pnpm exec playwright install chromium
// ---------------------------------------------------------------------------
const CHROMIUM_BINARY = chromium.executablePath();
const BROWSER_RUNNABLE = existsSync(CHROMIUM_BINARY);

if (!BROWSER_RUNNABLE) {
  it.skip(
    `browser-runtime suite SKIPPED: chromium binary not found at ${CHROMIUM_BINARY} — install with: pnpm exec playwright install chromium`,
    () => {},
  );
}
const describeRun = BROWSER_RUNNABLE ? describe : describe.skip;

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function pageWithCaps(names: string[]): string {
  const els = names
    .map((n, i) => `<div data-sdk-cap="${n}" id="cap-${i}">c</div>`)
    .join("");
  return `<html><body>${els}</body></html>`;
}

const CART_PAGE = `<html><body>
<button class="add-cart" data-pid="200" onclick="this.remove()">add 200</button>
<button class="add-cart" data-pid="202" onclick="this.remove()">add 202</button>
<button class="add-cart" data-pid="204" onclick="this.remove()">add 204</button>
</body></html>`;

// per-pixel random noise -> PNG far above the 256 KiB inline cap
const NOISE_CANVAS = `<html><body><canvas id="c" width="2000" height="2000"></canvas>
<script>
const c = document.getElementById("c");
const x = c.getContext("2d");
const img = x.createImageData(2000, 2000);
for (let i = 0; i < img.data.length; i += 4) {
  img.data[i] = Math.floor(Math.random() * 256);
  img.data[i + 1] = Math.floor(Math.random() * 256);
  img.data[i + 2] = Math.floor(Math.random() * 256);
  img.data[i + 3] = 255;
}
x.putImageData(img, 0, 0);
</script></body></html>`;

// NOTE: the div must have content — an empty div is 0-height and
// Playwright's default waitForSelector state is "visible", so it
// would never match.
const LATER_PAGE = `<html><body><script>
setTimeout(() => {
  const d = document.createElement("div");
  d.id = "later";
  d.textContent = "x";
  document.body.appendChild(d);
}, 300);
</script></body></html>`;

// starts with 1 cap synchronously, then grows every 100ms (never stable)
const MUTATE_PAGE = `<html><body><script>
document.body.innerHTML = '<div data-sdk-cap="browser.click"></div>';
let n = 0;
const iv = setInterval(() => {
  const e = document.createElement("div");
  e.setAttribute("data-sdk-cap", "browser.click");
  document.body.appendChild(e);
  if (++n > 80) clearInterval(iv);
}, 100);
</script></body></html>`;

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const routes: Record<string, string> = {
    "/caps": pageWithCaps(["browser.click", "browser.query"]),
    "/caps3": pageWithCaps(["browser.click", "browser.click", "browser.query"]),
    "/cart": CART_PAGE,
    "/noise": NOISE_CANVAS,
    "/later": LATER_PAGE,
    "/mutate": MUTATE_PAGE,
    "/empty": "<html><body></body></html>",
  };
  server = createServer((req, res) => {
    const body = routes[req.url ?? ""];
    if (body === undefined) {
      res.writeHead(404).end("nope");
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (addr === null || typeof addr === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${addr.port}`;
  rt = createBrowserRuntime({ resourceBase });
});

afterAll(async () => {
  for (const s of openSessions) {
    if (s.state.launched && !s.state.dead) {
      await s.driver.close();
    }
  }
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e === undefined ? resolve() : reject(e))),
  );
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const resourceBase = mkdtempSync(join(tmpdir(), "brt-tests-"));
let rt: BrowserRuntime;
const openSessions: Session[] = [];

function sess(tag: string): Session {
  const s = rt.sessions.getOrCreate(`t-${tag}`);
  if (!openSessions.includes(s)) openSessions.push(s);
  return s;
}

function inv(cap: string, input: JsonValue = {}, sessionId = "t-inv"): Promise<JsonValue> {
  const h = rt.handlers[cap];
  if (h === undefined) throw new Error(`no handler for ${cap}`);
  return h(input, { pluginId: "test", sessionId });
}

async function errOf(p: Promise<JsonValue>): Promise<{ code: string; retryable: boolean }> {
  try {
    await p;
    return { code: "NO_ERROR", retryable: false };
  } catch (e) {
    return {
      code: (e as { code?: string }).code ?? "NO_CODE",
      retryable: (e as { retryable?: boolean }).retryable ?? false,
    };
  }
}

function kill(s: Session): Promise<void> {
  return (s.driver as BrowserDriver & { kill(): Promise<void> }).kill();
}

async function waitFor(fn: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ---------------------------------------------------------------------------
// launch + tab lifecycle (F1/F2/F3)
// ---------------------------------------------------------------------------

describeRun("launch + tab lifecycle", () => {
  it("launch creates tab 0; second launch -> ALREADY_LAUNCHED", async () => {
    const r = await inv("browser.launch", { mode: "headless" }, "t-launch");
    expect(r).toEqual({ launched: true, mode: "headless" });
    const s = sess("launch");
    expect(s.state.launched).toBe(true);
    expect(s.state.activeTabId).toBe(0); // F1: tab 0 exists at launch

    const err = await errOf(inv("browser.launch", {}, "t-launch"));
    expect(err.code).toBe("BROWSER_ALREADY_LAUNCHED");
    expect(err.retryable).toBe(false);
  });

  it("openTab returns ascending ids (F1 counter), never reused", async () => {
    const s = sess("ids");
    await inv("browser.launch", {}, "t-ids");
    const a = await inv("browser.tab.open", {}, "t-ids");
    const b = await inv("browser.tab.open", {}, "t-ids");
    expect(a).toEqual({ tabId: 1 });
    expect(b).toEqual({ tabId: 2 });
    expect(s.state.nextTabId).toBe(3);
  });

  it("switchTab updates active; missing tab -> TAB_NOT_FOUND", async () => {
    await inv("browser.launch", {}, "t-switch");
    await inv("browser.tab.open", {}, "t-switch");
    const r = await inv("browser.tab.switch", { tabId: 1 }, "t-switch");
    expect(r).toEqual({ tabId: 1 });
    const s = sess("switch");
    expect(s.state.activeTabId).toBe(1);

    const err = await errOf(inv("browser.tab.switch", { tabId: 99 }, "t-switch"));
    expect(err.code).toBe("BROWSER_TAB_NOT_FOUND");
  });

  it("tab-only close keeps context alive; active falls back to lowest id", async () => {
    await inv("browser.launch", {}, "t-close");
    await inv("browser.tab.open", {}, "t-close");
    const s = sess("close");
    expect(s.state.activeTabId).toBe(1);
    const r = await inv("browser.tab.close", { tabId: 1 }, "t-close");
    expect(r).toEqual({ closed: true });
    expect(s.state.activeTabId).toBe(0); // min remaining
    const nav = (await inv("browser.navigate", { url: `${baseUrl}/caps` }, "t-close")) as {
      tabId: number;
      url: string;
    };
    expect(nav.tabId).toBe(0);
  });

  it("close is idempotent; relaunch after graceful close works", async () => {
    await inv("browser.launch", {}, "t-close2");
    await inv("browser.close", {}, "t-close2");
    const err = await errOf(inv("browser.close", {}, "t-close2"));
    expect(err.code).toBe("NO_ERROR"); // idempotent no-op
    const r = await inv("browser.launch", {}, "t-close2");
    expect(r).toEqual({ launched: true, mode: "headless" });
    const nav = (await inv("browser.navigate", { url: `${baseUrl}/caps` }, "t-close2")) as {
      capabilities: CapabilitySnapshot[];
    };
    expect(nav.capabilities).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// navigate (F2/F7/T2)
// ---------------------------------------------------------------------------

describeRun("navigate", () => {
  it("returns url + settled caps snapshot", async () => {
    await inv("browser.launch", {}, "t-nav1");
    const r = (await inv("browser.navigate", { url: `${baseUrl}/caps` }, "t-nav1")) as {
      tabId: number;
      url: string;
      capabilities: CapabilitySnapshot[];
      capsSettled: boolean;
    };
    expect(r.tabId).toBe(0);
    expect(r.url).toContain("/caps");
    expect(r.capabilities.map((c) => c.name).sort()).toEqual(["browser.click", "browser.query"]);
    expect(r.capabilities[0]?.tier).toBeDefined();
    expect(r.capabilities[0]?.registered).toBe(true);
    expect(r.capsSettled).toBe(true);
  });

  it("F7: different-url navigate on a tab with caps -> NAVIGATION_DESTRUCTIVE", async () => {
    await inv("browser.launch", {}, "t-f7");
    await inv("browser.navigate", { url: `${baseUrl}/caps` }, "t-f7");
    const err = await errOf(inv("browser.navigate", { url: `${baseUrl}/cart` }, "t-f7"));
    expect(err.code).toBe("BROWSER_NAVIGATION_DESTRUCTIVE");
    expect(err.retryable).toBe(false);
    // same-url re-navigate passes
    const r = (await inv("browser.navigate", { url: `${baseUrl}/caps` }, "t-f7")) as {
      capsSettled: boolean;
    };
    expect(r.capsSettled).toBe(true);
    // newTab:true bypasses the guard (cart page has no data-sdk-cap)
    const fresh = (await inv(
      "browser.navigate",
      { url: `${baseUrl}/cart`, newTab: true },
      "t-f7",
    )) as { tabId: number; capabilities: CapabilitySnapshot[]; capsSettled: boolean };
    expect(fresh.tabId).toBe(1);
    expect(fresh.capabilities).toEqual([]);
    expect(fresh.capsSettled).toBe(true);
  });

  it("T2: unreachable target -> NAVIGATION_FAILED (not retryable)", async () => {
    await inv("browser.launch", {}, "t-nav2");
    const err = await errOf(
      inv("browser.navigate", { url: "http://127.0.0.1:1/nope", timeoutMs: 4000 }, "t-nav2"),
    );
    expect(["BROWSER_NAVIGATION_FAILED", "BROWSER_NAVIGATION_TIMEOUT"]).toContain(err.code);
    expect(err.retryable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DOM-read settle (F11)
// ---------------------------------------------------------------------------

describeRun("DOM-read settle (F11)", () => {
  it("static page settles true (two identical reads)", async () => {
    await inv("browser.launch", {}, "t-settle1");
    const r = (await inv("browser.navigate", { url: `${baseUrl}/caps3` }, "t-settle1")) as {
      capabilities: CapabilitySnapshot[];
      capsSettled: boolean;
    };
    expect(r.capsSettled).toBe(true);
    expect(r.capabilities.find((c) => c.name === "browser.click")?.count).toBe(2);
  });

  it("continuously mutating page settles false after cap (2s)", async () => {
    await inv("browser.launch", {}, "t-settle2");
    const r = (await inv("browser.navigate", { url: `${baseUrl}/mutate` }, "t-settle2")) as {
      capabilities: CapabilitySnapshot[];
      capsSettled: boolean;
    };
    expect(r.capsSettled).toBe(false);
    expect(r.capabilities[0]?.count).toBeGreaterThan(0);
  }, 15000);
});

// ---------------------------------------------------------------------------
// capability.list (Q5/F9)
// ---------------------------------------------------------------------------

describeRun("capability.list", () => {
  it("returns per-tab snapshots; registry untouched", async () => {
    await inv("browser.launch", {}, "t-caps");
    await inv("browser.navigate", { url: `${baseUrl}/caps` }, "t-caps");
    await inv("browser.tab.open", {}, "t-caps"); // blank tab 1 (now active)

    const tab0 = (await inv("capability.list", { tabId: 0 }, "t-caps")) as {
      capabilities: CapabilitySnapshot[];
      capsSettled: boolean;
    };
    expect(tab0.capabilities.map((c) => c.name).sort()).toEqual(["browser.click", "browser.query"]);
    expect(tab0.capsSettled).toBe(true);

    const tab1 = (await inv("capability.list", { tabId: 1 }, "t-caps")) as {
      capabilities: CapabilitySnapshot[];
      capsSettled: boolean;
    };
    expect(tab1.capabilities).toHaveLength(0);
    expect(tab1.capsSettled).toBe(true); // empty page settles immediately
  });
});

// ---------------------------------------------------------------------------
// query + click (F8: 1-based instance, addresses)
// ---------------------------------------------------------------------------

describeRun("query + click (F8)", () => {
  it("query returns reusable addresses with data-* attrs", async () => {
    await inv("browser.launch", {}, "t-q");
    await inv("browser.navigate", { url: `${baseUrl}/cart` }, "t-q");
    const r = (await inv("browser.query", { selector: ".add-cart" }, "t-q")) as {
      matches: number;
      addresses: string[];
    };
    expect(r.matches).toBe(3);
    expect(r.addresses).toHaveLength(3);
    expect(r.addresses[0]).toBe('button[data-pid="200"]');
    expect(r.addresses[1]).toBe('button[data-pid="202"]');
    expect(r.addresses[2]).toBe('button[data-pid="204"]');
    // address is reusable verbatim as a selector
    const again = (await inv("browser.query", { selector: r.addresses[1] ?? "" }, "t-q")) as {
      matches: number;
      addresses: string[];
    };
    expect(again.matches).toBe(1);
    expect(again.addresses[0]).toBe('button[data-pid="202"]');
  });

  it("0-match query returns empty, no error", async () => {
    await inv("browser.launch", {}, "t-q0");
    await inv("browser.navigate", { url: `${baseUrl}/cart` }, "t-q0");
    const r = (await inv("browser.query", { selector: ".nope" }, "t-q0")) as {
      matches: number;
      addresses: string[];
    };
    expect(r.matches).toBe(0);
    expect(r.addresses).toEqual([]);
  });

  it("click without instance on multiple matches -> AMBIGUOUS", async () => {
    await inv("browser.launch", {}, "t-amb");
    await inv("browser.navigate", { url: `${baseUrl}/cart` }, "t-amb");
    const err = await errOf(inv("browser.click", { selector: ".add-cart" }, "t-amb"));
    expect(err.code).toBe("BROWSER_SELECTOR_AMBIGUOUS");
    expect(err.retryable).toBe(false);
  });

  it("click instance:2 hits the 2nd element (removes it from DOM)", async () => {
    await inv("browser.launch", {}, "t-inst");
    await inv("browser.navigate", { url: `${baseUrl}/cart` }, "t-inst");
    const r = await inv("browser.click", { selector: ".add-cart", instance: 2 }, "t-inst");
    expect(r).toEqual({ clicked: true });
    const after = (await inv("browser.query", { selector: ".add-cart" }, "t-inst")) as {
      matches: number;
    };
    expect(after.matches).toBe(2); // 2nd of 3 removed
  });

  it("click instance out of range -> SELECTOR_NOT_FOUND (retryable)", async () => {
    await inv("browser.launch", {}, "t-oob");
    await inv("browser.navigate", { url: `${baseUrl}/cart` }, "t-oob");
    const err = await errOf(inv("browser.click", { selector: ".add-cart", instance: 9 }, "t-oob"));
    expect(err.code).toBe("BROWSER_SELECTOR_NOT_FOUND");
    expect(err.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// wait (T6)
// ---------------------------------------------------------------------------

describeRun("wait (T6)", () => {
  it("selector mode: appears in time -> waited", async () => {
    await inv("browser.launch", {}, "t-w1");
    await inv("browser.navigate", { url: `${baseUrl}/later` }, "t-w1");
    const r = await inv("browser.wait", { wait: "selector", selector: "#later", timeoutMs: 3000 }, "t-w1");
    expect(r).toEqual({ waited: true });
  });

  it("selector never appears -> WAIT_TIMEOUT (retryable)", async () => {
    await inv("browser.launch", {}, "t-w2");
    await inv("browser.navigate", { url: `${baseUrl}/empty` }, "t-w2");
    const err = await errOf(
      inv("browser.wait", { wait: "selector", selector: "#never", timeoutMs: 500 }, "t-w2"),
    );
    expect(err.code).toBe("BROWSER_WAIT_TIMEOUT");
    expect(err.retryable).toBe(true);
  });

  it("time mode sleeps ms -> waited", async () => {
    await inv("browser.launch", {}, "t-w3");
    const start = Date.now();
    const r = await inv("browser.wait", { wait: "time", ms: 300 }, "t-w3");
    expect(r).toEqual({ waited: true });
    expect(Date.now() - start).toBeGreaterThanOrEqual(280);
  });
});

// ---------------------------------------------------------------------------
// screenshot (T3)
// ---------------------------------------------------------------------------

describeRun("screenshot (T3)", () => {
  it("small page -> inline base64 under 256 KiB", async () => {
    await inv("browser.launch", {}, "t-shot1");
    await inv("browser.navigate", { url: `${baseUrl}/caps` }, "t-shot1");
    const r = (await inv("browser.screenshot", {}, "t-shot1")) as {
      mode: string;
      bytes: number;
      data?: string;
      format: string;
    };
    expect(r.mode).toBe("inline");
    expect(r.format).toBe("png");
    expect(r.bytes).toBeLessThanOrEqual(256 * 1024);
    expect(r.data).toBeDefined();
    expect(r.data?.length).toBeGreaterThan(100);
  });

  it("mode:resource writes file to resourceDir", async () => {
    await inv("browser.launch", {}, "t-shot2");
    await inv("browser.navigate", { url: `${baseUrl}/caps` }, "t-shot2");
    const s = sess("shot2");
    const r = (await inv("browser.screenshot", { mode: "resource" }, "t-shot2")) as {
      mode: string;
      resourceId?: string;
    };
    expect(r.mode).toBe("resource");
    expect(r.resourceId).toMatch(/^shot-0-\d+\.png$/);
    expect(existsSync(join(s.state.resourceDir, r.resourceId ?? ""))).toBe(true);
  });

  it("forced inline oversize -> SCREENSHOT_TOO_LARGE (not retryable)", async () => {
    await inv("browser.launch", {}, "t-shot3");
    await inv("browser.navigate", { url: `${baseUrl}/noise` }, "t-shot3");
    const err = await errOf(inv("browser.screenshot", { mode: "inline", fullPage: true }, "t-shot3"));
    expect(err.code).toBe("BROWSER_SCREENSHOT_TOO_LARGE");
    expect(err.retryable).toBe(false);
  }, 20000);

  it("oversize with default mode falls back to resource", async () => {
    await inv("browser.launch", {}, "t-shot4");
    await inv("browser.navigate", { url: `${baseUrl}/noise` }, "t-shot4");
    const r = (await inv("browser.screenshot", { fullPage: true }, "t-shot4")) as {
      mode: string;
      resourceId?: string;
    };
    expect(r.mode).toBe("resource");
    expect(r.resourceId).toMatch(/^shot-/);
  }, 20000);
});

// ---------------------------------------------------------------------------
// crash (Q4)
// ---------------------------------------------------------------------------

describeRun("crash (Q4)", () => {
  it("killed browser -> CRASHED retryable; relaunch resets tab ids", async () => {
    await inv("browser.launch", {}, "t-crash");
    await inv("browser.tab.open", {}, "t-crash");
    await inv("browser.tab.open", {}, "t-crash");
    const s = sess("crash");
    await kill(s);
    await waitFor(() => s.state.dead);

    const err = await errOf(inv("browser.click", { selector: ".add-cart" }, "t-crash"));
    expect(err.code).toBe("BROWSER_CRASHED");
    expect(err.retryable).toBe(true);

    // relaunch: fresh context, counter reset (tab 0, then 1 again)
    const r = await inv("browser.launch", {}, "t-crash");
    expect(r).toEqual({ launched: true, mode: "headless" });
    expect(s.state.dead).toBe(false);
    const open = (await inv("browser.tab.open", {}, "t-crash")) as { tabId: number };
    expect(open.tabId).toBe(1); // counter reset (Q4)
  }, 20000);
});

// ---------------------------------------------------------------------------
// lifecycle (D-42)
// ---------------------------------------------------------------------------

describeRun("lifecycle (D-42)", () => {
  function fakeBus(): { bus: LifecycleBus; publish(event: string, payload?: object): void } {
    const subs = new Map<string, Array<(payload?: object) => void>>();
    const bus: LifecycleBus = {
      subscribe(event, handler) {
        const list = subs.get(event) ?? [];
        list.push(handler);
        subs.set(event, list);
        return { unsubscribe: () => void list.splice(list.indexOf(handler), 1) };
      },
    };
    return {
      bus,
      publish(event, payload) {
        for (const h of subs.get(event) ?? []) h(payload);
      },
    };
  }

  it("session.destroyed closes the browser", async () => {
    const dir = mkdtempSync(join(tmpdir(), "brt-lc1-"));
    const s = createSession(dir, () => {});
    const fb = fakeBus();
    attachLifecycle(s, fb.bus);
    await s.driver.launch("headless");
    expect(s.state.launched).toBe(true);
    fb.publish("session.destroyed", { sessionId: "x" });
    await waitFor(() => !s.state.launched);
  });

  it("session.cleanup_resources purges shot-* files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "brt-lc2-"));
    const s = createSession(dir, () => {});
    const fb = fakeBus();
    attachLifecycle(s, fb.bus);
    await s.driver.launch("headless");
    expect(s.state.tabs.get(0)).toBeDefined();
    writeFileSync(join(dir, "shot-0-123.png"), "x");
    writeFileSync(join(dir, "keep.txt"), "x");
    fb.publish("session.cleanup_resources", {});
    await waitFor(() => !existsSync(join(dir, "shot-0-123.png")));
    expect(existsSync(join(dir, "keep.txt"))).toBe(true);
  });

  it("suspended/resumed are no-ops; dispose detaches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "brt-lc3-"));
    const s = createSession(dir, () => {});
    const fb = fakeBus();
    const lc = attachLifecycle(s, fb.bus);
    await s.driver.launch("headless");
    fb.publish("session.suspended", {});
    expect(s.state.launched).toBe(true);
    fb.publish("session.resumed", {});
    expect(s.state.launched).toBe(true);

    lc.dispose();
    fb.publish("session.destroyed", {});
    await new Promise((r) => setTimeout(r, 100));
    expect(s.state.launched).toBe(true);
    await s.driver.close();
  });
});
