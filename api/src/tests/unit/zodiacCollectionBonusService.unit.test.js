import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ZODIAC_CRYSTALS } from '../../../../shared/constants.js';
import {
  aggregateZodiacCollectionBonuses,
  applyHealingReceivedBonus,
  loadZodiacCollectionBonus,
  normalizeZodiacCollectionBonus
} from '../../services/zodiacCollectionBonusService.js';

describe('zodiacCollectionBonusService', () => {
  it('accumulates each crystal category and ignores duplicate or unknown signs', () => {
    const bonus = aggregateZodiacCollectionBonuses([
      'aries',
      'leo',
      'taurus',
      'gemini',
      'cancer',
      'aries',
      'not-a-sign'
    ]);

    assert.deepStrictEqual(
      bonus.collectedSigns,
      ['aries', 'leo', 'taurus', 'gemini', 'cancer']
    );
    assert.strictEqual(bonus.totalCollected, 5);
    assert.strictEqual(bonus.physicalDamage, 0.02);
    assert.strictEqual(bonus.defense, 0.01);
    assert.strictEqual(bonus.critChance, 0.01);
    assert.strictEqual(bonus.healingReceived, 0.01);
    assert.strictEqual(bonus.allStats, 0);
    assert.strictEqual(bonus.collectionComplete, false);
    assert.doesNotThrow(() => JSON.stringify(bonus));
  });

  it('grants the five percent all-stat bonus only for all 12 unique crystals', () => {
    const allSigns = Object.keys(ZODIAC_CRYSTALS);
    const incomplete = aggregateZodiacCollectionBonuses(allSigns.slice(0, -1));
    const complete = aggregateZodiacCollectionBonuses(allSigns);

    assert.strictEqual(incomplete.allStats, 0);
    assert.strictEqual(incomplete.collectionComplete, false);
    assert.strictEqual(complete.totalCollected, 12);
    assert.strictEqual(complete.collectionComplete, true);
    assert.strictEqual(complete.allStats, 0.05);
    assert.ok(Math.abs(complete.physicalDamage - 0.03) < Number.EPSILON);
    assert.ok(Math.abs(complete.defense - 0.03) < Number.EPSILON);
    assert.ok(Math.abs(complete.critChance - 0.03) < Number.EPSILON);
    assert.ok(Math.abs(complete.healingReceived - 0.03) < Number.EPSILON);
  });

  it('loads collection rows with an injected transaction client', async () => {
    const calls = [];
    const client = {
      async query(sql, parameters) {
        calls.push({ sql, parameters });
        return {
          rows: [
            { zodiac_sign: 'aries' },
            { zodiac_sign: 'taurus' }
          ]
        };
      }
    };

    const bonus = await loadZodiacCollectionBonus(42, { client });

    assert.deepStrictEqual(calls[0].parameters, [42]);
    assert.match(calls[0].sql, /user_zodiac_crystals/);
    assert.deepStrictEqual(bonus.collectedSigns, ['aries', 'taurus']);
    assert.strictEqual(bonus.physicalDamage, 0.01);
    assert.strictEqual(bonus.defense, 0.01);
  });

  it('re-derives untrusted aggregate values from verified collected signs', () => {
    const normalized = normalizeZodiacCollectionBonus({
      collectedSigns: ['aries', 'cancer', 'aries', 'invalid'],
      physicalDamage: 99,
      defense: 99,
      critChance: 99,
      healingReceived: 99,
      allStats: 99
    });

    assert.deepStrictEqual(normalized.collectedSigns, ['aries', 'cancer']);
    assert.strictEqual(normalized.totalCollected, 2);
    assert.strictEqual(normalized.physicalDamage, 0.01);
    assert.strictEqual(normalized.defense, 0);
    assert.strictEqual(normalized.critChance, 0);
    assert.strictEqual(normalized.healingReceived, 0.01);
    assert.strictEqual(normalized.allStats, 0);
  });

  it('boosts player healing while preserving no-bonus and enemy healing', () => {
    const player = {
      type: 'player',
      zodiacCollectionBonus: { healingReceived: 0.03 }
    };
    const enemy = {
      type: 'enemy',
      zodiacCollectionBonus: { healingReceived: 0.99 }
    };

    assert.strictEqual(applyHealingReceivedBonus(player, 100), 103);
    assert.strictEqual(applyHealingReceivedBonus({ type: 'player' }, 100), 100);
    assert.strictEqual(applyHealingReceivedBonus(enemy, 100), 100);
  });
});
