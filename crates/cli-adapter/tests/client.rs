//! Integration tests — wire client against a scripted mock WS server (W4).
//!
//! The mock speaks the locked W4 wire: flat JSON text frames, `{type:...}`
//! envelope, invoke/result/error/auth frames.

/*
 * Code Map: wire client scenarios
 * (MockServer lives in tests/common/mod.rs — shared with watch tests)
 *
 * CID Index:
 * CID:client-test-001 -> scenario_auth_ok_result
 * CID:client-test-002 -> scenario_auth_error
 * CID:client-test-003 -> scenario_invoke_error
 * CID:client-test-004 -> scenario_close_1009
 * CID:client-test-005 -> scenario_connect_refused
 *
 * Quick lookup: rg -n "CID:client-test-" crates/cli-adapter/tests/client.rs
 */

mod common;

use std::net::TcpListener;
use std::thread;

use cli_adapter::client::{ClientError, InvokeOutcome, WireClient};
use cli_adapter::errors::ExitCode;
use common::{MockServer, Reply, Script};
use serde_json::json;

/// Script shorthand: type-only match.
fn step(expect_type: &'static str, reply: Reply) -> Script {
    Script {
        expect_type,
        expect_frame: None,
        reply,
    }
}

/// Connect expecting failure — avoids `Debug` bound on `WireClient`.
fn connect_err(url: &str, token: &str) -> ClientError {
    match WireClient::connect(url, token) {
        Ok(_) => panic!("expected connect failure"),
        Err(e) => e,
    }
}

// CID:client-test-001 - scenario_auth_ok_result
// Purpose: happy path — auth.ok then invoke.result → ExitCode::InvokeResult.
// W4 lock: `invoke.result` carries `output`, not `result`.
#[test]
fn scenario_auth_ok_result() {
    let server = MockServer::spawn(vec![
        step("auth", Reply::Text(json!({"type": "auth.ok"}))),
        step(
            "invoke",
            Reply::Text(json!({
                "type": "invoke.result",
                "correlationId": "1",
                "output": {"ok": true}
            })),
        ),
    ]);
    let mut client = WireClient::connect(&server.url(), "tok").unwrap();
    let outcome = client.invoke("capability.list", None, None).unwrap();
    assert_eq!(outcome.exit_code(), ExitCode::InvokeResult);
    assert_eq!(outcome.as_result()["ok"], true);
    server.join();
}

// CID:client-test-003 - scenario_auth_error
// Purpose: auth.error before auth.ok → ExitCode::Auth.
#[test]
fn scenario_auth_error() {
    let server = MockServer::spawn(vec![step(
        "auth",
        Reply::Text(json!({
            "type": "auth.error",
            "code": "token invalid",
            "message": "bad token"
        })),
    )]);
    let err = connect_err(&server.url(), "bad");
    assert_eq!(err.exit_code(), ExitCode::Auth);
    if let ClientError::Auth { code, .. } = err {
        assert_eq!(code, "token invalid");
    } else {
        panic!("expected Auth error, got {err:?}");
    }
    server.join();
}

// CID:client-test-004 - scenario_invoke_error
// Purpose: invoke.error passthrough → ExitCode::InvokeError.
#[test]
fn scenario_invoke_error() {
    let server = MockServer::spawn(vec![
        step("auth", Reply::Text(json!({"type": "auth.ok"}))),
        step(
            "invoke",
            Reply::Text(json!({
                "type": "invoke.error",
                "correlationId": "1",
                "code": "GATEWAY_INSUFFICIENT_SCOPE",
                "message": "scope missing"
            })),
        ),
    ]);
    let mut client = WireClient::connect(&server.url(), "tok").unwrap();
    let outcome = client.invoke("session.create", None, None).unwrap();
    assert_eq!(outcome.exit_code(), ExitCode::InvokeError);
    if let InvokeOutcome::Error { code, .. } = outcome {
        assert_eq!(code, "GATEWAY_INSUFFICIENT_SCOPE");
    } else {
        panic!("expected Error outcome, got {outcome:?}");
    }
    server.join();
}

// CID:client-test-005 - scenario_close_1009
// Purpose: close 1009 (frame too large) → ExitCode::PreFlight.
#[test]
fn scenario_close_1009() {
    let server = MockServer::spawn(vec![
        step("auth", Reply::Text(json!({"type": "auth.ok"}))),
        step("invoke", Reply::Close(1009, "frame too large")),
    ]);
    let mut client = WireClient::connect(&server.url(), "tok").unwrap();
    let err = client.invoke("capability.list", None, None).unwrap_err();
    assert_eq!(err.exit_code(), ExitCode::PreFlight);
    server.join();
}

/// Connection refused → PreFlight (2). No server spawned.
#[test]
fn scenario_connect_refused() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let url = format!("ws://127.0.0.1:{port}/ws");
    let err = connect_err(&url, "tok");
    assert_eq!(err.exit_code(), ExitCode::PreFlight);
}

/// Frame-level `error` frame → PreFlight (2).
#[test]
fn scenario_error_frame() {
    let server = MockServer::spawn(vec![
        step("auth", Reply::Text(json!({"type": "auth.ok"}))),
        step(
            "invoke",
            Reply::Text(json!({
                "type": "error",
                "code": "GATEWAY_BUSY",
                "message": "busy"
            })),
        ),
    ]);
    let mut client = WireClient::connect(&server.url(), "tok").unwrap();
    let err = client.invoke("gateway.status", None, None).unwrap_err();
    assert_eq!(err.exit_code(), ExitCode::PreFlight);
    server.join();
}

/// TCP accepts but never upgrades — tungstenite handshake error → PreFlight (2).
#[test]
fn scenario_no_upgrade() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let url = format!("ws://127.0.0.1:{port}/ws");
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        use std::io::Write;
        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
        let _ = stream.flush();
    });
    let err = connect_err(&url, "tok");
    handle.join().unwrap();
    assert_eq!(err.exit_code(), ExitCode::PreFlight);
}

/// Close 1008 during auth → PRD S5 / GRILL Q4: `auth.error` before `auth.ok`,
/// exit 4. The close is the server's way of rejecting the handshake (the
/// `auth.error` frame may or may not arrive first; either way, exit 4).
#[test]
fn scenario_close_during_auth() {
    let server = MockServer::spawn(vec![step("auth", Reply::Close(1008, "policy"))]);
    let err = connect_err(&server.url(), "tok");
    assert_eq!(err.exit_code(), ExitCode::Auth);
    if let ClientError::Auth { code, .. } = err {
        assert_eq!(code, "policy");
    } else {
        panic!("expected Auth error, got {err:?}");
    }
    server.join();
}

/// Close 1009 during invoke → pre-flight/connection (PRD S5), exit 2.
#[test]
fn scenario_close_during_invoke_1009() {
    let server = MockServer::spawn(vec![
        step("auth", Reply::Text(json!({"type": "auth.ok"}))),
        step("invoke", Reply::Close(1009, "frame too large")),
    ]);
    let mut client = WireClient::connect(&server.url(), "tok").unwrap();
    let err = client.invoke("cap.x", None, None).unwrap_err();
    assert_eq!(err.exit_code(), ExitCode::PreFlight);
    server.join();
}

/// Close 1011 during invoke → pre-flight/connection (PRD S5), exit 2.
#[test]
fn scenario_close_during_invoke_1011() {
    let server = MockServer::spawn(vec![
        step("auth", Reply::Text(json!({"type": "auth.ok"}))),
        step("invoke", Reply::Close(1011, "heartbeat timeout")),
    ]);
    let mut client = WireClient::connect(&server.url(), "tok").unwrap();
    let err = client.invoke("cap.x", None, None).unwrap_err();
    assert_eq!(err.exit_code(), ExitCode::PreFlight);
    server.join();
}

/// `wss://` to a plain-TCP listener → TLS handshake failure → exit 3 (PRD S5).
#[test]
fn scenario_wss_tls_failure() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let url = format!("wss://127.0.0.1:{port}/ws");
    let handle = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        use std::io::Write;
        // Plain HTTP response — TLS handshake will reject it.
        let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
        let _ = stream.flush();
        // Keep the listener alive so the client's reachability probe (which
        // re-connects to decide transport-vs-TLS) deterministically succeeds.
        std::thread::sleep(std::time::Duration::from_millis(300));
    });
    let err = connect_err(&url, "tok");
    handle.join().unwrap();
    assert_eq!(err.exit_code(), ExitCode::TlsUpgrade);
    if let ClientError::Tls(_) = err {
        // expected
    } else {
        panic!("expected Tls error");
    }
}

/// `wss://` to a dead port → connection refused is a *transport* failure,
/// not a TLS failure → exit 2, not 3 (PRD S5: 3 = TLS-layer only).
#[test]
fn scenario_wss_connect_refused_is_preflight() {
    // Bind then drop: port is free but nothing listens on it.
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let url = format!("wss://127.0.0.1:{port}/ws");
    let err = connect_err(&url, "tok");
    assert_eq!(err.exit_code(), ExitCode::PreFlight);
    if let ClientError::Handshake(_) = err {
        // expected
    } else {
        panic!("expected Handshake error, got {err:?}");
    }
}
