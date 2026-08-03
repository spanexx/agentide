//! Config resolution — flag > env > TOML > TTY prompt (PRD S1, S6).
//!
//! Items are wired into the binary in Phase 5 (dispatch); `dead_code` allow
//! removed then.

#![allow(dead_code)]

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Deserialize;

/// CLI-level overrides (flags win over everything else).
#[derive(Debug, Default, Clone)]
pub struct CliOverrides {
    pub gateway_url: Option<String>,
    pub token: Option<String>,
    /// `--config <path>` — replaces the default config file location.
    pub config_path: Option<PathBuf>,
}

/// Resolved configuration before connection.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Config {
    pub gateway_url: Option<String>,
    pub token: Option<String>,
}

/// Pre-flight resolution failures — all exit code 2 (PRD S5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigError {
    /// A required value is missing and no TTY could prompt for it.
    Missing(&'static str),
    /// `path:` indirection target does not exist.
    TokenFileMissing(PathBuf),
    /// Config file unreadable or unparseable.
    ConfigFileRead(PathBuf),
}

impl ConfigError {
    pub fn exit_code(&self) -> u8 {
        2
    }
}

/// v1 config.toml schema — `gateway_url` + `token` ONLY.
/// Unknown keys are IGNORED (no `deny_unknown_fields`).
#[derive(Debug, Default, Deserialize)]
struct FileConfig {
    gateway_url: Option<String>,
    token: Option<String>,
}

const ENV_URL: &str = "PLATFORM_GATEWAY_URL";
const ENV_TOKEN: &str = "PLATFORM_TOKEN";

/// Default config file: `<OS config dir>/platform/config.toml`.
pub fn default_config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("platform").join("config.toml"))
}

/// Resolve configuration with precedence flag > env > TOML > TTY prompt.
///
/// Injectable seams (tests): `env_get`, `default_path`, `tty`, `warn`
/// (once-per-run perms warning), `prompt_line` / `prompt_secret` (used only
/// when `tty`). An explicit `--config` path that is missing is a pre-flight
/// error; a missing *default* path simply falls through.
#[allow(clippy::too_many_arguments)]
pub fn resolve(
    cli: &CliOverrides,
    default_path: Option<PathBuf>,
    env_get: impl Fn(&str) -> Option<String>,
    tty: bool,
    warn: &mut dyn FnMut(&str),
    prompt_line: &mut dyn FnMut(&str) -> Option<String>,
    prompt_secret: &mut dyn FnMut(&str) -> Option<String>,
) -> Result<Config, ConfigError> {
    let mut cfg = Config::default();
    let mut warned = false;
    let mut warn_once = |msg: &str| {
        if !warned {
            warned = true;
            warn(msg);
        }
    };

    // Source 1: flags.
    cfg.gateway_url = cli.gateway_url.clone();
    cfg.token = cli.token.clone();

    // Source 2: env.
    if cfg.gateway_url.is_none() {
        cfg.gateway_url = env_get(ENV_URL);
    }
    if cfg.token.is_none() {
        cfg.token = env_get(ENV_TOKEN);
    }

    // Source 3: TOML.
    if cfg.gateway_url.is_none() || cfg.token.is_none() {
        let path = cli.config_path.clone().or(default_path);
        match path {
            Some(path) if path.exists() => {
                let file = read_file_config(&path, &mut warn_once)?;
                if cfg.gateway_url.is_none() {
                    cfg.gateway_url = file.gateway_url;
                }
                if cfg.token.is_none() {
                    cfg.token = file.token;
                }
            }
            Some(path) if cli.config_path.is_some() => {
                // Explicit --config given but missing → pre-flight error.
                return Err(ConfigError::ConfigFileRead(path));
            }
            _ => {}
        }
    }

    // Source 4: TTY prompt (missing pieces only).
    if tty {
        if cfg.gateway_url.is_none() {
            cfg.gateway_url = prompt_line("gateway url: ");
        }
        if cfg.token.is_none() {
            cfg.token = prompt_secret("token: ");
        }
    }

    if cfg.gateway_url.is_none() {
        return Err(ConfigError::Missing("gateway url"));
    }
    if cfg.token.is_none() {
        return Err(ConfigError::Missing("token"));
    }

    // `path:` token indirection — from ANY winning source.
    let raw = cfg.token.take().unwrap();
    cfg.token = Some(expand_token(&raw, &mut warn_once)?);

    Ok(cfg)
}

fn read_file_config(path: &Path, warn: &mut dyn FnMut(&str)) -> Result<FileConfig, ConfigError> {
    if perms_loose(path) {
        warn(&format!(
            "{} is group/world-readable — consider chmod 600",
            path.display()
        ));
    }
    let text = std::fs::read_to_string(path)
        .map_err(|_| ConfigError::ConfigFileRead(path.to_path_buf()))?;
    toml::from_str(&text).map_err(|_| ConfigError::ConfigFileRead(path.to_path_buf()))
}

/// `path:/...` indirection — read the token from the file (trimmed).
fn expand_token(token: &str, warn: &mut dyn FnMut(&str)) -> Result<String, ConfigError> {
    match token.strip_prefix("path:") {
        Some(p) => {
            let path = PathBuf::from(p);
            if perms_loose(&path) {
                warn(&format!(
                    "{} is group/world-readable — consider chmod 600",
                    path.display()
                ));
            }
            std::fs::read_to_string(&path)
                .map(|s| s.trim().to_string())
                .map_err(|_| ConfigError::TokenFileMissing(path))
        }
        None => Ok(token.to_string()),
    }
}

/// True when any group/other permission bit is set (looser than 0600).
#[cfg(unix)]
fn perms_loose(path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(path)
        .map(|m| m.mode() & 0o077 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn perms_loose(_path: &Path) -> bool {
    false
}

fn real_prompt_line(prompt: &str) -> Option<String> {
    print!("{prompt}");
    let _ = std::io::stdout().flush();
    let mut line = String::new();
    if std::io::stdin().read_line(&mut line).is_err() {
        return None;
    }
    let s = line.trim();
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

fn real_prompt_secret(prompt: &str) -> Option<String> {
    rpassword::prompt_password(prompt)
        .ok()
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

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
}
