/*
 * Code Map: dashboard renderers + backoff (P4 layer).
 *
 * Pure, browser-loadable IIFE exports. The state machine (wire.js) and
 * the DOM boot (app.js) consume these.
 *
 * CID Index:
 *   CID:render-001 -> renderSessions / renderPlugins / renderCaps / renderHealth
 *   CID:render-002 -> renderError (per-panel GATEWAY_* verbatim, fills Gap 3)
 *   CID:render-003 -> computeBackoff
 *   CID:render-004 -> renderRow (drill-down)
 *
 * Quick lookup: rg -n "CID:render-" packages/dashboard-core/src/assets/
 */

(function () {
  "use strict";

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function renderSessions(sessions) {
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return '<span class="empty">no sessions</span>';
    }
    return '<table><tr><th>ID</th><th>STATUS</th><th>OWNER</th><th>CREATED</th></tr>' +
      sessions.map((s, i) =>
        '<tr data-kind="session" data-i="' + i + '" title="click for details"><td>' + esc((s.id || "").slice(0, 9)) + '…</td>' +
        '<td class="' + (s.status === "active" ? "s" : s.status === "suspended" ? "sus" : "arch") + '">' + esc(s.status) + '</td>' +
        '<td>' + esc(s.owner || "") + '</td><td>' + esc(s.createdAt || "") + '</td></tr>'
      ).join("") + '</table>';
  }

  function renderPlugins(plugins) {
    if (!Array.isArray(plugins) || plugins.length === 0) {
      return '<span class="empty">no plugins installed</span>';
    }
    return '<table><tr><th>ID</th><th>VERSION</th><th>STATUS</th></tr>' +
      plugins.map((p, i) =>
        '<tr data-kind="plugin" data-i="' + i + '" title="click for details"><td>' + esc(p.id) + '</td><td>' + esc(p.version) + '</td>' +
        '<td class="' + (p.enabled ? "en" : "dis") + '">' + (p.enabled ? "enabled" : "disabled") + '</td></tr>'
      ).join("") + '</table>';
  }

  function renderCaps(caps) {
    if (!Array.isArray(caps) || caps.length === 0) {
      return '<span class="empty">no capabilities registered</span>';
    }
    return '<table><tr><th>NAME</th><th>TIER</th></tr>' +
      caps.map((c, i) =>
        '<tr data-kind="cap" data-i="' + i + '" title="click for details"><td>' + esc(c.name) + '</td>' +
        '<td>' + (c.tier ? '<span class="tier ' + esc(c.tier) + '">' + esc(c.tier) + '</span>' : '<span class="tier biz">business</span>') + '</td></tr>'
      ).join("") + '</table>';
  }

  function renderHealth(health) {
    if (!health || health.status === "down") {
      return '<span class="empty">gateway unreachable — status poll failed</span>';
    }
    return '<table><tr><th>STATUS</th><th>UPTIME</th><th>TENANTS</th><th>PLUGINS</th></tr>' +
      '<tr data-kind="health" title="click for details"><td class="s">' + esc(health.status) + '</td>' +
      '<td>' + Math.round((health.uptimeMs || 0) / 1000) + 's</td>' +
      '<td>' + (health.tenantCount || 0) + '</td><td>' + (health.pluginCount || 0) + '</td></tr></table>';
  }

  // CID:render-002 - per-panel error verbatim (Q9 lock + AC-7.1)
  function renderError(message) {
    return '<div class="error-msg">' + esc(message) + '</div>';
  }

  // CID:render-003 - backoff schedule (Q9 lock): 1, 2, 4, 8, 16, 30s ±20%
  function computeBackoff(attempt) {
    const base = Math.min(30000, 1000 * Math.pow(2, Math.max(0, attempt - 1)));
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.max(500, Math.round(base + jitter));
  }

  // CID:render-004 - drill-down rows for the detail overlay
  function renderDetailRows(record) {
    return Object.entries(record).map(([k, v]) =>
      '<dt>' + esc(k) + '</dt><dd>' + esc(v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : v) + '</dd>'
    ).join("");
  }

  // Expose for tests + sibling files.
  const ns = (typeof window !== "undefined" ? window : globalThis);
  ns.AgentideRender = {
    renderSessions, renderPlugins, renderCaps, renderHealth,
    renderError, computeBackoff, renderDetailRows,
  };
})();