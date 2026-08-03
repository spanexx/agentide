//! Dev-only scripted W4 wire server: drives the real `platform` binary by
//! hand (`cargo run --example mock_wire`), used for the Phase 5 manual smoke
//! and audit round-1 verification. Committed on purpose — it is the e2e
//! evidence for the IMPL verify boxes. NOT part of the shipped binary.

use std::net::TcpListener;

use serde_json::{json, Value};
use tungstenite::Message;

fn main() {
    let listener = TcpListener::bind("127.0.0.1:7300").expect("bind 7300");
    eprintln!("mock listening on ws://127.0.0.1:7300/ws");
    for stream in listener.incoming() {
        let Ok(mut ws) = tungstenite::accept(stream.unwrap()) else {
            continue;
        };
        loop {
            let msg = match ws.read() {
                Ok(m) => m,
                Err(_) => break, // CLI exits without close handshake → reset
            };
            if let Message::Text(t) = msg {
                let v: Value = serde_json::from_str(&t).unwrap();
                eprintln!("<- {t}");
                let reply = match v["type"].as_str() {
                    Some("auth") => json!({"type": "auth.ok"}),
                    Some("invoke") => match v["name"].as_str() {
                        Some("capability.list") => json!({
                            "type": "invoke.result",
                            "correlationId": v["correlationId"],
                            "output": [
                                {"name": "session", "version": "1.0.0", "tier": "core"},
                                {"name": "plugin", "version": "2.1.0", "tier": "core"}
                            ]
                        }),
                        Some("session.list") => json!({
                            "type": "invoke.result",
                            "correlationId": v["correlationId"],
                            "output": [
                                {"id": "s-1", "status": "active", "createdAt": 1700000000000_u64},
                                {"id": "s-2", "status": "archived", "createdAt": 1699900000000_u64}
                            ]
                        }),
                        Some("gateway.status") => json!({
                            "type": "invoke.result",
                            "correlationId": v["correlationId"],
                            "output": {"status": "ok", "uptime_s": 42}
                        }),
                        Some("system.health") => json!({
                            "type": "invoke.result",
                            "correlationId": v["correlationId"],
                            "output": {"healthy": true, "checks": 3}
                        }),
                        Some("deny.me") => json!({
                            "type": "invoke.error",
                            "correlationId": v["correlationId"],
                            "code": "GATEWAY_INSUFFICIENT_SCOPE",
                            "message": "scope missing"
                        }),
                        Some(other) => json!({
                            "type": "invoke.result",
                            "correlationId": v["correlationId"],
                            "output": {"echo": other, "input": v.get("input")}
                        }),
                        None => {
                            json!({"type": "error", "code": "WS_INTERNAL", "message": "invoke without name"})
                        }
                    },
                    Some("subscribe") => json!({
                        "type": "subscribe.ok",
                        "topics": v["topics"]
                    }),
                    Some("unsubscribe") => json!({
                        "type": "unsubscribe.ok",
                        "topics": v["topics"]
                    }),
                    _ => {
                        json!({"type": "error", "code": "WS_INVALID_FRAME", "message": "unknown frame type"})
                    }
                };
                let text = reply.to_string();
                eprintln!("-> {text}");
                ws.send(Message::Text(text.into())).unwrap();
            }
        }
    }
}
