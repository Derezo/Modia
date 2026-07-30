import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as enemyService from '../../services/enemyService.js';
import * as traitService from '../../services/traitService.js';
import * as zodiacAbilityService from '../../services/zodiacAbilityService.js';
import { loadZodiacCollectionBonus } from
  '../../services/zodiacCollectionBonusService.js';
import { ZODIAC_SHRINE_BUFFS } from '../../../../shared/constants.js';

describe('PvE snapshot query executor', () => {
  it('loads character traits through the supplied transaction client', async () => {
    const calls = [];
    const client = {
      async query(text, params) {
        calls.push({ text, params });
        return {
          rows: [{
            character_id: 17,
            id: 4,
            name: 'Fleet',
            description: 'Moves quickly',
            category: 'combat',
            rarity: 'common',
            effect_type: 'movement_bonus',
            effect_value: '1'
          }]
        };
      }
    };

    const traits = await traitService.loadCharacterTraits([17], { client });

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].params, [[17]]);
    assert.strictEqual(traits[17][0].effectType, 'movement_bonus');
  });

  it('loads zodiac abilities through the supplied transaction client', async () => {
    const calls = [];
    const client = {
      async query(text, params) {
        calls.push({ text, params });
        return { rows: [] };
      }
    };

    const abilities = await zodiacAbilityService.loadActiveZodiacAbilities(
      23,
      { client }
    );

    assert.deepStrictEqual(abilities, []);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(
      calls[0].params,
      [23, Object.keys(ZODIAC_SHRINE_BUFFS)]
    );
  });

  it('loads zodiac collection bonuses through the supplied transaction client', async () => {
    const calls = [];
    const client = {
      async query(text, params) {
        calls.push({ text, params });
        return { rows: [{ zodiac_sign: 'aries' }] };
      }
    };

    const bonus = await loadZodiacCollectionBonus(23, { client });

    assert.equal(bonus.totalCollected, 1);
    assert.equal(bonus.physicalDamage, 0.01);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].params, [23]);
  });

  it('uses one supplied client for every encounter lookup, including fallback templates', async () => {
    const calls = [];
    const client = {
      async query(text, params) {
        calls.push({ text, params });
        if (text.includes('FROM world_nodes')) {
          return {
            rows: [{
              node_type: 'forest',
              difficulty_tier: 1
            }]
          };
        }
        return { rows: [] };
      }
    };

    const enemies = await enemyService.generateEncounter(
      91,
      [{ id: 17, level: 5 }],
      [17],
      { client }
    );

    assert.ok(enemies.length >= 3);
    assert.strictEqual(calls.length, 3);
    assert.deepStrictEqual(calls[0].params, [91]);
    assert.match(calls[1].text, /FROM enemy_templates/);
    assert.match(calls[2].text, /FROM enemy_templates/);
  });
});
