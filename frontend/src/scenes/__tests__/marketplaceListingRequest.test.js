import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildListingRequest, listingPrice } from '../marketplace/marketplaceUtils.js';

describe('buildListingRequest', () => {
  it('lists a shared-pool item as the active character (sellable rows carry no characterId)', () => {
    const sellable = { instanceId: 42, templateId: 7, name: 'Iron Sword' };
    assert.deepEqual(buildListingRequest(sellable, { id: 9, name: 'Aria' }), {
      characterId: 9,
      characterItemId: 42
    });
  });

  it('refuses to build a request without an active character', () => {
    assert.throws(() => buildListingRequest({ instanceId: 42 }, null), /Select a character/);
  });

  it('refuses to build a request without an item instance id', () => {
    assert.throws(() => buildListingRequest({}, { id: 9 }), /cannot be listed/);
  });
});

describe('listingPrice', () => {
  it('reads the my-listings `price` field', () => {
    assert.equal(listingPrice({ price: 500 }), 500);
  });

  it('falls back to browse-style `askPrice`', () => {
    assert.equal(listingPrice({ askPrice: 120 }), 120);
  });

  it('returns 0 for a missing or bad price', () => {
    assert.equal(listingPrice({}), 0);
    assert.equal(listingPrice(null), 0);
    assert.equal(listingPrice({ price: 'x' }), 0);
  });
});
