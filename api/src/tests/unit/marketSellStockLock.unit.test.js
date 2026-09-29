/**
 * executeMarketOrder (side 'sell') must reject when the locked stock rows
 * cannot cover the quantity. A concurrent shop sell or discard can delete a
 * row that FOR UPDATE then skips; the trade must not go through for items the
 * seller no longer holds.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { executeMarketOrder } from '../../services/marketplace/orderManagement.js';

function mockClient({ lockedRows }) {
  const calls = [];
  const client = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM item_templates/.test(sql)) {
        return { rows: [{ id: 12, name: 'Health Potion', is_tradeable: true, is_stackable: true }] };
      }
      if (/FROM market_orders/.test(sql) && /side = 'buy'/.test(sql)) {
        return {
          rows: [{ id: 900, user_id: 2, character_id: 20, price: 30, quantity: 10, quantity_filled: 0 }]
        };
      }
      if (/FROM character_items/.test(sql) && /FOR UPDATE/.test(sql)) {
        return { rows: lockedRows };
      }
      return { rows: [], rowCount: 1 };
    }
  };
  return client;
}

describe('executeMarketOrder sell stock check', () => {
  it('rejects when a concurrent delete left fewer locked items than requested', async () => {
    // Seller had 5 (one row of 3 + one of 2); the 3-row was sold to an NPC
    // shop between the old SUM check and the lock, so only 2 remain locked.
    const client = mockClient({ lockedRows: [{ id: 2, quantity: 2 }] });

    await assert.rejects(
      executeMarketOrder(client, 1, 10, 12, 'sell', 5),
      err => err.statusCode === 400 && /Insufficient items/.test(err.message)
    );

    const writes = client.calls.filter(c =>
      /INSERT INTO market_trades|UPDATE users|DELETE FROM character_items|UPDATE character_items|UPDATE market_orders/
        .test(c.sql));
    assert.deepEqual(writes, [], 'no trade, gold credit or item change before the throw');
  });

  it('checks stock only through the locked SELECT (no unlocked SUM pre-check)', async () => {
    const client = mockClient({ lockedRows: [{ id: 2, quantity: 2 }] });
    await assert.rejects(executeMarketOrder(client, 1, 10, 12, 'sell', 5));
    assert.ok(!client.calls.some(c => /SUM\(quantity\)/.test(c.sql)));
  });

  it('deducts across locked rows when stock is sufficient', async () => {
    const client = mockClient({ lockedRows: [{ id: 1, quantity: 3 }, { id: 2, quantity: 4 }] });
    await executeMarketOrder(client, 1, 10, 12, 'sell', 5).catch(() => {});
    const deletes = client.calls.filter(c => /DELETE FROM character_items/.test(c.sql));
    const updates = client.calls.filter(c => /UPDATE character_items SET quantity = quantity - \$1/.test(c.sql));
    assert.deepEqual(deletes.map(c => c.params), [[1]]);
    assert.deepEqual(updates.map(c => c.params), [[2, 2]]);
  });
});
