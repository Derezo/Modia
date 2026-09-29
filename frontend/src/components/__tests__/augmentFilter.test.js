import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUGMENT_FILTER_GROUPS,
  AUGMENT_FILTER_OPTIONS,
  augmentMatchesFilter,
  itemMatchesAugmentFilter
} from '../ItemDataTable/augmentFilter.js';
import { AUGMENTS, CONSUMABLE_AUGMENTS } from '../../../../api/src/services/itemDropService.js';

const dropAugments = [...Object.values(AUGMENTS), ...Object.values(CONSUMABLE_AUGMENTS)];

describe('ItemDataTable augment filter', () => {
  it('offers an "any" option followed by every family', () => {
    assert.deepEqual(AUGMENT_FILTER_OPTIONS[0], { value: '', label: 'Any Augment' });
    assert.equal(AUGMENT_FILTER_OPTIONS.length, Object.keys(AUGMENT_FILTER_GROUPS).length + 1);
  });

  it('puts every drop-table augment category in at least one family by category alone', () => {
    const families = Object.keys(AUGMENT_FILTER_GROUPS);
    const uncovered = [...new Set(dropAugments.map(a => a.category))]
      .filter(category => !families.some(f => augmentMatchesFilter(category, f)));
    assert.deepEqual(uncovered, []);
  });

  it('matches by category, effect type and rolled stat', () => {
    const flaming = { category: 'fire', effect: { type: 'burn_chance' }, stat: 'strength' };
    assert.equal(augmentMatchesFilter(flaming, 'fire'), true);
    assert.equal(augmentMatchesFilter(flaming, 'strength'), true);
    assert.equal(augmentMatchesFilter(flaming, 'ice'), false);

    const legacy = { type: 'lifesteal' };
    assert.equal(augmentMatchesFilter(legacy, 'dark'), true);
  });

  it('finds slayer and consumable augments that the old exact-match filter missed', () => {
    assert.equal(itemMatchesAugmentFilter({ augments: [{ category: 'dragon_slayer', effect: { type: 'damage_vs' } }] }, 'slayer'), true);
    assert.equal(itemMatchesAugmentFilter({ augments: [{ category: 'hot_minor', effect: { type: 'hot' } }] }, 'healing'), true);
    assert.equal(itemMatchesAugmentFilter({ augments: [{ category: 'cleanse_all' }] }, 'cleanse'), true);
    assert.equal(itemMatchesAugmentFilter({ augments: [] }, 'fire'), false);
    assert.equal(itemMatchesAugmentFilter({}, ''), true);
  });
});
