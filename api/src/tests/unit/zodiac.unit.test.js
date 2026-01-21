/**
 * Zodiac Constants Unit Tests
 * Tests for zodiac shrine buffs and crystal definitions
 *
 * These tests verify the structure and completeness of zodiac constants
 * without requiring database access.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  ZODIAC_SHRINE_BUFFS,
  ZODIAC_CRYSTALS,
  ZODIAC_COLLECTION_BONUS
} from '../../../../shared/constants.js';

// All 12 zodiac signs
const ALL_ZODIAC_SIGNS = [
  'aries', 'taurus', 'gemini', 'cancer',
  'leo', 'virgo', 'libra', 'scorpio',
  'sagittarius', 'capricorn', 'aquarius', 'pisces'
];

// Expected element distribution (3 of each)
const ELEMENTS = ['fire', 'earth', 'air', 'water'];

describe('ZODIAC_SHRINE_BUFFS', () => {
  it('should have all 12 zodiac signs', () => {
    const signs = Object.keys(ZODIAC_SHRINE_BUFFS);
    assert.strictEqual(signs.length, 12, 'Expected 12 zodiac signs');

    for (const sign of ALL_ZODIAC_SIGNS) {
      assert.ok(
        ZODIAC_SHRINE_BUFFS[sign],
        `Missing zodiac sign: ${sign}`
      );
    }
  });

  it('should have required properties for each buff', () => {
    for (const [sign, buff] of Object.entries(ZODIAC_SHRINE_BUFFS)) {
      assert.ok(buff.name, `${sign} missing name`);
      assert.ok(buff.description, `${sign} missing description`);
      assert.ok(buff.signatureAbility, `${sign} missing signatureAbility`);
      assert.ok(buff.element, `${sign} missing element`);
      assert.strictEqual(typeof buff.duration, 'number', `${sign} duration should be a number`);
      assert.ok(buff.duration > 0, `${sign} duration should be positive`);
    }
  });

  it('should have each element appear exactly 3 times', () => {
    const elementCounts = {};
    for (const element of ELEMENTS) {
      elementCounts[element] = 0;
    }

    for (const buff of Object.values(ZODIAC_SHRINE_BUFFS)) {
      assert.ok(
        ELEMENTS.includes(buff.element),
        `Invalid element: ${buff.element}`
      );
      elementCounts[buff.element]++;
    }

    for (const [element, count] of Object.entries(elementCounts)) {
      assert.strictEqual(
        count,
        3,
        `Element ${element} appears ${count} times, expected 3`
      );
    }
  });

  it('should have unique signature abilities', () => {
    const abilities = new Set();
    for (const [sign, buff] of Object.entries(ZODIAC_SHRINE_BUFFS)) {
      assert.ok(
        !abilities.has(buff.signatureAbility),
        `Duplicate signature ability: ${buff.signatureAbility} in ${sign}`
      );
      abilities.add(buff.signatureAbility);
    }
  });

  it('should have 4-hour duration for all buffs', () => {
    for (const [sign, buff] of Object.entries(ZODIAC_SHRINE_BUFFS)) {
      assert.strictEqual(
        buff.duration,
        4,
        `${sign} should have 4-hour duration, got ${buff.duration}`
      );
    }
  });
});

describe('ZODIAC_CRYSTALS', () => {
  it('should have all 12 zodiac signs', () => {
    const signs = Object.keys(ZODIAC_CRYSTALS);
    assert.strictEqual(signs.length, 12, 'Expected 12 zodiac crystals');

    for (const sign of ALL_ZODIAC_SIGNS) {
      assert.ok(
        ZODIAC_CRYSTALS[sign],
        `Missing zodiac crystal: ${sign}`
      );
    }
  });

  it('should have matching signs with ZODIAC_SHRINE_BUFFS', () => {
    const buffSigns = Object.keys(ZODIAC_SHRINE_BUFFS).sort();
    const crystalSigns = Object.keys(ZODIAC_CRYSTALS).sort();

    assert.deepStrictEqual(
      crystalSigns,
      buffSigns,
      'Crystal signs should match shrine buff signs'
    );
  });

  it('should have required properties for each crystal', () => {
    for (const [sign, crystal] of Object.entries(ZODIAC_CRYSTALS)) {
      assert.ok(crystal.name, `${sign} crystal missing name`);
      assert.ok(crystal.bonus, `${sign} crystal missing bonus`);
      assert.ok(crystal.bonus.type, `${sign} crystal missing bonus.type`);
      assert.strictEqual(
        typeof crystal.bonus.value,
        'number',
        `${sign} crystal bonus.value should be a number`
      );
    }
  });

  it('should have valid bonus types', () => {
    const validBonusTypes = ['physical_damage', 'defense', 'crit_chance', 'healing_received'];

    for (const [sign, crystal] of Object.entries(ZODIAC_CRYSTALS)) {
      assert.ok(
        validBonusTypes.includes(crystal.bonus.type),
        `${sign} crystal has invalid bonus type: ${crystal.bonus.type}`
      );
    }
  });

  it('should have each bonus type appear exactly 3 times', () => {
    const bonusTypeCounts = {
      physical_damage: 0,
      defense: 0,
      crit_chance: 0,
      healing_received: 0
    };

    for (const crystal of Object.values(ZODIAC_CRYSTALS)) {
      bonusTypeCounts[crystal.bonus.type]++;
    }

    for (const [type, count] of Object.entries(bonusTypeCounts)) {
      assert.strictEqual(
        count,
        3,
        `Bonus type ${type} appears ${count} times, expected 3`
      );
    }
  });

  it('should have 1% bonus value for all crystals', () => {
    for (const [sign, crystal] of Object.entries(ZODIAC_CRYSTALS)) {
      assert.strictEqual(
        crystal.bonus.value,
        0.01,
        `${sign} crystal should have 0.01 bonus value, got ${crystal.bonus.value}`
      );
    }
  });

  it('should have unique crystal names', () => {
    const names = new Set();
    for (const [sign, crystal] of Object.entries(ZODIAC_CRYSTALS)) {
      assert.ok(
        !names.has(crystal.name),
        `Duplicate crystal name: ${crystal.name} in ${sign}`
      );
      names.add(crystal.name);
    }
  });
});

describe('ZODIAC_COLLECTION_BONUS', () => {
  it('should have required properties', () => {
    assert.ok(ZODIAC_COLLECTION_BONUS.title, 'Missing title');
    assert.strictEqual(
      typeof ZODIAC_COLLECTION_BONUS.allStatsBonus,
      'number',
      'allStatsBonus should be a number'
    );
    assert.strictEqual(
      typeof ZODIAC_COLLECTION_BONUS.dualBlessingSlots,
      'boolean',
      'dualBlessingSlots should be a boolean'
    );
  });

  it('should have correct bonus values', () => {
    assert.strictEqual(
      ZODIAC_COLLECTION_BONUS.title,
      'Celestial Wanderer',
      'Title should be "Celestial Wanderer"'
    );
    assert.strictEqual(
      ZODIAC_COLLECTION_BONUS.allStatsBonus,
      0.05,
      'All stats bonus should be 5%'
    );
    assert.strictEqual(
      ZODIAC_COLLECTION_BONUS.dualBlessingSlots,
      true,
      'Dual blessing slots should be enabled'
    );
  });
});

describe('Zodiac Element Distribution', () => {
  it('should map fire signs correctly (Aries, Leo, Sagittarius)', () => {
    const fireSigns = ['aries', 'leo', 'sagittarius'];
    for (const sign of fireSigns) {
      assert.strictEqual(
        ZODIAC_SHRINE_BUFFS[sign].element,
        'fire',
        `${sign} should be a fire sign`
      );
    }
  });

  it('should map earth signs correctly (Taurus, Virgo, Capricorn)', () => {
    const earthSigns = ['taurus', 'virgo', 'capricorn'];
    for (const sign of earthSigns) {
      assert.strictEqual(
        ZODIAC_SHRINE_BUFFS[sign].element,
        'earth',
        `${sign} should be an earth sign`
      );
    }
  });

  it('should map air signs correctly (Gemini, Libra, Aquarius)', () => {
    const airSigns = ['gemini', 'libra', 'aquarius'];
    for (const sign of airSigns) {
      assert.strictEqual(
        ZODIAC_SHRINE_BUFFS[sign].element,
        'air',
        `${sign} should be an air sign`
      );
    }
  });

  it('should map water signs correctly (Cancer, Scorpio, Pisces)', () => {
    const waterSigns = ['cancer', 'scorpio', 'pisces'];
    for (const sign of waterSigns) {
      assert.strictEqual(
        ZODIAC_SHRINE_BUFFS[sign].element,
        'water',
        `${sign} should be a water sign`
      );
    }
  });
});
