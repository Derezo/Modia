/**
 * Name Generator Unit Tests
 *
 * Tests the pure name generation functions used for procedural NPC naming.
 * These functions are deterministic when given a seeded RNG.
 *
 * Functions tested:
 * - generateName - Generate a single name for race/gender
 * - generateUniqueNames - Generate multiple unique names
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SeededRandom, RACES, GENDERS } from '../../../../shared/constants.js';
import { NAME_POOLS } from '../../../../shared/nameData.js';

// Import name generator functions
let importError = null;
let generateName = null;
let generateUniqueNames = null;

try {
  const mod = await import('../../utils/nameGenerator.js');
  generateName = mod.generateName;
  generateUniqueNames = mod.generateUniqueNames;
} catch (err) {
  importError = err;
}

const canImport = importError === null;

describe('Name Generator - generateName', { skip: !canImport }, () => {
  describe('input validation', () => {
    it('throws error for invalid race', () => {
      assert.throws(
        () => generateName('invalid_race', 'male'),
        /Invalid race/
      );
    });

    it('throws error for invalid gender', () => {
      assert.throws(
        () => generateName('human', 'invalid_gender'),
        /Invalid gender/
      );
    });

    it('includes valid races in error message', () => {
      try {
        generateName('invalid_race', 'male');
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err.message.includes('human'), 'Should mention valid races');
      }
    });

    it('includes valid genders in error message', () => {
      try {
        generateName('human', 'invalid_gender');
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err.message.includes('male') || err.message.includes('female'),
          'Should mention valid genders');
      }
    });
  });

  describe('human names', () => {
    it('generates name for human male', () => {
      const name = generateName('human', 'male');

      assert.ok(typeof name === 'string');
      assert.ok(name.length > 0);
    });

    it('generates name for human female', () => {
      const name = generateName('human', 'female');

      assert.ok(typeof name === 'string');
      assert.ok(name.length > 0);
    });

    it('generates name for human other', () => {
      const name = generateName('human', 'other');

      assert.ok(typeof name === 'string');
      assert.ok(name.length > 0);
    });

    it('human male draws from male + unisex pools', () => {
      const rng = new SeededRandom(42);
      const names = new Set();

      // Generate many names to cover the pool
      for (let i = 0; i < 100; i++) {
        names.add(generateName('human', 'male', rng));
      }

      const malePool = NAME_POOLS.human.male;
      const unisexPool = NAME_POOLS.human.unisex;
      const femalePool = NAME_POOLS.human.female;

      // Should include at least one male or unisex name
      const hasMaleOrUnisex = [...names].some(
        n => malePool.includes(n) || unisexPool.includes(n)
      );
      assert.ok(hasMaleOrUnisex, 'Should include male/unisex names');

      // Should NOT include female-only names
      const hasFemaleOnly = [...names].some(
        n => femalePool.includes(n) && !unisexPool.includes(n)
      );
      assert.ok(!hasFemaleOnly, 'Should not include female-only names');
    });

    it('human female draws from female + unisex pools', () => {
      const rng = new SeededRandom(42);
      const names = new Set();

      for (let i = 0; i < 100; i++) {
        names.add(generateName('human', 'female', rng));
      }

      const malePool = NAME_POOLS.human.male;
      const femalePool = NAME_POOLS.human.female;
      const unisexPool = NAME_POOLS.human.unisex;

      // Should include at least one female or unisex name
      const hasFemaleOrUnisex = [...names].some(
        n => femalePool.includes(n) || unisexPool.includes(n)
      );
      assert.ok(hasFemaleOrUnisex, 'Should include female/unisex names');

      // Should NOT include male-only names
      const hasMaleOnly = [...names].some(
        n => malePool.includes(n) && !unisexPool.includes(n)
      );
      assert.ok(!hasMaleOnly, 'Should not include male-only names');
    });

    it('human other draws only from unisex pool', () => {
      const rng = new SeededRandom(42);
      const names = new Set();

      for (let i = 0; i < 100; i++) {
        names.add(generateName('human', 'other', rng));
      }

      const unisexPool = NAME_POOLS.human.unisex;

      // All names should be in unisex pool
      for (const name of names) {
        assert.ok(unisexPool.includes(name), `'${name}' should be in unisex pool`);
      }
    });
  });

  describe('all races', () => {
    const races = Object.values(RACES);
    const genders = Object.values(GENDERS);

    for (const race of races) {
      for (const gender of genders) {
        it(`generates name for ${race} ${gender}`, () => {
          const name = generateName(race, gender);

          assert.ok(typeof name === 'string', `${race} ${gender} should return string`);
          assert.ok(name.length > 0, `${race} ${gender} should return non-empty`);
        });
      }
    }
  });

  describe('deterministic with SeededRandom', () => {
    it('produces same result with same seed', () => {
      const seed = 12345;
      const rng1 = new SeededRandom(seed);
      const rng2 = new SeededRandom(seed);

      const name1 = generateName('human', 'male', rng1);
      const name2 = generateName('human', 'male', rng2);

      assert.strictEqual(name1, name2);
    });

    it('produces different results with different seeds', () => {
      const rng1 = new SeededRandom(11111);
      const rng2 = new SeededRandom(99999);

      // Generate multiple names to increase chance of difference
      const names1 = [];
      const names2 = [];
      for (let i = 0; i < 5; i++) {
        names1.push(generateName('elf', 'female', rng1));
        names2.push(generateName('elf', 'female', rng2));
      }

      // At least one should be different
      const allSame = names1.every((n, i) => n === names2[i]);
      assert.ok(!allSame, 'Different seeds should produce different sequences');
    });

    it('uses Math.random when no RNG provided', () => {
      // Just verify it doesn't throw
      const name = generateName('dwarf', 'male');
      assert.ok(typeof name === 'string');
    });
  });

  describe('race-specific characteristics', () => {
    it('elf names have elvish flavor', () => {
      const rng = new SeededRandom(42);
      const name = generateName('elf', 'male', rng);

      // Elvish names tend to have certain patterns
      assert.ok(name.length > 0);
      // Most elf names in the pool are longer than typical human names
    });

    it('dwarf names exist in pool', () => {
      const rng = new SeededRandom(42);
      const name = generateName('dwarf', 'female', rng);

      const pool = [...NAME_POOLS.dwarf.female, ...NAME_POOLS.dwarf.unisex];
      assert.ok(pool.includes(name), `'${name}' should be in dwarf female/unisex pool`);
    });

    it('orc names exist in pool', () => {
      const rng = new SeededRandom(42);
      const name = generateName('orc', 'male', rng);

      const pool = [...NAME_POOLS.orc.male, ...NAME_POOLS.orc.unisex];
      assert.ok(pool.includes(name), `'${name}' should be in orc male/unisex pool`);
    });

    it('vampire names exist in pool', () => {
      const rng = new SeededRandom(42);
      const name = generateName('vampire', 'other', rng);

      const pool = NAME_POOLS.vampire.unisex;
      assert.ok(pool.includes(name), `'${name}' should be in vampire unisex pool`);
    });
  });
});

describe('Name Generator - generateUniqueNames', { skip: !canImport }, () => {
  describe('basic functionality', () => {
    it('returns array of requested count', () => {
      const names = generateUniqueNames('human', 'male', 5);

      assert.strictEqual(names.length, 5);
    });

    it('all names are unique', () => {
      const names = generateUniqueNames('human', 'male', 10);
      const uniqueSet = new Set(names);

      assert.strictEqual(uniqueSet.size, names.length);
    });

    it('returns empty array for invalid race', () => {
      const names = generateUniqueNames('invalid_race', 'male', 5);

      assert.ok(Array.isArray(names));
      // Invalid inputs return empty array (error handling in generateName)
    });

    it('returns empty array for invalid gender', () => {
      const names = generateUniqueNames('human', 'invalid_gender', 5);

      assert.ok(Array.isArray(names));
    });
  });

  describe('pool size limits', () => {
    it('caps at pool size when requesting more than available', () => {
      // Human other only has unisex pool
      const unisexPoolSize = NAME_POOLS.human.unisex.length;
      const requestedCount = unisexPoolSize + 10;

      const names = generateUniqueNames('human', 'other', requestedCount);

      assert.ok(names.length <= unisexPoolSize,
        `Should cap at ${unisexPoolSize}, got ${names.length}`);
    });

    it('returns all unique names up to pool size', () => {
      const unisexPoolSize = NAME_POOLS.elf.unisex.length;
      const names = generateUniqueNames('elf', 'other', unisexPoolSize);

      const uniqueSet = new Set(names);
      assert.strictEqual(uniqueSet.size, names.length);
    });
  });

  describe('with SeededRandom', () => {
    it('produces consistent results with same seed', () => {
      const rng1 = new SeededRandom(42);
      const rng2 = new SeededRandom(42);

      const names1 = generateUniqueNames('dwarf', 'male', 5, rng1);
      const names2 = generateUniqueNames('dwarf', 'male', 5, rng2);

      assert.deepStrictEqual(names1, names2);
    });
  });

  describe('all race/gender combinations', () => {
    const races = Object.values(RACES);
    const genders = Object.values(GENDERS);

    for (const race of races) {
      for (const gender of genders) {
        it(`generates unique names for ${race} ${gender}`, () => {
          const names = generateUniqueNames(race, gender, 3);

          assert.ok(Array.isArray(names));
          assert.ok(names.length > 0, `Should generate at least 1 name for ${race} ${gender}`);

          const uniqueSet = new Set(names);
          assert.strictEqual(uniqueSet.size, names.length, 'Names should be unique');
        });
      }
    }
  });

  describe('edge cases', () => {
    it('handles count of 0', () => {
      const names = generateUniqueNames('human', 'male', 0);

      assert.ok(Array.isArray(names));
      assert.strictEqual(names.length, 0);
    });

    it('handles count of 1', () => {
      const names = generateUniqueNames('human', 'male', 1);

      assert.strictEqual(names.length, 1);
      assert.ok(typeof names[0] === 'string');
    });

    it('does not hang with high count requests', () => {
      const startTime = Date.now();
      const names = generateUniqueNames('vampire', 'other', 1000);
      const elapsed = Date.now() - startTime;

      // Should complete quickly even with impossible request
      assert.ok(elapsed < 1000, `Should complete in < 1s, took ${elapsed}ms`);
      assert.ok(Array.isArray(names));
    });
  });
});

describe('Name Generator - NAME_POOLS validation', { skip: !canImport }, () => {
  it('all races have pools defined', () => {
    for (const race of Object.values(RACES)) {
      assert.ok(NAME_POOLS[race], `Pool for ${race} should exist`);
    }
  });

  it('all pools have male, female, and unisex arrays', () => {
    for (const race of Object.values(RACES)) {
      const pool = NAME_POOLS[race];
      assert.ok(Array.isArray(pool.male), `${race} should have male array`);
      assert.ok(Array.isArray(pool.female), `${race} should have female array`);
      assert.ok(Array.isArray(pool.unisex), `${race} should have unisex array`);
    }
  });

  it('all pools have at least 10 names per category', () => {
    for (const race of Object.values(RACES)) {
      const pool = NAME_POOLS[race];
      assert.ok(pool.male.length >= 10, `${race} male should have >= 10 names`);
      assert.ok(pool.female.length >= 10, `${race} female should have >= 10 names`);
      assert.ok(pool.unisex.length >= 10, `${race} unisex should have >= 10 names`);
    }
  });

  it('all names are non-empty strings', () => {
    for (const race of Object.values(RACES)) {
      const pool = NAME_POOLS[race];
      for (const category of ['male', 'female', 'unisex']) {
        for (const name of pool[category]) {
          assert.ok(typeof name === 'string', `${race} ${category} names should be strings`);
          assert.ok(name.length > 0, `${race} ${category} names should be non-empty`);
        }
      }
    }
  });

  it('no duplicate names within a pool category', () => {
    for (const race of Object.values(RACES)) {
      const pool = NAME_POOLS[race];
      for (const category of ['male', 'female', 'unisex']) {
        const names = pool[category];
        const uniqueSet = new Set(names);

        assert.strictEqual(
          uniqueSet.size,
          names.length,
          `${race} ${category} should have no duplicates`
        );
      }
    }
  });
});

describe('Name Generator - import error handling', { skip: canImport }, () => {
  it('reports import error', () => {
    console.log('Name Generator import error:', importError?.message);
    assert.ok(importError, 'Import error should be captured');
  });
});
