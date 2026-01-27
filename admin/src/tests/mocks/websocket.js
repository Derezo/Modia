/**
 * WebSocket Mock Utilities
 * Utilities for mocking WebSocket connections in tests
 */

import { vi } from 'vitest';

/**
 * Create a mock WebSocket instance
 */
export function createMockWebSocket() {
  const listeners = new Map();

  const ws = {
    readyState: WebSocket.OPEN,

    send: vi.fn((data) => {
      // Parse and handle messages if needed
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'ping') {
          // Auto-respond to ping
          setTimeout(() => {
            ws.triggerMessage({ type: 'pong' });
          }, 0);
        }
      } catch (e) {
        // Not JSON, ignore
      }
    }),

    close: vi.fn(() => {
      ws.readyState = WebSocket.CLOSED;
      ws.triggerEvent('close', { code: 1000, reason: 'Normal closure' });
    }),

    addEventListener: vi.fn((event, handler) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(handler);
    }),

    removeEventListener: vi.fn((event, handler) => {
      if (listeners.has(event)) {
        listeners.get(event).delete(handler);
      }
    }),

    // Test helper methods
    triggerEvent: (event, data = {}) => {
      const eventHandlers = listeners.get(event);
      if (eventHandlers) {
        eventHandlers.forEach((handler) => {
          handler(data);
        });
      }
    },

    triggerMessage: (data) => {
      ws.triggerEvent('message', {
        data: typeof data === 'string' ? data : JSON.stringify(data)
      });
    },

    triggerOpen: () => {
      ws.readyState = WebSocket.OPEN;
      ws.triggerEvent('open', {});
    },

    triggerClose: (code = 1000, reason = '') => {
      ws.readyState = WebSocket.CLOSED;
      ws.triggerEvent('close', { code, reason });
    },

    triggerError: (error) => {
      ws.triggerEvent('error', { error });
    },

    // Reset for test cleanup
    reset: () => {
      listeners.clear();
      ws.send.mockClear();
      ws.close.mockClear();
      ws.readyState = WebSocket.OPEN;
    }
  };

  return ws;
}

/**
 * Mock the global WebSocket class
 */
export function mockWebSocket() {
  const instances = [];

  const MockWebSocket = vi.fn((url) => {
    const ws = createMockWebSocket();
    ws.url = url;
    instances.push(ws);

    // Simulate connection in next tick
    setTimeout(() => {
      ws.triggerOpen();
    }, 0);

    return ws;
  });

  // Add static properties
  MockWebSocket.CONNECTING = 0;
  MockWebSocket.OPEN = 1;
  MockWebSocket.CLOSING = 2;
  MockWebSocket.CLOSED = 3;

  // Store original
  const originalWebSocket = global.WebSocket;
  global.WebSocket = MockWebSocket;

  return {
    MockWebSocket,
    instances,

    // Get the most recent WebSocket instance
    getLatest: () => instances[instances.length - 1],

    // Get all instances
    getAll: () => instances,

    // Reset all instances
    reset: () => {
      instances.forEach((ws) => ws.reset());
      instances.length = 0;
      MockWebSocket.mockClear();
    },

    // Restore original WebSocket
    restore: () => {
      global.WebSocket = originalWebSocket;
    }
  };
}

/**
 * Create a mock socket.js module
 */
export function createMockSocketModule() {
  const eventHandlers = new Map();
  let connected = false;
  let authenticated = false;

  return {
    // Connection state
    ConnectionState: {
      DISCONNECTED: 'disconnected',
      CONNECTING: 'connecting',
      CONNECTED: 'connected',
      AUTHENTICATING: 'authenticating',
      AUTHENTICATED: 'authenticated',
      RECONNECTING: 'reconnecting'
    },

    // Connection methods
    connect: vi.fn(() => {
      connected = true;
      const handlers = eventHandlers.get('connect');
      if (handlers) {
        handlers.forEach((h) => h());
      }
    }),

    disconnect: vi.fn(() => {
      connected = false;
      const handlers = eventHandlers.get('disconnect');
      if (handlers) {
        handlers.forEach((h) => h());
      }
    }),

    reconnect: vi.fn(),

    isConnected: vi.fn(() => connected),
    isAuthenticated: vi.fn(() => authenticated),

    // Event handlers
    on: vi.fn((event, handler) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set());
      }
      eventHandlers.get(event).add(handler);
      return () => eventHandlers.get(event).delete(handler);
    }),

    onConnect: vi.fn((handler) => {
      if (!eventHandlers.has('connect')) {
        eventHandlers.set('connect', new Set());
      }
      eventHandlers.get('connect').add(handler);
      return () => eventHandlers.get('connect').delete(handler);
    }),

    onDisconnect: vi.fn((handler) => {
      if (!eventHandlers.has('disconnect')) {
        eventHandlers.set('disconnect', new Set());
      }
      eventHandlers.get('disconnect').add(handler);
      return () => eventHandlers.get('disconnect').delete(handler);
    }),

    onError: vi.fn((handler) => {
      if (!eventHandlers.has('error')) {
        eventHandlers.set('error', new Set());
      }
      eventHandlers.get('error').add(handler);
      return () => eventHandlers.get('error').delete(handler);
    }),

    onStateChange: vi.fn((handler) => {
      if (!eventHandlers.has('stateChange')) {
        eventHandlers.set('stateChange', new Set());
      }
      eventHandlers.get('stateChange').add(handler);
      return () => eventHandlers.get('stateChange').delete(handler);
    }),

    // Generation commands
    generation: {
      cancel: vi.fn(),
      cancelAll: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn()
    },

    // Test helpers
    __setConnected: (value) => {
      connected = value;
    },
    __setAuthenticated: (value) => {
      authenticated = value;
    },
    __emit: (event, data) => {
      const handlers = eventHandlers.get(event);
      if (handlers) {
        handlers.forEach((h) => h(data));
      }
    },
    __reset: () => {
      eventHandlers.clear();
      connected = false;
      authenticated = false;
    }
  };
}

export default { createMockWebSocket, mockWebSocket, createMockSocketModule };
