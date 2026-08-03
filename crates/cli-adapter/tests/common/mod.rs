//! Shared scripted mock WS server for integration tests (W4 wire).
//!
//! The mock speaks the locked W4 wire: flat JSON text frames, `{type:...}`
//! envelope, invoke/result/error/auth/subscribe/event frames.

/*
 * Code Map: mock WS server
 * - MockServer: TcpListener + tungstenite::accept, scripted handler
 * - Script: match incoming `type` (+ optional exact frame), reply
 * - tail: frames pushed unprompted AFTER the script (watch event streams)
 *
 * CID Index:
 * CID:mock-001 -> MockServer::spawn
 * CID:mock-002 -> MockServer::spawn_with_tail
 * CID:mock-003 -> Reply
 *
 * Quick lookup: rg -n "CID:mock-" crates/cli-adapter/tests/common/mod.rs
 */

use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;

use serde_json::Value;
use tungstenite::Message;

/// Scripted reply to a client frame.
// Variants are used selectively per test binary — silence unused-variant
// warnings in binaries that don't exercise close semantics.
#[derive(Clone)]
#[allow(dead_code)]
pub enum Reply {
    Text(Value),
    Close(u16, &'static str),
}

/// One script entry: match incoming frame, optionally assert the exact
/// frame, then reply.
#[derive(Clone)]
pub struct Script {
    pub expect_type: &'static str,
    /// Exact-frame assertion (e.g. subscribe topics). `None` = type only.
    pub expect_frame: Option<Value>,
    pub reply: Reply,
}

// CID:mock-001 - MockServer::spawn
// Purpose: scripted W4 wire server; asserts frame `type` order.
pub struct MockServer {
    url: String,
    _thread: thread::JoinHandle<()>,
    _seen: Arc<AtomicUsize>,
}

impl MockServer {
    pub fn spawn(script: Vec<Script>) -> Self {
        Self::spawn_with_tail(script, vec![])
    }

    // CID:mock-002 - MockServer::spawn_with_tail
    // Purpose: after the scripted exchange, push `tail` frames unprompted
    // (event streams, stats), then drain until the client disconnects.
    pub fn spawn_with_tail(script: Vec<Script>, tail: Vec<Value>) -> Self {
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
                    if let Some(expected) = step.expect_frame {
                        assert_eq!(v, expected, "frame body mismatch");
                    }
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
            for frame in &tail {
                ws.send(Message::Text(frame.to_string().into())).unwrap();
            }
            // Drain until the client hangs up (watch loop exits). Only when
            // tail frames were sent — otherwise the scripted exchange alone
            // determines when the thread ends.
            if !tail.is_empty() {
                let _ = ws.read();
            }
        });
        MockServer {
            url,
            _thread: handle,
            _seen: seen,
        }
    }

    pub fn url(&self) -> String {
        self.url.clone()
    }

    /// Join the handler thread so panics (frame mismatch) surface in the test.
    pub fn join(self) {
        let _ = self._thread.join();
    }
}
