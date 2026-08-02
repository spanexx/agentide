#!/usr/bin/env node
/*
 * Post-impl simulation for BI[24] sdk-browser.
 *
 * Drives the REAL @platform/sdk-browser built package (packages/sdk-browser/
 * dist) end-to-end against a real WebSocket Gateway stand-in (the `ws`
 * server), inside a real jsdom DOM — no mocks of SDK internals. Run with:
 *
 *   node packages/agentide/scripts/simulate-sdk-browser.mjs
 *
 * ENVIRONMENT STAND-INS (browser bits a Node process lacks):
 *   - globalThis.WebSocket  → `ws` client (real RFC6455 WebSocket), wrapped to
 *     send an Origin header like a browser tab (origin binding, GRILL T5 Q2)
 *   - document / window / MutationObserver / CustomEvent / Element / etc.
 *     → jsdom (real DOM implementation)
 *   - the Gateway → real `ws` WebSocketServer that enforces auth-first,
 *     records every wire frame, sends sdk.invoke on demand, and closes with
 *     the codes the origin-binding contract requires (1006 drop / 1008 reject)
 *
 * INTERCONNECTED SIMULATION: this sim writes one audit record per scenario to
 * data/sim-state.json (audit_log key, same convention as the mcp-adapter sim),
 * so a failure here surfaces in every other sim that reads shared state.
 *
 * Scenarios verified (PRD-TRD-sdk-browser §Simulation Contract, 1:1):
 *   connect          → first frame = {type:"sdk.auth", token}; 2 unique caps
 *                      registered (3 buttons dedupe to one shop.cart.add);
 *                      state connected; onStateChange connecting→connected
 *   invoke shop.cart.add {"productId":202,"qty":2}
 *                    → sdk:cap:shop.cart.add CustomEvent on all 3 elements;
 *                      dev filter (data-pid=202) matches → cart-count++;
 *                      sdk.invoke.result frame with matching callId
 *   invoke profile.note {"text":"hi"}
 *                    → form-fill fallback wrote "hi" into the input
 *   drop             → server closes 1006; state reconnecting (backoff 1s±20%);
 *                      auto-reconnect within ~2s; auth-first + re-register
 *   hide-tab/show-tab→ pending reconnect pauses while hidden (no connection
 *                      for >2.5s); fires immediately on visible
 *   offline/online   → socket dead + disconnected; no reconnect while offline;
 *                      online resets backoff + immediate reconnect
 *   pagehide persisted → bfcache skip: connection stays open
 *   remove-cap shop.cart.add (×3)
 *                    → count 3→2→1→0; 1→0 unregisters on last removal
 *   token-origin https://evil.com
 *                    → gateway closes 1008; disconnected; NO zombie reconnect
 *                      (connection count frozen for 3.5s)
 *   disconnect       → deliberate close(1000,"deliberate"); no reconnect
 *
 * NOTE on ordering: remove-cap runs while connected (the 1→0 unregister
 * requires a live registration; after a 1008 the registry is already
 * unregistered). The internal bus events (sdk.connected, sdk.invoke.started,
 * ...) are verified exhaustively in packages/sdk-browser/src/__tests__/
 * events.test.ts — the sim asserts the externally observable surface: wire
 * frames, state transitions, CustomEvent fan-out, and DOM effects.
 */

import { createSdk } from "@platform/sdk-browser";
import { JSDOM } from "jsdom";
import { createHmac } from "node:crypto";
import { WebSocket as WSClient, WebSocketServer } from "ws";
import { mutateState, stateSummary } from "./sim-state.mjs";

// ────────────────────────────────────────────────────────────────────────
// Harness (mirrors simulate-mcp-adapter.mjs)
// ────────────────────────────────────────────────────────────────────────

const log = (label, ok, detail) => {
  const tag = ok === true ? "✓ PASS" : ok === false ? "✗ FAIL" : "  info";
  console.log(`${tag}  ${label}${detail ? `  — ${detail}` : ""}`);
};

async function scenarioPass(label, fn) {
  try {
    const detail = await fn();
    log(label, true, detail);
    return { ok: true, detail };
  } catch (err) {
    const detail = `${err?.message ?? err}`;
    log(label, false, detail);
    return { ok: false, detail };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll every 20ms until predicate passes or timeout. Returns true if passed. */
async function waitFor(predicate, timeoutMs, intervalMs = 20) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ────────────────────────────────────────────────────────────────────────
// JWT fixture (real HMAC token; expectedOrigins drives origin binding)
// ────────────────────────────────────────────────────────────────────────

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function mintToken({ secretBytes, expectedOrigins }) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    sub: { appId: "shop-app" },
    expectedOrigins,
    iat: Date.now(),
    exp: Date.now() + 3600_000,
  }));
  const sig = createHmac("sha256", secretBytes).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${sig.toString("base64url")}`;
}

// ────────────────────────────────────────────────────────────────────────
// Browser environment stand-ins: jsdom + ws client with Origin header
// ────────────────────────────────────────────────────────────────────────

const PAGE_HTML = `<!DOCTYPE html>
<html><head><title>Shop</title></head><body>
  <h1>Shop page</h1>
  <div id="cart">
    <button class="cap" data-sdk-cap="shop.cart.add" data-pid="201">+ 201</button>
    <button class="cap" data-sdk-cap="shop.cart.add" data-pid="202">+ 202</button>
    <button class="cap" data-sdk-cap="shop.cart.add" data-pid="203">+ 203</button>
    <span id="cart-count">0</span>
  </div>
  <form id="pform">
    <input id="note" data-sdk-cap="profile.note" placeholder="note" />
  </form>
</body></html>`;

const dom = new JSDOM(PAGE_HTML, { url: "https://shop.example.com/" });
const { window } = dom;

// Browser globals the SDK touches (bare identifiers in dist).
globalThis.window = window;
globalThis.document = window.document;
globalThis.MutationObserver = window.MutationObserver;
globalThis.CustomEvent = window.CustomEvent;
globalThis.Event = window.Event;
globalThis.Element = window.Element;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.PageTransitionEvent = window.PageTransitionEvent;
// Node 22 defines a getter-only global `navigator` — override via defineProperty.
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

/** Origin this "browser tab" claims on every socket (mutable for the evil-origin scenario). */
let tabOrigin = "https://shop.example.com";

/** ws client wrapped to send a browser-style Origin header on connect. */
class BrowserWebSocket extends WSClient {
  constructor(url) {
    super(url, { headers: { Origin: tabOrigin } });
  }
}
globalThis.WebSocket = BrowserWebSocket;

// ────────────────────────────────────────────────────────────────────────
// Gateway stand-in: real WebSocket server enforcing the wire contract
// ────────────────────────────────────────────────────────────────────────

const TOKEN_SECRET = Buffer.from("sim-secret-0123456789");
const TOKEN = mintToken({ secretBytes: TOKEN_SECRET, expectedOrigins: ["https://shop.example.com"] });

class GatewaySim {
  constructor() {
    this.server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    // port:0 binds asynchronously — resolve when the OS port is assigned.
    this.ready = new Promise((resolve) => this.server.once("listening", resolve));
    this.connections = []; // { socket, messages: [], origin }
    this.connectionCount = 0;
    this.closedFrames = []; // { code, reason, atMs }
    this.server.on("connection", (socket, req) => {
      this.connectionCount += 1;
      const conn = { socket, messages: [], origin: String(req.headers.origin ?? "") };
      // Keep every connection (even dead ones) — their frames are evidence
      // for auth-first / re-register assertions. latest() filters live ones.
      this.connections.push(conn);
      socket.on("message", (data) => {
        let msg;
        try { msg = JSON.parse(String(data)); } catch { return; }
        conn.messages.push(msg);
        // Origin binding (GRILL T5 Q2): if the tab's Origin is not in the
        // token's expectedOrigins, the gateway rejects the connection.
        const payload = TOKEN.split(".")[1];
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
        if (msg.type === "sdk.auth" && !claims.expectedOrigins.includes(conn.origin)) {
          socket.close(1008, "origin-mismatch");
        }
      });
      socket.on("close", (code, reason) => {
        this.closedFrames.push({ code, reason: reason.toString(), atMs: Date.now() });
      });
    });
  }
  get port() { return this.server.address().port; }
  get url() { return `ws://127.0.0.1:${this.port}/ws`; }
  latest() {
    const live = this.connections.filter((c) => c.socket.readyState === 1);
    return live[live.length - 1] ?? null;
  }
  /** Send an sdk.invoke frame to the latest live connection. */
  sendInvoke({ callId, name, input }) {
    const conn = this.latest();
    assert(conn !== null, "gateway: no live connection to send invoke on");
    conn.socket.send(JSON.stringify({ type: "sdk.invoke", callId, name, input }));
  }
  drop() {
    const conn = this.latest();
    assert(conn !== null, "gateway: no live connection to drop");
    // 1006 is reserved (can't be sent in a close frame) — terminate() tears
    // the TCP connection down abruptly, which is what a network drop does.
    conn.socket.terminate();
  }
  closeWith(code, reason) {
    const conn = this.latest();
    assert(conn !== null, `gateway: no live connection to close with ${code}`);
    conn.socket.close(code, reason);
  }
  messagesFor(i) { return this.connections[i]?.messages ?? []; }
  authTokens() {
    return this.connections.map((c) => c.messages[0]).filter((m) => m?.type === "sdk.auth");
  }
  registers() {
    return this.connections.flatMap((c) =>
      c.messages.filter((m) => m.type === "sdk.capability.register").map((m) => m.name));
  }
  allFrames() {
    return this.connections.flatMap((c) => c.messages);
  }
  close() { return new Promise((r) => this.server.close(r)); }
}

/** Build a gateway whose OS-assigned port is ready. */
async function newGateway() {
  const gateway = new GatewaySim();
  await gateway.ready;
  return gateway;
}

// ────────────────────────────────────────────────────────────────────────
// Dev page code (mirrors simulate-pre.html): filter + form handlers
// ────────────────────────────────────────────────────────────────────────

function installDevPage() {
  const doc = globalThis.document;
  const cartCount = doc.getElementById("cart-count");
  let hits = { shop: 0, profile: 0 }; // per-element CustomEvent counts
  const seen = { shop: [], profile: [] };

  for (const el of doc.querySelectorAll('[data-sdk-cap="shop.cart.add"]')) {
    el.addEventListener("sdk:cap:shop.cart.add", (e) => {
      hits.shop += 1;
      seen.shop.push({ pid: el.dataset.pid, productId: e.detail.input.productId });
    });
  }
  const note = doc.getElementById("note");
  note.addEventListener("sdk:cap:profile.note", (e) => {
    hits.profile += 1;
    seen.profile.push({ text: e.detail.input.text });
  });

  // Dev filter: only the pid=202 card acts on shop.cart.add (matches
  // simulate-pre.html). The other two elements still receive the CustomEvent
  // (fan-out) but the app ignores them.
  doc.addEventListener("sdk:cap:shop.cart.add", (e) => {
    const card = e.target.closest("[data-pid]");
    if (card !== null && card.dataset.pid === "202") {
      cartCount.textContent = String(Number(cartCount.textContent) + 1);
    }
  });
  return { hits, seen, cartCount };
}

// ────────────────────────────────────────────────────────────────────────
// Scenarios (PRD-TRD §Simulation Contract)
// ────────────────────────────────────────────────────────────────────────

const SCENARIOS = [];
const scenario = (num, label, fn) => SCENARIOS.push([num, label, fn]);

scenario(1, "connect", async () => {
  const gateway = await newGateway();
  const sdk = createSdk({ gateway: gateway.url, appId: "shop-app", token: TOKEN });
  const transitions = [];
  sdk.onStateChange((s) => transitions.push(s));

  sdk.connect();
  await waitFor(() => gateway.connectionCount === 1 && gateway.authTokens().length === 1, 2000);
  assert(gateway.connectionCount === 1, "no connection arrived");

  const first = gateway.messagesFor(0)[0];
  assert(first?.type === "sdk.auth", `first frame was ${first?.type ?? "none"}, expected sdk.auth`);
  assert(first?.token === TOKEN, "token not sent verbatim");
  const regs = gateway.registers();
  assert(regs.includes("shop.cart.add") && regs.includes("profile.note"),
    `registers were [${regs.join(", ")}]`);
  assert(new Set(regs).size === 2, "3 buttons must dedupe to ONE shop.cart.add register");
  assert(sdk.state().connectionState === "connected", `state=${sdk.state().connectionState}`);
  const st = sdk.state().capabilities.find((c) => c.name === "shop.cart.add");
  assert(st !== undefined && st.count === 3 && st.registered, "shop.cart.add count/registered wrong");
  assert(transitions.join("→") === "connecting→connected", `transitions=${transitions.join("→")}`);

  return `auth-first ✓, 2 registers ✓, state=${sdk.state().connectionState} (${transitions.join("→")})`;
});

scenario(2, 'invoke shop.cart.add {"productId":202,"qty":2}', async () => {
  const gateway = await newGateway();
  const sdk = createSdk({ gateway: gateway.url, appId: "shop-app", token: TOKEN });
  const page = installDevPage();
  sdk.connect();
  await waitFor(() => gateway.latest() !== null, 2000);

  gateway.sendInvoke({ callId: "sim-c1", name: "shop.cart.add", input: { productId: 202, qty: 2 } });
  await waitFor(() => page.hits.shop === 3, 2000);
  assert(page.hits.shop === 3, `fan-out hit ${page.hits.shop}/3 elements`);
  assert(page.cartCount.textContent === "1", `cart-count=${page.cartCount.textContent}, dev filter pid=202 should match`);
  assert(page.seen.shop.every((s) => s.pid === "201" || s.pid === "202" || s.pid === "203"),
    "CustomEvent hit unexpected elements");

  const results = gateway.allFrames().filter((m) => m.type === "sdk.invoke.result");
  await waitFor(() => results.length > 0, 2000);
  assert(results.length === 1, `expected 1 result, got ${results.length}`);
  assert(results[0].callId === "sim-c1" && results[0].payload === null, "result callId/payload wrong");

  return "3/3 elements fired; pid=202 filter matched (cart 0→1); sdk.invoke.result ✓";
});

scenario(3, 'invoke profile.note {"text":"hi"}', async () => {
  const gateway = await newGateway();
  const sdk = createSdk({ gateway: gateway.url, appId: "shop-app", token: TOKEN });
  const page = installDevPage();
  sdk.connect();
  await waitFor(() => gateway.latest() !== null, 2000);

  gateway.sendInvoke({ callId: "sim-c2", name: "profile.note", input: { text: "hi" } });
  await waitFor(() => page.hits.profile === 1, 2000);
  assert(page.hits.profile === 1, "profile.note CustomEvent not delivered");
  assert(page.cartCount.parentElement !== null, "sanity");
  await waitFor(() => document.getElementById("note").value === "hi", 2000);
  assert(document.getElementById("note").value === "hi",
    `form-fill fallback: value="${document.getElementById("note").value}"`);

  const results = gateway.allFrames().filter((m) => m.type === "sdk.invoke.result");
  await waitFor(() => results.length > 0, 2000);
  assert(results[0]?.callId === "sim-c2", "result callId wrong");

  return 'form-fill wrote "hi" into #note; sdk.invoke.result ✓';
});

scenario(4, "drop", async () => {
  const gateway = await newGateway();
  const sdk = createSdk({ gateway: gateway.url, appId: "shop-app", token: TOKEN });
  const transitions = [];
  sdk.onStateChange((s) => transitions.push(s));
  sdk.connect();
  await waitFor(() => gateway.latest() !== null, 2000);

  const countBefore = gateway.connectionCount;
  gateway.drop();
  await waitFor(() => sdk.state().connectionState === "reconnecting", 2000);
  assert(sdk.state().connectionState === "reconnecting", "drop did not enter reconnecting");
  // Backoff 1s ±20% → reconnect lands well within 2s.
  await waitFor(() => gateway.connectionCount === countBefore + 1, 2500);
  assert(gateway.connectionCount === countBefore + 1, "no auto-reconnect after drop");
  // The new connection may open before its first frame arrives — poll.
  await waitFor(() => gateway.authTokens().length === 2, 2000);
  const auths = gateway.authTokens();
  assert(auths.length === 2 && auths[1]?.token === TOKEN, "auth-first not re-sent on reconnect");
  await waitFor(() => gateway.registers().length === 4, 2000);
  const regs = gateway.registers();
  assert(regs.length === 4, `expected 4 registers (2 per connection), got ${regs.length}`);
  await waitFor(() => sdk.state().connectionState === "connected", 1000);

  return `reconnecting → auto-reconnect (backoff) → connected; auth-first + 2 re-registers ✓`;
});

scenario(5, "hide-tab / show-tab", async () => {
  const gateway = await newGateway();
  const sdk = createSdk({ gateway: gateway.url, appId: "shop-app", token: TOKEN });
  sdk.connect();
  await waitFor(() => gateway.latest() !== null, 2000);

  // Drop, then hide BEFORE the ~1s backoff fires.
  const countBefore = gateway.connectionCount;
  gateway.drop();
  await waitFor(() => sdk.state().connectionState === "reconnecting", 2000);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  document.dispatchEvent(new window.Event("visibilitychange"));

  await sleep(2600); // longer than the 1s backoff — must NOT reconnect
  assert(gateway.connectionCount === countBefore, `reconnected while hidden (count ${gateway.connectionCount})`);

  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  document.dispatchEvent(new window.Event("visibilitychange"));
  await waitFor(() => gateway.connectionCount === countBefore + 1, 1500);
  await waitFor(() => sdk.state().connectionState === "connected", 1000);
  assert(gateway.connectionCount === countBefore + 1, "no immediate reconnect on visible");
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });

  return "paused while hidden (0 reconnects in 2.6s) → immediate reconnect on visible ✓";
});

scenario(6, "offline / online", async () => {
  const gateway = await newGateway();
  const sdk = createSdk({ gateway: gateway.url, appId: "shop-app", token: TOKEN });
  sdk.connect();
  await waitFor(() => gateway.latest() !== null, 2000);

  const countBefore = gateway.connectionCount;
  window.dispatchEvent(new window.Event("offline"));
  await waitFor(() => sdk.state().connectionState === "disconnected", 1000);
  assert(sdk.state().connectionState === "disconnected", "offline did not disconnect");
  await sleep(1600);
  assert(gateway.connectionCount === countBefore, "reconnected while offline");

  window.dispatchEvent(new window.Event("online"));
  await waitFor(() => gateway.connectionCount === countBefore + 1, 1500);
  await waitFor(() => sdk.state().connectionState === "connected", 1000);
  assert(gateway.connectionCount === countBefore + 1, "no immediate reconnect on online");

  return "offline → dead socket + disconnected; online → immediate reconnect ✓";
});

scenario(7, "pagehide persisted", async () => {
  const gateway = await newGateway();
  const sdk = createSdk({ gateway: gateway.url, appId: "shop-app", token: TOKEN });
  sdk.connect();
  await waitFor(() => gateway.latest() !== null, 2000);

  window.dispatchEvent(new window.PageTransitionEvent("pagehide", { persisted: true }));
  await sleep(500);
  assert(gateway.latest() !== null, "pagehide(persisted) tore the socket down");
  assert(sdk.state().connectionState === "connected", "state changed after bfcache pagehide");
  assert(gateway.closedFrames.every((c) => c.code !== 1000), "a close frame was sent");

  return "bfcache pagehide skipped — socket + state untouched ✓";
});

scenario(8, "remove-cap shop.cart.add (×3)", async () => {
  const gateway = await newGateway();
  const sdk = createSdk({ gateway: gateway.url, appId: "shop-app", token: TOKEN });
  sdk.connect();
  await waitFor(() => gateway.latest() !== null, 2000);
  await waitFor(() => sdk.state().capabilities.some((c) => c.name === "shop.cart.add" && c.registered), 2000);

  const buttons = [...document.querySelectorAll('[data-sdk-cap="shop.cart.add"]')];
  assert(buttons.length === 3, `expected 3 buttons, got ${buttons.length}`);
  const counts = [];
  for (let i = 0; i < buttons.length; i += 1) {
    buttons[i].remove();
    await waitFor(() => {
      const view = sdk.state().capabilities.find((c) => c.name === "shop.cart.add");
      return i < 2
        ? view !== undefined && view.count === 3 - (i + 1)
        : view === undefined; // 1→0: entry deleted = capability unregistered
    }, 1000);
    const view = sdk.state().capabilities.find((c) => c.name === "shop.cart.add");
    if (i < 2) {
      assert(view !== undefined, "shop.cart.add vanished from state too early");
      counts.push(view.count);
    } else {
      assert(view === undefined, "shop.cart.add must leave state after 1→0");
    }
  }
  assert(counts.join(",") === "2,1", `counts were ${counts.join(",")}`);

  // 0→1 again: re-adding one annotated element must re-register (the 1→0
  // unregister cleared the registered flag — a stale flag would swallow it).
  const el = document.createElement("button");
  el.setAttribute("data-sdk-cap", "shop.cart.add");
  document.body.appendChild(el);
  await waitFor(() => sdk.state().capabilities.some((c) => c.name === "shop.cart.add" && c.registered), 1000);
  const registers = gateway.registers().filter((n) => n === "shop.cart.add").length;
  assert(registers === 2, `re-add must re-register (register ×2), got ×${registers}`);
  el.remove();
  await waitFor(() => !sdk.state().capabilities.some((c) => c.name === "shop.cart.add"), 1000);

  return "count 3→2→1→0; cap leaves state on last removal; re-add re-registers ✓";
});

scenario(9, "token-origin https://evil.com", async () => {
  const gateway = await newGateway();
  // The tab is an evil page: its socket carries Origin https://evil.com, but
  // the token is bound to https://shop.example.com (expectedOrigins claim).
  // The gateway must reject the connection with 1008 on auth (T5 Q2), and the
  // SDK must go terminal — no zombie reconnect.
  tabOrigin = "https://evil.com";
  const sdk = createSdk({ gateway: gateway.url, appId: "shop-app", token: TOKEN });
  const transitions = [];
  sdk.onStateChange((s) => transitions.push(s));
  sdk.connect();
  await waitFor(() => gateway.connectionCount === 1, 2000);
  await waitFor(() => sdk.state().connectionState === "disconnected", 2000);
  assert(gateway.connectionCount === 1, "no evil-origin connection arrived");
  const rejects = gateway.closedFrames.filter((c) => c.code === 1008);
  assert(rejects.length >= 1, "gateway never sent 1008");
  assert(sdk.state().connectionState === "disconnected", `state=${sdk.state().connectionState}`);
  assert(transitions.includes("disconnected"), `transitions=${transitions.join("→")}`);

  // Zombie check: no auto-reconnect for 3.5s (backoff would be ~1s if alive).
  await sleep(3500);
  assert(gateway.connectionCount === 1,
    `zombie reconnect! connections ${gateway.connectionCount}`);
  assert(sdk.state().connectionState === "disconnected", `state=${sdk.state().connectionState}`);

  // Restore the tab origin — later scenarios must be trusted again.
  tabOrigin = "https://shop.example.com";

  return "evil origin → gateway 1008 → disconnected; 0 reconnects in 3.5s (no zombie) ✓";
});

scenario(10, "disconnect", async () => {
  const gateway = await newGateway();
  const sdk = createSdk({ gateway: gateway.url, appId: "shop-app", token: TOKEN });
  sdk.connect();
  await waitFor(() => gateway.latest() !== null, 2000);
  const countBefore = gateway.connectionCount;

  sdk.disconnect();
  await waitFor(() => gateway.closedFrames.some((c) => c.code === 1000 && c.reason === "deliberate"), 2000);
  const deliberate = gateway.closedFrames.filter((c) => c.code === 1000);
  assert(deliberate.length >= 1, "no close(1000) frame seen");
  assert(deliberate[0].reason === "deliberate", `reason=${deliberate[0].reason}`);
  assert(sdk.state().connectionState === "disconnected", `state=${sdk.state().connectionState}`);
  await sleep(2000);
  assert(gateway.connectionCount === countBefore, "reconnected after deliberate disconnect");

  return 'close(1000,"deliberate") sent; no reconnect ✓';
});

// ────────────────────────────────────────────────────────────────────────
// Runner
// ────────────────────────────────────────────────────────────────────────

async function runAll() {
  console.log("BI[24] sdk-browser — post-impl simulation (drives REAL @platform/sdk-browser)\n");
  const before = stateSummary();
  console.log(`[state] shared data/sim-state.json: ${before.auditLog} audit records, ${before.events} events\n`);

  const results = [];
  for (const [num, label, fn] of SCENARIOS) {
    console.log(`── scenario ${num}/10: ${label}`);
    const r = await scenarioPass(label, fn);
    results.push(r.ok);
    // Shared audit trail (same schema as the mcp-adapter sim, attributed to
    // this channel so readers can tell the sims apart).
    mutateState((s) => {
      (s.audit_log ??= []).push({
        ts: new Date().toISOString(),
        caller: "sdk-browser-sim",
        capability: label.split(" ")[0],
        status: r.ok ? "passed" : "failed",
        detail: `scenario ${num}: ${r.detail ?? ""}`,
        channel: "sdk-browser",
      });
    });
  }

  const passed = results.filter((r) => r === true).length;
  const failed = results.length - passed;
  const after = stateSummary();
  console.log(`\n[state] wrote ${after.auditLog - before.auditLog} audit records to data/sim-state.json`);
  console.log(`\n${passed}/${results.length} scenarios passed${failed > 0 ? `, ${failed} failed` : ""}.`);
  console.log("(Internal bus events sdk.connected / sdk.invoke.* verified in packages/sdk-browser/src/__tests__/events.test.ts.)");
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
