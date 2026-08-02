/*
 * Code Map: plugin-manager public contracts
 * - PluginType: discriminator union (runtime / service / developer)
 * - PluginManifest: parsed YAML shape; one of three top-level type keys
 * - InstallRecord: durable state per installed plugin (persisted to disk)
 * - PluginError / PluginManagerError: structured error shape + class
 * - PluginManagerConfig / Clock / FileSystem / YamlParser: factory config + injectable seams
 * - Event payloads: seven plugin.* event contracts (one per event)
 * - PluginManager: public lifecycle API (9 methods)
 *
 * CID Index:
 * CID:types-001 -> PluginType
 * CID:types-002 -> PluginManifest
 * CID:types-003 -> InstallRecord
 * CID:types-004 -> PluginError
 * CID:types-005 -> PluginManagerConfig
 * CID:types-006 -> Clock
 * CID:types-007 -> FileSystem
 * CID:types-008 -> YamlParser
 * CID:types-009 -> PluginInstalledPayload
 * CID:types-010 -> PluginUpdatedPayload
 * CID:types-011 -> PluginReloadedPayload
 * CID:types-012 -> PluginUninstalledPayload
 * CID:types-013 -> PluginEnabledPayload
 * CID:types-014 -> PluginDisabledPayload
 * CID:types-015 -> PluginCleanupPayload
 * CID:types-016 -> PluginManager
 *
 * Quick lookup: rg -n "CID:types-" packages/plugin-manager/src/types.ts
 */
export {};
