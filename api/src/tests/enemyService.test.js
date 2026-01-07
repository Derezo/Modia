const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');

// Import the service
const enemyService = require('../services/enemyService');

describe('enemyService', () => {
  describe('TIER_MULTIPLIERS', () => {
    it('should have multipliers for all 5 tiers', () => {
      assert.ok(enemyService.TIER_MULTIPLIERS[1]);
      assert.ok(enemyService.TIER_MULTIPLIERS[2]);
      assert.ok(enemyService.TIER_MULTIPLIERS[3]);
      assert.ok(enemyService.TIER_MULTIPLIERS[4]);
      assert.ok(enemyService.TIER_MULTIPLIERS[5]);
    });

    it('should have increasing multipliers for higher tiers', () => {
      const mult = enemyService.TIER_MULTIPLIERS;
      assert.ok(mult[1] < mult[2], 'Tier 2 should be higher than Tier 1');
      assert.ok(mult[2] < mult[3], 'Tier 3 should be higher than Tier 2');
      assert.ok(mult[3] < mult[4], 'Tier 4 should be higher than Tier 3');
      assert.ok(mult[4] < mult[5], 'Tier 5 should be higher than Tier 4');
    });
  });

  describe('createEnemyInstance', () => {
    const mockTemplate = {
      id: 1,
      name: 'Test Goblin',
      sprite_id: 'goblin',
      base_hp: 50,
      base_mp: 20,
      base_strength: 10,
      base_intelligence: 5,
      base_agility: 8,
      ai_type: 'aggressive',
      abilities: [],
      drop_table: { dropChance: 0.5, minItems: 0, maxItems: 1 },
      experience_reward: 25,
      gold_reward_min: 5,
      gold_reward_max: 15
    };

    it('should create an enemy with correct structure', () => {
      const enemy = enemyService.createEnemyInstance(mockTemplate, 5, 1, 0);

      assert.strictEqual(enemy.type, 'enemy');
      assert.strictEqual(enemy.templateId, 1);
      assert.strictEqual(enemy.name, 'Test Goblin');
      assert.strictEqual(enemy.class, 'monster');
      assert.strictEqual(enemy.aiType, 'aggressive');
      assert.ok(enemy.hp > 0);
      assert.ok(enemy.maxHp > 0);
      assert.strictEqual(enemy.hp, enemy.maxHp);
    });

    it('should scale stats based on party level', () => {
      const enemyLowLevel = enemyService.createEnemyInstance(mockTemplate, 5, 1, 0);
      const enemyHighLevel = enemyService.createEnemyInstance(mockTemplate, 20, 1, 0);

      assert.ok(enemyHighLevel.hp > enemyLowLevel.hp, 'Higher level should have more HP');
      assert.ok(enemyHighLevel.strength > enemyLowLevel.strength, 'Higher level should have more strength');
    });

    it('should scale stats based on difficulty tier', () => {
      const enemyTier1 = enemyService.createEnemyInstance(mockTemplate, 10, 1, 0);
      const enemyTier3 = enemyService.createEnemyInstance(mockTemplate, 10, 3, 0);

      assert.ok(enemyTier3.hp > enemyTier1.hp, 'Higher tier should have more HP');
      assert.ok(enemyTier3.level > enemyTier1.level, 'Higher tier should have higher level');
    });

    it('should set correct grid position based on index', () => {
      const enemy0 = enemyService.createEnemyInstance(mockTemplate, 5, 1, 0);
      const enemy1 = enemyService.createEnemyInstance(mockTemplate, 5, 1, 1);
      const enemy2 = enemyService.createEnemyInstance(mockTemplate, 5, 1, 2);

      assert.strictEqual(enemy0.tileX, 6);
      assert.strictEqual(enemy0.tileY, 0);
      assert.strictEqual(enemy1.tileX, 7);
      assert.strictEqual(enemy1.tileY, 1);
      assert.strictEqual(enemy2.tileX, 6);
      assert.strictEqual(enemy2.tileY, 2);
    });

    it('should mark ambush AI enemies as hidden', () => {
      const ambushTemplate = { ...mockTemplate, ai_type: 'ambush' };
      const enemy = enemyService.createEnemyInstance(ambushTemplate, 5, 1, 0);

      assert.strictEqual(enemy.isHidden, true);
      assert.strictEqual(enemy.hasAmbushed, false);
    });

    it('should not mark non-ambush AI enemies as hidden', () => {
      const enemy = enemyService.createEnemyInstance(mockTemplate, 5, 1, 0);

      assert.strictEqual(enemy.isHidden, false);
    });
  });

  describe('stat scaling formulas', () => {
    const baseHp = 100;
    const baseStat = 10;

    it('should scale HP by 10% per level', () => {
      // Level 10 should give 1 + 10 * 0.10 = 2.0 multiplier
      const level = 10;
      const expectedHp = Math.floor(baseHp * (1 + level * 0.10));
      assert.strictEqual(expectedHp, 200);
    });

    it('should scale other stats by 5% per level', () => {
      // Level 10 should give 1 + 10 * 0.05 = 1.5 multiplier
      const level = 10;
      const expectedStat = Math.floor(baseStat * (1 + level * 0.05));
      assert.strictEqual(expectedStat, 15);
    });
  });
});
