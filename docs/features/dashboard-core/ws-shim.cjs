// ws shim — the browser's native WebSocket is what we want; no Node `ws`
// needed because simulate.html only uses the native browser WS.
module.exports = globalThis.WebSocket;
module.exports.default = globalThis.WebSocket;