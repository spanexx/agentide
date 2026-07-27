/*
 * Code Map: default YamlParser for Plugin Manager
 * - nodeYamlParser: production YamlParser impl — wraps the `yaml` npm package's parse()
 *
 * CID Index:
 * CID:yaml-001 -> nodeYamlParser
 *
 * Quick lookup: rg -n "CID:yaml-" packages/plugin-manager/src/yaml.ts
 */

import { parse } from "yaml";
import type { YamlParser } from "./types.js";

// CID:yaml-001 - nodeYamlParser
// Purpose: production YamlParser impl — wraps yaml.parse() so callers can inject a fake for tests
// Used by: createPluginManager when no yaml override is supplied
export const nodeYamlParser: YamlParser = {
  parse: (source: string) => parse(source),
};