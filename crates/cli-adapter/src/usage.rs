//! Usage text — the PRD binary surface documented in one place.

/*
 * Code Map: `--help` / usage-error output
 * - print_usage: full flag surface (all 10 flags), stdout on --help,
 *   stderr on usage errors
 *
 * CID Index:
 * CID:usage-001 -> print_usage
 *
 * Quick lookup: rg -n "CID:usage-" crates/cli-adapter/src/usage.rs
 */

/// Full usage text (PRD binary surface). `--help` prints it to stdout with
/// exit 0; usage *errors* print it to stderr with exit 2.
// CID:usage-001 - print_usage
// Purpose: single source for the documented CLI surface; the flag-surface
// integration test pins it so --url/--token/--help cannot silently regress.
pub fn print_usage(w: &mut impl std::io::Write) {
    let _ = writeln!(w, "platform — Agentide remote gateway CLI");
    let _ = writeln!(w, "usage: platform <alias|invoke <capability>> [flags]");
    let _ = writeln!(w, "       platform --help | --version");
    let _ = writeln!(
        w,
        "aliases: capabilities, sessions, plugins, status, health"
    );
    let _ = writeln!(w, "flags:");
    let _ = writeln!(
        w,
        "  --url <ws://host/ws>        gateway URL (flag > env > config > prompt)"
    );
    let _ = writeln!(
        w,
        "  --token <jwt|path:/...>     auth token or token file (same precedence)"
    );
    let _ = writeln!(w, "  --config <path>             TOML config file");
    let _ = writeln!(w, "  --args '<json>'             invoke input payload");
    let _ = writeln!(
        w,
        "  --session <id>              invoke in an existing session"
    );
    let _ = writeln!(w, "  --json                      force compact JSON output");
    let _ = writeln!(w, "  --watch                     stream mode (Phase 6)");
    let _ = writeln!(
        w,
        "  --topic <pattern>           stream subscription (Phase 6)"
    );
    let _ = writeln!(w, "  --help, -h                  this help, exit 0");
    let _ = writeln!(w, "  --version, -V               version, exit 0");
}
