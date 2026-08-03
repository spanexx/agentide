//! Output shaping — TTY tables vs compact JSON (PRD S3).

/*
 * Code Map: render path
 * - stdout_is_tty: IsTerminal probe (Phase 5 wires --json force)
 * - render: alias-aware — tables / key:value / pretty vs compact JSON
 *
 * CID Index:
 * CID:output-001 -> stdout_is_tty
 * CID:output-002 -> render
 * CID:output-003 -> render_table
 * CID:output-004 -> render_kv
 *
 * Quick lookup: rg -n "CID:output-" crates/cli-adapter/src/output.rs
 */

use std::io::IsTerminal;

use serde_json::Value;

/// Which viewer the output targets — decides table shape (PRD S3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum View {
    /// Aliases: capabilities/sessions/plugins render tables.
    Capabilities,
    Sessions,
    Plugins,
    /// status/health render key:value lines.
    StatusHealth,
    /// `invoke <cap>` renders JSON (pretty on TTY, compact piped).
    Invoke,
}

// CID:output-001 - stdout_is_tty
// Purpose: PRD S3 — TTY gets tables/pretty, piped gets compact JSON.
pub fn stdout_is_tty() -> bool {
    std::io::stdout().is_terminal()
}

/// Render a result for the given view. `tty` = stdout is a terminal;
/// Phase 5 forces `false` when `--json` is passed.
///
/// PRD S3: TTY → tables (aliases) or key:value (status/health) or pretty
/// JSON (invoke). Piped or `--json` → compact JSON, one line.
// CID:output-002 - render
pub fn render(view: View, result: &Value, tty: bool) -> String {
    if !tty {
        return compact_json(result);
    }
    match view {
        View::Invoke => pretty_json(result),
        View::StatusHealth => render_kv(result),
        View::Capabilities => render_table(result, &["name", "version", "tier"]),
        View::Sessions => render_table(result, &["id", "status", "created"]),
        View::Plugins => render_table(result, &["id", "version", "status"]),
    }
}

/// Alias tables: columns from the first row, then padded rows (PRD S3).
/// Rows are objects in the result array; non-object rows are skipped.
/// String cell without JSON quotes; other scalars via Display.
fn cell_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

// CID:output-003 - render_table
pub fn render_table(result: &Value, columns: &[&str]) -> String {
    let rows: Vec<&Value> = result
        .as_array()
        .map(|a| a.iter().filter(|v| v.is_object()).collect())
        .unwrap_or_default();

    let cell = |row: &Value, col: &str| -> String {
        row.get(col)
            .map(cell_str)
            .unwrap_or_else(|| "-".to_string())
    };

    let widths: Vec<usize> = columns
        .iter()
        .map(|col| {
            let mut w = col.len();
            for row in &rows {
                w = w.max(cell(row, col).len());
            }
            w
        })
        .collect();

    let mut out = String::new();
    let fmt_row = |vals: Vec<String>| -> String {
        vals.iter()
            .enumerate()
            .map(|(i, v)| {
                let pad = widths[i].saturating_sub(v.len());
                format!("{v}{}", " ".repeat(pad))
            })
            .collect::<Vec<_>>()
            .join("  ")
    };
    out.push_str(&fmt_row(columns.iter().map(|c| c.to_string()).collect()));
    out.push('\n');
    out.push_str(&"-".repeat(widths.iter().sum::<usize>() + 2 * (widths.len() - 1)));
    out.push('\n');
    for row in rows {
        out.push_str(&fmt_row(columns.iter().map(|c| cell(row, c)).collect()));
        out.push('\n');
    }
    out
}

/// status/health: one `key: value` line per object entry (PRD S3).
// CID:output-004 - render_kv
pub fn render_kv(result: &Value) -> String {
    let mut out = String::new();
    if let Some(obj) = result.as_object() {
        let mut keys: Vec<&String> = obj.keys().collect();
        keys.sort();
        for k in keys {
            let v = obj.get(k).map(cell_str).unwrap_or_default();
            out.push_str(&format!("{k}: {v}\n"));
        }
    }
    out
}

fn compact_json(result: &Value) -> String {
    serde_json::to_string(result).unwrap_or_else(|_| "{}".to_string())
}

fn pretty_json(result: &Value) -> String {
    serde_json::to_string_pretty(result).unwrap_or_else(|_| "{}".to_string())
}
