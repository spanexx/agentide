# @spanexx/browser-runtime

Runtime plugin that provides `browser.*` capabilities (launch, navigate, click, type, scroll, wait, screenshot, tab ops). session-scoped — each session gets its own BrowserContext. No `browser.*` capabilities exist outside this plugin. `@platform/sdk-browser` is a separate SDK for *application* caps from the page; this package is the *automation* side.

## install

```bash
npm install @spanexx/browser-runtime
```

## usage

```typescript
import { registerBrowserRuntime } from '@platform/browser-runtime';

registerBrowserRuntime(capabilityRegistry, sessionManager, pluginManager);
```

## public surface (11 caps)

`browser.launch` `{mode?: 'headless'|'headed'}` · `browser.navigate` `{url, tabId?, newTab?, waitUntil?, timeout?}` · `browser.click` `{selector, tabId?, button?}` · `browser.type` `{selector, text, tabId?, delayMs?}` · `browser.scroll` `{direction, px?, tabId?, selector?}` · `browser.wait` discriminated union `{wait:'selector', selector, state?, timeout?}` | `{wait:'time', ms}` · `browser.close` `{tabId?}` · `browser.screenshot` `{tabId?, fullPage?, format?, quality?, mode?}` · `browser.tab.open` / `tab.switch` / `tab.close`.

## tabs

each `tabId` is numeric (0 = first tab on launch). per-tab caps take optional `tabId` (defaults to most recent). `browser.close` with `tabId` closes one tab; without it tears down the session context. never kills the shared Chromium process.

## screenshots

discriminated `{format:'png'|'jpeg', mode:'inline'|'resource', data?, resourceId?, bytes}`. inline cap = 256 KiB pre-base64 (context protection for LLMs). resource mode stores in session resource dir, cleaned up on `session.destroyed`.

## integration

depends on capability-registry + session-manager + plugin-manager + event-bus + errors. registered via plugin-manager install from a `runtime: { id: 'browser' }` manifest. playwright (with `@playwright/browser-chromium` exact-pinned) is the underlying driver.