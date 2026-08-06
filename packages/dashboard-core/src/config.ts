/*
 * Code Map: dashboard-core config constants.
 *
 * CID Index:
 *   CID:cfg-001 -> DASHBOARD_DEFAULT_PORT
 *
 * The dashboard binds 127.0.0.1:7200 by default. adapter-websocket MUST
 * NOT take 7200 (its port is 7300 — no conflict). The port is configurable
 * via the createPlatform factory; the agentide CLI passes
 * --dashboard-port / env AGENTIDE_DASHBOARD_PORT.
 */

export const DASHBOARD_DEFAULT_PORT = 7200;
export const DASHBOARD_LOOPBACK_HOSTS = ["127.0.0.1", "localhost"] as const;