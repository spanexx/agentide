/*
 * Code Map: default Node FileSystem for Plugin Manager persistence
 * - nodeFileSystem: production FileSystem impl — readFile/writeFile/exists backed by fs.promises
 *   writeFile is atomic (write-temp-then-rename inside the same directory) so partial writes cannot corrupt the install-record file
 *
 * CID Index:
 * CID:fs-001 -> nodeFileSystem
 *
 * Quick lookup: rg -n "CID:fs-" packages/plugin-manager/src/fs.ts
 */

import { rename, writeFile as fsWriteFile, readFile as fsReadFile, access, constants } from "node:fs/promises";
import type { FileSystem } from "./types.js";

// CID:fs-001 - nodeFileSystem
// Purpose: production FileSystem impl — read/write/exists via fs.promises; writeFile is atomic via temp+rename
// Used by: createPluginManager when no fs override is supplied
export const nodeFileSystem: FileSystem = {
  async readFile(path: string): Promise<string> {
    return fsReadFile(path, "utf-8");
  },

  async writeFile(path: string, content: string): Promise<void> {
    const tmp = `${path}.tmp`;
    await fsWriteFile(tmp, content, "utf-8");
    await rename(tmp, path);
  },

  async exists(path: string): Promise<boolean> {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  },
};