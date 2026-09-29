import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSearchResults } from '../marketplaceUtils.js';

describe('mergeSearchResults', () => {
  it('adds server matches that were past the preloaded browse page', () => {
    const preloaded = [{ id: 1, name: 'Apple' }, { id: 2, name: 'Leather Boots' }];
    const found = [{ id: 38, name: 'Rusty Sword', listingCount: 1 }];
    assert.deepEqual(mergeSearchResults(preloaded, found).map(i => i.id), [1, 2, 38]);
  });

  it('keeps one row per template and prefers the fresher server row', () => {
    const preloaded = [{ id: 2, name: 'Leather Boots', listingCount: 0 }];
    const found = [{ id: 2, name: 'Leather Boots', listingCount: 3 }];
    const merged = mergeSearchResults(preloaded, found);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].listingCount, 3);
  });

  it('tolerates missing inputs', () => {
    assert.deepEqual(mergeSearchResults(null, undefined), []);
  });
});
