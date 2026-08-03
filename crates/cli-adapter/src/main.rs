//! `platform` — Agentide remote gateway CLI.
//!
//! Phase 1: scaffold — version + usage stub. Full dispatch arrives in Phase 5.

mod client;
mod config;
mod errors;
mod output;
mod watch;

use std::process::ExitCode;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    match args.first().map(String::as_str) {
        Some("--version") | Some("-V") => {
            println!("platform {VERSION}");
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("platform — Agentide remote gateway CLI");
            eprintln!("usage: platform <subcommand> [flags]");
            ExitCode::from(2) // usage error (PRD S5)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_0_1_0() {
        assert_eq!(VERSION, "0.1.0");
    }
}
