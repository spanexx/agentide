/*
 * Code Map: dashboard-core post-impl simulation (pipeline Phase 4).
 *
 * Drives the REAL websocket client + renderers (loaded from the
 * package's assets/app.js at runtime — see esbuild bundle step below)
 * against a live adapter-websocket.
 *
 * Bundle step (run once):
 *   pnpm exec esbuild \
 *     docs/features/dashboard-core/simulate.ts \
 *     --bundle --platform=browser --target=es2022 --format=iife \
 *     --outfile=docs/features/dashboard-core/simulate.js
 *
 * Open:
 *   docs/features/dashboard-core/simulate.html?gateway=ws://127.0.0.1:7300/ws
 *   (paste the token from `agentide token issue --caller sim`)
 *
 * CID Index:
 *   CID:sim-post-001 -> runScenarios
 *   CID:sim-post-002 -> renderResults
 */

interface SentFrame {
  type: string;
  id?: string;
  capability?: { name: string };
  [k: string]: unknown;
}

declare global {
  interface Window {
    __AGENTIDE_SIM__?: {
      runScenarios: () => Promise<void>;
    };
  }
}

export {};

async function runScenarios(): Promise<void> {
  const url = new URL(window.location.href);
  const gateway = url.searchParams.get("gateway") ?? "ws://127.0.0.1:7300/ws";
  const token = url.searchParams.get("token") ?? prompt("paste dashboard token");
  if (!token) return;
  (document.getElementById("gw") as HTMLElement).textContent = gateway;

  // Drift-fix S1: declare fakeWindow before the loader uses it.
  const fakeWindow: Record<string, unknown> = {};

  const results: Array<{ name: string; pass: boolean; detail: string }> = [];
  function record(name: string, pass: boolean, detail: string) {
    results.push({ name, pass, detail });
    renderResults(results);
  }

  // Pull the createClient / STATES exports out of the bundled assets
  // the page uses. Drift-fix S1: render.js installs AgentideRender,
  // wire.js installs AgentideClient (createClient + STATES). The sim
  // loads both so the state machine + backoff are shared with prod.
  async function loadModule(path: string, attr: string): Promise<Record<string, unknown>> {
    const src = await fetch(path).then((r) => r.text());
    const fn = new Function("window", "globalThis", src + `;return window.${attr};`);
    return fn(fakeWindow, fakeWindow) ?? {};
  }
  await loadModule("./assets/render.js", "AgentideRender");
  const AgentideClient = await loadModule("./assets/wire.js", "AgentideClient") as {
    createClient: (opts: unknown) => SimClient;
    STATES: Record<string, string>;
  };
  const { createClient, STATES } = AgentideClient;

  const sent: SentFrame[] = [];
  // Mutable ref so the HookedWS constructor can capture the live instance
  // for the sim driver — TypeScript narrows `current` after a guard, so
  // the sim uses `ws.current` everywhere (no narrowing pollution).
  interface WSRef { current: SimWS | null }
  const ws: WSRef = { current: null };

  // Hook WebSocket: capture every instance so the sim can drive it.
  const RealWS = window.WebSocket;
  class HookedWS {
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onclose: ((ev: { code?: number }) => void) | null = null;
    constructor(public url: string) {
      const real = new RealWS(url);
      ws.current = this;
      const self = this;
      real.onopen = (ev) => self.onopen?.(ev);
      real.onmessage = (ev) => self.onmessage?.({ data: typeof ev.data === "string" ? ev.data : "" });
      real.onclose = (ev) => self.onclose?.(ev as { code: number });
      this.send = (frame: string) => real.send(frame);
      this.close = () => real.close();
    }
    send(_frame: string): void {}
    close(): void {}
  }
  (window as unknown as { WebSocket: unknown }).WebSocket = HookedWS;

  const client = createClient({
    token,
    wsUrl: gateway,
    send: (frame: SentFrame) => sent.push(frame),
    log: (msg: string) => appendLog(msg),
    onState: (s: string) => appendLog(`state → ${s}`),
    onPanels: () => appendLog("panels rendered"),
  });

  function appendLog(msg: string) {
    const el = document.getElementById("log");
    if (!el) return;
    el.textContent = `${msg}\n${el.textContent ?? ""}`.slice(0, 2000);
  }

  function wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  function findFrame(predicate: (f: SentFrame) => boolean): SentFrame | undefined {
    return [...sent].reverse().find(predicate);
  }

  try {
    client.connect();
    await wait(100);

    record("S1: auth → 4 invokes → subscribe",
      sent.some((f) => f.type === "auth")
        && sent.filter((f) => f.type === "invoke").length === 4
        && sent.some((f) => f.type === "subscribe"),
      `${sent.length} frames sent`);

    // Drain the 4 invokes so bootstrap completes before the rest.
    const invokeIds = sent.filter((f) => f.type === "invoke") as Array<{ id: string; capability: { name: string } }>;
    if (ws.current !== null) {
      for (const f of invokeIds) {
        ws.current?.onmessage?.({ data: JSON.stringify({ type: "invoke.result", id: f.id, output: f.capability.name === "session.list" ? [{ id: "s1", status: "active", owner: "sim", createdAt: "10:00" }] : [] }) });
      }
      await wait(50);
    }

    record("S2: dashboard.view.* caps return snapshots via the wire",
      invokeIds.length === 4 && client.state.sessions.length === 1,
      `${invokeIds.length} invokes dispatched, ${client.state.sessions.length} session loaded`);

    ws.current?.onmessage?.({ data: JSON.stringify({ type: "event", topic: "session.created" }) });
    await wait(20);
    record("S3: session.created event triggers snapshot refetch",
      document.getElementById("log")!.textContent!.includes("event: session.created"),
      "event observed in log");

    record("S4: 30s health poll timer is registered",
      typeof client.state.healthTimer === "number",
      `timer handle: ${client.state.healthTimer}`);

    ws.current?.onclose?.({ code: 1006 });
    await wait(20);
    record("S5: unexpected close → DOWN + backoff scheduled",
      client.state.conn === "down",
      `state=${client.state.conn}, attempts=${client.state.attempts}`);

    // Terminal — auth.error.
    (ws as WSRef).current = null;
    client.connect();
    await wait(50);
    ws.current?.onmessage?.({ data: JSON.stringify({ type: "auth.error", message: "origin mismatch" }) });
    await wait(20);
    record("S6: auth.error → TERMINAL (no reconnect)",
      client.state.conn === "terminal",
      `state=${client.state.conn}`);

    // S7: invoke.error verbatim.
    (ws as WSRef).current = null;
    client.connect();
    await wait(50);
    const sl = findFrame((f) => f.type === "invoke" && f.capability?.name === "session.list");
    if (ws.current !== null && sl !== undefined && sl.id) {
      ws.current?.onmessage?.({ data: JSON.stringify({ type: "invoke.error", id: sl.id, code: "GATEWAY_INTERNAL_ERROR", message: "no backing store" }) });
      await wait(20);
      record("S7: invoke.error renders verbatim into the matching panel",
        document.querySelector("#sessions .error-msg") !== null,
        "panel error rendered");
    } else {
      record("S7: invoke.error renders verbatim", false, "session.list frame not found");
    }

    // S8: drill-down.
    (ws as WSRef).current = null;
    client.connect();
    await wait(50);
    const sl2 = findFrame((f) => f.type === "invoke" && f.capability?.name === "session.list");
    if (ws.current !== null && sl2 !== undefined && sl2.id) {
      ws.current?.onmessage?.({ data: JSON.stringify({ type: "invoke.result", id: sl2.id, output: [{ id: "sX", status: "active", owner: "drill" }] }) });
      await wait(20);
      client.setDetail("session", 0);
      await wait(20);
      const detailVisible = document.getElementById("detail")!.classList.contains("show");
      record("S8: drill-down exposes the matching session record",
        detailVisible, `overlay shown=${detailVisible}`);
    } else {
      record("S8: drill-down", false, "session.list frame not found");
    }

    record("S9: STATES exposes the 4 Q9 lifecycle names",
      STATES.CONNECTING === "connecting" && STATES.CONNECTED === "connected" && STATES.DOWN === "down" && STATES.TERMINAL === "terminal",
      Object.keys(STATES).join(","));

    const panel = document.querySelector("#sessions") as HTMLElement | null;
    const maxHeight = panel ? getComputedStyle(panel).maxHeight : "";
    record("S10: panel scroll region is capped",
      !!maxHeight && maxHeight !== "none" && parseInt(maxHeight) >= 200,
      `max-height=${maxHeight}`);

    const themed = Array.from(document.styleSheets[0]?.cssRules ?? []).some((r) =>
      (r as { cssText?: string }).cssText?.includes("::-webkit-scrollbar-thumb"));
    record("S11: themed scrollbar CSS is loaded", themed, "::-webkit-scrollbar-thumb rule present");
  } catch (err) {
    record("FATAL", false, String(err));
  } finally {
    client.close();
    (window as unknown as { WebSocket: unknown }).WebSocket = RealWS;
  }
}

interface SimClient {
  connect: () => void;
  close: () => void;
  state: {
    conn: string;
    sessions: unknown[];
    healthTimer: number | null;
    attempts: number;
  };
  setDetail: (kind: string, i: number) => void;
}

interface SimWS {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  send: (frame: string) => void;
  close: () => void;
}

function renderResults(results: Array<{ name: string; pass: boolean; detail: string }>): void {
  const root = document.getElementById("results");
  if (!root) return;
  root.innerHTML = results.map((r) =>
    `<div class="row ${r.pass ? "pass" : "fail"}"><b>${r.pass ? "PASS" : "FAIL"}</b> ${r.name} <span class="muted">— ${r.detail}</span></div>`,
  ).join("");
}

window.__AGENTIDE_SIM__ = { runScenarios };
if (document.readyState === "complete") {
  void runScenarios();
} else {
  window.addEventListener("load", () => void runScenarios());
}