import { describe, it, expect } from "vitest";
import { matches } from "./index.js";

describe("matches (wildcard grammar)", () => {
  it("matches exact names", () => {
    expect(matches("browser.page.loaded", "browser.page.loaded")).toBe(true);
  });

  it("does not match different exact names", () => {
    expect(matches("browser.page.loaded", "browser.tab.opened")).toBe(false);
  });

  it("does not match different depths on exact", () => {
    expect(matches("browser.page", "browser.page.loaded")).toBe(false);
    expect(matches("browser.page.loaded", "browser.page")).toBe(false);
  });

  it("`*` matches exactly one segment after the prefix", () => {
    expect(matches("browser.*", "browser.started")).toBe(true);
    expect(matches("browser.*", "browser.page.loaded")).toBe(false);
  });

  it("`**` matches any depth including the prefix-only event", () => {
    expect(matches("**", "browser.started")).toBe(true);
    expect(matches("**", "browser.page.loaded")).toBe(true);
    expect(matches("**", "capability.registered")).toBe(true);
    expect(matches("**", "anything.at.any.depth")).toBe(true);
  });

  it("prefix plus `**` matches any deeper event", () => {
    expect(matches("browser.**", "browser.started")).toBe(true);
    expect(matches("browser.**", "browser.page.loaded")).toBe(true);
  });
});