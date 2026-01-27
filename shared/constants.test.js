/**
 * Constants Unit Tests
 * Tests for game constants, SeededRandom, and stat calculations
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  RACES,
  CLASSES,
  ADVANCED_CLASSES,
  RACE_BASE_STATS,
  CLASS_GROWTH,
  MAX_PARTY_SIZE,
  MAX_BATTLE_PARTY_SIZE,
  SeededRandom,
  expForLevel,
  calculateStats
} from './constants.js';

describe('Constants', () => {
  describe('RACES', () => {
    it('should have all 5 races defined', () => {
      assert.strictEqual(Object.keys(RACES).length, 5);
      assert.ok(RACES.HUMAN);
      assert.ok(RACES.ELF);
      assert.ok(RACES.DWARF);
      assert.ok(RACES.VAMPIRE);
      assert.ok(RACES.ORC);
    });

    it('should have lowercase values', () => {
      for (const race of Object.values(RACES)) {
        assert.strictEqual(race, race.toLowerCase());
      }
    });
  });

  describe('CLASSES', () => {
    it('should have all 4 base classes defined', () => {
      assert.strictEqual(Object.keys(CLASSES).length, 4);
      assert.ok(CLASSES.WARRIOR);
      assert.ok(CLASSES.WIZARD);
      assert.ok(CLASSES.MONK);
      assert.ok(CLASSES.CHEMIST);
    });
  });

  describe('ADVANCED_CLASSES', () => {
    it('should have 16 advanced classes (4 per base class)', () => {
      assert.strictEqual(Object.keys(ADVANCED_CLASSES).length, 16);
    });
  });

  describe('RACE_BASE_STATS', () => {
    it('should have stats for all races', () => {
      for (const race of Object.values(RACES)) {
        assert.ok(RACE_BASE_STATS[race], `Missing stats for ${race}`);
      }
    });

    it('should have required stat properties', () => {
      const requiredStats = ['hp', 'mp', 'strength', 'intelligence', 'agility', 'vitality', 'luck'];
      for (const [race, stats] of Object.entries(RACE_BASE_STATS)) {
        for (const stat of requiredStats) {
          assert.ok(typeof stats[stat] === 'number', `${race} missing ${stat}`);
        }
      }
    });

    it('should have unique race traits', () => {
      const traits = new Set();
      for (const stats of Object.values(RACE_BASE_STATS)) {
        assert.ok(stats.trait, 'Race should have trait');
        traits.add(stats.trait);
      }
      assert.strictEqual(traits.size, 5, 'All races should have unique traits');
    });
  });

  describe('CLASS_GROWTH', () => {
    it('should have growth for all base classes', () => {
      for (const charClass of Object.values(CLASSES)) {
        assert.ok(CLASS_GROWTH[charClass], `Missing growth for ${charClass}`);
      }
    });

    it('should have growth for all advanced classes', () => {
      for (const charClass of Object.values(ADVANCED_CLASSES)) {
        assert.ok(CLASS_GROWTH[charClass], `Missing growth for ${charClass}`);
      }
    });

    it('should have required growth stats', () => {
      const requiredGrowth = ['hp', 'mp', 'strength', 'intelligence', 'agility', 'vitality'];
      for (const [charClass, growth] of Object.entries(CLASS_GROWTH)) {
        for (const stat of requiredGrowth) {
          assert.ok(typeof growth[stat] === 'number', `${charClass} missing ${stat} growth`);
        }
      }
    });
  });

  describe('Game limits', () => {
    it('should have reasonable party sizes', () => {
      assert.ok(MAX_PARTY_SIZE > 0);
      assert.ok(MAX_BATTLE_PARTY_SIZE > 0);
      assert.ok(MAX_BATTLE_PARTY_SIZE <= MAX_PARTY_SIZE);
    });
  });
});

describe('SeededRandom', () => {
  it('should be deterministic with same seed', () => {
    const rng1 = new SeededRandom(12345);
    const rng2 = new SeededRandom(12345);

    for (let i = 0; i < 100; i++) {
      assert.strictEqual(rng1.next(), rng2.next(), `Should produce same value at iteration ${i}`);
    }
  });

  it('should produce different values with different seeds', () => {
    const rng1 = new SeededRandom(12345);
    const rng2 = new SeededRandom(54321);

    const seq1 = [rng1.next(), rng1.next(), rng1.next()];
    const seq2 = [rng2.next(), rng2.next(), rng2.next()];

    // Very unlikely to be the same
    assert.notDeepStrictEqual(seq1, seq2);
  });

  it('should produce values between 0 and 1', () => {
    const rng = new SeededRandom(12345);

    for (let i = 0; i < 1000; i++) {
      const value = rng.next();
      assert.ok(value >= 0 && value < 1, `Value should be in [0,1): ${value}`);
    }
  });

  describe('nextInt', () => {
    it('should produce integers in range', () => {
      const rng = new SeededRandom(12345);

      for (let i = 0; i < 100; i++) {
        const value = rng.nextInt(5, 10);
        assert.ok(Number.isInteger(value), 'Should be integer');
        assert.ok(value >= 5 && value <= 10, `Value ${value} should be in [5,10]`);
      }
    });

    it('should include boundary values', () => {
      const rng = new SeededRandom(12345);
      const results = new Set();

      for (let i = 0; i < 10000; i++) {
        results.add(rng.nextInt(1, 3));
      }

      assert.ok(results.has(1), 'Should include min value');
      assert.ok(results.has(2), 'Should include middle value');
      assert.ok(results.has(3), 'Should include max value');
    });
  });

  describe('pick', () => {
    it('should pick from array', () => {
      const rng = new SeededRandom(12345);
      const array = ['a', 'b', 'c', 'd'];

      for (let i = 0; i < 100; i++) {
        const picked = rng.pick(array);
        assert.ok(array.includes(picked), `Picked ${picked} should be in array`);
      }
    });

    it('should be deterministic', () => {
      const array = ['a', 'b', 'c', 'd'];
      const rng1 = new SeededRandom(12345);
      const rng2 = new SeededRandom(12345);

      for (let i = 0; i < 10; i++) {
        assert.strictEqual(rng1.pick(array), rng2.pick(array));
      }
    });
  });

  describe('shuffle', () => {
    it('should return array with same elements', () => {
      const rng = new SeededRandom(12345);
      const original = [1, 2, 3, 4, 5];
      const shuffled = rng.shuffle(original);

      assert.strictEqual(shuffled.length, original.length);
      assert.deepStrictEqual(shuffled.sort(), original.sort());
    });

    it('should not modify original array', () => {
      const rng = new SeededRandom(12345);
      const original = [1, 2, 3, 4, 5];
      const copy = [...original];

      rng.shuffle(original);

      assert.deepStrictEqual(original, copy, 'Original should not be modified');
    });

    it('should be deterministic', () => {
      const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const rng1 = new SeededRandom(12345);
      const rng2 = new SeededRandom(12345);

      assert.deepStrictEqual(rng1.shuffle(array), rng2.shuffle(array));
    });
  });

  describe('nextGaussian', () => {
    it('should produce reasonable gaussian values', () => {
      const rng = new SeededRandom(12345);
      let sum = 0;

      for (let i = 0; i < 1000; i++) {
        sum += rng.nextGaussian();
      }

      const mean = sum / 1000;
      // Mean should be close to 0 for standard normal
      assert.ok(Math.abs(mean) < 0.2, `Mean ${mean} should be close to 0`);
    });
  });
});

describe('expForLevel', () => {
  it('should return 100 for level 1', () => {
    const exp = expForLevel(1);
    assert.strictEqual(exp, 100);
  });

  it('should increase exponentially with level', () => {
    const exp1 = expForLevel(1);
    const exp5 = expForLevel(5);
    const exp10 = expForLevel(10);
    const exp20 = expForLevel(20);

    assert.ok(exp5 > exp1, 'Level 5 should require more than level 1');
    assert.ok(exp10 > exp5, 'Level 10 should require more than level 5');
    assert.ok(exp20 > exp10, 'Level 20 should require more than level 10');

    // Check exponential growth
    const ratio1 = exp10 / exp5;
    const ratio2 = exp20 / exp10;
    assert.ok(ratio2 > ratio1 * 0.8, 'Growth should be roughly exponential');
  });

  it('should return integer values', () => {
    for (let level = 1; level <= 50; level++) {
      const exp = expForLevel(level);
      assert.ok(Number.isInteger(exp), `Level ${level} should have integer exp`);
    }
  });
});

describe('calculateStats', () => {
  it('should calculate stats at level 1 using base stats with VIT bonus', () => {
    const stats = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 1);

    // At level 1, HP includes VIT bonus: vitBonus = floor((level/2) + (VIT * 0.5))
    // Human base VIT = 10, so vitBonus = floor(0.5 + 5) = 5
    const baseHP = RACE_BASE_STATS.human.hp;
    const baseVIT = RACE_BASE_STATS.human.vitality;
    const expectedVitBonus = Math.floor((1 / 2) + (baseVIT * 0.5));
    assert.strictEqual(stats.hpMax, baseHP + expectedVitBonus, 'HP should include VIT bonus');
    assert.strictEqual(stats.strength, RACE_BASE_STATS.human.strength);
  });

  it('should increase stats with level', () => {
    const stats1 = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 1);
    const stats10 = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 10);
    const stats20 = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 20);

    assert.ok(stats10.hpMax > stats1.hpMax);
    assert.ok(stats20.hpMax > stats10.hpMax);
    assert.ok(stats10.strength > stats1.strength);
    assert.ok(stats20.strength > stats10.strength);
  });

  it('should apply class growth correctly', () => {
    const warrior = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 10);
    const wizard = calculateStats(RACES.HUMAN, CLASSES.WIZARD, 10);

    // Warriors get more HP and strength per level
    assert.ok(warrior.hpMax > wizard.hpMax, 'Warrior should have more HP');
    assert.ok(warrior.strength > wizard.strength, 'Warrior should have more strength');

    // Wizards get more MP and intelligence per level
    assert.ok(wizard.mpMax > warrior.mpMax, 'Wizard should have more MP');
    assert.ok(wizard.intelligence > warrior.intelligence, 'Wizard should have more INT');
  });

  it('should apply race base stats correctly', () => {
    const dwarf = calculateStats(RACES.DWARF, CLASSES.WARRIOR, 1);
    const elf = calculateStats(RACES.ELF, CLASSES.WARRIOR, 1);

    // Dwarves have higher HP and vitality
    assert.ok(dwarf.hpMax > elf.hpMax, 'Dwarf should have more HP');
    assert.ok(dwarf.vitality > elf.vitality, 'Dwarf should have more vitality');

    // Elves have higher intelligence
    assert.ok(elf.intelligence > dwarf.intelligence, 'Elf should have more INT');
  });

  it('should return all required stat properties', () => {
    const stats = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 10);

    assert.ok('hpMax' in stats);
    assert.ok('mpMax' in stats);
    assert.ok('strength' in stats);
    assert.ok('intelligence' in stats);
    assert.ok('agility' in stats);
    assert.ok('vitality' in stats);
    assert.ok('luck' in stats);
  });

  it('should work with advanced classes', () => {
    const berserker = calculateStats(RACES.ORC, ADVANCED_CLASSES.BERSERKER, 20);

    assert.ok(berserker.hpMax > 0);
    assert.ok(berserker.strength > 0);
  });

  it('should scale luck with level based on class growth', () => {
    // Luck now scales with level - warrior has 0.5 luck growth
    const stats1 = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 1);
    const stats50 = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 50);

    // Luck at level 50 should be higher than level 1
    assert.ok(stats50.luck > stats1.luck, 'Luck should scale with level');

    // Check the formula: baseLuck + (growth * (level - 1))
    // Human base luck = 10, warrior luck growth = 0.5
    const expectedLuck50 = RACE_BASE_STATS.human.luck + Math.floor(0.5 * (50 - 1));
    assert.strictEqual(stats50.luck, expectedLuck50, 'Luck should follow growth formula');
  });
});

// =============================================================================
// NEW TEST SECTIONS
// =============================================================================

describe('Advanced class growth rates validation', () => {
  const ALL_STATS = ['hp', 'mp', 'strength', 'intelligence', 'agility', 'vitality', 'luck'];
  const advancedClassValues = Object.values(ADVANCED_CLASSES);

  it('should have exactly 16 advanced classes', () => {
    assert.strictEqual(advancedClassValues.length, 16);
  });

  it('should define growth rates for ALL stats in every advanced class', () => {
    for (const className of advancedClassValues) {
      const growth = CLASS_GROWTH[className];
      assert.ok(growth, `Missing CLASS_GROWTH entry for ${className}`);

      for (const stat of ALL_STATS) {
        assert.ok(
          typeof growth[stat] === 'number',
          `${className} missing growth rate for '${stat}'`
        );
      }
    }
  });

  it('should have positive HP and MP growth for all advanced classes', () => {
    for (const className of advancedClassValues) {
      const growth = CLASS_GROWTH[className];
      assert.ok(growth.hp > 0, `${className} should have positive HP growth, got ${growth.hp}`);
      assert.ok(growth.mp > 0, `${className} should have positive MP growth, got ${growth.mp}`);
    }
  });

  it('should have non-negative growth for all stats', () => {
    for (const className of advancedClassValues) {
      const growth = CLASS_GROWTH[className];
      for (const stat of ALL_STATS) {
        assert.ok(
          growth[stat] >= 0,
          `${className}.${stat} growth should be non-negative, got ${growth[stat]}`
        );
      }
    }
  });
});

describe('XP formula validation', () => {
  const testLevels = [1, 2, 5, 10, 25, 50, 100];

  it('should match the formula Math.floor(100 * Math.pow(N, 1.8))', () => {
    for (const level of testLevels) {
      const expected = Math.floor(100 * Math.pow(level, 1.8));
      const actual = expForLevel(level);
      assert.strictEqual(
        actual,
        expected,
        `expForLevel(${level}): expected ${expected}, got ${actual}`
      );
    }
  });

  it('should return positive integers for all test levels', () => {
    for (const level of testLevels) {
      const exp = expForLevel(level);
      assert.ok(Number.isInteger(exp), `expForLevel(${level}) should be integer, got ${exp}`);
      assert.ok(exp > 0, `expForLevel(${level}) should be positive, got ${exp}`);
    }
  });

  it('should be strictly monotonically increasing', () => {
    for (let i = 1; i < testLevels.length; i++) {
      const prev = expForLevel(testLevels[i - 1]);
      const curr = expForLevel(testLevels[i]);
      assert.ok(
        curr > prev,
        `expForLevel(${testLevels[i]})=${curr} should exceed expForLevel(${testLevels[i - 1]})=${prev}`
      );
    }
  });
});

describe('calculateStats at boundary levels', () => {
  const STAT_KEYS = ['hpMax', 'mpMax', 'strength', 'intelligence', 'agility', 'vitality', 'luck'];
  const boundaryLevels = [1, 50, 100, 256];

  for (const level of boundaryLevels) {
    it(`should produce valid stats for HUMAN/WARRIOR at level ${level}`, () => {
      const stats = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, level);

      for (const key of STAT_KEYS) {
        assert.ok(
          key in stats,
          `Missing stat property '${key}' at level ${level}`
        );
        assert.ok(
          typeof stats[key] === 'number',
          `${key} should be a number at level ${level}, got ${typeof stats[key]}`
        );
        assert.ok(
          stats[key] > 0,
          `${key} should be positive at level ${level}, got ${stats[key]}`
        );
        assert.ok(
          Number.isInteger(stats[key]),
          `${key} should be an integer at level ${level}, got ${stats[key]}`
        );
      }
    });
  }

  it('should scale monotonically across boundary levels for HUMAN/WARRIOR', () => {
    let prevStats = null;
    for (const level of boundaryLevels) {
      const stats = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, level);
      if (prevStats) {
        for (const key of STAT_KEYS) {
          assert.ok(
            stats[key] >= prevStats[key],
            `${key} should not decrease from level ${boundaryLevels[boundaryLevels.indexOf(level) - 1]} to ${level}`
          );
        }
      }
      prevStats = stats;
    }
  });
});

describe('Exhaustive race/class combos', () => {
  const STAT_KEYS = ['hpMax', 'mpMax', 'strength', 'intelligence', 'agility', 'vitality', 'luck'];
  const allRaces = Object.values(RACES);
  const baseClasses = Object.values(CLASSES);
  const advancedClasses = Object.values(ADVANCED_CLASSES);

  it('should have 5 races, 4 base classes, 16 advanced classes for 100 total combos', () => {
    assert.strictEqual(allRaces.length, 5);
    assert.strictEqual(baseClasses.length, 4);
    assert.strictEqual(advancedClasses.length, 16);
    assert.strictEqual(allRaces.length * (baseClasses.length + advancedClasses.length), 100);
  });

  it('should produce valid positive integer stats for all 20 base race/class combos at level 10', () => {
    for (const race of allRaces) {
      for (const cls of baseClasses) {
        const stats = calculateStats(race, cls, 10);
        for (const key of STAT_KEYS) {
          assert.ok(
            typeof stats[key] === 'number' && Number.isInteger(stats[key]) && stats[key] > 0,
            `${race}/${cls} at level 10: ${key} should be a positive integer, got ${stats[key]}`
          );
        }
      }
    }
  });

  it('should produce valid positive integer stats for all 80 advanced race/class combos at level 10', () => {
    for (const race of allRaces) {
      for (const cls of advancedClasses) {
        const stats = calculateStats(race, cls, 10);
        for (const key of STAT_KEYS) {
          assert.ok(
            typeof stats[key] === 'number' && Number.isInteger(stats[key]) && stats[key] > 0,
            `${race}/${cls} at level 10: ${key} should be a positive integer, got ${stats[key]}`
          );
        }
      }
    }
  });

  it('should produce higher stats at level 10 than level 1 for all combos', () => {
    const allClasses = [...baseClasses, ...advancedClasses];
    for (const race of allRaces) {
      for (const cls of allClasses) {
        const stats1 = calculateStats(race, cls, 1);
        const stats10 = calculateStats(race, cls, 10);
        assert.ok(
          stats10.hpMax > stats1.hpMax,
          `${race}/${cls}: hpMax should grow from level 1 to 10`
        );
      }
    }
  });
});

describe('Race traits validation', () => {
  const expectedTraits = {
    [RACES.HUMAN]: 'exp_bonus',
    [RACES.ELF]: 'mp_regen',
    [RACES.DWARF]: 'gold_bonus',
    [RACES.VAMPIRE]: 'lifesteal',
    [RACES.ORC]: 'crit_damage'
  };

  for (const [race, expectedTrait] of Object.entries(expectedTraits)) {
    it(`should assign trait '${expectedTrait}' to ${race}`, () => {
      const raceStats = RACE_BASE_STATS[race];
      assert.ok(raceStats, `RACE_BASE_STATS missing entry for ${race}`);
      assert.strictEqual(
        raceStats.trait,
        expectedTrait,
        `${race} trait should be '${expectedTrait}', got '${raceStats.trait}'`
      );
    });
  }

  it('should have a positive traitValue for every race', () => {
    for (const race of Object.values(RACES)) {
      const raceStats = RACE_BASE_STATS[race];
      assert.ok(
        typeof raceStats.traitValue === 'number' && raceStats.traitValue > 0,
        `${race} traitValue should be a positive number, got ${raceStats.traitValue}`
      );
    }
  });

  it('should have unique traits across all races', () => {
    const traits = Object.values(RACES).map(r => RACE_BASE_STATS[r].trait);
    const uniqueTraits = new Set(traits);
    assert.strictEqual(
      uniqueTraits.size,
      traits.length,
      `All ${traits.length} race traits should be unique, found ${uniqueTraits.size} unique`
    );
  });

  it('should match all 5 expected race-trait pairings exactly', () => {
    for (const race of Object.values(RACES)) {
      assert.ok(
        race in expectedTraits,
        `Race '${race}' should have an expected trait mapping`
      );
      assert.strictEqual(RACE_BASE_STATS[race].trait, expectedTraits[race]);
    }
  });
});
