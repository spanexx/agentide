/*
 * Code Map: dashboard DOM boot (P4 layer, thin).
 *
 * Wires the DOM to the state machine. Renderers + state machine live in
 * sibling files (render.js, wire.js) so this stays under AGENTS rule 9.
 *
 * CID Index:
 *   CID:app-001 -> boot
 *   CID:app-002 -> Gap 1 fix: clean send closure (state.ws lookup)
 *   CID:app-003 -> Gap 3 fix: render panelErrors per panel
 *   CID:app-004 -> Gap 4 fix: terminal banner uses lastError verbatim
 *
 * Quick lookup: rg -n "CID:app-" packages/dashboard-core/src/assets/app.js
 */

(function () {
  "use strict";

  function boot() {
    const token = window.__AGENTIDE_TOKEN__;
    if (!token) return;
    const host = window.location.hostname || "127.0.0.1";
    const wsUrl = "ws://" + host + ":7300/ws";

    const R = window.AgentideRender;
    const { createClient } = window.AgentideClient;
    const { renderSessions, renderPlugins, renderCaps, renderHealth,
            renderError, renderDetailRows } = R;

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
      sessionsBody: document.getElementById("sessionsBody"),
      pluginsBody: document.getElementById("pluginsBody"),
      capsBody: document.getElementById("capsBody"),
      healthBody: document.getElementById("healthBody"),
    };
    const panelContainers = {
      sessionsBody: document.getElementById("pSessions"),
      pluginsBody: document.getElementById("pPlugins"),
      capsBody: document.getElementById("pCapabilities"),
      healthBody: document.getElementById("pHealth"),
    };

    // CID:app-002 - Gap 1 fix: send uses `client.state.ws.send` via the
    // client ref so it reads the LIVE websocket at send-time, not a
    // lexically-captured `let ws` from before connect().
    const client = createClient({
      token, wsUrl,
      send: (frame) => {
        const ws = client.state.ws;
        if (ws) ws.send(JSON.stringify(frame));
      },
      log,
      onState: (conn, err) => {
        connPill.className = "pill " + conn;
        connPill.textContent = conn;
        downBanner.classList.toggle("show", conn === "down" || conn === "connecting");
        tokenBanner.classList.toggle("show", conn === "terminal");
        backoffState.textContent = err || "…";
        // CID:app-004 - Gap 4 fix: terminal banner uses the verbatim
        // auth.error message when present, so operators can tell
        // "origin mismatch" from generic expiry.
        if (conn === "terminal") {
          const reason = client.state.lastError || "reload the page to mint a fresh token";
          tokenBanner.textContent = "token rejected: " + reason + " — reload the page";
        }
      },
      onPanels: (s) => {
        // CID:app-003 - Gap 3 fix: render panelErrors verbatim when present;
        // otherwise render the normal table.
        const stale = s.conn !== "connected";
        for (const k of Object.keys(panelContainers)) {
          panelContainers[k].classList.toggle("stale", stale);
          const err = s.panelErrors && s.panelErrors[k];
          if (err) {
            panels[k].innerHTML = renderError(err);
          } else if (k === "sessionsBody") panels[k].innerHTML = renderSessions(s.sessions);
          else if (k === "pluginsBody") panels[k].innerHTML = renderPlugins(s.plugins);
          else if (k === "capsBody") panels[k].innerHTML = renderCaps(s.capabilities);
          else if (k === "healthBody") panels[k].innerHTML = renderHealth(s.health);
        }
        // Re-bind click handlers for drill-down after every render.
        document.querySelectorAll("tr[data-kind][data-i]").forEach((tr) => {
          tr.onclick = () => client.setDetail(tr.dataset.kind, +tr.dataset.i);
        });
      },
      onDetail: (kind, record) => {
        const titles = { session: "Session", plugin: "Plugin", cap: "Capability", health: "Runtime health" };
        const src = {
          session: "session.list · invoke.result",
          plugin: "plugin.list · invoke.result",
          cap: "capability.list · invoke.result",
          health: "system.health + gateway.status · 30s poll",
        };
        document.getElementById("detailTitle").textContent = titles[kind] || "Record";
        document.getElementById("detailSrc").textContent = "source: " + (src[kind] || "");
        document.getElementById("detailBody").innerHTML = renderDetailRows(record);
        document.getElementById("detail").classList.add("show");
        document.getElementById("overlay").classList.add("show");
      },
    });

    client.connect();

    document.getElementById("detailClose").onclick = closeDetail;
    document.getElementById("overlay").onclick = closeDetail;
    function closeDetail() {
      document.getElementById("detail").classList.remove("show");
      document.getElementById("overlay").classList.remove("show");
    }

    window.addEventListener("pagehide", () => client.close());

    // CID:app-005 - Gap 2 fix: hidden pause / visible resume.
    document.addEventListener("visibilitychange", () => {
      client.setPaused(document.hidden);
    });
  }

  if (typeof window !== "undefined") {
    if (document.readyState === "complete") boot();
    else window.addEventListener("load", boot);
  }
})();