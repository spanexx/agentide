/*
 * Code Map: tier inference from cap name.
 *
 * DOM read (driver.ts:readCaps) only sees cap names — it never sees
 * plugin manifests. To keep browser-runtime independent of
 * plugin-manager, the verb tables are mirrored here verbatim from
 * `plugin-manager/src/tier-convention.ts`. Adding a new verb to
 * one place must also add it to the other (drift risk — the
 * plugin-manager version is authoritative; this is a fast-path
 * mirror for DOM-discovered caps).
 *
 * CID Index:
 * CID:tier-001 -> tierFromName
 *
 * Quick lookup: rg -n "CID:tier-" packages/browser-runtime/src/tier.ts
 */

const READ_VERBS = new Set(["read", "list", "get", "view", "show", "describe", "fetch", "query", "count", "is", "has"]);
const ACT_VERBS = new Set([
  "write", "set", "put", "create", "update", "edit", "patch", "append", "push",
  "post", "send", "open", "close", "start", "stop", "restart", "pause", "resume",
  "navigate", "goto", "click", "doubleclick", "hover", "type", "press", "select",
  "scroll", "wait", "upload", "download", "run", "exec", "execute", "install",
  "enable", "disable", "reload", "touch", "move", "copy", "rename",
]);
const DESTRUCTIVE_VERBS = new Set([
  "delete", "remove", "drop", "destroy", "purge", "wipe", "reset", "clear",
  "truncate", "commit", "merge", "rebase", "push", "checkout",
]);

// CID:tier-001 - tierFromName
// Purpose: classify a `<domain>.<verb>` cap name into the tier the
//   gateway expects (read | act | destructive). Last segment is the
//   verb; missing/unknown verbs default to "act" (matches
//   sdk-browser defaultTier so the agent loop keeps working on
//   unknown caps).
// Uses: verb sets above
// Used by: driver.ts (readCaps); manifest.test.ts (parity check)
export function tierFromName(name: string): "read" | "act" | "destructive" {
  const parts = name.split(".");
  const verb = (parts[parts.length - 1] ?? "").toLowerCase();
  if (READ_VERBS.has(verb)) return "read";
  if (ACT_VERBS.has(verb)) return "act";
  if (DESTRUCTIVE_VERBS.has(verb)) return "destructive";
  return "act"; // sdk-browser defaultTier
}
