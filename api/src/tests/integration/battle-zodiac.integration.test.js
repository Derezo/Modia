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
import {
  BATTLE_MAP_HASH_VERSION,
  BATTLE_MAP_SCHEMA_VERSION,
  BATTLE_MAP_V3_HASH_VERSION,
  BATTLE_MAP_V3_SCHEMA_VERSION
} from '../../../../shared/battleMap/index.js';
import {
  BATTLE_MUTABLE_STATE_PROTOCOL_VERSION,
  createBattleMapCapabilities
} from '../../../../shared/battleStateProtocol.js';

const supportedBattleMapCapabilities = createBattleMapCapabilities({
  supportedBattleMapSchemaVersions: [
    1,
    BATTLE_MAP_SCHEMA_VERSION,
    BATTLE_MAP_V3_SCHEMA_VERSION
  ],
  supportedHashVersions: [
    BATTLE_MAP_HASH_VERSION,
    BATTLE_MAP_V3_HASH_VERSION
  ],
  supportedMutableStateProtocolVersions: [
    BATTLE_MUTABLE_STATE_PROTOCOL_VERSION
  ]
});

describe('Battle Zodiac Abilities', () => {
  const ctx = createTestContext();
  let user, accessToken, character;
  let battleNodeId;

  before(async () => {
    user = await ctx.createUser();
    accessToken = user.accessToken;

    // Create a character
    const charRes = await request('POST', '/api/characters', {
      name: 'ZodiacTester',
      race: 'human',
      gender: 'male',
      characterClass: 'warrior'
    }, accessToken);
    assert.strictEqual(charRes.status, 201, JSON.stringify(charRes.body));
    character = charRes.body.character;

    // Move character to a battle node (forest)
    const nodeResult = await query(
      `SELECT id FROM world_nodes WHERE node_type = 'forest' LIMIT 1`
    );
    if (nodeResult.rows.length > 0) {
      battleNodeId = nodeResult.rows[0].id;
      await query(
        'UPDATE characters SET current_node_id = $1 WHERE id = $2',
        [battleNodeId, character.id]
      );
    }

    const battleParty = await request('PUT', '/api/party/battle', {
      characterIds: [character.id]
    }, accessToken);
    assert.strictEqual(battleParty.status, 200, JSON.stringify(battleParty.body));
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

    it('loads and commits a free signature for the authoritative active character', async () => {
      assert.ok(battleNodeId, 'battle Zodiac endpoint test requires a forest node');
      const shrine = await query(
        `SELECT id
         FROM world_nodes
         WHERE node_type = 'shrine' AND zodiac_sign = 'aries'
         LIMIT 1`
      );
      assert.strictEqual(shrine.rowCount, 1, 'test world requires the Aries shrine');

      const olderShrine = await query(
        `SELECT id, zodiac_sign
         FROM world_nodes
         WHERE node_type = 'shrine'
           AND zodiac_sign IS NOT NULL
           AND zodiac_sign <> 'aries'
         ORDER BY id
         LIMIT 1`
      );
      assert.strictEqual(
        olderShrine.rowCount,
        1,
        'test world requires a second Zodiac shrine'
      );
      const olderAbility = {
        taurus: 'unmovable',
        gemini: 'twin_strike',
        cancer: 'moonshield',
        leo: 'roar',
        virgo: 'purify',
        libra: 'balance',
        scorpio: 'venom_sting',
        sagittarius: 'celestial_arrow',
        capricorn: 'mountains_endurance',
        aquarius: 'cascade',
        pisces: 'dreamwave'
      }[olderShrine.rows[0].zodiac_sign];
      assert.ok(olderAbility);
      await query(
        `INSERT INTO user_shrine_visits (
           user_id, node_id, buff_type, expires_at, last_visited_at,
           signature_ability, signature_used
         )
         VALUES ($1, $2, $3, NOW() + INTERVAL '4 hours',
                 NOW() - INTERVAL '1 minute', $4, false)
         ON CONFLICT (user_id, node_id) DO UPDATE SET
           buff_type = EXCLUDED.buff_type,
           expires_at = EXCLUDED.expires_at,
           last_visited_at = EXCLUDED.last_visited_at,
           signature_ability = EXCLUDED.signature_ability,
           signature_used = false`,
        [
          user.userId,
          olderShrine.rows[0].id,
          `zodiac_${olderShrine.rows[0].zodiac_sign}`,
          olderAbility
        ]
      );
      await query(
        `INSERT INTO user_shrine_visits (
           user_id, node_id, buff_type, expires_at, last_visited_at,
           signature_ability, signature_used
         )
         VALUES ($1, $2, 'zodiac_aries', NOW() + INTERVAL '4 hours',
                 NOW(), 'rams_charge', false)
         ON CONFLICT (user_id, node_id) DO UPDATE SET
           buff_type = EXCLUDED.buff_type,
           expires_at = EXCLUDED.expires_at,
           last_visited_at = EXCLUDED.last_visited_at,
           signature_ability = EXCLUDED.signature_ability,
           signature_used = false`,
        [user.userId, shrine.rows[0].id]
      );
      // Make the player deterministically win the first CT selection so the
      // route's active-character guard can be exercised without AI timing.
      await query(
        `UPDATE characters
         SET agility = 999, current_node_id = $1
         WHERE id = $2`,
        [battleNodeId, character.id]
      );

      const started = await request(
        'POST',
        '/api/battle/start',
        {
          battleMapCapabilities: supportedBattleMapCapabilities,
          formation: {
            [character.id]: { tileX: 2, tileY: 1 }
          }
        },
        accessToken
      );
      assert.strictEqual(started.status, 201, JSON.stringify(started.body));
      const battleId = started.body.battleId;
      const startedState = started.body.snapshot.mutableState;
      assert.strictEqual(
        String(startedState.activeUnitId),
        String(character.id)
      );
      const createdUnit = startedState.units.find(
        unit => String(unit.id) === String(character.id)
      );
      assert.deepStrictEqual(
        createdUnit.zodiacAbilities.map(ability => ability.key),
        ['rams_charge'],
        'an incomplete collection must expose only its newest blessing'
      );

      const beforeUse = await request(
        'GET',
        `/api/battle/${battleId}/zodiac-abilities/${character.id}`,
        null,
        accessToken
      );
      assert.strictEqual(beforeUse.status, 200, JSON.stringify(beforeUse.body));
      assert.deepStrictEqual(
        beforeUse.body.availableAbilities.map(ability => ({
          key: ability.key,
          needsTarget: ability.needsTarget
        })),
        [{ key: 'rams_charge', needsTarget: false }]
      );

      const command = {
        characterId: character.id,
        abilityKey: 'rams_charge',
        actionSequence: 1,
        commandId: `zodiac-replay-${battleId}`,
        stateRevision: started.body.stateRevision
      };
      const [activated, concurrentReplay] = await Promise.all([
        request(
          'POST',
          `/api/battle/${battleId}/zodiac-ability`,
          command,
          accessToken
        ),
        request(
          'POST',
          `/api/battle/${battleId}/zodiac-ability`,
          command,
          accessToken
        )
      ]);
      assert.strictEqual(activated.status, 200, JSON.stringify(activated.body));
      assert.strictEqual(
        concurrentReplay.status,
        200,
        JSON.stringify(concurrentReplay.body)
      );
      assert.deepStrictEqual(concurrentReplay.body, activated.body);
      assert.strictEqual(activated.body.abilityUsed, true);
      assert.strictEqual(activated.body.commandId, command.commandId);
      assert.ok(Number.isSafeInteger(activated.body.stateRevision));
      assert.ok(
        activated.body.availableActions,
        'free Zodiac commands must refresh participant action availability'
      );
      assert.strictEqual(
        activated.body.stateRevision,
        started.body.stateRevision + 1
      );
      const activeUnit = activated.body.state.units.find(
        unit => String(unit.id) === String(character.id)
      );
      assert.strictEqual(activeUnit.nextAttackCritBonus, 0.25);
      assert.strictEqual(activeUnit.moveUsed, false);
      assert.strictEqual(activeUnit.actUsed, false);
      assert.deepStrictEqual(activeUnit.usedZodiacAbilities, ['rams_charge']);

      const lostResponseRetry = await request(
        'POST',
        `/api/battle/${battleId}/zodiac-ability`,
        command,
        accessToken
      );
      assert.strictEqual(
        lostResponseRetry.status,
        200,
        JSON.stringify(lostResponseRetry.body)
      );
      assert.deepStrictEqual(lostResponseRetry.body, activated.body);

      const persisted = await query(
        `SELECT state_revision,
                (SELECT COUNT(*)::int
                 FROM battle_command_results
                 WHERE battle_id = $1 AND idempotency_key = $2) AS receipt_count
         FROM battles
         WHERE id = $1`,
        [battleId, `zodiac:${user.userId}:command:${command.commandId}`]
      );
      assert.strictEqual(
        Number(persisted.rows[0].state_revision),
        activated.body.stateRevision
      );
      assert.strictEqual(persisted.rows[0].receipt_count, 1);

      const afterUse = await request(
        'GET',
        `/api/battle/${battleId}/zodiac-abilities/${character.id}`,
        null,
        accessToken
      );
      assert.strictEqual(afterUse.status, 200, JSON.stringify(afterUse.body));
      assert.deepStrictEqual(afterUse.body.availableAbilities, []);
      assert.deepStrictEqual(afterUse.body.usedAbilities, ['rams_charge']);

      const reusedForDifferentIntent = await request(
        'POST',
        `/api/battle/${battleId}/zodiac-ability`,
        {
          ...command,
          targetUnitId: 'different-target'
        },
        accessToken
      );
      assert.strictEqual(reusedForDifferentIntent.status, 409);
      assert.strictEqual(
        reusedForDifferentIntent.body.code,
        'battle_command_id_conflict'
      );
      assert.strictEqual(
        reusedForDifferentIntent.body.stateRevision,
        activated.body.stateRevision
      );
      assert.ok(reusedForDifferentIntent.body.state);
      assert.ok(Object.hasOwn(
        reusedForDifferentIntent.body,
        'availableActions'
      ));

      const stale = await request(
        'POST',
        `/api/battle/${battleId}/zodiac-ability`,
        {
          ...command,
          commandId: `zodiac-stale-${battleId}`
        },
        accessToken
      );
      assert.strictEqual(stale.status, 409);
      assert.strictEqual(stale.body.code, 'battle_state_conflict');
      assert.strictEqual(
        stale.body.stateRevision,
        activated.body.stateRevision
      );

      const repeated = await request(
        'POST',
        `/api/battle/${battleId}/zodiac-ability`,
        {
          ...command,
          actionSequence: 2,
          commandId: `zodiac-repeat-${battleId}`,
          stateRevision: activated.body.stateRevision
        },
        accessToken
      );
      assert.strictEqual(repeated.status, 400);
      assert.match(repeated.body.error, /already been used/i);

      // Exercise replay safety around an actually random signature. Mutating
      // this battle snapshot keeps the test focused on the command boundary;
      // shrine entitlement selection was already asserted at creation above.
      const dreamwavePreparation = await query(
        'SELECT battle_state FROM battles WHERE id = $1',
        [battleId]
      );
      const dreamwaveState = structuredClone(
        dreamwavePreparation.rows[0].battle_state
      );
      const dreamwaveSource = dreamwaveState.units.find(
        unit => String(unit.id) === String(character.id)
      );
      const dreamwaveTarget = dreamwaveState.units.find(
        unit => unit.type === 'enemy' && unit.hp > 0
      );
      assert.ok(dreamwaveSource);
      assert.ok(dreamwaveTarget);
      dreamwaveSource.zodiacAbilities = [{ key: 'dreamwave' }];
      dreamwaveSource.usedZodiacAbilities = [];
      dreamwaveTarget.tileX = dreamwaveSource.tileX + 1;
      dreamwaveTarget.tileY = dreamwaveSource.tileY;
      dreamwaveState.activeUnitId = dreamwaveSource.id;
      dreamwaveState.activeUnitIndex = dreamwaveState.units.findIndex(
        unit => String(unit.id) === String(dreamwaveSource.id)
      );
      const preparedDreamwave = await query(
        `UPDATE battles
         SET battle_state = $1, state_revision = state_revision + 1
         WHERE id = $2
         RETURNING state_revision`,
        [JSON.stringify(dreamwaveState), battleId]
      );
      const dreamwaveCommand = {
        characterId: character.id,
        abilityKey: 'dreamwave',
        targetUnitId: dreamwaveTarget.id,
        actionSequence: 3,
        commandId: `zodiac-dreamwave-${battleId}`,
        stateRevision: Number(preparedDreamwave.rows[0].state_revision)
      };
      const [dreamwaveFirst, dreamwaveReplay] = await Promise.all([
        request(
          'POST',
          `/api/battle/${battleId}/zodiac-ability`,
          dreamwaveCommand,
          accessToken
        ),
        request(
          'POST',
          `/api/battle/${battleId}/zodiac-ability`,
          dreamwaveCommand,
          accessToken
        )
      ]);
      assert.strictEqual(
        dreamwaveFirst.status,
        200,
        JSON.stringify(dreamwaveFirst.body)
      );
      assert.strictEqual(
        dreamwaveReplay.status,
        200,
        JSON.stringify(dreamwaveReplay.body)
      );
      assert.deepStrictEqual(
        dreamwaveReplay.body,
        dreamwaveFirst.body,
        'a concurrent retry must replay the original random outcome'
      );
      assert.strictEqual(
        dreamwaveFirst.body.stateRevision,
        dreamwaveCommand.stateRevision + 1
      );
      const dreamwaveReceipt = await query(
        `SELECT COUNT(*)::int AS receipt_count
         FROM battle_command_results
         WHERE battle_id = $1 AND idempotency_key = $2`,
        [
          battleId,
          `zodiac:${user.userId}:command:${dreamwaveCommand.commandId}`
        ]
      );
      assert.strictEqual(dreamwaveReceipt.rows[0].receipt_count, 1);

      // A free range signature must refresh normal action targeting from the
      // same committed state, and an exact retry must preserve it verbatim.
      const celestialPreparation = await query(
        'SELECT battle_state FROM battles WHERE id = $1',
        [battleId]
      );
      const celestialState = structuredClone(
        celestialPreparation.rows[0].battle_state
      );
      const celestialSource = celestialState.units.find(
        unit => String(unit.id) === String(character.id)
      );
      assert.ok(celestialSource);
      celestialSource.zodiacAbilities = [{ key: 'celestial_arrow' }];
      celestialSource.usedZodiacAbilities = [];
      celestialSource.nextAttackRangeBonus = 0;
      celestialState.activeUnitId = celestialSource.id;
      celestialState.activeUnitIndex = celestialState.units.findIndex(
        unit => String(unit.id) === String(celestialSource.id)
      );
      const baseAttackRange = Number(celestialSource.attackRange) || 1;
      const preparedCelestial = await query(
        `UPDATE battles
         SET battle_state = $1, state_revision = state_revision + 1
         WHERE id = $2
         RETURNING state_revision`,
        [JSON.stringify(celestialState), battleId]
      );
      const celestialCommand = {
        characterId: character.id,
        abilityKey: 'celestial_arrow',
        actionSequence: 4,
        commandId: `zodiac-celestial-${battleId}`,
        stateRevision: Number(preparedCelestial.rows[0].state_revision)
      };
      const celestialFirst = await request(
        'POST',
        `/api/battle/${battleId}/zodiac-ability`,
        celestialCommand,
        accessToken
      );
      const celestialReplay = await request(
        'POST',
        `/api/battle/${battleId}/zodiac-ability`,
        celestialCommand,
        accessToken
      );
      assert.strictEqual(
        celestialFirst.status,
        200,
        JSON.stringify(celestialFirst.body)
      );
      assert.strictEqual(
        celestialReplay.status,
        200,
        JSON.stringify(celestialReplay.body)
      );
      assert.strictEqual(
        celestialFirst.body.availableActions.attacks.range,
        baseAttackRange + 2
      );
      assert.deepStrictEqual(celestialReplay.body, celestialFirst.body);
    });
  });
});
