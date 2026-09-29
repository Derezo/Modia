import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withEquipmentStats, sumEquipmentBonuses } from '../effectiveStats.js';

describe('withEquipmentStats', () => {
  const base = { id: 1, strength: 14, vitality: 16, luck: 5, hp_max: 120, mp_max: 40 };

  it('adds rolled base stats and augment bonuses from every equipped item', () => {
    const char = {
      ...base,
      equipment: {
        head: { baseStats: { strength: 6, vitality: 2 }, bonusStats: { strength: 9 } },
        body: { baseStats: { hp_max: 13 }, bonusStats: {} }
      }
    };
    const result = withEquipmentStats(char);
    assert.equal(result.strength, 29);
    assert.equal(result.vitality, 18);
    assert.equal(result.luck, 5);
    assert.equal(result.hp_max, 133);
    assert.equal(result.mp_max, 40);
    assert.deepEqual(result.equipmentBonuses, { strength: 15, vitality: 2, hp: 13 });
  });

  it('leaves characters without equipment unchanged', () => {
    const result = withEquipmentStats({ ...base });
    assert.equal(result.strength, 14);
    assert.deepEqual(result.equipmentBonuses, {});
  });

  it('does not mutate the input', () => {
    const char = { ...base, equipment: { head: { baseStats: { strength: 1 } } } };
    withEquipmentStats(char);
    assert.equal(char.strength, 14);
  });

  it('sums nothing for a missing equipment map', () => {
    assert.deepEqual(sumEquipmentBonuses(null), {});
  });
});
