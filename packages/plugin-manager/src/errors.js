/*
 * Code Map: plugin-manager error codes + structured error class
 * - ERROR_CODES: 16 stable string identifiers, single source of truth
 * - PluginManagerError: Error subclass with code + details for matching
 *
 * CID Index:
 * CID:errors-001 -> ERROR_CODES
 * CID:errors-002 -> PluginManagerError
 *
 * Quick lookup: rg -n "CID:errors-" packages/plugin-manager/src/errors.ts
 */
// CID:errors-001 - ERROR_CODES
// Purpose: stable string identifiers used across every Plugin Manager error path
// Used by: parseManifest, validateManifest, install/update/reload/disable/enable/uninstall, factory
//
// BI[8a] gateway-plugin-dispatch: adds HANDLER_NOT_FOUND (cap name not in the
// plugin's handler map, or plugin has no entry field), HANDLER_LOAD_FAILED
// (entry module failed to dynamic-import at install time), and HANDLER_ERROR
// (the handler itself threw during invocation).
export const ERROR_CODES = {
    SOURCE_NOT_FOUND: "PLUGIN_SOURCE_NOT_FOUND",
    SOURCE_UNREADABLE: "PLUGIN_SOURCE_UNREADABLE",
    MANIFEST_INVALID: "PLUGIN_MANIFEST_INVALID",
    TYPE_MISSING: "PLUGIN_TYPE_MISSING",
    TYPE_AMBIGUOUS: "PLUGIN_TYPE_AMBIGUOUS",
    ID_MISSING: "PLUGIN_ID_MISSING",
    VERSION_MISSING: "PLUGIN_VERSION_MISSING",
    ID_ALREADY_INSTALLED: "PLUGIN_ID_ALREADY_INSTALLED",
    CAPABILITY_NAME_INVALID: "PLUGIN_CAPABILITY_NAME_INVALID",
    CAPABILITY_COLLISION: "PLUGIN_CAPABILITY_COLLISION",
    TIER_REQUIRED: "PLUGIN_TIER_REQUIRED",
    NOT_INSTALLED: "PLUGIN_NOT_INSTALLED",
    SOURCE_CHANGED: "PLUGIN_SOURCE_CHANGED",
    ALREADY_DISABLED: "PLUGIN_ALREADY_DISABLED",
    ALREADY_ENABLED: "PLUGIN_ALREADY_ENABLED",
    CLEANUP_TIMEOUT: "PLUGIN_CLEANUP_TIMEOUT",
    MARKETPLACE_UNAVAILABLE: "PLUGIN_MARKETPLACE_UNAVAILABLE",
    HANDLER_NOT_FOUND: "PLUGIN_HANDLER_NOT_FOUND",
    HANDLER_LOAD_FAILED: "PLUGIN_HANDLER_LOAD_FAILED",
    HANDLER_ERROR: "PLUGIN_HANDLER_ERROR",
};
// CID:errors-002 - PluginManagerError
// Purpose: structured error class — extends Error for stack compatibility; consumers match on .code
// Used by: every error path in the Plugin Manager; the only error class the package throws
export class PluginManagerError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message);
        this.name = "PluginManagerError";
        this.code = code;
        this.details = details;
    }
}
