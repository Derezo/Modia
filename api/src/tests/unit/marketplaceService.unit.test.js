/**
 * Unit tests for marketplaceService - Order book, matching engine, and trade execution
 *
 * Tests cover the core marketplace functions using mocked database calls.
 * This allows testing business logic without requiring a running server or database.
 *
 * Test categories:
 * 1. Order book aggregation
 * 2. Order matching (price-time priority)
 * 3. Gold reservation system
 * 4. Item escrow system
 * 5. Trade execution
 * 6. Price suggestions
 * 7. Edge cases
 */

import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { createMockQuery } from '../testUtils/index.js';

// =============================================================================
// MOCK CLIENT FACTORY
// =============================================================================

/**
 * Create a mock database client with configurable query responses
 */
function createMockClient(responses = {}) {
  const mockQuery = createMockQuery(responses);
  return {
    query: mockQuery,
    getCalls: mockQuery.getCalls,
    getLastCall: mockQuery.getLastCall,
    clearCalls: mockQuery.clearCalls
  };
}

/**
 * Create mock order data
 */
function createMockOrder(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    user_id: overrides.user_id ?? 100,
    character_id: overrides.character_id ?? 1,
    item_template_id: overrides.item_template_id ?? 10,
    side: overrides.side ?? 'buy',
    price: overrides.price ?? 100,
    quantity: overrides.quantity ?? 5,
    quantity_filled: overrides.quantity_filled ?? 0,
    status: overrides.status ?? 'open',
    created_at: overrides.created_at ?? new Date(),
    ...overrides
  };
}

/**
 * Create mock user data
 */
function createMockUser(overrides = {}) {
  return {
    id: overrides.id ?? 100,
    gold: overrides.gold ?? 10000,
    ...overrides
  };
}

/**
 * Create mock item template data
 */
function createMockItemTemplate(overrides = {}) {
  return {
    id: overrides.id ?? 10,
    name: overrides.name ?? 'Test Sword',
    item_type: overrides.item_type ?? 'weapon',
    base_price: overrides.base_price ?? 100,
    rarity: overrides.rarity ?? 'common',
    is_tradeable: overrides.is_tradeable ?? true,
    is_stackable: overrides.is_stackable ?? false,
    ...overrides
  };
}

// =============================================================================
// IMPORT SERVICE FUNCTIONS (dynamic import to allow mocking)
// =============================================================================

// Import the pure functions we can test without database
import {
  calculateSuggestedPrice,
  // Note: Most functions require database client, tested with mocks below
} from '../../services/marketplaceService.js';

// =============================================================================
// CALCULATE SUGGESTED PRICE TESTS
// =============================================================================

describe('calculateSuggestedPrice', () => {
  test('should return base price for common item with no augments', () => {
    const item = {
      basePrice: 100,
      rarity: 'common',
      augments: []
    };

    const result = calculateSuggestedPrice(item);

    assert.strictEqual(result.suggestedPrice, 100);
    assert.strictEqual(result.breakdown.basePrice, 100);
    assert.strictEqual(result.breakdown.rarityMultiplier, 1.0);
    assert.strictEqual(result.breakdown.augmentMultiplier, 1.0);
  });

  test('should apply rarity multiplier for uncommon items', () => {
    const item = {
      basePrice: 100,
      rarity: 'uncommon',
      augments: []
    };

    const result = calculateSuggestedPrice(item);

    assert.strictEqual(result.suggestedPrice, 150); // 100 * 1.5
    assert.strictEqual(result.breakdown.rarityMultiplier, 1.5);
  });

  test('should apply rarity multiplier for rare items', () => {
    const item = {
      basePrice: 100,
      rarity: 'rare',
      augments: []
    };

    const result = calculateSuggestedPrice(item);

    assert.strictEqual(result.suggestedPrice, 250); // 100 * 2.5
    assert.strictEqual(result.breakdown.rarityMultiplier, 2.5);
  });

  test('should apply rarity multiplier for epic items', () => {
    const item = {
      basePrice: 100,
      rarity: 'epic',
      augments: []
    };

    const result = calculateSuggestedPrice(item);

    assert.strictEqual(result.suggestedPrice, 500); // 100 * 5.0
    assert.strictEqual(result.breakdown.rarityMultiplier, 5.0);
  });

  test('should apply rarity multiplier for legendary items', () => {
    const item = {
      basePrice: 100,
      rarity: 'legendary',
      augments: []
    };

    const result = calculateSuggestedPrice(item);

    assert.strictEqual(result.suggestedPrice, 1000); // 100 * 10.0
    assert.strictEqual(result.breakdown.rarityMultiplier, 10.0);
  });

  test('should apply augment value multiplier', () => {
    const item = {
      basePrice: 100,
      rarity: 'common',
      augments: [
        { category: 'fire' } // 0.8 value
      ]
    };

    const result = calculateSuggestedPrice(item);

    // augmentMult = 1.0 + (0.8 * 0.15) = 1.12
    assert.strictEqual(result.suggestedPrice, 112); // 100 * 1.0 * 1.12
    assert.strictEqual(result.breakdown.augmentCount, 1);
  });

  test('should stack multiple augment values', () => {
    const item = {
      basePrice: 100,
      rarity: 'common',
      augments: [
        { category: 'fire' },      // 0.8
        { category: 'strength' },   // 1.0
        { category: 'critical' }    // 1.0
      ]
    };

    const result = calculateSuggestedPrice(item);

    // augmentValue = 0.8 + 1.0 + 1.0 = 2.8
    // augmentMult = 1.0 + (2.8 * 0.15) = 1.42
    assert.strictEqual(result.suggestedPrice, 142); // 100 * 1.0 * 1.42
    assert.strictEqual(result.breakdown.augmentCount, 3);
  });

  test('should combine rarity and augment multipliers', () => {
    const item = {
      basePrice: 100,
      rarity: 'rare',  // 2.5x
      augments: [
        { category: 'dragon_slayer' } // 1.2 value
      ]
    };

    const result = calculateSuggestedPrice(item);

    // augmentMult = 1.0 + (1.2 * 0.15) = 1.18
    // suggestedPrice = 100 * 2.5 * 1.18 = 295
    assert.strictEqual(result.suggestedPrice, 295);
  });

  test('should handle unknown augment categories with default value', () => {
    const item = {
      basePrice: 100,
      rarity: 'common',
      augments: [
        { category: 'unknown_category' } // default 0.5
      ]
    };

    const result = calculateSuggestedPrice(item);

    // augmentMult = 1.0 + (0.5 * 0.15) = 1.075
    // Floor of 100 * 1.075 = 107
    assert.strictEqual(result.suggestedPrice, 107);
  });

  test('should use base_price if basePrice not provided', () => {
    const item = {
      base_price: 200,
      rarity: 'common',
      augments: []
    };

    const result = calculateSuggestedPrice(item);

    assert.strictEqual(result.suggestedPrice, 200);
    assert.strictEqual(result.breakdown.basePrice, 200);
  });

  test('should default to common rarity if not specified', () => {
    const item = {
      basePrice: 100,
      augments: []
    };

    const result = calculateSuggestedPrice(item);

    assert.strictEqual(result.suggestedPrice, 100);
    assert.strictEqual(result.breakdown.rarityMultiplier, 1.0);
  });

  test('should normalize numeric rarity 1-5 to string names', () => {
    // Test numeric rarity 5 (legendary)
    const itemLegendary = {
      basePrice: 100,
      rarity: 5, // numeric legendary
      augments: []
    };

    const resultLegendary = calculateSuggestedPrice(itemLegendary);
    assert.strictEqual(resultLegendary.suggestedPrice, 1000); // 100 * 10.0
    assert.strictEqual(resultLegendary.breakdown.rarityMultiplier, 10.0);

    // Test numeric rarity 3 (rare)
    const itemRare = {
      basePrice: 100,
      rarity: 3, // numeric rare
      augments: []
    };

    const resultRare = calculateSuggestedPrice(itemRare);
    assert.strictEqual(resultRare.suggestedPrice, 250); // 100 * 2.5
    assert.strictEqual(resultRare.breakdown.rarityMultiplier, 2.5);

    // Test numeric rarity 1 (common)
    const itemCommon = {
      basePrice: 100,
      rarity: 1, // numeric common
      augments: []
    };

    const resultCommon = calculateSuggestedPrice(itemCommon);
    assert.strictEqual(resultCommon.suggestedPrice, 100); // 100 * 1.0
    assert.strictEqual(resultCommon.breakdown.rarityMultiplier, 1.0);
  });

  test('should normalize numeric string rarity to string names', () => {
    // Test numeric string rarity '4' (epic)
    const item = {
      basePrice: 100,
      rarity: '4', // string '4' = epic
      augments: []
    };

    const result = calculateSuggestedPrice(item);
    assert.strictEqual(result.suggestedPrice, 500); // 100 * 5.0
    assert.strictEqual(result.breakdown.rarityMultiplier, 5.0);
  });

  test('should handle empty augments array', () => {
    const item = {
      basePrice: 100,
      rarity: 'common'
    };

    const result = calculateSuggestedPrice(item);

    assert.strictEqual(result.suggestedPrice, 100);
    assert.strictEqual(result.breakdown.augmentCount, 0);
  });
});

// =============================================================================
// ORDER BOOK TESTS (using mock client)
// =============================================================================

describe('getOrderBook (mock)', () => {
  test('should aggregate buy orders by price level', async () => {
    // Import dynamically to test with mock
    const { getOrderBook } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      // Buy orders query (bids)
      "side = 'buy'": {
        rows: [
          { price: 100, total_quantity: '10', order_count: '3' },
          { price: 95, total_quantity: '5', order_count: '2' }
        ]
      },
      // Sell orders query (asks)
      "side = 'sell'": {
        rows: [
          { price: 105, total_quantity: '8', order_count: '2' },
          { price: 110, total_quantity: '15', order_count: '4' }
        ]
      }
    });

    const result = await getOrderBook(client, 10, 20);

    assert.strictEqual(result.itemTemplateId, 10);
    assert.strictEqual(result.bids.length, 2);
    assert.strictEqual(result.asks.length, 2);
    assert.strictEqual(result.bestBid, 100);
    assert.strictEqual(result.bestAsk, 105);
    assert.strictEqual(result.spread, 5);
  });

  test('should return empty arrays when no orders exist', async () => {
    const { getOrderBook } = await import('../../services/marketplaceService.js');

    const client = createMockClient({});

    const result = await getOrderBook(client, 10, 20);

    assert.strictEqual(result.bids.length, 0);
    assert.strictEqual(result.asks.length, 0);
    assert.strictEqual(result.bestBid, 0);
    assert.strictEqual(result.bestAsk, 0);
    assert.strictEqual(result.spread, null);
  });

  test('should calculate spread as null when only bids exist', async () => {
    const { getOrderBook } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      "side = 'buy'": {
        rows: [{ price: 100, total_quantity: '10', order_count: '1' }]
      },
      "side = 'sell'": { rows: [] }
    });

    const result = await getOrderBook(client, 10, 20);

    assert.strictEqual(result.bestBid, 100);
    assert.strictEqual(result.bestAsk, 0);
    assert.strictEqual(result.spread, null);
  });

  test('should parse integer values correctly from database strings', async () => {
    const { getOrderBook } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      "side = 'buy'": {
        rows: [{ price: '999', total_quantity: '1234', order_count: '56' }]
      },
      "side = 'sell'": { rows: [] }
    });

    const result = await getOrderBook(client, 10, 20);

    assert.strictEqual(result.bids[0].price, 999);
    assert.strictEqual(result.bids[0].quantity, 1234);
    assert.strictEqual(result.bids[0].orderCount, 56);
  });
});

// =============================================================================
// ORDER MATCHING TESTS (using mock client)
// =============================================================================

describe('getMatchingOrders (mock)', () => {
  test('should find sell orders at or below buy price', async () => {
    const { getMatchingOrders } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      "side = 'sell'": {
        rows: [
          createMockOrder({ id: 1, side: 'sell', price: 90, user_id: 200 }),
          createMockOrder({ id: 2, side: 'sell', price: 95, user_id: 201 })
        ]
      }
    });

    const result = await getMatchingOrders(client, 10, 'buy', 100, 100);

    // Should have made query for sell orders
    const calls = client.getCalls();
    assert.ok(calls.some(c => c.sql.includes("side = 'sell'")));
  });

  test('should find buy orders at or above sell price', async () => {
    const { getMatchingOrders } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      "side = 'buy'": {
        rows: [
          createMockOrder({ id: 1, side: 'buy', price: 110, user_id: 200 }),
          createMockOrder({ id: 2, side: 'buy', price: 105, user_id: 201 })
        ]
      }
    });

    const result = await getMatchingOrders(client, 10, 'sell', 100, 100);

    // Should have made query for buy orders
    const calls = client.getCalls();
    assert.ok(calls.some(c => c.sql.includes("side = 'buy'")));
  });

  test('should exclude orders from the same user', async () => {
    const { getMatchingOrders } = await import('../../services/marketplaceService.js');

    const client = createMockClient({});

    await getMatchingOrders(client, 10, 'buy', 100, 100);

    // Check that user exclusion is in the query
    const calls = client.getCalls();
    assert.ok(calls.some(c => c.params && c.params.includes(100)));
  });
});

// =============================================================================
// GOLD RESERVATION TESTS (using mock client)
// =============================================================================

describe('reserveGold (mock)', () => {
  test('should deduct gold from user and create reservation', async () => {
    const { reserveGold } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT gold FROM users': {
        rows: [{ gold: 10000 }]
      },
      'UPDATE users SET gold': { rowCount: 1 },
      'INSERT INTO gold_reservations': { rowCount: 1 }
    });

    const result = await reserveGold(client, 100, 1, 500);

    assert.strictEqual(result, 500);

    // Verify queries were made
    const calls = client.getCalls();
    assert.ok(calls.some(c => c.sql.includes('SELECT gold FROM users')));
    assert.ok(calls.some(c => c.sql.includes('UPDATE users SET gold')));
    assert.ok(calls.some(c => c.sql.includes('INSERT INTO gold_reservations')));
  });

  test('should throw error when user not found', async () => {
    const { reserveGold } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT gold FROM users': { rows: [] }
    });

    await assert.rejects(
      async () => await reserveGold(client, 100, 1, 500),
      /User not found/
    );
  });

  test('should throw error when insufficient gold', async () => {
    const { reserveGold } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT gold FROM users': {
        rows: [{ gold: 100 }]
      }
    });

    await assert.rejects(
      async () => await reserveGold(client, 100, 1, 500),
      /Insufficient gold/
    );
  });
});

describe('releaseGold (mock)', () => {
  test('should return gold to user and delete reservation', async () => {
    const { releaseGold } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT user_id, amount FROM gold_reservations': {
        rows: [{ user_id: 100, amount: 500 }]
      },
      'UPDATE users SET gold': { rowCount: 1 },
      'DELETE FROM gold_reservations': { rowCount: 1 }
    });

    const result = await releaseGold(client, 1);

    assert.strictEqual(result, 500);
  });

  test('should return 0 when no reservation exists', async () => {
    const { releaseGold } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT user_id, amount FROM gold_reservations': { rows: [] }
    });

    const result = await releaseGold(client, 999);

    assert.strictEqual(result, 0);
  });

  test('should handle partial release and update reservation', async () => {
    const { releaseGold } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT user_id, amount FROM gold_reservations': {
        rows: [{ user_id: 100, amount: 1000 }]
      },
      'UPDATE users SET gold': { rowCount: 1 },
      'UPDATE gold_reservations SET amount': { rowCount: 1 }
    });

    const result = await releaseGold(client, 1, 300);

    assert.strictEqual(result, 300);

    // Should update, not delete
    const calls = client.getCalls();
    assert.ok(calls.some(c => c.sql.includes('UPDATE gold_reservations SET amount')));
  });
});

// =============================================================================
// ITEM ESCROW TESTS (using mock client)
// =============================================================================

describe('escrowItems (mock)', () => {
  test('should deduct items from user pool and create escrow', async () => {
    const { escrowItems } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT id, quantity': {
        rows: [{ id: 1, quantity: 10 }]
      },
      'UPDATE character_items SET quantity': { rowCount: 1 },
      'INSERT INTO item_escrow': { rowCount: 1 }
    });

    const result = await escrowItems(client, 1, 100, 1, 10, 5);

    assert.strictEqual(result, 5);
  });

  test('should throw error when insufficient items', async () => {
    const { escrowItems } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT id, quantity': {
        rows: [{ id: 1, quantity: 2 }]
      }
    });

    await assert.rejects(
      async () => await escrowItems(client, 1, 100, 1, 10, 5),
      /Insufficient items/
    );
  });

  test('should delete item row when quantity reaches 0', async () => {
    const { escrowItems } = await import('../../services/marketplaceService.js');

    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT id, quantity')) {
          return { rows: [{ id: 1, quantity: 5 }] };
        }
        return { rowCount: 1 };
      }
    };

    await escrowItems(client, 1, 100, 1, 10, 5);

    // Should delete instead of update when quantity matches
    assert.ok(calls.some(c => c.sql.includes('DELETE FROM character_items')));
  });
});

describe('releaseEscrowedItems (mock)', () => {
  test('should return items to user pool and delete escrow', async () => {
    const { releaseEscrowedItems } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT character_id, item_template_id, quantity FROM item_escrow': {
        rows: [{ character_id: 1, item_template_id: 10, quantity: 5 }]
      },
      'SELECT user_id FROM market_orders': {
        rows: [{ user_id: 100 }]
      },
      'SELECT item_type FROM item_templates': {
        rows: [{ item_type: 'consumable' }]
      },
      'SELECT id, quantity FROM character_items': {
        rows: []
      },
      'INSERT INTO character_items': { rowCount: 1 },
      'DELETE FROM item_escrow': { rowCount: 1 }
    });

    const result = await releaseEscrowedItems(client, 1);

    assert.strictEqual(result, 5);
  });

  test('should return 0 when no escrow exists', async () => {
    const { releaseEscrowedItems } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT character_id, item_template_id, quantity FROM item_escrow': { rows: [] }
    });

    const result = await releaseEscrowedItems(client, 999);

    assert.strictEqual(result, 0);
  });
});

// =============================================================================
// TRADE EXECUTION TESTS (using mock client)
// =============================================================================

describe('executeTrade (mock)', () => {
  test('should record trade and update both orders', async () => {
    const { executeTrade } = await import('../../services/marketplaceService.js');

    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('INSERT INTO market_trades')) {
          return { rows: [{ id: 1 }] };
        }
        if (sql.includes('SELECT quantity, quantity_filled, status')) {
          return { rows: [{ quantity: 5, quantity_filled: 5, status: 'filled' }] };
        }
        if (sql.includes('SELECT user_id, item_template_id FROM market_orders')) {
          return { rows: [{ user_id: 100, item_template_id: 10 }] };
        }
        if (sql.includes('SELECT item_type FROM item_templates')) {
          return { rows: [{ item_type: 'weapon' }] };
        }
        return { rows: [], rowCount: 1 };
      }
    };

    const buyOrder = createMockOrder({ id: 1, side: 'buy', user_id: 100, item_template_id: 10 });
    const sellOrder = createMockOrder({ id: 2, side: 'sell', user_id: 200, item_template_id: 10 });

    const result = await executeTrade(client, buyOrder, sellOrder, 5, 100, 'Test Sword');

    assert.strictEqual(result.quantity, 5);
    assert.strictEqual(result.price, 100);
    assert.strictEqual(result.totalGold, 500);

    // Verify trade was inserted
    assert.ok(calls.some(c => c.sql.includes('INSERT INTO market_trades')));
  });

  test('should apply 5% seller tax', async () => {
    const { executeTrade } = await import('../../services/marketplaceService.js');

    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('INSERT INTO market_trades')) {
          return { rows: [{ id: 1 }] };
        }
        if (sql.includes('SELECT quantity, quantity_filled, status')) {
          return { rows: [{ quantity: 10, quantity_filled: 10, status: 'filled' }] };
        }
        if (sql.includes('SELECT user_id, item_template_id FROM market_orders')) {
          return { rows: [{ user_id: 100, item_template_id: 10 }] };
        }
        if (sql.includes('SELECT item_type FROM item_templates')) {
          return { rows: [{ item_type: 'weapon' }] };
        }
        return { rows: [], rowCount: 1 };
      }
    };

    const buyOrder = createMockOrder({ id: 1, side: 'buy', user_id: 100 });
    const sellOrder = createMockOrder({ id: 2, side: 'sell', user_id: 200 });

    const result = await executeTrade(client, buyOrder, sellOrder, 10, 100, 'Test Sword');

    // Total = 10 * 100 = 1000
    // Tax = 1000 * 0.05 = 50
    // Net = 950
    assert.strictEqual(result.totalGold, 1000);
    assert.strictEqual(result.taxAmount, 50);
    assert.strictEqual(result.netGold, 950);
    assert.strictEqual(result.taxRate, 0.05);
  });

  test('should include audit info for post-transaction logging', async () => {
    const { executeTrade } = await import('../../services/marketplaceService.js');

    const client = {
      query: async (sql) => {
        if (sql.includes('INSERT INTO market_trades')) {
          return { rows: [{ id: 1 }] };
        }
        if (sql.includes('SELECT quantity, quantity_filled, status')) {
          return { rows: [{ quantity: 5, quantity_filled: 5, status: 'filled' }] };
        }
        if (sql.includes('SELECT user_id, item_template_id FROM market_orders')) {
          return { rows: [{ user_id: 100, item_template_id: 10 }] };
        }
        if (sql.includes('SELECT item_type FROM item_templates')) {
          return { rows: [{ item_type: 'weapon' }] };
        }
        return { rows: [], rowCount: 1 };
      }
    };

    const buyOrder = createMockOrder({ id: 1, side: 'buy', user_id: 100, item_template_id: 10 });
    const sellOrder = createMockOrder({ id: 2, side: 'sell', user_id: 200, item_template_id: 10 });

    const result = await executeTrade(client, buyOrder, sellOrder, 5, 100);

    assert.ok(result._auditInfo);
    assert.strictEqual(result._auditInfo.buyerId, 100);
    assert.strictEqual(result._auditInfo.sellerId, 200);
  });
});

// =============================================================================
// PLACE LIMIT ORDER TESTS (using mock client)
// =============================================================================

describe('placeLimitOrder (mock)', () => {
  test('should create buy order and reserve gold', async () => {
    const { placeLimitOrder } = await import('../../services/marketplaceService.js');

    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT COUNT(*) as count FROM market_orders')) {
          return { rows: [{ count: '0' }] };
        }
        if (sql.includes('SELECT id, name, is_tradeable') && sql.includes('FROM item_templates')) {
          return { rows: [{ id: 10, name: 'Test Sword', is_tradeable: true, is_stackable: true }] };
        }
        if (sql.includes('INSERT INTO market_orders')) {
          return {
            rows: [{
              id: 1, user_id: 100, character_id: 1, item_template_id: 10,
              side: 'buy', price: 100, quantity: 5, quantity_filled: 0,
              status: 'open', created_at: new Date()
            }]
          };
        }
        if (sql.includes('SELECT gold FROM users')) {
          return { rows: [{ gold: 10000 }] };
        }
        if (sql.includes('SELECT * FROM market_orders WHERE id')) {
          return {
            rows: [{
              id: 1, status: 'open', quantity: 5, quantity_filled: 0
            }]
          };
        }
        // No matching orders for simplicity
        if (sql.includes("side = 'sell'") && sql.includes('status IN')) {
          return { rows: [] };
        }
        return { rows: [], rowCount: 1 };
      }
    };

    const result = await placeLimitOrder(client, 100, 1, 10, 'buy', 100, 5);

    assert.ok(result.order);
    assert.strictEqual(result.order.id, 1);
    assert.strictEqual(result.trades.length, 0);

    // Verify gold was reserved
    assert.ok(calls.some(c => c.sql.includes('INSERT INTO gold_reservations')));
  });

  test('should create sell order and escrow items', async () => {
    const { placeLimitOrder } = await import('../../services/marketplaceService.js');

    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT COUNT(*) as count FROM market_orders')) {
          return { rows: [{ count: '0' }] };
        }
        if (sql.includes('SELECT id, name, is_tradeable') && sql.includes('FROM item_templates')) {
          return { rows: [{ id: 10, name: 'Test Sword', is_tradeable: true, is_stackable: true }] };
        }
        if (sql.includes('INSERT INTO market_orders')) {
          return {
            rows: [{
              id: 1, user_id: 100, character_id: 1, item_template_id: 10,
              side: 'sell', price: 100, quantity: 5, quantity_filled: 0,
              status: 'open', created_at: new Date()
            }]
          };
        }
        if (sql.includes('SELECT id, quantity') && sql.includes('character_items')) {
          return { rows: [{ id: 1, quantity: 10 }] };
        }
        if (sql.includes('SELECT * FROM market_orders WHERE id')) {
          return {
            rows: [{
              id: 1, status: 'open', quantity: 5, quantity_filled: 0
            }]
          };
        }
        // No matching orders
        if (sql.includes("side = 'buy'") && sql.includes('status IN')) {
          return { rows: [] };
        }
        return { rows: [], rowCount: 1 };
      }
    };

    const result = await placeLimitOrder(client, 100, 1, 10, 'sell', 100, 5);

    assert.ok(result.order);
    assert.strictEqual(result.trades.length, 0);

    // Verify items were escrowed
    assert.ok(calls.some(c => c.sql.includes('INSERT INTO item_escrow')));
  });

  test('should throw error when item is not tradeable', async () => {
    const { placeLimitOrder } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT COUNT(*) as count FROM market_orders': { rows: [{ count: '0' }] },
      'name, is_tradeable': {
        rows: [{ id: 10, name: 'Quest Item', is_tradeable: false, is_stackable: true }]
      }
    });

    await assert.rejects(
      async () => await placeLimitOrder(client, 100, 1, 10, 'buy', 100, 5),
      /cannot be traded/
    );
  });

  test('should throw error when max orders exceeded', async () => {
    const { placeLimitOrder } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT COUNT(*) as count FROM market_orders': { rows: [{ count: '50' }] }
    });

    await assert.rejects(
      async () => await placeLimitOrder(client, 100, 1, 10, 'buy', 100, 5),
      /Maximum.*open orders/
    );
  });
});

// =============================================================================
// CANCEL ORDER TESTS (using mock client)
// =============================================================================

describe('cancelOrder (mock)', () => {
  test('should cancel buy order and release gold', async () => {
    const { cancelOrder } = await import('../../services/marketplaceService.js');

    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT id, user_id') && sql.includes('market_orders')) {
          return {
            rows: [{
              id: 1, user_id: 100, character_id: 1, item_template_id: 10,
              side: 'buy', price: 100, quantity: 5, quantity_filled: 0, status: 'open'
            }]
          };
        }
        if (sql.includes('SELECT user_id, amount FROM gold_reservations')) {
          return { rows: [{ user_id: 100, amount: 500 }] };
        }
        if (sql.includes('SELECT name FROM item_templates')) {
          return { rows: [{ name: 'Test Sword' }] };
        }
        if (sql.includes("side = 'buy'") || sql.includes("side = 'sell'")) {
          return { rows: [] };
        }
        return { rows: [], rowCount: 1 };
      }
    };

    const result = await cancelOrder(client, 1, 100);

    assert.strictEqual(result.orderId, 1);
    assert.strictEqual(result.side, 'buy');
    assert.strictEqual(result.returnedGold, 500);
  });

  test('should cancel sell order and release escrowed items', async () => {
    const { cancelOrder } = await import('../../services/marketplaceService.js');

    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT id, user_id') && sql.includes('market_orders') && sql.includes('FOR UPDATE')) {
          return {
            rows: [{
              id: 1, user_id: 100, character_id: 1, item_template_id: 10,
              side: 'sell', price: 100, quantity: 5, quantity_filled: 2, status: 'partial'
            }]
          };
        }
        if (sql.includes('SELECT character_id, item_template_id, quantity FROM item_escrow')) {
          return { rows: [{ character_id: 1, item_template_id: 10, quantity: 3 }] };
        }
        if (sql.includes('SELECT item_type FROM item_templates')) {
          return { rows: [{ item_type: 'weapon' }] };
        }
        if (sql.includes('SELECT name FROM item_templates')) {
          return { rows: [{ name: 'Test Sword' }] };
        }
        if (sql.includes("side = 'buy'") || sql.includes("side = 'sell'")) {
          return { rows: [] };
        }
        return { rows: [], rowCount: 1 };
      }
    };

    const result = await cancelOrder(client, 1, 100);

    assert.strictEqual(result.orderId, 1);
    assert.strictEqual(result.side, 'sell');
    assert.strictEqual(result.returnedQuantity, 3);
    assert.strictEqual(result.returnedGold, 0);
  });

  test('should throw error when order not found', async () => {
    const { cancelOrder } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT id, user_id': { rows: [] }
    });

    await assert.rejects(
      async () => await cancelOrder(client, 999, 100),
      /Order not found/
    );
  });

  test('should throw error when not authorized', async () => {
    const { cancelOrder } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT id, user_id': {
        rows: [{
          id: 1, user_id: 200, side: 'buy', price: 100, quantity: 5,
          quantity_filled: 0, status: 'open'
        }]
      }
    });

    await assert.rejects(
      async () => await cancelOrder(client, 1, 100),
      /Not authorized/
    );
  });

  test('should throw error when order already cancelled', async () => {
    const { cancelOrder } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT id, user_id': {
        rows: [{
          id: 1, user_id: 100, side: 'buy', price: 100, quantity: 5,
          quantity_filled: 5, status: 'filled'
        }]
      }
    });

    await assert.rejects(
      async () => await cancelOrder(client, 1, 100),
      /cannot be cancelled/
    );
  });
});

// =============================================================================
// ADD ITEM TO USER TESTS
// =============================================================================

describe('addItemToUser (mock)', () => {
  test('should stack consumable items with existing stack', async () => {
    const { addItemToUser } = await import('../../services/marketplaceService.js');

    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT item_type FROM item_templates')) {
          return { rows: [{ item_type: 'consumable' }] };
        }
        if (sql.includes('SELECT id, quantity FROM character_items') && sql.includes('user_id')) {
          return { rows: [{ id: 1, quantity: 5 }] };
        }
        return { rows: [], rowCount: 1 };
      }
    };

    await addItemToUser(client, 100, 10, 3);

    // Should update existing stack, not insert new
    assert.ok(calls.some(c => c.sql.includes('UPDATE character_items SET quantity')));
    assert.ok(!calls.some(c => c.sql.includes('INSERT INTO character_items') && !c.sql.includes('SELECT')));
  });

  test('should create new stack for consumable without existing stack', async () => {
    const { addItemToUser } = await import('../../services/marketplaceService.js');

    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT item_type FROM item_templates')) {
          return { rows: [{ item_type: 'consumable' }] };
        }
        if (sql.includes('SELECT id, quantity FROM character_items')) {
          return { rows: [] };
        }
        return { rows: [], rowCount: 1 };
      }
    };

    await addItemToUser(client, 100, 10, 3);

    // Should insert new item
    assert.ok(calls.some(c => c.sql.includes('INSERT INTO character_items')));
  });

  test('should create individual entries for non-stackable items', async () => {
    const { addItemToUser } = await import('../../services/marketplaceService.js');

    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT item_type FROM item_templates')) {
          return { rows: [{ item_type: 'weapon' }] };
        }
        return { rows: [], rowCount: 1 };
      }
    };

    await addItemToUser(client, 100, 10, 3);

    // Should create 3 separate entries
    const inserts = calls.filter(c => c.sql.includes('INSERT INTO character_items'));
    assert.strictEqual(inserts.length, 3);
  });
});

// =============================================================================
// EDGE CASE TESTS
// =============================================================================

describe('Edge Cases', () => {
  test('calculateSuggestedPrice should handle minimum base price', () => {
    const item = {
      basePrice: 1,
      rarity: 'common',
      augments: []
    };

    const result = calculateSuggestedPrice(item);

    assert.strictEqual(result.suggestedPrice, 1);
  });

  test('calculateSuggestedPrice should handle high value augments', () => {
    const item = {
      basePrice: 100,
      rarity: 'legendary',  // 10x
      augments: [
        { category: 'dragon_slayer' },  // 1.2
        { category: 'demon_slayer' },   // 1.2
        { category: 'revive_full' }     // 1.5
      ]
    };

    const result = calculateSuggestedPrice(item);

    // augmentValue = 1.2 + 1.2 + 1.5 = 3.9
    // augmentMult = 1.0 + (3.9 * 0.15) = 1.585
    // suggestedPrice = 100 * 10 * 1.585 = 1585
    assert.strictEqual(result.suggestedPrice, 1585);
    assert.ok(result.breakdown.augmentMultiplier > 1.5);
  });
});

// =============================================================================
// USER ORDERS AND LISTINGS TESTS
// =============================================================================

describe('getUserOrders (mock)', () => {
  test('should return formatted order list', async () => {
    const { getUserOrders } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT': {
        rows: [
          {
            id: 1, item_template_id: 10, side: 'buy', price: '100',
            quantity: '5', quantity_filled: '2', status: 'partial',
            created_at: new Date(), item_name: 'Test Sword',
            item_type: 'weapon', rarity: 'common'
          }
        ]
      }
    });

    const result = await getUserOrders(client, 100);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 1);
    assert.strictEqual(result[0].price, 100);
    assert.strictEqual(result[0].quantityRemaining, 3);
  });

  test('should filter by status when provided', async () => {
    const { getUserOrders } = await import('../../services/marketplaceService.js');

    const calls = [];
    const client = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [] };
      }
    };

    await getUserOrders(client, 100, 'filled');

    // Should include status filter in query
    assert.ok(calls.some(c => c.params && c.params.includes('filled')));
  });
});

describe('getTradeHistory (mock)', () => {
  test('should return formatted trade history', async () => {
    const { getTradeHistory } = await import('../../services/marketplaceService.js');

    const client = createMockClient({
      'SELECT': {
        rows: [
          {
            price: '100', quantity: '5', total_gold: '500',
            executed_at: new Date(), item_name: 'Test Sword'
          }
        ]
      }
    });

    const result = await getTradeHistory(client, 10, 50);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].price, 100);
    assert.strictEqual(result[0].quantity, 5);
    assert.strictEqual(result[0].totalGold, 500);
  });
});
