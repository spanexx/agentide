// Test fixture for gateway-plugin-dispatch BI[8a.
// Exports a handlers map keyed by capability name.
// Loaded by the plugin manager via dynamic import at install time.

export default {
  "browser.navigate": async (input, _ctx) => {
    return { navigated: true, url: input.url };
  },
  "browser.click": async (input, _ctx) => {
    return { clicked: true, selector: input.selector };
  },
  "browser.screenshot": async (_input, _ctx) => {
    return { screenshot: "base64data..." };
  },
};
