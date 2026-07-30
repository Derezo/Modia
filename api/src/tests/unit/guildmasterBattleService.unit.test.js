import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSoloPlayerUnit,
  positionUnits
} from '../../services/guildmasterBattleService.js';
import { ZODIAC_CRYSTALS } from '../../../../shared/constants.js';

describe('guildmaster player battle snapshot', () => {
  it('loads the owning account collection through the injected client', async () => {
    const zodiacSigns = Object.keys(ZODIAC_CRYSTALS);
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('FROM characters c')) {
          return {
            rows: [{
              id: 77,
              user_id: 501,
              name: 'Celestial Challenger',
              class: 'warrior',
              race: 'human',
              gender: 'female',
              level: 20,
              hp_current: 80,
              hp_max: 100,
              mp_current: 40,
              mp_max: 60,
              strength: 100,
              intelligence: 50,
              agility: 40,
              vitality: 80,
              luck: 20
            }]
          };
        }
        if (sql.includes('FROM character_items')) {
          return {
            rows: [{
              stat_bonuses: {
                hp: 20,
                strength: 5,
                attack: 20
              }
            }]
          };
        }
        if (sql.includes('FROM character_skills')) {
          return { rows: [] };
        }
        if (sql.includes('FROM user_shrine_visits')) {
          assert.deepEqual(params, [501, zodiacSigns]);
          return {
            rows: [{
              zodiac_sign: 'aries',
              signature_ability: 'rams_charge',
              expires_at: new Date('2026-07-30T12:00:00.000Z'),
              canonical_crystal_count: zodiacSigns.length
            }]
          };
        }
        if (sql.includes('FROM user_zodiac_crystals')) {
          assert.deepEqual(params, [501]);
          return {
            rows: zodiacSigns.map(zodiac_sign => ({ zodiac_sign }))
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    const unit = await createSoloPlayerUnit(
      { id: 77, level: 20 },
      { client }
    );

    assert.equal(calls.length, 5);
    assert.equal(unit.id, 'player_77');
    assert.equal(unit.characterId, 77);
    assert.equal(unit.ownerId, 501);
    assert.equal(unit.hp, 84);
    assert.equal(unit.maxHp, 126);
    assert.equal(unit.strength, 110);
    assert.equal(unit.attack, 21);
    assert.equal(unit.zodiacCollectionBonus.collectionComplete, true);
    assert.equal(unit.zodiacCollectionBonus.allStats, 0.05);
    assert.deepEqual(unit.zodiacCollectionBonus.collectedSigns, zodiacSigns);
    assert.deepEqual(
      unit.zodiacAbilities.map(ability => ability.key),
      ['rams_charge']
    );
    assert.deepEqual(unit.usedZodiacAbilities, []);
  });
});

describe('guildmaster battle tactical positions', () => {
  it('uses canonical tile coordinates inside the protected formation strips', () => {
    const players = [{ id: 'player' }];
    const enemies = [
      { id: 'guildmaster' },
      { id: 'disciple_1' },
      { id: 'disciple_2' },
      { id: 'disciple_3' }
    ];

    positionUnits(players, enemies, 32, 32);

    assert.deepEqual(
      players.map(({ tileX, tileY }) => ({ tileX, tileY })),
      [{ tileX: 2, tileY: 16 }]
    );
    assert.deepEqual(
      enemies.map(({ tileX, tileY }) => ({ tileX, tileY })),
      [
        { tileX: 27, tileY: 16 },
        { tileX: 25, tileY: 18 },
        { tileX: 25, tileY: 14 },
        { tileX: 25, tileY: 20 }
      ]
    );
    for (const unit of [...players, ...enemies]) {
      assert.equal('x' in unit, false);
      assert.equal('y' in unit, false);
    }
  });
});
