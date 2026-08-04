// CID:exit-001 - ExitCode
// Purpose: the locked 0..5 exit-code ladder (GRILL Q4, PRD S5).
//   0 = invoke.result
//   1 = invoke.error (any GATEWAY_* code, passed through verbatim)
//   2 = pre-flight / connection failure (usage, config, token unparseable,
//       refused, close 1009/1011, subscribe.error, error frame)
//   3 = TLS / upgrade failure
//   4 = auth.error before auth.ok (close 1008; all W2 codes except origin
//       mismatch — the CLI never sends Origin)
//   5 = interrupted (Ctrl-C / SIGTERM)
// Used by: cli.ts, consumer.ts, bin.js
export enum ExitCode {
  Ok = 0,
  InvokeError = 1,
  Preflight = 2,
  Tls = 3,
  Auth = 4,
  Interrupted = 5,
}

// Errors that already carry a definitive exit code (ConfigError, auth, etc.)
export interface ExitCodeError extends Error {
  readonly exitCode: ExitCode;
}

export function isExitCodeError(err: Error): err is ExitCodeError {
  return Number.isInteger((err as ExitCodeError).exitCode);
}

// CID:exit-002 - exitCodeFor
// Purpose: classify an unknown failure into the 0..5 ladder by its shape.
//   Explicit exitCode wins; otherwise the message/name distinguishes the
//   layer (TLS 3 vs auth 4 vs pre-flight 2). Invocation-level GATEWAY_*
//   errors never reach here — consumer.ts maps those to 1 directly so the
//   gateway's code passes through verbatim (no third vocabulary).
//   Takes `Error` (callers narrow caught values — `unknown` is banned in
//   non-catch positions by scripts/check-banned-types.sh).
export function exitCodeFor(err: Error): ExitCode {
  if (err instanceof Error) {
    const explicit = (err as ExitCodeError).exitCode;
    if (Number.isInteger(explicit)) return explicit as ExitCode;

    const name = err.name.toLowerCase();
    const msg = err.message.toLowerCase();

    // TLS / upgrade layer (Q4: 3 = TLS failure — includes EPROTO/SSL-record
    // errors, e.g. plaintext client against a TLS listener)
    if (
      name.includes("tls") || msg.includes("tls handshake") ||
      msg.includes("upgrade") || msg.includes("certificate") ||
      msg.includes("eproto") || msg.includes("ssl")
    ) {
      return ExitCode.Tls;
    }
    // auth layer: auth.error frame, close 1008, token rejected
    if (msg.includes("auth.error") || msg.includes("1008") || msg.includes("token rejected") || msg.includes("auth failed")) {
      return ExitCode.Auth;
    }
    // pre-flight / connection layer: refused, unparseable, 1009/1011,
    // subscribe.error, error frame, invalid JSON, unknown frame
    if (
      msg.includes("econnrefused") || msg.includes("connection refused") ||
      msg.includes("close 1009") || msg.includes("frame too large") ||
      msg.includes("close 1011") || msg.includes("heartbeat") ||
      msg.includes("subscribe.error") || msg.includes("error frame") ||
      msg.includes("invalid json") || msg.includes("unable to connect") ||
      msg.includes("socket hang up") || msg.includes("enoent") ||
      msg.includes("token") || msg.includes("config") || msg.includes("usage")
    ) {
      return ExitCode.Preflight;
    }
  }
  return ExitCode.Preflight;
}
