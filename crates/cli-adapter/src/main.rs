/*
 * Code Map: platform CLI binary entry
 * - main: arg dispatch — --version, else usage stub (Phase 5 adds subcommands)
 *
 * CID Index:
 * CID:main-001 -> main
 *
 * Quick lookup: rg -n "CID:main-" crates/cli-adapter/src/main.rs
 */

use std::process::ExitCode;

use cli_adapter::errors::ExitCode as CmdExit;

// CID:main-001 - main
// Purpose: parse args, dispatch, return process exit code (PRD S5).
fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    match args.first().map(String::as_str) {
        Some("--version") | Some("-V") => {
            println!("platform {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("platform — Agentide remote gateway CLI");
            eprintln!("usage: platform <subcommand> [flags]");
            ExitCode::from(CmdExit::PreFlight.as_u8()) // usage error → 2 (PRD S5)
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_is_0_1_0() {
        assert_eq!(env!("CARGO_PKG_VERSION"), "0.1.0");
    }
}
