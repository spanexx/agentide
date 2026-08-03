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
 * CID:client-005 -> classify_connect_error
 *
 * Quick lookup: rg -n "CID:client-" crates/cli-adapter/src/client.rs
 */

use std::net::TcpStream;

use serde_json::{json, Value};
use tungstenite::error::Error;
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

// CID:client-005 - classify_connect_error
// Purpose: map a tungstenite connect error to ClientError per PRD S5.
fn classify_connect_error(e: Error, url: &str) -> ClientError {
    match e {
        // Native-tls / rustls config-level failures arrive as Error::Tls.
        Error::Tls(_) => ClientError::Tls(e.to_string()),
        // With rustls the TLS handshake is lazy: a handshake failure is an
        // Error::Io. If TCP is reachable, the failure happened inside the
        // TLS/upgrade layer → 3; if the probe fails, it was pure transport
        // (refused, DNS) → 2.
        Error::Io(_) if url.starts_with("wss://") => match host_port(url) {
            Some((host, port)) => {
                if TcpStream::connect((host.as_str(), port)).is_err() {
                    ClientError::Handshake(e.to_string())
                } else {
                    ClientError::Tls(e.to_string())
                }
            }
            None => ClientError::Handshake(e.to_string()),
        },
        other => ClientError::Handshake(other.to_string()),
    }
}

/// Extract (host, port) from a wss:// URL; wss default port is 443.
fn host_port(url: &str) -> Option<(String, u16)> {
    let rest = url.strip_prefix("wss://")?;
    let host = rest.split(['/', '?', '#']).next()?;
    if host.is_empty() {
        return None;
    }
    if let Some(end) = host.find(']') {
        // [v6]:port or [v6]
        let inner = &host[1..end];
        let port = host[end + 1..]
            .strip_prefix(':')
            .and_then(|p| p.parse().ok())
            .unwrap_or(443);
        return Some((inner.to_string(), port));
    }
    match host.rsplit_once(':') {
        Some((h, p)) => Some((h.to_string(), p.parse().ok()?)),
        None => Some((host.to_string(), 443)),
    }
}

// CID:client-001 - WireClient::connect
// Purpose: open socket, send `{type:"auth", token}`, await auth.ok.
impl WireClient {
    pub fn connect(url: &str, token: &str) -> Result<Self, ClientError> {
        // rustls needs a process-level CryptoProvider; ring is our pinned one.
        // install_default returns Err if already installed — that is fine.
        let _ = rustls::crypto::ring::default_provider().install_default();
        // PRD S5: TLS-layer failure on wss:// → exit 3; TCP/DNS/HTTP-upgrade
        // failures → exit 2. tungstenite 0.30 + rustls performs the TLS
        // handshake lazily, so a failed TLS handshake surfaces as Error::Io,
        // indistinguishable from a refused TCP connect by variant alone —
        // probe raw TCP reachability to tell them apart.
        let (ws, _) = connect(url).map_err(|e| classify_connect_error(e, url))?;
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
                    // PRD S5 / GRILL Q4: close 1008 during auth = auth rejected
                    // before auth.ok → exit 4 (the `auth.error` frame may be
                    // skipped; the close IS the rejection).
                    if code == 1008 {
                        let message = reason.clone().unwrap_or_default();
                        return Err(ClientError::Auth {
                            code: message.clone(),
                            message,
                        });
                    }
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
                        // W4 sub-Q 2: `invoke.result` carries `output` (NOT `result`).
                        Some("invoke.result") => {
                            return Ok(InvokeOutcome::Result(v["output"].clone()))
                        }
                        Some("invoke.error") => {
                            return Ok(InvokeOutcome::Error {
                                code: v["code"].as_str().unwrap_or("unknown").to_string(),
                                message: v["message"].as_str().unwrap_or("").to_string(),
                            })
                        }
                        Some("error") => {
                            // W4: `error` frame codes are WS_* uppercase strings.
                            return Err(ClientError::Wire(format!(
                                "{}: {}",
                                v["code"].as_str().unwrap_or("WS_INTERNAL"),
                                v["message"].as_str().unwrap_or("")
                            )));
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
