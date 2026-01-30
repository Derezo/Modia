/**
 * Unit tests for marketplaceWebsocket - Real-time order book updates and trade notifications
 *
 * Tests cover WebSocket notification flow using mocked server and client objects.
 * This allows testing broadcast logic without requiring a running WebSocket server.
 *
 * Test categories:
 * 1. Initialization
 * 2. Order book updates
 * 3. Trade notifications
 * 4. User messaging
 * 5. Room broadcasting
 * 6. Disconnected user handling
 * 7. Subscription management
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  MockWebSocketClient,
} from '../testUtils/wsTestHelper.js';

// Import the service (will be re-initialized in tests)
import * as marketplaceWs from '../../services/marketplaceWebsocket.js';

// =============================================================================
// MOCK SETUP HELPERS
// =============================================================================

/**
 * Create mock rooms and userSockets maps for testing
 */
function createMockState() {
  const userSockets = new Map();
  const rooms = new Map();

  return {
    userSockets,
    rooms,
    addUser(userId) {
      const client = new MockWebSocketClient(userId, `user${userId}`);
      userSockets.set(String(userId), client);
      return client;
    },
    addUserToRoom(userId, roomName) {
      if (!rooms.has(roomName)) {
        rooms.set(roomName, new Set());
      }
      // Store as string to match sendToUser/broadcastToRoom behavior
      rooms.get(roomName).add(String(userId));
    },
    // Add user to room with numeric userId (for getUserItemSubscriptions tests)
    addUserToRoomNumeric(userId, roomName) {
      if (!rooms.has(roomName)) {
        rooms.set(roomName, new Set());
      }
      // Store as number to match getUserItemSubscriptions expectation
      rooms.get(roomName).add(userId);
    },
    reset() {
      userSockets.clear();
      rooms.clear();
    }
  };
}

/**
 * Create sample order book data
 */
function createSampleOrderBook(overrides = {}) {
  return {
    bids: overrides.bids ?? [{ price: 100, quantity: 5 }, { price: 95, quantity: 10 }],
    asks: overrides.asks ?? [{ price: 105, quantity: 3 }, { price: 110, quantity: 8 }],
    bestBid: overrides.bestBid ?? 100,
    bestAsk: overrides.bestAsk ?? 105,
    spread: overrides.spread ?? 5,
    lastTradePrice: overrides.lastTradePrice ?? 102,
    ...overrides
  };
}

/**
 * Create sample trade data
 */
function createSampleTrade(overrides = {}) {
  return {
    orderId: overrides.orderId ?? 1,
    side: overrides.side ?? 'buy',
    itemTemplateId: overrides.itemTemplateId ?? 10,
    itemName: overrides.itemName ?? 'Test Sword',
    price: overrides.price ?? 100,
    quantity: overrides.quantity ?? 5,
    totalGold: overrides.totalGold ?? 500,
    remainingQuantity: overrides.remainingQuantity ?? 0,
    orderStatus: overrides.orderStatus ?? 'filled',
    newGoldBalance: overrides.newGoldBalance ?? 9500,
    ...overrides
  };
}

// =============================================================================
// INITIALIZATION TESTS
// =============================================================================

describe('marketplaceWebsocket - initialize', () => {
  test('should accept wss, rooms, and userSockets references', () => {
    const state = createMockState();
    const mockWss = {};

    // Should not throw
    marketplaceWs.initialize(mockWss, state.rooms, state.userSockets);

    state.reset();
  });

  test('should handle null parameters gracefully', () => {
    // Should not throw with null params
    marketplaceWs.initialize(null, null, null);
  });
});

// =============================================================================
// ORDER BOOK UPDATE TESTS
// =============================================================================

describe('marketplaceWebsocket - broadcastOrderBookUpdate', () => {
  let state;

  beforeEach(() => {
    state = createMockState();
    marketplaceWs.initialize(null, state.rooms, state.userSockets);
  });

  test('should broadcast to item-specific room subscribers', () => {
    const client1 = state.addUser(1);
    const client2 = state.addUser(2);
    state.addUserToRoom(1, 'marketplace:item:10');
    state.addUserToRoom(2, 'marketplace:item:10');

    const orderBook = createSampleOrderBook();
    marketplaceWs.broadcastOrderBookUpdate(10, orderBook);

    // Both users should receive the orderbook update
    const msgs1 = client1.getSentByType('marketplace:orderbook_update');
    const msgs2 = client2.getSentByType('marketplace:orderbook_update');

    assert.strictEqual(msgs1.length, 1, 'Client 1 should receive orderbook update');
    assert.strictEqual(msgs2.length, 1, 'Client 2 should receive orderbook update');

    // Verify payload structure
    const payload = msgs1[0].payload;
    assert.strictEqual(payload.itemTemplateId, 10);
    assert.deepStrictEqual(payload.bids, orderBook.bids);
    assert.deepStrictEqual(payload.asks, orderBook.asks);
    assert.strictEqual(payload.bestBid, 100);
    assert.strictEqual(payload.bestAsk, 105);
    assert.strictEqual(payload.spread, 5);
    assert.ok(payload.timestamp, 'Should include timestamp');
  });

  test('should also broadcast summary to general marketplace room', () => {
    const client = state.addUser(1);
    state.addUserToRoom(1, 'marketplace');

    const orderBook = createSampleOrderBook();
    marketplaceWs.broadcastOrderBookUpdate(10, orderBook);

    // User should receive the item_update message
    const msgs = client.getSentByType('marketplace:item_update');
    assert.strictEqual(msgs.length, 1, 'Should receive item update');

    const payload = msgs[0].payload;
    assert.strictEqual(payload.itemTemplateId, 10);
    assert.strictEqual(payload.bestBid, 100);
    assert.strictEqual(payload.bestAsk, 105);
    assert.ok(payload.timestamp);
  });

  test('should handle empty order book', () => {
    const client = state.addUser(1);
    state.addUserToRoom(1, 'marketplace:item:10');

    const emptyOrderBook = {
      bids: [],
      asks: [],
      bestBid: 0,
      bestAsk: 0,
      spread: null,
      lastTradePrice: null
    };

    marketplaceWs.broadcastOrderBookUpdate(10, emptyOrderBook);

    const msgs = client.getSentByType('marketplace:orderbook_update');
    assert.strictEqual(msgs.length, 1);
    assert.deepStrictEqual(msgs[0].payload.bids, []);
    assert.deepStrictEqual(msgs[0].payload.asks, []);
  });

  test('should not fail when room has no subscribers', () => {
    // No users subscribed to item room
    const orderBook = createSampleOrderBook();

    // Should not throw
    marketplaceWs.broadcastOrderBookUpdate(10, orderBook);
  });
});

// =============================================================================
// ORDER FILLED NOTIFICATION TESTS
// =============================================================================

describe('marketplaceWebsocket - notifyOrderFilled', () => {
  let state;

  beforeEach(() => {
    state = createMockState();
    marketplaceWs.initialize(null, state.rooms, state.userSockets);
  });

  test('should send notification to specific user', () => {
    const client = state.addUser(1);
    const trade = createSampleTrade();

    marketplaceWs.notifyOrderFilled(1, trade);

    const msgs = client.getSentByType('marketplace:order_filled');
    assert.strictEqual(msgs.length, 1, 'User should receive order_filled notification');

    const payload = msgs[0].payload;
    assert.strictEqual(payload.orderId, 1);
    assert.strictEqual(payload.side, 'buy');
    assert.strictEqual(payload.itemTemplateId, 10);
    assert.strictEqual(payload.itemName, 'Test Sword');
    assert.strictEqual(payload.price, 100);
    assert.strictEqual(payload.quantity, 5);
    assert.strictEqual(payload.totalGold, 500);
    assert.strictEqual(payload.remainingQuantity, 0);
    assert.strictEqual(payload.orderStatus, 'filled');
    assert.strictEqual(payload.newGoldBalance, 9500);
    assert.ok(payload.timestamp);
  });

  test('should handle partial fill notifications', () => {
    const client = state.addUser(1);
    const trade = createSampleTrade({
      quantity: 3,
      totalGold: 300,
      remainingQuantity: 2,
      orderStatus: 'partial'
    });

    marketplaceWs.notifyOrderFilled(1, trade);

    const msgs = client.getSentByType('marketplace:order_filled');
    const payload = msgs[0].payload;
    assert.strictEqual(payload.quantity, 3);
    assert.strictEqual(payload.remainingQuantity, 2);
    assert.strictEqual(payload.orderStatus, 'partial');
  });

  test('should not send to other users', () => {
    const client1 = state.addUser(1);
    const client2 = state.addUser(2);
    const trade = createSampleTrade();

    marketplaceWs.notifyOrderFilled(1, trade);

    assert.strictEqual(client1.getSentByType('marketplace:order_filled').length, 1);
    assert.strictEqual(client2.getSentByType('marketplace:order_filled').length, 0);
  });
});

// =============================================================================
// TRADE BROADCAST TESTS
// =============================================================================

describe('marketplaceWebsocket - broadcastTrade', () => {
  let state;

  beforeEach(() => {
    state = createMockState();
    marketplaceWs.initialize(null, state.rooms, state.userSockets);
  });

  test('should broadcast trade execution to item subscribers', () => {
    const client1 = state.addUser(1);
    const client2 = state.addUser(2);
    state.addUserToRoom(1, 'marketplace:item:10');
    state.addUserToRoom(2, 'marketplace:item:10');

    const trade = {
      itemTemplateId: 10,
      itemName: 'Test Sword',
      price: 100,
      quantity: 5
    };

    marketplaceWs.broadcastTrade(trade);

    const msgs1 = client1.getSentByType('marketplace:trade_executed');
    const msgs2 = client2.getSentByType('marketplace:trade_executed');

    assert.strictEqual(msgs1.length, 1);
    assert.strictEqual(msgs2.length, 1);

    const payload = msgs1[0].payload;
    assert.strictEqual(payload.itemTemplateId, 10);
    assert.strictEqual(payload.itemName, 'Test Sword');
    assert.strictEqual(payload.price, 100);
    assert.strictEqual(payload.quantity, 5);
    assert.ok(payload.timestamp);
  });
});

// =============================================================================
// ORDER CANCELLED NOTIFICATION TESTS
// =============================================================================

describe('marketplaceWebsocket - notifyOrderCancelled', () => {
  let state;

  beforeEach(() => {
    state = createMockState();
    marketplaceWs.initialize(null, state.rooms, state.userSockets);
  });

  test('should send cancellation notification to user', () => {
    const client = state.addUser(1);
    const order = {
      orderId: 5,
      itemTemplateId: 10,
      refundedGold: 500,
      returnedItems: 0
    };

    marketplaceWs.notifyOrderCancelled(1, order);

    const msgs = client.getSentByType('marketplace:order_cancelled');
    assert.strictEqual(msgs.length, 1);

    const payload = msgs[0].payload;
    assert.strictEqual(payload.orderId, 5);
    assert.strictEqual(payload.itemTemplateId, 10);
    assert.strictEqual(payload.refundedGold, 500);
    assert.strictEqual(payload.returnedItems, 0);
  });
});

// =============================================================================
// ORDER EXPIRED NOTIFICATION TESTS
// =============================================================================

describe('marketplaceWebsocket - notifyOrderExpired', () => {
  let state;

  beforeEach(() => {
    state = createMockState();
    marketplaceWs.initialize(null, state.rooms, state.userSockets);
  });

  test('should send expiration notification to user', () => {
    const client = state.addUser(1);
    const order = {
      orderId: 5,
      itemTemplateId: 10,
      side: 'sell',
      refundedGold: 0,
      returnedItems: 3
    };

    marketplaceWs.notifyOrderExpired(1, order);

    const msgs = client.getSentByType('marketplace:order_expired');
    assert.strictEqual(msgs.length, 1);

    const payload = msgs[0].payload;
    assert.strictEqual(payload.orderId, 5);
    assert.strictEqual(payload.side, 'sell');
    assert.strictEqual(payload.returnedItems, 3);
  });
});

// =============================================================================
// PRICE ALERT TESTS
// =============================================================================

describe('marketplaceWebsocket - broadcastPriceAlert', () => {
  let state;

  beforeEach(() => {
    state = createMockState();
    marketplaceWs.initialize(null, state.rooms, state.userSockets);
  });

  test('should broadcast price alert to item subscribers', () => {
    const client = state.addUser(1);
    state.addUserToRoom(1, 'marketplace:item:10');

    const alert = {
      type: 'below',
      threshold: 100,
      currentPrice: 95
    };

    marketplaceWs.broadcastPriceAlert(10, alert);

    const msgs = client.getSentByType('marketplace:price_alert');
    assert.strictEqual(msgs.length, 1);

    const payload = msgs[0].payload;
    assert.strictEqual(payload.itemTemplateId, 10);
    assert.strictEqual(payload.alertType, 'below');
    assert.strictEqual(payload.threshold, 100);
    assert.strictEqual(payload.currentPrice, 95);
  });
});

// =============================================================================
// DISCONNECTED USER HANDLING TESTS
// =============================================================================

describe('marketplaceWebsocket - disconnected user handling', () => {
  let state;

  beforeEach(() => {
    state = createMockState();
    marketplaceWs.initialize(null, state.rooms, state.userSockets);
  });

  test('should skip users with closed WebSocket connections', () => {
    const client1 = state.addUser(1);
    const client2 = state.addUser(2);
    state.addUserToRoom(1, 'marketplace:item:10');
    state.addUserToRoom(2, 'marketplace:item:10');

    // Close client1's connection
    client1.readyState = 3; // WebSocket.CLOSED

    const orderBook = createSampleOrderBook();
    marketplaceWs.broadcastOrderBookUpdate(10, orderBook);

    // Client1 should not receive message (closed)
    assert.strictEqual(client1.getSentByType('marketplace:orderbook_update').length, 0);
    // Client2 should receive message
    assert.strictEqual(client2.getSentByType('marketplace:orderbook_update').length, 1);
  });

  test('should handle user not in userSockets map', () => {
    // Add user to room but not to userSockets
    state.addUserToRoom(999, 'marketplace:item:10');

    const orderBook = createSampleOrderBook();

    // Should not throw
    marketplaceWs.broadcastOrderBookUpdate(10, orderBook);
  });

  test('should handle sendToUser when user is disconnected', () => {
    // User not in userSockets map
    const trade = createSampleTrade();

    // Should not throw
    marketplaceWs.notifyOrderFilled(999, trade);
  });
});

// =============================================================================
// SUBSCRIPTION MANAGEMENT TESTS
// =============================================================================

describe('marketplaceWebsocket - getUserItemSubscriptions', () => {
  let state;

  beforeEach(() => {
    state = createMockState();
    marketplaceWs.initialize(null, state.rooms, state.userSockets);
  });

  test('should return list of subscribed item IDs', () => {
    // Use numeric user IDs as the service expects
    state.addUserToRoomNumeric(1, 'marketplace:item:10');
    state.addUserToRoomNumeric(1, 'marketplace:item:20');
    state.addUserToRoomNumeric(1, 'marketplace:item:30');

    const subscriptions = marketplaceWs.getUserItemSubscriptions(1);

    assert.strictEqual(subscriptions.length, 3);
    assert.ok(subscriptions.includes(10));
    assert.ok(subscriptions.includes(20));
    assert.ok(subscriptions.includes(30));
  });

  test('should not include non-item rooms', () => {
    state.addUserToRoomNumeric(1, 'marketplace:item:10');
    state.addUserToRoomNumeric(1, 'marketplace'); // general room
    state.addUserToRoomNumeric(1, 'chat:global'); // different room type

    const subscriptions = marketplaceWs.getUserItemSubscriptions(1);

    assert.strictEqual(subscriptions.length, 1);
    assert.strictEqual(subscriptions[0], 10);
  });

  test('should return empty array for user with no subscriptions', () => {
    const subscriptions = marketplaceWs.getUserItemSubscriptions(999);
    assert.deepStrictEqual(subscriptions, []);
  });
});

describe('marketplaceWebsocket - cleanupUserSubscriptions', () => {
  let state;

  beforeEach(() => {
    state = createMockState();
    marketplaceWs.initialize(null, state.rooms, state.userSockets);
  });

  test('should remove user from all marketplace item rooms', () => {
    // Use numeric user IDs as the service expects
    state.addUserToRoomNumeric(1, 'marketplace:item:10');
    state.addUserToRoomNumeric(1, 'marketplace:item:20');
    state.addUserToRoomNumeric(2, 'marketplace:item:10');

    marketplaceWs.cleanupUserSubscriptions(1);

    // User 1 should be removed from all item rooms
    assert.ok(!state.rooms.get('marketplace:item:10')?.has(1));
    assert.ok(!state.rooms.get('marketplace:item:20')?.has(1));

    // User 2 should still be in the room
    assert.ok(state.rooms.get('marketplace:item:10')?.has(2));
  });

  test('should delete empty rooms after cleanup', () => {
    state.addUserToRoomNumeric(1, 'marketplace:item:10');

    marketplaceWs.cleanupUserSubscriptions(1);

    // Room should be deleted since it's empty
    assert.ok(!state.rooms.has('marketplace:item:10'));
  });

  test('should not affect non-marketplace rooms', () => {
    state.addUserToRoomNumeric(1, 'marketplace:item:10');
    state.addUserToRoomNumeric(1, 'chat:global');

    marketplaceWs.cleanupUserSubscriptions(1);

    // Chat room should still exist with user (numeric)
    assert.ok(state.rooms.get('chat:global')?.has(1));
  });
});
