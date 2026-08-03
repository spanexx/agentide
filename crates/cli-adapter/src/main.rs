/*
 * Code Map: platform CLI binary entry
 * - main: parse args → resolve config → connect → invoke → render → exit
 * - alias: 5 convenience aliases → capability names (PRD S2)
 * - run_invoke: config→connect→invoke→output pipeline (S3/S4/S5)
 *
 * CID Index:
 * CID:main-001 -> main
 * CID:main-002 -> parse_flags
 * CID:main-003 -> alias
 * CID:main-004 -> run_invoke
 * CID:main-005 -> view_for
 *
 * Quick lookup: rg -n "CID:main-" crates/cli-adapter/src/main.rs
 */

use std::process::ExitCode;

use cli_adapter::client::{ClientError, InvokeOutcome, WireClient};
use cli_adapter::config::{resolve_real, CliOverrides, ConfigError};
use cli_adapter::errors::ExitCode as CmdExit;
use cli_adapter::output::{render, stdout_is_tty, View};
use serde_json::Value;

// CID:main-001 - main
// Purpose: parse args, dispatch, return process exit code (PRD S5).
fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    let sub = match args.first().map(String::as_str) {
        Some("--version") | Some("-V") => {
            println!("platform {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        Some(other) => other.to_string(),
        None => {
            usage();
            return ExitCode::from(CmdExit::PreFlight.as_u8()); // usage → 2 (PRD S5)
        }
    };

    let flags = parse_flags(&args[1..]);

    // Subcommand resolution: alias or invoke <cap>.
    let capability = match sub.as_str() {
        "invoke" => match flags.rest.first().map(String::as_str) {
            Some(cap) => cap.to_string(),
            None => {
                usage();
                return ExitCode::from(CmdExit::PreFlight.as_u8());
            }
        },
        other => match alias(other) {
            Some(cap) => cap.to_string(),
            None => {
                usage();
                return ExitCode::from(CmdExit::PreFlight.as_u8()); // unknown → 2
            }
        },
    };

    run_invoke(
        &capability,
        flags.json,
        flags.watch,
        flags.topic.as_deref(),
        flags.config_path,
        flags.input,
        flags.session.as_deref(),
    )
}

/// Flags parsed after the subcommand name (any order, repeatable).
#[derive(Default)]
struct Flags {
    json: bool,
    watch: bool,
    topic: Option<String>,
    config_path: Option<std::path::PathBuf>,
    input: Option<Value>,
    session: Option<String>,
    rest: Vec<String>,
}

// CID:main-002 - parse_flags
// Purpose: `--json`, `--watch`, `--topic`, `--config`, `--args`, `--session`
// in any order; unknown tokens accumulate in `rest` (e.g. invoke's capability).
// `--args` is parsed via serde_json with NO manual quote stripping — a literal
// quote pair in the payload is DATA, never stripped.
fn parse_flags(args: &[String]) -> Flags {
    let mut flags = Flags::default();
    let mut iter = args.iter();
    while let Some(a) = iter.next() {
        match a.as_str() {
            "--json" => flags.json = true,
            "--watch" => flags.watch = true,
            "--topic" => flags.topic = iter.next().map(|s| s.to_string()),
            "--config" => flags.config_path = iter.next().map(|s| s.into()),
            "--args" => flags.input = iter.next().and_then(|s| serde_json::from_str(s).ok()),
            "--session" => flags.session = iter.next().map(|s| s.to_string()),
            _ => flags.rest.push(a.clone()),
        }
    }
    flags
}

// CID:main-002 - alias
// Purpose: PRD S2 — convenience names map to capability invokes.
fn alias(name: &str) -> Option<&'static str> {
    match name {
        "capabilities" => Some("capability.list"),
        "sessions" => Some("session.list"),
        "plugins" => Some("plugin.list"),
        "status" => Some("gateway.status"),
        "health" => Some("system.health"),
        _ => None,
    }
}

fn usage() {
    eprintln!("platform — Agentide remote gateway CLI");
    eprintln!("usage: platform <alias|invoke <capability>> [--json] [--watch] [--topic <p>]");
    eprintln!("       platform --version");
    eprintln!("aliases: capabilities, sessions, plugins, status, health");
}

// CID:main-003 - run_invoke
// Purpose: config → connect → auth → invoke → render; maps failures to
// exit codes (PRD S3/S4/S5/S8).
fn run_invoke(
    capability: &str,
    json: bool,
    watch: bool,
    topic: Option<&str>,
    config_path: Option<std::path::PathBuf>,
    input: Option<Value>,
    session: Option<&str>,
) -> ExitCode {
    if watch {
        eprintln!("error: --watch lands in Phase 6");
        return ExitCode::from(CmdExit::PreFlight.as_u8());
    }
    let _ = topic; // Phase 6 consumes --topic.

    // Config resolution: flag > env > TOML > TTY prompt (PRD S1, S6).
    let cli = CliOverrides {
        gateway_url: None,
        token: None,
        config_path,
    };
    let cfg = match resolve_real(&cli) {
        Ok(cfg) => cfg,
        Err(e) => {
            eprintln!("error: {}", config_msg(&e));
            return ExitCode::from(CmdExit::PreFlight.as_u8()); // config → 2
        }
    };
    let url = cfg.gateway_url.as_deref().unwrap_or_default();
    let token = cfg.token.as_deref().unwrap_or_default();

    let mut client = match WireClient::connect(url, token) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: {}", client_msg(&e));
            return ExitCode::from(e.exit_code().as_u8());
        }
    };

    let outcome = match client.invoke(capability, input, session) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("error: {}", client_msg(&e));
            return ExitCode::from(e.exit_code().as_u8());
        }
    };

    match outcome {
        InvokeOutcome::Result(v) => {
            let tty = stdout_is_tty() && !json;
            let out = render(view_for(capability), &v, tty);
            print!("{out}");
            ExitCode::SUCCESS
        }
        InvokeOutcome::Error { code, message } => {
            // PRD S4: code+message verbatim, exit 1.
            eprintln!("error: {code} — {message}");
            ExitCode::from(CmdExit::InvokeError.as_u8())
        }
    }
}

// CID:main-004 - view_for
// Purpose: map resolved capability name → output view (PRD S3). Kept as a
// pure fn so the alias/table mapping is unit-testable.
fn view_for(capability: &str) -> View {
    if matches!(capability, "gateway.status" | "system.health") {
        View::StatusHealth
    } else {
        alias_view(capability)
    }
}

fn alias_view(capability: &str) -> View {
    match capability {
        "capability.list" => View::Capabilities,
        "session.list" => View::Sessions,
        "plugin.list" => View::Plugins,
        _ => View::Invoke,
    }
}

fn config_msg(e: &ConfigError) -> String {
    match e {
        ConfigError::Missing(what) => format!("missing {what}"),
        ConfigError::TokenFileMissing(p) => format!("token file missing: {}", p.display()),
        ConfigError::ConfigFileRead(p) => format!("config file unreadable: {}", p.display()),
    }
}

fn client_msg(e: &ClientError) -> String {
    match e {
        ClientError::Handshake(s) | ClientError::Tls(s) | ClientError::Wire(s) => s.clone(),
        ClientError::Auth { code, message } => format!("auth failed: {code} — {message}"),
        ClientError::Closed(code, reason) => match reason {
            Some(r) => format!("connection closed ({code}): {r}"),
            None => format!("connection closed ({code})"),
        },
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_is_0_1_0() {
        assert_eq!(env!("CARGO_PKG_VERSION"), "0.1.0");
    }

    #[test]
    fn alias_map_covers_prd_s2() {
        use super::alias;
        assert_eq!(alias("capabilities"), Some("capability.list"));
        assert_eq!(alias("sessions"), Some("session.list"));
        assert_eq!(alias("plugins"), Some("plugin.list"));
        assert_eq!(alias("status"), Some("gateway.status"));
        assert_eq!(alias("health"), Some("system.health"));
        assert_eq!(alias("bogus"), None);
    }

    #[test]
    fn parse_flags_any_order_with_values() {
        use super::parse_flags;

        let f = parse_flags(&[
            "--json".into(),
            "--watch".into(),
            "--topic".into(),
            "capability.*".into(),
            "--config".into(),
            "/tmp/c.toml".into(),
            "--session".into(),
            "s-9".into(),
            "stray".into(),
        ]);
        assert!(f.json);
        assert!(f.watch);
        assert_eq!(f.topic.as_deref(), Some("capability.*"));
        assert_eq!(
            f.config_path.as_deref(),
            Some(std::path::Path::new("/tmp/c.toml"))
        );
        assert_eq!(f.session.as_deref(), Some("s-9"));
        assert_eq!(f.rest, vec!["stray"]);
        assert_eq!(f.input, None);
        // --json without --args does not consume the next flag as its value.
        let f2 = parse_flags(&["--json".into(), "--watch".into()]);
        assert!(f2.json);
        assert!(f2.watch);
        assert!(f2.rest.is_empty());
    }

    #[test]
    fn parse_flags_args_verbatim_no_quote_stripping() {
        use super::parse_flags;
        use serde_json::json;

        // Object payload parses as-is.
        let f = parse_flags(&["--args".into(), "{\"x\":1}".into()]);
        assert_eq!(f.input, Some(json!({"x": 1})));

        // A literal JSON string is DATA: parsed as a string, never unquoted.
        let f2 = parse_flags(&["--args".into(), "\"hi\"".into()]);
        assert_eq!(f2.input, Some(json!("hi")));

        // Unparseable --args → None (falls through to default input).
        let f3 = parse_flags(&["--args".into(), "not json".into()]);
        assert_eq!(f3.input, None);
    }

    #[test]
    fn view_for_picks_alias_tables_not_invoke() {
        // Regression: alias views must render tables, not pretty JSON.
        use super::view_for;
        use cli_adapter::output::View;
        assert_eq!(view_for("capability.list"), View::Capabilities);
        assert_eq!(view_for("session.list"), View::Sessions);
        assert_eq!(view_for("plugin.list"), View::Plugins);
        assert_eq!(view_for("gateway.status"), View::StatusHealth);
        assert_eq!(view_for("system.health"), View::StatusHealth);
        assert_eq!(view_for("custom.cap"), View::Invoke);
    }
}
