import type { PluginError, YamlValue } from "./types.js";
export declare const ERROR_CODES: {
    readonly SOURCE_NOT_FOUND: "PLUGIN_SOURCE_NOT_FOUND";
    readonly SOURCE_UNREADABLE: "PLUGIN_SOURCE_UNREADABLE";
    readonly MANIFEST_INVALID: "PLUGIN_MANIFEST_INVALID";
    readonly TYPE_MISSING: "PLUGIN_TYPE_MISSING";
    readonly TYPE_AMBIGUOUS: "PLUGIN_TYPE_AMBIGUOUS";
    readonly ID_MISSING: "PLUGIN_ID_MISSING";
    readonly VERSION_MISSING: "PLUGIN_VERSION_MISSING";
    readonly ID_ALREADY_INSTALLED: "PLUGIN_ID_ALREADY_INSTALLED";
    readonly CAPABILITY_NAME_INVALID: "PLUGIN_CAPABILITY_NAME_INVALID";
    readonly CAPABILITY_COLLISION: "PLUGIN_CAPABILITY_COLLISION";
    readonly TIER_REQUIRED: "PLUGIN_TIER_REQUIRED";
    readonly NOT_INSTALLED: "PLUGIN_NOT_INSTALLED";
    readonly SOURCE_CHANGED: "PLUGIN_SOURCE_CHANGED";
    readonly ALREADY_DISABLED: "PLUGIN_ALREADY_DISABLED";
    readonly ALREADY_ENABLED: "PLUGIN_ALREADY_ENABLED";
    readonly CLEANUP_TIMEOUT: "PLUGIN_CLEANUP_TIMEOUT";
    readonly MARKETPLACE_UNAVAILABLE: "PLUGIN_MARKETPLACE_UNAVAILABLE";
    readonly HANDLER_NOT_FOUND: "PLUGIN_HANDLER_NOT_FOUND";
    readonly HANDLER_LOAD_FAILED: "PLUGIN_HANDLER_LOAD_FAILED";
    readonly HANDLER_ERROR: "PLUGIN_HANDLER_ERROR";
};
export declare class PluginManagerError extends Error implements PluginError {
    readonly code: string;
    readonly details: Readonly<Record<string, YamlValue>>;
    constructor(code: string, message: string, details?: Readonly<Record<string, YamlValue>>);
}
