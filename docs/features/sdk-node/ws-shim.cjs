// Browser shim for the ws npm package. Aliases `import WebSocket from "ws"`
// to the browser's native WebSocket constructor. The SDK uses `ws` only at
// the import boundary; once we redirect it to native WebSocket, no shim is
// needed at runtime — the SDK just opens real WebSockets (which the page
// patches via WsClient.prototype).
module.exports = globalThis.WebSocket;
module.exports.default = globalThis.WebSocket;