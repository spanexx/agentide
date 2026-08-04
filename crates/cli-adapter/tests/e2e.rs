//! Process-level end-to-end tests: spawn `platform` against
//! `examples/mock_wire.rs` on loopback. Real binary, real
//! subprocess, real TCP loopback — proves the CLI can drive
//! the W4 wire and exit with the codes PRD S5 mandates.

/*
 * Code Map: process-level e2e
 * - Mock: thread that runs `target/debug/examples/mock_wire` on a
 *   free port — the binary IS the same one a developer uses for
 *   manual Phase 5 smoke (committed on purpose, see mock_wire.rs).
 * - Command::spawn platform binary, assert stdout + exit code.
 *
 * Why two binaries (not just the existing MockServer harness):
 * the unit tests in tests/client.rs use an in-process tungstenite
 * peer. These tests prove the *binary* wires up correctly:
 * arg parsing, output formatting, signal handling, exit codes.
 *
 * CID Index:
 * CID:e2e-001 -> mock_wire::spawn
 * CID:e2e-002 -> cmd::invoke_ok_exit_0
 * CID:e2e-003 -> cmd::invoke_error_exit_1
 * CID:e2e-004 -> cmd::auth_error_exit_4
 * CID:e2e-005 -> cmd::json_flag_emits_json
 * CID:e2e-006 -> cmd::usage_exit_2
 * CID:e2e-007 -> cmd::unknown_subcommand_exit_2
 * CID:e2e-008 -> cmd::watch_streams_then_sigint_exit_5
 *
 * Quick lookup: rg -n "CID:e2e-" crates/cli-adapter/tests/e2e.rs
 */

use std::io::{BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

/// MOCK_WIRE_URL — the committed `mock_wire` example hard-codes
/// `127.0.0.1:7300`. All e2e tests share this port; the global
/// MOCK_LOCK below serialises them so they never race.
const MOCK_WIRE_URL: &str = "ws://127.0.0.1:7300/ws";

/// Process-wide mutex — cargo test runs tests in parallel by
/// default; mock_wire is single-instance on port 7300 so we
/// serialise Mock lifecycle (spawn ↔ drop).
static MOCK_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Wraps the in-tree `mock_wire` example as a subprocess on its
/// hard-coded port. Returns a guard that KILLs the child on drop.
struct Mock {
    // _guard last so its drop (which releases the mutex) runs
    // AFTER child is torn down. Rust drops fields in DECLARATION
    // order (not reversed) — the comment earlier in this file
    // was wrong about that, but the field order below is right:
    // child drops first (kill+wait), then _guard releases the lock.
    child: Option<Child>,
    _guard: Option<Box<std::sync::MutexGuard<'static, ()>>>,
}

// CID:e2e-001 - Mock::spawn
// Purpose: launch mock_wire, gate on a TCP-connect probe to
// 127.0.0.1:7300, and hold MOCK_LOCK for the duration of the
// test so port 7300 stays single-tenant.
// for the lifetime of the Mock — serialises e2e tests.
impl Mock {
    fn spawn() -> Self {
        let lock = MOCK_LOCK.get_or_init(|| Mutex::new(()));
        // Recover from a prior panic that left the mutex poisoned —
        // we want each test to start clean, not all subsequent tests
        // to fail with PoisonError.
        let guard = lock.lock().unwrap_or_else(|e| e.into_inner());

        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let example_bin = format!("{}/target/debug/examples/mock_wire", manifest_dir);

        // Stdio::null() (not piped): piping stderr and dropping the
        // reader thread closes the pipe; mock_wire then SIGPIPEs
        // when it eprintlns after a client connect. We don't need
        // the logs — gate readiness on a successful TCP-connect probe
        // to localhost:7300 (mock_wire binds before accept()).
        let mut child = Command::new(&example_bin)
            .env("RUST_BACKTRACE", "0")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("failed to launch mock_wire example");

        // Readiness probe: try connect(127.0.0.1:7300) up to N times.
        // mock_wire does `bind()` BEFORE `accept()`, so connect
        // succeeding == socket is bound; the platform client then
        // gets a SYN-ACK promptly.
        let ready = {
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            let mut ok = false;
            while std::time::Instant::now() < deadline {
                if std::net::TcpStream::connect_timeout(
                    &"127.0.0.1:7300".parse().unwrap(),
                    Duration::from_millis(200),
                )
                .is_ok()
                {
                    ok = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            ok
        };
        if !ready {
            let _ = child.kill();
            panic!("mock_wire did not bind 127.0.0.1:7300 within 5s");
        }

        Mock {
            child: Some(child),
            _guard: Some(Box::new(guard)),
        }
    }

    fn url(&self) -> String {
        MOCK_WIRE_URL.to_string()
    }
}

impl Drop for Mock {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }

        // _guard drops after child: declaration-order drop
        // means the lock is released only after the child is dead,
        // so the next test's Mock::spawn can bind 127.0.0.1:7300
        // cleanly.
    }
}

/// Run the platform binary with the given argv, return (exit, stdout).
fn run_platform(args: &[&str]) -> (i32, String, String) {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let bin = format!("{}/target/debug/platform", manifest_dir);
    let output = Command::new(&bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("failed to launch platform binary");
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    eprintln!(
        "[test] args={:?} exit={} stderr={:?}",
        args,
        output.status.code().unwrap_or(-1),
        stderr
    );
    let code = output.status.code().unwrap_or(-1);
    (code, stdout, stderr)
}

/// As `run_platform` but waits up to `timeout` for the child, then
/// kills it. Used for `--watch` (which otherwise runs forever).
fn run_platform_with_timeout(args: &[&str], timeout: Duration) -> (Option<i32>, String, String) {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let bin = format!("{}/target/debug/platform", manifest_dir);
    let mut child = Command::new(&bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to launch platform binary");

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let stdout_handle = thread::spawn(move || {
        let mut s = String::new();
        let mut r = BufReader::new(stdout);
        r.read_to_string(&mut s).ok();
        s
    });
    let stderr_handle = thread::spawn(move || {
        let mut s = String::new();
        let mut r = BufReader::new(stderr);
        r.read_to_string(&mut s).ok();
        s
    });

    // Poll exit with timeout
    let start = std::time::Instant::now();
    let exit = loop {
        match child.try_wait().expect("try_wait") {
            Some(s) => break Some(s.code().unwrap_or(-1)),
            None => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
    };

    let stdout = stdout_handle.join().unwrap_or_default();
    let stderr = stderr_handle.join().unwrap_or_default();
    (exit, stdout, stderr)
}

// CID:e2e-002 - scenario_invoke_ok_exit_0
// Purpose: PRD S5 — invoke.result → exit 0. Non-json mode prints
// the result payload as compact JSON on stdout.
#[test]
fn scenario_invoke_ok_exit_0() {
    let mock = Mock::spawn();
    let (code, stdout, _stderr) = run_platform(&[
        "--url",
        &mock.url(),
        "--token",
        "good-token",
        "invoke",
        "capability.list",
    ]);
    assert_eq!(code, 0, "happy path must exit 0");
    let parsed: serde_json::Value =
        serde_json::from_str(stdout.trim()).expect("stdout must be one JSON document");
    let arr = parsed
        .as_array()
        .expect("capability.list output should be an array");
    let names: Vec<&str> = arr.iter().filter_map(|c| c["name"].as_str()).collect();
    assert!(
        names.contains(&"session"),
        "session capability must be in output; got: {stdout}"
    );
    assert!(
        names.contains(&"plugin"),
        "plugin capability must be in output; got: {stdout}"
    );
}

// CID:e2e-003 - scenario_invoke_error_exit_1
// Purpose: PRD S5 — invoke.error → exit 1, code/message pass through.
// Non-json mode prints the error to stderr.
#[test]
fn scenario_invoke_error_exit_1() {
    let mock = Mock::spawn();
    let (code, _stdout, stderr) = run_platform(&[
        "--url",
        &mock.url(),
        "--token",
        "good-token",
        "invoke",
        "session.create",
    ]);
    assert_eq!(code, 1, "invoke.error must exit 1");
    assert!(
        stderr.contains("GATEWAY_INSUFFICIENT_SCOPE"),
        "stderr should contain gateway error code; got: {stderr}"
    );
}

// CID:e2e-004 - scenario_auth_error_exit_4
// Purpose: PRD S5 + GRILL Q4 — auth.error with token.bad → exit 4.
#[test]
fn scenario_auth_error_exit_4() {
    let mock = Mock::spawn();
    let (code, _stdout, stderr) = run_platform(&[
        "--url",
        &mock.url(),
        "--token",
        "token.bad",
        "invoke",
        "capability.list",
    ]);
    assert_eq!(code, 4, "auth.error must exit 4");
    assert!(
        stderr.contains("auth failed") || stderr.contains("WS_AUTH_FAILED"),
        "stderr should report auth failure; got: {stderr}"
    );
}

// CID:e2e-005 - scenario_json_flag_emits_json
// Purpose: --json produces a single JSON document on stdout with
// the capability's `output` payload under a known key.
#[test]
fn scenario_json_flag_emits_json() {
    let mock = Mock::spawn();
    let (code, stdout, _stderr) = run_platform(&[
        "--url",
        &mock.url(),
        "--token",
        "good-token",
        "--json",
        "invoke",
        "gateway.status",
    ]);
    assert_eq!(code, 0, "happy JSON path must exit 0");
    let parsed: serde_json::Value =
        serde_json::from_str(stdout.trim()).expect("stdout must be one JSON document");
    assert_eq!(
        parsed["status"], "ok",
        "json envelope should expose output.status"
    );
    assert!(
        parsed["uptime_s"].is_number(),
        "json envelope should expose output.uptime_s"
    );
}

// CID:e2e-006 - scenario_usage_exit_2
// Purpose: no subcommand → exit 2 (PreFlight), usage to stderr.
#[test]
fn scenario_usage_exit_2() {
    let mock = Mock::spawn();
    let (code, stdout, stderr) = run_platform(&[
        "--url",
        &mock.url(),
        "--token",
        "good-token",
        // no `invoke ...` — just flag the connection
    ]);
    assert_eq!(code, 2, "missing subcommand must exit 2");
    // Usage is printed to stderr (per main.rs); stdout should be empty.
    assert!(
        stdout.trim().is_empty(),
        "usage path: stdout should be empty"
    );
    assert!(
        !stderr.trim().is_empty(),
        "usage path: stderr should contain usage"
    );
    assert!(
        stderr.contains("USAGE") || stderr.contains("Usage") || stderr.contains("invoke"),
        "stderr should look like usage text; got: {stderr}"
    );
}

// CID:e2e-007 - scenario_unknown_subcommand_exit_2
// Purpose: unknown subcommand → exit 2, usage to stderr.
#[test]
fn scenario_unknown_subcommand_exit_2() {
    let mock = Mock::spawn();
    let (code, _stdout, stderr) = run_platform(&[
        "--url",
        &mock.url(),
        "--token",
        "good-token",
        "no.such.command",
    ]);
    assert_eq!(code, 2, "unknown subcommand must exit 2");
    assert!(
        !stderr.trim().is_empty(),
        "stderr should carry usage/diagnostic"
    );
}

// CID:e2e-008 - scenario_watch_streams_until_signal
// Purpose: --watch connects, subscribes, prints events as JSONL.
// We don't SIGTERM-send (signal delivery in tests is fragile);
// instead we let watch.run hit the connect_refused/timing path
// only if the server hangs up — and we kill the child after
// observing at least one event frame.
//
// PRD S7: --watch exits 5 on SIGINT/SIGTERM (layer: termination).
// We don't test that exit code here (signal handling is platform-
// dependent); we test that the stream actually flows.
#[test]
fn scenario_watch_streams_events() {
    let mock = Mock::spawn();
    let (exit, stdout, _stderr) = run_platform_with_timeout(
        &[
            "--url",
            &mock.url(),
            "--token",
            "good-token",
            "--json",
            "--watch",
            "capabilities", // alias → capability.list; watch requires alias (PRD S7)
        ],
        Duration::from_secs(3),
    );
    // The mock pushes `event` frames immediately after subscribe.ok.
    // If watch is wired correctly, those land as JSONL on stdout.
    let mut found_event = false;
    for line in stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if v["type"].as_str() == Some("event") {
            assert!(v["topic"].is_string(), "event.topic should be a string");
            assert!(
                v["payload"].is_object(),
                "event.payload should be an object"
            );
            found_event = true;
        }
        // `stats` (dropped-count) goes to stderr only when dropped > 0
        // (watch.rs). The mock pushes `dropped: 0`, so we don't assert
        // a stats line.
    }
    assert!(
        found_event,
        "expected at least one event frame in stdout; got:\n{stdout}"
    );
    // Either the timeout killed it (None) or it exited naturally;
    // both are acceptable. We do NOT assert the exit code here.
    let _ = exit;
}

// CID:e2e-009 - scenario_args_passthrough
// Purpose: --args JSON is forwarded verbatim into the invoke frame
// (IMPL §3.1 round-trip contract).
#[test]
fn scenario_args_passthrough() {
    let mock = Mock::spawn();
    // `echo` is the mock's catch-all that returns the input verbatim.
    let payload = r#"{"foo":"bar","n":42}"#;
    let (code, stdout, _stderr) = run_platform(&[
        "--url",
        &mock.url(),
        "--token",
        "good-token",
        "--json",
        "--args",
        payload,
        "invoke",
        "echo",
    ]);
    assert_eq!(code, 0, "happy echo path must exit 0");
    let parsed: serde_json::Value =
        serde_json::from_str(stdout.trim()).expect("stdout must be JSON");
    let echoed = &parsed["input"];
    assert_eq!(echoed["foo"], "bar", "--args object must round-trip");
    assert_eq!(echoed["n"], 42, "--args number must round-trip");
}

// CID:e2e-010 - scenario_session_id_on_wire
// Purpose: --session xyz puts `sessionId:xyz` on the invoke frame
// (mock_wire echoes the frame back via `echo` if we ask for that
// capability — but easier to assert via the CLI: the mock doesn't
// surface session binding, so we rely on the unit test for wire
// verification and here just verify --session doesn't crash).
#[test]
fn scenario_session_does_not_crash() {
    let mock = Mock::spawn();
    let (code, _stdout, _stderr) = run_platform(&[
        "--url",
        &mock.url(),
        "--token",
        "good-token",
        "--session",
        "sess-abc",
        "invoke",
        "capability.list",
    ]);
    // Happy path regardless of session binding behaviour on this mock.
    assert_eq!(
        code, 0,
        "--session should not change exit code on happy path"
    );
}
