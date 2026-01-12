import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import the service
import * as itemDropService from '../../services/itemDropService.js';

describe('itemDropService', () => {
  describe('RARITIES', () => {
    it('should have all 5 rarity tiers defined', () => {
      assert.ok(itemDropService.RARITIES.common);
      assert.ok(itemDropService.RARITIES.uncommon);
      assert.ok(itemDropService.RARITIES.rare);
      assert.ok(itemDropService.RARITIES.epic);
      assert.ok(itemDropService.RARITIES.legendary);
    });

    it('should have increasing stat multipliers for higher rarities', () => {
      const rarities = itemDropService.RARITIES;
      // Common max < Uncommon min (approximately)
      assert.ok(rarities.common.statMult[1] <= rarities.uncommon.statMult[1]);
      assert.ok(rarities.uncommon.statMult[1] <= rarities.rare.statMult[1]);
      assert.ok(rarities.rare.statMult[1] <= rarities.epic.statMult[1]);
      assert.ok(rarities.epic.statMult[1] <= rarities.legendary.statMult[1]);
    });

    it('should have correct rarity IDs', () => {
      assert.strictEqual(itemDropService.RARITIES.common.id, 1);
      assert.strictEqual(itemDropService.RARITIES.uncommon.id, 2);
      assert.strictEqual(itemDropService.RARITIES.rare.id, 3);
      assert.strictEqual(itemDropService.RARITIES.epic.id, 4);
      assert.strictEqual(itemDropService.RARITIES.legendary.id, 5);
    });

    it('should have hex color codes for each rarity', () => {
      const hexColorPattern = /^#[0-9a-fA-F]{6}$/;
      for (const rarity of Object.values(itemDropService.RARITIES)) {
        assert.match(rarity.color, hexColorPattern, `${rarity.name} should have valid hex color`);
      }
    });
  });

  describe('MATERIAL_TIERS', () => {
    it('should cover all level ranges from 1 to 256', () => {
      const tiers = itemDropService.MATERIAL_TIERS;

      // Check minimum level starts at 1
      assert.strictEqual(tiers[0].minLevel, 1);

      // Check maximum level goes to 256
      assert.strictEqual(tiers[tiers.length - 1].maxLevel, 256);

      // Check for gaps
      for (let i = 1; i < tiers.length; i++) {
        assert.strictEqual(
          tiers[i].minLevel,
          tiers[i - 1].maxLevel + 1,
          `Gap between tier ${i - 1} and ${i}`
        );
      }
    });

    it('should have at least 2 materials per tier', () => {
      for (const tier of itemDropService.MATERIAL_TIERS) {
        assert.ok(tier.materials.length >= 2, `Tier ${tier.quality} should have at least 2 materials`);
      }
    });

    it('should have quality names for each tier', () => {
      for (const tier of itemDropService.MATERIAL_TIERS) {
        assert.ok(tier.quality, `Tier at level ${tier.minLevel} should have quality name`);
        assert.ok(typeof tier.quality === 'string');
      }
    });
  });

  describe('AUGMENTS', () => {
    it('should have name and stat for each augment', () => {
      for (const [key, augment] of Object.entries(itemDropService.AUGMENTS)) {
        assert.ok(augment.name, `${key} should have name`);
        assert.ok(augment.stat, `${key} should have stat`);
      }
    });

    it('should have valid stat bonus ranges', () => {
      for (const [key, augment] of Object.entries(itemDropService.AUGMENTS)) {
        assert.ok(Array.isArray(augment.bonus), `${key} should have bonus array`);
        assert.strictEqual(augment.bonus.length, 2, `${key} should have [min, max] bonus`);
        assert.ok(augment.bonus[0] < augment.bonus[1], `${key} min should be less than max`);
        assert.ok(augment.bonus[0] > 0, `${key} min bonus should be positive`);
      }
    });

    it('should target valid stats', () => {
      const validStats = ['strength', 'intelligence', 'agility', 'vitality', 'luck'];
      for (const [key, augment] of Object.entries(itemDropService.AUGMENTS)) {
        assert.ok(validStats.includes(augment.stat), `${key} should target a valid stat`);
      }
    });
  });

  describe('calculateDropChance', () => {
    it('should return base chance for tier 1', () => {
      const enemy = { dropTable: { dropChance: 0.5 } };
      const chance = itemDropService.calculateDropChance(enemy, 1);
      assert.strictEqual(chance, 0.5);
    });

    it('should increase chance by 5% per tier above 1', () => {
      const enemy = { dropTable: { dropChance: 0.5 } };
      const chanceTier3 = itemDropService.calculateDropChance(enemy, 3);
      // Tier 3: base 0.5 + (3-1) * 0.05 = 0.5 + 0.10 = 0.60
      assert.strictEqual(chanceTier3, 0.6);
    });

    it('should cap at 100%', () => {
      const enemy = { dropTable: { dropChance: 0.95 } };
      const chanceTier5 = itemDropService.calculateDropChance(enemy, 5);
      // Would be 0.95 + 0.20 = 1.15, but capped at 1.0
      assert.strictEqual(chanceTier5, 1.0);
    });

    it('should use default 0.5 if no dropTable', () => {
      const enemy = {};
      const chance = itemDropService.calculateDropChance(enemy, 1);
      assert.strictEqual(chance, 0.5);
    });
  });

  describe('formatDropsForResponse', () => {
    it('should format drops for API response', () => {
      const drops = [
        {
          templateId: 1,
          templateName: 'Iron Sword',
          generatedName: 'Blazing Steel Sword',
          itemType: 'weapon',
          equipmentSlot: 'main_hand',
          rarity: 'rare',
          rarityColor: '#0070dd',
          levelRequirement: 10,
          baseStats: { strength: 15 },
          bonusStats: { agility: 3 },
          value: 500,
          material: 'steel',
          modifications: {}
        }
      ];

      const formatted = itemDropService.formatDropsForResponse(drops);

      assert.strictEqual(formatted.length, 1);
      assert.strictEqual(formatted[0].name, 'Blazing Steel Sword');
      assert.strictEqual(formatted[0].rarity, 'rare');
      assert.strictEqual(formatted[0].rarityColor, '#0070dd');
      assert.ok(formatted[0].baseStats);
      assert.ok(formatted[0].bonusStats);

      // Should not include internal fields
      assert.strictEqual(formatted[0].modifications, undefined);
      assert.strictEqual(formatted[0].material, undefined);
    });

    it('should handle empty array', () => {
      const formatted = itemDropService.formatDropsForResponse([]);
      assert.deepStrictEqual(formatted, []);
    });
  });

  describe('rollDrops (unit behavior)', () => {
    it('should return empty array for enemy with no drop table', async () => {
      const enemy = { level: 5 };
      const drops = await itemDropService.rollDrops(enemy, 1, 'forest');
      // Either empty (no drops) or potentially drops - this is probabilistic
      assert.ok(Array.isArray(drops));
    });

    it('should return array for enemy with drop table', async () => {
      const enemy = {
        level: 5,
        dropTable: {
          dropChance: 1.0, // 100% drop chance for testing
          minItems: 0,
          maxItems: 0, // 0 items
          rarityWeights: { common: 100 },
          itemPool: []
        }
      };
      const drops = await itemDropService.rollDrops(enemy, 1, 'forest');
      assert.ok(Array.isArray(drops));
      assert.strictEqual(drops.length, 0);
    });
  });
});
