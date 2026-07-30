import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  battleMapV2ToFlatState,
  createBattleMutableStateV1,
  createRepresentativeBattleMapV2CandidateFixture,
  createRepresentativeBattleMapV2FinalFixture
} from '../../../../shared/index.js';
import {
  BattleStateConflictError,
  BattleStateCorruptError,
  BattleStateIdempotencyError,
  BattleStateNotFoundError,
  createBattleStateRepository
} from '../../services/battle/BattleStateRepository.js';

const clone = value => structuredClone(value);

function createLegacyMap(overrides = {}) {
  return {
    battleMapSchemaVersion: 1,
    terrainGenerationVersion: 1,
    terrainSeed: 731,
    mapWidth: 2,
    mapHeight: 2,
    elevationFormat: 'normalized',
    terrain: [
      ['grass', 'grass'],
      ['dirt', 'grass']
    ],
    elevation: [
      [0, 0],
      [0, 0]
    ],
    obstacles: [
      [null, null],
      [null, null]
    ],
    variants: [
      [0, 0],
      [0, 0]
    ],
    ...overrides
  };
}

function createMutable(overrides = {}, lifecycle = {}) {
  return createBattleMutableStateV1({
    turn: 1,
    phase: 'active',
    units: [{ id: 'unit:1', hp: 10 }],
    ...overrides
  }, {
    battleType: 'pve',
    status: 'active',
    player1Id: 11,
    player2Id: null,
    ...lifecycle
  });
}

function createBattleRow({
  id = 41,
  map = createLegacyMap(),
  mutableState = createMutable(),
  stateRevision = 0,
  battleType = 'pve',
  status = 'active',
  player1Id = 11,
  player2Id = null,
  winnerId = null,
  rewards = null,
  endedAt = null,
  fullHash = null,
  creationIdempotencyKey = 'fixture:create'
} = {}) {
  return {
    id,
    battle_type: battleType,
    status,
    node_id: 9,
    battle_state: { ...mutableState, ...map },
    map_seed: map.terrainSeed,
    map_width: map.mapWidth,
    map_height: map.mapHeight,
    player1_id: player1Id,
    player2_id: player2Id,
    winner_id: winnerId,
    rewards,
    started_at: new Date('2026-07-28T10:00:00.000Z'),
    ended_at: endedAt,
    is_advancement_battle: false,
    challenger_character_id: null,
    state_revision: stateRevision,
    battle_map_schema_version: map.battleMapSchemaVersion,
    terrain_generation_version: map.terrainGenerationVersion,
    battle_map_full_hash: fullHash,
    creation_idempotency_key: creationIdempotencyKey
  };
}

class MutationClient {
  constructor(row) {
    this.row = clone(row);
    this.commandResults = new Map();
    this.requestHashBackfillCount = 0;
    this.updateCount = 0;
    this.lastUpdateSql = null;
    this.updateRowTransform = null;
  }

  async query(sql, params) {
    if (sql.includes('FROM battle_command_results')) {
      const result = this.commandResults.get(`${params[0]}:${params[1]}`);
      return { rows: result ? [clone(result)] : [] };
    }
    if (sql.includes('INSERT INTO battle_command_results')) {
      this.commandResults.set(`${params[0]}:${params[1]}`, {
        command_type: params[2],
        request_hash: params[3],
        result: JSON.parse(params[6])
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('UPDATE battle_command_results')) {
      const result = this.commandResults.get(`${params[0]}:${params[1]}`);
      if (result?.request_hash === null) {
        result.request_hash = params[2];
        this.requestHashBackfillCount += 1;
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('UPDATE battles')) {
      this.lastUpdateSql = sql;
      const expectedRevision = params[12];
      const allowedStatuses = params[13];
      if (this.row.state_revision !== expectedRevision
        || !allowedStatuses.includes(this.row.status)) {
        return { rows: [], rowCount: 0 };
      }
      this.updateCount += 1;
      this.row = {
        ...this.row,
        battle_state: JSON.parse(params[0]),
        status: params[1],
        winner_id: params[2],
        rewards: params[3] === null ? null : JSON.parse(params[3]),
        ended_at: params[4],
        map_seed: params[5],
        map_width: params[6],
        map_height: params[7],
        battle_map_schema_version: params[8],
        terrain_generation_version: params[9],
        battle_map_full_hash: params[10],
        state_revision: this.row.state_revision + 1
      };
      const returnedRow = clone(this.row);
      delete returnedRow.battle_state;
      return {
        rows: [
          this.updateRowTransform
            ? this.updateRowTransform(returnedRow)
            : returnedRow
        ],
        rowCount: 1
      };
    }
    if (sql.includes('FROM battles') && sql.includes('WHERE id = $1')) {
      return { rows: String(params[0]) === String(this.row.id) ? [clone(this.row)] : [] };
    }
    throw new Error(`Unexpected SQL in mutation test: ${sql}`);
  }
}

class CreationClient {
  constructor() {
    this.row = null;
    this.insertCount = 0;
  }

  async query(sql, params) {
    if (sql.includes('WHERE creation_idempotency_key = $1')) {
      const matches = this.row?.creation_idempotency_key === params[0];
      return { rows: matches ? [clone(this.row)] : [] };
    }
    if (sql.includes('INSERT INTO battles')) {
      if (this.row?.creation_idempotency_key === params[14]) {
        return { rows: [], rowCount: 0 };
      }
      this.insertCount += 1;
      const state = JSON.parse(params[3]);
      this.row = {
        id: 72,
        battle_type: params[0],
        status: params[1],
        node_id: params[2],
        battle_state: state,
        map_seed: params[4],
        map_width: params[5],
        map_height: params[6],
        player1_id: params[7],
        player2_id: params[8],
        winner_id: null,
        rewards: null,
        started_at: new Date('2026-07-28T10:00:00.000Z'),
        ended_at: null,
        is_advancement_battle: params[9],
        challenger_character_id: params[10],
        state_revision: 0,
        battle_map_schema_version: params[11],
        terrain_generation_version: params[12],
        battle_map_full_hash: params[13],
        creation_idempotency_key: params[14],
        creation_request_hash: params[15]
      };
      return { rows: [{ id: this.row.id }], rowCount: 1 };
    }
    if (sql.includes('FROM battles') && sql.includes('WHERE id = $1')) {
      return { rows: this.row && this.row.id === params[0] ? [clone(this.row)] : [] };
    }
    throw new Error(`Unexpected SQL in creation test: ${sql}`);
  }
}

function repositoryFor(client, withTransaction = callback => callback(client)) {
  return createBattleStateRepository({
    query: (...args) => client.query(...args),
    withTransaction
  });
}

describe('BattleStateRepository', () => {
  it('loads V1 only through its explicit adapter and rejects mirror conflicts', async () => {
    const row = createBattleRow();
    const repository = repositoryFor(new MutationClient(row));
    const envelope = await repository.loadBattle(row.id);

    assert.equal(envelope.stateRevision, 0);
    assert.equal(envelope.battleMapSchemaVersion, 1);
    assert.equal(envelope.map.terrainSeed, row.map_seed);
    assert.equal(envelope.mutableState.turn, 1);
    assert.deepEqual(envelope.state.terrain, envelope.map.terrain);
    assert.equal(envelope.state.status, 'active');

    const corrupt = createBattleRow();
    corrupt.map_width += 1;
    await assert.rejects(
      repositoryFor(new MutationClient(corrupt)).loadBattle(corrupt.id),
      error => error instanceof BattleStateCorruptError
        && /dimension mirror conflict/.test(error.message)
    );
  });

  it('checks participant access before hydrating an inaccessible battle row', async () => {
    const corruptRow = createBattleRow({ player1Id: 11 });
    corruptRow.battle_state = { turn: 1, units: [] };
    let participantQuery = '';
    const repository = createBattleStateRepository({
      query: async (sql, params) => {
        participantQuery = sql;
        return {
          rows: String(params[1]) === String(corruptRow.player1_id)
            ? [clone(corruptRow)]
            : []
        };
      },
      withTransaction: async callback => callback({ query: repository.query })
    });

    await assert.rejects(
      repository.loadBattleForParticipant(corruptRow.id, 99),
      error => error instanceof BattleStateNotFoundError
    );
    assert.match(participantQuery, /EXISTS\s*\(\s*SELECT 1\s+FROM battle_players/s);

    await assert.rejects(
      repository.loadBattleForParticipant(corruptRow.id, corruptRow.player1_id),
      error => error instanceof BattleStateCorruptError
    );
  });

  it('checks active participant battles without hydrating battle state', async () => {
    const results = [true, false];
    const calls = [];
    const repository = createBattleStateRepository({
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [{ has_active_battle: results.shift() }] };
      },
      withTransaction: async callback => callback({ query: repository.query })
    });

    assert.equal(await repository.hasActiveBattleForPlayer(11), true);
    assert.equal(
      await repository.hasActiveBattleForPlayer(11, { battleType: 'pve' }),
      false
    );

    assert.match(calls[0].sql, /SELECT EXISTS/);
    assert.match(calls[0].sql, /player1_id = \$1/);
    assert.match(calls[0].sql, /player2_id = \$1/);
    assert.match(calls[0].sql, /FROM battle_players/);
    assert.match(calls[0].sql, /status = 'active'/);
    assert.doesNotMatch(calls[0].sql, /battle_state/);
    assert.deepEqual(calls[0].params, [11]);
    assert.match(calls[1].sql, /battle_type = \$2/);
    assert.deepEqual(calls[1].params, [11, 'pve']);
  });

  it('uses a supplied client for active participant checks', async () => {
    let defaultQueryCount = 0;
    const suppliedCalls = [];
    const repository = createBattleStateRepository({
      query: async () => {
        defaultQueryCount += 1;
        return { rows: [{ has_active_battle: false }] };
      },
      withTransaction: async callback => callback({ query: repository.query })
    });
    const client = {
      async query(sql, params) {
        suppliedCalls.push({ sql, params });
        return { rows: [{ has_active_battle: true }] };
      }
    };

    assert.equal(
      await repository.hasActiveBattleForPlayer(23, { client }),
      true
    );
    assert.equal(defaultQueryCount, 0);
    assert.equal(suppliedCalls.length, 1);
    assert.deepEqual(suppliedCalls[0].params, [23]);
  });

  it('checks active battles for validated, deduplicated participant IDs', async () => {
    const results = [false, true];
    const calls = [];
    const repository = createBattleStateRepository({
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [{ has_active_battle: results.shift() }] };
      },
      withTransaction: async callback => callback({ query: repository.query })
    });

    assert.equal(
      await repository.hasActiveBattleForAnyPlayer([9, '3', 9]),
      false
    );
    assert.equal(
      await repository.hasActiveBattleForAnyPlayer([3, 9], {
        battleType: 'pvp_coliseum'
      }),
      true
    );

    assert.match(calls[0].sql, /player1_id = ANY\(\$1::int\[\]\)/);
    assert.match(calls[0].sql, /player2_id = ANY\(\$1::int\[\]\)/);
    assert.match(calls[0].sql, /battle_players\.user_id = ANY\(\$1::int\[\]\)/);
    assert.deepEqual(calls[0].params, [[3, 9]]);
    assert.match(calls[1].sql, /battle_type = \$2/);
    assert.deepEqual(calls[1].params, [[3, 9], 'pvp_coliseum']);

    await assert.rejects(
      repository.hasActiveBattleForAnyPlayer([]),
      /userIds must be a non-empty array/
    );
    await assert.rejects(
      repository.hasActiveBattleForAnyPlayer([3, 'invalid']),
      /positive safe integers/
    );
  });

  it('uses a supplied client for bulk active participant checks', async () => {
    let defaultQueryCount = 0;
    const suppliedCalls = [];
    const repository = createBattleStateRepository({
      query: async () => {
        defaultQueryCount += 1;
        return { rows: [{ has_active_battle: false }] };
      },
      withTransaction: async callback => callback({ query: repository.query })
    });
    const client = {
      async query(sql, params) {
        suppliedCalls.push({ sql, params });
        return { rows: [{ has_active_battle: true }] };
      }
    };

    assert.equal(
      await repository.hasActiveBattleForAnyPlayer([9, 3], { client }),
      true
    );
    assert.equal(defaultQueryCount, 0);
    assert.equal(suppliedCalls.length, 1);
    assert.deepEqual(suppliedCalls[0].params, [[3, 9]]);
  });

  it('commits exactly one successor revision and makes a duplicate command idempotent', async () => {
    const client = new MutationClient(createBattleRow());
    const repository = repositoryFor(client);
    const initial = await repository.loadBattle(41);
    const nextState = clone(initial.state);
    nextState.turn = 2;

    const committed = await repository.commitLegacyState({
      battleId: 41,
      expectedRevision: 0,
      commandType: 'player_action',
      idempotencyKey: 'player:11:action:1',
      flatState: nextState
    });
    assert.equal(committed.baseStateRevision, 0);
    assert.equal(committed.stateRevision, 1);
    assert.equal(committed.update.updateId, '41:1');
    assert.equal(committed.envelope.mutableState.turn, 2);
    assert.equal(client.updateCount, 1);

    const duplicate = await repository.commitLegacyState({
      battleId: 41,
      expectedRevision: 0,
      commandType: 'player_action',
      idempotencyKey: 'player:11:action:1',
      flatState: nextState
    });
    assert.equal(duplicate.idempotent, true);
    assert.equal(duplicate.stateRevision, 1);
    assert.equal(client.updateCount, 1);

    const reorderedState = {
      ...nextState,
      units: nextState.units.map(unit => ({ hp: unit.hp, id: unit.id }))
    };
    const canonicalDuplicate = await repository.commitLegacyState({
      battleId: 41,
      expectedRevision: 0,
      commandType: 'player_action',
      idempotencyKey: 'player:11:action:1',
      flatState: reorderedState
    });
    assert.equal(canonicalDuplicate.idempotent, true);
    assert.equal(client.updateCount, 1);

    await assert.rejects(
      repository.commitLegacyState({
        battleId: 41,
        expectedRevision: 0,
        commandType: 'player_action',
        idempotencyKey: 'player:11:action:2',
        flatState: nextState
      }),
      error => error instanceof BattleStateConflictError
        && error.actualRevision === 1
    );
  });

  it('rejects reuse of a command key for a different normalized request', async () => {
    const client = new MutationClient(createBattleRow());
    const repository = repositoryFor(client);
    const initial = await repository.loadBattle(41);
    const nextState = clone(initial.state);
    nextState.turn = 2;

    await repository.commitBattleState({
      battleId: 41,
      expectedRevision: 0,
      commandType: 'player_action',
      idempotencyKey: 'player:11:action:request-binding',
      flatState: nextState,
      lifecycle: { status: 'active' }
    });

    const differentState = clone(nextState);
    differentState.units[0].hp = 9;
    await assert.rejects(
      repository.commitBattleState({
        battleId: 41,
        expectedRevision: 0,
        commandType: 'player_action',
        idempotencyKey: 'player:11:action:request-binding',
        flatState: differentState,
        lifecycle: { status: 'active' }
      }),
      error => error instanceof BattleStateIdempotencyError
        && /different request/.test(error.message)
    );

    await assert.rejects(
      repository.commitBattleState({
        battleId: 41,
        expectedRevision: 0,
        commandType: 'player_action',
        idempotencyKey: 'player:11:action:request-binding',
        flatState: nextState
      }),
      error => error instanceof BattleStateIdempotencyError
        && /different request/.test(error.message)
    );

    await assert.rejects(
      repository.commitBattleState({
        battleId: 41,
        expectedRevision: 1,
        commandType: 'player_action',
        idempotencyKey: 'player:11:action:request-binding',
        flatState: nextState,
        lifecycle: { status: 'active' }
      }),
      error => error instanceof BattleStateIdempotencyError
        && /different request/.test(error.message)
    );
    assert.equal(client.updateCount, 1);
  });

  it('rejects a pre-hash receipt without binding an unverifiable request', async () => {
    const client = new MutationClient(createBattleRow());
    const repository = repositoryFor(client);
    const initial = await repository.loadBattle(41);
    const nextState = clone(initial.state);
    nextState.turn = 2;
    const command = {
      battleId: 41,
      expectedRevision: 0,
      commandType: 'legacy_receipt',
      idempotencyKey: 'legacy:null-request-hash',
      flatState: nextState
    };

    await repository.commitLegacyState(command);
    const receipt = client.commandResults.get('41:legacy:null-request-hash');
    receipt.request_hash = null;

    await assert.rejects(
      repository.commitLegacyState(command),
      error => error instanceof BattleStateIdempotencyError
        && error.code === 'BATTLE_COMMAND_RECEIPT_RECONCILIATION_REQUIRED'
        && /reconciliation is required/.test(error.message)
    );
    assert.equal(receipt.request_hash, null);
    assert.equal(client.requestHashBackfillCount, 0);
    assert.equal(client.updateCount, 1);
  });

  it('rejects ambiguous pre-hash requests that produce the same successor', async () => {
    const client = new MutationClient(createBattleRow());
    const repository = repositoryFor(client);
    const initial = await repository.loadBattle(41);
    const nextState = clone(initial.state);
    nextState.turn = 2;
    const command = {
      battleId: 41,
      expectedRevision: 0,
      commandType: 'legacy_receipt',
      idempotencyKey: 'legacy:same-successor',
      flatState: nextState,
      lifecycle: { status: 'active' }
    };

    await repository.commitLegacyState(command);
    const receipt = client.commandResults.get('41:legacy:same-successor');
    receipt.request_hash = null;

    await assert.rejects(
      repository.commitLegacyState({ ...command, lifecycle: {} }),
      error => error instanceof BattleStateIdempotencyError
        && error.code === 'BATTLE_COMMAND_RECEIPT_RECONCILIATION_REQUIRED'
    );
    assert.equal(receipt.request_hash, null);
    assert.equal(client.requestHashBackfillCount, 0);
    assert.equal(client.updateCount, 1);
  });

  it('serializes concurrent exact retries into one mutation and one replay', async () => {
    const client = new MutationClient(createBattleRow());
    let transactionTail = Promise.resolve();
    const withSerializedTransaction = callback => {
      const transaction = transactionTail.then(() => callback(client));
      transactionTail = transaction.catch(() => {});
      return transaction;
    };
    const repository = repositoryFor(client, withSerializedTransaction);
    const initial = await repository.loadBattle(41);
    const nextState = clone(initial.state);
    nextState.turn = 2;
    const command = {
      battleId: 41,
      expectedRevision: 0,
      commandType: 'concurrent_player_action',
      idempotencyKey: 'player:11:concurrent:1',
      flatState: nextState
    };

    const results = await Promise.all([
      repository.commitLegacyState(command),
      repository.commitLegacyState(clone(command))
    ]);

    assert.equal(client.updateCount, 1);
    assert.deepEqual(
      results.map(result => result.idempotent).sort(),
      [false, true]
    );
    assert.equal(results[0].stateRevision, 1);
    assert.equal(results[1].stateRevision, 1);
  });

  it('binds a stable command receipt to caller intent independently of revision', async () => {
    const client = new MutationClient(createBattleRow());
    const repository = repositoryFor(client);
    const initial = await repository.loadBattle(41);
    const nextState = clone(initial.state);
    nextState.turn = 2;
    const idempotencyRequest = {
      userId: 11,
      actionType: 'move',
      unitId: 'unit:1',
      targetTile: { x: 1, y: 2 },
      skillId: null,
      inventoryId: null
    };

    const committed = await repository.commitLegacyState({
      battleId: 41,
      expectedRevision: 0,
      commandType: 'player_action',
      idempotencyKey: 'player:11:command:move-1',
      idempotencyRequest,
      replayMetadata: {
        actionResult: { moved: true },
        battleStatus: 'active',
        turnContinues: true,
        availableActions: { canMove: false, canAct: true }
      },
      flatState: nextState
    });
    assert.deepEqual(committed.replayMetadata.actionResult, { moved: true });

    const receipt = await repository.findCommandReceipt({
      battleId: 41,
      commandType: 'player_action',
      idempotencyKey: 'player:11:command:move-1',
      idempotencyRequest
    });
    assert.equal(receipt.idempotent, true);
    assert.equal(receipt.baseStateRevision, 0);
    assert.equal(receipt.stateRevision, 1);
    assert.deepEqual(receipt.replayMetadata.availableActions, {
      canMove: false,
      canAct: true
    });

    const replay = await repository.commitLegacyState({
      battleId: 41,
      expectedRevision: 99,
      commandType: 'player_action',
      idempotencyKey: 'player:11:command:move-1',
      idempotencyRequest,
      replayMetadata: { actionResult: { moved: false } },
      flatState: nextState
    });
    assert.equal(replay.idempotent, true);
    assert.deepEqual(replay.replayMetadata.actionResult, { moved: true });
    assert.equal(client.updateCount, 1);
  });

  it('rejects a stable command ID reused with different caller intent', async () => {
    const client = new MutationClient(createBattleRow());
    const repository = repositoryFor(client);
    const initial = await repository.loadBattle(41);
    const nextState = clone(initial.state);
    nextState.turn = 2;
    const command = {
      battleId: 41,
      expectedRevision: 0,
      commandType: 'player_action',
      idempotencyKey: 'player:11:command:conflict',
      idempotencyRequest: {
        userId: 11,
        actionType: 'item',
        unitId: 'unit:1',
        targetTile: null,
        skillId: null,
        inventoryId: 7
      },
      flatState: nextState
    };

    await repository.commitLegacyState(command);

    await assert.rejects(
      repository.findCommandReceipt({
        battleId: 41,
        commandType: command.commandType,
        idempotencyKey: command.idempotencyKey,
        idempotencyRequest: {
          ...command.idempotencyRequest,
          inventoryId: 8
        }
      }),
      error => error instanceof BattleStateIdempotencyError
        && /different request/.test(error.message)
    );
    assert.equal(client.updateCount, 1);
  });

  it('keeps an omitted terminal timestamp stable in the request fingerprint', async () => {
    const client = new MutationClient(createBattleRow());
    const repository = repositoryFor(client);
    const initial = await repository.loadBattle(41);
    const command = {
      battleId: 41,
      expectedRevision: 0,
      commandType: 'complete_without_timestamp',
      idempotencyKey: 'complete:41',
      mutableState: initial.mutableState,
      status: 'victory',
      winnerId: 11,
      rewards: { gold: 5 }
    };

    const committed = await repository.completeBattle(command);
    const replay = await repository.completeBattle(command);

    assert.equal(committed.idempotent, false);
    assert.equal(replay.idempotent, true);
    assert.equal(client.updateCount, 1);
  });

  it('requires reconciliation for a pre-hash completion with an omitted timestamp', async () => {
    const client = new MutationClient(createBattleRow());
    const repository = repositoryFor(client);
    const initial = await repository.loadBattle(41);
    const command = {
      battleId: 41,
      expectedRevision: 0,
      commandType: 'complete_without_timestamp',
      idempotencyKey: 'complete:legacy-null-hash',
      mutableState: initial.mutableState,
      status: 'victory',
      winnerId: 11,
      rewards: { gold: 5 }
    };

    await repository.completeBattle(command);
    const receipt = client.commandResults.get('41:complete:legacy-null-hash');
    receipt.request_hash = null;

    await assert.rejects(
      repository.completeBattle(command),
      error => error instanceof BattleStateIdempotencyError
        && error.code === 'BATTLE_COMMAND_RECEIPT_RECONCILIATION_REQUIRED'
    );
    assert.equal(receipt.request_hash, null);
    assert.equal(client.requestHashBackfillCount, 0);
    assert.equal(client.updateCount, 1);
  });

  it('cannot express an immutable map change through a legacy command', async () => {
    const client = new MutationClient(createBattleRow());
    const repository = repositoryFor(client);
    const envelope = await repository.loadBattle(41);
    const tampered = clone(envelope.state);
    tampered.terrain[0][0] = 'water';

    await assert.rejects(
      repository.commitLegacyState({
        battleId: 41,
        expectedRevision: 0,
        commandType: 'debug_state',
        idempotencyKey: 'debug:41:1',
        flatState: tampered
      }),
      error => error instanceof BattleStateConflictError
        && /immutable BattleMapV1/.test(error.message)
    );
    assert.equal(client.updateCount, 0);
  });

  it('loads and independently verifies a complete V2 final map', async () => {
    const map = await createRepresentativeBattleMapV2FinalFixture();
    const mutableState = createMutable({}, {
      battleType: 'pve',
      status: 'active',
      player1Id: 11
    });
    const flatState = await battleMapV2ToFlatState(map, mutableState);
    const row = createBattleRow({
      map,
      mutableState,
      fullHash: map.diagnostics.hashes.fullHash
    });
    row.battle_state = flatState;

    const envelope = await repositoryFor(new MutationClient(row)).loadBattle(row.id);
    assert.equal(envelope.fullHash, map.diagnostics.hashes.fullHash);
    assert.deepEqual(envelope.map.features, map.features);

    const corrupt = clone(row);
    corrupt.battle_map_full_hash = `sha256:${'0'.repeat(64)}`;
    await assert.rejects(
      repositoryFor(new MutationClient(corrupt)).loadBattle(corrupt.id),
      error => error instanceof BattleStateCorruptError
        && /full-hash mirror conflict/.test(error.message)
    );
  });

  it('commits V2 mutable state without permitting an immutable map change', async () => {
    const map = await createRepresentativeBattleMapV2FinalFixture();
    const mutableState = createMutable({}, {
      battleType: 'pve',
      status: 'active',
      player1Id: 11
    });
    const flatState = await battleMapV2ToFlatState(map, mutableState);
    const row = createBattleRow({
      map,
      mutableState,
      fullHash: map.diagnostics.hashes.fullHash
    });
    row.battle_state = flatState;
    const client = new MutationClient(row);
    const repository = repositoryFor(client);
    const hydrateEnvelope = repository.envelopeFromRow.bind(repository);
    let verifiedBaseEnvelope;
    let hydrationCount = 0;
    repository.envelopeFromRow = async returnedRow => {
      const hydrated = await hydrateEnvelope(returnedRow);
      hydrationCount += 1;
      verifiedBaseEnvelope ??= hydrated;
      return hydrated;
    };

    const successor = structuredClone(flatState);
    successor.turn = 2;
    const committed = await repository.commitBattleState({
      battleId: row.id,
      expectedRevision: 0,
      commandType: 'player_action',
      idempotencyKey: 'v2:player:11:action:1',
      flatState: successor
    });

    assert.equal(committed.stateRevision, 1);
    assert.equal(hydrationCount, 1);
    assert.equal(committed.envelope.battleId, row.id);
    assert.equal(committed.envelope.id, row.id);
    assert.equal(committed.envelope.battleType, row.battle_type);
    assert.equal(committed.envelope.status, row.status);
    assert.equal(committed.envelope.nodeId, row.node_id);
    assert.equal(committed.envelope.player1Id, row.player1_id);
    assert.equal(committed.envelope.startedAt, row.started_at.toISOString());
    assert.equal(committed.envelope.stateRevision, 1);
    assert.equal(committed.envelope.battleMapSchemaVersion, map.battleMapSchemaVersion);
    assert.equal(
      committed.envelope.terrainGenerationVersion,
      map.terrainGenerationVersion
    );
    assert.equal(committed.envelope.mutableState.turn, 2);
    assert.strictEqual(committed.envelope.mutableState, committed.mutableState);
    assert.equal(committed.envelope.fullHash, map.diagnostics.hashes.fullHash);
    assert.strictEqual(committed.envelope.map, verifiedBaseEnvelope.map);
    assert.deepEqual(committed.envelope.map, map);
    assert.strictEqual(committed.envelope.state, committed.envelope.flatState);
    assert.equal(
      committed.envelope.map.diagnostics.hashes.fullHash,
      committed.envelope.fullHash
    );
    assert.equal(Object.isFrozen(committed.envelope), true);
    assert.equal(Object.isFrozen(committed.envelope.map), true);
    assert.equal(Object.isFrozen(committed.envelope.mutableState), true);
    assert.equal(Object.isFrozen(committed.envelope.flatState), true);
    const returningClause = client.lastUpdateSql.slice(
      client.lastUpdateSql.indexOf('RETURNING')
    );
    assert.doesNotMatch(returningClause, /\bbattle_state\b/);

    const tampered = structuredClone(committed.envelope.state);
    tampered.terrain[0][0].movementCost += 1;
    await assert.rejects(
      repository.commitBattleState({
        battleId: row.id,
        expectedRevision: 1,
        commandType: 'debug_state',
        idempotencyKey: 'v2:debug:1',
        flatState: tampered
      }),
      error => error instanceof BattleStateConflictError
        && /invalid BattleMapV2 state|immutable BattleMap/.test(error.message)
    );
    assert.equal(client.updateCount, 1);
  });

  it('rejects conflicting metadata returned by an optimized V1 commit', async () => {
    const client = new MutationClient(createBattleRow());
    client.updateRowTransform = returnedRow => ({
      ...returnedRow,
      map_width: returnedRow.map_width + 1
    });
    const repository = repositoryFor(client);
    const initial = await repository.loadBattle(41);
    const successor = structuredClone(initial.mutableState);
    successor.turn = 2;

    await assert.rejects(
      repository.commitMutableState({
        battleId: 41,
        expectedRevision: 0,
        commandType: 'player_action',
        idempotencyKey: 'v1:metadata-conflict',
        mutableState: successor
      }),
      error => error instanceof BattleStateCorruptError
        && /dimension mirror conflict/.test(error.message)
    );
  });

  it('creates a V2 final map atomically at revision zero and deduplicates its creation key', async () => {
    const map = await createRepresentativeBattleMapV2FinalFixture();
    const client = new CreationClient();
    const repository = repositoryFor(client);
    const command = {
      battleType: 'pve',
      nodeId: 9,
      player1Id: 11,
      creationIdempotencyKey: 'pve:request:abc',
      finalMap: map,
      initialMutableState: { turn: 1, units: [] }
    };

    const created = await repository.createBattle(command);
    assert.equal(created.created, true);
    assert.equal(created.stateRevision, 0);
    assert.equal(created.fullHash, map.diagnostics.hashes.fullHash);
    assert.equal(client.insertCount, 1);

    const duplicate = await repository.createBattle(command);
    assert.equal(duplicate.idempotent, true);
    assert.equal(duplicate.battleId, created.battleId);
    assert.equal(client.insertCount, 1);

    await assert.rejects(
      repository.createBattle({
        ...command,
        initialMutableState: { turn: 2, units: [] }
      }),
      error => error instanceof BattleStateIdempotencyError
    );

    await assert.rejects(
      repository.createBattle({ ...command, player1Id: 99 }),
      error => error instanceof BattleStateIdempotencyError
    );
  });

  it('rejects a candidate at the persistence boundary', async () => {
    const candidate = createRepresentativeBattleMapV2CandidateFixture();
    const repository = repositoryFor(new CreationClient());

    await assert.rejects(
      repository.createBattle({
        battleType: 'pve',
        nodeId: 9,
        player1Id: 11,
        creationIdempotencyKey: 'candidate:forbidden',
        finalMap: candidate
      }),
      /diagnostics\.hashes/
    );
  });
});
