//! Config resolution — flag > env > TOML > TTY prompt (PRD S1, S6).
//!
//! Items are wired into the binary in Phase 5 (dispatch); `dead_code` allow
//! removed then.

/*
 * Code Map: config precedence + token hygiene
 * - resolve: flag > env > TOML > TTY, path: expansion, perms warning
 * - default_config_path: <OS config dir>/platform/config.toml
 *
 * CID Index:
 * CID:config-001 -> resolve
 * CID:config-002 -> default_config_path
 *
 * Quick lookup: rg -n "CID:config-" crates/cli-adapter/src/config.rs
 */

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
