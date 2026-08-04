// Phase 3 — exit codes (S5). Pure classification tests through the public
// exitCodeFor() surface; consumer wiring is covered in consumer.test.ts.
import { describe, expect, it } from "vitest";
import { ExitCode, exitCodeFor, isExitCodeError } from "../exit-codes.js";

describe("exit codes: explicit code wins (S5)", () => {
  it("0 maps from a successful invoke result (no error at all)", () => {
    expect(ExitCode.Ok).toBe(0);
  });

  it("an error already carrying exitCode 2 keeps it (ConfigError path)", () => {
    const err = new Error("gateway URL required") as Error & { exitCode: number };
    err.exitCode = 2;
    expect(isExitCodeError(err)).toBe(true);
    expect(exitCodeFor(err)).toBe(ExitCode.Preflight);
  });

  it("an error carrying exitCode 4 keeps it (auth layer)", () => {
    const err = new Error("token rejected") as Error & { exitCode: number };
    err.exitCode = 4;
    expect(exitCodeFor(err)).toBe(ExitCode.Auth);
  });

  it("an error carrying exitCode 5 keeps it (interrupt)", () => {
    const err = new Error("SIGINT") as Error & { exitCode: number };
    err.exitCode = 5;
    expect(exitCodeFor(err)).toBe(ExitCode.Interrupted);
  });
});

describe("exit codes: layer classification (S5)", () => {
  it("connection refused → 2", () => {
    expect(exitCodeFor(new Error("connect ECONNREFUSED 127.0.0.1:7300"))).toBe(ExitCode.Preflight);
  });

  it("close 1009 (frame too large) → 2", () => {
    expect(exitCodeFor(new Error("socket closed with 1009 frame too large"))).toBe(ExitCode.Preflight);
  });

  it("close 1011 (heartbeat) → 2", () => {
    expect(exitCodeFor(new Error("close 1011 heartbeat timeout"))).toBe(ExitCode.Preflight);
  });

  it("subscribe.error frame → 2", () => {
    expect(exitCodeFor(new Error("subscribe.error WS_TOPIC_DENIED"))).toBe(ExitCode.Preflight);
  });

  it("generic error frame → 2", () => {
    expect(exitCodeFor(new Error("error frame WS_INTERNAL"))).toBe(ExitCode.Preflight);
  });

  it("TLS handshake failure → 3", () => {
    expect(exitCodeFor(new Error("TLS handshake failed: certificate not trusted"))).toBe(ExitCode.Tls);
  });

  it("upgrade failure → 3", () => {
    expect(exitCodeFor(new Error("unexpected server response: upgrade required"))).toBe(ExitCode.Tls);
  });

  it("EPROTO (plaintext vs TLS listener) → 3", () => {
    expect(exitCodeFor(new Error("write EPROTO SSL routines:tls_get_more_records:packet length too long"))).toBe(ExitCode.Tls);
  });

  it("auth.error before auth.ok → 4", () => {
    expect(exitCodeFor(new Error("auth.error token rejected"))).toBe(ExitCode.Auth);
  });

  it("close 1008 → 4", () => {
    expect(exitCodeFor(new Error("closed with 1008 auth error"))).toBe(ExitCode.Auth);
  });

  it("unknown error shape defaults to 2 (pre-flight)", () => {
    expect(exitCodeFor(new Error("something odd happened"))).toBe(ExitCode.Preflight);
  });
});
