/**
 * Unit tests for marketplace/search.js
 *
 * Tests cover the two main exported functions:
 * - searchItems: Basic search with name filter, item type filter, pagination
 * - searchItemsWithAugments: Extended search with augment category filtering
 *
 * Mock database responses test:
 * - Happy path with results
 * - Empty result sets
 * - Database query parameter binding
 * - Result transformation and type conversion
 * - Complex LATERAL JOIN logic for market data aggregation
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { createMockQuery } from '../testUtils/index.js';

// =============================================================================
// MOCK DATABASE CLIENT
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

// =============================================================================
// TEST DATA FACTORIES
// =============================================================================

/**
 * Create mock item template row data
 */
function createMockItemRow(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? 'Iron Sword',
    description: overrides.description ?? 'A sturdy iron sword',
    item_type: overrides.item_type ?? 'weapon',
    equipment_slot: overrides.equipment_slot ?? 'weapon',
    stat_bonuses: overrides.stat_bonuses ?? { str: 5, attack: 10 },
    level_requirement: overrides.level_requirement ?? 5,
    base_price: overrides.base_price ?? 100,
    rarity: overrides.rarity ?? 'common',
    is_stackable: overrides.is_stackable ?? false,
    sprite_id: overrides.sprite_id ?? 'iron_sword',
    // Market data (from LATERAL JOINs)
    best_ask: overrides.best_ask ?? 120,
    best_bid: overrides.best_bid ?? 110,
    volume_24h: overrides.volume_24h ?? 50,
    open_orders: overrides.open_orders ?? 8,
    listing_count: overrides.listing_count ?? 3,
    min_listing_price: overrides.min_listing_price ?? 115,
    max_listing_price: overrides.max_listing_price ?? 125,
    ...overrides
  };
}

/**
 * Create expected search result after transformation
 */
function createExpectedResult(rowData) {
  return {
    id: rowData.id,
    name: rowData.name,
    description: rowData.description,
    itemType: rowData.item_type,
    equipmentSlot: rowData.equipment_slot,
    statBonuses: rowData.stat_bonuses,
    levelRequirement: rowData.level_requirement,
    basePrice: rowData.base_price,
    rarity: rowData.rarity,
    isStackable: rowData.is_stackable || false,
    spriteId: rowData.sprite_id,
    bestAsk: rowData.best_ask ? parseInt(rowData.best_ask, 10) : null,
    bestBid: rowData.best_bid ? parseInt(rowData.best_bid, 10) : null,
    volume24h: parseInt(rowData.volume_24h, 10) || 0,
    openOrders: parseInt(rowData.open_orders, 10) || 0,
    listingCount: parseInt(rowData.listing_count, 10) || 0,
    minListingPrice: rowData.min_listing_price ? parseInt(rowData.min_listing_price, 10) : null,
    maxListingPrice: rowData.max_listing_price ? parseInt(rowData.max_listing_price, 10) : null
  };
}

// =============================================================================
// IMPORT SERVICE FUNCTIONS
// =============================================================================

import { searchItems, searchItemsWithAugments } from '../../services/marketplace/search.js';

// =============================================================================
// TESTS
// =============================================================================

describe('marketplace/search', () => {
  describe('searchItems', () => {
    it('should return items with market data', async () => {
      const mockRows = [
        createMockItemRow({ id: 1, name: 'Iron Sword' }),
        createMockItemRow({ id: 2, name: 'Steel Sword', best_ask: 200 })
      ];

      const client = createMockClient({
        'SELECT': { rows: mockRows, rowCount: 2 }
      });

      const results = await searchItems(client);

      assert.strictEqual(results.length, 2);
      assert.strictEqual(results[0].name, 'Iron Sword');
      assert.strictEqual(results[0].bestAsk, 120);
      assert.strictEqual(results[1].name, 'Steel Sword');
      assert.strictEqual(results[1].bestAsk, 200);

      // Verify query was called
      const calls = client.getCalls();
      assert.strictEqual(calls.length, 1);
      assert.ok(calls[0].sql.includes('item_templates it'));
    });

    it('should filter by search term', async () => {
      const mockRows = [
        createMockItemRow({ id: 1, name: 'Iron Sword' })
      ];

      const client = createMockClient({
        'ILIKE': { rows: mockRows, rowCount: 1 }
      });

      const results = await searchItems(client, 'iron', null, 50);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].name, 'Iron Sword');

      // Verify search parameter was passed
      const call = client.getLastCall();
      assert.ok(call.sql.includes('ILIKE'));
      assert.strictEqual(call.params[0], '%iron%');
    });

    it('should filter by item type', async () => {
      const mockRows = [
        createMockItemRow({ id: 1, name: 'Iron Sword', item_type: 'weapon' })
      ];

      const client = createMockClient({
        'item_type': { rows: mockRows, rowCount: 1 }
      });

      const results = await searchItems(client, '', 'weapon', 50);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].itemType, 'weapon');

      // Verify item type parameter
      const call = client.getLastCall();
      assert.ok(call.sql.includes('it.item_type = $'));
      assert.strictEqual(call.params[0], 'weapon');
    });

    it('should combine search term and item type filters', async () => {
      const mockRows = [
        createMockItemRow({ id: 1, name: 'Iron Sword', item_type: 'weapon' })
      ];

      const client = createMockClient({
        'ILIKE': { rows: mockRows, rowCount: 1 }
      });

      const results = await searchItems(client, 'iron', 'weapon', 50);

      assert.strictEqual(results.length, 1);

      // Verify both parameters
      const call = client.getLastCall();
      assert.ok(call.sql.includes('ILIKE'));
      assert.ok(call.sql.includes('it.item_type = $'));
      assert.strictEqual(call.params[0], '%iron%');
      assert.strictEqual(call.params[1], 'weapon');
    });

    it('should respect limit parameter', async () => {
      const client = createMockClient({
        'LIMIT': { rows: [], rowCount: 0 }
      });

      await searchItems(client, '', null, 25);

      const call = client.getLastCall();
      assert.ok(call.sql.includes('LIMIT $'));
      assert.strictEqual(call.params[call.params.length - 1], 25);
    });

    it('should handle empty results', async () => {
      const client = createMockClient({
        'SELECT': { rows: [], rowCount: 0 }
      });

      const results = await searchItems(client);

      assert.strictEqual(results.length, 0);
      assert.ok(Array.isArray(results));
    });

    it('should transform database row format correctly', async () => {
      const mockRow = createMockItemRow({
        id: 42,
        name: 'Mystic Staff',
        item_type: 'weapon',
        equipment_slot: 'mainhand',
        stat_bonuses: { int: 10, magicAttack: 15 },
        level_requirement: 20,
        base_price: 500,
        rarity: 'rare',
        is_stackable: false,
        sprite_id: 'mystic_staff',
        best_ask: '750',
        best_bid: '700',
        volume_24h: '25',
        open_orders: '5',
        listing_count: '2',
        min_listing_price: '720',
        max_listing_price: '750'
      });

      const client = createMockClient({
        'SELECT': { rows: [mockRow], rowCount: 1 }
      });

      const results = await searchItems(client);

      const expected = createExpectedResult(mockRow);
      assert.deepStrictEqual(results[0], expected);
    });

    it('should handle null market data gracefully', async () => {
      const mockRow = createMockItemRow({
        best_ask: null,
        best_bid: null,
        volume_24h: null,
        open_orders: null,
        listing_count: null,
        min_listing_price: null,
        max_listing_price: null
      });

      const client = createMockClient({
        'SELECT': { rows: [mockRow], rowCount: 1 }
      });

      const results = await searchItems(client);

      assert.strictEqual(results[0].bestAsk, null);
      assert.strictEqual(results[0].bestBid, null);
      assert.strictEqual(results[0].volume24h, 0);
      assert.strictEqual(results[0].openOrders, 0);
      assert.strictEqual(results[0].listingCount, 0);
      assert.strictEqual(results[0].minListingPrice, null);
      assert.strictEqual(results[0].maxListingPrice, null);
    });

    it('should handle database errors', async () => {
      const client = createMockClient({
        'SELECT': () => { throw new Error('Database connection failed'); }
      });

      await assert.rejects(
        () => searchItems(client),
        /Database connection failed/
      );
    });

    it('should include proper ORDER BY clause', async () => {
      const client = createMockClient({
        'ORDER BY': { rows: [], rowCount: 0 }
      });

      await searchItems(client);

      const call = client.getLastCall();
      assert.ok(call.sql.includes('ORDER BY COALESCE(ord.open_orders, 0) DESC, it.name ASC'));
    });
  });

  describe('searchItemsWithAugments', () => {
    it('should search items without augment filter', async () => {
      const mockRows = [
        createMockItemRow({ id: 1, name: 'Iron Sword' })
      ];

      const client = createMockClient({
        'SELECT': { rows: mockRows, rowCount: 1 }
      });

      const results = await searchItemsWithAugments(client, '', 'weapon', null, 50);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].name, 'Iron Sword');

      // Should not include augment filter in query
      const call = client.getLastCall();
      assert.ok(!call.sql.includes('@>'));
    });

    it('should search items with augment category filter', async () => {
      const mockRows = [
        createMockItemRow({ id: 1, name: 'Flaming Sword' })
      ];

      const client = createMockClient({
        'modifications_snapshot': { rows: mockRows, rowCount: 1 }
      });

      const results = await searchItemsWithAugments(client, '', 'weapon', 'fire', 50);

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].name, 'Flaming Sword');

      // Should include augment filter
      const call = client.getLastCall();
      assert.ok(call.sql.includes('modifications_snapshot'));
      assert.ok(call.sql.includes('@>'));

      // Verify augment parameter
      const augmentParam = call.params.find(p =>
        typeof p === 'string' && p.includes('{"category":"fire"}')
      );
      assert.ok(augmentParam);
    });

    it('should combine all filters including augments', async () => {
      const mockRows = [
        createMockItemRow({ id: 1, name: 'Icy Iron Sword', item_type: 'weapon' })
      ];

      const client = createMockClient({
        'ILIKE': { rows: mockRows, rowCount: 1 }
      });

      const results = await searchItemsWithAugments(
        client, 'iron', 'weapon', 'ice', 25
      );

      assert.strictEqual(results.length, 1);

      const call = client.getLastCall();

      // Verify augment parameter comes first
      assert.strictEqual(call.params[0], JSON.stringify([{ category: 'ice' }]));
      // Then search term
      assert.strictEqual(call.params[1], '%iron%');
      // Then item type
      assert.strictEqual(call.params[2], 'weapon');
      // Finally limit
      assert.strictEqual(call.params[3], 25);
    });

    it('should use different ORDER BY for augment search', async () => {
      const client = createMockClient({
        'ORDER BY': { rows: [], rowCount: 0 }
      });

      await searchItemsWithAugments(client, '', null, 'fire', 50);

      const call = client.getLastCall();
      assert.ok(call.sql.includes('ORDER BY (COALESCE(ord.open_orders, 0) + COALESCE(listings.listing_count, 0)) DESC'));
    });

    it('should handle proper parameter indexing with augment filter', async () => {
      const client = createMockClient({
        'modifications_snapshot': { rows: [], rowCount: 0 }
      });

      await searchItemsWithAugments(client, 'test', 'weapon', 'fire', 50);

      const call = client.getLastCall();

      // Verify parameter indices in SQL
      assert.ok(call.sql.includes('$1::jsonb')); // augment filter
      assert.ok(call.sql.includes('ILIKE $2')); // search term
      assert.ok(call.sql.includes('item_type = $3')); // item type
      assert.ok(call.sql.includes('LIMIT $4')); // limit

      // Verify actual parameters
      assert.strictEqual(call.params.length, 4);
      assert.strictEqual(call.params[0], JSON.stringify([{ category: 'fire' }]));
      assert.strictEqual(call.params[1], '%test%');
      assert.strictEqual(call.params[2], 'weapon');
      assert.strictEqual(call.params[3], 50);
    });

    it('should handle empty augment search results', async () => {
      const client = createMockClient({
        'modifications_snapshot': { rows: [], rowCount: 0 }
      });

      const results = await searchItemsWithAugments(client, '', null, 'lightning', 50);

      assert.strictEqual(results.length, 0);
      assert.ok(Array.isArray(results));
    });

    it('should transform results correctly for augment search', async () => {
      const mockRow = createMockItemRow({
        id: 5,
        name: 'Infernal Blade',
        item_type: 'weapon',
        rarity: 'epic',
        best_ask: '1500',
        listing_count: '1'
      });

      const client = createMockClient({
        'modifications_snapshot': { rows: [mockRow], rowCount: 1 }
      });

      const results = await searchItemsWithAugments(client, '', null, 'fire', 50);

      const expected = createExpectedResult(mockRow);
      assert.deepStrictEqual(results[0], expected);
    });

    it('should handle database errors in augment search', async () => {
      const client = createMockClient({
        'modifications_snapshot': () => { throw new Error('JSONB query failed'); }
      });

      await assert.rejects(
        () => searchItemsWithAugments(client, '', null, 'fire', 50),
        /JSONB query failed/
      );
    });

    it('should include tradeable filter in both search functions', async () => {
      const client = createMockClient({
        'is_tradeable': { rows: [], rowCount: 0 }
      });

      await searchItems(client);
      let call = client.getLastCall();
      assert.ok(call.sql.includes('(it.is_tradeable IS NULL OR it.is_tradeable = TRUE)'));

      client.clearCalls();

      await searchItemsWithAugments(client);
      call = client.getLastCall();
      assert.ok(call.sql.includes('(it.is_tradeable IS NULL OR it.is_tradeable = TRUE)'));
    });

    it('should include all LATERAL JOIN subqueries', async () => {
      const client = createMockClient({
        'LATERAL': { rows: [], rowCount: 0 }
      });

      await searchItems(client);

      const call = client.getLastCall();
      const sql = call.sql;

      // Verify all LATERAL JOINs are present
      assert.ok(sql.includes('LEFT JOIN LATERAL')); // Multiple LATERAL joins
      assert.ok(sql.includes('market_orders')); // Orders table
      assert.ok(sql.includes('market_trades')); // Trades table
      assert.ok(sql.includes('item_listings')); // Listings table
      assert.ok(sql.includes("side = 'sell'")); // Ask side
      assert.ok(sql.includes("side = 'buy'")); // Bid side
      assert.ok(sql.includes("status IN ('open', 'partial')")); // Order status
      assert.ok(sql.includes('INTERVAL \'24 hours\'')); // Volume timeframe
    });

    it('should handle large numeric values in market data', async () => {
      const mockRow = createMockItemRow({
        best_ask: '999999999',
        best_bid: '999999998',
        volume_24h: '1000000',
        open_orders: '500',
        listing_count: '100'
      });

      const client = createMockClient({
        'SELECT': { rows: [mockRow], rowCount: 1 }
      });

      const results = await searchItems(client);

      assert.strictEqual(results[0].bestAsk, 999999999);
      assert.strictEqual(results[0].bestBid, 999999998);
      assert.strictEqual(results[0].volume24h, 1000000);
      assert.strictEqual(results[0].openOrders, 500);
      assert.strictEqual(results[0].listingCount, 100);
    });
  });
});