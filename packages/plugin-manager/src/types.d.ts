import type { EventBus } from "@platform/event-bus";
import type { CapabilityTier } from "@platform/capability-registry";
export type PluginType = "runtime" | "service" | "developer";
/**
 * One entry in a plugin manifest's `capabilities` list.
 * Either a plain string ("browser.navigate") or an object with explicit tier
 * ("browser.screenshot" has no convention, so author declares tier: read).
 */
export type ManifestCapability = string | {
    readonly name: string;
    readonly tier: CapabilityTier;
};
export interface PluginManifest {
    readonly runtime?: {
        readonly id: string;
        readonly entry?: string;
    };
    readonly service?: {
        readonly id: string;
    };
    readonly developer?: {
        readonly id: string;
    };
    readonly version: string;
    readonly capabilities?: readonly ManifestCapability[];
    readonly metadata?: Readonly<Record<string, string>>;
}
export interface InstallRecord {
    readonly id: string;
    readonly type: PluginType;
    readonly version: string;
    readonly source: string;
    readonly installedAt: number;
    readonly enabled: boolean;
    readonly lastError?: PluginError & {
        readonly at: number;
    };
}
export interface PluginError {
    readonly code: string;
    readonly message: string;
    readonly details: Readonly<Record<string, YamlValue>>;
}
export interface PluginManagerConfig {
    readonly installRecordPath?: string;
    readonly cleanupTimeoutMs?: number;
    readonly clock?: Clock;
    readonly fs?: FileSystem;
    readonly yaml?: YamlParser;
}
export interface Clock {
    now(): number;
    setTimeout(callback: () => void, delayMs: number): number;
    clearTimeout(handle: number): void;
}
export interface FileSystem {
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
}
export interface YamlParser {
    parse(source: string): YamlValue;
}
export interface PluginInstalledPayload {
    readonly id: string;
    readonly type: PluginType;
    readonly version: string;
    readonly source: string;
    readonly installedAt: number;
}
export interface PluginUpdatedPayload {
    readonly id: string;
    readonly oldVersion: string;
    readonly newVersion: string;
    readonly source: string;
    readonly updatedAt: number;
}
export interface PluginReloadedPayload {
    readonly id: string;
    readonly version: string;
    readonly reloadedAt: number;
}
export interface PluginUninstalledPayload {
    readonly id: string;
    readonly uninstalledAt: number;
}
export interface PluginEnabledPayload {
    readonly id: string;
    readonly enabledAt: number;
}
export interface PluginDisabledPayload {
    readonly id: string;
    readonly disabledAt: number;
}
export interface PluginCleanupPayload {
    readonly id: string;
}
export interface PluginHandlerLoadedPayload {
    readonly id: string;
    readonly version: string;
    readonly loadedAt: number;
    readonly ok: boolean;
    readonly error?: string;
}
export interface PluginHandlerErrorPayload {
    readonly id: string;
    readonly capability: string;
    readonly at: number;
    readonly error: string;
}
export interface PluginManager {
    install(source: string): Promise<InstallRecord>;
    installFromRegistry(id: string): Promise<InstallRecord>;
    update(id: string, source: string): Promise<InstallRecord>;
    reload(id: string): Promise<InstallRecord>;
    disable(id: string): Promise<InstallRecord>;
    enable(id: string): Promise<InstallRecord>;
    uninstall(id: string): Promise<void>;
    /**
     * BI[8a] gateway-plugin-dispatch. Invoke a runtime plugin's handler by capability
     * name. The plugin must have a `runtime.entry` in its manifest; the entry is
     * loaded via dynamic import at install time. Throws HANDLER_NOT_FOUND or
     * PLUGIN_DISABLED on lookup failure; throws HANDLER_ERROR if the handler
     * itself throws.
     *
     * @param name Capability name (e.g. "browser.navigate"). Must match a key
     *   in the plugin's handler map.
     * @param input The CapabilityInvocation input. Passed through to the handler.
     * @param sessionId Optional session id from the caller's CanonicalInvocation.
     *   Forwarded to the handler's context argument.
     */
    handleInvocation(name: string, input: YamlValue, sessionId: string | undefined): Promise<YamlValue>;
    list(): readonly InstallRecord[];
    get(id: string): InstallRecord | null;
}
export type PluginEventBus = EventBus;
/**
 * Recursive YAML value type — narrows away from `any`/`unknown` so the package
 * passes the project's banned-types check. Covers every value the `yaml` package
 * can produce: scalars, sequences, and mappings.
 */
export type YamlValue = string | number | boolean | null | readonly YamlValue[] | {
    readonly [key: string]: YamlValue;
};
