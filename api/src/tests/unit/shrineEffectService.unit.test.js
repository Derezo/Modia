import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStandardShrineRewardBonuses,
  loadActiveStandardShrineEffects,
  loadStaminaRegenWindows,
  normalizeStandardShrineEffectTypes
} from '../../services/shrineEffectService.js';

describe('shrineEffectService', () => {
  it('deduplicates supported standard blessings', () => {
    assert.deepEqual(
      normalizeStandardShrineEffectTypes([
        'gold_bonus',
        { buff_type: 'gold_bonus' },
        { buff_type: 'exp_bonus' },
        'zodiac_aries',
        null
      ]),
      ['exp_bonus', 'gold_bonus']
    );
  });

  it('applies gold and experience bonuses exactly once with integer rounding', () => {
    const result = applyStandardShrineRewardBonuses(
      { gold: 101, experience: 99 },
      ['gold_bonus', 'gold_bonus', 'exp_bonus', 'exp_bonus']
    );

    assert.equal(result.gold, 116);
    assert.equal(result.experience, 108);
    assert.deepEqual(result.appliedBonuses, [
      {
        effectType: 'gold_bonus',
        rewardType: 'gold',
        rate: 0.15,
        baseAmount: 101,
        bonusAmount: 15
      },
      {
        effectType: 'exp_bonus',
        rewardType: 'experience',
        rate: 0.10,
        baseAmount: 99,
        bonusAmount: 9
      }
    ]);
  });

  it('leaves rewards unchanged without active supported blessings', () => {
    assert.deepEqual(
      applyStandardShrineRewardBonuses(
        { gold: 75, experience: 120 },
        ['zodiac_taurus', 'expired_bonus']
      ),
      { gold: 75, experience: 120, appliedBonuses: [] }
    );
  });

  it('loads only active standard effects at the injected instant', async () => {
    const now = new Date('2026-07-29T12:00:00.000Z');
    const calls = [];
    const effects = await loadActiveStandardShrineEffects(42, {
      now,
      queryFn: async (sql, params) => {
        calls.push({ sql, params });
        return {
          rows: [
            { buff_type: 'gold_bonus' },
            { buff_type: 'gold_bonus' },
            { buff_type: 'zodiac_leo' }
          ]
        };
      }
    });

    assert.deepEqual(effects, ['gold_bonus']);
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /expires_at > \$2/);
    assert.match(calls[0].sql, /buff_type = ANY\(\$3::varchar\[\]\)/);
    assert.deepEqual(calls[0].params.slice(0, 2), [42, now]);
  });

  it('loads only stamina windows overlapping the lazy-regeneration period', async () => {
    const periodStart = new Date('2026-07-29T10:00:00.000Z');
    const now = new Date('2026-07-29T12:00:00.000Z');
    const calls = [];
    const windows = await loadStaminaRegenWindows(7, periodStart, {
      now,
      queryFn: async (sql, params) => {
        calls.push({ sql, params });
        return {
          rows: [{
            last_visited_at: '2026-07-29T10:30:00.000Z',
            expires_at: '2026-07-29T14:30:00.000Z'
          }]
        };
      }
    });

    assert.deepEqual(windows, [{
      startsAt: new Date('2026-07-29T10:30:00.000Z'),
      expiresAt: new Date('2026-07-29T14:30:00.000Z')
    }]);
    assert.match(calls[0].sql, /expires_at > \$2/);
    assert.match(calls[0].sql, /last_visited_at <= \$3/);
    assert.deepEqual(calls[0].params, [7, periodStart, now]);
  });
});
