/**
 * Generated equipment names: no stat-suffix fallback that duplicates the
 * prefix augment, and no metal material on soft bases.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateItemName } from '../../services/itemDropService.js';

const mighty = { key: 'mighty', name: 'Mighty', type: 'prefix', stat: 'strength', value: 9 };
const guardian = { key: 'the_guardian', name: 'of the Guardian', type: 'suffix', stat: 'vitality', value: 10 };

describe('generateItemName', () => {
  it('does not add a stat suffix when only a prefix augment rolled', () => {
    const name = generateItemName({ name: 'Iron Sword', item_type: 'weapon' }, 'copper', 'rare', [mighty], { strength: 9 }, false);
    assert.strictEqual(name, 'Superior Mighty Copper Sword');
    assert.ok(!/of Might/.test(name));
  });

  it('uses the suffix augment when present', () => {
    const name = generateItemName({ name: 'Bronze Axe', item_type: 'weapon' }, 'iron', 'common', [guardian], { vitality: 10 }, false);
    assert.strictEqual(name, 'Iron Axe of the Guardian');
  });

  it('keeps soft bases free of a metal material', () => {
    const name = generateItemName({ name: 'Leather Helm', item_type: 'armor' }, 'copper', 'common', [], {}, false);
    assert.strictEqual(name, 'Leather Helm');
  });
});
