//! Watch mode — snapshot + subscribe + NDJSON events until Ctrl-C (PRD S7).
//!
//! Flow: main() renders the snapshot via the normal TTY/`--json` path, then
//! calls [`stream`] with the subscribed topics. Events print as one JSON
//! object per line (NDJSON, flushed per line — IMPL line 220). A `stats`
//! frame with `dropped > 0` warns once on stderr. Ctrl-C or SIGTERM sets the
//! stop flag → [`ExitCode::Interrupted`]. No reconnect in v1 — a dropped
//! connection ends watch with exit 2.

/*
 * Code Map: watch mode
 * - default_topic: alias → default subscribe topic (PRD S7)
 * - stream: subscribe.ok gate, NDJSON event loop, stats warning, stop flag
 * - install_stop_flag: ctrlc/SIGTERM → shared AtomicBool (once per process)
 *
 * CID Index:
 * CID:watch-001 -> default_topic
 * CID:watch-002 -> stream
 * CID:watch-003 -> install_stop_flag
 * CID:watch-004 -> run
 *
 * Quick lookup: rg -n "CID:watch-" crates/cli-adapter/src/watch.rs
 */

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;

use crate::client::{ClientError, InvokeOutcome, WireClient};
use crate::errors::ExitCode;
use crate::output::{render, stdout_is_tty, view_for, Entry};

// CID:watch-001 - default_topic
// Purpose: PRD S7 default subscribe topic per alias; status/health both
// subscribe `gateway.*` (NOT `system.*` — no producers exist there, D3).
pub fn default_topic(capability: &str) -> &'static str {
    match capability {
        "session.list" => "session.*",
        "plugin.list" => "plugin.*",
        "capability.list" => "capability.*",
        _ => "gateway.*", // gateway.status, system.health, anything unknown
    }
}

// CID:watch-004 - run
// Purpose: watch mode end-to-end on an authenticated client — snapshot
// invoke (normal TTY/`--json` shape), subscribe, then NDJSON events until
// Ctrl-C. Alias-only: main() guards `Entry::Invoke` before calling.
pub fn run(
    client: &mut WireClient,
    capability: &str,
    json: bool,
    topic: Option<&str>,
    input: Option<Value>,
    session: Option<&str>,
) -> ExitCode {
    // Snapshot: same shape as the non-watch path (PRD S7); events never
    // re-render it.
    match client.invoke(capability, input, session) {
        Ok(InvokeOutcome::Result(v)) => {
            let tty = stdout_is_tty() && !json;
            print!("{}", render(view_for(capability, Entry::Alias), &v, tty));
        }
        Ok(InvokeOutcome::Error { code, message }) => {
            eprintln!("error: {code} — {message}");
            return ExitCode::InvokeError;
        }
        Err(e) => {
            eprintln!("error: {e}");
            return e.exit_code();
        }
    }

    let topics = vec![topic
        .unwrap_or_else(|| default_topic(capability))
        .to_string()];
    let flag = install_stop_flag();
    let mut stop = move || flag.load(Ordering::SeqCst);
    let mut out = std::io::stdout();
    let mut err = std::io::stderr();
    match stream(client, &topics, &mut stop, &mut out, &mut err) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("error: {e}");
            e.exit_code()
        }
    }
}

// CID:watch-002 - stream
// Purpose: gate on subscribe.ok, then print events as NDJSON (flush per
// line), warn once on `stats` dropped > 0, exit 5 when `stop()` turns true.
pub fn stream(
    client: &mut WireClient,
    topics: &[String],
    stop: &mut dyn FnMut() -> bool,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> Result<ExitCode, ClientError> {
    client.subscribe(topics)?;
    let mut warned = false;
    loop {
        if stop() {
            return Ok(ExitCode::Interrupted);
        }
        match client.try_read_frame() {
            Ok(None) => continue,
            Ok(Some(frame)) => {
                let kind = frame["type"].as_str().unwrap_or("");
                match kind {
                    "event" => {
                        // NDJSON: one object per line, flushed (IMPL line 220).
                        let _ = writeln!(out, "{}", serde_json::to_string(&frame).unwrap());
                        let _ = out.flush();
                    }
                    "stats" => {
                        let dropped = frame["dropped"].as_u64().unwrap_or(0);
                        if dropped > 0 && !warned {
                            let _ = writeln!(
                                err,
                                "warning: gateway dropped {dropped} event(s) (slow consumer)"
                            );
                            let _ = err.flush();
                            warned = true;
                        }
                    }
                    _ => {
                        // `error` frame or unknown frame → connection-level
                        // problem; PRD S5 maps frame errors to PreFlight.
                        if kind == "error" {
                            return Err(ClientError::Wire(
                                format!(
                                    "{}: {}",
                                    frame["code"].as_str().unwrap_or("WS_ERROR"),
                                    frame["message"].as_str().unwrap_or("")
                                )
                                .trim_end()
                                .to_string(),
                            ));
                        }
                        // Unknown frame types (e.g. auth echo) are ignored.
                    }
                }
            }
            Err(e) => return Err(e),
        }
    }
}

// CID:watch-003 - install_stop_flag
// Purpose: register the process-wide ctrlc/SIGTERM handler once; returns the
// shared flag `stream`'s `stop()` closure reads. Ignore a second-install
// error — tests may already have a handler.
pub fn install_stop_flag() -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    let f = flag.clone();
    let _ = ctrlc::set_handler(move || {
        f.store(true, Ordering::SeqCst);
    });
    flag
}
