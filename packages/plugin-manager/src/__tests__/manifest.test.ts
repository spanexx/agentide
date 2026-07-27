import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  ERROR_CODES,
  PluginManagerError,
  type PluginManifest,
  type YamlParser,
  type YamlValue,
} from "../index.js";
import {
  manifestId,
  manifestType,
  parseManifest,
  validateManifest,
} from "../manifest.js";

const realYaml: YamlParser = { parse: (src) => parse(src) as YamlValue };

function makeYaml(returnValue: unknown): YamlParser {
  return { parse: () => returnValue as YamlValue };
}

describe("parseManifest", () => {
  it("parses valid YAML into PluginManifest shape", () => {
    const content = [
      "runtime:",
      "  id: browser",
      "version: \"1.0\"",
      "capabilities:",
      "  - browser.navigate",
      "  - browser.click",
    ].join("\n");
    const manifest = parseManifest(content, realYaml);
    expect(manifest.runtime?.id).toBe("browser");
    expect(manifest.version).toBe("1.0");
    expect(manifest.capabilities).toEqual(["browser.navigate", "browser.click"]);
  });

  it("wraps YAMLParseError with line and column in details", () => {
    const bad = "runtime:\n  id: 'unclosed";
    try {
      parseManifest(bad, realYaml);
      expect.fail("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PluginManagerError);
      const e = err as PluginManagerError;
      expect(e.code).toBe(ERROR_CODES.MANIFEST_INVALID);
      expect(e.details.line).toEqual(expect.any(Number));
      expect(e.details.column).toEqual(expect.any(Number));
    }
  });

  it("rejects non-object YAML with PLUGIN_MANIFEST_INVALID", () => {
    const yaml = makeYaml("just-a-string");
    try {
      parseManifest("ignored", yaml);
      expect.fail("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PluginManagerError);
      expect((err as PluginManagerError).code).toBe(ERROR_CODES.MANIFEST_INVALID);
    }
  });

  it("rejects type key whose value is not an object", () => {
    const yaml = makeYaml({ runtime: "not-an-object", version: "1.0" });
    try {
      parseManifest("ignored", yaml);
      expect.fail("should throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PluginManagerError);
      expect((err as PluginManagerError).code).toBe(ERROR_CODES.MANIFEST_INVALID);
    }
  });

  it("rejects type key whose id is not a string", () => {
    const yaml = makeYaml({ runtime: { id: 42 }, version: "1.0" });
    try {
      parseManifest("ignored", yaml);
      expect.fail("should throw");
    } catch (err) {
      expect((err as PluginManagerError).code).toBe(ERROR_CODES.MANIFEST_INVALID);
    }
  });

  it("rejects non-string version", () => {
    const yaml = makeYaml({ runtime: { id: "browser" }, version: 1 });
    try {
      parseManifest("ignored", yaml);
      expect.fail("should throw");
    } catch (err) {
      expect((err as PluginManagerError).code).toBe(ERROR_CODES.MANIFEST_INVALID);
    }
  });

  it("rejects non-array capabilities", () => {
    const yaml = makeYaml({ runtime: { id: "browser" }, version: "1.0", capabilities: "not-array" });
    try {
      parseManifest("ignored", yaml);
      expect.fail("should throw");
    } catch (err) {
      expect((err as PluginManagerError).code).toBe(ERROR_CODES.MANIFEST_INVALID);
    }
  });

  it("rejects non-string capability entries", () => {
    const yaml = makeYaml({ runtime: { id: "browser" }, version: "1.0", capabilities: [1, 2] });
    try {
      parseManifest("ignored", yaml);
      expect.fail("should throw");
    } catch (err) {
      expect((err as PluginManagerError).code).toBe(ERROR_CODES.MANIFEST_INVALID);
    }
  });

  it("rejects non-object metadata", () => {
    const yaml = makeYaml({ runtime: { id: "browser" }, version: "1.0", metadata: "not-object" });
    try {
      parseManifest("ignored", yaml);
      expect.fail("should throw");
    } catch (err) {
      expect((err as PluginManagerError).code).toBe(ERROR_CODES.MANIFEST_INVALID);
    }
  });

  it("rejects metadata with non-string values", () => {
    const yaml = makeYaml({ runtime: { id: "browser" }, version: "1.0", metadata: { foo: 1 } });
    try {
      parseManifest("ignored", yaml);
      expect.fail("should throw");
    } catch (err) {
      expect((err as PluginManagerError).code).toBe(ERROR_CODES.MANIFEST_INVALID);
    }
  });
});

describe("validateManifest", () => {
  function runtime(): PluginManifest {
    return { runtime: { id: "browser" }, version: "1.0" };
  }

  it("accepts a runtime manifest", () => {
    expect(() => validateManifest(runtime())).not.toThrow();
  });

  it("accepts a service manifest", () => {
    expect(() => validateManifest({ service: { id: "logging" }, version: "1.0" })).not.toThrow();
  });

  it("accepts a developer manifest", () => {
    expect(() => validateManifest({ developer: { id: "vscode" }, version: "1.0" })).not.toThrow();
  });

  it("rejects zero type keys with PLUGIN_TYPE_MISSING", () => {
    try {
      validateManifest({ version: "1.0" } as PluginManifest);
      expect.fail("should throw");
    } catch (err) {
      expect((err as PluginManagerError).code).toBe(ERROR_CODES.TYPE_MISSING);
    }
  });

  it("rejects two type keys with PLUGIN_TYPE_AMBIGUOUS", () => {
    try {
      validateManifest({
        runtime: { id: "browser" },
        service: { id: "logging" },
        version: "1.0",
      });
      expect.fail("should throw");
    } catch (err) {
      const e = err as PluginManagerError;
      expect(e.code).toBe(ERROR_CODES.TYPE_AMBIGUOUS);
      expect(e.details.found).toEqual(["runtime", "service"]);
    }
  });

  it("rejects missing id with PLUGIN_ID_MISSING", () => {
    try {
      validateManifest({ runtime: { id: "" }, version: "1.0" });
      expect.fail("should throw");
    } catch (err) {
      expect((err as PluginManagerError).code).toBe(ERROR_CODES.ID_MISSING);
    }
  });

  it("rejects missing version with PLUGIN_VERSION_MISSING", () => {
    try {
      validateManifest({ runtime: { id: "browser" }, version: "" });
      expect.fail("should throw");
    } catch (err) {
      expect((err as PluginManagerError).code).toBe(ERROR_CODES.VERSION_MISSING);
    }
  });

  it("rejects invalid capability name (uppercase first char) with PLUGIN_CAPABILITY_NAME_INVALID", () => {
    try {
      validateManifest({ runtime: { id: "browser" }, version: "1.0", capabilities: ["Browser.navigate"] });
      expect.fail("should throw");
    } catch (err) {
      const e = err as PluginManagerError;
      expect(e.code).toBe(ERROR_CODES.CAPABILITY_NAME_INVALID);
      expect(e.details.capability).toBe("Browser.navigate");
    }
  });

  it("rejects invalid capability name (space) with PLUGIN_CAPABILITY_NAME_INVALID", () => {
    try {
      validateManifest({ runtime: { id: "browser" }, version: "1.0", capabilities: ["browser navigate"] });
      expect.fail("should throw");
    } catch (err) {
      expect((err as PluginManagerError).code).toBe(ERROR_CODES.CAPABILITY_NAME_INVALID);
    }
  });

  it("accepts valid capability names (domain.action)", () => {
    const ok = [
      "browser.navigate",
      "customer.read",
      "git.push",
      "my-plugin.do_thing",
      "my-plugin.do-thing",
    ];
    for (const cap of ok) {
      expect(() =>
        validateManifest({ runtime: { id: "browser" }, version: "1.0", capabilities: [cap] }),
      ).not.toThrow();
    }
  });

  it("accepts a manifest with no capabilities field", () => {
    expect(() => validateManifest(runtime())).not.toThrow();
  });

  it("rejects the first invalid capability (lists index)", () => {
    try {
      validateManifest({
        runtime: { id: "browser" },
        version: "1.0",
        capabilities: ["browser.navigate", "BAD.one"],
      });
      expect.fail("should throw");
    } catch (err) {
      const e = err as PluginManagerError;
      expect(e.code).toBe(ERROR_CODES.CAPABILITY_NAME_INVALID);
      expect(e.details.capability).toBe("BAD.one");
      expect(e.details.index).toBe(1);
    }
  });
});

describe("manifestType", () => {
  it("returns 'runtime' for runtime manifests", () => {
    expect(manifestType({ runtime: { id: "x" }, version: "1.0" })).toBe("runtime");
  });
  it("returns 'service' for service manifests", () => {
    expect(manifestType({ service: { id: "x" }, version: "1.0" })).toBe("service");
  });
  it("returns 'developer' for developer manifests", () => {
    expect(manifestType({ developer: { id: "x" }, version: "1.0" })).toBe("developer");
  });
});

describe("manifestId", () => {
  it("returns the id for the given type", () => {
    const m: PluginManifest = { runtime: { id: "browser" }, version: "1.0" };
    expect(manifestId(m, "runtime")).toBe("browser");
  });
});