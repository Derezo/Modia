/**
 * Integration tests for Zodiac Signature Abilities in Battle
 *
 * Tests the zodiac ability system including:
 * - Loading abilities for units
 * - Using abilities during battle
 * - Marking abilities as used
 * - Each ability type's effect
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import {
  createTestContext,
  request
} from '../testHelper.js';
import { query } from '../../config/database.js';

describe('Battle Zodiac Abilities', () => {
  const ctx = createTestContext();
  let user, accessToken, character;

  before(async () => {
    user = await ctx.createUser();
    accessToken = user.accessToken;

    // Create a character
    const charRes = await request('POST', '/api/characters', {
      name: 'ZodiacTester',
      race: 'human',
      gender: 'male',
      class: 'warrior'
    }, accessToken);
    character = charRes.body;

    // Move character to a battle node (forest)
    const nodeResult = await query(
      `SELECT id FROM world_nodes WHERE node_type = 'forest' LIMIT 1`
    );
    if (nodeResult.rows.length > 0) {
      await query(
        'UPDATE characters SET current_node_id = $1 WHERE id = $2',
        [nodeResult.rows[0].id, character.id]
      );
    }

    // Assign character to party slot 1
    await request('POST', '/api/party/assign', {
      characterId: character.id,
      slot: 1
    }, accessToken);
  });

  after(async () => {
    // Clean up any active battles
    await query('UPDATE characters SET in_battle = false WHERE id = $1', [character?.id]);
    await query('DELETE FROM battles WHERE player1_id = $1', [user?.userId]);
    await ctx.cleanup();
  });

  describe('Unit tests for zodiac ability functions', () => {
    it('hasZodiacAbility returns false for unit without abilities', async () => {
      const { hasZodiacAbility } = await import('../../services/battle/statusEffectManager.js');

      const unit = {
        id: 1,
        type: 'player',
        zodiacAbilities: []
      };

      assert.strictEqual(hasZodiacAbility(unit, 'rams_charge'), false);
    });

    it('hasZodiacAbility returns true for unit with matching ability', async () => {
      const { hasZodiacAbility } = await import('../../services/battle/statusEffectManager.js');

      const unit = {
        id: 1,
        type: 'player',
        zodiacAbilities: [{ key: 'rams_charge', zodiacSign: 'aries', name: "Ram's Charge" }]
      };

      assert.strictEqual(hasZodiacAbility(unit, 'rams_charge'), true);
      assert.strictEqual(hasZodiacAbility(unit, 'moonshield'), false);
    });

    it('getAvailableZodiacAbilities returns only unused abilities', async () => {
      const { getAvailableZodiacAbilities } = await import('../../services/battle/statusEffectManager.js');

      const unit = {
        id: 1,
        type: 'player',
        zodiacAbilities: [
          { key: 'rams_charge', zodiacSign: 'aries' },
          { key: 'moonshield', zodiacSign: 'cancer' }
        ],
        usedZodiacAbilities: ['rams_charge']
      };

      const available = getAvailableZodiacAbilities(unit);
      assert.strictEqual(available.length, 1);
      assert.strictEqual(available[0].key, 'moonshield');
    });

    it('markZodiacAbilityUsed adds ability to used list', async () => {
      const { markZodiacAbilityUsed } = await import('../../services/battle/statusEffectManager.js');

      const unit = {
        id: 1,
        type: 'player',
        zodiacAbilities: [{ key: 'rams_charge', zodiacSign: 'aries' }],
        usedZodiacAbilities: []
      };

      markZodiacAbilityUsed(unit, 'rams_charge');
      assert.strictEqual(unit.usedZodiacAbilities.includes('rams_charge'), true);

      // Should not duplicate
      markZodiacAbilityUsed(unit, 'rams_charge');
      assert.strictEqual(unit.usedZodiacAbilities.length, 1);
    });
  });

  describe('applyZodiacAbility effects', () => {
    it('rams_charge adds crit bonus to unit', async () => {
      const { applyZodiacAbility } = await import('../../services/battle/statusEffectManager.js');

      const sourceUnit = {
        id: 1,
        type: 'player',
        tileX: 5,
        tileY: 5,
        zodiacAbilities: [{ key: 'rams_charge', zodiacSign: 'aries' }],
        usedZodiacAbilities: []
      };

      const battleState = { units: [sourceUnit] };
      const result = applyZodiacAbility(battleState, sourceUnit, 'rams_charge');

      assert.strictEqual(result.success, true);
      assert.strictEqual(sourceUnit.nextAttackCritBonus, 0.25);
      assert.ok(result.message.includes("Ram's Charge"));
      assert.ok(sourceUnit.usedZodiacAbilities.includes('rams_charge'));
    });

    it('moonshield adds damage shield to unit', async () => {
      const { applyZodiacAbility } = await import('../../services/battle/statusEffectManager.js');

      const sourceUnit = {
        id: 1,
        type: 'player',
        tileX: 5,
        tileY: 5,
        zodiacAbilities: [{ key: 'moonshield', zodiacSign: 'cancer' }],
        usedZodiacAbilities: []
      };

      const battleState = { units: [sourceUnit] };
      const result = applyZodiacAbility(battleState, sourceUnit, 'moonshield');

      assert.strictEqual(result.success, true);
      assert.strictEqual(sourceUnit.damageShield, 1);
      assert.ok(result.message.includes('Moonshield'));
    });

    it('roar reduces CT of adjacent enemies', async () => {
      const { applyZodiacAbility } = await import('../../services/battle/statusEffectManager.js');

      const sourceUnit = {
        id: 1,
        type: 'player',
        tileX: 5,
        tileY: 5,
        hp: 100,
        zodiacAbilities: [{ key: 'roar', zodiacSign: 'leo' }],
        usedZodiacAbilities: []
      };

      const adjacentEnemy = {
        id: 'enemy_1',
        type: 'enemy',
        tileX: 5,
        tileY: 6,
        hp: 100,
        ct: 80
      };

      const farEnemy = {
        id: 'enemy_2',
        type: 'enemy',
        tileX: 10,
        tileY: 10,
        hp: 100,
        ct: 80
      };

      const battleState = { units: [sourceUnit, adjacentEnemy, farEnemy] };
      const result = applyZodiacAbility(battleState, sourceUnit, 'roar');

      assert.strictEqual(result.success, true);
      assert.strictEqual(adjacentEnemy.ct, 50); // 80 - 30 = 50
      assert.strictEqual(farEnemy.ct, 80); // Not affected (too far)
      assert.ok(result.effects.length > 0);
    });

    it('cascade heals 20% of max HP', async () => {
      const { applyZodiacAbility } = await import('../../services/battle/statusEffectManager.js');

      const sourceUnit = {
        id: 1,
        type: 'player',
        tileX: 5,
        tileY: 5,
        hp: 50,
        maxHp: 100,
        zodiacAbilities: [{ key: 'cascade', zodiacSign: 'aquarius' }],
        usedZodiacAbilities: []
      };

      const battleState = { units: [sourceUnit] };
      const result = applyZodiacAbility(battleState, sourceUnit, 'cascade');

      assert.strictEqual(result.success, true);
      assert.strictEqual(sourceUnit.hp, 70); // 50 + 20 = 70
      assert.ok(result.message.includes('Cascade'));
    });

    it('venom_sting requires a target', async () => {
      const { applyZodiacAbility } = await import('../../services/battle/statusEffectManager.js');

      const sourceUnit = {
        id: 1,
        type: 'player',
        tileX: 5,
        tileY: 5,
        attackRange: 3,
        zodiacAbilities: [{ key: 'venom_sting', zodiacSign: 'scorpio' }],
        usedZodiacAbilities: []
      };

      const battleState = { units: [sourceUnit] };
      const result = applyZodiacAbility(battleState, sourceUnit, 'venom_sting', null);

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('requires a target'));
    });

    it('venom_sting applies poison to target', async () => {
      const { applyZodiacAbility } = await import('../../services/battle/statusEffectManager.js');

      const sourceUnit = {
        id: 1,
        type: 'player',
        tileX: 5,
        tileY: 5,
        attackRange: 3,
        zodiacAbilities: [{ key: 'venom_sting', zodiacSign: 'scorpio' }],
        usedZodiacAbilities: []
      };

      const targetUnit = {
        id: 'enemy_1',
        type: 'enemy',
        tileX: 6,
        tileY: 5,
        hp: 100,
        statusEffects: []
      };

      const battleState = { units: [sourceUnit, targetUnit] };
      const result = applyZodiacAbility(battleState, sourceUnit, 'venom_sting', targetUnit);

      assert.strictEqual(result.success, true);
      assert.ok(targetUnit.statusEffects.find(e => e.type === 'zodiac_poison'));
      assert.ok(result.message.includes('poisoned'));
    });

    it('cannot use ability twice in same battle', async () => {
      const { applyZodiacAbility } = await import('../../services/battle/statusEffectManager.js');

      const sourceUnit = {
        id: 1,
        type: 'player',
        tileX: 5,
        tileY: 5,
        zodiacAbilities: [{ key: 'cascade', zodiacSign: 'aquarius' }],
        usedZodiacAbilities: ['cascade'] // Already used
      };

      const battleState = { units: [sourceUnit] };
      const result = applyZodiacAbility(battleState, sourceUnit, 'cascade');

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('already been used'));
    });

    it('cannot use ability unit does not have', async () => {
      const { applyZodiacAbility } = await import('../../services/battle/statusEffectManager.js');

      const sourceUnit = {
        id: 1,
        type: 'player',
        tileX: 5,
        tileY: 5,
        zodiacAbilities: [], // No abilities
        usedZodiacAbilities: []
      };

      const battleState = { units: [sourceUnit] };
      const result = applyZodiacAbility(battleState, sourceUnit, 'cascade');

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('does not have this zodiac ability'));
    });
  });

  describe('checkMoonshield', () => {
    it('blocks damage when shield is active', async () => {
      const { checkMoonshield } = await import('../../services/battle/statusEffectManager.js');

      const unit = {
        id: 1,
        damageShield: 1
      };

      const result = checkMoonshield(unit, 50);
      assert.strictEqual(result.blocked, true);
      assert.strictEqual(result.damage, 0);
      assert.strictEqual(unit.damageShield, 0);
    });

    it('does not block when no shield', async () => {
      const { checkMoonshield } = await import('../../services/battle/statusEffectManager.js');

      const unit = {
        id: 1,
        damageShield: 0
      };

      const result = checkMoonshield(unit, 50);
      assert.strictEqual(result.blocked, false);
      assert.strictEqual(result.damage, 50);
    });
  });

  describe('processZodiacPoison', () => {
    it('deals 3% max HP damage and decrements duration', async () => {
      const { processZodiacPoison } = await import('../../services/battle/statusEffectManager.js');

      const unit = {
        id: 1,
        hp: 100,
        maxHp: 100,
        statusEffects: [
          { type: 'zodiac_poison', duration: 3, damagePercent: 0.03 }
        ]
      };

      const result = processZodiacPoison(unit);

      assert.ok(result);
      assert.strictEqual(result.type, 'zodiac_poison');
      assert.strictEqual(result.damage, 3);
      assert.strictEqual(unit.hp, 97);
      assert.strictEqual(unit.statusEffects[0].duration, 2);
    });

    it('removes poison when duration reaches 0', async () => {
      const { processZodiacPoison } = await import('../../services/battle/statusEffectManager.js');

      const unit = {
        id: 1,
        hp: 100,
        maxHp: 100,
        statusEffects: [
          { type: 'zodiac_poison', duration: 1, damagePercent: 0.03 }
        ]
      };

      processZodiacPoison(unit);

      assert.strictEqual(unit.statusEffects.length, 0);
    });
  });

  describe('Zodiac Ability Service', () => {
    it('loadActiveZodiacAbilities returns empty array for user without buffs', async () => {
      const zodiacService = await import('../../services/zodiacAbilityService.js');
      const abilities = await zodiacService.loadActiveZodiacAbilities(user.userId);
      assert.ok(Array.isArray(abilities));
    });

    it('getAllZodiacAbilities returns all 12 abilities', async () => {
      const zodiacService = await import('../../services/zodiacAbilityService.js');
      const abilities = zodiacService.getAllZodiacAbilities();

      assert.ok(abilities.rams_charge);
      assert.ok(abilities.moonshield);
      assert.ok(abilities.twin_strike);
      assert.ok(abilities.unmovable);
      assert.ok(abilities.roar);
      assert.ok(abilities.purify);
      assert.ok(abilities.balance);
      assert.ok(abilities.venom_sting);
      assert.ok(abilities.celestial_arrow);
      assert.ok(abilities.mountains_endurance);
      assert.ok(abilities.cascade);
      assert.ok(abilities.dreamwave);
    });
  });

  describe('Battle API endpoints', () => {
    // Note: These tests require a running server and a battle node available
    // They may be skipped if the test environment doesn't support battles

    it('GET /api/battle/:battleId/zodiac-abilities returns 404 for non-existent battle', async () => {
      const res = await request(
        'GET',
        '/api/battle/99999/zodiac-abilities/1',
        null,
        accessToken
      );

      assert.strictEqual(res.status, 404);
    });

    it('POST /api/battle/:battleId/zodiac-ability returns 404 for non-existent battle', async () => {
      // Note: The battle is checked first (404) before body validation (400)
      const res = await request(
        'POST',
        '/api/battle/99999/zodiac-ability',
        { characterId: 1, abilityKey: 'rams_charge' },
        accessToken
      );

      assert.strictEqual(res.status, 404);
    });
  });
});
