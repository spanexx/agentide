//! Throwaway manual-test mock: scripted W4 wire server for driving the real
//! `platform` binary by hand. Not shipped — dev-only verification aid.

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
                            "result": [
                                {"name": "session", "version": "1.0.0", "tier": "core"},
                                {"name": "plugin", "version": "2.1.0", "tier": "core"}
                            ]
                        }),
                        Some("session.list") => json!({
                            "type": "invoke.result",
                            "correlationId": v["correlationId"],
                            "result": [
                                {"id": "s-1", "status": "active", "created": "2025-07-30"},
                                {"id": "s-2", "status": "closed", "created": "2025-07-29"}
                            ]
                        }),
                        Some("gateway.status") => json!({
                            "type": "invoke.result",
                            "correlationId": v["correlationId"],
                            "result": {"status": "ok", "uptime_s": 42}
                        }),
                        Some("system.health") => json!({
                            "type": "invoke.result",
                            "correlationId": v["correlationId"],
                            "result": {"healthy": true, "checks": 3}
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
                            "result": {"echo": other, "input": v.get("input")}
                        }),
                        None => json!({"type": "error", "code": "GATEWAY_BUSY", "message": "busy"}),
                    },
                    Some("subscribe") => json!({
                        "type": "subscribe.result",
                        "correlationId": v["correlationId"],
                        "topic": v.get("topic")
                    }),
                    _ => {
                        json!({"type": "error", "code": "GATEWAY_UNKNOWN_FRAME", "message": "huh"})
                    }
                };
                let text = reply.to_string();
                eprintln!("-> {text}");
                ws.send(Message::Text(text.into())).unwrap();
            }
        }
    }
}
