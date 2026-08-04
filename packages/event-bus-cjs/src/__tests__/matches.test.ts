import { describe, it, expect } from "vitest";
import { matches } from "../index";

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

  it("prefix wildcard `a.b.*` matches any depth under that prefix", () => {
    expect(matches("browser.*", "browser.started")).toBe(true);
    expect(matches("browser.*", "browser.page.loaded")).toBe(true);
    expect(matches("browser.*", "browser.navigation.completed")).toBe(true);
  });

  it("prefix wildcard does not match unrelated names", () => {
    expect(matches("browser.*", "session.created")).toBe(false);
    expect(matches("browser.*", "capability.registered")).toBe(false);
  });

  it("bare `*` matches every event name", () => {
    expect(matches("*", "browser.started")).toBe(true);
    expect(matches("*", "browser.page.loaded")).toBe(true);
    expect(matches("*", "capability.registered")).toBe(true);
    expect(matches("*", "anything.at.any.depth")).toBe(true);
  });
});
