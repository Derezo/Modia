/**
 * WebSocket Client for Admin Dashboard
 * Handles real-time generation events with proper connection state management
 */

// Connection state enum
export const ConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  AUTHENTICATING: 'authenticating',
  AUTHENTICATED: 'authenticated',
};

// Connection state
let ws = null;
let connectionState = ConnectionState.DISCONNECTED;
let connectionId = 0; // Incremented on each connect to track stale callbacks
let reconnectAttempts = 0;
let reconnectTimeoutId = null;
let authTimeoutId = null;
const maxReconnectAttempts = 10;
const baseReconnectDelay = 1000;
const authTimeout = 10000; // 10 seconds to authenticate

// Event handlers map
const handlers = new Map();

// Connection state callbacks (Sets for cleanup support)
const onConnectCallbacks = new Set();
const onDisconnectCallbacks = new Set();
const onErrorCallbacks = new Set();
const onStateChangeCallbacks = new Set();

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
 * Update connection state and notify listeners
 */
function setConnectionState(newState) {
  const oldState = connectionState;
  connectionState = newState;

  if (oldState !== newState) {
    onStateChangeCallbacks.forEach(callback => {
      try {
        callback(newState, oldState);
      } catch (err) {
        console.error('[WS] Error in state change callback:', err);
      }
    });
  }
}

/**
 * Clear all pending timeouts
 */
function clearPendingTimeouts() {
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
  if (authTimeoutId) {
    clearTimeout(authTimeoutId);
    authTimeoutId = null;
  }
}

/**
 * Connect to WebSocket server
 */
export function connect() {
  // Prevent concurrent connection attempts
  if (connectionState === ConnectionState.CONNECTING ||
      connectionState === ConnectionState.AUTHENTICATING) {
    console.log('[WS] Already connecting or authenticating');
    return;
  }

  // Already fully connected
  if (connectionState === ConnectionState.AUTHENTICATED && ws?.readyState === WebSocket.OPEN) {
    console.log('[WS] Already connected and authenticated');
    return;
  }

  // Clean up any existing connection
  if (ws) {
    try {
      ws.close();
    } catch (e) {
      // Ignore close errors
    }
    ws = null;
  }

  // Clear any pending timeouts
  clearPendingTimeouts();

  // Increment connection ID to invalidate stale callbacks
  connectionId++;
  const currentConnectionId = connectionId;

  const url = getWsUrl();
  console.log('[WS] Connecting to', url, `(connection #${currentConnectionId})`);

  setConnectionState(ConnectionState.CONNECTING);

  const socket = new WebSocket(url);

  socket.onopen = () => {
    // Guard against stale callback
    if (currentConnectionId !== connectionId) {
      console.log('[WS] Ignoring stale onopen callback');
      try { socket.close(); } catch (e) { /* ignore */ }
      return;
    }

    console.log('[WS] Connected');
    ws = socket;
    reconnectAttempts = 0;
    setConnectionState(ConnectionState.AUTHENTICATING);

    // Set auth timeout
    authTimeoutId = setTimeout(() => {
      if (currentConnectionId !== connectionId) return;

      console.error('[WS] Authentication timeout');
      setConnectionState(ConnectionState.DISCONNECTED);
      const error = new Error('Authentication timeout');
      onErrorCallbacks.forEach(callback => {
        try {
          callback(error);
        } catch (err) {
          console.error('[WS] Error in error callback:', err);
        }
      });
      // Close and trigger reconnect
      try { socket.close(); } catch (e) { /* ignore */ }
    }, authTimeout);

    // Authenticate
    try {
      socket.send(JSON.stringify({
        type: 'auth',
        payload: { token: getDevToken() }
      }));
    } catch (err) {
      console.error('[WS] Failed to send auth:', err);
    }

    onConnectCallbacks.forEach(callback => {
      try {
        callback();
      } catch (err) {
        console.error('[WS] Error in connect callback:', err);
      }
    });
  };

  socket.onmessage = (event) => {
    // Guard against stale callback
    if (currentConnectionId !== connectionId) {
      console.log('[WS] Ignoring message from stale connection');
      return;
    }

    try {
      const message = JSON.parse(event.data);
      const { type, payload } = message;

      // Handle auth success - join generation rooms
      if (type === 'auth_success') {
        // Clear auth timeout
        if (authTimeoutId) {
          clearTimeout(authTimeoutId);
          authTimeoutId = null;
        }

        console.log('[WS] Authenticated, joining admin rooms');
        setConnectionState(ConnectionState.AUTHENTICATED);

        try {
          // Join image generation room
          socket.send(JSON.stringify({
            type: 'join_room',
            payload: { room: 'admin:generation' }
          }));
          // Join audio generation room
          socket.send(JSON.stringify({
            type: 'join_room',
            payload: { room: 'admin:audio-generation' }
          }));
        } catch (err) {
          console.error('[WS] Failed to join rooms:', err);
        }
        return;
      }

      // Handle room joined confirmation
      if (type === 'room_joined') {
        if (payload.room === 'admin:generation') {
          console.log('[WS] Joined admin:generation room');
        } else if (payload.room === 'admin:audio-generation') {
          console.log('[WS] Joined admin:audio-generation room');
        }
        return;
      }

      // Handle auth errors
      if (type === 'auth_error' || type === 'auth_timeout') {
        // Clear auth timeout
        if (authTimeoutId) {
          clearTimeout(authTimeoutId);
          authTimeoutId = null;
        }

        console.error('[WS] Auth failed:', payload.message);
        setConnectionState(ConnectionState.DISCONNECTED);

        const error = new Error(payload.message);
        onErrorCallbacks.forEach(callback => {
          try {
            callback(error);
          } catch (err) {
            console.error('[WS] Error in error callback:', err);
          }
        });
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

  socket.onclose = (event) => {
    // Guard against stale callback
    if (currentConnectionId !== connectionId) {
      console.log('[WS] Ignoring stale onclose callback');
      return;
    }

    console.log('[WS] Disconnected:', event.code, event.reason);

    // Clear auth timeout if pending
    if (authTimeoutId) {
      clearTimeout(authTimeoutId);
      authTimeoutId = null;
    }

    // Only null out ws if it's still our socket
    if (ws === socket) {
      ws = null;
    }

    setConnectionState(ConnectionState.DISCONNECTED);

    onDisconnectCallbacks.forEach(callback => {
      try {
        callback(event);
      } catch (err) {
        console.error('[WS] Error in disconnect callback:', err);
      }
    });

    // Attempt reconnection with exponential backoff
    if (reconnectAttempts < maxReconnectAttempts) {
      const delay = Math.min(baseReconnectDelay * Math.pow(2, reconnectAttempts), 30000);
      console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1})`);
      reconnectAttempts++;

      reconnectTimeoutId = setTimeout(() => {
        // Only reconnect if we haven't connected elsewhere
        if (connectionState === ConnectionState.DISCONNECTED) {
          connect();
        }
      }, delay);
    } else {
      console.error('[WS] Max reconnection attempts reached');
      const error = new Error('Max reconnection attempts reached');
      onErrorCallbacks.forEach(callback => {
        try {
          callback(error);
        } catch (err) {
          console.error('[WS] Error in error callback:', err);
        }
      });
    }
  };

  socket.onerror = (event) => {
    // Guard against stale callback
    if (currentConnectionId !== connectionId) {
      return;
    }

    console.error('[WS] Error:', event);
    onErrorCallbacks.forEach(callback => {
      try {
        callback(event);
      } catch (err) {
        console.error('[WS] Error in error callback:', err);
      }
    });
  };
}

/**
 * Disconnect from WebSocket server
 */
export function disconnect() {
  // Increment connection ID to invalidate any pending callbacks
  connectionId++;

  // Clear pending timeouts
  clearPendingTimeouts();

  // Prevent reconnection
  reconnectAttempts = maxReconnectAttempts;

  if (ws) {
    try {
      ws.close(1000, 'Client disconnect');
    } catch (e) {
      // Ignore close errors
    }
    ws = null;
  }

  setConnectionState(ConnectionState.DISCONNECTED);
}

/**
 * Force reconnect - useful for manual reconnect button
 */
export function reconnect() {
  // Reset reconnect attempts
  reconnectAttempts = 0;

  // Disconnect and reconnect
  disconnect();

  // Small delay before reconnecting
  setTimeout(() => {
    connect();
  }, 100);
}

/**
 * Send a message through WebSocket
 */
export function send(type, payload = {}) {
  // Check both WebSocket state and our connection state
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[WS] Cannot send - WebSocket not open');
    return false;
  }

  // For non-auth messages, require authenticated state
  if (type !== 'auth' && connectionState !== ConnectionState.AUTHENTICATED) {
    console.warn('[WS] Cannot send - not authenticated');
    return false;
  }

  try {
    ws.send(JSON.stringify({ type, payload }));
    return true;
  } catch (err) {
    console.error('[WS] Send error:', err);
    return false;
  }
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
 * Register connection state callbacks
 * Returns unsubscribe function for cleanup
 */
export function onConnect(callback) {
  onConnectCallbacks.add(callback);
  return () => onConnectCallbacks.delete(callback);
}

export function onDisconnect(callback) {
  onDisconnectCallbacks.add(callback);
  return () => onDisconnectCallbacks.delete(callback);
}

export function onError(callback) {
  onErrorCallbacks.add(callback);
  return () => onErrorCallbacks.delete(callback);
}

export function onStateChange(callback) {
  onStateChangeCallbacks.add(callback);
  return () => onStateChangeCallbacks.delete(callback);
}

/**
 * Check if connected (WebSocket open)
 */
export function isConnected() {
  return ws && ws.readyState === WebSocket.OPEN;
}

/**
 * Check if fully authenticated
 */
export function isAuthenticated() {
  return connectionState === ConnectionState.AUTHENTICATED && isConnected();
}

/**
 * Get current connection state
 */
export function getConnectionState() {
  return connectionState;
}

/**
 * Get reconnection info for UI display
 * @returns {{attempts: number, maxAttempts: number, isReconnecting: boolean}}
 */
export function getReconnectInfo() {
  return {
    attempts: reconnectAttempts,
    maxAttempts: maxReconnectAttempts,
    isReconnecting: connectionState === ConnectionState.DISCONNECTED && reconnectAttempts < maxReconnectAttempts && reconnectAttempts > 0
  };
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
  reconnect,
  send,
  on,
  off,
  onConnect,
  onDisconnect,
  onError,
  onStateChange,
  isConnected,
  isAuthenticated,
  getConnectionState,
  getReconnectInfo,
  setAuthToken,
  generation,
  ConnectionState
};
