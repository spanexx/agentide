//! Wire client — connect/auth/invoke over the locked W4 websocket
//! (PRD S4, S5, S8).

/*
 * Code Map: W4 wire client
 * - WireClient: one connection — auth, then invoke frames with correlationId
 * - ClientError: layer failure enum mapped to exit codes
 * - InvokeOutcome: invoke.result vs invoke.error
 *
 * CID Index:
 * CID:client-001 -> WireClient::connect
 * CID:client-002 -> WireClient::invoke
 * CID:client-003 -> InvokeOutcome::exit_code
 * CID:client-004 -> ClientError::exit_code
 *
 * Quick lookup: rg -n "CID:client-" crates/cli-adapter/src/client.rs
 */

use std::net::TcpStream;

use serde_json::{json, Value};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{connect, Message, WebSocket};

use crate::errors::ExitCode;

/// Outcome of a single invoke (PRD S4).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InvokeOutcome {
    /// `invoke.result` — the capability's result payload.
    Result(Value),
    /// `invoke.error` — code + message passed through verbatim.
    Error { code: String, message: String },
}

// CID:client-003 - InvokeOutcome::exit_code
// Purpose: PRD S5 mapping — result → 0, error → 1.
impl InvokeOutcome {
    pub fn exit_code(&self) -> ExitCode {
        match self {
            InvokeOutcome::Result(_) => ExitCode::InvokeResult,
            InvokeOutcome::Error { .. } => ExitCode::InvokeError,
        }
    }

    /// Borrow the result payload (panics if this is an Error outcome).
    pub fn as_result(&self) -> &Value {
        match self {
            InvokeOutcome::Result(v) => v,
            InvokeOutcome::Error { .. } => panic!("as_result on error outcome"),
        }
    }
}

/// Wire-layer failures mapped to exit codes (PRD S5).
#[derive(Debug)]
pub enum ClientError {
    /// Connection / upgrade failure — exit 2.
    Handshake(String),
    /// TLS handshake failure on `wss://` — exit 3 (PRD S5).
    Tls(String),
    /// `auth.error` before `auth.ok` (close 1008) — exit 4.
    Auth { code: String, message: String },
    /// Wire-level failure — `error` frame, close 1009/1011, unreachable — exit 2.
    Wire(String),
    /// Explicit close with code.
    Closed(u16, Option<String>),
}

// CID:client-004 - ClientError::exit_code
// Purpose: PRD S5 layer mapping; Tls → 3, Auth → 4, everything else → 2.
impl ClientError {
    pub fn exit_code(&self) -> ExitCode {
        match self {
            ClientError::Auth { .. } => ExitCode::Auth,
            ClientError::Tls(_) => ExitCode::TlsUpgrade,
            ClientError::Handshake(_) | ClientError::Wire(_) | ClientError::Closed(_, _) => {
                ExitCode::PreFlight
            }
        }
    }
}

/// W4 wire client — one connection, one in-flight invoke at a time.
pub struct WireClient {
    ws: WebSocket<MaybeTlsStream<TcpStream>>,
    correlation_counter: u64,
}

// CID:client-001 - WireClient::connect
// Purpose: open socket, send `{type:"auth", token}`, await auth.ok.
impl WireClient {
    pub fn connect(url: &str, token: &str) -> Result<Self, ClientError> {
        // rustls needs a process-level CryptoProvider; ring is our pinned one.
        // install_default returns Err if already installed — that is fine.
        let _ = rustls::crypto::ring::default_provider().install_default();
        // PRD S5: TLS failure on wss:// → exit 3; plain handshake failure → 2.
        let tls = url.starts_with("wss://");
        let (ws, _) = connect(url).map_err(|e| {
            if tls {
                ClientError::Tls(e.to_string())
            } else {
                ClientError::Handshake(e.to_string())
            }
        })?;
        let mut client = WireClient {
            ws,
            correlation_counter: 0,
        };
        client.auth(token)?;
        Ok(client)
    }

    fn auth(&mut self, token: &str) -> Result<(), ClientError> {
        let frame = json!({ "type": "auth", "token": token });
        self.ws
            .send(Message::Text(frame.to_string().into()))
            .map_err(|e| ClientError::Wire(e.to_string()))?;

        loop {
            let msg = self
                .ws
                .read()
                .map_err(|e| ClientError::Wire(e.to_string()))?;
            match msg {
                Message::Text(t) => {
                    let v: Value = serde_json::from_str(&t)
                        .map_err(|e| ClientError::Wire(format!("bad frame: {e}")))?;
                    match v["type"].as_str() {
                        Some("auth.ok") => return Ok(()),
                        Some("auth.error") => {
                            return Err(ClientError::Auth {
                                code: v["code"].as_str().unwrap_or("unknown").to_string(),
                                message: v["message"].as_str().unwrap_or("").to_string(),
                            })
                        }
                        _ => { /* ignore unrelated frames while waiting for auth */ }
                    }
                }
                Message::Close(f) => {
                    let code = f.as_ref().map(|c| c.code.into()).unwrap_or(0);
                    let reason = f.map(|c| c.reason.to_string());
                    return Err(ClientError::Closed(code, reason));
                }
                _ => { /* ping/pong/binary ignored */ }
            }
        }
    }

    // CID:client-002 - WireClient::invoke
    // Purpose: send invoke frame (mode:"call"), await matching result/error.
    pub fn invoke(
        &mut self,
        name: &str,
        input: Option<Value>,
        session_id: Option<&str>,
    ) -> Result<InvokeOutcome, ClientError> {
        self.correlation_counter += 1;
        let correlation_id = self.correlation_counter.to_string();

        let mut frame = json!({
            "type": "invoke",
            "correlationId": correlation_id,
            "name": name,
            "mode": "call"
        });
        if let Some(input) = input {
            frame["input"] = input;
        }
        if let Some(session_id) = session_id {
            frame["sessionId"] = session_id.into();
        }
        self.ws
            .send(Message::Text(frame.to_string().into()))
            .map_err(|e| ClientError::Wire(e.to_string()))?;

        loop {
            let msg = self
                .ws
                .read()
                .map_err(|e| ClientError::Wire(e.to_string()))?;
            match msg {
                Message::Text(t) => {
                    let v: Value = serde_json::from_str(&t)
                        .map_err(|e| ClientError::Wire(format!("bad frame: {e}")))?;
                    match v["type"].as_str() {
                        Some("invoke.result") => {
                            return Ok(InvokeOutcome::Result(v["result"].clone()))
                        }
                        Some("invoke.error") => {
                            return Ok(InvokeOutcome::Error {
                                code: v["code"].as_str().unwrap_or("unknown").to_string(),
                                message: v["message"].as_str().unwrap_or("").to_string(),
                            })
                        }
                        Some("error") => {
                            return Err(ClientError::Wire(format!(
                                "{}: {}",
                                v["code"].as_str().unwrap_or("GATEWAY_ERROR"),
                                v["message"].as_str().unwrap_or("")
                            )))
                        }
                        _ => { /* ignore other frames */ }
                    }
                }
                Message::Close(f) => {
                    let code = f.as_ref().map(|c| c.code.into()).unwrap_or(0);
                    let reason = f.map(|c| c.reason.to_string());
                    return Err(ClientError::Closed(code, reason));
                }
                _ => { /* ping/pong/binary ignored */ }
            }
        }
    }
}
