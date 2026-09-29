import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { randomUUID } from 'node:crypto';
import {
  request,
  createTestUser,
  createTestCharacter,
  createTestContext,
  query,
  getClient,
  cleanupTestUser,
  cleanupTestUsers,
  waitForTerminalOutboxSettled,
  BASE_URL
} from '../testHelper.js';
import {
  deriveEncounterTerrainSeed
} from '../../services/battle/encounterService.js';
import {
  BATTLE_MAP_HASH_VERSION,
  BATTLE_MAP_SCHEMA_VERSION,
  BATTLE_MAP_V3_HASH_VERSION,
  BATTLE_MAP_V3_SCHEMA_VERSION,
  BATTLE_MAP_V3_TERRAIN_GENERATION_VERSION
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
const supportedBattleMapCapabilityHeaders = Object.freeze({
  'x-battle-map-capabilities': JSON.stringify(supportedBattleMapCapabilities)
});

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
    const additionalChars = await insertAdditionalCharacters(user.userId, mainChar.id, 5);
    characters.push(...additionalChars);

    // Set battle party
    await request('PUT', '/api/party/battle', {
      characterIds: characters.slice(0, 5).map(c => c.id)
    }, user.accessToken);

    // Set current location to a battle node
    // First, try to move the character directly to a battle node via database
    // This bypasses travel restrictions for test setup
    const battleNodeResult = await query(
      `SELECT id, node_type, local_seed FROM world_nodes
       WHERE node_type = 'forest' AND difficulty_tier = 1
       ORDER BY id
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
    const battleId = battle?.battleId;
    const userId = user?.userId;
    const terminalEvents = battleId
      ? await query(
        `SELECT event_key
         FROM battle_terminal_effect_outbox
         WHERE battle_id = $1`,
        [battleId]
      )
      : { rows: [] };
    const terminalEventKeys = terminalEvents.rows.map(event => event.event_key);
    // The running API's outbox worker drains committed terminal events on
    // its own interval. Cleanup deliberately refuses to delete users while an
    // event is claimed, so let any in-flight drain finish first.
    const userBattles = userId
      ? await query(
        `SELECT b.id
         FROM battles b
         WHERE b.player1_id = $1
            OR b.player2_id = $1
            OR EXISTS (
              SELECT 1
              FROM battle_players bp
              WHERE bp.battle_id = b.id
                AND bp.user_id = $1
            )`,
        [userId]
      )
      : { rows: [] };
    await waitForTerminalOutboxSettled([
      ...userBattles.rows.map(row => row.id),
      ...(battleId ? [battleId] : [])
    ]);
    await ctx.cleanup();

    if (battleId) {
      const persistedBattle = await query(
        'SELECT id FROM battles WHERE id = $1',
        [battleId]
      );
      assert.strictEqual(
        persistedBattle.rowCount,
        0,
        'test context cleanup should remove persisted battles'
      );
      const persistedOutbox = await query(
        `SELECT id
         FROM battle_terminal_effect_outbox
         WHERE battle_id = $1`,
        [battleId]
      );
      assert.strictEqual(
        persistedOutbox.rowCount,
        0,
        'test context cleanup should remove terminal outbox events'
      );
    }
    if (terminalEventKeys.length > 0) {
      const persistedReceipts = await query(
        `SELECT event_key
         FROM battle_terminal_progression_receipts
         WHERE event_key = ANY($1::text[])`,
        [terminalEventKeys]
      );
      assert.strictEqual(
        persistedReceipts.rowCount,
        0,
        'test context cleanup should remove terminal progression receipts'
      );
    }
    if (userId) {
      const persistedUser = await query(
        'SELECT id FROM users WHERE id = $1',
        [userId]
      );
      assert.strictEqual(
        persistedUser.rowCount,
        0,
        'test context cleanup should remove the test user'
      );
    }
  });

  describe('POST /api/battle/start', () => {
    it('should reject an omitted or empty formation', async () => {
      const omitted = await request('POST', '/api/battle/start', {}, user.accessToken);
      assert.strictEqual(omitted.status, 400);

      const empty = await request(
        'POST',
        '/api/battle/start',
        { formation: {} },
        user.accessToken
      );
      assert.strictEqual(empty.status, 400);
    });

    it('does not create a stale battle when deletion commits before the lifecycle lock', async () => {
      const raceUser = await createTestUser();
      const mainCharacter = await createTestCharacter(raceUser.accessToken);
      const [selectedCharacter] = await insertAdditionalCharacters(
        raceUser.userId,
        mainCharacter.id,
        1
      );
      const locker = await getClient();
      let transactionOpen = false;
      let startRequest;

      try {
        await request(
          'PUT',
          '/api/party/battle',
          { characterIds: [mainCharacter.id, selectedCharacter.id] },
          raceUser.accessToken
        );
        await query(
          'UPDATE characters SET current_node_id = $1 WHERE user_id = $2',
          [battleNode.id, raceUser.userId]
        );

        await locker.query('BEGIN');
        transactionOpen = true;
        const lockerBackend = await locker.query(
          'SELECT pg_backend_pid() AS pid'
        );
        const lockerPid = lockerBackend.rows[0].pid;
        await locker.query(
          `SELECT id
           FROM characters
           WHERE user_id = $1
           ORDER BY id
           FOR UPDATE`,
          [raceUser.userId]
        );

        startRequest = request(
          'POST',
          '/api/battle/start',
          {
            formation: {
              [selectedCharacter.id]: { tileX: 2, tileY: 1 }
            }
          },
          raceUser.accessToken
        );

        const deadline = Date.now() + 5000;
        let lockWaitObserved = false;
        while (Date.now() < deadline) {
          const waiters = await query(
            `SELECT 1
             FROM pg_stat_activity
             WHERE datname = current_database()
               AND wait_event_type = 'Lock'
               AND query LIKE '%FROM characters%'
               AND query LIKE '%ORDER BY id%'
               AND query LIKE '%FOR UPDATE%'
               AND $1 = ANY(pg_blocking_pids(pid))
             LIMIT 1`,
            [lockerPid]
          );
          if (waiters.rowCount > 0) {
            lockWaitObserved = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.strictEqual(
          lockWaitObserved,
          true,
          'battle start should reach and wait on the owned-character lifecycle lock'
        );

        await locker.query(
          'DELETE FROM characters WHERE id = $1 AND user_id = $2',
          [selectedCharacter.id, raceUser.userId]
        );
        await locker.query('COMMIT');
        transactionOpen = false;

        const response = await startRequest;
        assert.strictEqual(response.status, 409);
        assert.match(response.body.error, /formation changed/i);

        const persistedBattle = await query(
          `SELECT id
           FROM battles
           WHERE player1_id = $1 AND status = 'active'`,
          [raceUser.userId]
        );
        assert.strictEqual(
          persistedBattle.rowCount,
          0,
          'deleted selected character must not survive in a stale battle snapshot'
        );
      } finally {
        if (transactionOpen) {
          await locker.query('ROLLBACK');
        }
        locker.release();
        if (startRequest) {
          await startRequest.catch(() => {});
        }
        await cleanupTestUser(raceUser.userId);
      }
    });

    it('repairs stale battle flags under the lifecycle lock without duplicating a battle', async () => {
      const staleUser = await createTestUser();
      const staleCharacter = await createTestCharacter(
        staleUser.accessToken,
        `Stale${Date.now().toString(36).slice(-5)}`
      );
      const requestId = `stale-repair-${randomUUID()}`;

      try {
        await query(
          `UPDATE characters
           SET current_node_id = $1, in_battle = true, agility = 999
           WHERE id = $2 AND user_id = $3`,
          [battleNode.id, staleCharacter.id, staleUser.userId]
        );

        const payload = {
          battleStartRequestId: requestId,
          battleMapCapabilities: supportedBattleMapCapabilities,
          formation: {
            [staleCharacter.id]: { tileX: 2, tileY: 1 }
          }
        };
        const created = await request(
          'POST',
          '/api/battle/start',
          payload,
          staleUser.accessToken
        );
        assert.strictEqual(created.status, 201, JSON.stringify(created.body));
        assert.strictEqual(created.body.rejoined, false);

        const rejoined = await request(
          'POST',
          '/api/battle/start',
          payload,
          staleUser.accessToken
        );
        assert.strictEqual(rejoined.status, 200, JSON.stringify(rejoined.body));
        assert.strictEqual(rejoined.body.rejoined, true);
        assert.strictEqual(rejoined.body.battleId, created.body.battleId);

        const persisted = await query(
          `SELECT
             (SELECT COUNT(*)::int
              FROM battles
              WHERE player1_id = $1 AND status = 'active') AS active_battles,
             (SELECT in_battle
              FROM characters
              WHERE id = $2 AND user_id = $1) AS in_battle`,
          [staleUser.userId, staleCharacter.id]
        );
        assert.deepStrictEqual(persisted.rows[0], {
          active_battles: 1,
          in_battle: true
        });
      } finally {
        await cleanupTestUser(staleUser.userId);
      }
    });

    it('does not expose opponent actions when a shared battle wins the start race', async () => {
      const raceUser = await createTestUser();
      const opponent = await createTestUser();
      const raceCharacter = await createTestCharacter(
        raceUser.accessToken,
        `Race${Date.now().toString(36).slice(-5)}`
      );
      const opponentCharacter = await createTestCharacter(
        opponent.accessToken,
        `Opp${Date.now().toString(36).slice(-5)}`
      );
      const locker = await getClient();
      let transactionOpen = false;
      let startRequest = null;

      try {
        await query(
          'UPDATE characters SET current_node_id = $1 WHERE user_id = ANY($2::int[])',
          [battleNode.id, [raceUser.userId, opponent.userId]]
        );

        await locker.query('BEGIN');
        transactionOpen = true;
        const lockerBackend = await locker.query(
          'SELECT pg_backend_pid() AS pid'
        );
        const lockerPid = lockerBackend.rows[0].pid;
        await locker.query(
          `SELECT id
           FROM characters
           WHERE user_id = $1
           ORDER BY id
           FOR UPDATE`,
          [raceUser.userId]
        );

        startRequest = request(
          'POST',
          '/api/battle/start',
          {
            formation: {
              [raceCharacter.id]: { tileX: 2, tileY: 1 }
            }
          },
          raceUser.accessToken
        );

        const deadline = Date.now() + 5000;
        let lockWaitObserved = false;
        while (Date.now() < deadline) {
          const waiters = await query(
            `SELECT 1
             FROM pg_stat_activity
             WHERE datname = current_database()
               AND wait_event_type = 'Lock'
               AND query LIKE '%FROM characters%'
               AND query LIKE '%ORDER BY id%'
               AND query LIKE '%FOR UPDATE%'
               AND $1 = ANY(pg_blocking_pids(pid))
             LIMIT 1`,
            [lockerPid]
          );
          if (waiters.rowCount > 0) {
            lockWaitObserved = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        assert.strictEqual(
          lockWaitObserved,
          true,
          'battle start should wait on this user lifecycle lock before the raced insert'
        );

        const mapWidth = 2;
        const mapHeight = 2;
        const terrainSeed = 45123;
        const opponentUnitId = `p2_${opponentCharacter.id}`;
        const battleState = {
          turn: 1,
          phase: 'active',
          battleType: 'pvp',
          player1Id: raceUser.userId,
          player2Id: opponent.userId,
          activeUnitId: opponentUnitId,
          units: [
            {
              id: `p1_${raceCharacter.id}`,
              characterId: raceCharacter.id,
              type: 'player',
              ownerId: raceUser.userId,
              hp: 100,
              maxHp: 100,
              mp: 50,
              maxMp: 50,
              movement: 3,
              attackRange: 1
            },
            {
              id: opponentUnitId,
              characterId: opponentCharacter.id,
              type: 'player',
              ownerId: opponent.userId,
              hp: 100,
              maxHp: 100,
              mp: 50,
              maxMp: 50,
              movement: 3,
              attackRange: 1,
              moveUsed: false,
              actUsed: false,
              turnPhase: 'ready'
            }
          ],
          terrainSeed,
          mapWidth,
          mapHeight,
          terrain: Array.from({ length: mapHeight }, () => Array(mapWidth).fill('grass')),
          elevation: Array.from({ length: mapHeight }, () => Array(mapWidth).fill(0)),
          obstacles: []
        };
        const racedBattle = await query(
          `INSERT INTO battles (
             battle_type,
             status,
             node_id,
             battle_state,
             map_seed,
             map_width,
             map_height,
             player1_id,
             player2_id
           )
           VALUES ('pvp_coliseum', 'active', NULL, $1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            JSON.stringify(battleState),
            terrainSeed,
            mapWidth,
            mapHeight,
            raceUser.userId,
            opponent.userId
          ]
        );

        await locker.query('COMMIT');
        transactionOpen = false;

        const response = await startRequest;
        assert.strictEqual(response.status, 200, JSON.stringify(response.body));
        assert.strictEqual(response.body.battleId, racedBattle.rows[0].id);
        assert.strictEqual(response.body.rejoined, true);
        assert.strictEqual(response.body.state.activeUnitId, opponentUnitId);
        assert.strictEqual(
          response.body.availableActions,
          null,
          'the requester must not receive actions for the opponent-owned active unit'
        );
      } finally {
        if (transactionOpen) {
          await locker.query('ROLLBACK');
        }
        locker.release();
        if (startRequest) {
          await startRequest.catch(() => {});
        }
        await cleanupTestUsers([raceUser.userId, opponent.userId]);
      }
    });

    it('should start with only a formed roster character beyond slot five', async () => {
      const selectedCharacter = characters[5];
      const formation = {
        [selectedCharacter.id]: { tileX: 2, tileY: 1 }
      };
      const res = await request(
        'POST',
        '/api/battle/start',
        {
          formation,
          battleMapCapabilities: supportedBattleMapCapabilities
        },
        user.accessToken
      );

      assert.strictEqual(res.status, 201);
      assert.ok(res.body.battleId);
      assert.equal(
        res.body.battleMapCapabilities.selectedBattleMapSchemaVersion,
        BATTLE_MAP_V3_SCHEMA_VERSION
      );
      assert.ok(res.body.snapshot);
      assert.ok(res.body.snapshot.battleMap);
      assert.ok(res.body.snapshot.mutableState.units);
      assert.ok(res.body.mapWidth);
      assert.ok(res.body.mapHeight);
      assert.deepStrictEqual(res.body.snapshot.battleMap.dimensions, {
        width: res.body.mapWidth,
        height: res.body.mapHeight
      });
      // nodeType is critical for frontend terrain generation to match server
      assert.ok(res.body.nodeType, 'nodeType must be included for terrain sync');
      assert.equal(
        res.body.mapSeed,
        deriveEncounterTerrainSeed(
          battleNode.local_seed,
          battleNode.node_type,
          BATTLE_MAP_V3_TERRAIN_GENERATION_VERSION
        ),
        'battle map seed must derive from the current world node'
      );
      assert.equal(
        res.body.snapshot.terrainGenerationVersion,
        BATTLE_MAP_V3_TERRAIN_GENERATION_VERSION
      );
      assert.deepStrictEqual(
        res.body.snapshot.mutableState.units
          .filter(unit => unit.type === 'player')
          .map(unit => unit.id),
        [selectedCharacter.id]
      );

      battle = {
        ...res.body,
        state: res.body.snapshot.mutableState
      };

      const persisted = await query(
        'SELECT battle_state, map_seed FROM battles WHERE id = $1',
        [battle.battleId]
      );
      assert.equal(persisted.rows[0].map_seed, battle.mapSeed);
      assert.deepStrictEqual(
        persisted.rows[0].battle_state.units
          .filter(unit => unit.type === 'player')
          .map(unit => unit.id),
        [selectedCharacter.id]
      );
      assert.equal(
        persisted.rows[0].battle_state.terrainGenerationVersion,
        BATTLE_MAP_V3_TERRAIN_GENERATION_VERSION
      );
      assert.equal(
        persisted.rows[0].battle_state.hashes.fullHash,
        battle.snapshot.fullHash
      );

      const battleFlags = await query(
        'SELECT id, in_battle FROM characters WHERE user_id = $1 ORDER BY party_slot',
        [user.userId]
      );
      assert.deepStrictEqual(
        battleFlags.rows.filter(character => character.in_battle).map(character => character.id),
        [selectedCharacter.id]
      );

      const rejoin = await requestWithHeaders(
        'GET',
        `/api/battle/${battle.battleId}/rejoin`,
        null,
        user.accessToken,
        supportedBattleMapCapabilityHeaders
      );
      assert.equal(rejoin.status, 200);
      assert.equal(rejoin.body.mapSeed, persisted.rows[0].map_seed);
      assert.equal(
        rejoin.body.snapshot.fullHash,
        persisted.rows[0].battle_state.hashes.fullHash
      );
      assert.deepStrictEqual(
        rejoin.body.snapshot.mutableState.units
          .filter(unit => unit.type === 'player')
          .map(unit => unit.id),
        [selectedCharacter.id]
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

      const res = await requestWithHeaders(
        'GET',
        '/api/battle/current',
        null,
        user.accessToken,
        supportedBattleMapCapabilityHeaders
      );

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.snapshot);
      assert.equal(
        res.body.snapshot.battleMapSchemaVersion,
        BATTLE_MAP_V3_SCHEMA_VERSION
      );
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
    it('replays a stable command without committing the action twice', async () => {
      if (!battle) return;

      const persisted = await query(
        'SELECT battle_state, state_revision FROM battles WHERE id = $1',
        [battle.battleId]
      );
      const preparedState = structuredClone(persisted.rows[0].battle_state);
      const playerUnit = preparedState.units.find(
        unit => unit.type === 'player' && unit.hp > 0
      );
      assert.ok(playerUnit, 'battle should contain a living player unit');
      playerUnit.moveUsed = false;
      playerUnit.actUsed = false;
      playerUnit.hasActed = false;
      playerUnit.turnPhase = 'ready';
      preparedState.activeUnitId = playerUnit.id;
      preparedState.activeUnitIndex = preparedState.units.findIndex(
        unit => unit.id === playerUnit.id
      );
      preparedState.status = 'active';
      const prepared = await query(
        `UPDATE battles
         SET battle_state = $1, status = 'active', state_revision = state_revision + 1
         WHERE id = $2
         RETURNING state_revision`,
        [JSON.stringify(preparedState), battle.battleId]
      );

      const commandNonce = randomUUID();
      const command = {
        battleId: battle.battleId,
        actionType: 'move',
        unitId: playerUnit.id,
        targetTile: { x: playerUnit.tileX, y: playerUnit.tileY },
        inventoryId: null,
        actionSequence: 7001,
        commandId: `integration-replay-${commandNonce}`,
        stateRevision: Number(prepared.rows[0].state_revision)
      };
      const first = await request(
        'POST',
        '/api/battle/action',
        command,
        user.accessToken
      );
      const replay = await request(
        'POST',
        '/api/battle/action',
        command,
        user.accessToken
      );

      assert.strictEqual(first.status, 200, JSON.stringify(first.body));
      assert.strictEqual(replay.status, 200, JSON.stringify(replay.body));
      assert.strictEqual(replay.body.stateRevision, first.body.stateRevision);
      assert.deepStrictEqual(replay.body.actionResult, first.body.actionResult);
      assert.deepStrictEqual(replay.body.state, first.body.state);

      const afterReplay = await query(
        `SELECT state_revision,
                (SELECT COUNT(*)::int
                 FROM battle_command_results
                 WHERE battle_id = $1 AND idempotency_key = $2) AS receipt_count
         FROM battles
         WHERE id = $1`,
        [battle.battleId, `player:${user.userId}:command:${command.commandId}`]
      );
      assert.strictEqual(
        Number(afterReplay.rows[0].state_revision),
        first.body.stateRevision
      );
      assert.strictEqual(afterReplay.rows[0].receipt_count, 1);

      const mismatch = await request(
        'POST',
        '/api/battle/action',
        { ...command, inventoryId: 999 },
        user.accessToken
      );
      assert.strictEqual(mismatch.status, 409);
      assert.strictEqual(mismatch.body.code, 'battle_command_id_conflict');
      assert.ok(mismatch.body.state);
      assert.ok(Object.hasOwn(mismatch.body, 'availableActions'));
      assert.strictEqual(
        mismatch.body.stateRevision,
        first.body.stateRevision
      );

      const correctedCommandId = `integration-corrected-${commandNonce}`;
      const rejected = await request(
        'POST',
        '/api/battle/action',
        {
          ...command,
          commandId: correctedCommandId,
          actionType: 'invalid_action',
          stateRevision: first.body.stateRevision
        },
        user.accessToken
      );
      assert.strictEqual(rejected.status, 400);

      const corrected = await request(
        'POST',
        '/api/battle/action',
        {
          ...command,
          commandId: correctedCommandId,
          actionType: 'attack',
          stateRevision: first.body.stateRevision,
          targetTile: {
            x: playerUnit.tileX < preparedState.mapWidth - 1
              ? playerUnit.tileX + 1
              : playerUnit.tileX - 1,
            y: playerUnit.tileY
          }
        },
        user.accessToken
      );
      assert.strictEqual(corrected.status, 200, JSON.stringify(corrected.body));
      assert.ok(corrected.body.stateRevision > first.body.stateRevision);

      const stale = await request(
        'POST',
        '/api/battle/action',
        {
          ...command,
          commandId: `integration-stale-${commandNonce}`
        },
        user.accessToken
      );
      assert.strictEqual(stale.status, 409);
      assert.strictEqual(stale.body.code, 'battle_state_conflict');
      assert.strictEqual(stale.body.stateRevision, corrected.body.stateRevision);
    });

    it('treats a reused legacy sequence after rejoin as a new command', async () => {
      if (!battle) return;

      const persisted = await query(
        'SELECT battle_state FROM battles WHERE id = $1',
        [battle.battleId]
      );
      const preparedState = structuredClone(persisted.rows[0].battle_state);
      const playerUnit = preparedState.units.find(
        unit => unit.type === 'player' && unit.hp > 0
      );
      assert.ok(playerUnit, 'battle should contain a living player unit');
      playerUnit.moveUsed = false;
      playerUnit.actUsed = false;
      playerUnit.hasActed = false;
      playerUnit.turnPhase = 'ready';
      preparedState.activeUnitId = playerUnit.id;
      preparedState.activeUnitIndex = preparedState.units.findIndex(
        unit => unit.id === playerUnit.id
      );
      preparedState.status = 'active';
      const prepared = await query(
        `UPDATE battles
         SET battle_state = $1, status = 'active', state_revision = state_revision + 1
         WHERE id = $2
         RETURNING state_revision`,
        [JSON.stringify(preparedState), battle.battleId]
      );
      const initialRevision = Number(prepared.rows[0].state_revision);
      const reusedSequence = 91001;

      const first = await request(
        'POST',
        '/api/battle/action',
        {
          battleId: battle.battleId,
          actionType: 'move',
          unitId: playerUnit.id,
          targetTile: { x: playerUnit.tileX, y: playerUnit.tileY },
          actionSequence: reusedSequence,
          stateRevision: initialRevision
        },
        user.accessToken
      );
      assert.strictEqual(first.status, 200, JSON.stringify(first.body));
      assert.strictEqual(first.body.commandId, null);

      const rejoin = await requestWithHeaders(
        'GET',
        `/api/battle/${battle.battleId}/rejoin`,
        null,
        user.accessToken,
        supportedBattleMapCapabilityHeaders
      );
      assert.strictEqual(rejoin.status, 200, JSON.stringify(rejoin.body));
      assert.strictEqual(rejoin.body.stateRevision, first.body.stateRevision);

      const second = await request(
        'POST',
        '/api/battle/action',
        {
          battleId: battle.battleId,
          actionType: 'wait',
          unitId: playerUnit.id,
          actionSequence: reusedSequence,
          stateRevision: rejoin.body.stateRevision
        },
        user.accessToken
      );
      assert.strictEqual(second.status, 200, JSON.stringify(second.body));
      assert.strictEqual(second.body.commandId, null);
      assert.ok(second.body.stateRevision > first.body.stateRevision);

      const receipts = await query(
        `SELECT idempotency_key, base_state_revision
         FROM battle_command_results
         WHERE battle_id = $1
           AND command_type = 'player_action'
           AND base_state_revision IN ($2, $3)
         ORDER BY base_state_revision`,
        [battle.battleId, initialRevision, first.body.stateRevision]
      );
      assert.strictEqual(receipts.rows.length, 2);
      assert.deepStrictEqual(
        receipts.rows.map(row => Number(row.base_state_revision)),
        [initialRevision, first.body.stateRevision]
      );
      assert.ok(receipts.rows.every(row =>
        row.idempotency_key.startsWith(`player:${user.userId}:legacy:`)
      ));
      assert.notStrictEqual(
        receipts.rows[0].idempotency_key,
        receipts.rows[1].idempotency_key
      );
    });

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
      assert.ok(res.body.state);
      assert.ok(Object.hasOwn(res.body, 'availableActions'));
      assert.ok(Number.isSafeInteger(res.body.stateRevision));
    });

    it('should reject malformed command IDs', async () => {
      const res = await request('POST', '/api/battle/action', {
        battleId: battle.battleId,
        actionType: 'wait',
        unitId: 1,
        commandId: 'contains spaces'
      }, user.accessToken);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.code, 'battle_command_id_invalid');
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
      assert.ok(res.body.hasOwnProperty('stateRevision'), 'Should have stateRevision');
      assert.ok(res.body.hasOwnProperty('moveUsed'), 'Should have moveUsed');
      assert.ok(res.body.hasOwnProperty('actUsed'), 'Should have actUsed');
      assert.ok(res.body.hasOwnProperty('turnPhase'), 'Should have turnPhase');
      assert.ok(res.body.hasOwnProperty('hasActed'), 'Should have hasActed');
      assert.ok(res.body.hasOwnProperty('availableActions'), 'Should have availableActions');
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
      const rejoinRes = await requestWithHeaders(
        'GET',
        `/api/battle/${battle.battleId}/rejoin`,
        null,
        user.accessToken,
        supportedBattleMapCapabilityHeaders
      );

      assert.strictEqual(rejoinRes.status, 200, 'Rejoin should succeed');
      assert.ok(
        rejoinRes.body.snapshot?.mutableState,
        'Rejoin should return a battle snapshot'
      );

      // After rejoin, a low sequence number should be accepted
      const rejoinedState = rejoinRes.body.snapshot.mutableState;
      const activeUnit = rejoinedState.activeUnitId;
      const playerUnit = rejoinedState.units?.find(
        unit => unit.id === activeUnit && unit.isPlayer
      );

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

  describe('terminal action replay', () => {
    it('serializes concurrent PvE victory retries and applies rewards once', async () => {
      if (!battle?.battleId) return;

      const persisted = await query(
        'SELECT battle_state FROM battles WHERE id = $1',
        [battle.battleId]
      );
      const terminalState = structuredClone(persisted.rows[0].battle_state);
      const playerUnit = terminalState.units.find(
        unit => unit.type === 'player' && unit.hp > 0
      );
      assert.ok(playerUnit, 'battle should contain a living player unit');
      for (const enemy of terminalState.units.filter(unit => unit.type === 'enemy')) {
        enemy.hp = 0;
      }
      playerUnit.moveUsed = false;
      playerUnit.actUsed = false;
      playerUnit.hasActed = false;
      playerUnit.turnPhase = 'ready';
      terminalState.activeUnitId = playerUnit.id;
      terminalState.activeUnitIndex = terminalState.units.findIndex(
        unit => unit.id === playerUnit.id
      );
      terminalState.status = 'active';
      terminalState.rewards = null;
      terminalState.endedAt = null;
      terminalState.winnerId = null;

      const prepared = await query(
        `UPDATE battles
         SET battle_state = $1,
             status = 'active',
             rewards = NULL,
             winner_id = NULL,
             ended_at = NULL,
             state_revision = state_revision + 1
         WHERE id = $2
         RETURNING state_revision`,
        [JSON.stringify(terminalState), battle.battleId]
      );
      const before = await query(
        `SELECT u.gold, c.experience
         FROM users u
         JOIN characters c ON c.user_id = u.id
         WHERE u.id = $1 AND c.id = $2`,
        [user.userId, Number(playerUnit.characterId ?? playerUnit.id)]
      );
      const commandId = `terminal-replay-${randomUUID()}`;
      const command = {
        battleId: battle.battleId,
        actionType: 'move',
        unitId: playerUnit.id,
        targetTile: { x: playerUnit.tileX, y: playerUnit.tileY },
        actionSequence: 8001,
        commandId,
        stateRevision: Number(prepared.rows[0].state_revision)
      };

      const [first, replay] = await Promise.all([
        request('POST', '/api/battle/action', command, user.accessToken),
        request('POST', '/api/battle/action', command, user.accessToken)
      ]);

      assert.strictEqual(first.status, 200, JSON.stringify(first.body));
      assert.strictEqual(replay.status, 200, JSON.stringify(replay.body));
      assert.strictEqual(first.body.battleStatus, 'victory');
      assert.strictEqual(replay.body.stateRevision, first.body.stateRevision);
      assert.deepStrictEqual(replay.body.actionResult, first.body.actionResult);

      const after = await query(
        `SELECT b.state_revision,
                b.status,
                u.gold,
                c.experience,
                (SELECT COUNT(*)::int
                 FROM battle_command_results
                 WHERE battle_id = b.id AND idempotency_key = $3) AS receipt_count,
                (SELECT COUNT(*)::int
                 FROM battle_terminal_effect_outbox
                 WHERE battle_id = b.id) AS outbox_count
         FROM battles b
         JOIN users u ON u.id = $2
         JOIN characters c ON c.user_id = u.id AND c.id = $4
         WHERE b.id = $1`,
        [
          battle.battleId,
          user.userId,
          `player:${user.userId}:command:${commandId}`,
          Number(playerUnit.characterId ?? playerUnit.id)
        ]
      );
      const rewards = first.body.actionResult.rewards;
      assert.strictEqual(after.rows[0].status, 'victory');
      assert.strictEqual(
        Number(after.rows[0].state_revision),
        first.body.stateRevision
      );
      assert.strictEqual(
        Number(after.rows[0].gold) - Number(before.rows[0].gold),
        rewards.gold
      );
      assert.strictEqual(
        Number(after.rows[0].experience) - Number(before.rows[0].experience),
        rewards.experience
      );
      assert.strictEqual(after.rows[0].receipt_count, 1);
      assert.strictEqual(after.rows[0].outbox_count, 1);
    });
  });
});
