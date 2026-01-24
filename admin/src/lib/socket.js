/**
 * WebSocket Client for Admin Dashboard
 * Handles real-time generation events
 */

// Connection state
let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
const baseReconnectDelay = 1000;

// Event handlers map
const handlers = new Map();

// Connection state callbacks
let onConnectCallback = null;
let onDisconnectCallback = null;
let onErrorCallback = null;

/**
 * Get WebSocket URL based on current environment
 */
function getWsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In development, Vite proxies /ws to the API server
  // In production, connect to same host
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
}

/**
 * Connect to WebSocket server
 */
export function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    console.log('[WS] Already connected or connecting');
    return;
  }

  const url = getWsUrl();
  console.log('[WS] Connecting to', url);

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[WS] Connected');
    reconnectAttempts = 0;

    // Authenticate (we use a simple dev token since admin is dev-only)
    // In a real app, you'd use a proper auth token
    // For now, we'll skip auth since admin:generation room allows all authenticated users
    // and we're in dev mode
    ws.send(JSON.stringify({
      type: 'auth',
      payload: { token: getDevToken() }
    }));

    if (onConnectCallback) {
      onConnectCallback();
    }
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      const { type, payload } = message;

      // Handle auth success - join generation room
      if (type === 'auth_success') {
        console.log('[WS] Authenticated, joining admin:generation room');
        ws.send(JSON.stringify({
          type: 'join_room',
          payload: { room: 'admin:generation' }
        }));
        return;
      }

      // Handle room joined confirmation
      if (type === 'room_joined' && payload.room === 'admin:generation') {
        console.log('[WS] Joined admin:generation room');
        return;
      }

      // Handle auth errors
      if (type === 'auth_error' || type === 'auth_timeout') {
        console.error('[WS] Auth failed:', payload.message);
        if (onErrorCallback) {
          onErrorCallback(new Error(payload.message));
        }
        return;
      }

      // Dispatch to registered handlers
      const handler = handlers.get(type);
      if (handler) {
        handler(payload);
      }

      // Also dispatch to wildcard handler if registered
      const wildcardHandler = handlers.get('*');
      if (wildcardHandler) {
        wildcardHandler({ type, payload });
      }
    } catch (err) {
      console.error('[WS] Failed to parse message:', err);
    }
  };

  ws.onclose = (event) => {
    console.log('[WS] Disconnected:', event.code, event.reason);
    ws = null;

    if (onDisconnectCallback) {
      onDisconnectCallback(event);
    }

    // Attempt reconnection with exponential backoff
    if (reconnectAttempts < maxReconnectAttempts) {
      const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts), 30000);
      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1})`);
      reconnectAttempts++;
      setTimeout(connect, delay);
    } else {
      console.error('[WS] Max reconnection attempts reached');
      if (onErrorCallback) {
        onErrorCallback(new Error('Max reconnection attempts reached'));
      }
    }
  };

  ws.onerror = (event) => {
    console.error('[WS] Error:', event);
    if (onErrorCallback) {
      onErrorCallback(event);
    }
  };
}

/**
 * Disconnect from WebSocket server
 */
export function disconnect() {
  if (ws) {
    reconnectAttempts = maxReconnectAttempts; // Prevent reconnection
    ws.close(1000, 'Client disconnect');
    ws = null;
  }
}

/**
 * Send a message through WebSocket
 */
export function send(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[WS] Cannot send - not connected');
    return false;
  }

  ws.send(JSON.stringify({ type, payload }));
  return true;
}

/**
 * Register an event handler
 */
export function on(type, handler) {
  handlers.set(type, handler);
  return () => handlers.delete(type);
}

/**
 * Remove an event handler
 */
export function off(type) {
  handlers.delete(type);
}

/**
 * Set connection state callbacks
 */
export function onConnect(callback) {
  onConnectCallback = callback;
}

export function onDisconnect(callback) {
  onDisconnectCallback = callback;
}

export function onError(callback) {
  onErrorCallback = callback;
}

/**
 * Check if connected
 */
export function isConnected() {
  return ws && ws.readyState === WebSocket.OPEN;
}

/**
 * Get a dev token for WebSocket authentication
 *
 * SECURITY NOTE: This is for development-only admin tooling.
 * In production, admin routes are blocked by NODE_ENV checks at multiple layers:
 * - WebSocket room authorization (websocket/index.js)
 * - Admin API routes (admin.js)
 * - WebSocket message handlers (websocket/index.js)
 *
 * The 'dev_admin_token' placeholder is explicitly accepted by the backend
 * only when NODE_ENV !== 'production'.
 */
function getDevToken() {
  // Check if we have a stored token from a previous session
  const storedToken = sessionStorage.getItem('admin_ws_token');
  if (storedToken) {
    return storedToken;
  }

  // DEV ONLY: This placeholder token is accepted by the WebSocket auth
  // system when NODE_ENV !== 'production'. Never deployed to production.
  return 'dev_admin_token';
}

/**
 * Set the auth token for WebSocket connections
 */
export function setAuthToken(token) {
  sessionStorage.setItem('admin_ws_token', token);
}

// Generation control functions
export const generation = {
  cancel: (jobId) => send('generation:cancel', { jobId }),
  cancelAll: () => send('generation:cancel_all', {}),
  pause: () => send('generation:pause', {}),
  resume: () => send('generation:resume', {})
};

export default {
  connect,
  disconnect,
  send,
  on,
  off,
  onConnect,
  onDisconnect,
  onError,
  isConnected,
  setAuthToken,
  generation
};
