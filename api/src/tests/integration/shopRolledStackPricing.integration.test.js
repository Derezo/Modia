/**
 * Shop pricing vs. rolled consumable drops (release-review blocker).
 *
 * An enemy-dropped consumable can carry a rolled rarity and augments. Before
 * the fix, shop buys stacked into that rolled row and the whole stack sold at
 * the rolled valuation (epic Phoenix Feather: buy <= 600, sell 1625), which is
 * unbounded gold. Now stackables always sell at 50% of base_price and buys
 * never top up a rolled row.
 *
 * Requires the API server running (PORT, default 3001).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext, request, query } from '../testHelper.js';

const PHOENIX_FEATHER = 15;

describe('shop pricing of rolled consumable stacks (live)', () => {
  const ctx = createTestContext();
  let user;
  let nodeId;
  let rolledRowId;
  let basePrice;
  let originalStock;

  before(async () => {
    const shop = await query(
      `SELECT nsi.node_id, nsi.quantity, it.base_price
       FROM npc_shop_inventory nsi
       JOIN item_templates it ON it.id = nsi.item_template_id
       WHERE nsi.shop_type = 'apothecary' AND nsi.item_template_id = $1
       ORDER BY nsi.node_id
       LIMIT 1`,
      [PHOENIX_FEATHER]
    );
    assert.equal(shop.rows.length, 1, 'an apothecary must stock Phoenix Feather');
    nodeId = shop.rows[0].node_id;
    basePrice = shop.rows[0].base_price;
    originalStock = shop.rows[0].quantity;
    // Make sure there is stock to buy
    await query(
      `UPDATE npc_shop_inventory SET quantity = GREATEST(quantity, 5)
       WHERE node_id = $1 AND shop_type = 'apothecary' AND item_template_id = $2`,
      [nodeId, PHOENIX_FEATHER]
    );

    user = await ctx.createUser();
    await ctx.createCharacter(user.accessToken);
    await query(
      `UPDATE characters SET current_node_id = $1
       WHERE user_id = $2 AND party_slot IS NOT NULL`,
      [nodeId, user.userId]
    );
    await query('UPDATE users SET gold = 100000 WHERE id = $1', [user.userId]);

    // An epic 2-augment feather drop, as itemDropService stores it
    const inserted = await query(
      `INSERT INTO character_items (user_id, item_template_id, quantity, modifications)
       VALUES ($1, $2, 1, $3) RETURNING id`,
      [user.userId, PHOENIX_FEATHER, JSON.stringify({
        rarity: 4,
        augments: [
          { key: 'revive_bonus', type: 'prefix', category: 'revive_bonus' },
          { key: 'instant', type: 'suffix', category: 'instant' }
        ]
      })]
    );
    rolledRowId = inserted.rows[0].id;
  });

  after(async () => {
    await query(
      `UPDATE npc_shop_inventory SET quantity = $3
       WHERE node_id = $1 AND shop_type = 'apothecary' AND item_template_id = $2`,
      [nodeId, PHOENIX_FEATHER, originalStock]
    );
    await ctx.cleanup();
  });

  it('a bought feather does not stack into the rolled drop row', async () => {
    const buy = await request(
      'POST',
      `/api/shops/${nodeId}/apothecary/buy`,
      { itemTemplateId: PHOENIX_FEATHER, quantity: 2 },
      user.accessToken
    );
    assert.equal(buy.status, 200, JSON.stringify(buy.body));

    const rows = await query(
      `SELECT id, quantity, modifications FROM character_items
       WHERE user_id = $1 AND item_template_id = $2 ORDER BY id`,
      [user.userId, PHOENIX_FEATHER]
    );
    const rolled = rows.rows.find(r => r.id === rolledRowId);
    assert.equal(rolled.quantity, 1, 'rolled row must keep its single unit');
    const plain = rows.rows.filter(r => r.id !== rolledRowId);
    assert.equal(plain.length, 1);
    assert.equal(plain[0].quantity, 2);
  });

  it('shows and pays 50% of base_price for the rolled consumable', async () => {
    const inv = await request(
      'GET',
      `/api/shops/${nodeId}/apothecary/sell-inventory`,
      null,
      user.accessToken
    );
    assert.equal(inv.status, 200);
    const listed = inv.body.items.find(i => i.instanceId === rolledRowId);
    assert.ok(listed, 'rolled feather listed for sale');
    const expected = Math.floor(basePrice * 0.5);
    assert.equal(listed.sellPrice, expected);

    const before = await query('SELECT gold FROM users WHERE id = $1', [user.userId]);
    const sell = await request(
      'POST',
      `/api/shops/${nodeId}/apothecary/sell`,
      { itemInstanceId: rolledRowId, quantity: 1 },
      user.accessToken
    );
    assert.equal(sell.status, 200, JSON.stringify(sell.body));
    const afterGold = await query('SELECT gold FROM users WHERE id = $1', [user.userId]);
    assert.equal(afterGold.rows[0].gold - before.rows[0].gold, expected);
  });
});
