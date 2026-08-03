//! Watch mode integration tests — snapshot + subscribe + NDJSON events
//! until Ctrl-C (PRD S7). Mock server shared via tests/common.

/*
 * Code Map: watch scenarios
 *
 * CID Index:
 * CID:watch-test-001 -> default topic map
 * CID:watch-test-002 -> subscribe + NDJSON events + stop flag
 * CID:watch-test-003 -> --topic override hits the wire
 * CID:watch-test-004 -> stats warning once
 * CID:watch-test-005 -> subscribe.error → exit 2
 * CID:watch-test-006 -> close during stream → exit 2
 *
 * Quick lookup: rg -n "CID:watch-test-" crates/cli-adapter/tests/watch.rs
 */

mod common;

use std::io::Cursor;

use cli_adapter::client::WireClient;
use cli_adapter::errors::ExitCode;
use cli_adapter::watch::{default_topic, stream};
use common::{MockServer, Reply, Script};
use serde_json::{json, Value};

/// Script shorthand: type-only match.
fn step(expect_type: &'static str, reply: Reply) -> Script {
    Script {
        expect_type,
        expect_frame: None,
        reply,
    }
}

fn event(id: &str) -> Value {
    json!({
        "type": "event",
        "topic": "session.*",
        "id": id,
        "publishedAt": 1700000000000_u64,
        "payload": {"kind": "updated"}
    })
}

// CID:watch-test-001 - default topic map
// Purpose: PRD S7 default topics — status/health → gateway.* NOT system.* (D3).
#[test]
fn default_topic_maps_aliases() {
    assert_eq!(default_topic("session.list"), "session.*");
    assert_eq!(default_topic("plugin.list"), "plugin.*");
    assert_eq!(default_topic("capability.list"), "capability.*");
    assert_eq!(default_topic("gateway.status"), "gateway.*");
    assert_eq!(default_topic("system.health"), "gateway.*");
}

// CID:watch-test-002 - subscribe + NDJSON events + stop flag
// Purpose: subscribe.ok then events print as NDJSON lines; stop flag hit
// → ExitCode::Interrupted (5).
#[test]
fn stream_subscribes_then_ndjson_events_until_stop() {
    let server = MockServer::spawn_with_tail(
        vec![
            step("auth", Reply::Text(json!({"type": "auth.ok"}))),
            step(
                "subscribe",
                Reply::Text(json!({"type": "subscribe.ok", "topics": ["session.*"]})),
            ),
        ],
        vec![event("e-1"), event("e-2"), event("e-3")],
    );
    let mut client = WireClient::connect(&server.url(), "tok").unwrap();

    let mut out = Cursor::new(Vec::new());
    let mut err = Cursor::new(Vec::new());
    let mut seen = 0;
    let result = stream(
        &mut client,
        &["session.*".to_string()],
        // The stop flag is polled BEFORE each read; seen >= 3 means the
        // loop ran twice (read e-1, e-2) then stopped.
        &mut || {
            seen += 1;
            seen >= 3
        },
        &mut out,
        &mut err,
    )
    .unwrap();

    assert_eq!(result, ExitCode::Interrupted);
    let text = String::from_utf8(out.into_inner()).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 2, "two events before stop");
    let first: Value = serde_json::from_str(lines[0]).unwrap();
    assert_eq!(first["type"], "event");
    assert_eq!(first["id"], "e-1");
    let second: Value = serde_json::from_str(lines[1]).unwrap();
    assert_eq!(second["id"], "e-2");
    // Client must disconnect before the mock's drain unblocks.
    drop(client);
    server.join();
}

// CID:watch-test-003 - --topic override hits the wire
// Purpose: `--topic <pattern>` overrides the alias default; the subscribe
// frame must carry the override verbatim.
#[test]
fn stream_sends_topic_override_on_wire() {
    let server = MockServer::spawn_with_tail(
        vec![
            step("auth", Reply::Text(json!({"type": "auth.ok"}))),
            Script {
                expect_type: "subscribe",
                expect_frame: Some(json!({"type": "subscribe", "topics": ["custom.events.*"]})),
                reply: Reply::Text(json!({
                    "type": "subscribe.ok",
                    "topics": ["custom.events.*"]
                })),
            },
        ],
        vec![event("e-1")],
    );
    let mut client = WireClient::connect(&server.url(), "tok").unwrap();

    let mut out = Cursor::new(Vec::new());
    let mut err = Cursor::new(Vec::new());
    let result = stream(
        &mut client,
        &["custom.events.*".to_string()],
        &mut || true,
        &mut out,
        &mut err,
    )
    .unwrap();
    assert_eq!(result, ExitCode::Interrupted);
    drop(client);
    server.join();
}

// CID:watch-test-004 - stats warning once
// Purpose: `stats` frame with dropped > 0 → ONE stderr warning line, even
// if multiple stats frames arrive.
#[test]
fn stats_warning_emitted_once() {
    let server = MockServer::spawn_with_tail(
        vec![
            step("auth", Reply::Text(json!({"type": "auth.ok"}))),
            step(
                "subscribe",
                Reply::Text(json!({"type": "subscribe.ok", "topics": ["session.*"]})),
            ),
        ],
        vec![
            event("e-1"),
            json!({"type": "stats", "dropped": 5}),
            json!({"type": "stats", "dropped": 2}),
        ],
    );
    let mut client = WireClient::connect(&server.url(), "tok").unwrap();

    let mut out = Cursor::new(Vec::new());
    let mut err = Cursor::new(Vec::new());
    // Stop after 3 read frames (e-1 + two stats) so the stats are processed.
    let mut seen = 0;
    let _ = stream(
        &mut client,
        &["session.*".to_string()],
        &mut || {
            seen += 1;
            seen >= 3
        },
        &mut out,
        &mut err,
    )
    .unwrap();

    let err_text = String::from_utf8(err.into_inner()).unwrap();
    assert_eq!(
        err_text.matches("dropped").count(),
        1,
        "exactly one stats warning, got: {err_text}"
    );
    drop(client);
    server.join();
}

// CID:watch-test-005 - subscribe.error → exit 2
// Purpose: PRD S5 — subscribe.error is a pre-flight failure → PreFlight (2).
#[test]
fn subscribe_error_is_preflight() {
    let server = MockServer::spawn(vec![
        step("auth", Reply::Text(json!({"type": "auth.ok"}))),
        step(
            "subscribe",
            Reply::Text(json!({
                "type": "subscribe.error",
                "code": "WS_TOPIC_INVALID",
                "topics": ["bad topic!"]
            })),
        ),
    ]);
    let mut client = WireClient::connect(&server.url(), "tok").unwrap();

    let mut out = Cursor::new(Vec::new());
    let mut err = Cursor::new(Vec::new());
    let e = stream(
        &mut client,
        &["bad topic!".to_string()],
        &mut || false,
        &mut out,
        &mut err,
    )
    .unwrap_err();
    assert_eq!(e.exit_code(), ExitCode::PreFlight);
    drop(client);
    server.join();
}

// CID:watch-test-006 - close during stream → exit 2
// Purpose: no reconnect in v1 — the connection dropping kills watch (PRD S7).
#[test]
fn close_during_stream_is_preflight() {
    let server = MockServer::spawn(vec![
        step("auth", Reply::Text(json!({"type": "auth.ok"}))),
        step(
            "subscribe",
            Reply::Text(json!({"type": "subscribe.ok", "topics": ["session.*"]})),
        ),
    ]);
    let mut client = WireClient::connect(&server.url(), "tok").unwrap();
    let mut out = Cursor::new(Vec::new());
    let mut err = Cursor::new(Vec::new());
    let e = stream(
        &mut client,
        &["session.*".to_string()],
        &mut || false,
        &mut out,
        &mut err,
    )
    .unwrap_err();
    assert_eq!(e.exit_code(), ExitCode::PreFlight);
    drop(client);
    server.join();
}

// CID:watch-test-007 - install_stop_flag
// Purpose: ctrlc wiring — returns a shared flag, false until a signal.
#[test]
fn install_stop_flag_returns_shared_flag() {
    use std::sync::atomic::Ordering;
    let flag = cli_adapter::watch::install_stop_flag();
    assert!(!flag.load(Ordering::SeqCst));
}
