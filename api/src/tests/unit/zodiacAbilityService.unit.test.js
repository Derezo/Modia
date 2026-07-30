import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pool } from '../../config/database.js';
import {
  loadActiveZodiacAbilities,
  loadZodiacAbilitiesForUsers
} from '../../services/zodiacAbilityService.js';
import { createPlayerBattleUnit } from '../../services/battleUnitFactory.js';
import { createBattleMutableStateV1 } from '../../../../shared/battleStateProtocol.js';

function createCharacter() {
  return {
    id: 17,
    user_id: 23,
    name: 'Zodiac Hero',
    class: 'warrior',
    level: 8,
    race: 'human',
    gender: 'other',
    hp_current: 80,
    hp_max: 100,
    mp_current: 25,
    mp_max: 30,
    strength: 18,
    intelligence: 9,
    agility: 12,
    vitality: 16,
    luck: 7,
    equipment: null
  };
}

describe('zodiacAbilityService', () => {
  it('serializes active ability expiry before building battle state', async () => {
    const expiresAt = new Date('2026-07-29T18:45:12.345Z');
    const client = {
      async query(sql) {
        assert.doesNotMatch(sql, /signature_used/);
        return {
          rows: [
            {
              zodiac_sign: 'aries',
              signature_ability: 'rams_charge',
              expires_at: expiresAt
            },
            {
              zodiac_sign: 'not-a-sign',
              signature_ability: 'rams_charge',
              expires_at: expiresAt
            },
            {
              zodiac_sign: 'taurus',
              signature_ability: 'rams_charge',
              expires_at: expiresAt
            }
          ]
        };
      }
    };

    const abilities = await loadActiveZodiacAbilities(23, { client });

    assert.strictEqual(abilities.length, 1);
    assert.strictEqual(
      abilities[0].expiresAt,
      '2026-07-29T18:45:12.345Z'
    );
    assert.strictEqual(abilities[0].needsTarget, false);
    const unit = createPlayerBattleUnit(createCharacter(), null, [], {
      zodiacAbilities: abilities
    });
    let mutableState;
    assert.doesNotThrow(() => {
      mutableState = createBattleMutableStateV1({ units: [unit] });
    });
    assert.strictEqual(
      mutableState.units[0].zodiacAbilities[0].expiresAt,
      '2026-07-29T18:45:12.345Z'
    );
  });

  it('uses the same expiry mapping when grouping batch-loaded abilities', async (t) => {
    const expiresAt = new Date('2026-08-01T02:03:04.005Z');
    const queryMock = t.mock.method(pool, 'query', async () => ({
      rows: [
        {
          user_id: 23,
          zodiac_sign: 'taurus',
          signature_ability: 'unmovable',
          expires_at: expiresAt
        },
        {
          user_id: 23,
          zodiac_sign: 'taurus',
          signature_ability: 'rams_charge',
          expires_at: expiresAt
        }
      ]
    }));

    const abilitiesByUser = await loadZodiacAbilitiesForUsers([23, 24]);

    assert.strictEqual(queryMock.mock.callCount(), 1);
    assert.doesNotMatch(
      queryMock.mock.calls[0].arguments[0],
      /signature_used/
    );
    assert.strictEqual(
      abilitiesByUser[23][0].expiresAt,
      '2026-08-01T02:03:04.005Z'
    );
    assert.strictEqual(abilitiesByUser[23].length, 1);
    assert.deepStrictEqual(abilitiesByUser[24], []);
  });

  it('keeps only the newest entitled legacy blessings at battle load time', async () => {
    const expiresAt = new Date('2026-08-01T02:03:04.005Z');
    const rows = [
      {
        zodiac_sign: 'pisces',
        signature_ability: 'dreamwave',
        expires_at: expiresAt,
        canonical_crystal_count: '11'
      },
      {
        zodiac_sign: 'aries',
        signature_ability: 'rams_charge',
        expires_at: expiresAt,
        canonical_crystal_count: '11'
      },
      {
        zodiac_sign: 'taurus',
        signature_ability: 'unmovable',
        expires_at: expiresAt,
        canonical_crystal_count: '11'
      }
    ];

    const singleSlot = await loadActiveZodiacAbilities(23, {
      client: { query: async () => ({ rows }) }
    });
    assert.deepStrictEqual(
      singleSlot.map(ability => ability.key),
      ['dreamwave']
    );

    const completedRows = rows.map(row => ({
      ...row,
      canonical_crystal_count: '12'
    }));
    const dualSlot = await loadActiveZodiacAbilities(23, {
      client: { query: async () => ({ rows: completedRows }) }
    });
    assert.deepStrictEqual(
      dualSlot.map(ability => ability.key),
      ['dreamwave', 'rams_charge']
    );
  });
});
