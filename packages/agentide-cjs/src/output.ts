// CID:output-001 - renderTable / renderKeyValue / renderJson
// Purpose: TTY-aware output shaping (PRD S3 / GRILL Q5).
//   TTY + alias → table (name/version/tier | id/status/created)
//   TTY + status/health → key:value
//   TTY + invoke → pretty JSON (2-space)
//   non-TTY OR --json → compact one-line JSON (script-safe)
// Used by: consumer.ts
export type YamlValue =
  | string | number | boolean | null
  | readonly YamlValue[]
  | { readonly [key: string]: YamlValue };

export interface RenderOpts {
  json: boolean; // --json forces compact regardless of TTY
  isTTY: boolean;
  width?: number; // max table width (default 120)
}

// columns: header names; rows: values in the same order
export function renderTable(columns: readonly string[], rows: readonly (readonly string[])[], opts: RenderOpts): string {
  if (rows.length === 0) return "";
  const widths = columns.map((c, i) =>
    Math.max(c.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const limit = opts.width ?? 120;
  const sep = 3;
  const pad = (s: string, w: number): string => s.padEnd(w);
  const fit = (s: string, budget: number): string =>
    s.length > budget ? s.slice(0, Math.max(budget - 1, 1)) + "…" : s;
  const lines: string[] = [];
  const emit = (cells: readonly string[]): void => {
    // truncate the last column first so the row fits the width limit
    let total = widths.reduce((a, b) => a + b, 0) + sep * (columns.length - 1);
    const values = cells.map((c, i) => pad(c, widths[i]));
    while (total > limit && values.length > 1) {
      const last = values.length - 1;
      const over = total - limit;
      const cut = Math.min(widths[last], over + (values[last].endsWith(" ") ? 1 : 0));
      values[last] = fit(values[last].trimEnd(), Math.max(widths[last] - cut, 1));
      total -= cut;
    }
    lines.push(values.join(" ".repeat(sep)).trimEnd());
  };
  emit(columns);
  for (const row of rows) emit(row);
  return lines.join("\n");
}

export function renderKeyValue(obj: { readonly [key: string]: YamlValue }, opts: RenderOpts): string {
  if (opts.json) return JSON.stringify(obj);
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`)
    .join("\n");
}

export function renderJson(value: YamlValue, opts: RenderOpts): string {
  if (opts.json || !opts.isTTY) return JSON.stringify(value);
  return JSON.stringify(value, null, 2);
}
