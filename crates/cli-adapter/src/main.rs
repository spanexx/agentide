/*
 * Code Map: platform CLI binary entry
 * - main: parse args → resolve config → connect → invoke → render → exit
 * - alias: 5 convenience aliases → capability names (PRD S2)
 * - run_invoke: config→connect→invoke→output pipeline (S3/S4/S5)
 * (usage text lives in usage.rs, view selection in output.rs)
 *
 * CID Index: main-001 main · main-002 parse_flags · main-003 alias ·
 *            main-004 run_invoke — rg -n "CID:main-" crates/cli-adapter/src/main.rs
 */

use std::process::ExitCode;

use cli_adapter::client::{InvokeOutcome, WireClient};
use cli_adapter::config::{resolve_real, CliOverrides, ConfigError};
use cli_adapter::errors::ExitCode as CmdExit;
use cli_adapter::output::{render, stdout_is_tty, view_for, Entry};
use cli_adapter::usage::print_usage;
use cli_adapter::watch;
use serde_json::Value;

// CID:main-001 - main — parse args, dispatch, return process exit code (PRD S5).
fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    // Short-circuit flags may appear anywhere — but never as a VALUE flag's value.
    {
        const VALUE_FLAGS: [&str; 6] = [
            "--topic",
            "--config",
            "--args",
            "--session",
            "--url",
            "--token",
        ];
        let mut iter = args.iter().peekable();
        while let Some(a) = iter.next() {
            if VALUE_FLAGS.contains(&a.as_str()) {
                iter.next();
            } else if a == "--version" || a == "-V" {
                println!("platform {}", env!("CARGO_PKG_VERSION"));
                return ExitCode::SUCCESS;
            } else if a == "--help" || a == "-h" {
                print_usage(&mut std::io::stdout());
                return ExitCode::SUCCESS;
            }
        }
    }

    let flags = parse_flags(&args);

    // Flags may precede the subcommand; first `rest` token = subcommand,
    // `invoke` takes its capability from the second.
    let (capability, entry) = {
        let mut rest = flags.rest.iter();
        let sub = match rest.next().map(String::as_str) {
            Some(s) => s,
            None => {
                print_usage(&mut std::io::stderr());
                return ExitCode::from(CmdExit::PreFlight.as_u8()); // usage → 2
            }
        };
        match sub {
            "invoke" => match rest.next().map(String::as_str) {
                Some(cap) => (cap.to_string(), Entry::Invoke),
                None => {
                    print_usage(&mut std::io::stderr());
                    return ExitCode::from(CmdExit::PreFlight.as_u8());
                }
            },
            other => match alias(other) {
                Some(cap) => (cap.to_string(), Entry::Alias),
                None => {
                    print_usage(&mut std::io::stderr());
                    return ExitCode::from(CmdExit::PreFlight.as_u8()); // unknown → 2
                }
            },
        }
    };

    run_invoke(
        &capability,
        entry,
        flags.json,
        flags.watch,
        flags.topic.as_deref(),
        flags.config_path,
        flags.input,
        flags.session.as_deref(),
        flags.url.as_deref(),
        flags.token.as_deref(),
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
    url: Option<String>,
    token: Option<String>,
    rest: Vec<String>,
}

// CID:main-002 - parse_flags
// Purpose: `--json`, `--watch`, `--topic`, `--config`, `--args`, `--session`,
// `--url`, `--token` in any order; unknown tokens accumulate in `rest`
// (e.g. invoke's capability). `--args` parsed via serde_json, NO manual quote
// stripping — a literal quote pair in the payload is DATA, never stripped.
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
            "--url" => flags.url = iter.next().map(|s| s.to_string()),
            "--token" => flags.token = iter.next().map(|s| s.to_string()),
            _ => flags.rest.push(a.clone()),
        }
    }
    flags
}

// CID:main-003 - alias — PRD S2: convenience names map to capability invokes.
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

// CID:main-004 - run_invoke — config → connect → auth → invoke → render;
// maps failures to exit codes (PRD S3/S4/S5/S8).
#[allow(clippy::too_many_arguments)]
fn run_invoke(
    capability: &str,
    entry: Entry,
    json: bool,
    watch: bool,
    topic: Option<&str>,
    config_path: Option<std::path::PathBuf>,
    input: Option<Value>,
    session: Option<&str>,
    url: Option<&str>,
    token: Option<&str>,
) -> ExitCode {
    // PRD S7: watch mode is alias-only — invoke has no event stream.
    if watch && entry == Entry::Invoke {
        eprintln!(
            "error: --watch requires an alias (sessions, plugins, capabilities, status, health)"
        );
        return ExitCode::from(CmdExit::PreFlight.as_u8());
    }

    // Config resolution: flag > env > TOML > TTY prompt (PRD S1, S6).
    let cli = CliOverrides {
        gateway_url: url.map(String::from),
        token: token.map(String::from),
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
            eprintln!("error: {e}");
            return ExitCode::from(e.exit_code().as_u8());
        }
    };

    // PRD S7: watch — snapshot, subscribe, NDJSON events until Ctrl-C.
    if watch {
        return watch::run(&mut client, capability, json, topic, input, session)
            .as_u8()
            .into();
    }

    let outcome = match client.invoke(capability, input, session) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("error: {e}");
            return ExitCode::from(e.exit_code().as_u8());
        }
    };

    match outcome {
        InvokeOutcome::Result(v) => {
            let out = render(view_for(capability, entry), &v, stdout_is_tty() && !json);
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

fn config_msg(e: &ConfigError) -> String {
    match e {
        ConfigError::Missing(w) => format!("missing {w}"),
        ConfigError::TokenFileMissing(p) => format!("token file missing: {}", p.display()),
        ConfigError::ConfigFileRead(p) => format!("config file unreadable: {}", p.display()),
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
            "--url".into(),
            "ws://127.0.0.1:7300/ws".into(),
            "--token".into(),
            "path:/tmp/t.jwt".into(),
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
        assert_eq!(f.url.as_deref(), Some("ws://127.0.0.1:7300/ws"));
        assert_eq!(f.token.as_deref(), Some("path:/tmp/t.jwt"));
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
    fn print_usage_lists_full_flag_surface() {
        // PRD binary surface: --url/--token/--help must be documented.
        use cli_adapter::usage::print_usage;
        let mut buf: Vec<u8> = Vec::new();
        print_usage(&mut buf);
        let text = String::from_utf8(buf).unwrap();
        for flag in [
            "--url",
            "--token",
            "--config",
            "--args",
            "--session",
            "--json",
            "--watch",
            "--topic",
            "--help",
            "--version",
        ] {
            assert!(text.contains(flag), "usage missing {flag}: {text}");
        }
    }

    #[test]
    fn watch_on_invoke_is_preflight() {
        // PRD S7: --watch is alias-only — `invoke X --watch` → exit 2,
        // BEFORE any config resolution or connection is attempted.
        use super::{run_invoke, CmdExit, Entry};

        let code = run_invoke(
            "gateway.status",
            Entry::Invoke,
            false,                       // json
            true,                        // watch
            None,                        // topic
            None,                        // config_path
            None,                        // input
            None,                        // session
            Some("ws://127.0.0.1:1/ws"), // url — unreachable, must NOT connect
            None,                        // token
        );
        assert_eq!(
            code,
            std::process::ExitCode::from(CmdExit::PreFlight.as_u8())
        );
    }
}
