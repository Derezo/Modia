/**
 * Unit tests for token refresh reconnect handling (Finding 2)
 *
 * Tests the REAL GameWebSocket class to ensure that the hourly token refresh
 * does NOT fire a false 'connect' event that would trigger a battle rejoin
 * and clear the event queue.
 *
 * The fix: A reconnect is only the first auth_success on a newly opened socket
 * after we have authenticated before. Subsequent auth_success messages on the
 * same socket (token refresh) are NOT reconnects.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// =============================================================================
// GLOBAL MOCKS - Set up before importing the real module
// =============================================================================

// Track WebSocket instances and their events for verification
const wsInstances = [];
let mockWsInstance = null;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.messages = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    wsInstances.push(this);
    mockWsInstance = this;
  }

  send(data) {
    this.messages.push(JSON.parse(data));
  }

  close(code, reason) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: code || 1000, reason: reason || '' });
    }
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen({});
  }

  simulateAuthSuccess(payload = {}) {
    if (this.onmessage) {
      this.onmessage({
        data: JSON.stringify({ type: 'auth_success', payload })
      });
    }
  }

  simulateClose(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  }
}

// Set up globalThis.WebSocket before importing the module
globalThis.WebSocket = MockWebSocket;

// Mock window, navigator, document for debugLogger and other dependencies
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false }; }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { maxTouchPoints: 0, onLine: true }
});
globalThis.document = {
  createElement() {
    return {
      id: '',
      textContent: '',
      style: {},
      classList: { add() {}, remove() {} }
    };
  },
  head: { appendChild() {} },
  body: { appendChild() {} }
};

// Mock crypto for connectionId generation (use defineProperty to override getter)
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: {
    randomUUID() {
      return `test-${Date.now()}-${Math.random().toString(36).substring(2)}`;
    }
  }
});

// Now import the real GameWebSocket
const { GameWebSocket } = await import('../websocket.js');

// =============================================================================
// TESTS: Token Refresh Does Not Fire 'connect'
// =============================================================================

describe('GameWebSocket - Token Refresh Reconnect Handling (Real Module)', () => {
  let gameSocket;
  let connectEvents;

  beforeEach(() => {
    wsInstances.length = 0;
    mockWsInstance = null;
    connectEvents = [];
    gameSocket = new GameWebSocket('ws://localhost:3000/ws');

    // Listen for 'connect' events
    gameSocket.on('connect', (payload) => {
      connectEvents.push(payload);
    });
  });

  afterEach(() => {
    gameSocket.disconnect();
  });

  it('should NOT fire connect event on first auth_success (initial connection)', () => {
    gameSocket.connect('test-token');
    mockWsInstance.simulateOpen();
    mockWsInstance.simulateAuthSuccess({ userId: 1 });

    assert.strictEqual(connectEvents.length, 0, 'First auth should not fire connect event');
    assert.strictEqual(gameSocket.hasAuthenticatedOnce, true, 'Should mark as authenticated');
  });

  it('should NOT fire connect event on second auth_success (token refresh) on same socket', () => {
    // Initial connection
    gameSocket.connect('test-token');
    mockWsInstance.simulateOpen();
    mockWsInstance.simulateAuthSuccess({ userId: 1 });

    // Clear events and simulate token refresh (second auth on same socket)
    connectEvents.length = 0;
    mockWsInstance.simulateAuthSuccess({ userId: 1 });

    assert.strictEqual(connectEvents.length, 0, 'Token refresh should not fire connect event');
  });

  it('should NOT fire connect event on third auth_success (multiple token refreshes)', () => {
    // Initial connection
    gameSocket.connect('test-token');
    mockWsInstance.simulateOpen();
    mockWsInstance.simulateAuthSuccess({ userId: 1 });

    // Multiple token refreshes
    mockWsInstance.simulateAuthSuccess({ userId: 1 });
    mockWsInstance.simulateAuthSuccess({ userId: 1 });
    mockWsInstance.simulateAuthSuccess({ userId: 1 });

    assert.strictEqual(connectEvents.length, 0, 'Multiple token refreshes should not fire connect');
  });

  it('should fire connect event exactly once on actual reconnect (socket close + new socket)', () => {
    // Initial connection
    gameSocket.connect('test-token');
    const firstSocket = mockWsInstance;
    firstSocket.simulateOpen();
    firstSocket.simulateAuthSuccess({ userId: 1 });

    assert.strictEqual(connectEvents.length, 0, 'First connection should not fire connect');

    // Simulate disconnect
    firstSocket.simulateClose();

    // New connection (reconnect)
    gameSocket.connect('test-token');
    const secondSocket = mockWsInstance;
    secondSocket.simulateOpen();
    secondSocket.simulateAuthSuccess({ userId: 1 });

    assert.strictEqual(connectEvents.length, 1, 'Reconnect should fire connect exactly once');
  });

  it('should NOT fire connect again on token refresh after reconnect', () => {
    // Initial connection
    gameSocket.connect('test-token');
    mockWsInstance.simulateOpen();
    mockWsInstance.simulateAuthSuccess({ userId: 1 });

    // Disconnect and reconnect
    mockWsInstance.simulateClose();
    gameSocket.connect('test-token');
    mockWsInstance.simulateOpen();
    mockWsInstance.simulateAuthSuccess({ userId: 1 });

    assert.strictEqual(connectEvents.length, 1, 'Should have exactly one connect from reconnect');

    // Now do a token refresh on the reconnected socket
    mockWsInstance.simulateAuthSuccess({ userId: 1 });
    mockWsInstance.simulateAuthSuccess({ userId: 1 });

    assert.strictEqual(connectEvents.length, 1, 'Token refresh after reconnect should not fire connect');
  });

  it('should handle full lifecycle: connect -> refresh -> reconnect -> refresh', () => {
    const events = [];

    // Step 1: Initial connection
    gameSocket.connect('token-1');
    const socket1 = mockWsInstance;
    socket1.simulateOpen();
    socket1.simulateAuthSuccess({ userId: 1 });
    events.push(`initial_auth:${connectEvents.length}`);

    // Step 2: Token refresh on same socket
    socket1.simulateAuthSuccess({ userId: 1 });
    events.push(`token_refresh_1:${connectEvents.length}`);

    // Step 3: Another token refresh
    socket1.simulateAuthSuccess({ userId: 1 });
    events.push(`token_refresh_2:${connectEvents.length}`);

    // Step 4: Socket closes, new connection (reconnect)
    socket1.simulateClose();
    gameSocket.connect('token-2');
    const socket2 = mockWsInstance;
    socket2.simulateOpen();
    socket2.simulateAuthSuccess({ userId: 1 });
    events.push(`reconnect:${connectEvents.length}`);

    // Step 5: Token refresh on reconnected socket
    socket2.simulateAuthSuccess({ userId: 1 });
    events.push(`token_refresh_3:${connectEvents.length}`);

    // Verify the sequence
    assert.deepStrictEqual(events, [
      'initial_auth:0',      // No connect on initial
      'token_refresh_1:0',   // No connect on refresh
      'token_refresh_2:0',   // No connect on second refresh
      'reconnect:1',         // One connect on actual reconnect
      'token_refresh_3:1'    // Still one connect (refresh doesn't add more)
    ]);
  });

  it('should track _isReconnectSocket and _socketAuthed flags correctly on the WebSocket instance', () => {
    // Initial connection - socket should NOT be marked as reconnect socket
    gameSocket.connect('test-token');
    const socket1 = mockWsInstance;

    assert.strictEqual(socket1._isReconnectSocket, false, 'First socket should not be reconnect socket');
    assert.strictEqual(socket1._socketAuthed, false, 'Socket should not be authed before auth_success');

    socket1.simulateOpen();
    socket1.simulateAuthSuccess({ userId: 1 });

    assert.strictEqual(socket1._socketAuthed, true, 'Socket should be authed after auth_success');

    // Disconnect and reconnect
    socket1.simulateClose();
    gameSocket.connect('test-token');
    const socket2 = mockWsInstance;

    assert.strictEqual(socket2._isReconnectSocket, true, 'Second socket should be reconnect socket');
    assert.strictEqual(socket2._socketAuthed, false, 'New socket should not be authed yet');

    socket2.simulateOpen();
    socket2.simulateAuthSuccess({ userId: 1 });

    assert.strictEqual(socket2._socketAuthed, true, 'Second socket should be authed after auth_success');
  });
});
