import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { presentCaravanShop } from '../../services/caravanShopPresenter.js';

describe('caravan shop response presenter', () => {
  it('publishes the standard shop contract with caravan compatibility aliases', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');
    const nextRefresh = new Date('2026-07-29T12:00:00.000Z');
    const response = presentCaravanShop({
      nodeName: 'Wayfarer Exchange',
      nextRefresh,
      lastRefresh: new Date('2026-07-27T12:00:00.000Z'),
      inventory: [{
        itemId: 'moon_ore',
        name: 'Moon Ore',
        type: 'material',
        description: 'Luminous ore',
        basePrice: 200,
        price: 229,
        quantity: 3,
        maxQuantity: 5,
        region: 'elf',
        inStock: true,
        sprite_id: 'material_moon_ore'
      }]
    }, 42, { now });

    assert.equal(response.nextRefresh, nextRefresh.toISOString());
    assert.equal(response.refreshesIn, 24 * 60 * 60 * 1000);
    assert.equal(response.items, response.inventory);
    assert.deepEqual(response.items[0], {
      id: 'moon_ore',
      itemId: 'moon_ore',
      name: 'Moon Ore',
      type: 'material',
      description: 'Luminous ore',
      basePrice: 200,
      price: 229,
      stock: 3,
      maxStock: 5,
      regionalSpecialty: 'elf',
      regional: true,
      caravanExclusive: true,
      effect: null,
      equipmentSlot: null,
      equipSlot: null,
      statBonuses: null,
      inStock: true,
      spriteId: 'material_moon_ore'
    });
  });

  it('supplies a usable refresh deadline when persisted timing is absent', () => {
    const now = new Date('2026-07-28T12:00:00.000Z');
    const response = presentCaravanShop({
      inventory: [],
      nextRefresh: null
    }, 9, { now });

    assert.equal(response.items.length, 0);
    assert.ok(new Date(response.nextRefresh).getTime() > now.getTime());
    assert.ok(response.refreshesIn > 0);
  });
});
