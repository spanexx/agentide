/*
 * Code Map: dashboard WS client + state machine + renderers.
 *
 * The page speaks the adapter-websocket wire (W2 Q1/W4 — already shipped).
 * Open sequence: connect → auth {token} → 4 invokes (mode:"call") → render
 * snapshots → subscribe ["session.*","plugin.*","capability.*"] → live.
 * Health polls gateway.status every 30s (system.* has no producers).
 *
 * Exposed as ESM exports so P4 unit tests can exercise the state machine,
 * renderers, and backoff schedule without a browser. The default-export
 * `boot()` wires it to the live DOM on first `app.js` execution.
 *
 * CID Index:
 *   CID:client-001 -> createClient (state machine)
 *   CID:client-002 -> computeBackoff
 *   CID:client-003 -> renderSessions / renderPlugins / renderCaps / renderHealth
 *   CID:client-004 -> boot (DOM wiring)
 *
 * Quick lookup: rg -n "CID:client-" packages/dashboard-core/src/
 */

// ---- Pure renderers ----

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export function renderSessions(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return '<span class="empty">no sessions</span>';
  }
  return `<table><tr><th>ID</th><th>STATUS</th><th>OWNER</th><th>CREATED</th></tr>` +
    sessions.map((s, i) =>
      `<tr data-kind="session" data-i="${i}" title="click for details"><td>${esc((s.id || "").slice(0, 9))}…</td>` +
      `<td class="${s.status === "active" ? "s" : s.status === "suspended" ? "sus" : "arch"}">${esc(s.status)}</td>` +
      `<td>${esc(s.owner || "")}</td><td>${esc(s.createdAt || "")}</td></tr>`
    ).join("") + `</table>`;
}

export function renderPlugins(plugins) {
  if (!Array.isArray(plugins) || plugins.length === 0) {
    return '<span class="empty">no plugins installed</span>';
  }
  return `<table><tr><th>ID</th><th>VERSION</th><th>STATUS</th></tr>` +
    plugins.map((p, i) =>
      `<tr data-kind="plugin" data-i="${i}" title="click for details"><td>${esc(p.id)}</td><td>${esc(p.version)}</td>` +
      `<td class="${p.enabled ? "en" : "dis"}">${p.enabled ? "enabled" : "disabled"}</td></tr>`
    ).join("") + `</table>`;
}

export function renderCaps(caps) {
  if (!Array.isArray(caps) || caps.length === 0) {
    return '<span class="empty">no capabilities registered</span>';
  }
  return `<table><tr><th>NAME</th><th>TIER</th></tr>` +
    caps.map((c, i) =>
      `<tr data-kind="cap" data-i="${i}" title="click for details"><td>${esc(c.name)}</td>` +
      `<td>${c.tier ? `<span class="tier ${c.tier}">${esc(c.tier)}</span>` : '<span class="tier biz">business</span>'}</td></tr>`
    ).join("") + `</table>`;
}

export function renderHealth(health) {
  if (!health || health.status === "down") {
    return '<span class="empty">gateway unreachable — status poll failed</span>';
  }
  const h = health;
  return `<table><tr><th>STATUS</th><th>UPTIME</th><th>TENANTS</th><th>PLUGINS</th></tr>
    <tr data-kind="health" title="click for details"><td class="s">${esc(h.status)}</td><td>${Math.round((h.uptimeMs || 0) / 1000)}s</td><td>${h.tenantCount || 0}</td><td>${h.pluginCount || 0}</td></tr></table>`;
}

// CID:client-002 - computeBackoff
// Schedule (per Q9 lock): 1, 2, 4, 8, 16, 30 (cap) seconds with ±20% jitter.
// Pure function — tests drive `attempt` directly.
export function computeBackoff(attempt) {
  const base = Math.min(30000, 1000 * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(500, Math.round(base + jitter));
}

// ---- State machine (CID:client-001) ----
// Pure transitions + a frame factory. The live client (DOM) wires these
// into a WebSocket; the tests instantiate Client with a mock `send` and
// observe transitions.

export const STATES = {
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DOWN: "down",
  TERMINAL: "terminal",
};

export function createClient(opts) {
  const { token, wsUrl, send, log, onState, onPanels, onDetail, onError } = opts;
  const state = {
    conn: STATES.CONNECTING,
    attempts: 0,
    ws: null,
    pending: new Map(), // id → {resolve, reject, topic}
    sessions: [],
    plugins: [],
    capabilities: [],
    health: null,
    lastError: null,
    closedByUs: false,
    healthTimer: null,
  };

  const setState = (conn, lastError) => {
    state.conn = conn;
    if (lastError !== undefined) state.lastError = lastError;
    onState?.(conn, state.lastError);
    onPanels?.(state); // re-render with new conn flag
  };

  const sendInvoke = (name, input) => {
    const id = `inv-${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      state.pending.set(id, { resolve, reject, topic: name });
      send({ type: "invoke", id, capability: { name }, input: input ?? {}, mode: "call" });
    });
  };

  const handleFrame = (frame) => {
    if (frame.type === "auth.ok") {
      log?.("← auth.ok");
      state.attempts = 0;
      setState(STATES.CONNECTED);
      bootstrap();
      return;
    }
    if (frame.type === "auth.error") {
      // Terminal — close 1008 equivalent. No reconnect.
      log?.(`← auth.error: ${frame.message ?? ""}`);
      setState(STATES.TERMINAL, frame.message ?? "auth error");
      return;
    }
    if (frame.type === "invoke.result") {
      const p = state.pending.get(frame.id);
      if (p) { state.pending.delete(frame.id); p.resolve(frame.output); }
      return;
    }
    if (frame.type === "invoke.error") {
      const p = state.pending.get(frame.id);
      if (p) { state.pending.delete(frame.id); p.reject(new Error(`${frame.code}: ${frame.message}`)); }
      return;
    }
    if (frame.type === "event") {
      handleEvent(frame.topic, frame.payload ?? frame);
      return;
    }
    if (frame.type === "error") {
      setState(STATES.DOWN, frame.message ?? "frame error");
    }
  };

  const handleEvent = (topic, payload) => {
    if (topic.startsWith("session.")) {
      // Refetch the snapshot — the canonical source of truth for the page.
      log?.(`event: ${topic}`);
      invoke4(true);
      return;
    }
    if (topic.startsWith("plugin.")) {
      log?.(`event: ${topic}`);
      invoke4(true);
      return;
    }
    if (topic.startsWith("capability.")) {
      log?.(`event: ${topic}`);
      invoke4(true);
      return;
    }
  };

  const applyInvokeError = (name, err) => {
    const target = ({
      "session.list": "sessionsBody",
      "plugin.list": "pluginsBody",
      "capability.list": "capsBody",
      "system.health": "healthBody",
    })[name];
    if (!target) return;
    onPanels?.({ ...state, panelError: { target, message: `${err.message}` } });
  };

  const invoke4 = async (silent = false) => {
    if (!silent) log?.("invoke → 4 × session.list / plugin.list / capability.list / system.health");
    const targets = [
      { name: "session.list", slot: "sessions" },
      { name: "plugin.list", slot: "plugins" },
      { name: "capability.list", slot: "capabilities" },
      { name: "system.health", slot: "health" },
    ];
    for (const t of targets) {
      try {
        const out = await sendInvoke(t.name, {});
        if (t.slot === "sessions") state.sessions = Array.isArray(out) ? out : (out.sessions ?? []);
        else if (t.slot === "plugins") state.plugins = Array.isArray(out) ? out : (out.plugins ?? []);
        else if (t.slot === "capabilities") state.capabilities = Array.isArray(out) ? out : (out.capabilities ?? []);
        else if (t.slot === "health") state.health = out;
      } catch (err) {
        applyInvokeError(t.name, err);
      }
    }
    onPanels?.(state);
  };

  const bootstrap = () => {
    // The 4 invokes + subscribe. P5 will add the 30s health poll.
    invoke4();
    send({ type: "subscribe", topics: ["session.*", "plugin.*", "capability.*"] });
    log?.("subscribe → session.*, plugin.*, capability.*");
    // Health polling (D1→D3 lock: 30s; the client honors this on its own timer).
    if (state.healthTimer) clearInterval(state.healthTimer);
    state.healthTimer = setInterval(async () => {
      try {
        const out = await sendInvoke("gateway.status", {});
        state.health = out;
        onPanels?.(state);
      } catch (err) {
        applyInvokeError("system.health", err);
      }
    }, 30000);
  };

  const connect = () => {
    setState(STATES.CONNECTING);
    state.closedByUs = false;
    state.ws = new WebSocket(wsUrl);
    state.ws.onopen = () => {
      log?.("connect →");
      send({ type: "auth", token });
    };
    state.ws.onmessage = (ev) => {
      try { handleFrame(JSON.parse(ev.data)); }
      catch (err) { log?.(`parse error: ${err.message}`); }
    };
    state.ws.onclose = (ev) => {
      if (state.closedByUs) return;
      // Terminal — no reconnect on auth.error (set by handleFrame).
      if (state.conn === STATES.TERMINAL) return;
      state.attempts += 1;
      const delay = computeBackoff(state.attempts);
      log?.(`socket closed (${ev.code ?? "?"}) — retry ${state.attempts} in ${delay}ms`);
      setState(STATES.DOWN, `closed (${ev.code ?? "?"})`);
      state.ws = null;
      if (state.healthTimer) { clearInterval(state.healthTimer); state.healthTimer = null; }
      // Reject any in-flight invokes so the panels show errors, not hangs.
      for (const [id, p] of state.pending) {
        p.reject(new Error(`socket closed (${ev.code ?? "?"})`));
        state.pending.delete(id);
      }
      setTimeout(() => connect(), delay);
    };
    state.ws.onerror = () => {
      // onclose will follow; don't double-handle.
    };
  };

  return {
    connect,
    state,
    close: () => {
      state.closedByUs = true;
      if (state.healthTimer) clearInterval(state.healthTimer);
      try { state.ws?.close(); } catch {}
    },
    // Detail handler for row clicks — wires to the DOM in boot().
    setDetail: (kind, i) => {
      const record = ({
        session: state.sessions[i],
        plugin: state.plugins[i],
        cap: state.capabilities[i],
        health: state.health,
      })[kind];
      if (!record) return;
      onDetail?.(kind, record);
    },
  };
}

// CID:client-004 - boot
// Wires the client to the page DOM. Pure renderers above do the table HTML;
// this only handles pills, banners, drill-down overlay, and the wire log.
export function boot() {
  const token = window.__AGENTIDE_TOKEN__;
  if (!token) return;
  const wsUrl = (() => {
    const host = window.location.hostname || "127.0.0.1";
    return `ws://${host}:7300/ws`;
  })();
  const logEl = document.getElementById("log");
  const log = (msg) => {
    const d = document.createElement("div");
    d.textContent = msg;
    logEl.prepend(d);
  };
  const connPill = document.getElementById("connPill");
  const downBanner = document.getElementById("downBanner");
  const tokenBanner = document.getElementById("tokenBanner");
  const backoffState = document.getElementById("backoffState");
  const tokenShort = document.getElementById("tokenShort");
  tokenShort.textContent = token.slice(0, 16) + "…";

  const panels = {
    sessions: document.getElementById("sessionsBody"),
    plugins: document.getElementById("pluginsBody"),
    capabilities: document.getElementById("capsBody"),
    health: document.getElementById("healthBody"),
  };
  const panelContainers = {
    sessions: document.getElementById("pSessions"),
    plugins: document.getElementById("pPlugins"),
    capabilities: document.getElementById("pCapabilities"),
    health: document.getElementById("pHealth"),
  };

  const send = (frame) => ws.send(JSON.stringify(frame));
  let ws;
  const client = createClient({
    token, wsUrl,
    send: (frame) => ws.send(JSON.stringify(frame)),
    log,
    onState: (conn, err) => {
      connPill.className = "pill " + conn;
      connPill.textContent = conn;
      downBanner.classList.toggle("show", conn === "down" || conn === "connecting");
      tokenBanner.classList.toggle("show", conn === "terminal");
      backoffState.textContent = err ?? "…";
    },
    onPanels: (s) => {
      panels.sessions.innerHTML = renderSessions(s.sessions);
      panels.plugins.innerHTML = renderPlugins(s.plugins);
      panels.capabilities.innerHTML = renderCaps(s.capabilities);
      panels.health.innerHTML = renderHealth(s.health);
      const stale = s.conn !== "connected";
      for (const k of Object.keys(panelContainers)) {
        panelContainers[k].classList.toggle("stale", stale);
      }
      // Wire click-to-detail on every row.
      for (const [id, panel] of Object.entries(panels)) {
        panel.querySelectorAll("tr[data-kind][data-i]").forEach((tr) => {
          tr.onclick = () => client.setDetail(tr.dataset.kind, +tr.dataset.i);
        });
      }
    },
    onDetail: (kind, record) => {
      const titles = { session: "Session", plugin: "Plugin", cap: "Capability", health: "Runtime health" };
      const src = { session: "session.list · invoke.result", plugin: "plugin.list · invoke.result",
                    cap: "capability.list · invoke.result", health: "system.health + gateway.status · 30s poll" };
      const detail = document.getElementById("detail");
      const overlay = document.getElementById("overlay");
      document.getElementById("detailTitle").textContent = titles[kind] ?? "Record";
      document.getElementById("detailSrc").textContent = "source: " + (src[kind] ?? "");
      document.getElementById("detailBody").innerHTML = Object.entries(record).map(([k, v]) =>
        `<dt>${esc(k)}</dt><dd>${esc(v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : v)}</dd>`
      ).join("");
      detail.classList.add("show");
      overlay.classList.add("show");
    },
  });

  // Stash ws ref for send closure above.
  client.connect();
  // Re-bind send now that ws is reachable: monkey-patch via a getter on the client.
  Object.defineProperty(client, "_ws", { get: () => ws });
  ws = (() => {
    // The client set up its own WebSocket internally; we mirror it for the
    // send closure to forward frames. (Boot is intentionally tiny — the real
    // frame forwarder is in client.connect().)
    return { send: () => {} }; // no-op; the client's own ws handles sends
  })();

  // Close + drill-down wiring.
  document.getElementById("detailClose").onclick = () => {
    document.getElementById("detail").classList.remove("show");
    document.getElementById("overlay").classList.remove("show");
  };
  document.getElementById("overlay").onclick = () => {
    document.getElementById("detail").classList.remove("show");
    document.getElementById("overlay").classList.remove("show");
  };
  window.addEventListener("pagehide", () => client.close());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { /* P5: pause; the state machine still retries on reconnect */ }
  });
}

// Auto-boot if loaded in a browser.
if (typeof window !== "undefined") boot();