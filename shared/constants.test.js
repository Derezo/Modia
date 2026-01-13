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
  it('should calculate stats at level 1 using base stats only', () => {
    const stats = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 1);

    // At level 1, should be exactly base stats
    assert.strictEqual(stats.hpMax, RACE_BASE_STATS.human.hp);
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

  it('should have consistent luck (no level scaling)', () => {
    const stats1 = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 1);
    const stats50 = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 50);

    assert.strictEqual(stats1.luck, stats50.luck, 'Luck should not scale with level');
  });
});
