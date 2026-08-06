/*
 * Code Map: dashboard WS state machine (P4 layer).
 *
 * Pure client (no DOM). Consumes AgentideRender from render.js.
 *
 * CID Index:
 *   CID:wire-001 -> createClient
 *   CID:wire-002 -> STATES
 *   CID:wire-003 -> gap 1 fix: state.ws.send via the client ref
 *
 * Quick lookup: rg -n "CID:wire-" packages/dashboard-core/src/assets/
 */

(function () {
  "use strict";

  const STATES = {
    CONNECTING: "connecting",
    CONNECTED: "connected",
    DOWN: "down",
    TERMINAL: "terminal",
  };

  function createClient(opts) {
    const { token, wsUrl, onState, onPanels, onDetail, onLog } = opts;
    const log = opts.log || onLog || (() => {});
    const sendOverride = opts.send;
    const state = {
      conn: STATES.CONNECTING,
      attempts: 0,
      ws: null,
      pending: new Map(),
      sessions: [],
      plugins: [],
      capabilities: [],
      health: null,
      lastError: null,
      panelErrors: {},
      closedByUs: false,
      healthTimer: null,
      paused: false,
    };

    // CID:wire-003 - Gap 1 fix. The original boot() declared `let ws;` and
    // passed a closure that captured it lexically — but the closure ran
    // before `ws` was assigned, silently dropping every frame. Now the
    // send closure reads the LIVE state.ws through `state` so the auth
    // frame reaches the socket the moment onopen fires.
    const send = (frame) => {
      if (sendOverride) return sendOverride(frame);
      const ws = state.ws;
      if (!ws) return;
      ws.send(JSON.stringify(frame));
    };

    const setState = (conn, lastError) => {
      state.conn = conn;
      if (lastError !== undefined) state.lastError = lastError;
      onState?.(conn, state.lastError);
      onPanels?.(state);
    };

    const sendInvoke = (name, input) => new Promise((resolve, reject) => {
      const id = "inv-" + Math.random().toString(36).slice(2, 10);
      state.pending.set(id, { resolve, reject, topic: name });
      send({ type: "invoke", id, capability: { name }, input: input || {}, mode: "call" });
    });

    const handleFrame = (frame) => {
      if (frame.type === "auth.ok") {
        log("← auth.ok");
        state.attempts = 0;
        setState(STATES.CONNECTED);
        bootstrap();
        return;
      }
      if (frame.type === "auth.error") {
        log("← auth.error: " + (frame.message || ""));
        setState(STATES.TERMINAL, frame.message || "auth error");
        return;
      }
      if (frame.type === "invoke.result") {
        const p = state.pending.get(frame.id);
        if (p) { state.pending.delete(frame.id); p.resolve(frame.output); }
        return;
      }
      if (frame.type === "invoke.error") {
        const p = state.pending.get(frame.id);
        if (p) { state.pending.delete(frame.id); p.reject(new Error(frame.code + ": " + frame.message)); }
        return;
      }
      if (frame.type === "event") {
        handleEvent(frame.topic, frame.payload || frame);
        return;
      }
      if (frame.type === "error") {
        setState(STATES.DOWN, frame.message || "frame error");
      }
    };

    const handleEvent = (topic) => {
      if (topic.startsWith("session.") || topic.startsWith("plugin.") || topic.startsWith("capability.")) {
        log("event: " + topic);
        invoke4(true);
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
      state.panelErrors = { ...state.panelErrors, [target]: err.message };
      onPanels?.(state);
    };

    const invoke4 = async (silent) => {
      if (!silent) log("invoke → 4 × session.list / plugin.list / capability.list / system.health");
      const targets = [
        { name: "session.list", slot: "sessions" },
        { name: "plugin.list", slot: "plugins" },
        { name: "capability.list", slot: "capabilities" },
        { name: "system.health", slot: "health" },
      ];
      for (const t of targets) {
        try {
          const out = await sendInvoke(t.name, {});
          if (t.slot === "sessions") state.sessions = Array.isArray(out) ? out : (out.sessions || []);
          else if (t.slot === "plugins") state.plugins = Array.isArray(out) ? out : (out.plugins || []);
          else if (t.slot === "capabilities") state.capabilities = Array.isArray(out) ? out : (out.capabilities || []);
          else if (t.slot === "health") state.health = out;
          // Clear any prior error on this panel once data arrives.
          const target = ({
            "session.list": "sessionsBody",
            "plugin.list": "pluginsBody",
            "capability.list": "capsBody",
            "system.health": "healthBody",
          })[t.name];
          if (target && state.panelErrors[target]) {
            const next = { ...state.panelErrors }; delete next[target];
            state.panelErrors = next;
          }
        } catch (err) {
          applyInvokeError(t.name, err);
        }
      }
      onPanels?.(state);
    };

    const bootstrap = () => {
      invoke4();
      send({ type: "subscribe", topics: ["session.*", "plugin.*", "capability.*"] });
      log("subscribe → session.*, plugin.*, capability.*");
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

    const scheduleReconnect = (delay) => {
      // CID:wire-004 - Gap 2 fix: respect pause-hidden. When the tab is
      // hidden (state.paused === true), defer reconnect attempts until the
      // next visibility change resumes them.
      const tryConnect = () => {
        if (state.paused) {
          // Schedule another attempt later — bounded by setInterval's own
          // cadence so we don't stack timers.
          state.pausedTimer = setTimeout(tryConnect, 2000);
          return;
        }
        connect();
      };
      state.pausedTimer = setTimeout(tryConnect, delay);
    };

    const connect = () => {
      if (state.paused) return;
      setState(STATES.CONNECTING);
      state.closedByUs = false;
      state.ws = new WebSocket(wsUrl);
      const ws = state.ws;
      ws.onopen = () => {
        log("connect →");
        send({ type: "auth", token });
      };
      ws.onmessage = (ev) => {
        try { handleFrame(JSON.parse(ev.data)); }
        catch (err) { log("parse error: " + err.message); }
      };
      ws.onclose = (ev) => {
        if (state.closedByUs) return;
        if (state.conn === STATES.TERMINAL) return;
        state.attempts += 1;
        const delay = computeBackoff(state.attempts);
        log("socket closed (" + (ev.code || "?") + ") — retry " + state.attempts + " in " + delay + "ms");
        setState(STATES.DOWN, "closed (" + (ev.code || "?") + ")");
        state.ws = null;
        if (state.healthTimer) { clearInterval(state.healthTimer); state.healthTimer = null; }
        for (const [id, p] of state.pending) {
          p.reject(new Error("socket closed (" + (ev.code || "?") + ")"));
          state.pending.delete(id);
        }
        scheduleReconnect(delay);
      };
      ws.onerror = () => { /* onclose follows */ };
    };

    const client = {
      connect,
      state,
      close: () => {
        state.closedByUs = true;
        if (state.healthTimer) clearInterval(state.healthTimer);
        if (state.pausedTimer) clearTimeout(state.pausedTimer);
        try { state.ws?.close(); } catch {}
      },
      // CID:wire-003 - expose `state` so callers (boot, sim) can drive the
      // setDetail flow without a re-invoke round-trip.
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
      // CID:wire-004 - Gap 2 fix: pause/resume on visibility change.
      setPaused: (paused) => {
        state.paused = paused;
        if (paused) {
          // Close the socket (forces the onclose path; pause timer takes over).
          if (state.ws && state.ws.readyState <= 1) {
            state.closedByUs = true;
            try { state.ws.close(); } catch {}
            state.ws = null;
          }
          if (state.healthTimer) { clearInterval(state.healthTimer); state.healthTimer = null; }
        } else if (state.conn === STATES.DOWN || state.conn === STATES.CONNECTING) {
          // Resume: kick a fresh connect immediately.
          if (state.pausedTimer) { clearTimeout(state.pausedTimer); state.pausedTimer = null; }
          connect();
        }
      },
    };

    return client;
  }

  // CID:wire-003 - expose `computeBackoff` via the same shared namespace
  // (lifecycle tests already reference it from app.js; keep the path stable).
  const ns = (typeof window !== "undefined" ? window : globalThis);
  const R = ns.AgentideRender || {};
  // Wire.js's onclose uses `computeBackoff` directly — define a local
  // binding from the namespace so the IIFE stays self-contained.
  const computeBackoff = R.computeBackoff || (() => 1000);
  ns.AgentideClient = { createClient, STATES, computeBackoff: R.computeBackoff };
})();