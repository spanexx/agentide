//! Config resolution tests — flag > env > TOML > TTY prompt (PRD S1, S6).
//!
//! Integration tests against the public API: `resolve`, `CliOverrides`,
//! `Config`, `ConfigError`. Files <350 lines rule → tests live here, not in
//! src/config.rs.

/*
 * Code Map: config precedence scenarios
 *
 * CID Index:
 * CID:config-test-001 -> precedence (flag > env > toml)
 * CID:config-test-002 -> explicit-missing config → exit 2
 * CID:config-test-003 -> path: token indirection
 * CID:config-test-004 -> perms warnings (unix)
 * CID:config-test-005 -> TTY prompt fallback
 *
 * Quick lookup: rg -n "CID:config-test-" crates/cli-adapter/tests/config.rs
 */

use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use cli_adapter::config::{resolve, CliOverrides, Config, ConfigError};

const URL: &str = "ws://127.0.0.1:7300/ws";
const TOK: &str = "tok-abc";

fn no_env(_: &str) -> Option<String> {
    None
}

fn no_prompt(_: &str) -> Option<String> {
    None
}

struct TmpDir(PathBuf);

impl TmpDir {
    fn new(name: &str) -> Self {
        let p = std::env::temp_dir().join(format!("cli-adapter-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        TmpDir(p)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    #[cfg(unix)]
    fn write(&self, rel: &str, body: &str, mode: u32) -> PathBuf {
        let p = self.0.join(rel);
        fs::write(&p, body).unwrap();
        fs::set_permissions(&p, fs::Permissions::from_mode(mode)).unwrap();
        p
    }

    #[cfg(not(unix))]
    fn write(&self, rel: &str, body: &str, _mode: u32) -> PathBuf {
        let p = self.0.join(rel);
        fs::write(&p, body).unwrap();
        p
    }
}

impl Drop for TmpDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn resolve_with(
    cli: &CliOverrides,
    env: impl Fn(&str) -> Option<String>,
    tty: bool,
    default_path: Option<PathBuf>,
) -> (Result<Config, ConfigError>, Vec<String>) {
    let mut warnings = Vec::new();
    let mut warn = |m: &str| warnings.push(m.to_string());
    let mut pl = no_prompt;
    let mut ps = no_prompt;
    let res = resolve(cli, default_path, env, tty, &mut warn, &mut pl, &mut ps);
    (res, warnings)
}

// CID:config-test-001 - precedence
#[test]
fn flag_wins_over_env_and_toml() {
    let tmp = TmpDir::new("flag-wins");
    let cfg_file = tmp.write(
        "config.toml",
        "gateway_url = \"toml\"\ntoken = \"t\"\n",
        0o600,
    );
    let cli = CliOverrides {
        gateway_url: Some("flag-url".into()),
        token: Some("flag-tok".into()),
        config_path: Some(cfg_file),
    };
    let (res, _) = resolve_with(
        &cli,
        |k| {
            if k == "PLATFORM_GATEWAY_URL" {
                Some("env-url".into())
            } else {
                Some("env-tok".into())
            }
        },
        false,
        None,
    );
    let cfg = res.unwrap();
    assert_eq!(cfg.gateway_url.as_deref(), Some("flag-url"));
    assert_eq!(cfg.token.as_deref(), Some("flag-tok"));
}

#[test]
fn env_wins_over_toml() {
    let tmp = TmpDir::new("env-wins");
    let cfg_file = tmp.write(
        "config.toml",
        &format!("gateway_url = \"{URL}\"\ntoken = \"{TOK}\"\n"),
        0o600,
    );
    let cli = CliOverrides {
        config_path: Some(cfg_file),
        ..Default::default()
    };
    let (res, _) = resolve_with(
        &cli,
        |k| {
            if k == "PLATFORM_GATEWAY_URL" {
                Some("env-url".into())
            } else {
                Some("env-tok".into())
            }
        },
        false,
        None,
    );
    let cfg = res.unwrap();
    assert_eq!(cfg.gateway_url.as_deref(), Some("env-url"));
    assert_eq!(cfg.token.as_deref(), Some("env-tok"));
}

#[test]
fn toml_used_when_env_absent() {
    let tmp = TmpDir::new("toml-used");
    let cfg_file = tmp.write(
        "config.toml",
        &format!("gateway_url = \"{URL}\"\ntoken = \"{TOK}\"\n"),
        0o600,
    );
    let cli = CliOverrides {
        config_path: Some(cfg_file),
        ..Default::default()
    };
    let (res, _) = resolve_with(&cli, no_env, false, None);
    let cfg = res.unwrap();
    assert_eq!(cfg.gateway_url.as_deref(), Some(URL));
    assert_eq!(cfg.token.as_deref(), Some(TOK));
}

#[test]
fn config_absent_falls_through_to_missing() {
    let tmp = TmpDir::new("no-config");
    let cli = CliOverrides::default();
    let (res, _) = resolve_with(&cli, no_env, false, Some(tmp.path().join("missing.toml")));
    assert_eq!(res, Err(ConfigError::Missing("gateway url")));
}

// CID:config-test-002 - explicit-missing config → exit 2
#[test]
fn explicit_config_missing_is_error() {
    let tmp = TmpDir::new("explicit-missing");
    let cli = CliOverrides {
        config_path: Some(tmp.path().join("missing.toml")),
        ..Default::default()
    };
    let (res, _) = resolve_with(&cli, no_env, false, None);
    assert!(matches!(&res, Err(ConfigError::ConfigFileRead(_))));
    assert_eq!(res.unwrap_err().exit_code(), 2);
}

#[test]
fn missing_token_no_tty_is_exit_2() {
    let cli = CliOverrides {
        gateway_url: Some(URL.into()),
        ..Default::default()
    };
    let (res, _) = resolve_with(&cli, no_env, false, None);
    assert_eq!(res.unwrap_err().exit_code(), 2);
}

// CID:config-test-003 - path: token indirection
#[test]
fn path_token_indirection_reads_file() {
    let tmp = TmpDir::new("path-token");
    let tok_file = tmp.write("token.jwt", "secret-jwt\n", 0o600);
    let cli = CliOverrides {
        gateway_url: Some(URL.into()),
        token: Some(format!("path:{}", tok_file.display())),
        ..Default::default()
    };
    let (res, _) = resolve_with(&cli, no_env, false, None);
    assert_eq!(res.unwrap().token.as_deref(), Some("secret-jwt"));
}

#[test]
fn path_token_from_env_expands() {
    let tmp = TmpDir::new("path-token-env");
    let tok_file = tmp.write("token.jwt", "env-jwt\n", 0o600);
    let cli = CliOverrides {
        gateway_url: Some(URL.into()),
        ..Default::default()
    };
    let (res, _) = resolve_with(
        &cli,
        |k| {
            if k == "PLATFORM_TOKEN" {
                Some(format!("path:{}", tok_file.display()))
            } else {
                None
            }
        },
        false,
        None,
    );
    assert_eq!(res.unwrap().token.as_deref(), Some("env-jwt"));
}

#[test]
fn path_token_missing_file_is_exit_2() {
    let tmp = TmpDir::new("path-token-missing");
    let cli = CliOverrides {
        gateway_url: Some(URL.into()),
        token: Some(format!("path:{}", tmp.path().join("nope.jwt").display())),
        ..Default::default()
    };
    let (res, _) = resolve_with(&cli, no_env, false, None);
    assert!(matches!(&res, Err(ConfigError::TokenFileMissing(_))));
    assert_eq!(res.unwrap_err().exit_code(), 2);
}

#[test]
fn unknown_toml_key_ignored() {
    let tmp = TmpDir::new("unknown-key");
    let cfg_file = tmp.write(
        "config.toml",
        &format!("gateway_url = \"{URL}\"\ntoken = \"{TOK}\"\nbogus_key = 42\n"),
        0o600,
    );
    let cli = CliOverrides {
        config_path: Some(cfg_file),
        ..Default::default()
    };
    let (res, _) = resolve_with(&cli, no_env, false, None);
    let cfg = res.unwrap();
    assert_eq!(cfg.gateway_url.as_deref(), Some(URL));
    assert_eq!(cfg.token.as_deref(), Some(TOK));
}

// CID:config-test-004 - perms warnings (unix)
#[cfg(unix)]
#[test]
fn perms_warning_fires_for_loose_config() {
    let tmp = TmpDir::new("perms-config");
    let cfg_file = tmp.write(
        "config.toml",
        &format!("gateway_url = \"{URL}\"\ntoken = \"{TOK}\"\n"),
        0o644,
    );
    let cli = CliOverrides {
        config_path: Some(cfg_file),
        ..Default::default()
    };
    let (res, warnings) = resolve_with(&cli, no_env, false, None);
    assert!(res.is_ok());
    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("config.toml"));
    assert!(warnings[0].contains("chmod 600"));
}

#[cfg(unix)]
#[test]
fn no_warning_when_0600() {
    let tmp = TmpDir::new("perms-600");
    let cfg_file = tmp.write(
        "config.toml",
        &format!("gateway_url = \"{URL}\"\ntoken = \"{TOK}\"\n"),
        0o600,
    );
    let cli = CliOverrides {
        config_path: Some(cfg_file),
        ..Default::default()
    };
    let (res, warnings) = resolve_with(&cli, no_env, false, None);
    assert!(res.is_ok());
    assert!(warnings.is_empty());
}

#[cfg(unix)]
#[test]
fn loose_config_and_loose_token_file_warn_once() {
    let tmp = TmpDir::new("perms-both");
    let tok_file = tmp.write("tok.jwt", "jwt\n", 0o644);
    let cfg_file = tmp.write(
        "config.toml",
        &format!(
            "gateway_url = \"{URL}\"\ntoken = \"path:{}\"\n",
            tok_file.display()
        ),
        0o644,
    );
    let cli = CliOverrides {
        config_path: Some(cfg_file),
        ..Default::default()
    };
    let (res, warnings) = resolve_with(&cli, no_env, false, None);
    assert!(res.is_ok());
    assert_eq!(warnings.len(), 1);
    assert!(warnings[0].contains("config.toml")); // first offending file wins
}

// CID:config-test-005 - TTY prompt fallback
#[test]
fn tty_prompt_fills_missing_values() {
    let cli = CliOverrides::default();
    let mut warnings = Vec::new();
    let mut warn = |m: &str| warnings.push(m.to_string());
    let mut pl = |_: &str| Some("prompt-url".into());
    let mut ps = |_: &str| Some("prompt-tok".into());
    let res = resolve(&cli, None, no_env, true, &mut warn, &mut pl, &mut ps);
    let cfg = res.unwrap();
    assert_eq!(cfg.gateway_url.as_deref(), Some("prompt-url"));
    assert_eq!(cfg.token.as_deref(), Some("prompt-tok"));
}
