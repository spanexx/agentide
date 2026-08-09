// CID:cli-tree-001 - tree table integrity tests
// Purpose: lock the structure of the agentide CLI command tree per
//   docs/features/cli-restructure/PRD-TRD-cli-restructure.md S3 (tree),
//   S4 (old names), S5 (offline/live/dual). These tests are the spec:
//   if the data changes, the test changes first and the rationale lives
//   in the PRD-TRD, not in a comment here.
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../index.js";
import { GROUPS, OLD_NAME_NEW, groupHelp, worldOf } from "../cli-tree.js";

describe("cli-tree: GROUPS table", () => {
  it("contains every group per PRD-TRD S3", () => {
    // PRD-TRD S3 — the canonical surface.
    expect(Object.keys(GROUPS).sort()).toEqual(
      ["capability", "client", "gateway", "plugin", "session", "tenant", "token"].sort(),
    );
  });

  it("gateway has start|stop|status|health|metrics|version", () => {
    expect(Object.keys(GROUPS["gateway"]!.subs).sort()).toEqual(
      ["health", "metrics", "start", "status", "stop", "version"].sort(),
    );
  });

  it("tenant has create|list|suspend|delete", () => {
    expect(Object.keys(GROUPS["tenant"]!.subs).sort()).toEqual(
      ["create", "delete", "list", "suspend"].sort(),
    );
  });

  it("client has create|list|grant|revoke|rotate|redeem", () => {
    expect(Object.keys(GROUPS["client"]!.subs).sort()).toEqual(
      ["create", "grant", "list", "redeem", "revoke", "rotate"].sort(),
    );
  });

  it("capability has list|describe", () => {
    expect(Object.keys(GROUPS["capability"]!.subs).sort()).toEqual(["describe", "list"].sort());
  });

  it("plugin has list|install|uninstall|enable|disable|reload", () => {
    expect(Object.keys(GROUPS["plugin"]!.subs).sort()).toEqual(
      ["disable", "enable", "install", "list", "reload", "uninstall"].sort(),
    );
  });

  it("session has create|resume|destroy|touch|list", () => {
    expect(Object.keys(GROUPS["session"]!.subs).sort()).toEqual(
      ["create", "destroy", "list", "resume", "touch"].sort(),
    );
  });

  it("token has issue|revoke", () => {
    expect(Object.keys(GROUPS["token"]!.subs).sort()).toEqual(["issue", "revoke"].sort());
  });
});

describe("cli-tree: world per PRD-TRD S5", () => {
  it("offline groups: tenant, client, token", () => {
    expect(GROUPS["tenant"]!.world).toBe("offline");
    expect(GROUPS["client"]!.world).toBe("offline");
    expect(GROUPS["token"]!.world).toBe("offline");
  });

  it("session is live (PRD-TRD S5)", () => {
    expect(GROUPS["session"]!.world).toBe("live");
  });

  it("capability list is dual; describe is offline (in-process registry in v1, IMPL note 4)", () => {
    expect(GROUPS["capability"]!.world).toBe("dual");
    expect(worldOf("capability", "list")).toBe("dual");
    expect(worldOf("capability", "describe")).toBe("offline");
  });

  it("plugin list is dual; mutators are live", () => {
    expect(GROUPS["plugin"]!.world).toBe("dual");
    expect(worldOf("plugin", "list")).toBe("dual");
    expect(worldOf("plugin", "install")).toBe("live");
    expect(worldOf("plugin", "uninstall")).toBe("live");
    expect(worldOf("plugin", "enable")).toBe("live");
    expect(worldOf("plugin", "disable")).toBe("live");
    expect(worldOf("plugin", "reload")).toBe("live");
  });

  it("gateway.status/health/metrics/version are live; start/stop are dual (pid-file)", () => {
    // Per IMPL Risk Note 1: start/stop are pid-file ops (not websocket).
    // status/health/metrics/version are live gateway reads.
    expect(worldOf("gateway", "status")).toBe("live");
    expect(worldOf("gateway", "health")).toBe("live");
    expect(worldOf("gateway", "metrics")).toBe("live");
    expect(worldOf("gateway", "version")).toBe("live");
    // start/stop remain runnable without a live gateway — they touch the
    // pid file / spawn the gateway process, not the websocket.
    expect(worldOf("gateway", "start")).toBe("offline");
    expect(worldOf("gateway", "stop")).toBe("offline");
  });
});

describe("cli-tree: groupHelp", () => {
  it("gateway group lists every subcommand", () => {
    const text = groupHelp("gateway");
    expect(text).toMatch(/start/);
    expect(text).toMatch(/stop/);
    expect(text).toMatch(/status/);
    expect(text).toMatch(/health/);
    expect(text).toMatch(/metrics/);
    expect(text).toMatch(/version/);
  });

  it("returns empty string for unknown group (defensive)", () => {
    expect(groupHelp("nope")).toBe("");
  });
});

describe("cli-tree: OLD_NAME_NEW per PRD-TRD S4", () => {
  it("start|stop|status|health map to gateway.*", () => {
    expect(OLD_NAME_NEW["start"]).toEqual({ group: "gateway", sub: "start" });
    expect(OLD_NAME_NEW["stop"]).toEqual({ group: "gateway", sub: "stop" });
    expect(OLD_NAME_NEW["status"]).toEqual({ group: "gateway", sub: "status" });
    expect(OLD_NAME_NEW["health"]).toEqual({ group: "gateway", sub: "health" });
  });

  it("sessions maps to session list", () => {
    expect(OLD_NAME_NEW["sessions"]).toEqual({ group: "session", sub: "list" });
  });

  it("capabilities maps to capability list", () => {
    expect(OLD_NAME_NEW["capabilities"]).toEqual({ group: "capability", sub: "list" });
  });

  it("plugins maps to plugin list", () => {
    expect(OLD_NAME_NEW["plugins"]).toEqual({ group: "plugin", sub: "list" });
  });
});

// CID:cli-tree-009 - dispatch tests
// Purpose: verify the runCliInner dispatcher uses the tree for every
//   group. The dispatcher integration lives in cli.ts; these tests pin
//   the *new* behavior (bare group, unknown sub, group help, old-name
//   mapping, unimplemented subs) without re-asserting every existing
//   test's coverage.
describe("cli-tree: dispatch — all groups (PRD-TRD S3)", () => {
  const home = mkdtempSync(join(tmpdir(), "agentide-cli-tree-"));
  const cleanup = () => rmSync(home, { recursive: true, force: true });

  it("`agentide gateway` (no sub) prints the group subcommand list and exits 0", async () => {
    try {
      const r = await runCli(["gateway", "--data-dir", "/data"], { fs: makeEmptyFs(), home });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/Subcommands:/);
      expect(r.stdout).toMatch(/start/);
      expect(r.stdout).toMatch(/stop/);
      expect(r.stdout).toMatch(/status/);
      expect(r.stdout).toMatch(/health/);
      expect(r.stdout).toMatch(/metrics/);
      expect(r.stdout).toMatch(/version/);
    } finally {
      cleanup();
    }
  });

  it("`agentide gateway bogus` exits 2 and lists the subs", async () => {
    try {
      const r = await runCli(["gateway", "bogus", "--data-dir", "/data"], { fs: makeEmptyFs(), home });
      expect(r.exitCode).toBe(2);
      expect(r.stderr).toMatch(/unrecognized subcommand/);
      expect(r.stderr).toMatch(/bogus/);
    } finally {
      cleanup();
    }
  });

  it("`agentide gateway --help` is equivalent to bare `agentide gateway` (exit 0, sub list)", async () => {
    try {
      const r = await runCli(["gateway", "--help", "--data-dir", "/data"], { fs: makeEmptyFs(), home });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/Subcommands:/);
    } finally {
      cleanup();
    }
  });

  it("every group's bare form prints its groupHelp header and exits 0 (PRD S3)", async () => {
    for (const group of Object.keys(GROUPS)) {
      const r = await runCli([group], { fs: makeEmptyFs(), home });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(new RegExp(`^agentide ${group} — `));
      expect(r.stdout).toMatch(/Subcommands:/);
    }
  });

  it("`agentide tenant bogus` exits 2 with unrecognized subcommand + the group list", async () => {
    const r = await runCli(["tenant", "bogus"], { fs: makeEmptyFs(), home });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/unrecognized subcommand: bogus/);
    expect(r.stderr).toMatch(/agentide tenant — /);
  });

  it("`agentide session create` exits 1 — surface declared in the tree, not implemented in v1", async () => {
    const r = await runCli(["session", "create"], { fs: makeEmptyFs(), home });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/session create is not implemented in v1/);
  });

  it("`agentide plugin install` exits 1 — not implemented in v1 (only plugin list ships)", async () => {
    const r = await runCli(["plugin", "install"], { fs: makeEmptyFs(), home });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/plugin install is not implemented in v1/);
  });

  it("old name `capabilities` without --url lists from disk (dual-mode, PRD S5)", async () => {
    const dataDir = join(home, "cap-data");
    await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs: makeEmptyFs(), home });
    const r = await runCli(["capabilities", "--data-dir", dataDir], { fs: makeEmptyFs(), home });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/gateway\.status/);
  });

  it("old name `status` is live-only — exits non-zero with a dead --url (PRD S6)", async () => {
    // NOTE: a real gateway may be running on 127.0.0.1:7300 from earlier
    // sessions, and the consumer resolves the real ~/.config — force a
    // dead endpoint so the test is deterministic. No --data-dir: live
    // commands refuse it (IMPL Phase 2).
    const r = await runCli(
      ["status", "--url", "ws://127.0.0.1:1/ws", "--token", "t"],
      { fs: makeEmptyFs(), home },
    );
    expect(r.exitCode).not.toBe(0);
  });

  it("`agentide gateway status` without a running gateway → 'gateway not running' (PRD S6)", async () => {
    // Phase 2: live command without --url checks the pid file first. The
    // pidFile seam keeps this deterministic (real /tmp/agentide.pid may
    // hold a leftover gateway).
    const r = await runCli(["gateway", "status"], { fs: makeEmptyFs(), home, pidFile: join(home, "no.pid") });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/gateway not running \(start it with: agentide gateway start\)/);
  });

  it("`agentide sessions` (old name) without a reachable gateway exits non-zero (session list is live)", async () => {
    const r = await runCli(["sessions", "--url", "ws://127.0.0.1:1/ws", "--token", "t"], { fs: makeEmptyFs(), home });
    expect(r.exitCode).not.toBe(0);
  });
});

describe("cli-tree: old-name deprecation notes (PRD-TRD S4, IMPL Phase 4)", () => {
  const home = mkdtempSync(join(tmpdir(), "agentide-cli-tree-notes-"));
  const cleanup = () => rmSync(home, { recursive: true, force: true });
  it("old `status` runs + exactly one stderr note naming 'agentide gateway status'", async () => {
    try {
      const r = await runCli(["status"], { fs: makeEmptyFs(), home, pidFile: join(home, "no.pid") });
      expect(r.exitCode).toBe(1); // gateway not running (pid seam)
      expect(r.stderr).toContain("note: 'agentide status' is deprecated — use 'agentide gateway status' (removed next release)");
      expect(r.stderr).toMatch(/gateway not running/);
      expect(r.stderr.match(/deprecated/g)?.length).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("old `health` runs + note names 'agentide gateway health'", async () => {
    try {
      const r = await runCli(["health", "--url", "ws://127.0.0.1:1/ws", "--token", "t"], { fs: makeEmptyFs(), home });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("note: 'agentide health' is deprecated — use 'agentide gateway health' (removed next release)");
    } finally {
      cleanup();
    }
  });

  it("old `sessions` runs + note names 'agentide session list'", async () => {
    try {
      const r = await runCli(["sessions", "--url", "ws://127.0.0.1:1/ws", "--token", "t"], { fs: makeEmptyFs(), home });
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("note: 'agentide sessions' is deprecated — use 'agentide session list' (removed next release)");
    } finally {
      cleanup();
    }
  });

  it("old `capabilities` runs on disk + note names 'agentide capability list'", async () => {
    try {
      const dataDir = join(home, "cap-data");
      await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs: makeEmptyFs(), home });
      const r = await runCli(["capabilities", "--data-dir", dataDir], { fs: makeEmptyFs(), home });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/gateway\.status/);
      expect(r.stderr).toContain("note: 'agentide capabilities' is deprecated — use 'agentide capability list' (removed next release)");
    } finally {
      cleanup();
    }
  });

  it("old `plugins` runs on disk + note names 'agentide plugin list'", async () => {
    try {
      const dataDir = join(home, "plug-data");
      await runCli(["init", "--data-dir", dataDir, "--default-tenant", "acme"], { fs: makeEmptyFs(), home });
      const r = await runCli(["plugins", "--data-dir", dataDir], { fs: makeEmptyFs(), home });
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toContain("note: 'agentide plugins' is deprecated — use 'agentide plugin list' (removed next release)");
    } finally {
      cleanup();
    }
  });

  it("old `stop` runs (nothing to stop) + note names 'agentide gateway stop'", async () => {
    try {
      const r = await runCli(["stop", "--pid-file", join(home, "no.pid")], { fs: makeEmptyFs(), home });
      expect(r.exitCode).toBe(0); // D-83 unified rc 0
      expect(r.stderr).toContain("note: 'agentide stop' is deprecated — use 'agentide gateway stop' (removed next release)");
    } finally {
      cleanup();
    }
  });

  it("new tree names get NO deprecation note", async () => {
    try {
      const r = await runCli(["gateway", "status"], { fs: makeEmptyFs(), home, pidFile: join(home, "no.pid") });
      expect(r.stderr).not.toContain("deprecated");
      const r2 = await runCli(["tenant", "list", "--url", "ws://x"], { fs: makeEmptyFs(), home });
      expect(r2.stderr).not.toContain("deprecated");
    } finally {
      cleanup();
    }
  });
});

// Tiny FileSystem stand-in for the dispatch tests above. The dispatch
// path never touches the fs (no init/start/tenant) — these tests only
// verify the group-help + unknown-sub surface.
function makeEmptyFs(): import("@spanexx/gateway-core").FileSystem {
  return {
    async readFile(): Promise<string> {
      const err = new Error("ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    },
    async writeFile(): Promise<void> {},
    async exists(): Promise<boolean> {
      return false;
    },
  };
}
