/**
 * Item listing lifecycle and item-listing sales (live server + database)
 *
 * - Migration 065 replaced UNIQUE(character_item_id, status) with an
 *   active-only partial unique index. Before that, list -> cancel -> relist ->
 *   cancel failed at COMMIT because two 'cancelled' rows collided.
 * - Merchant's Seal eligibility counts an equipment sale through an item
 *   listing (item_listing_sales), not only order-book fills (market_trades).
 *
 * Requires the API server running (PORT, default 3001).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext, request, query } from '../testHelper.js';
import { checkRelicEligibility } from '../../services/relicService.js';

describe('item listing lifecycle', () => {
  const ctx = createTestContext();
  let seller;
  let buyer;
  let sellerCharacter;
  let buyerCharacter;
  let template;

  before(async () => {
    seller = await ctx.createUser();
    buyer = await ctx.createUser();
    sellerCharacter = await ctx.createCharacter(seller.accessToken);
    buyerCharacter = await ctx.createCharacter(buyer.accessToken);
    await query('UPDATE users SET gold = 1000000 WHERE id = $1', [buyer.userId]);
    const equip = await query(
      `SELECT id, base_price FROM item_templates
       WHERE is_tradeable IS NOT FALSE AND is_stackable = FALSE
         AND item_type IN ('weapon', 'armor')
       ORDER BY id LIMIT 1`
    );
    assert.ok(equip.rows.length > 0, 'a tradeable equipment template exists');
    template = equip.rows[0];
  });

  after(async () => {
    const userIds = [seller?.userId, buyer?.userId].filter(Boolean);
    await query(
      'DELETE FROM marketplace_audit WHERE user_id = ANY($1)',
      [userIds]
    ).catch(() => {});
    await query(
      'DELETE FROM marketplace_tax_ledger WHERE seller_id = ANY($1) OR buyer_id = ANY($1)',
      [userIds]
    ).catch(() => {});
    await ctx.cleanup();
  });

  async function giveItem(user) {
    const res = await query(
      `INSERT INTO character_items (user_id, item_template_id, quantity)
       VALUES ($1, $2, 1) RETURNING id`,
      [user.userId, template.id]
    );
    return res.rows[0].id;
  }

  async function list(characterItemId) {
    const res = await request('POST', '/api/marketplace/listings', {
      characterItemId,
      price: Math.max(10, Number(template.base_price) * 2),
      characterId: sellerCharacter.id
    }, seller.accessToken);
    assert.ok([200, 201].includes(res.status), JSON.stringify(res.body));
    return res.body.listing.listingId;
  }

  async function cancel(listingId) {
    const res = await request('DELETE', `/api/marketplace/listings/${listingId}`, null, seller.accessToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }

  it('list, cancel, relist and cancel again keeps both cancelled rows', async () => {
    const itemId = await giveItem(seller);

    const first = await list(itemId);
    await cancel(first);
    const second = await list(itemId);
    assert.notEqual(second, first);
    await cancel(second);

    const rows = await query(
      `SELECT id, status FROM item_listings WHERE character_item_id = $1 ORDER BY id`,
      [itemId]
    );
    assert.deepEqual(rows.rows.map(r => r.status), ['cancelled', 'cancelled']);
  });

  it('the database refuses a second active listing for the same item', async () => {
    const itemId = await giveItem(seller);
    await list(itemId);
    await assert.rejects(
      query(
        `INSERT INTO item_listings (seller_id, character_id, character_item_id, item_template_id, price, status)
         VALUES ($1, $2, $3, $4, 50, 'active')`,
        [seller.userId, sellerCharacter.id, itemId, template.id]
      ),
      err => err.code === '23505'
    );
  });

  it('an item-listing sale makes the seller eligible for Merchant\'s Seal', async () => {
    const seal = { key: 'merchants_seal', acquisition_type: 'achievement', acquisition_id: null };
    const before = await checkRelicEligibility(seller.userId, seal);
    // The seller has made no sale of any kind yet
    const trades = await query('SELECT 1 FROM market_trades WHERE seller_id = $1', [seller.userId]);
    assert.equal(trades.rows.length, 0);
    assert.equal(before.canClaim, false);

    const itemId = await giveItem(seller);
    const listingId = await list(itemId);
    const buy = await request(
      'POST',
      `/api/marketplace/listings/${listingId}/buy`,
      { characterId: buyerCharacter.id },
      buyer.accessToken
    );
    assert.equal(buy.status, 200, JSON.stringify(buy.body));

    const after = await checkRelicEligibility(seller.userId, seal);
    assert.equal(after.canClaim, true, after.validationMessage);
    const relics = await request('GET', '/api/relics', null, seller.accessToken);
    assert.equal(relics.body.relics.find(r => r.key === 'merchants_seal')?.claimable, true);
  });
});
