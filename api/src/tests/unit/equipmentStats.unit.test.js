/**
 * Unit tests for equipment stats service
 *
 * Tests the shared helper that calculates equipment stat totals, handling:
 * - Generated items with modifications.baseStats/bonusStats
 * - Legacy items with only template stat_bonuses
 * - HP/MP normalization (hp_max -> hp, mp_max -> mp)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  sumEquipmentStats,
  getEffectiveItemStats,
  buildEquipmentStatsLateral
} from '../../services/equipmentStats.js';

describe('sumEquipmentStats', () => {
  it('should sum stats from legacy items (template only)', () => {
    const equipment = [
      { stat_bonuses: { strength: 10, vitality: 5 } },
      { stat_bonuses: { strength: 5, agility: 3 } }
    ];

    const result = sumEquipmentStats(equipment);

    assert.strictEqual(result.strength, 15);
    assert.strictEqual(result.vitality, 5);
    assert.strictEqual(result.agility, 3);
    assert.strictEqual(result.intelligence, 0);
  });

  it('should use baseStats over template stats for generated items', () => {
    const equipment = [
      {
        stat_bonuses: { intelligence: 10 }, // template (should be ignored)
        modifications: {
          baseStats: { intelligence: 37 } // generated (rarity-scaled)
        }
      }
    ];

    const result = sumEquipmentStats(equipment);

    assert.strictEqual(result.intelligence, 37); // baseStats, not template
  });

  it('should add bonusStats on top of baseStats', () => {
    // Example from finding 1: Mystic Staff with baseStats and augment bonusStats
    const equipment = [
      {
        stat_bonuses: { intelligence: 10, mp_max: 20 }, // original template
        modifications: {
          baseStats: { intelligence: 37, mp_max: 74 }, // rarity-scaled
          bonusStats: { strength: 20, agility: 9 } // augments
        }
      }
    ];

    const result = sumEquipmentStats(equipment);

    assert.strictEqual(result.intelligence, 37);
    assert.strictEqual(result.mp, 74); // mp_max normalized to mp
    assert.strictEqual(result.strength, 20);
    assert.strictEqual(result.agility, 9);
  });

  it('should normalize hp_max to hp', () => {
    const equipment = [
      {
        stat_bonuses: { vitality: 3, hp_max: 15 } // Leather Armor
      },
      {
        stat_bonuses: { vitality: 6, hp_max: 30 } // Chain Mail
      }
    ];

    const result = sumEquipmentStats(equipment);

    assert.strictEqual(result.vitality, 9);
    assert.strictEqual(result.hp, 45); // hp_max values combined into hp
  });

  it('should normalize mp_max to mp', () => {
    const equipment = [
      {
        stat_bonuses: { intelligence: 5, mp_max: 20 } // Mystic Staff
      },
      {
        stat_bonuses: { intelligence: 3, mp_max: 15 } // Cloth Robe
      }
    ];

    const result = sumEquipmentStats(equipment);

    assert.strictEqual(result.intelligence, 8);
    assert.strictEqual(result.mp, 35); // mp_max values combined into mp
  });

  it('should handle mixed hp and hp_max keys', () => {
    const equipment = [
      {
        stat_bonuses: { hp: 10 },
        modifications: { bonusStats: { hp_max: 5 } }
      }
    ];

    const result = sumEquipmentStats(equipment);

    assert.strictEqual(result.hp, 15); // both contribute to hp
  });

  it('should handle legacy top-level modification keys', () => {
    // Old items might have modifications: { strength: 5 } instead of baseStats
    const equipment = [
      {
        stat_bonuses: { strength: 10 },
        modifications: { strength: 3 }
      }
    ];

    const result = sumEquipmentStats(equipment);

    // Template + legacy top-level = 10 + 3 = 13
    assert.strictEqual(result.strength, 13);
  });

  it('should handle magic_attack and magicAttack variants', () => {
    const equipment = [
      {
        stat_bonuses: { magic_attack: 10 }
      },
      {
        stat_bonuses: { magicAttack: 5 }
      }
    ];

    const result = sumEquipmentStats(equipment);

    assert.strictEqual(result.magicAttack, 15);
  });

  it('should handle string JSON for stat_bonuses and modifications', () => {
    const equipment = [
      {
        stat_bonuses: JSON.stringify({ strength: 10 }),
        modifications: JSON.stringify({ baseStats: { strength: 15 }, bonusStats: { luck: 5 } })
      }
    ];

    const result = sumEquipmentStats(equipment);

    assert.strictEqual(result.strength, 15); // baseStats overrides template
    assert.strictEqual(result.luck, 5);
  });

  it('should return zeros for empty equipment array', () => {
    const result = sumEquipmentStats([]);

    assert.strictEqual(result.strength, 0);
    assert.strictEqual(result.intelligence, 0);
    assert.strictEqual(result.hp, 0);
    assert.strictEqual(result.mp, 0);
  });

  it('should handle null/undefined stat_bonuses and modifications', () => {
    const equipment = [
      { stat_bonuses: null, modifications: null },
      { stat_bonuses: undefined, modifications: undefined },
      {}
    ];

    const result = sumEquipmentStats(equipment);

    assert.strictEqual(result.strength, 0);
    assert.strictEqual(result.hp, 0);
  });
});

describe('getEffectiveItemStats', () => {
  it('should use baseStats when present', () => {
    const modifications = { baseStats: { intelligence: 37 } };
    const templateStats = { intelligence: 10 };

    const result = getEffectiveItemStats(modifications, templateStats);

    assert.strictEqual(result.intelligence, 37);
  });

  it('should fall back to template when no baseStats', () => {
    const modifications = {};
    const templateStats = { strength: 10 };

    const result = getEffectiveItemStats(modifications, templateStats);

    assert.strictEqual(result.strength, 10);
  });

  it('should add bonusStats', () => {
    const modifications = {
      baseStats: { intelligence: 37 },
      bonusStats: { strength: 20 }
    };
    const templateStats = { intelligence: 10 };

    const result = getEffectiveItemStats(modifications, templateStats);

    assert.strictEqual(result.intelligence, 37);
    assert.strictEqual(result.strength, 20);
  });

  it('should normalize hp_max and mp_max', () => {
    const modifications = {
      baseStats: { hp_max: 50, mp_max: 30 }
    };
    const templateStats = {};

    const result = getEffectiveItemStats(modifications, templateStats);

    assert.strictEqual(result.hp, 50);
    assert.strictEqual(result.mp, 30);
  });
});

describe('buildEquipmentStatsLateral', () => {
  it('should return a valid SQL string', () => {
    const sql = buildEquipmentStatsLateral();

    assert.strictEqual(typeof sql, 'string');
    assert.ok(sql.includes('SELECT'));
    assert.ok(sql.includes('equip_strength'));
    assert.ok(sql.includes('equip_hp'));
    assert.ok(sql.includes('baseStats'));
    assert.ok(sql.includes('bonusStats'));
    assert.ok(sql.includes('hp_max'));
  });
});
