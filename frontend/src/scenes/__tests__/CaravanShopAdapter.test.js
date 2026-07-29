import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatCaravanRefreshCountdown,
  normalizeCaravanShopData
} from '../shop/CaravanShopAdapter.js';

describe('Merchant Caravan shop adapter', () => {
  it('normalizes the original API contract into selectable purchase items', () => {
    const now = Date.parse('2026-07-28T12:00:00.000Z');
    const result = normalizeCaravanShopData({
      inventory: [{
        itemId: 'moon_ore',
        regional: true,
        equipSlot: 'accessory',
        stock: 3
      }],
      refreshesIn: 90 * 60 * 1000
    }, { now });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, 'moon_ore');
    assert.equal(result.items[0].itemId, 'moon_ore');
    assert.equal(result.items[0].regionalSpecialty, 'Regional Specialty');
    assert.equal(result.items[0].equipmentSlot, 'accessory');
    assert.equal(
      result.nextRefresh.toISOString(),
      '2026-07-28T13:30:00.000Z'
    );
  });

  it('preserves the canonical API contract and authoritative refresh deadline', () => {
    const result = normalizeCaravanShopData({
      items: [{
        id: 'dragon_scale',
        itemId: 'dragon_scale',
        regionalSpecialty: 'dwarf',
        equipmentSlot: null
      }],
      nextRefresh: '2026-07-30T08:00:00.000Z'
    });

    assert.equal(result.items[0].id, 'dragon_scale');
    assert.equal(result.items[0].regionalSpecialty, 'dwarf');
    assert.equal(
      result.nextRefresh.toISOString(),
      '2026-07-30T08:00:00.000Z'
    );
  });

  it('never leaves the refresh placeholder visible when timing is unavailable', () => {
    const now = Date.parse('2026-07-28T12:00:00.000Z');

    assert.equal(
      formatCaravanRefreshCountdown(null, { now }),
      'Refresh time unavailable'
    );
    assert.equal(
      formatCaravanRefreshCountdown('2026-07-28T13:30:00.000Z', { now }),
      'Refreshes in 1h 30m'
    );
  });
});
