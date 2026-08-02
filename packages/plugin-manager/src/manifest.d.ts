import type { PluginManifest, PluginType, YamlParser } from "./types.js";
export declare function parseManifest(content: string, yaml: YamlParser): PluginManifest;
export declare function validateManifest(manifest: PluginManifest): void;
export declare function manifestType(manifest: PluginManifest): PluginType;
export declare function manifestId(manifest: PluginManifest, type: PluginType): string;
