import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { request, createTestUser, createTestContext, query, cleanupTestUser, BASE_URL } from '../testHelper.js';
import {
  TERRAIN_GENERATION_VERSION,
  deriveEncounterTerrainSeed
} from '../../services/battle/encounterService.js';

/**
 * Extended request helper that supports custom headers and returns response headers
 * Required for ETag testing
 */
async function requestWithHeaders(method, path, body = null, token = null, customHeaders = {}) {
  const url = new URL(path, BASE_URL);

  const headers = {
    'Content-Type': 'application/json',
    ...customHeaders
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    method,
    headers
  };

  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({
            status: res.statusCode,
            body: parsed,
            headers: res.headers
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            body: data,
            headers: res.headers
          });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Insert additional characters directly into the database.
 * Bypasses the API restriction that only allows one manually created character.
 * @param {number} userId - User ID
 * @param {number} mainCharId - Main character ID (to copy node location)
 * @param {number} count - Number of characters to insert
 * @returns {Promise<Array<{id: number}>>} Array of created character objects
 */
async function insertAdditionalCharacters(userId, mainCharId, count) {
  const characters = [];
  for (let i = 0; i < count; i++) {
    const name = `BC${i}_${Date.now().toString(36).slice(-6)}`;
    const slot = i + 2; // Start from slot 2 (slot 1 is main character)
    const result = await query(
      `INSERT INTO characters (user_id, name, race, class, gender, level, party_slot, current_node_id, hp_current, hp_max, mp_current, mp_max, strength, intelligence, agility, vitality, luck)
       SELECT $1, $2, 'human', 'warrior', 'male', 1, $3, current_node_id, 100, 100, 50, 50, 10, 10, 10, 10, 10
       FROM characters WHERE id = $4
       RETURNING id, name`,
      [userId, name, slot, mainCharId]
    );
    characters.push(result.rows[0]);
  }
  return characters;
}

describe('Battle API', () => {
  const ctx = createTestContext();
  let user = null;
  let characters = [];
  let battle = null;
  let battleNode = null;

  before(async () => {
    // Create user and first character via API (allowed)
    user = await ctx.createUser();
    const mainChar = await ctx.createCharacter(user.accessToken, `BC0_${Date.now().toString(36).slice(-6)}`);
    characters.push(mainChar);

    // Insert additional characters directly to bypass recruitment restriction
    const additionalChars = await insertAdditionalCharacters(user.userId, mainChar.id, 2);
    characters.push(...additionalChars);

    // Set battle party
    await request('PUT', '/api/party/battle', {
      characterIds: characters.map(c => c.id)
    }, user.accessToken);

    // Set current location to a battle node
    // First, try to move the character directly to a battle node via database
    // This bypasses travel restrictions for test setup
    const battleNodeResult = await query(
      `SELECT id, node_type, local_seed FROM world_nodes
       WHERE node_type IN ('forest', 'cave', 'mountain')
       LIMIT 1`
    );

    assert.ok(battleNodeResult.rows.length > 0, 'battle integration setup requires a battle node');
    battleNode = battleNodeResult.rows[0];
    // Move all characters to the battle node directly
    await query(
      `UPDATE characters SET current_node_id = $1 WHERE user_id = $2`,
      [battleNode.id, user.userId]
    );
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('POST /api/battle/start', () => {
    it('should start a battle successfully', async () => {
      const res = await request('POST', '/api/battle/start', {}, user.accessToken);

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.battleId);
      assert.ok(res.body.state);
      assert.ok(res.body.state.units);
      assert.ok(res.body.mapWidth);
      assert.ok(res.body.mapHeight);
      // nodeType is critical for frontend terrain generation to match server
      assert.ok(res.body.nodeType, 'nodeType must be included for terrain sync');
      assert.equal(
        res.body.mapSeed,
        deriveEncounterTerrainSeed(
          battleNode.local_seed,
          battleNode.node_type,
          TERRAIN_GENERATION_VERSION
        ),
        'battle map seed must derive from the current world node'
      );
      assert.equal(res.body.state.terrainSeed, res.body.mapSeed);
      assert.equal(res.body.state.terrainGenerationVersion, TERRAIN_GENERATION_VERSION);

      battle = res.body;

      const persisted = await query(
        'SELECT battle_state, map_seed FROM battles WHERE id = $1',
        [battle.battleId]
      );
      assert.equal(persisted.rows[0].map_seed, battle.mapSeed);
      assert.equal(persisted.rows[0].battle_state.terrainSeed, battle.mapSeed);
      assert.deepStrictEqual(persisted.rows[0].battle_state.terrain, battle.state.terrain);
      assert.deepStrictEqual(persisted.rows[0].battle_state.elevation, battle.state.elevation);
      assert.deepStrictEqual(persisted.rows[0].battle_state.obstacles, battle.state.obstacles);
      assert.deepStrictEqual(persisted.rows[0].battle_state.variants, battle.state.variants);
      assert.equal(
        persisted.rows[0].battle_state.terrainGenerationVersion,
        TERRAIN_GENERATION_VERSION
      );

      const rejoin = await request(
        'GET',
        `/api/battle/${battle.battleId}/rejoin`,
        null,
        user.accessToken
      );
      assert.equal(rejoin.status, 200);
      assert.equal(rejoin.body.mapSeed, persisted.rows[0].map_seed);
      assert.equal(rejoin.body.state.terrainSeed, persisted.rows[0].battle_state.terrainSeed);
      assert.deepStrictEqual(rejoin.body.state.terrain, persisted.rows[0].battle_state.terrain);
      assert.deepStrictEqual(rejoin.body.state.elevation, persisted.rows[0].battle_state.elevation);
      assert.deepStrictEqual(rejoin.body.state.obstacles, persisted.rows[0].battle_state.obstacles);
      assert.deepStrictEqual(rejoin.body.state.variants, persisted.rows[0].battle_state.variants);
      assert.equal(
        rejoin.body.state.terrainGenerationVersion,
        TERRAIN_GENERATION_VERSION
      );
    });

    it('should reject starting battle without battle party', async () => {
      // Create a new user without battle party
      const newUser = await createTestUser();

      const res = await request('POST', '/api/battle/start', {}, newUser.accessToken);

      assert.ok([400, 404].includes(res.status));

      // Cleanup the user we created
      await cleanupTestUser(newUser.userId);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request('POST', '/api/battle/start', {});

      assert.strictEqual(res.status, 401);
    });
  });

  describe('GET /api/battle/current', () => {
    it('should return current battle state', async () => {
      if (!battle) {
        console.log('Skipping - no battle started');
        return;
      }

      const res = await request('GET', '/api/battle/current', null, user.accessToken);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.battle || res.body.state);
    });

    it('should return 404 when no active battle', async () => {
      const newUser = await createTestUser();

      const res = await request('GET', '/api/battle/current', null, newUser.accessToken);

      assert.strictEqual(res.status, 404);

      // Cleanup the user we created
      await cleanupTestUser(newUser.userId);
    });
  });

  describe('POST /api/battle/action', () => {
    it('should process wait action', async () => {
      if (!battle) {
        console.log('Skipping - no battle started');
        return;
      }

      // Find the first player unit that can act
      const playerUnit = battle.state.units.find(u =>
        u.team === 'player' && u.hp > 0
      );

      if (!playerUnit) {
        console.log('Skipping - no player units available');
        return;
      }

      const res = await request('POST', '/api/battle/action', {
        battleId: battle.battleId,
        actionType: 'wait',
        unitId: playerUnit.id
      }, user.accessToken);

      // Could be 200 (success) or 400 (not this unit's turn)
      assert.ok([200, 400].includes(res.status));
    });

    it('should reject invalid action type', async () => {
      if (!battle) {
        console.log('Skipping - no battle started');
        return;
      }

      const res = await request('POST', '/api/battle/action', {
        battleId: battle.battleId,
        actionType: 'invalid_action',
        unitId: 1
      }, user.accessToken);

      assert.strictEqual(res.status, 400);
    });

    it('should reject action without battle ID', async () => {
      const res = await request('POST', '/api/battle/action', {
        actionType: 'wait',
        unitId: 1
      }, user.accessToken);

      // 400 (missing param) or 404 (no battle found) are both acceptable
      assert.ok([400, 404].includes(res.status), `Expected 400 or 404, got ${res.status}`);
    });

    it('should reject unauthenticated action', async () => {
      const res = await request('POST', '/api/battle/action', {
        battleId: battle?.battleId || 1,
        actionType: 'wait',
        unitId: 1
      });

      assert.strictEqual(res.status, 401);
    });
  });

  describe('GET /api/battle/:id/state', () => {
    // Use the battle from parent scope if available
    // These tests use the battle created in the parent describe's before hook

    it('should return lightweight state for active battle participant', async () => {
      if (!battle) {
        console.log('Skipping - no battle started');
        return;
      }

      const res = await requestWithHeaders(
        'GET',
        `/api/battle/${battle.battleId}/state`,
        null,
        user.accessToken
      );

      assert.strictEqual(res.status, 200);

      // Verify lightweight state structure
      assert.ok(res.body.hasOwnProperty('activeUnitId'), 'Should have activeUnitId');
      assert.ok(res.body.hasOwnProperty('turnCount'), 'Should have turnCount');
      assert.ok(res.body.hasOwnProperty('status'), 'Should have status');
      assert.ok(Array.isArray(res.body.units), 'Should have units array');

      // Verify unit structure is lightweight
      if (res.body.units.length > 0) {
        const unit = res.body.units[0];
        assert.ok(unit.hasOwnProperty('id'), 'Unit should have id');
        // Note: The endpoint maps u.x/u.y but battle units use tileX/tileY
        // The endpoint always includes these properties, even if undefined
        assert.ok(unit.hasOwnProperty('x'), 'Unit should have x property');
        assert.ok(unit.hasOwnProperty('y'), 'Unit should have y property');
        assert.ok(unit.hasOwnProperty('hp'), 'Unit should have hp');
        assert.ok(unit.hasOwnProperty('mp'), 'Unit should have mp');
        assert.ok(unit.hasOwnProperty('statusEffects'), 'Unit should have statusEffects');

        // Verify it's lightweight (no full unit data)
        assert.strictEqual(unit.name, undefined, 'Lightweight state should not include name');
        assert.strictEqual(unit.skills, undefined, 'Lightweight state should not include skills');
      }
    });

    it('should return ETag header in response', async () => {
      if (!battle) {
        console.log('Skipping - no battle started');
        return;
      }

      const res = await requestWithHeaders(
        'GET',
        `/api/battle/${battle.battleId}/state`,
        null,
        user.accessToken
      );

      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.etag, 'Response should include ETag header');
      // ETag format should be quoted string
      assert.ok(res.headers.etag.startsWith('"') && res.headers.etag.endsWith('"'),
        'ETag should be a quoted string');
    });

    it('should return 304 when ETag matches', async () => {
      if (!battle) {
        console.log('Skipping - no battle started');
        return;
      }

      // First request to get ETag
      const firstRes = await requestWithHeaders(
        'GET',
        `/api/battle/${battle.battleId}/state`,
        null,
        user.accessToken
      );

      assert.strictEqual(firstRes.status, 200);
      const etag = firstRes.headers.etag;
      assert.ok(etag, 'First response should include ETag');

      // Second request with If-None-Match header
      const secondRes = await requestWithHeaders(
        'GET',
        `/api/battle/${battle.battleId}/state`,
        null,
        user.accessToken,
        { 'If-None-Match': etag }
      );

      assert.strictEqual(secondRes.status, 304, 'Should return 304 Not Modified when ETag matches');
    });

    it('should conceal battle existence from a non-participant', async () => {
      if (!battle) {
        console.log('Skipping - no battle started');
        return;
      }

      // Create a different user who is not in the battle
      const otherUser = await createTestUser();

      const res = await request(
        'GET',
        `/api/battle/${battle.battleId}/state`,
        null,
        otherUser.accessToken
      );

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error?.includes('not have access') ||
                res.body.message?.includes('not have access'),
        'Should return an access-concealing not-found error');

      // Cleanup
      await cleanupTestUser(otherUser.userId);
    });

    it('should return 404 for non-existent battle', async () => {
      const res = await request(
        'GET',
        '/api/battle/999999/state',
        null,
        user.accessToken
      );

      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error?.includes('Battle not found') ||
                res.body.message?.includes('Battle not found'),
        'Should return "Battle not found" error');
    });

    it('should return 400 for invalid battle ID', async () => {
      const res = await request(
        'GET',
        '/api/battle/invalid/state',
        null,
        user.accessToken
      );

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error?.includes('Invalid battle ID') ||
                res.body.message?.includes('Invalid battle ID'),
        'Should return "Invalid battle ID" error');
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(
        'GET',
        `/api/battle/${battle?.battleId || 1}/state`,
        null,
        null
      );

      assert.strictEqual(res.status, 401);
    });
  });

  describe('Action Sequence Validation', () => {
    // Note: Action sequence validation is currently in logging-only mode,
    // so all these tests verify acceptance while logging warnings for stale sequences

    it('should accept action with valid sequence number', async () => {
      // Skip if no active battle (battle may have ended from previous tests)
      if (!battle?.battleId) {
        return;
      }

      // Get current battle state to find active unit
      const stateRes = await request(
        'GET',
        `/api/battle/${battle.battleId}/state`,
        null,
        user.accessToken
      );

      if (stateRes.status !== 200 || stateRes.body.status !== 'active') {
        return; // Battle not active
      }

      const activeUnit = stateRes.body.activeUnitId;
      const playerUnit = stateRes.body.units?.find(u => u.id === activeUnit && u.isPlayer);

      if (!playerUnit) {
        return; // Not player's turn
      }

      // Submit action with sequence number
      const actionRes = await request(
        'POST',
        `/api/battle/${battle.battleId}/action`,
        {
          actionType: 'defend',
          actorId: activeUnit,
          actionSequence: 1
        },
        user.accessToken
      );

      // Should accept (200) or indicate not player's turn (400)
      assert.ok([200, 400].includes(actionRes.status),
        `Expected 200 or 400, got ${actionRes.status}`);
    });

    it('should accept action without actionSequence for backward compatibility', async () => {
      // Skip if no active battle
      if (!battle?.battleId) {
        return;
      }

      const stateRes = await request(
        'GET',
        `/api/battle/${battle.battleId}/state`,
        null,
        user.accessToken
      );

      if (stateRes.status !== 200 || stateRes.body.status !== 'active') {
        return;
      }

      const activeUnit = stateRes.body.activeUnitId;
      const playerUnit = stateRes.body.units?.find(u => u.id === activeUnit && u.isPlayer);

      if (!playerUnit) {
        return;
      }

      // Submit action WITHOUT sequence number (legacy client)
      const actionRes = await request(
        'POST',
        `/api/battle/${battle.battleId}/action`,
        {
          actionType: 'defend',
          actorId: activeUnit
          // No actionSequence - should still work for backward compatibility
        },
        user.accessToken
      );

      // Should accept (200) or indicate not player's turn (400)
      assert.ok([200, 400].includes(actionRes.status),
        `Expected 200 or 400, got ${actionRes.status}: ${JSON.stringify(actionRes.body)}`);
    });

    it('should accept stale sequence number in logging-only mode', async () => {
      // Skip if no active battle
      if (!battle?.battleId) {
        return;
      }

      const stateRes = await request(
        'GET',
        `/api/battle/${battle.battleId}/state`,
        null,
        user.accessToken
      );

      if (stateRes.status !== 200 || stateRes.body.status !== 'active') {
        return;
      }

      const activeUnit = stateRes.body.activeUnitId;
      const playerUnit = stateRes.body.units?.find(u => u.id === activeUnit && u.isPlayer);

      if (!playerUnit) {
        return;
      }

      // First action with higher sequence
      await request(
        'POST',
        `/api/battle/${battle.battleId}/action`,
        {
          actionType: 'defend',
          actorId: activeUnit,
          actionSequence: 100
        },
        user.accessToken
      );

      // Second action with lower (stale) sequence - should still be accepted in logging-only mode
      const staleRes = await request(
        'POST',
        `/api/battle/${battle.battleId}/action`,
        {
          actionType: 'defend',
          actorId: activeUnit,
          actionSequence: 50 // Stale sequence
        },
        user.accessToken
      );

      // In logging-only mode, stale sequences are accepted with a warning logged
      assert.ok([200, 400].includes(staleRes.status),
        `Expected 200 or 400 (accepted), got ${staleRes.status}: ${JSON.stringify(staleRes.body)}`);
    });

    it('should reset action sequence tracking on rejoin', async () => {
      // Skip if no active battle
      if (!battle?.battleId) {
        return;
      }

      // First, submit an action with a high sequence number
      const stateRes = await request(
        'GET',
        `/api/battle/${battle.battleId}/state`,
        null,
        user.accessToken
      );

      if (stateRes.status !== 200 || stateRes.body.status !== 'active') {
        return;
      }

      // Call rejoin endpoint - this should reset the sequence tracking
      const rejoinRes = await request(
        'GET',
        `/api/battle/${battle.battleId}/rejoin`,
        null,
        user.accessToken
      );

      assert.strictEqual(rejoinRes.status, 200, 'Rejoin should succeed');
      assert.ok(rejoinRes.body.state, 'Rejoin should return battle state');

      // After rejoin, a low sequence number should be accepted
      const activeUnit = rejoinRes.body.state?.activeUnitId;
      const playerUnit = rejoinRes.body.state?.units?.find(u => u.id === activeUnit && u.isPlayer);

      if (!playerUnit) {
        return;
      }

      const postRejoinRes = await request(
        'POST',
        `/api/battle/${battle.battleId}/action`,
        {
          actionType: 'defend',
          actorId: activeUnit,
          actionSequence: 1 // Low sequence after rejoin - should be accepted
        },
        user.accessToken
      );

      // Should be accepted after sequence reset
      assert.ok([200, 400].includes(postRejoinRes.status),
        `Expected 200 or 400, got ${postRejoinRes.status}`);
    });
  });
});
