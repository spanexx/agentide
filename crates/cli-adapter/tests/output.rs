//! Output shaping tests — TTY tables, key:value, pretty vs compact (PRD S3).

/*
 * Code Map: render scenarios
 *
 * CID Index:
 * CID:output-test-001 -> alias tables
 * CID:output-test-002 -> status/health key:value
 * CID:output-test-003 -> invoke pretty vs compact
 * CID:output-test-004 -> piped = compact
 * CID:output-test-005 -> view_for entry-path selection
 *
 * Quick lookup: rg -n "CID:output-test-" crates/cli-adapter/tests/output.rs
 */

use cli_adapter::output::{render, stdout_is_tty, View};
use serde_json::{json, Value};

fn caps() -> Value {
    json!([
        {"name": "session", "version": "1.0.0", "tier": "core"},
        {"name": "plugin", "version": "2.1.0", "tier": "core"}
    ])
}

fn sessions() -> Value {
    json!([
        {"id": "s-1", "status": "active", "created": "2025-07-30"},
        {"id": "s-2", "status": "closed", "created": "2025-07-29"}
    ])
}

fn plugins() -> Value {
    json!([
        {"id": "p-1", "version": "0.3.0", "status": "enabled"},
        {"id": "p-2", "version": "0.1.0", "status": "disabled"}
    ])
}

// CID:output-test-001 - alias tables
#[test]
fn capabilities_table_columns() {
    let out = render(View::Capabilities, &caps(), true);
    let lines: Vec<&str> = out.lines().collect();
    assert!(lines[0].contains("name"));
    assert!(lines[0].contains("version"));
    assert!(lines[0].contains("tier"));
    assert!(out.contains("session"));
    assert!(out.contains("2.1.0"));
}

#[test]
fn sessions_table_columns() {
    let out = render(View::Sessions, &sessions(), true);
    let header = out.lines().next().unwrap();
    assert!(header.contains("id"));
    assert!(header.contains("status"));
    assert!(header.contains("created"));
    assert!(out.contains("s-1"));
    assert!(out.contains("active"));
}

#[test]
fn sessions_table_falls_back_to_created_at() {
    // Real session-manager payloads carry `createdAt` (epoch ms), not
    // `created` — the PRD S3 column must still render.
    let rows = serde_json::json!([
        {"id": "s-9", "status": "active", "createdAt": 1700000000000u64}
    ]);
    let out = render(View::Sessions, &rows, true);
    assert!(out.contains("1700000000000"), "missing epoch value: {out}");
}

#[test]
fn plugins_table_columns() {
    let out = render(View::Plugins, &plugins(), true);
    let header = out.lines().next().unwrap();
    assert!(header.contains("id"));
    assert!(header.contains("version"));
    assert!(header.contains("status"));
    assert!(out.contains("enabled"));
}

// CID:output-test-002 - status/health key:value
#[test]
fn status_renders_kv() {
    let out = render(
        View::StatusHealth,
        &json!({"status": "ok", "uptime_s": 42}),
        true,
    );
    assert!(out.contains("status: ok"));
    assert!(out.contains("uptime_s: 42"));
}

// CID:output-test-003 - invoke pretty vs compact
#[test]
fn invoke_pretty_on_tty() {
    let out = render(View::Invoke, &json!({"ok": true, "n": 1}), true);
    assert!(out.contains("\n"), "pretty JSON spans lines");
    assert!(out.contains("  \"ok\": true"));
}

#[test]
fn invoke_compact_on_pipe() {
    let out = render(View::Invoke, &json!({ "ok": true, "n": 1 }), false);
    assert!(!out.contains('\n'), "compact JSON is one line");
    // serde_json may reorder keys — compare parsed values, not strings.
    let parsed: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(parsed, json!({ "ok": true, "n": 1 }));
}

// CID:output-test-004 - piped = compact
#[test]
fn alias_compact_when_piped() {
    let out = render(View::Capabilities, &caps(), false);
    assert!(!out.contains('\n'), "compact JSON is one line");
    assert!(!out.contains("name  version"), "no table header when piped");
    let parsed: Value = serde_json::from_str(&out).unwrap();
    assert_eq!(parsed, caps());
}

#[test]
fn missing_fields_dash_in_table() {
    let out = render(
        View::Capabilities,
        &json!([{"name": "x", "tier": "core"}]),
        true,
    );
    assert!(out.contains("-"), "missing version renders dash");
}

#[test]
fn stdout_is_terminal_probe_exists() {
    // Just assert the probe runs without panicking.
    let _ = stdout_is_tty();
}

// CID:output-test-005 - view_for entry-path selection
// PRD S3 regression: `platform invoke gateway.status` renders pretty JSON
// (View::Invoke); only the *aliases* render tables/kv.
#[test]
fn view_for_uses_entry_path_not_capability_name() {
    use cli_adapter::output::{view_for, Entry};
    assert_eq!(
        view_for("capability.list", Entry::Alias),
        View::Capabilities
    );
    assert_eq!(view_for("session.list", Entry::Alias), View::Sessions);
    assert_eq!(view_for("plugin.list", Entry::Alias), View::Plugins);
    assert_eq!(view_for("gateway.status", Entry::Alias), View::StatusHealth);
    assert_eq!(view_for("system.health", Entry::Alias), View::StatusHealth);
    // The same capability reached via `invoke` must render as JSON.
    assert_eq!(view_for("gateway.status", Entry::Invoke), View::Invoke);
    assert_eq!(view_for("capability.list", Entry::Invoke), View::Invoke);
    assert_eq!(view_for("custom.cap", Entry::Invoke), View::Invoke);
}
