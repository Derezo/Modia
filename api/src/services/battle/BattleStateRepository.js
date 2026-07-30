import {
  BATTLE_MAP_SCHEMA_VERSION,
  BATTLE_MAP_V2_FLAT_FIELDS,
  BATTLE_STATE_BYTE_BUDGETS,
  TERRAIN_GENERATION_VERSION,
  assertBattleMapV2Final,
  assertWithinUncompressedBudget,
  battleMapV2ToFlatState,
  canonicalizeJson,
  createBattleMutableStateUpdateV1,
  createBattleMutableStateV1,
  deepCloneJsonValue,
  deepFreeze,
  loadLegacyFlatBattleState,
  splitBattleMapV2FlatState
} from '../../../../shared/index.js';
import { createHash } from 'node:crypto';
import {
  query as databaseQuery,
  withTransaction as databaseTransaction
} from '../../config/database.js';

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const TERMINAL_STATUSES = new Set(['victory', 'defeat', 'draw', 'fled']);
const LIFECYCLE_KEYS = new Set(['status', 'winnerId', 'rewards', 'endedAt']);
const CREATION_KEY_MAX_LENGTH = 255;
const COMMAND_KEY_MAX_LENGTH = 255;
const COMMAND_TYPE_MAX_LENGTH = 96;

const BATTLE_ROW_METADATA_COLUMNS = `
  id,
  battle_type,
  status,
  node_id,
  map_seed,
  map_width,
  map_height,
  player1_id,
  player2_id,
  winner_id,
  rewards,
  started_at,
  ended_at,
  is_advancement_battle,
  challenger_character_id,
  state_revision,
  battle_map_schema_version,
  terrain_generation_version,
  battle_map_full_hash,
  creation_idempotency_key,
  creation_request_hash
`;

const BATTLE_ROW_COLUMNS = `
  ${BATTLE_ROW_METADATA_COLUMNS},
  battle_state
`;

const LEGACY_REQUIRED_MAP_FIELDS = Object.freeze([
  'terrainSeed',
  'mapWidth',
  'mapHeight',
  'terrain',
  'elevation',
  'obstacles'
]);

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
}

function assertNonEmptyString(value, label, maximumLength) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.length > maximumLength) {
    throw new RangeError(`${label} cannot exceed ${maximumLength} characters`);
  }
}

function assertBattleId(value) {
  if ((!Number.isSafeInteger(value) || value < 1)
    && (typeof value !== 'string' || value.length === 0)) {
    throw new TypeError('battleId must be a positive safe integer or non-empty string');
  }
}

function assertRevision(value, label = 'expectedRevision') {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
}

function normalizePlayerIds(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new TypeError('userIds must be a non-empty array');
  }
  const normalized = userIds.map(userId => Number(userId));
  if (normalized.some(userId => !Number.isSafeInteger(userId) || userId < 1)) {
    throw new TypeError('userIds must contain only positive safe integers');
  }
  return [...new Set(normalized)].sort((left, right) => left - right);
}

function parseJson(value, label) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new BattleStateCorruptError(`${label} is not valid JSON`, { cause: error });
    }
  }
  return value;
}

function dateToJson(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function jsonEqual(left, right) {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function canonicalHash(value) {
  return `sha256:${createHash('sha256')
    .update(canonicalizeJson(value))
    .digest('hex')}`;
}

function commandRequestHash(command) {
  const {
    commandType,
    expectedRevision,
    mutableState,
    lifecycle,
    allowedStatuses
  } = command;
  if (own(command, 'idempotencyRequest')) {
    assertPlainObject(command.idempotencyRequest, 'idempotencyRequest');
    return canonicalHash({
      commandType,
      idempotencyRequest: command.idempotencyRequest
    });
  }
  return canonicalHash({
    commandType,
    expectedRevision,
    mutableState,
    lifecycle,
    allowedStatuses
  });
}

function execute(executor, text, params) {
  if (executor && typeof executor.query === 'function') {
    return executor.query(text, params);
  }
  return databaseQuery(text, params);
}

function normalizeLifecycle(input = {}) {
  assertPlainObject(input, 'lifecycle');
  for (const key of Object.keys(input)) {
    if (!LIFECYCLE_KEYS.has(key)) {
      throw new TypeError(`lifecycle.${key} is not a mutable lifecycle field`);
    }
  }
  if (own(input, 'status')
    && (typeof input.status !== 'string' || input.status.length === 0)) {
    throw new TypeError('lifecycle.status must be a non-empty string');
  }
  return {
    ...(own(input, 'status') ? { status: input.status } : {}),
    ...(own(input, 'winnerId') ? { winnerId: input.winnerId } : {}),
    ...(own(input, 'rewards') ? { rewards: input.rewards } : {}),
    ...(own(input, 'endedAt') ? { endedAt: dateToJson(input.endedAt) } : {})
  };
}

function lifecycleFromRow(row, flatState = {}, { legacyBattleType = false } = {}) {
  return {
    status: row.status,
    battleType: legacyBattleType
      ? (flatState.battleType ?? row.battle_type)
      : row.battle_type,
    player1Id: row.player1_id ?? null,
    player2Id: row.player2_id ?? null,
    winnerId: row.winner_id ?? null,
    rewards: row.rewards ?? null,
    endedAt: dateToJson(row.ended_at),
    isAdvancementBattle: row.is_advancement_battle ?? false,
    challengerCharacterId: row.challenger_character_id ?? null
  };
}

function assertLifecycleMirrors(row, flatState, strict) {
  if (!strict) return;
  const expected = lifecycleFromRow(row, flatState);
  for (const key of [
    'status',
    'battleType',
    'player1Id',
    'player2Id',
    'winnerId',
    'rewards',
    'endedAt',
    'isAdvancementBattle',
    'challengerCharacterId'
  ]) {
    if (!own(flatState, key) || !jsonEqual(flatState[key], expected[key])) {
      throw new BattleStateCorruptError(
        `Battle ${row.id} has a conflicting ${key} lifecycle mirror`
      );
    }
  }
}

function assertDatabaseMapMirrors(row, flatState, schemaVersion) {
  const stateSchemaVersion = flatState.battleMapSchemaVersion
    ?? (schemaVersion === 1 ? 1 : undefined);
  const stateGenerationVersion = flatState.terrainGenerationVersion
    ?? (schemaVersion === 1 ? 1 : undefined);

  if (stateSchemaVersion !== schemaVersion
    || row.battle_map_schema_version !== schemaVersion) {
    throw new BattleStateCorruptError(`Battle ${row.id} has a map-schema mirror conflict`);
  }
  if (stateGenerationVersion !== row.terrain_generation_version) {
    throw new BattleStateCorruptError(`Battle ${row.id} has a generation-version mirror conflict`);
  }
  if (flatState.terrainSeed !== row.map_seed) {
    throw new BattleStateCorruptError(`Battle ${row.id} has a map-seed mirror conflict`);
  }
  if (flatState.mapWidth !== row.map_width || flatState.mapHeight !== row.map_height) {
    throw new BattleStateCorruptError(`Battle ${row.id} has a map-dimension mirror conflict`);
  }
}

function legacyMapFromFlatState(flatState) {
  const loaded = loadLegacyFlatBattleState(flatState);
  for (const key of LEGACY_REQUIRED_MAP_FIELDS) {
    if (!own(loaded, key)) {
      throw new BattleStateCorruptError(`BattleMapV1.${key} is required`);
    }
  }
  if (!Number.isSafeInteger(loaded.terrainSeed)) {
    throw new BattleStateCorruptError('BattleMapV1.terrainSeed must be a safe integer');
  }
  if (!Number.isSafeInteger(loaded.mapWidth) || loaded.mapWidth < 1
    || !Number.isSafeInteger(loaded.mapHeight) || loaded.mapHeight < 1) {
    throw new BattleStateCorruptError('BattleMapV1 dimensions must be positive safe integers');
  }
  if (!Array.isArray(loaded.terrain)
    || !Array.isArray(loaded.elevation)
    || !Array.isArray(loaded.obstacles)) {
    throw new BattleStateCorruptError('BattleMapV1 grid layers must be arrays');
  }

  const map = {};
  for (const key of BATTLE_MAP_V2_FLAT_FIELDS) {
    if (own(loaded, key)) map[key] = loaded[key];
  }
  assertWithinUncompressedBudget(
    map,
    BATTLE_STATE_BYTE_BUDGETS.persistedMapUncompressed,
    'Persisted BattleMapV1'
  );
  return deepFreeze(deepCloneJsonValue(map));
}

function legacyMutableFromFlatState(flatState, row) {
  const mutableInput = legacyMutableInputFromFlatState(flatState);
  return createBattleMutableStateV1(
    mutableInput,
    lifecycleFromRow(row, flatState, { legacyBattleType: true })
  );
}

function legacyMutableInputFromFlatState(flatState) {
  const mutableInput = {};
  for (const [key, value] of Object.entries(flatState)) {
    if (!BATTLE_MAP_V2_FLAT_FIELDS.includes(key)) mutableInput[key] = value;
  }
  return mutableInput;
}

function flattenLegacyState(map, mutableState) {
  return deepFreeze(deepCloneJsonValue({ ...mutableState, ...map }));
}

function mapReference(map) {
  const isV2 = map.battleMapSchemaVersion === BATTLE_MAP_SCHEMA_VERSION;
  return {
    battleMapSchemaVersion: isV2 ? BATTLE_MAP_SCHEMA_VERSION : 1,
    terrainGenerationVersion: isV2 ? TERRAIN_GENERATION_VERSION : 1,
    fullHash: isV2 ? map.diagnostics.hashes.fullHash : null
  };
}

function committedEnvelopeFromRow(
  row,
  baseEnvelope,
  nextMutableState,
  nextFlatState,
  nextRevision
) {
  if (!row) throw new TypeError('row is required');
  if (row.id !== baseEnvelope.battleId) {
    throw new BattleStateCorruptError(
      `Battle ${baseEnvelope.battleId} update returned a conflicting battle id`
    );
  }
  assertRevision(row.state_revision, 'battles.state_revision');
  if (row.state_revision !== nextRevision) {
    throw new BattleStateCorruptError(
      `Battle ${row.id} update returned revision ${row.state_revision}, expected ${nextRevision}`
    );
  }

  const reference = mapReference(baseEnvelope.map);
  if (baseEnvelope.battleMapSchemaVersion !== reference.battleMapSchemaVersion
    || row.battle_map_schema_version !== reference.battleMapSchemaVersion) {
    throw new BattleStateCorruptError(`Battle ${row.id} has a map-schema mirror conflict`);
  }
  if (baseEnvelope.terrainGenerationVersion !== reference.terrainGenerationVersion
    || row.terrain_generation_version !== reference.terrainGenerationVersion) {
    throw new BattleStateCorruptError(`Battle ${row.id} has a generation-version mirror conflict`);
  }
  if (baseEnvelope.fullHash !== reference.fullHash
    || row.battle_map_full_hash !== reference.fullHash) {
    throw new BattleStateCorruptError(`Battle ${row.id} has a full-hash mirror conflict`);
  }
  assertDatabaseMapMirrors(row, nextFlatState, reference.battleMapSchemaVersion);
  assertLifecycleMirrors(row, nextFlatState, true);

  return deepFreeze({
    battleId: row.id,
    id: row.id,
    battleType: row.battle_type,
    status: row.status,
    nodeId: row.node_id ?? null,
    player1Id: row.player1_id ?? null,
    player2Id: row.player2_id ?? null,
    winnerId: row.winner_id ?? null,
    rewards: row.rewards ?? null,
    startedAt: dateToJson(row.started_at),
    endedAt: dateToJson(row.ended_at),
    isAdvancementBattle: row.is_advancement_battle ?? false,
    challengerCharacterId: row.challenger_character_id ?? null,
    stateRevision: row.state_revision,
    battleMapSchemaVersion: row.battle_map_schema_version,
    terrainGenerationVersion: row.terrain_generation_version,
    fullHash: row.battle_map_full_hash ?? null,
    mapSeed: row.map_seed,
    mapWidth: row.map_width,
    mapHeight: row.map_height,
    creationIdempotencyKey: row.creation_idempotency_key ?? null,
    creationRequestHash: row.creation_request_hash ?? null,
    map: baseEnvelope.map,
    mutableState: nextMutableState,
    flatState: nextFlatState,
    state: nextFlatState
  });
}

function commandResultFromStored(row) {
  const result = parseJson(row.result, 'battle_command_results.result');
  assertPlainObject(result, 'battle_command_results.result');
  return result;
}

export class BattleStateRepositoryError extends Error {
  constructor(message, { code = 'BATTLE_STATE_REPOSITORY_ERROR', cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class BattleStateNotFoundError extends BattleStateRepositoryError {
  constructor(battleId) {
    super(`Battle ${battleId} was not found`, { code: 'BATTLE_NOT_FOUND' });
  }
}

export class BattleStateConflictError extends BattleStateRepositoryError {
  constructor(message, details = {}) {
    super(message, { code: 'BATTLE_STATE_CONFLICT' });
    Object.assign(this, details);
  }
}

export class BattleStateLifecycleError extends BattleStateRepositoryError {
  constructor(message, details = {}) {
    super(message, { code: 'BATTLE_LIFECYCLE_CONFLICT' });
    Object.assign(this, details);
  }
}

export class BattleStateIdempotencyError extends BattleStateRepositoryError {
  constructor(message, { code = 'BATTLE_IDEMPOTENCY_CONFLICT' } = {}) {
    super(message, { code });
  }
}

export class BattleStateCorruptError extends BattleStateRepositoryError {
  constructor(message, options = {}) {
    super(message, { code: 'BATTLE_STATE_CORRUPT', ...options });
  }
}

export class BattleStateRepository {
  constructor({
    query = databaseQuery,
    withTransaction = databaseTransaction
  } = {}) {
    if (typeof query !== 'function' || typeof withTransaction !== 'function') {
      throw new TypeError('BattleStateRepository requires query and withTransaction functions');
    }
    this.query = query;
    this.withTransaction = withTransaction;
  }

  async inTransaction(client, callback) {
    if (client) return callback(client);
    return this.withTransaction(callback);
  }

  async envelopeFromRow(row) {
    if (!row) throw new TypeError('row is required');
    const flatState = parseJson(row.battle_state, 'battles.battle_state');
    if (!isPlainObject(flatState)) {
      throw new BattleStateCorruptError(`Battle ${row.id} battle_state must be an object`);
    }
    assertRevision(row.state_revision, 'battles.state_revision');
    const schemaVersion = row.battle_map_schema_version;
    if (schemaVersion !== 1 && schemaVersion !== BATTLE_MAP_SCHEMA_VERSION) {
      throw new BattleStateCorruptError(
        `Battle ${row.id} has unsupported map schema ${schemaVersion}`
      );
    }
    assertDatabaseMapMirrors(row, flatState, schemaVersion);

    let map;
    let mutableState;
    if (schemaVersion === BATTLE_MAP_SCHEMA_VERSION) {
      if (row.terrain_generation_version !== TERRAIN_GENERATION_VERSION) {
        throw new BattleStateCorruptError(`Battle ${row.id} has an unsupported V2 generation`);
      }
      if (!HASH_PATTERN.test(row.battle_map_full_hash ?? '')) {
        throw new BattleStateCorruptError(`Battle ${row.id} has an invalid V2 full-hash mirror`);
      }
      try {
        const split = await splitBattleMapV2FlatState(flatState);
        map = split.map;
        assertWithinUncompressedBudget(
          map,
          BATTLE_STATE_BYTE_BUDGETS.persistedMapUncompressed,
          'Persisted BattleMapV2'
        );
        if (map.diagnostics.hashes.fullHash !== row.battle_map_full_hash) {
          throw new BattleStateCorruptError(`Battle ${row.id} has a full-hash mirror conflict`);
        }
        assertLifecycleMirrors(row, split.mutableState, true);
        mutableState = createBattleMutableStateV1(
          split.mutableState,
          lifecycleFromRow(row, split.mutableState)
        );
      } catch (error) {
        if (error instanceof BattleStateRepositoryError) throw error;
        throw new BattleStateCorruptError(`Battle ${row.id} contains an invalid BattleMapV2`, {
          cause: error
        });
      }
    } else {
      if (row.terrain_generation_version !== 1 || row.battle_map_full_hash !== null) {
        throw new BattleStateCorruptError(`Battle ${row.id} has invalid V1 version/hash mirrors`);
      }
      try {
        map = legacyMapFromFlatState(flatState);
        mutableState = legacyMutableFromFlatState(flatState, row);
      } catch (error) {
        if (error instanceof BattleStateRepositoryError) throw error;
        throw new BattleStateCorruptError(`Battle ${row.id} contains an invalid BattleMapV1`, {
          cause: error
        });
      }
    }

    const normalizedFlatState = schemaVersion === BATTLE_MAP_SCHEMA_VERSION
      ? await battleMapV2ToFlatState(map, mutableState)
      : flattenLegacyState(map, mutableState);

    return deepFreeze({
      battleId: row.id,
      id: row.id,
      battleType: row.battle_type,
      status: row.status,
      nodeId: row.node_id ?? null,
      player1Id: row.player1_id ?? null,
      player2Id: row.player2_id ?? null,
      winnerId: row.winner_id ?? null,
      rewards: row.rewards ?? null,
      startedAt: dateToJson(row.started_at),
      endedAt: dateToJson(row.ended_at),
      isAdvancementBattle: row.is_advancement_battle ?? false,
      challengerCharacterId: row.challenger_character_id ?? null,
      stateRevision: row.state_revision,
      battleMapSchemaVersion: schemaVersion,
      terrainGenerationVersion: row.terrain_generation_version,
      fullHash: row.battle_map_full_hash ?? null,
      mapSeed: row.map_seed,
      mapWidth: row.map_width,
      mapHeight: row.map_height,
      creationIdempotencyKey: row.creation_idempotency_key ?? null,
      creationRequestHash: row.creation_request_hash ?? null,
      map,
      mutableState,
      flatState: normalizedFlatState,
      state: normalizedFlatState
    });
  }

  async loadBattle(battleId, {
    client = null,
    forUpdate = false,
    requireActive = false
  } = {}) {
    assertBattleId(battleId);
    const result = await (client
      ? client.query(
        `SELECT ${BATTLE_ROW_COLUMNS}
         FROM battles
         WHERE id = $1${requireActive ? " AND status = 'active'" : ''}
         ${forUpdate ? 'FOR UPDATE' : ''}`,
        [battleId]
      )
      : this.query(
        `SELECT ${BATTLE_ROW_COLUMNS}
         FROM battles
         WHERE id = $1${requireActive ? " AND status = 'active'" : ''}
         ${forUpdate ? 'FOR UPDATE' : ''}`,
        [battleId]
      ));
    if (result.rows.length === 0) throw new BattleStateNotFoundError(battleId);
    return this.envelopeFromRow(result.rows[0]);
  }

  async loadBattleForParticipant(battleId, userId, options = {}) {
    assertBattleId(battleId);
    const {
      client = null,
      forUpdate = false,
      requireActive = false
    } = options;
    const executor = client ?? { query: this.query };
    const result = await execute(
      executor,
      `SELECT ${BATTLE_ROW_COLUMNS}
       FROM battles
       WHERE id = $1
         AND (
           player1_id = $2
           OR player2_id = $2
           OR EXISTS (
             SELECT 1
             FROM battle_players
             WHERE battle_players.battle_id = battles.id
               AND battle_players.user_id = $2
           )
         )${requireActive ? " AND status = 'active'" : ''}
       ${forUpdate ? 'FOR UPDATE' : ''}`,
      [battleId, userId]
    );
    if (result.rows.length === 0) throw new BattleStateNotFoundError(battleId);
    return this.envelopeFromRow(result.rows[0]);
  }

  async findActiveBattleForPlayer(userId, {
    client = null,
    battleType = null
  } = {}) {
    const params = [userId];
    const typeClause = battleType === null ? '' : ' AND battle_type = $2';
    if (battleType !== null) params.push(battleType);
    const executor = client ?? { query: this.query };
    const result = await execute(
      executor,
      `SELECT ${BATTLE_ROW_COLUMNS}
       FROM battles
       WHERE (
         player1_id = $1
         OR player2_id = $1
         OR EXISTS (
             SELECT 1
             FROM battle_players
             WHERE battle_players.battle_id = battles.id
               AND battle_players.user_id = $1
           )
       )
         AND status = 'active'${typeClause}
       ORDER BY started_at DESC, id DESC
       LIMIT 1`,
      params
    );
    if (result.rows.length === 0) return null;
    return this.envelopeFromRow(result.rows[0]);
  }

  async hasActiveBattleForPlayer(userId, {
    client = null,
    battleType = null
  } = {}) {
    const params = [userId];
    const typeClause = battleType === null ? '' : ' AND battle_type = $2';
    if (battleType !== null) params.push(battleType);
    const executor = client ?? { query: this.query };
    const result = await execute(
      executor,
      `SELECT EXISTS (
         SELECT 1
         FROM battles
         WHERE (
           player1_id = $1
           OR player2_id = $1
           OR EXISTS (
             SELECT 1
             FROM battle_players
             WHERE battle_players.battle_id = battles.id
               AND battle_players.user_id = $1
           )
         )
           AND status = 'active'${typeClause}
       ) AS has_active_battle`,
      params
    );
    return result.rows[0]?.has_active_battle === true;
  }

  async hasActiveBattleForAnyPlayer(userIds, {
    client = null,
    battleType = null
  } = {}) {
    const normalizedUserIds = normalizePlayerIds(userIds);
    const params = [normalizedUserIds];
    const typeClause = battleType === null ? '' : ' AND battle_type = $2';
    if (battleType !== null) params.push(battleType);
    const executor = client ?? { query: this.query };
    const result = await execute(
      executor,
      `SELECT EXISTS (
         SELECT 1
         FROM battles
         WHERE (
           player1_id = ANY($1::int[])
           OR player2_id = ANY($1::int[])
           OR EXISTS (
             SELECT 1
             FROM battle_players
             WHERE battle_players.battle_id = battles.id
               AND battle_players.user_id = ANY($1::int[])
           )
         )
           AND status = 'active'${typeClause}
       ) AS has_active_battle`,
      params
    );
    return result.rows[0]?.has_active_battle === true;
  }

  async getAdvancementAttemptSummary({
    challengerCharacterId,
    targetClass,
    nodeId
  }, { client = null } = {}) {
    assertBattleId(challengerCharacterId);
    assertNonEmptyString(targetClass, 'targetClass', 32);
    assertBattleId(nodeId);
    const executor = client ?? { query: this.query };
    const result = await execute(
      executor,
      `SELECT COUNT(*)::integer AS attempt_count,
              COUNT(*) FILTER (
                WHERE status IN ('active', 'victory')
              )::integer AS blocking_attempt_count
       FROM battles
       WHERE is_advancement_battle = TRUE
         AND challenger_character_id = $1
         AND target_class = $2
         AND node_id = $3`,
      [challengerCharacterId, targetClass, nodeId]
    );
    const row = result.rows[0] ?? {};
    return deepFreeze({
      attemptCount: Number(row.attempt_count || 0),
      hasBlockingAttempt: Number(row.blocking_attempt_count || 0) > 0
    });
  }

  async persistAdvancementIdentity(
    battleId,
    {
      targetClass,
      guildmasterTemplateId
    },
    { client = null } = {}
  ) {
    assertBattleId(battleId);
    assertNonEmptyString(targetClass, 'targetClass', 32);
    assertBattleId(guildmasterTemplateId);
    const executor = client ?? { query: this.query };
    return execute(
      executor,
      `UPDATE battles
       SET target_class = $1,
           guildmaster_template_id = $2
       WHERE id = $3`,
      [targetClass, guildmasterTemplateId, battleId]
    );
  }

  async createBattle({
    battleType,
    status = 'active',
    nodeId = null,
    player1Id,
    player2Id = null,
    isAdvancementBattle = false,
    challengerCharacterId = null,
    creationIdempotencyKey,
    finalMap = null,
    legacyFlatState = null,
    initialMutableState = {}
  }, { client = null } = {}) {
    assertNonEmptyString(
      creationIdempotencyKey,
      'creationIdempotencyKey',
      CREATION_KEY_MAX_LENGTH
    );
    assertNonEmptyString(battleType, 'battleType', 64);
    assertNonEmptyString(status, 'status', 32);
    if ((finalMap === null) === (legacyFlatState === null)) {
      throw new TypeError('Exactly one of finalMap or legacyFlatState is required');
    }

    let map;
    let flatState;
    let mutableState;
    const lifecycle = {
      status,
      battleType,
      player1Id: player1Id ?? null,
      player2Id: player2Id ?? null,
      winnerId: null,
      rewards: null,
      endedAt: null,
      isAdvancementBattle,
      challengerCharacterId
    };
    if (finalMap !== null) {
      assertBattleMapV2Final(finalMap);
      map = finalMap;
      assertWithinUncompressedBudget(
        map,
        BATTLE_STATE_BYTE_BUDGETS.persistedMapUncompressed,
        'Persisted BattleMapV2'
      );
      mutableState = createBattleMutableStateV1(initialMutableState, lifecycle);
      flatState = await battleMapV2ToFlatState(map, mutableState);
    } else {
      assertPlainObject(legacyFlatState, 'legacyFlatState');
      map = legacyMapFromFlatState(legacyFlatState);
      const legacyMutable = {};
      for (const [key, value] of Object.entries(legacyFlatState)) {
        if (!BATTLE_MAP_V2_FLAT_FIELDS.includes(key)) legacyMutable[key] = value;
      }
      mutableState = createBattleMutableStateV1(
        { ...legacyMutable, ...initialMutableState },
        lifecycle
      );
      flatState = flattenLegacyState(map, mutableState);
    }
    const reference = mapReference(map);
    assertWithinUncompressedBudget(
      flatState,
      BATTLE_STATE_BYTE_BUDGETS.initialSnapshotUncompressed,
      'Persisted battle state'
    );
    const creationRequestHash = canonicalHash({
      battleType,
      status,
      nodeId: nodeId ?? null,
      player1Id: player1Id ?? null,
      player2Id: player2Id ?? null,
      isAdvancementBattle,
      challengerCharacterId: challengerCharacterId ?? null,
      map,
      mutableState
    });

    return this.inTransaction(client, async transactionClient => {
      const existing = await transactionClient.query(
        `SELECT ${BATTLE_ROW_COLUMNS}
         FROM battles
         WHERE creation_idempotency_key = $1
         FOR UPDATE`,
        [creationIdempotencyKey]
      );
      if (existing.rows.length > 0) {
        return this.assertSameCreation(
          await this.envelopeFromRow(existing.rows[0]),
          {
            battleType,
            player1Id,
            player2Id,
            nodeId,
            map,
            creationRequestHash
          }
        );
      }

      const inserted = await transactionClient.query(
        `INSERT INTO battles (
           battle_type,
           status,
           node_id,
           battle_state,
           map_seed,
           map_width,
           map_height,
           player1_id,
           player2_id,
           is_advancement_battle,
           challenger_character_id,
           state_revision,
           battle_map_schema_version,
           terrain_generation_version,
           battle_map_full_hash,
           creation_idempotency_key,
           creation_request_hash
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10, $11, 0, $12, $13, $14, $15, $16
         )
         ON CONFLICT (creation_idempotency_key)
           WHERE creation_idempotency_key IS NOT NULL
         DO NOTHING
         RETURNING id`,
        [
          battleType,
          status,
          nodeId,
          JSON.stringify(flatState),
          map.terrainSeed,
          map.mapWidth,
          map.mapHeight,
          player1Id,
          player2Id,
          isAdvancementBattle,
          challengerCharacterId,
          reference.battleMapSchemaVersion,
          reference.terrainGenerationVersion,
          reference.fullHash,
          creationIdempotencyKey,
          creationRequestHash
        ]
      );

      if (inserted.rows.length === 0) {
        const conflicted = await transactionClient.query(
          `SELECT ${BATTLE_ROW_COLUMNS}
           FROM battles
           WHERE creation_idempotency_key = $1
           FOR UPDATE`,
          [creationIdempotencyKey]
        );
        if (conflicted.rows.length === 0) {
          throw new BattleStateConflictError('Creation conflict could not be resolved');
        }
        return this.assertSameCreation(
          await this.envelopeFromRow(conflicted.rows[0]),
          {
            battleType,
            player1Id,
            player2Id,
            nodeId,
            map,
            creationRequestHash
          }
        );
      }

      const envelope = await this.loadBattle(inserted.rows[0].id, {
        client: transactionClient,
        forUpdate: true
      });
      return deepFreeze({ created: true, idempotent: false, envelope, ...envelope });
    });
  }

  assertSameCreation(envelope, expected) {
    const same = envelope.creationRequestHash !== null
      ? envelope.creationRequestHash === expected.creationRequestHash
      : envelope.battleType === expected.battleType
      && envelope.player1Id === (expected.player1Id ?? null)
      && envelope.player2Id === (expected.player2Id ?? null)
      && envelope.nodeId === (expected.nodeId ?? null)
      && jsonEqual(envelope.map, expected.map);
    if (!same) {
      throw new BattleStateIdempotencyError(
        `Creation key ${envelope.creationIdempotencyKey} was reused for another battle`
      );
    }
    return deepFreeze({ created: false, idempotent: true, envelope, ...envelope });
  }

  async findCommandResult(client, {
    battleId,
    idempotencyKey,
    commandType,
    requestHash
  }) {
    const result = await client.query(
      `SELECT command_type, request_hash, result
       FROM battle_command_results
       WHERE battle_id = $1 AND idempotency_key = $2`,
      [battleId, idempotencyKey]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    if (row.command_type !== commandType) {
      throw new BattleStateIdempotencyError(
        `Command key ${idempotencyKey} was already used for ${row.command_type}`
      );
    }
    const storedResult = commandResultFromStored(row);
    if (row.request_hash !== null && row.request_hash !== undefined) {
      if (!HASH_PATTERN.test(row.request_hash)) {
        throw new BattleStateCorruptError(
          `Command key ${idempotencyKey} has an invalid request hash`
        );
      }
      if (row.request_hash !== requestHash) {
        throw new BattleStateIdempotencyError(
          `Command key ${idempotencyKey} was reused with a different request`
        );
      }
      return storedResult;
    }

    // A pre-hash receipt cannot prove the original lifecycle request or
    // allowed-status contract from its stored successor alone. Keep it
    // immutable and require explicit reconciliation instead of guessing and
    // permanently binding the retry's hash.
    throw new BattleStateIdempotencyError(
      `Command key ${idempotencyKey} has a legacy receipt without a request hash; reconciliation is required before retrying`,
      { code: 'BATTLE_COMMAND_RECEIPT_RECONCILIATION_REQUIRED' }
    );
  }

  async findCommandReceipt({
    battleId,
    idempotencyKey,
    commandType,
    idempotencyRequest
  }, { client = null } = {}) {
    assertBattleId(battleId);
    assertNonEmptyString(commandType, 'commandType', COMMAND_TYPE_MAX_LENGTH);
    assertNonEmptyString(idempotencyKey, 'idempotencyKey', COMMAND_KEY_MAX_LENGTH);
    assertPlainObject(idempotencyRequest, 'idempotencyRequest');
    const requestHash = commandRequestHash({
      commandType,
      idempotencyRequest
    });
    const executor = client ?? { query: this.query };
    const receipt = await this.findCommandResult(executor, {
      battleId,
      idempotencyKey,
      commandType,
      requestHash
    });
    return receipt === null ? null : deepFreeze({
      ...receipt,
      idempotent: true
    });
  }

  async commitMutableState({
    battleId,
    expectedRevision,
    commandType,
    idempotencyKey,
    mutableState,
    lifecycle = {},
    requestLifecycle = lifecycle,
    idempotencyRequest,
    replayMetadata,
    allowedStatuses = ['active']
  }, { client = null } = {}) {
    return this.inTransaction(client, async transactionClient => {
      const envelope = await this.loadBattle(battleId, {
        client: transactionClient,
        forUpdate: true
      });
      return this.commitMutableStateLocked({
        transactionClient,
        envelope,
        expectedRevision,
        commandType,
        idempotencyKey,
        mutableState,
        requestMutableState: mutableState,
        lifecycle,
        requestLifecycle,
        idempotencyRequest,
        replayMetadata,
        allowedStatuses
      });
    });
  }

  async commitLegacyState({
    battleId,
    expectedRevision,
    commandType,
    idempotencyKey,
    flatState,
    lifecycle = {},
    idempotencyRequest,
    replayMetadata,
    allowedStatuses = ['active']
  }, { client = null } = {}) {
    assertPlainObject(flatState, 'flatState');
    return this.inTransaction(client, async transactionClient => {
      const envelope = await this.loadBattle(battleId, {
        client: transactionClient,
        forUpdate: true
      });
      if (envelope.battleMapSchemaVersion !== 1) {
        throw new TypeError('commitLegacyState cannot mutate a BattleMapV2 battle');
      }
      const suppliedMap = legacyMapFromFlatState(flatState);
      if (!jsonEqual(suppliedMap, envelope.map)) {
        throw new BattleStateConflictError(
          `Command ${commandType} attempted to change immutable BattleMapV1 data`
        );
      }
      const rowLike = {
        id: envelope.battleId,
        battle_type: envelope.battleType,
        status: lifecycle.status ?? envelope.status,
        player1_id: envelope.player1Id,
        player2_id: envelope.player2Id,
        winner_id: own(lifecycle, 'winnerId') ? lifecycle.winnerId : envelope.winnerId,
        rewards: own(lifecycle, 'rewards') ? lifecycle.rewards : envelope.rewards,
        ended_at: own(lifecycle, 'endedAt') ? lifecycle.endedAt : envelope.endedAt,
        is_advancement_battle: envelope.isAdvancementBattle,
        challenger_character_id: envelope.challengerCharacterId
      };
      const suppliedMutable = legacyMutableFromFlatState(flatState, rowLike);
      return this.commitMutableStateLocked({
        transactionClient,
        envelope,
        expectedRevision,
        commandType,
        idempotencyKey,
        mutableState: suppliedMutable,
        requestMutableState: legacyMutableInputFromFlatState(flatState),
        lifecycle,
        requestLifecycle: lifecycle,
        idempotencyRequest,
        replayMetadata,
        allowedStatuses
      });
    });
  }

  /**
   * Commit the flat state shape still used by the battle engine while keeping
   * the immutable map behind the repository boundary. V2 is independently
   * parsed and hash-verified before its mutable projection is accepted.
   */
  async commitBattleState({
    battleId,
    expectedRevision,
    commandType,
    idempotencyKey,
    flatState,
    lifecycle = {},
    idempotencyRequest,
    replayMetadata,
    allowedStatuses = ['active']
  }, { client = null } = {}) {
    assertPlainObject(flatState, 'flatState');
    return this.inTransaction(client, async transactionClient => {
      const envelope = await this.loadBattle(battleId, {
        client: transactionClient,
        forUpdate: true
      });

      let suppliedMap;
      let suppliedMutable;
      let requestMutableState;
      if (envelope.battleMapSchemaVersion === BATTLE_MAP_SCHEMA_VERSION) {
        let split;
        try {
          split = await splitBattleMapV2FlatState(flatState);
        } catch (error) {
          throw new BattleStateConflictError(
            `Command ${commandType} supplied an invalid BattleMapV2 state`,
            { cause: error }
          );
        }
        suppliedMap = split.map;
        suppliedMutable = split.mutableState;
        requestMutableState = split.mutableState;
      } else {
        suppliedMap = legacyMapFromFlatState(flatState);
        requestMutableState = legacyMutableInputFromFlatState(flatState);
        const rowLike = {
          id: envelope.battleId,
          battle_type: envelope.battleType,
          status: lifecycle.status ?? envelope.status,
          player1_id: envelope.player1Id,
          player2_id: envelope.player2Id,
          winner_id: own(lifecycle, 'winnerId') ? lifecycle.winnerId : envelope.winnerId,
          rewards: own(lifecycle, 'rewards') ? lifecycle.rewards : envelope.rewards,
          ended_at: own(lifecycle, 'endedAt') ? lifecycle.endedAt : envelope.endedAt,
          is_advancement_battle: envelope.isAdvancementBattle,
          challenger_character_id: envelope.challengerCharacterId
        };
        suppliedMutable = legacyMutableFromFlatState(flatState, rowLike);
      }

      if (!jsonEqual(suppliedMap, envelope.map)) {
        throw new BattleStateConflictError(
          `Command ${commandType} attempted to change immutable BattleMap data`
        );
      }

      return this.commitMutableStateLocked({
        transactionClient,
        envelope,
        expectedRevision,
        commandType,
        idempotencyKey,
        mutableState: suppliedMutable,
        requestMutableState,
        lifecycle,
        requestLifecycle: lifecycle,
        idempotencyRequest,
        replayMetadata,
        allowedStatuses
      });
    });
  }

  async completeBattle(command, { client = null } = {}) {
    const {
      battleId,
      expectedRevision,
      commandType,
      idempotencyKey,
      mutableState,
      status,
      winnerId = null,
      rewards = null,
      endedAt,
      idempotencyRequest,
      replayMetadata
    } = command;
    if (!TERMINAL_STATUSES.has(status)) {
      throw new TypeError(`Terminal battle status ${status} is unsupported`);
    }
    const hasExplicitEndedAt = own(command, 'endedAt');
    const resolvedEndedAt = hasExplicitEndedAt
      ? endedAt
      : new Date().toISOString();
    return this.commitMutableState({
      battleId,
      expectedRevision,
      commandType,
      idempotencyKey,
      mutableState,
      lifecycle: { status, winnerId, rewards, endedAt: resolvedEndedAt },
      requestLifecycle: {
        status,
        winnerId,
        rewards,
        ...(hasExplicitEndedAt ? { endedAt } : {})
      },
      idempotencyRequest,
      replayMetadata,
      allowedStatuses: ['active']
    }, { client });
  }

  async commitMutableStateLocked({
    transactionClient,
    envelope,
    expectedRevision,
    commandType,
    idempotencyKey,
    mutableState,
    requestMutableState,
    lifecycle,
    requestLifecycle,
    idempotencyRequest,
    replayMetadata,
    allowedStatuses
  }) {
    assertRevision(expectedRevision);
    assertNonEmptyString(commandType, 'commandType', COMMAND_TYPE_MAX_LENGTH);
    assertNonEmptyString(idempotencyKey, 'idempotencyKey', COMMAND_KEY_MAX_LENGTH);
    if (!Array.isArray(allowedStatuses) || allowedStatuses.length === 0
      || allowedStatuses.some(status => typeof status !== 'string' || status.length === 0)) {
      throw new TypeError('allowedStatuses must contain at least one non-empty status');
    }

    const lifecycleChanges = normalizeLifecycle(lifecycle);
    const requestLifecycleChanges = normalizeLifecycle(requestLifecycle);
    const normalizedRequestMutableState = createBattleMutableStateV1(requestMutableState);
    if (idempotencyRequest !== undefined) {
      assertPlainObject(idempotencyRequest, 'idempotencyRequest');
    }
    if (replayMetadata !== undefined) {
      assertPlainObject(replayMetadata, 'replayMetadata');
    }
    const normalizedAllowedStatuses = [...new Set(allowedStatuses)].sort();
    const nextLifecycle = {
      status: lifecycleChanges.status ?? envelope.status,
      battleType: envelope.battleType,
      player1Id: envelope.player1Id,
      player2Id: envelope.player2Id,
      winnerId: own(lifecycleChanges, 'winnerId')
        ? lifecycleChanges.winnerId
        : envelope.winnerId,
      rewards: own(lifecycleChanges, 'rewards')
        ? lifecycleChanges.rewards
        : envelope.rewards,
      endedAt: own(lifecycleChanges, 'endedAt')
        ? lifecycleChanges.endedAt
        : envelope.endedAt,
      isAdvancementBattle: envelope.isAdvancementBattle,
      challengerCharacterId: envelope.challengerCharacterId
    };
    const nextMutableState = createBattleMutableStateV1(mutableState, nextLifecycle);
    const requestHash = commandRequestHash({
      commandType,
      expectedRevision,
      mutableState: normalizedRequestMutableState,
      lifecycle: requestLifecycleChanges,
      allowedStatuses: normalizedAllowedStatuses,
      ...(idempotencyRequest !== undefined ? { idempotencyRequest } : {})
    });
    const duplicate = await this.findCommandResult(transactionClient, {
      battleId: envelope.battleId,
      idempotencyKey,
      commandType,
      requestHash
    });
    if (duplicate) {
      const update = createBattleMutableStateUpdateV1(duplicate);
      return deepFreeze({
        ...duplicate,
        update,
        envelope: null,
        idempotent: true
      });
    }
    if (envelope.stateRevision !== expectedRevision) {
      throw new BattleStateConflictError(
        `Battle ${envelope.battleId} revision ${envelope.stateRevision} does not match ${expectedRevision}`,
        {
          battleId: envelope.battleId,
          expectedRevision,
          actualRevision: envelope.stateRevision
        }
      );
    }
    if (!allowedStatuses.includes(envelope.status)) {
      throw new BattleStateLifecycleError(
        `Battle ${envelope.battleId} status ${envelope.status} rejects ${commandType}`,
        {
          battleId: envelope.battleId,
          actualStatus: envelope.status,
          allowedStatuses: [...allowedStatuses]
        }
      );
    }

    const nextFlatState = envelope.battleMapSchemaVersion === BATTLE_MAP_SCHEMA_VERSION
      ? await battleMapV2ToFlatState(envelope.map, nextMutableState)
      : flattenLegacyState(envelope.map, nextMutableState);
    const nextRevision = expectedRevision + 1;
    const updateResult = await transactionClient.query(
      `UPDATE battles
       SET battle_state = $1,
           status = $2,
           winner_id = $3,
           rewards = $4,
           ended_at = $5,
           map_seed = $6,
           map_width = $7,
           map_height = $8,
           battle_map_schema_version = $9,
           terrain_generation_version = $10,
           battle_map_full_hash = $11,
           state_revision = state_revision + 1
       WHERE id = $12
         AND state_revision = $13
         AND status = ANY($14::battle_status[])
       RETURNING ${BATTLE_ROW_METADATA_COLUMNS}`,
      [
        JSON.stringify(nextFlatState),
        nextLifecycle.status,
        nextLifecycle.winnerId,
        nextLifecycle.rewards === null ? null : JSON.stringify(nextLifecycle.rewards),
        nextLifecycle.endedAt,
        envelope.mapSeed,
        envelope.mapWidth,
        envelope.mapHeight,
        envelope.battleMapSchemaVersion,
        envelope.terrainGenerationVersion,
        envelope.fullHash,
        envelope.battleId,
        expectedRevision,
        allowedStatuses
      ]
    );
    if (updateResult.rows.length === 0) {
      throw new BattleStateConflictError(
        `Battle ${envelope.battleId} changed while committing ${commandType}`,
        { battleId: envelope.battleId, expectedRevision }
      );
    }

    const reference = mapReference(envelope.map);
    const storedResult = {
      battleId: envelope.battleId,
      ...reference,
      baseStateRevision: expectedRevision,
      stateRevision: nextRevision,
      mutableState: nextMutableState
    };
    if (replayMetadata !== undefined) {
      storedResult.replayMetadata = deepCloneJsonValue(replayMetadata);
    }
    await transactionClient.query(
      `INSERT INTO battle_command_results (
         battle_id,
         idempotency_key,
         command_type,
         request_hash,
         base_state_revision,
         state_revision,
         result
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        envelope.battleId,
        idempotencyKey,
        commandType,
        requestHash,
        expectedRevision,
        nextRevision,
        JSON.stringify(storedResult)
      ]
    );

    const committedEnvelope = committedEnvelopeFromRow(
      updateResult.rows[0],
      envelope,
      nextMutableState,
      nextFlatState,
      nextRevision
    );
    const update = createBattleMutableStateUpdateV1(storedResult);
    return deepFreeze({
      ...storedResult,
      update,
      envelope: committedEnvelope,
      idempotent: false
    });
  }
}

export function createBattleStateRepository(dependencies) {
  return new BattleStateRepository(dependencies);
}

export const battleStateRepository = createBattleStateRepository();

export const loadBattle = (...args) => battleStateRepository.loadBattle(...args);
export const loadBattleForParticipant = (...args) =>
  battleStateRepository.loadBattleForParticipant(...args);
export const findActiveBattleForPlayer = (...args) =>
  battleStateRepository.findActiveBattleForPlayer(...args);
export const hasActiveBattleForPlayer = (...args) =>
  battleStateRepository.hasActiveBattleForPlayer(...args);
export const hasActiveBattleForAnyPlayer = (...args) =>
  battleStateRepository.hasActiveBattleForAnyPlayer(...args);
export const findCommandReceipt = (...args) =>
  battleStateRepository.findCommandReceipt(...args);
export const createBattle = (...args) => battleStateRepository.createBattle(...args);
export const commitMutableState = (...args) =>
  battleStateRepository.commitMutableState(...args);
export const commitBattleState = (...args) =>
  battleStateRepository.commitBattleState(...args);
export const commitLegacyState = (...args) =>
  battleStateRepository.commitLegacyState(...args);
export const completeBattle = (...args) => battleStateRepository.completeBattle(...args);

export default battleStateRepository;
