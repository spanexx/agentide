#!/usr/bin/env node
/*
 * sim-state.mjs — shared state access for interconnected simulations.
 *
 * Single source of truth: <repo>/data/sim-state.json. All writes are atomic
 * (tmp file + rename), mirroring lib-event-bus.sh
 * (docs/features/archive/event-bus-v1/scripts/lib-event-bus.sh) in JS.
 *
 * Reserved keys (interconnected-simulation skill contract):
 *   subscriptions, events, plugins, capabilities, sessions, audit
 * Extension keys established by other sims:
 *   tokens, active_token, audit_log (permission-tiering simulate-pre.ts)
 * Token fixtures may carry an optional `expectedOrigins` array (mint-side
 * origin binding, expected-origins sim); readers must tolerate its absence.
 *
 * `recordAudit` accepts a `channel` param (default "mcp" for backward
 * compat) so each sim tags its records with its own channel (D-53 fix).
 *
 * The mcp-adapter sim READS `tokens` (caller/scope fixtures) and WRITES
 * `audit_log` (invocation outcomes) + `events` (real gateway.invocation
 * events published by the kernel) — so a failure in one sim surfaces in
 * every other sim that reads the same state.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const REPO_ROOT = process.env.SIM_ROOT
  ? process.env.SIM_ROOT
  : resolve(dirname(new URL(import.meta.url).pathname), "../../..");

export const STATE_FILE = `${REPO_ROOT}/data/sim-state.json`;
const TMP_FILE = `${STATE_FILE}.tmp.${process.pid}`;

function baseState() {
  return {
    subscriptions: [],
    events: [],
    plugins: [],
    capabilities: [],
    sessions: [],
    audit: [],
    // extension keys (permission-tiering sim)
    tokens: [],
    active_token: null,
    audit_log: [],
  };
}

export function loadState() {
  if (!existsSync(STATE_FILE)) return baseState();
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return baseState();
    return { ...baseState(), ...parsed };
  } catch {
    // Corrupt state must never break a sim — reset to the canonical shape.
    return baseState();
  }
}

export function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(TMP_FILE, JSON.stringify(state, null, 2));
  renameSync(TMP_FILE, STATE_FILE);
}

export function mutateState(mutator) {
  const state = loadState();
  mutator(state);
  saveState(state);
  return state;
}

// Record one invocation outcome in the shared audit trail. Schema matches
// permission-tiering simulate-pre.ts audit_log entries (ts/caller/capability/
// status) with a `channel` tag so readers can attribute the record. Callers
// pass their own channel; "mcp" stays the default for backward compat (D-53).
export function recordAudit({ caller, capability, status, detail, channel = "mcp" }) {
  return mutateState((s) => {
    (s.audit_log ??= []).push({
      ts: new Date().toISOString(),
      caller,
      capability,
      status,
      ...(detail !== undefined ? { detail } : {}),
      channel,
    });
  });
}

// Append one event to the shared event log. Schema matches lib-event-bus.sh
// bus_publish: {ts, name, payload}.
export function recordEvent(name, payload) {
  return mutateState((s) => {
    (s.events ??= []).push({ ts: new Date().toISOString(), name, payload });
  });
}

// Read the shared token fixtures (seeded by the permission-tiering sim).
// Each fixture: {id, tenant, caller, scope, issued}.
export function tokenFixtures() {
  const s = loadState();
  return Array.isArray(s.tokens) ? s.tokens : [];
}

// Counts for the sim's start/end narration.
export function stateSummary() {
  const s = loadState();
  return {
    tokens: Array.isArray(s.tokens) ? s.tokens.length : 0,
    auditLog: Array.isArray(s.audit_log) ? s.audit_log.length : 0,
    events: Array.isArray(s.events) ? s.events.length : 0,
  };
}
