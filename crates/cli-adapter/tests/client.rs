//! Integration tests — wire client against a scripted mock WS server (W4).
//!
//! The mock speaks the locked W4 wire: flat JSON text frames, `{type:...}`
//! envelope, invoke/result/error/auth frames.

/*
 * Code Map: mock WS server + client scenarios
 * - MockServer: TcpListener + tungstenite::accept, runs a scripted handler
 *
 * CID Index:
 * CID:client-test-001 -> MockServer
 * CID:client-test-002 -> scenario_auth_ok_result
 * CID:client-test-003 -> scenario_auth_error
 * CID:client-test-004 -> scenario_invoke_error
 * CID:client-test-005 -> scenario_close_1009
 *
 * Quick lookup: rg -n "CID:client-test-" crates/cli-adapter/tests/client.rs
 */

use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;

use cli_adapter::client::{ClientError, InvokeOutcome, WireClient};
use cli_adapter::errors::ExitCode;
use serde_json::{json, Value};
use tungstenite::Message;

/// Scripted reply to a client frame.
#[derive(Clone)]
enum Reply {
    Text(Value),
    Close(u16, &'static str),
}

/// One script entry: match incoming text's `type`, then reply.
#[derive(Clone)]
struct Script {
    expect_type: &'static str,
    reply: Reply,
}

// CID:client-test-001 - MockServer
// Purpose: scripted W4 wire server; asserts frame `type` order.
struct MockServer {
    url: String,
    _thread: thread::JoinHandle<()>,
    _seen: Arc<AtomicUsize>,
}

impl MockServer {
    fn spawn(script: Vec<Script>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let url = format!("ws://127.0.0.1:{port}/ws");
        let seen = Arc::new(AtomicUsize::new(0));
        let seen2 = seen.clone();
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut ws = tungstenite::accept(stream).unwrap();
            for step in script {
                let msg = ws.read().unwrap();
                if let Message::Text(t) = msg {
                    let v: Value = serde_json::from_str(&t).unwrap();
                    assert_eq!(v["type"], step.expect_type, "frame type mismatch");
                }
                seen2.fetch_add(1, Ordering::SeqCst);
                match step.reply {
                    Reply::Text(v) => {
                        ws.send(Message::Text(v.to_string().into())).unwrap();
                    }
                    Reply::Close(code, reason) => {
                        ws.close(Some(tungstenite::protocol::CloseFrame {
                            code: code.into(),
                            reason: reason.into(),
                        }))
                        .unwrap();
                    }
                }
            }
        });
        MockServer {
            url,
            _thread: handle,
            _seen: seen,
        }
    }

    fn url(&self) -> String {
        self.url.clone()
    }

    /// Join the handler thread so panics (frame mismatch) surface in the test.
    fn join(self) {
        let _ = self._thread.join();
    }
}

/// Connect expecting failure — avoids `Debug` bound on `WireClient`.
fn connect_err(url: &str, token: &str) -> ClientError {
    match WireClient::connect(url, token) {
        Ok(_) => panic!("expected connect failure"),
        Err(e) => e,
    }
}

// CID:client-test-002 - scenario_auth_ok_result
// Purpose: happy path — auth.ok then invoke.result → ExitCode::InvokeResult.
#[test]
fn scenario_auth_ok_result() {
    let server = MockServer::spawn(vec![
        Script {
            expect_type: "auth",
            reply: Reply::Text(json!({"type": "auth.ok"})),
        },
        Script {
            expect_type: "invoke",
            reply: Reply::Text(json!({
                "type": "invoke.result",
                "correlationId": "1",
                "result": {"ok": true}
            })),
        },
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
    let server = MockServer::spawn(vec![Script {
        expect_type: "auth",
        reply: Reply::Text(json!({
            "type": "auth.error",
            "code": "token invalid",
            "message": "bad token"
        })),
    }]);
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
        Script {
            expect_type: "auth",
            reply: Reply::Text(json!({"type": "auth.ok"})),
        },
        Script {
            expect_type: "invoke",
            reply: Reply::Text(json!({
                "type": "invoke.error",
                "correlationId": "1",
                "code": "GATEWAY_INSUFFICIENT_SCOPE",
                "message": "scope missing"
            })),
        },
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
        Script {
            expect_type: "auth",
            reply: Reply::Text(json!({"type": "auth.ok"})),
        },
        Script {
            expect_type: "invoke",
            reply: Reply::Close(1009, "frame too large"),
        },
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
        Script {
            expect_type: "auth",
            reply: Reply::Text(json!({"type": "auth.ok"})),
        },
        Script {
            expect_type: "invoke",
            reply: Reply::Text(json!({
                "type": "error",
                "code": "GATEWAY_BUSY",
                "message": "busy"
            })),
        },
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

/// Close frame during auth → not auth.error; exit 2 (no auth result yet).
#[test]
fn scenario_close_during_auth() {
    let server = MockServer::spawn(vec![Script {
        expect_type: "auth",
        reply: Reply::Close(1008, "policy"),
    }]);
    let err = connect_err(&server.url(), "tok");
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
