/*
 * Code Map: plugin-manager tier convention
 * - READ_VERBS, ACT_VERBS, DESTRUCTIVE_VERBS: hardcoded verb lists per BI[7]
 *   (GRILL Decision 6). When a runtime plugin author writes a manifest cap
 *   name like "browser.navigate", the verb (navigate) maps to a tier.
 * - tierFromConvention: looks up a cap name's last segment as a verb; returns
 *   the inferred tier or null if ambiguous.
 *
 * CID Index:
 * CID:tier-001 -> tierFromConvention
 *
 * Quick lookup: rg -n "CID:tier-" packages/plugin-manager/src/tier-convention.ts
 */

const READ_VERBS = new Set([
  "read", "list", "get", "view", "show", "describe", "fetch", "query",
  "count", "is", "has",
]);

const ACT_VERBS = new Set([
  "write", "set", "put", "create", "update", "edit", "patch", "append",
  "push", "post", "send", "open", "close", "start", "stop", "restart",
  "pause", "resume", "navigate", "goto", "click", "doubleclick", "hover",
  "type", "press", "select", "scroll", "wait", "upload", "download",
  "run", "exec", "execute", "install", "enable", "disable", "reload",
  "touch", "move", "copy", "rename",
]);

const DESTRUCTIVE_VERBS = new Set([
  "delete", "remove", "drop", "destroy", "purge", "wipe", "reset",
  "clear", "truncate", "commit", "merge", "rebase", "push", "checkout",
]);

// CID:tier-001 - tierFromConvention
// Purpose: infer a capability's tier from its action name when the plugin
//   manifest doesn't declare one explicitly. Splits "domain.action" and
//   looks up the verb segment.
// Returns: "read" | "act" | "destructive" | null
//   - null means the verb is ambiguous and the plugin author MUST declare
//     tier explicitly in the manifest.
// Used by: lifecycle.ts install() — when no explicit tier is given
export function tierFromConvention(capName: string): "read" | "act" | "destructive" | null {
  // Cap names look like "browser.navigate" or "browser.screenshot".
  // The last segment is the verb; the first is the domain.
  const parts = capName.split(".");
  if (parts.length < 2) return null;
  const verb = parts[parts.length - 1]!.toLowerCase();
  if (READ_VERBS.has(verb)) return "read";
  if (ACT_VERBS.has(verb)) return "act";
  if (DESTRUCTIVE_VERBS.has(verb)) return "destructive";
  return null;
}

// Exported for tests
export const _INTERNAL = { READ_VERBS, ACT_VERS: ACT_VERBS, DESTRUCTIVE_VERBS };