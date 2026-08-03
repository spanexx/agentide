//! Exit codes 0–5 + layer mapping (PRD S5).
//!
//! Single source of truth for process exit codes; layers map their failures
//! onto these via `From`/`exit_code()`.

/*
 * Code Map: exit code taxonomy
 * - ExitCode: enum 0–5 per PRD Scenario 5
 *
 * CID Index:
 * CID:errors-001 -> ExitCode
 *
 * Quick lookup: rg -n "CID:errors-" crates/cli-adapter/src/errors.rs
 */

/// Process exit codes — PRD Scenario 5.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitCode {
    /// invoke.result delivered.
    InvokeResult = 0,
    /// invoke.error frame (any GATEWAY_* code passthrough).
    InvokeError = 1,
    /// Pre-flight/connection failure: usage, config, connect, 1009/1011,
    /// subscribe.error, error frame.
    PreFlight = 2,
    /// TLS / WS upgrade failure.
    TlsUpgrade = 3,
    /// auth.error before auth.ok (close 1008).
    Auth = 4,
    /// Interrupted (Ctrl-C/SIGTERM).
    Interrupted = 5,
}

// CID:errors-001 - ExitCode::as_u8
// Purpose: numeric form for std::process::ExitCode.
impl ExitCode {
    pub fn as_u8(self) -> u8 {
        self as u8
    }
}
