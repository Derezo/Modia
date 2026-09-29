import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSoloPlayerUnit,
  positionUnits
} from '../../services/guildmasterBattleService.js';
import { ZODIAC_CRYSTALS } from '../../../../shared/constants.js';

describe('guildmaster player battle snapshot', () => {
  it('applies equipment luck bonus from augmented items', async () => {
    const zodiacSigns = Object.keys(ZODIAC_CRYSTALS);
    const client = {
      async query(sql) {
        if (sql.includes('FROM characters c')) {
          return {
            rows: [{
              id: 88,
              user_id: 502,
              name: 'Lucky Challenger',
              class: 'warrior',
              race: 'human',
              gender: 'male',
              level: 15,
              hp_current: 100,
              hp_max: 100,
              mp_current: 50,
              mp_max: 50,
              strength: 80,
              intelligence: 40,
              agility: 35,
              vitality: 60,
              luck: 10
            }]
          };
        }
        if (sql.includes('FROM character_items')) {
          // Equipment with bonusStats.luck (from augment)
          return {
            rows: [{
              stat_bonuses: { strength: 5 },
              modifications: JSON.stringify({
                baseStats: { strength: 8 },
                bonusStats: { luck: 4 }
              })
            }]
          };
        }
        if (sql.includes('FROM character_skills')) {
          return { rows: [] };
        }
        if (sql.includes('FROM user_shrine_visits')) {
          return { rows: [] };
        }
        if (sql.includes('FROM user_zodiac_crystals')) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };

    const unit = await createSoloPlayerUnit({ id: 88, level: 15 }, { client });

    // Base luck is 10, equipment provides +4 from bonusStats.luck
    assert.equal(unit.luck, 14, 'equipment luck bonus should be applied');
  });

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

    // characters, equipped items, augment effects, skills, collection, abilities
    assert.equal(calls.length, 6);
    assert.equal(unit.id, 'player_77');
    assert.equal(unit.characterId, 77);
    assert.equal(unit.ownerId, 501);
    // Gear HP (+20) raises current HP too (battleUnitFactory, 385b87e6):
    // floor((80 + 20) * 1.05) = 105, capped at maxHp 126
    assert.equal(unit.hp, 105);
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

describe('guildmaster player gear loading', () => {
  function makeClient(calls) {
    return {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql.includes('FROM characters c')) {
          return {
            rows: [{
              id: 66, user_id: 503, name: 'Geared Challenger', class: 'warrior',
              race: 'human', gender: 'male', level: 12, hp_current: 100, hp_max: 100,
              mp_current: 30, mp_max: 30, strength: 50, intelligence: 20,
              agility: 30, vitality: 40, luck: 10
            }]
          };
        }
        if (sql.includes('FROM character_items')) {
          // Gear equipped after creation: equipped_slot set, is_equipped false
          if (!/equipped_slot IS NOT NULL/.test(sql)) {
            return { rows: [] };
          }
          return {
            rows: [{
              character_id: 66,
              is_equipped: false,
              equipped_slot: 'main_hand',
              stat_bonuses: { strength: 7 },
              modifications: JSON.stringify({
                augments: [{ key: 'keen', effect: { type: 'crit_chance', value: 0.05 } }]
              })
            }]
          };
        }
        if (sql.includes('FROM character_skills')
          || sql.includes('FROM user_shrine_visits')
          || sql.includes('FROM user_zodiac_crystals')) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      }
    };
  }

  it('reads equipment by equipped_slot, not the stale is_equipped flag', async () => {
    const calls = [];
    const unit = await createSoloPlayerUnit({ id: 66, level: 12 }, { client: makeClient(calls) });
    const gearQueries = calls.filter(c => c.sql.includes('FROM character_items'));
    assert.ok(gearQueries.length > 0);
    for (const { sql } of gearQueries) {
      assert.doesNotMatch(sql, /is_equipped/);
    }
    assert.equal(unit.strength, 57, 'post-creation gear strength must count');
  });

  it('applies equipment augment combat effects (crit, lifesteal) like PvE', async () => {
    const unit = await createSoloPlayerUnit({ id: 66, level: 12 }, { client: makeClient([]) });
    assert.equal(unit.equipmentAugmentEffects.crit_chance, 0.05);
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
