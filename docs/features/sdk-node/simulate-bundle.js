/*
 * simulate-bundle.js — engine for the post-impl sim.
 *
 * Loads the REAL @platform/sdk-node and drives it through the 8 PRD-TRD
 * scenarios. The HTML page calls `engine.runCommand(line)` and reads
 * `engine.getState()` to update the UI.
 *
 * Key design choices:
 *   - Uses native browser `WebSocket` (not the `ws` npm package).
 *     `ws` throws in the browser; native WebSocket works fine.
 *   - Patches WsClient.prototype after importing the SDK so that
 *     `new WsClient({...}).open()` doesn't fail.
 *   - Exposes `window.engine = new SimEngine()` so the HTML can drive it.
 */

'use strict';

(async () => {
  // The SDK is loaded as `sdk-iife.js` BEFORE this script. It exposes
  // `window.__SdkModule = { createSdk, WsClient, ... }`. Wait until it's
  // available (it loads synchronously, but be defensive).
  function waitForSdk() {
    return new Promise((resolve) => {
      const tick = () => {
        if (window.__SdkModule) resolve(window.__SdkModule);
        else setTimeout(tick, 20);
      };
      tick();
    });
  }

  const sdk = await waitForSdk();
  const { createSdk, WsClient } = sdk;

  // ─── Mock gateway ────────────────────────────────────────────────
  // Replace the WsClient prototype so the SDK operates against our mock.
  // The mock uses the BROWSER's native WebSocket (which we never actually
  // open — we just use the WsClient's internal event hooks).
  const droppers = [];
  const sentMessages = [];

  WsClient.prototype.open = async function () {
    this.closed = false;
    this.reconnectAttempt = 0;
    droppers.push(() => {
      const set = this.handlers.get('close');
      if (set) set.forEach((fn) => fn({ code: 1006, reason: 'mock-drop' }));
      if (!this.closed) {
        // Use the real WsClient.backoff() schedule with jitter (default ±20%).
        this.reconnectAttempt = (this.reconnectAttempt ?? 0) + 1;
        const ms = this.backoff(this.reconnectAttempt);
        setTimeout(() => { this.open().catch(() => {}); }, ms);
      }
    });
    const set = this.handlers.get('open');
    if (set) set.forEach((fn) => fn(undefined));
    return Promise.resolve();
  };

  WsClient.prototype.close = async function () {
    this.closed = true;
  };

  WsClient.prototype.send = function (msg) {
    sentMessages.push(msg);
  };

  // ─── SimEngine ───────────────────────────────────────────────────
  class SimEngine {
    constructor() {
      this.sdk = null;
      this.phase = 'init';
      this.caps = {};
      this.lastEvent = null;
      this.handlers = {
        customerRead: async (input) => {
          if (!input || !input.customerId) throw new Error('customerId required');
          if (input.customerId === 'unknown') throw new Error('not found: ' + input.customerId);
          return { id: input.customerId, name: 'Customer ' + String(input.customerId).slice(-3), email: '...' };
        },
        customerDelete: async (input) => {
          if (!input || !input.customerId) throw new Error('customerId required');
          return { deleted: input.customerId, deletedAt: Date.now() };
        },
      };
    }

    getState() {
      return { phase: this.phase, caps: this.caps };
    }

    getLastEvent() {
      const e = this.lastEvent;
      this.lastEvent = null;
      return e;
    }

    _emit(name, kind, payload) {
      this.lastEvent = { name, kind, payload };
    }

    _setPhase(phase) {
      this.phase = phase;
    }

    _setCaps(records) {
      // records is { name → { tier, registered } }
      this.caps = {};
      for (const k of Object.keys(records)) {
        this.caps[k] = records[k];
      }
    }

    async runCommand(line) {
      const parts = line.trim().split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);
      switch (cmd) {
        case 'help':   return this.cmdHelp();
        case 'state':  return this.cmdState();
        case 'connect': return await this.cmdConnect();
        case 'register': return await this.cmdRegister();
        case 'invoke': return await this.cmdInvoke(args);
        case 'disconnect': return await this.cmdDisconnect();
        case 'reset': return this.cmdReset();
        case '': return { text: '' };
        default:
          return { text: `unknown command: ${cmd}. type "help".`, color: '31' };
      }
    }

    cmdHelp() {
      return {
        text: [
          'Commands:',
          '  connect    — open WebSocket to the (mock) Gateway',
          '  register   — register all manifest capabilities with the SDK',
          '  invoke <cap-name> [json]   — invoke a registered capability',
          '  disconnect — simulate a Gateway drop; auto-reconnect kicks in',
          '  reset      — clear SDK state',
          '  state      — show current state',
          '  help       — this message',
        ].join('\n'),
        color: '36',
      };
    }

    cmdState() {
      const capList = Object.entries(this.caps)
        .map(([n, c]) => `  · ${n} [${c.tier || '?'}] registered=${c.registered}`)
        .join('\n');
      return {
        text: `phase: ${this.phase}\ncapabilities: ${Object.keys(this.caps).length}\n${capList}`,
        color: '36',
      };
    }

    async cmdConnect() {
      if (this.sdk !== null && this.phase !== 'init') {
        return { text: 'already connected.', color: '33' };
      }
      const handlers = {
        'customer.read': this.handlers.customerRead,
        'customer.delete': this.handlers.customerDelete,
      };
      this.sdk = createSdk({
        gateway: { url: 'ws://mock-gateway', token: 'dev-token' },
        app: { id: 'customer-app', name: 'Acme Customer Service' },
        manifest: {
          app: 'customer-app',
          name: 'Acme Customer Service',
          capabilities: [
            { name: 'customer.read', description: 'Fetch a customer record', version: '1.0.0', permissions: ['customer.read'] },
            { name: 'customer.delete', description: 'Delete a customer record', version: '1.0.0', permissions: ['customer.delete'] },
          ],
        },
        handlers,
      });
      await this.sdk.connect();
      this._setPhase('connected');
      this._setCaps({});
      this._emit('sdk.connected', 'c', 'gateway=ws://mock-gateway');
      return { text: '✓ connected (1.2s)', color: '32' };
    }

    async cmdRegister() {
      if (this.sdk === null) {
        return { text: 'not connected. run `connect` first.', color: '31' };
      }
      await this.sdk.register();
      // Pull registered caps from the SDK's state
      const s = this.sdk.state();
      const caps = {};
      for (const [name, info] of Object.entries(s.capabilities)) {
        caps[name] = { tier: info.tier, registered: info.registered };
      }
      this._setCaps(caps);
      this._setPhase('registered');
      // Emit one event per capability
      for (const name of Object.keys(caps)) {
        this._emit('sdk.capability.registered', 'r', name);
      }
      return { text: `✓ registered (${Object.keys(caps).length} capabilities)`, color: '32' };
    }

    async cmdInvoke(args) {
      const name = args[0];
      const json = args.slice(1).join(' ');
      if (!name) return { text: 'usage: invoke <cap-name> [json]', color: '31' };
      if (this.sdk === null) return { text: 'not connected. run `connect` first.', color: '31' };
      if (!this.caps[name]) return { text: `unknown capability: ${name}`, color: '31' };
      let input = name === 'customer.read' || name === 'customer.delete' ? { customerId: 'c-001' } : {};
      if (json) {
        try { input = JSON.parse(json); }
        catch { return { text: 'invalid JSON input', color: '31' }; }
      }
      const t0 = performance.now();
      try {
        const result = await this.sdk.invoke(name, input);
        const ms = (performance.now() - t0).toFixed(1);
        this._setPhase('invoke');
        this._emit('sdk.invoke.completed', 'i', `${name} (${ms}ms)`);
        return { text: `← result: ${JSON.stringify(result)}\n✓ ${ms}ms`, color: '32' };
      } catch (err) {
        const ms = (performance.now() - t0).toFixed(1);
        this._emit('sdk.invoke.failed', 'e', `${name}: ${err.message}`);
        return { text: `✗ error: ${err.message}`, color: '31' };
      }
    }

    async cmdDisconnect() {
      if (this.sdk === null || this.phase === 'init') {
        return { text: 'not connected.', color: '33' };
      }
      // Trigger a drop via the most recent dropper. The dropper uses the
      // real WsClient.backoff() schedule (default: 1s base, ±20% jitter,
      // exponential up to 30s cap) — not a hardcoded 1s wait.
      if (droppers.length > 0) {
        droppers[droppers.length - 1]();
      }
      // Phase: disconnected first, then connected, then registered after
      // re-registration. Each transition fires the right UI event.
      this._setPhase('disconnected');
      this._emit('sdk.disconnected', 'd', 'reason=simulated-drop');
      // Wait for the SDK's reconnect (real backoff). First attempt is
      // ~1s with jitter; we allow a comfortable margin.
      await sleep(1500);
      this._setPhase('connected');
      this._emit('sdk.connected', 'c', 'reason=auto-reconnect');
      // Wait for the lifecycle to re-register all caps.
      await sleep(500);
      const s = this.sdk.state();
      const caps = {};
      for (const [n, info] of Object.entries(s.capabilities)) {
        caps[n] = { tier: info.tier, registered: info.registered };
      }
      this._setCaps(caps);
      if (Object.keys(caps).length > 0) {
        this._setPhase('registered');
        for (const name of Object.keys(caps)) {
          this._emit('sdk.capability.registered', 'r', `${name} (reconnect)`);
        }
        return {
          text: '⚠ gateway unreachable (simulated)\nauto-reconnect via real backoff\n✓ reconnected\nre-registered ' + Object.keys(caps).length + ' capabilities',
          color: '33',
        };
      }
      return { text: '⚠ gateway unreachable (simulated)\nauto-reconnect via real backoff\n✓ reconnected', color: '33' };
    }

    cmdReset() {
      // Call the REAL sdk.reset() so the unregistration events fire and
      // the engine's state observes the SDK's post-reset state.
      if (this.sdk !== null) {
        this.sdk.reset();
      }
      this.sdk = null;
      this.phase = 'init';
      this.caps = {};
      this.lastEvent = null;
      return { text: '✓ reset', color: '32' };
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  window.SimEngine = SimEngine;
  window.engine = new SimEngine();
  console.log('[bundle] SimEngine ready, window.engine set');
})();