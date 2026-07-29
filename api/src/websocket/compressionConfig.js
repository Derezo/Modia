/**
 * Shared WebSocket compression settings.
 *
 * Keep the server configuration and battle-map wire-budget measurement on the
 * same constants. Server-to-client messages are sent as a single unmasked
 * frame, and context takeover is disabled so every message can be measured in
 * isolation.
 */
export const WEBSOCKET_COMPRESSION_THRESHOLD_BYTES = 1024;

export const WEBSOCKET_ZLIB_DEFLATE_OPTIONS = Object.freeze({
  level: 1,
  memLevel: 7
});

export const WEBSOCKET_PER_MESSAGE_DEFLATE_OPTIONS = Object.freeze({
  threshold: WEBSOCKET_COMPRESSION_THRESHOLD_BYTES,
  concurrencyLimit: 10,
  clientNoContextTakeover: true,
  serverNoContextTakeover: true,
  zlibDeflateOptions: WEBSOCKET_ZLIB_DEFLATE_OPTIONS
});
