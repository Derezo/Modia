/**
 * Class Balance Tests
 * Verifies that all class/race combinations are viable and balanced
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createMockCharacter,
  createMockEnemy,
  calculateDPS,
  calculateEffectiveHP,
  getAllCombinations,
  TEST_LEVELS,
  CLASSES,
  ADVANCED_CLASSES,
  RACES,
  RACE_BASE_STATS,
  CLASS_GROWTH,
  calculateStats,
  calculatePhysicalDamage,
  calculateMagicalDamage
} from './balanceTestUtils.js';

describe('Class Balance', () => {
  describe('Base Class Viability', () => {
    const baseClasses = Object.values(CLASSES);

    it('should have all base classes viable at level 1', () => {
      const tier1Enemy = createMockEnemy({ partyLevel: 1, tier: 1 });

      const results = baseClasses.map(charClass => {
        const char = createMockCharacter({ charClass, level: 1 });
        const dps = calculateDPS(char, tier1Enemy, 'physical');
        return { charClass, turnsToKill: dps.turnsToKill, ehp: calculateEffectiveHP(char) };
      });

      // All classes should be able to kill a tier 1 enemy in under 20 turns
      results.forEach(({ charClass, turnsToKill }) => {
        assert.ok(turnsToKill <= 20,
          `${charClass} should kill tier 1 enemy in <=20 turns, got ${turnsToKill}`);
      });
    });

    it('should have all base classes viable at level 20', () => {
      const enemy = createMockEnemy({ partyLevel: 20, tier: 3 });

      const results = baseClasses.map(charClass => {
        const char = createMockCharacter({ charClass, level: 20 });

        // Test with the class's preferred damage type
        const damageType = charClass === 'wizard' ? 'magical' : 'physical';
        const dps = calculateDPS(char, enemy, damageType);

        return { charClass, turnsToKill: dps.turnsToKill, damagePerHit: dps.damagePerHit };
      });

      // No class should be more than 3x slower than the fastest
      const ttks = results.map(r => r.turnsToKill);
      const minTTK = Math.min(...ttks);
      const maxTTK = Math.max(...ttks);

      assert.ok(maxTTK / minTTK <= 3,
        `Class TTK variance should be <= 3x: min=${minTTK}, max=${maxTTK}`);
    });
  });

  describe('Advanced Class Progression', () => {
    it('should have advanced classes stronger than base at level 25', () => {
      const enemy = createMockEnemy({ partyLevel: 25, tier: 3 });

      // Test each base -> advanced progression
      const progressions = [
        { base: 'warrior', advanced: 'berserker', type: 'physical' },
        { base: 'wizard', advanced: 'sorcerer', type: 'magical' },
        { base: 'monk', advanced: 'ninja', type: 'physical' },
        { base: 'chemist', advanced: 'alchemist', type: 'magical' }
      ];

      progressions.forEach(({ base, advanced, type }) => {
        const baseChar = createMockCharacter({ charClass: base, level: 25 });
        const advancedChar = createMockCharacter({ charClass: advanced, level: 25 });

        const baseDps = calculateDPS(baseChar, enemy, type);
        const advancedDps = calculateDPS(advancedChar, enemy, type);

        assert.ok(advancedDps.damagePerHit >= baseDps.damagePerHit,
          `${advanced} should deal >= damage than ${base}: ${advancedDps.damagePerHit.toFixed(1)} vs ${baseDps.damagePerHit.toFixed(1)}`);
      });
    });
  });

  describe('Race Balance', () => {
    const races = Object.values(RACES);

    it('should have all races viable as warriors', () => {
      const enemy = createMockEnemy({ partyLevel: 20, tier: 3 });

      const results = races.map(race => {
        const char = createMockCharacter({ race, charClass: 'warrior', level: 20 });
        const dps = calculateDPS(char, enemy, 'physical');
        return { race, turnsToKill: dps.turnsToKill, hp: char.hp };
      });

      // TTK variance between races should be reasonable
      const ttks = results.map(r => r.turnsToKill);
      const minTTK = Math.min(...ttks);
      const maxTTK = Math.max(...ttks);

      assert.ok(maxTTK / minTTK <= 2,
        `Race warrior TTK variance should be <= 2x: min=${minTTK}, max=${maxTTK}`);
    });

    it('should have all races viable as wizards', () => {
      const enemy = createMockEnemy({ partyLevel: 20, tier: 3 });

      const results = races.map(race => {
        const char = createMockCharacter({ race, charClass: 'wizard', level: 20 });
        const dps = calculateDPS(char, enemy, 'magical');
        return { race, turnsToKill: dps.turnsToKill, mp: char.mp };
      });

      // All races should be playable as wizard
      results.forEach(({ race, turnsToKill }) => {
        assert.ok(turnsToKill <= 25,
          `${race} wizard should kill enemy in <=25 turns, got ${turnsToKill}`);
      });
    });

    it('should have distinct race strengths', () => {
      // Verify each race has a meaningful stat advantage
      const humanStats = RACE_BASE_STATS['human'];

      // Orc should have highest strength
      const orcStats = RACE_BASE_STATS['orc'];
      assert.ok(orcStats.strength > humanStats.strength,
        'Orc should have higher base strength than human');

      // Elf should have highest intelligence
      const elfStats = RACE_BASE_STATS['elf'];
      assert.ok(elfStats.intelligence > humanStats.intelligence,
        'Elf should have higher base intelligence than human');

      // Dwarf should have highest vitality
      const dwarfStats = RACE_BASE_STATS['dwarf'];
      assert.ok(dwarfStats.vitality > humanStats.vitality,
        'Dwarf should have higher base vitality than human');
    });
  });

  describe('Stat Growth Rates', () => {
    it('should have meaningful stat differences at high levels', () => {
      const level = 50;

      // Compare warrior (physical) vs wizard (magical)
      const warrior = createMockCharacter({ charClass: 'warrior', level });
      const wizard = createMockCharacter({ charClass: 'wizard', level });

      // Warriors should have significantly more HP
      assert.ok(warrior.hp > wizard.hp * 1.5,
        `Warrior HP (${warrior.hp}) should be >1.5x wizard HP (${wizard.hp})`);

      // Wizards should have significantly more MP
      assert.ok(wizard.mp > warrior.mp * 2,
        `Wizard MP (${wizard.mp}) should be >2x warrior MP (${warrior.mp})`);

      // Warriors should have more strength
      assert.ok(warrior.strength > wizard.strength * 2,
        `Warrior STR (${warrior.strength}) should be >2x wizard STR (${wizard.strength})`);

      // Wizards should have more intelligence
      assert.ok(wizard.intelligence > warrior.intelligence * 2,
        `Wizard INT (${wizard.intelligence}) should be >2x warrior INT (${warrior.intelligence})`);
    });

    it('should have monks be the fastest class', () => {
      const level = 30;

      const allChars = Object.values(CLASSES).map(charClass => ({
        charClass,
        char: createMockCharacter({ charClass, level })
      }));

      const monkAgility = allChars.find(c => c.charClass === 'monk').char.agility;
      const otherMaxAgility = Math.max(
        ...allChars.filter(c => c.charClass !== 'monk').map(c => c.char.agility)
      );

      assert.ok(monkAgility > otherMaxAgility,
        `Monk agility (${monkAgility}) should exceed other classes (max: ${otherMaxAgility})`);
    });
  });

  describe('Effective HP Balance', () => {
    it('should have warriors be tankiest', () => {
      const level = 30;

      const classes = Object.values(CLASSES);
      const ehps = classes.map(charClass => {
        const char = createMockCharacter({ charClass, level });
        return { charClass, ehp: calculateEffectiveHP(char), hp: char.hp };
      });

      const warrior = ehps.find(c => c.charClass === 'warrior');
      const others = ehps.filter(c => c.charClass !== 'warrior');

      others.forEach(other => {
        assert.ok(warrior.hp > other.hp,
          `Warrior HP (${warrior.hp}) should exceed ${other.charClass} HP (${other.hp})`);
      });
    });

    it('should have all classes have enough HP to survive multiple hits', () => {
      const level = 20;
      const enemy = createMockEnemy({ partyLevel: level, tier: 3 });

      Object.values(CLASSES).forEach(charClass => {
        const char = createMockCharacter({ charClass, level });
        const enemyDps = calculateDPS(enemy, char, 'physical');

        // Each class should survive at least 3 enemy attacks
        assert.ok(enemyDps.turnsToKill >= 3,
          `${charClass} should survive >= 3 enemy attacks, survives ${enemyDps.turnsToKill}`);
      });
    });
  });

  describe('DPS Balance', () => {
    it('should have DPS variance documented across classes', () => {
      const level = 30;
      const enemy = createMockEnemy({ partyLevel: level, tier: 3 });

      const dpsByClass = Object.values(CLASSES).map(charClass => {
        const char = createMockCharacter({ charClass, level });
        const type = charClass === 'wizard' ? 'magical' : 'physical';
        const dps = calculateDPS(char, enemy, type);
        return { charClass, dps: dps.damagePerHit };
      });

      const minDps = Math.min(...dpsByClass.map(c => c.dps));
      const maxDps = Math.max(...dpsByClass.map(c => c.dps));
      const variance = maxDps / minDps;

      // Document current variance
      console.log(`DPS by class: ${dpsByClass.map(c => `${c.charClass}=${c.dps.toFixed(1)}`).join(', ')}`);
      console.log(`DPS variance: ${variance.toFixed(2)}x (min=${minDps.toFixed(1)}, max=${maxDps.toFixed(1)})`);

      // Warn if variance is high (>3x suggests imbalance)
      if (variance > 3) {
        console.warn(`BALANCE WARNING: DPS variance ${variance.toFixed(2)}x exceeds 3x threshold`);
      }

      // All classes should at least deal positive damage
      dpsByClass.forEach(({ charClass, dps }) => {
        assert.ok(dps > 0, `${charClass} should deal positive DPS`);
      });

      // Variance threshold: allowing up to 4x for role diversity
      assert.ok(variance <= 4,
        `DPS variance should be <= 4x to maintain viability: ${variance.toFixed(2)}x`);
    });
  });

  describe('Level Scaling Consistency', () => {
    it('should document power growth per level band', () => {
      const charClass = 'warrior';
      const results = [];

      for (let level = 1; level <= 50; level += 5) {
        const char = createMockCharacter({ charClass, level });
        const enemy = createMockEnemy({ partyLevel: level, tier: 3 });
        const dps = calculateDPS(char, enemy, 'physical');
        results.push({ level, dps: dps.damagePerHit, ttk: dps.turnsToKill });
      }

      // Document the scaling curve
      console.log('Warrior scaling by level:');
      results.forEach(({ level, dps, ttk }) => {
        console.log(`  Level ${level}: DPS=${dps.toFixed(1)}, TTK=${ttk}`);
      });

      // Verify DPS increases with level
      for (let i = 1; i < results.length; i++) {
        assert.ok(results[i].dps >= results[i - 1].dps * 0.9, // Allow small dips due to enemy scaling
          `DPS should generally increase: L${results[i].level}=${results[i].dps.toFixed(1)} vs L${results[i - 1].level}=${results[i - 1].dps.toFixed(1)}`);
      }

      // TTK should stay within reasonable bounds at all levels
      results.forEach(({ level, ttk }) => {
        assert.ok(ttk >= 2 && ttk <= 30,
          `Level ${level}: TTK (${ttk}) should be 2-30 turns`);
      });
    });
  });
});

describe('Combination Viability', () => {
  it('should have no completely unviable race/class combinations', () => {
    const level = 20;
    const enemy = createMockEnemy({ partyLevel: level, tier: 3 });

    const combinations = getAllCombinations();
    const baseClassCombos = combinations.filter(c =>
      Object.values(CLASSES).includes(c.charClass)
    );

    const results = baseClassCombos.map(({ race, charClass }) => {
      const char = createMockCharacter({ race, charClass, level });
      const type = charClass === 'wizard' ? 'magical' : 'physical';
      const dps = calculateDPS(char, enemy, type);
      return { race, charClass, turnsToKill: dps.turnsToKill };
    });

    // No combination should take more than 3x the fastest
    const ttks = results.map(r => r.turnsToKill);
    const minTTK = Math.min(...ttks);
    const maxTTK = Math.max(...ttks);

    assert.ok(maxTTK / minTTK <= 3,
      `No combination should be >3x slower than best: min=${minTTK}, max=${maxTTK}`);

    // Flag any particularly slow combinations
    const slowCombos = results.filter(r => r.turnsToKill > minTTK * 2);
    if (slowCombos.length > 0) {
      console.log('Slower combinations (>2x min TTK):',
        slowCombos.map(r => `${r.race}/${r.charClass}: ${r.turnsToKill}`).join(', '));
    }
  });
});
