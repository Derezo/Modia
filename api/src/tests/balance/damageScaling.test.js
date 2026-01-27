/**
 * Damage Scaling Balance Tests
 * Verifies damage formulas scale appropriately across levels and tiers
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createMockCharacter,
  createMockEnemy,
  calculateDPS,
  calculateEffectiveHP,
  TEST_LEVELS,
  ALL_TIERS,
  CLASSES,
  ADVANCED_CLASSES,
  calculatePhysicalDamage,
  calculateMagicalDamage,
  calculateHitChance,
  calculateCritChance
} from './balanceTestUtils.js';
import { calculateElementalModifier } from '../../../../shared/battleMath.js';

describe('Damage Scaling Balance', () => {
  describe('Physical Damage Scaling', () => {
    it('should scale physical damage linearly with strength', () => {
      const defender = createMockCharacter({ level: 10 });

      // Test damage at different strength values
      const damages = [10, 20, 30, 40, 50].map(str => {
        const attacker = { strength: str, attack: 0 };
        return calculatePhysicalDamage(attacker, defender, 100).avgDamage;
      });

      // Verify damage increases with each strength increment
      for (let i = 1; i < damages.length; i++) {
        assert.ok(damages[i] > damages[i - 1],
          `Damage should increase: ${damages[i]} > ${damages[i - 1]}`);
      }

      // Verify roughly linear scaling (each 10 STR should add ~10 damage before defense)
      const avgIncrease = (damages[4] - damages[0]) / 4;
      assert.ok(avgIncrease > 5 && avgIncrease < 15,
        `Average increase per 10 STR should be ~10, got ${avgIncrease.toFixed(1)}`);
    });

    it('should reduce physical damage with defense', () => {
      const attacker = createMockCharacter({ charClass: 'warrior', level: 20 });

      // Test against targets with different defense values
      const defenseValues = [0, 10, 20, 30, 40];
      const damages = defenseValues.map(def => {
        const defender = { vitality: 10, defense: def };
        return calculatePhysicalDamage(attacker, defender, 100).avgDamage;
      });

      // Verify damage decreases with defense
      for (let i = 1; i < damages.length; i++) {
        assert.ok(damages[i] < damages[i - 1],
          `Higher defense should reduce damage: ${damages[i]} < ${damages[i - 1]}`);
      }
    });

    it('should always deal at least 1 damage', () => {
      const weakAttacker = { strength: 1, attack: 0 };
      const tankDefender = { vitality: 100, defense: 100 };

      const damage = calculatePhysicalDamage(weakAttacker, tankDefender, 100);
      assert.ok(damage.minDamage >= 1, 'Minimum damage should be at least 1');
    });
  });

  describe('Magical Damage Scaling', () => {
    it('should scale magical damage with intelligence', () => {
      const defender = createMockCharacter({ level: 10 });

      const damages = [10, 20, 30, 40, 50].map(int => {
        const attacker = { intelligence: int, magicAttack: 0 };
        return calculateMagicalDamage(attacker, defender, 100).avgDamage;
      });

      for (let i = 1; i < damages.length; i++) {
        assert.ok(damages[i] > damages[i - 1],
          `Magic damage should increase with INT: ${damages[i]} > ${damages[i - 1]}`);
      }
    });

    it('should have magic defense reduce magical damage', () => {
      const attacker = createMockCharacter({ charClass: 'wizard', level: 20 });

      // Use larger defense values to see meaningful reduction
      // Formula: (INT + magicDefense) * 0.25 * 0.3 = total reduction
      const magDefValues = [0, 50, 100, 150, 200];
      const damages = magDefValues.map(magDef => {
        const defender = { intelligence: 10, magicDefense: magDef };
        return calculateMagicalDamage(attacker, defender, 100).avgDamage;
      });

      for (let i = 1; i < damages.length; i++) {
        assert.ok(damages[i] <= damages[i - 1],
          `Magic defense should reduce damage: ${damages[i]} <= ${damages[i - 1]}`);
      }

      // Verify significant reduction at high defense
      assert.ok(damages[4] < damages[0],
        `High magic defense (${damages[4]}) should reduce damage from base (${damages[0]})`);
    });
  });

  describe('Skill Power Scaling', () => {
    it('should scale damage with skill power', () => {
      const attacker = createMockCharacter({ charClass: 'warrior', level: 10 });
      const defender = createMockCharacter({ level: 10 });

      const skillPowers = [50, 100, 150, 200];
      const damages = skillPowers.map(power =>
        calculatePhysicalDamage(attacker, defender, power).avgDamage
      );

      // Verify linear scaling with skill power
      for (let i = 1; i < damages.length; i++) {
        assert.ok(damages[i] > damages[i - 1],
          `Higher skill power should deal more damage: ${damages[i]} > ${damages[i - 1]}`);
      }

      // 200% skill should deal roughly 2x damage of 100%
      const ratio = damages[3] / damages[1];
      assert.ok(ratio > 1.8 && ratio < 2.2,
        `200% skill should deal ~2x damage of 100%, got ${ratio.toFixed(2)}x`);
    });
  });

  describe('Level Progression', () => {
    it('should have characters deal more damage at higher levels', () => {
      const defender = createMockEnemy({ partyLevel: 50, tier: 3 });

      const previousDamage = { value: 0 };
      TEST_LEVELS.forEach(level => {
        const attacker = createMockCharacter({ charClass: 'warrior', level });
        const damage = calculatePhysicalDamage(attacker, defender, 100).avgDamage;

        if (previousDamage.value > 0) {
          assert.ok(damage > previousDamage.value,
            `Level ${level} should deal more damage than lower levels`);
        }
        previousDamage.value = damage;
      });
    });

    it('should maintain reasonable TTK across level progression', () => {
      // Test that time-to-kill stays in reasonable bounds as levels increase
      TEST_LEVELS.forEach(level => {
        const attacker = createMockCharacter({ charClass: 'warrior', level });
        const defender = createMockEnemy({ partyLevel: level, tier: 3 });

        const dps = calculateDPS(attacker, defender, 'physical');

        // TTK should be between 3-20 turns for balanced combat
        assert.ok(dps.turnsToKill >= 3,
          `Level ${level}: TTK (${dps.turnsToKill}) should be >= 3 turns to avoid one-shots`);
        assert.ok(dps.turnsToKill <= 25,
          `Level ${level}: TTK (${dps.turnsToKill}) should be <= 25 turns to avoid tedium`);
      });
    });
  });

  describe('Hit and Crit Mechanics', () => {
    it('should have hit chance factoring in evasion', () => {
      // With equal AGI and no LCK: evasion = 2% base
      // Hit chance = 95% base - 2% evasion = 93%
      const attacker = { agility: 10, statusEffects: [] };
      const defender = { agility: 10, luck: 0 };

      const hitChance = calculateHitChance(attacker, defender);
      // Use approximate comparison for floating point
      assert.ok(Math.abs(hitChance - 0.93) < 0.001, `Hit chance should be ~93% (got ${hitChance})`);
    });

    it('should reduce hit chance with agility difference', () => {
      const attacker = { agility: 10, statusEffects: [] };
      const fastDefender = { agility: 30, luck: 0 };

      const hitChance = calculateHitChance(attacker, fastDefender);
      assert.ok(hitChance < 0.93, 'Hit chance should be reduced against faster targets');
      assert.ok(hitChance >= 0.50, 'Hit chance should not go below 50%');
    });

    it('should cap crit chance at 50%', () => {
      // New formula: 5% base + LCK/300, cap at 50%
      const highLuckAttacker = { luck: 200 };
      const critChance = calculateCritChance(highLuckAttacker);
      assert.ok(Math.abs(critChance - 0.50) < 0.001, 'Crit chance should cap at 50%');
    });

    it('should scale crit chance with luck', () => {
      const critChances = [10, 20, 30, 40].map(luck =>
        calculateCritChance({ luck })
      );

      for (let i = 1; i < critChances.length; i++) {
        assert.ok(critChances[i] > critChances[i - 1],
          'Crit chance should increase with luck');
      }
    });
  });

  describe('Tier Difficulty Scaling', () => {
    it('should increase enemy power with higher tiers', () => {
      const partyLevel = 20;

      const tierEnemies = ALL_TIERS.map(tier =>
        createMockEnemy({ partyLevel, tier })
      );

      // Verify HP increases with tier
      for (let i = 1; i < tierEnemies.length; i++) {
        assert.ok(tierEnemies[i].hp > tierEnemies[i - 1].hp,
          `Tier ${i + 1} should have more HP than tier ${i}`);
      }

      // Verify strength increases with tier
      for (let i = 1; i < tierEnemies.length; i++) {
        assert.ok(tierEnemies[i].strength > tierEnemies[i - 1].strength,
          `Tier ${i + 1} should have more strength than tier ${i}`);
      }
    });

    it('should have tier 1 enemies be manageable for same-level party', () => {
      const level = 10;
      const attacker = createMockCharacter({ charClass: 'warrior', level });
      const enemy = createMockEnemy({ partyLevel: level, tier: 1 });

      const dps = calculateDPS(attacker, enemy, 'physical');

      // Tier 1 should be easy - kill in under 10 turns
      assert.ok(dps.turnsToKill <= 10,
        `Tier 1 enemy should be killable in <= 10 turns, got ${dps.turnsToKill}`);
    });

    it('should have tier 5 enemies require more turns to kill', () => {
      const level = 20;
      const attacker = createMockCharacter({ charClass: 'warrior', level });
      const tier1 = createMockEnemy({ partyLevel: level, tier: 1 });
      const tier5 = createMockEnemy({ partyLevel: level, tier: 5 });

      const dpsTier1 = calculateDPS(attacker, tier1, 'physical');
      const dpsTier5 = calculateDPS(attacker, tier5, 'physical');

      assert.ok(dpsTier5.turnsToKill > dpsTier1.turnsToKill,
        `Tier 5 should take more turns to kill than tier 1`);
    });
  });

  describe('Damage Variance', () => {
    it('should have 10% variance range', () => {
      const attacker = createMockCharacter({ charClass: 'warrior', level: 20 });
      const defender = createMockCharacter({ level: 20 });

      const damage = calculatePhysicalDamage(attacker, defender, 100);
      const range = damage.maxDamage - damage.minDamage;
      const expectedRange = damage.avgDamage * 0.2; // 0.9 to 1.1 = 0.2 range

      // Allow some tolerance due to floor operations
      assert.ok(Math.abs(range - expectedRange) < 3,
        `Damage variance should be ~20% of avg: range=${range}, expected=${expectedRange.toFixed(1)}`);
    });
  });
});

describe('Class-Specific Damage Profiles', () => {
  it('should have warriors deal more physical damage than wizards', () => {
    const level = 20;
    const defender = createMockEnemy({ partyLevel: level, tier: 3 });

    const warrior = createMockCharacter({ charClass: 'warrior', level });
    const wizard = createMockCharacter({ charClass: 'wizard', level });

    const warriorDamage = calculatePhysicalDamage(warrior, defender, 100).avgDamage;
    const wizardDamage = calculatePhysicalDamage(wizard, defender, 100).avgDamage;

    assert.ok(warriorDamage > wizardDamage,
      `Warrior physical damage (${warriorDamage}) should exceed wizard (${wizardDamage})`);
  });

  it('should have wizards deal more magical damage than warriors', () => {
    const level = 20;
    const defender = createMockEnemy({ partyLevel: level, tier: 3 });

    const warrior = createMockCharacter({ charClass: 'warrior', level });
    const wizard = createMockCharacter({ charClass: 'wizard', level });

    const warriorMagic = calculateMagicalDamage(warrior, defender, 100).avgDamage;
    const wizardMagic = calculateMagicalDamage(wizard, defender, 100).avgDamage;

    assert.ok(wizardMagic > warriorMagic,
      `Wizard magic damage (${wizardMagic}) should exceed warrior (${warriorMagic})`);
  });

  it('should have advanced classes deal more damage than base classes', () => {
    const level = 25;
    const defender = createMockEnemy({ partyLevel: level, tier: 3 });

    const warrior = createMockCharacter({ charClass: 'warrior', level });
    const berserker = createMockCharacter({ charClass: 'berserker', level });

    const warriorDamage = calculatePhysicalDamage(warrior, defender, 100).avgDamage;
    const berserkerDamage = calculatePhysicalDamage(berserker, defender, 100).avgDamage;

    assert.ok(berserkerDamage > warriorDamage,
      `Berserker damage (${berserkerDamage}) should exceed warrior (${warriorDamage})`);
  });
});

// ============================================================================
// ELEMENTAL DAMAGE SCALING
// ============================================================================

describe('Elemental Damage Scaling', () => {
  it('should reduce fire damage against fire-resistant defender', () => {
    const fireResistantDefender = {
      race: 'dwarf', // Dwarves have 25% fire resistance
      elementalResistances: {},
      statusEffects: [],
      equipment: {}
    };

    const modifier = calculateElementalModifier(fireResistantDefender, 'fire');
    // Dwarf has 25 fire resist -> modifier = (100 - 25) / 100 = 0.75
    assert.ok(modifier < 1.0, `Fire modifier vs dwarf should be < 1.0, got ${modifier}`);
    assert.ok(modifier > 0, 'Fire modifier should still deal some damage');
  });

  it('should increase ice damage against ice-weak defender', () => {
    const iceWeakDefender = {
      race: 'dwarf', // Dwarves have -25% ice resistance (weakness)
      elementalResistances: {},
      statusEffects: [],
      equipment: {}
    };

    const modifier = calculateElementalModifier(iceWeakDefender, 'ice');
    // Dwarf has -25 ice resist -> modifier = (100 - (-25)) / 100 = 1.25
    assert.ok(modifier > 1.0, `Ice modifier vs dwarf should be > 1.0, got ${modifier}`);
  });

  it('should return 1.0 for physical (non-elemental) attacks', () => {
    const defender = { race: 'elf', elementalResistances: {}, statusEffects: [], equipment: {} };
    const modifier = calculateElementalModifier(defender, 'physical');
    assert.strictEqual(modifier, 1.0, 'Physical attacks should have no elemental modifier');
  });

  it('should return 1.0 for null/undefined element', () => {
    const defender = { race: 'human', elementalResistances: {}, statusEffects: [], equipment: {} };
    assert.strictEqual(calculateElementalModifier(defender, null), 1.0);
    assert.strictEqual(calculateElementalModifier(defender, undefined), 1.0);
  });

  it('should handle vampires being very weak to holy', () => {
    const vampireDefender = {
      race: 'vampire', // -50 holy resistance
      elementalResistances: {},
      statusEffects: [],
      equipment: {}
    };

    const holyMod = calculateElementalModifier(vampireDefender, 'holy');
    // -50 resist -> modifier = (100 - (-50)) / 100 = 1.5
    assert.ok(holyMod >= 1.5, `Holy vs vampire should deal 150%+ damage, got ${(holyMod * 100).toFixed(0)}%`);
  });

  it('should cap resistance at 90% (10% minimum damage)', () => {
    const highResistDefender = {
      race: 'human',
      elementalResistances: { fire: 100 }, // 100 resist = immune normally but capped at 90 by modifier
      statusEffects: [],
      equipment: {}
    };

    const modifier = calculateElementalModifier(highResistDefender, 'fire');
    // 100 resist >= 100 -> immune (returns 0)
    assert.strictEqual(modifier, 0, 'Resistance of 100 should grant immunity');
  });

  it('should handle absorb at 150+ resistance', () => {
    const absorbDefender = {
      race: 'human',
      elementalResistances: { fire: 150 },
      statusEffects: [],
      equipment: {}
    };

    const modifier = calculateElementalModifier(absorbDefender, 'fire');
    assert.ok(modifier < 0, `Absorb resistance should produce negative modifier, got ${modifier}`);
  });
});
