/**
 * Atomic, player-preserving replacement of the generated world graph.
 *
 * The planner is deliberately read-only. Execution always repeats planning
 * after acquiring transaction-scoped locks and requires the caller to confirm
 * the resulting deterministic hash.
 */

import { createHash } from 'node:crypto';

import {
  SEED_VERSION,
  insertConnections,
  insertNodes,
  insertObstacles,
  insertRegions,
  saveSeedMetadata,
  seedShopInventory,
  updateRegionReferences,
  validatePersistedWorld,
} from './seed.js';
import {
  assembleWorld,
  calculateWorldOutputHash,
} from './worldgen/worldAssembly.js';
import {
  canonicalKeyCompare,
  canonicalStringify,
  parseWorldSeed,
} from './worldgen/randomStreams.js';
import { validateFinalizedWorld } from './worldgen/validation.js';
import {
  buildWorldMigrationMappingPlan,
  expandFullCombatClearance,
  mergeDiscoveryRecords,
  remapNodeProgress,
} from './worldMigrationMapping.js';

const MIGRATION_LOCK_KEY = 'modia:player-preserving-world-migration:v1';
const COMBAT_TYPES = new Set(['forest', 'cave', 'mountain', 'bridge']);

const GRAPH_REFERENCES = new Set([
  'public.world_node_connections.from_node_id',
  'public.world_node_connections.to_node_id',
  'public.world_nodes.opening_destination_node_key',
  'public.world_regions.castle_node_id',
  'public.world_regions.keep_node_id',
  'public.world_regions.guild_node_id',
]);

/**
 * This allowlist is intentionally explicit. A newly added world_nodes FK must
 * receive a preservation policy here before a live migration may proceed.
 */
export const HANDLED_WORLD_NODE_REFERENCES = Object.freeze([
  ...GRAPH_REFERENCES,
  'public.characters.current_node_id',
  'public.battles.node_id',
  'public.chat_messages.node_id',
  'public.npc_shop_inventory.node_id',
  'public.shop_transactions.node_id',
  'public.player_presence.current_node_id',
  'public.parties.current_node_id',
  'public.guild_recruits.node_id',
  'public.user_node_discovery.node_id',
  'public.user_node_clearance.node_id',
  'public.user_chest_claims.node_id',
  'public.user_shrine_visits.node_id',
  'public.user_discoveries.node_id',
  'public.user_fishing_catches.node_id',
  'public.user_ruins_completions.node_id',
  'public.user_watchtower_activations.node_id',
  'public.user_caravan_transactions.node_id',
  'public.fast_travel_log.from_node_id',
  'public.fast_travel_log.to_node_id',
  'public.stamina_restore_log.node_id',
  'public.user_zodiac_crystals.shrine_node_id',
  'public.user_caravan_visits.node_id',
  'public.garrison_recruits.castle_node_id',
].sort());

const MERGED_REFERENCE_TABLES = new Set([
  'public.user_node_discovery',
  'public.user_node_clearance',
]);

const REGENERATED_REFERENCE_TABLES = new Set([
  'public.npc_shop_inventory',
]);

const TYPE_RESTRICTED_REFERENCES = Object.freeze({
  'public.guild_recruits.node_id': new Set(['guild']),
  'public.user_node_clearance.node_id': COMBAT_TYPES,
  'public.user_chest_claims.node_id': new Set(['chest']),
  'public.user_shrine_visits.node_id': new Set(['shrine']),
  'public.user_discoveries.node_id': new Set(['discovery']),
  'public.user_fishing_catches.node_id': new Set(['fishing_spot']),
  'public.user_ruins_completions.node_id': new Set(['ruins']),
  'public.user_watchtower_activations.node_id': new Set(['watchtower']),
  'public.user_caravan_transactions.node_id': new Set([
    'caravan',
    'merchant_caravan',
  ]),
  'public.user_zodiac_crystals.shrine_node_id': new Set(['shrine']),
  'public.user_caravan_visits.node_id': new Set([
    'caravan',
    'merchant_caravan',
  ]),
  'public.garrison_recruits.castle_node_id': new Set(['castle']),
});

const COLLISION_KEYS = Object.freeze({
  'public.user_chest_claims': ['user_id'],
  'public.user_shrine_visits': ['user_id'],
  'public.user_discoveries': ['user_id'],
  'public.user_ruins_completions': ['user_id'],
  'public.user_watchtower_activations': ['user_id'],
  'public.user_caravan_visits': ['user_id'],
});

const SEMANTIC_REFERENCE_COLUMNS = Object.freeze({
  'public.user_shrine_visits': ['buff_type'],
  'public.user_discoveries': ['lore_key'],
  'public.user_ruins_completions': [
    'puzzle_solved',
    'reward_claimed',
  ],
  'public.user_zodiac_crystals': ['zodiac_sign'],
});

const BASE_LOCK_TABLES = Object.freeze([
  'world_nodes',
  'world_node_connections',
  'world_regions',
  'world_obstacles',
  'seed_metadata',
  'character_quests',
  'world_migration_runs',
  'world_migration_node_maps',
  'world_migration_progress_archive',
]);

const PRESERVATION_INVENTORY_TABLES = Object.freeze([
  'users',
  'characters',
  'character_items',
  'character_skills',
  'character_traits',
  'character_quests',
  'user_node_discovery',
  'user_node_clearance',
]);

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function qualifiedName(schema, table) {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function referenceKey(reference) {
  return `${reference.schemaName}.${reference.tableName}.${reference.columnName}`;
}

function tableKey(reference) {
  return `${reference.schemaName}.${reference.tableName}`;
}

function sha256(value) {
  return createHash('sha256')
    .update(canonicalStringify(toPlainJson(value)))
    .digest('hex');
}

function toPlainJson(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (Array.isArray(value)) return value.map(toPlainJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, toPlainJson(child)])
    );
  }
  return value;
}

function assertValidWorld(world, label) {
  if (world?.validation?.valid !== true
      || (world.validation.errors?.length ?? 0) > 0) {
    const codes = (world?.validation?.errors ?? [])
      .slice(0, 10)
      .map((issue) => issue.code ?? issue.message ?? String(issue));
    throw new Error(
      `${label} failed hard validation`
      + (codes.length > 0 ? `: ${codes.join(', ')}` : '')
    );
  }
}

async function generateDeterministicTarget(seed, assemble) {
  const first = await assemble({ seed });
  const second = await assemble({ seed });
  assertValidWorld(first, 'First target generation');
  assertValidWorld(second, 'Second target generation');

  const firstHash = sha256(first);
  const secondHash = sha256(second);
  if (firstHash !== secondHash) {
    throw new Error(
      'Target world generation is nondeterministic: '
      + `${firstHash} != ${secondHash}`
    );
  }
  return { world: first, generationHash: firstHash };
}

const RUINS_OVERLAY_ALGORITHM_VERSION = 1;
const RUINS_COMPLETION_REFERENCE =
  'public.user_ruins_completions.node_id';

function ruinsSemantics(node) {
  const rawTier = node?.ruins_reward_tier ?? node?.ruinsTier;
  return {
    ruinsTier: rawTier == null ? null : Number(rawTier),
    ruinsPuzzleType:
      node?.ruins_puzzle_type ?? node?.ruinsPuzzleType ?? null,
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareRuinsCarrierCandidates(left, right, legacy, required) {
  const legacyKey = legacy.node_key ?? legacy.nodeKey ?? null;
  const legacyRegionId = finiteNumber(legacy.region_id ?? legacy.regionId);
  const legacyRegionRace = legacy.region_race ?? legacy.regionRace ?? null;
  const legacyDifficulty = finiteNumber(
    legacy.difficulty_tier ?? legacy.difficultyTier
  );
  const legacyX = finiteNumber(legacy.x_coord ?? legacy.xCoord);
  const legacyY = finiteNumber(legacy.y_coord ?? legacy.yCoord);
  const rank = (candidate) => {
    const semantics = ruinsSemantics(candidate);
    const candidateRegionId = finiteNumber(candidate.regionId);
    const candidateDifficulty = finiteNumber(candidate.difficultyTier);
    const candidateX = finiteNumber(candidate.xCoord);
    const candidateY = finiteNumber(candidate.yCoord);
    return [
      semantics.ruinsTier === required.ruinsTier
        && semantics.ruinsPuzzleType === required.ruinsPuzzleType ? 0 : 1,
      candidate.nodeKey === legacyKey ? 0 : 1,
      legacyRegionId != null && candidateRegionId === legacyRegionId ? 0 : 1,
      legacyRegionRace != null && candidate.regionRace === legacyRegionRace
        ? 0
        : 1,
      legacyDifficulty != null && candidateDifficulty != null
        ? Math.abs(candidateDifficulty - legacyDifficulty)
        : Number.POSITIVE_INFINITY,
      legacyX != null && legacyY != null
        && candidateX != null && candidateY != null
        ? ((candidateX - legacyX) ** 2) + ((candidateY - legacyY) ** 2)
        : Number.POSITIVE_INFINITY,
    ];
  };
  const leftRank = rank(left);
  const rightRank = rank(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) {
      return leftRank[index] - rightRank[index];
    }
  }
  return canonicalKeyCompare(left.nodeKey, right.nodeKey);
}

function applyRuinsSemanticOverlay(
  source,
  baseTargetWorld,
  validateWorld = validateFinalizedWorld
) {
  const completionRows =
    source.collisionRows?.[RUINS_COMPLETION_REFERENCE] ?? [];
  if (completionRows.length === 0) {
    return {
      world: baseTargetWorld,
      manifest: null,
      carrierByLegacyId: {},
    };
  }

  const legacyById = new Map(
    source.legacyNodes.map((node) => [Number(node.id), node])
  );
  const completionRowsByLegacyId = new Map();
  for (const row of completionRows) {
    const legacyNodeId = Number(row.node_id);
    if (!Number.isInteger(legacyNodeId)) {
      throw new Error(
        `${RUINS_COMPLETION_REFERENCE} contains an invalid legacy node ID`
      );
    }
    const rows = completionRowsByLegacyId.get(legacyNodeId) ?? [];
    rows.push(row);
    completionRowsByLegacyId.set(legacyNodeId, rows);
  }

  const world = structuredClone(baseTargetWorld);
  const available = world.nodes
    .filter((node) => node.nodeType === 'ruins')
    .sort((left, right) =>
      canonicalKeyCompare(left.nodeKey, right.nodeKey)
    );
  if (available.length < completionRowsByLegacyId.size) {
    throw new Error(
      'Cannot preserve completed ruins: target world has '
      + `${available.length} ruins carrier(s) for `
      + `${completionRowsByLegacyId.size} referenced legacy ruins node(s)`
    );
  }

  const assignments = [];
  const carrierByLegacyId = {};
  for (const legacyNodeId of [...completionRowsByLegacyId.keys()]
    .sort((left, right) => left - right)) {
    const legacy = legacyById.get(legacyNodeId);
    const required = ruinsSemantics(legacy);
    if (legacy?.node_type !== 'ruins'
        || !Number.isInteger(required.ruinsTier)
        || required.ruinsTier < 1
        || required.ruinsTier > 3) {
      throw new Error(
        `${RUINS_COMPLETION_REFERENCE} legacy node ${legacyNodeId} `
        + 'has invalid ruins semantics'
      );
    }

    available.sort((left, right) =>
      compareRuinsCarrierCandidates(left, right, legacy, required)
    );
    const carrier = available.shift();
    const before = ruinsSemantics(carrier);
    carrier.ruinsTier = required.ruinsTier;
    carrier.ruinsPuzzleType = required.ruinsPuzzleType;
    const rows = completionRowsByLegacyId.get(legacyNodeId);
    carrierByLegacyId[legacyNodeId] = carrier.nodeKey;
    assignments.push({
      sourceLegacyNodeId: legacyNodeId,
      sourceLegacyNodeKey:
        legacy.node_key ?? legacy.nodeKey ?? `legacy-node-${legacyNodeId}`,
      targetNodeKey: carrier.nodeKey,
      before,
      after: required,
      changed: canonicalStringify(before) !== canonicalStringify(required),
      affectedCompletionCount: rows.length,
      affectedUserCount: new Set(
        rows.map((row) => String(row.user_id))
      ).size,
      reason: 'preserve_completed_ruins_semantics',
    });
  }

  const manifestPayload = {
    kind: 'player_progression_semantic_overlay',
    algorithmVersion: RUINS_OVERLAY_ALGORITHM_VERSION,
    baseTargetMetadata: toPlainJson(baseTargetWorld.metadata),
    assignments,
  };
  const manifest = {
    ...manifestPayload,
    overlayHash: sha256(manifestPayload),
  };
  world.metadata = {
    ...world.metadata,
    outputHash: calculateWorldOutputHash(world),
    migrationOverlay: manifest,
  };
  world.validation = validateWorld(world);
  assertValidWorld(world, 'Semantically overlaid target generation');

  return { world, manifest, carrierByLegacyId };
}

async function enumerateWorldNodeReferences(client) {
  const result = await client.query(`
    SELECT ns.nspname AS schema_name,
           child.relname AS table_name,
           child_column.attname AS column_name,
           target_column.attname AS target_column_name,
           constraint_row.conname AS constraint_name,
           cardinality(constraint_row.conkey) AS column_count
    FROM pg_constraint constraint_row
    JOIN pg_class child ON child.oid = constraint_row.conrelid
    JOIN pg_namespace ns ON ns.oid = child.relnamespace
    JOIN pg_class target ON target.oid = constraint_row.confrelid
    JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
    JOIN LATERAL unnest(constraint_row.conkey)
      WITH ORDINALITY AS child_key(attnum, ordinal) ON TRUE
    JOIN LATERAL unnest(constraint_row.confkey)
      WITH ORDINALITY AS target_key(attnum, ordinal)
      ON target_key.ordinal = child_key.ordinal
    JOIN pg_attribute child_column
      ON child_column.attrelid = child.oid
     AND child_column.attnum = child_key.attnum
    JOIN pg_attribute target_column
      ON target_column.attrelid = target.oid
     AND target_column.attnum = target_key.attnum
    WHERE constraint_row.contype = 'f'
      AND target_ns.nspname = 'public'
      AND target.relname = 'world_nodes'
    ORDER BY ns.nspname, child.relname, child_column.attname
  `);
  return result.rows.map((row) => ({
    schemaName: row.schema_name,
    tableName: row.table_name,
    columnName: row.column_name,
    targetColumnName: row.target_column_name,
    constraintName: row.constraint_name,
    columnCount: Number(row.column_count),
  }));
}

function assertKnownReferences(references) {
  const composite = references
    .filter((reference) => (reference.columnCount ?? 1) !== 1)
    .map((reference) => reference.constraintName);
  if (composite.length > 0) {
    throw new Error(
      'Composite foreign key(s) to world_nodes require an explicit migration '
      + `policy: ${[...new Set(composite)].sort().join(', ')}`
    );
  }
  const handled = new Set(HANDLED_WORLD_NODE_REFERENCES);
  const unknown = references
    .map(referenceKey)
    .filter((key) => !handled.has(key));
  if (unknown.length > 0) {
    throw new Error(
      'Unhandled single-column foreign key(s) to world_nodes: '
      + unknown.join(', ')
    );
  }
}

async function loadReferenceValues(client, references) {
  const values = {};
  for (const reference of references) {
    if (reference.targetColumnName !== 'id'
        || GRAPH_REFERENCES.has(referenceKey(reference))
        || REGENERATED_REFERENCE_TABLES.has(tableKey(reference))) {
      continue;
    }
    const result = await client.query(
      `SELECT ${quoteIdentifier(reference.columnName)} AS node_id
       FROM ${qualifiedName(reference.schemaName, reference.tableName)}
       WHERE ${quoteIdentifier(reference.columnName)} IS NOT NULL`
    );
    values[referenceKey(reference)] = result.rows
      .map((row) => Number(row.node_id))
      .sort((left, right) => left - right);
  }
  return values;
}

async function loadCollisionRows(client, references) {
  const rowsByReference = {};
  for (const reference of references) {
    const extraColumns = [
      ...new Set([
        ...(COLLISION_KEYS[tableKey(reference)] ?? []),
        ...(SEMANTIC_REFERENCE_COLUMNS[tableKey(reference)] ?? []),
      ]),
    ];
    if (extraColumns.length === 0) continue;
    const result = await client.query(
      `SELECT ${[
        reference.columnName,
        ...extraColumns,
      ].map(quoteIdentifier).join(', ')}
       FROM ${qualifiedName(reference.schemaName, reference.tableName)}
       WHERE ${quoteIdentifier(reference.columnName)} IS NOT NULL`
    );
    rowsByReference[referenceKey(reference)] = result.rows;
  }
  return rowsByReference;
}

async function loadMergeRows(client) {
  // These are TIMESTAMP WITHOUT TIME ZONE columns. Keep their database
  // wall-clock values as text so JavaScript timezone conversion cannot shift
  // them when collision-merged rows are reinserted.
  const discovery = await client.query(`
    SELECT user_id, node_id, discovery_method,
           to_char(
             discovered_at,
             'YYYY-MM-DD"T"HH24:MI:SS.US'
           ) AS discovered_at
    FROM user_node_discovery
    ORDER BY user_id, node_id, discovered_at
  `);
  const clearance = await client.query(`
    SELECT user_id, node_id,
           to_char(
             cleared_at,
             'YYYY-MM-DD"T"HH24:MI:SS.US'
           ) AS cleared_at,
           battle_id
    FROM user_node_clearance
    ORDER BY user_id, cleared_at, node_id
  `);
  return {
    discovery: discovery.rows,
    clearance: clearance.rows,
  };
}

async function fingerprintSourceStateTables(client, references) {
  const tableNames = new Set(['character_quests']);
  for (const reference of references) {
    if (!GRAPH_REFERENCES.has(referenceKey(reference))) {
      tableNames.add(reference.tableName);
    }
  }
  const fingerprints = {};
  for (const tableName of [...tableNames].sort()) {
    const result = await client.query(
      `SELECT row_to_json(source_row) AS source_row
       FROM ${qualifiedName('public', tableName)} source_row`
    );
    const rows = result.rows
      .map((row) => toPlainJson(row.source_row))
      .sort((left, right) =>
        canonicalStringify(left).localeCompare(canonicalStringify(right))
      );
    fingerprints[tableName] = {
      rowCount: rows.length,
      hash: sha256(rows),
    };
  }
  return fingerprints;
}

async function loadCharacterLocations(client, targetWorld) {
  const result = await client.query(`
    SELECT characters.id AS character_id,
           characters.current_node_id AS node_id,
           world_regions.race AS home_region_race
    FROM characters
    LEFT JOIN world_regions
      ON world_regions.id = characters.home_region_id
    WHERE characters.current_node_id IS NOT NULL
    ORDER BY characters.id
  `);
  const castleByRace = new Map(
    targetWorld.nodes
      .filter((node) => node.nodeType === 'castle')
      .map((node) => [node.regionRace, node.nodeKey])
  );
  return result.rows.map((row) => ({
    characterId: row.character_id,
    nodeId: Number(row.node_id),
    homeCastleNodeKey: castleByRace.get(row.home_region_race) ?? null,
  }));
}

async function loadBattleNodes(client) {
  const result = await client.query(`
    SELECT id AS battle_id, node_id, status
    FROM battles
    WHERE node_id IS NOT NULL
    ORDER BY id
  `);
  return result.rows.map((row) => ({
    battleId: row.battle_id,
    nodeId: Number(row.node_id),
    status: row.status,
  }));
}

async function fingerprintProtectedTables(client, references) {
  const omittedColumns = new Map();
  for (const reference of references) {
    const key = tableKey(reference);
    if (GRAPH_REFERENCES.has(referenceKey(reference))
        || MERGED_REFERENCE_TABLES.has(key)
        || REGENERATED_REFERENCE_TABLES.has(key)) {
      continue;
    }
    const columns = omittedColumns.get(reference.tableName) ?? new Set();
    columns.add(reference.columnName);
    omittedColumns.set(reference.tableName, columns);
  }
  omittedColumns.set('character_quests', new Set(['node_progress']));

  const excluded = new Set([
    'world_nodes',
    'world_node_connections',
    'world_regions',
    'world_obstacles',
    'seed_metadata',
    'world_migration_runs',
    'world_migration_node_maps',
    'world_migration_progress_archive',
    ...[...MERGED_REFERENCE_TABLES, ...REGENERATED_REFERENCE_TABLES]
      .map((key) => key.split('.')[1]),
  ]);
  const tables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const fingerprints = {};
  for (const { table_name: tableName } of tables.rows) {
    if (excluded.has(tableName)) continue;
    const columns = [...(omittedColumns.get(tableName) ?? [])].sort();
    const rows = await client.query(
      `SELECT (to_jsonb(source_row) - $1::text[]) AS source_row
       FROM ${qualifiedName('public', tableName)} source_row`
      ,
      [columns]
    );
    fingerprints[tableName] = {
      rowCount: rows.rows.length,
      hash: sha256(
        rows.rows
          .map((row) => toPlainJson(row.source_row))
          .sort((left, right) =>
            canonicalStringify(left).localeCompare(canonicalStringify(right))
          )
      ),
    };
  }
  return fingerprints;
}

async function loadSourceState(client, targetWorld, dependencies) {
  const nodes = await client.query('SELECT * FROM world_nodes ORDER BY id');
  const regions = await client.query(`
    SELECT id, race, castle_key, generator_x, generator_y
    FROM world_regions
    ORDER BY id
  `);
  const metadata = await client.query(
    'SELECT * FROM seed_metadata WHERE id = 1'
  );
  const quests = await client.query(
    'SELECT id, node_progress FROM character_quests ORDER BY id'
  );
  const references = await (
    dependencies.enumerateWorldNodeReferences
    ?? enumerateWorldNodeReferences
  )(client);
  assertKnownReferences(references);
  const referenceValues = await (
    dependencies.loadReferenceValues ?? loadReferenceValues
  )(client, references);
  const characterLocations = await (
    dependencies.loadCharacterLocations ?? loadCharacterLocations
  )(client, targetWorld);
  const battleNodes = await (
    dependencies.loadBattleNodes ?? loadBattleNodes
  )(client);
  const activeBattleNodes = battleNodes
    .filter((battle) => battle.status === 'active');
  const protectedFingerprints = await (
    dependencies.fingerprintProtectedTables ?? fingerprintProtectedTables
  )(client, references);
  const collisionRows = await (
    dependencies.loadCollisionRows ?? loadCollisionRows
  )(client, references);
  const sourceStateFingerprints = await (
    dependencies.fingerprintSourceStateTables
    ?? fingerprintSourceStateTables
  )(client, references);
  const mergeRows = await (
    dependencies.loadMergeRows ?? loadMergeRows
  )(client);
  return toPlainJson({
    legacyNodes: nodes.rows,
    persistedRegionIdentities: regions.rows,
    sourceMetadata: metadata.rows[0] ?? {},
    references,
    referenceValues,
    characterLocations,
    battleNodes,
    activeBattleNodes,
    protectedFingerprints,
    collisionRows,
    sourceStateFingerprints,
    mergeRows,
    questProgress: quests.rows,
  });
}

function assertLiveReferencesMapped(source, mappingPlan, targetWorld) {
  const mappingById = new Map(
    mappingPlan.mappings.map((mapping) => [mapping.legacyNodeId, mapping])
  );
  const targetByKey = new Map(
    targetWorld.nodes.map((node) => [node.nodeKey, node])
  );
  const characterFallbackIds = new Set(
    mappingPlan.criticalReferences.characterLocations
      .filter((reference) => reference.method === 'home_castle_fallback')
      .map((reference) => reference.legacyNodeId)
  );

  for (const [key, nodeIds] of Object.entries(source.referenceValues)) {
    for (const nodeId of new Set(nodeIds)) {
      const mapping = mappingById.get(nodeId);
      if (!mapping
          && !(key === 'public.characters.current_node_id'
            && characterFallbackIds.has(nodeId))) {
        throw new Error(`Cannot preserve live ${key} reference to node ${nodeId}`);
      }
      if (!mapping) continue;
      const allowedTypes = TYPE_RESTRICTED_REFERENCES[key];
      if (allowedTypes
          && !allowedTypes.has(targetByKey.get(mapping.targetNodeKey)?.nodeType)) {
        throw new Error(
          `Incompatible ${key} mapping from node ${nodeId} `
          + `to ${mapping.targetNodeKey}`
        );
      }
    }
  }

  const legacyById = new Map(source.legacyNodes.map((node) => [node.id, node]));
  for (const battle of source.battleNodes) {
    if (battle.status === 'active') continue;
    const mapping = mappingById.get(battle.nodeId);
    const sourceNode = legacyById.get(battle.nodeId);
    const sourceType = sourceNode?.node_type ?? sourceNode?.nodeType;
    const targetType = targetByKey.get(mapping?.targetNodeKey)?.nodeType;
    if (!mapping || sourceType !== targetType) {
      throw new Error(
        `Battle ${battle.battleId} (${battle.status ?? 'unknown'}) cannot move `
        + `from ${sourceType ?? 'missing'} node ${battle.nodeId} to `
        + `${targetType ?? 'missing'}; battle history requires the exact node type`
      );
    }
  }

  for (const battle of source.activeBattleNodes) {
    const mapping = mappingById.get(battle.nodeId);
    const sourceNode = legacyById.get(battle.nodeId);
    const sourceType = sourceNode?.node_type ?? sourceNode?.nodeType;
    const targetType = targetByKey.get(mapping?.targetNodeKey)?.nodeType;
    if (!mapping
        || !COMBAT_TYPES.has(sourceType)
        || !COMBAT_TYPES.has(targetType)
        || sourceType !== targetType) {
      throw new Error(
        `Active battle ${battle.battleId} cannot move from `
        + `${sourceType ?? 'missing'} node ${battle.nodeId} to `
        + `${targetType ?? 'missing'}`
      );
    }
  }

  const targetOrdinalByKey = new Map(
    targetWorld.nodes.map((node, index) => [node.nodeKey, index + 1])
  );
  const questMapping = new Map(
    mappingPlan.mappings.map((mapping) => [
      mapping.legacyNodeId,
      targetOrdinalByKey.get(mapping.targetNodeKey),
    ])
  );
  for (const quest of source.questProgress ?? []) {
    try {
      remapNodeProgress(quest.node_progress, questMapping);
    } catch (error) {
      throw new Error(
        `Cannot preserve character_quests.node_progress for quest ${quest.id}`,
        { cause: error }
      );
    }
  }
}

function regionIdentity(region) {
  return {
    id: Number(region.id),
    race: region.race ?? region.regionRace ?? null,
    castleKey: region.castle_key ?? region.castleKey ?? null,
    generatorX: region.generator_x
      ?? region.generatorPoint?.x
      ?? null,
    generatorY: region.generator_y
      ?? region.generatorPoint?.y
      ?? null,
  };
}

function buildRegionIdentityReport(sourceRegions, targetRegions) {
  const source = sourceRegions.map(regionIdentity)
    .sort((left, right) => left.id - right.id);
  const target = targetRegions.map(regionIdentity)
    .sort((left, right) => left.id - right.id);
  const targetById = new Map(target.map((region) => [region.id, region]));
  const compatibility = [];

  for (const sourceRegion of source) {
    const targetRegion = targetById.get(sourceRegion.id);
    if (!targetRegion) {
      throw new Error(
        `Target world omits persisted region identity ${sourceRegion.id}`
      );
    }
    if (sourceRegion.race != null && sourceRegion.race !== targetRegion.race) {
      throw new Error(
        `Persisted region ${sourceRegion.id} race is incompatible with `
        + 'the target world'
      );
    }
    const sourceTriple = [
      sourceRegion.castleKey,
      sourceRegion.generatorX,
      sourceRegion.generatorY,
    ];
    const targetTriple = [
      targetRegion.castleKey,
      targetRegion.generatorX,
      targetRegion.generatorY,
    ];
    const isUninitialized = sourceTriple.every((value) => value == null);
    if (!isUninitialized
        && canonicalStringify(sourceTriple)
          !== canonicalStringify(targetTriple)) {
      throw new Error(
        `Persisted region ${sourceRegion.id} generator identity is incompatible `
        + 'with the target world'
      );
    }
    compatibility.push({
      id: sourceRegion.id,
      status: isUninitialized ? 'initialization' : 'unchanged',
      source: sourceRegion,
      target: targetRegion,
    });
  }

  const sourceIds = new Set(source.map((region) => region.id));
  for (const targetRegion of target) {
    if (!sourceIds.has(targetRegion.id)) {
      compatibility.push({
        id: targetRegion.id,
        status: 'added',
        source: null,
        target: targetRegion,
      });
    }
  }
  compatibility.sort((left, right) => left.id - right.id);
  return {
    persistedRegionCount: source.length,
    targetRegionCount: target.length,
    initializedCount: compatibility
      .filter(({ status }) => status === 'initialization').length,
    unchangedCount: compatibility
      .filter(({ status }) => status === 'unchanged').length,
    addedCount: compatibility
      .filter(({ status }) => status === 'added').length,
    compatibility,
  };
}

function buildCharacterFallbackAudit(mappingPlan, legacyNodes, targetNodes) {
  const legacyById = new Map(
    legacyNodes.map((node) => [Number(node.id), node])
  );
  const targetByKey = new Map(
    targetNodes.map((node) => [node.nodeKey, node])
  );
  return mappingPlan.criticalReferences.characterLocations
    .filter((reference) => reference.method === 'home_castle_fallback')
    .map((reference) => {
      const legacy = legacyById.get(Number(reference.legacyNodeId));
      const target = targetByKey.get(reference.targetNodeKey);
      return {
        kind: reference.kind,
        characterId: reference.referenceId,
        legacyNodeId: reference.legacyNodeId,
        legacyNodeKey: legacy?.node_key ?? legacy?.nodeKey ?? null,
        legacyNodeType: legacy?.node_type ?? legacy?.nodeType ?? null,
        targetNodeKey: reference.targetNodeKey,
        targetNodeType: target?.nodeType ?? null,
        method: reference.method,
        reason: reference.reason,
      };
    })
    .sort((left, right) =>
      canonicalKeyCompare(String(left.characterId), String(right.characterId))
      || Number(left.legacyNodeId) - Number(right.legacyNodeId)
      || canonicalKeyCompare(left.targetNodeKey, right.targetNodeKey)
    );
}

function mappedNodePairs(source, mappingPlan, targetWorld) {
  const legacyById = new Map(source.legacyNodes.map((node) => [
    Number(node.id),
    node,
  ]));
  const targetByKey = new Map(
    targetWorld.nodes.map((node) => [node.nodeKey, node])
  );
  return new Map(mappingPlan.mappings.map((mapping) => [
    mapping.legacyNodeId,
    {
      legacy: legacyById.get(mapping.legacyNodeId),
      target: targetByKey.get(mapping.targetNodeKey),
    },
  ]));
}

function zodiacSignForNode(node) {
  const explicit = node?.zodiac_sign ?? node?.zodiacSign;
  if (explicit != null) return explicit;
  const buffType = node?.shrine_buff_type ?? node?.shrineBuffType;
  return typeof buffType === 'string' && buffType.startsWith('zodiac_')
    ? buffType.slice('zodiac_'.length)
    : null;
}

function shrineBuffForNode(node) {
  const zodiacSign = zodiacSignForNode(node);
  return zodiacSign == null
    ? node?.shrine_buff_type ?? node?.shrineBuffType ?? null
    : `zodiac_${zodiacSign}`;
}

function buildSemanticTargetEligibility(
  source,
  targetWorld,
  ruinsCarrierByLegacyId = {}
) {
  const legacyById = new Map(source.legacyNodes.map((node) => [
    Number(node.id),
    node,
  ]));
  const constraints = new Map();
  const rowsFor = (key) => source.collisionRows?.[key] ?? [];

  const constrain = ({
    reference,
    row,
    columnName,
    failure,
    legacyMatches = () => true,
    targetMatches,
  }) => {
    const legacyNodeId = Number(row[columnName]);
    const legacy = legacyById.get(legacyNodeId);
    if (!legacy || !legacyMatches(legacy)) {
      throw new Error(`${reference} node ${legacyNodeId} ${failure}`);
    }

    const compatibleKeys = new Set(
      targetWorld.nodes
        .filter(targetMatches)
        .map((node) => node.nodeKey)
    );
    const existing = constraints.get(legacyNodeId);
    const allowed = existing === undefined
      ? compatibleKeys
      : new Set([...existing].filter((key) => compatibleKeys.has(key)));
    if (allowed.size === 0) {
      throw new Error(`${reference} node ${legacyNodeId} ${failure}`);
    }
    constraints.set(legacyNodeId, allowed);
  };

  for (const battle of source.battleNodes) {
    const legacyNodeId = Number(battle.nodeId);
    const legacy = legacyById.get(legacyNodeId);
    const expectedNodeType = legacy?.node_type ?? legacy?.nodeType;
    const battleReference = `public.battles.node_id battle ${battle.battleId} `
      + `(${battle.status ?? 'unknown'})`;
    constrain({
      reference: battleReference,
      row: { node_id: legacyNodeId },
      columnName: 'node_id',
      failure: `cannot preserve exact node type ${expectedNodeType ?? 'missing'}`,
      legacyMatches: () =>
        typeof expectedNodeType === 'string' && expectedNodeType.length > 0,
      targetMatches: (node) => node.nodeType === expectedNodeType,
    });
  }

  const zodiacKey = 'public.user_zodiac_crystals.shrine_node_id';
  for (const row of rowsFor(zodiacKey)) {
    const expectedSign = row.zodiac_sign;
    constrain({
      reference: zodiacKey,
      row,
      columnName: 'shrine_node_id',
      failure: `cannot preserve zodiac sign ${expectedSign}`,
      legacyMatches: (node) => zodiacSignForNode(node) === expectedSign,
      targetMatches: (node) =>
        node.nodeType === 'shrine'
        && zodiacSignForNode(node) === expectedSign,
    });
  }

  const shrineKey = 'public.user_shrine_visits.node_id';
  for (const row of rowsFor(shrineKey)) {
    const expectedBuff = row.buff_type;
    constrain({
      reference: shrineKey,
      row,
      columnName: 'node_id',
      failure: `cannot preserve shrine buff ${expectedBuff}`,
      legacyMatches: (node) => shrineBuffForNode(node) === expectedBuff,
      targetMatches: (node) =>
        node.nodeType === 'shrine'
        && shrineBuffForNode(node) === expectedBuff,
    });
  }

  const discoveryKey = 'public.user_discoveries.node_id';
  for (const row of rowsFor(discoveryKey)) {
    if (row.lore_key == null) continue;
    const expectedLoreKey = row.lore_key;
    constrain({
      reference: discoveryKey,
      row,
      columnName: 'node_id',
      failure: `cannot preserve lore key ${expectedLoreKey}`,
      targetMatches: (node) =>
        node.nodeType === 'discovery'
        && (node.loreKey ?? null) === expectedLoreKey,
    });
  }

  const ruinsKey = 'public.user_ruins_completions.node_id';
  for (const row of rowsFor(ruinsKey)) {
    const legacyNodeId = Number(row.node_id);
    const legacy = legacyById.get(legacyNodeId);
    const requiredCarrier = ruinsCarrierByLegacyId[legacyNodeId];
    if (typeof requiredCarrier !== 'string' || requiredCarrier.length === 0) {
      throw new Error(
        `${ruinsKey} node ${legacyNodeId} has no reserved target carrier`
      );
    }
    const legacyTier = Number(
      legacy?.ruins_reward_tier ?? legacy?.ruinsTier
    );
    const legacyPuzzleType = legacy?.ruins_puzzle_type
      ?? legacy?.ruinsPuzzleType
      ?? null;
    constrain({
      reference: ruinsKey,
      row,
      columnName: 'node_id',
      failure: 'cannot preserve ruins tier or puzzle semantics',
      legacyMatches: () => Number.isInteger(legacyTier),
      targetMatches: (node) =>
        node.nodeKey === requiredCarrier
        &&
        node.nodeType === 'ruins'
        && Number(node.ruinsTier) === legacyTier
        && (node.ruinsPuzzleType ?? null) === legacyPuzzleType,
    });
  }

  return Object.fromEntries(
    [...constraints.entries()]
      .sort(([left], [right]) => left - right)
      .map(([legacyNodeId, targetNodeKeys]) => [
        legacyNodeId,
        [...targetNodeKeys].sort((left, right) =>
          String(left).localeCompare(String(right), 'en', {
            numeric: true,
            sensitivity: 'base',
          })
        ),
      ])
  );
}

function assertSemanticReferencesPreserved(source, mappingPlan, targetWorld) {
  const pairs = mappedNodePairs(source, mappingPlan, targetWorld);
  const checks = [];
  const rowsFor = (key) => source.collisionRows?.[key] ?? [];
  const pairFor = (key, row, columnName) => {
    const legacyNodeId = Number(row[columnName]);
    const pair = pairs.get(legacyNodeId);
    if (!pair?.legacy || !pair?.target) {
      throw new Error(
        `Cannot semantic-check ${key} legacy node ${legacyNodeId}`
      );
    }
    return { legacyNodeId, ...pair };
  };

  const zodiacKey = 'public.user_zodiac_crystals.shrine_node_id';
  for (const row of rowsFor(zodiacKey)) {
    const pair = pairFor(zodiacKey, row, 'shrine_node_id');
    const expectedSign = row.zodiac_sign;
    if (zodiacSignForNode(pair.legacy) !== expectedSign
        || zodiacSignForNode(pair.target) !== expectedSign) {
      throw new Error(
        `${zodiacKey} node ${pair.legacyNodeId} cannot preserve zodiac sign `
        + expectedSign
      );
    }
    checks.push({ reference: zodiacKey, legacyNodeId: pair.legacyNodeId });
  }

  const shrineKey = 'public.user_shrine_visits.node_id';
  for (const row of rowsFor(shrineKey)) {
    const pair = pairFor(shrineKey, row, 'node_id');
    if (shrineBuffForNode(pair.legacy) !== row.buff_type
        || shrineBuffForNode(pair.target) !== row.buff_type) {
      throw new Error(
        `${shrineKey} node ${pair.legacyNodeId} cannot preserve shrine buff `
        + row.buff_type
      );
    }
    checks.push({ reference: shrineKey, legacyNodeId: pair.legacyNodeId });
  }

  const discoveryKey = 'public.user_discoveries.node_id';
  for (const row of rowsFor(discoveryKey)) {
    if (row.lore_key == null) continue;
    const pair = pairFor(discoveryKey, row, 'node_id');
    if ((pair.target.loreKey ?? null) !== row.lore_key) {
      throw new Error(
        `${discoveryKey} node ${pair.legacyNodeId} cannot preserve lore key `
        + row.lore_key
      );
    }
    checks.push({ reference: discoveryKey, legacyNodeId: pair.legacyNodeId });
  }

  const ruinsKey = 'public.user_ruins_completions.node_id';
  for (const row of rowsFor(ruinsKey)) {
    const pair = pairFor(ruinsKey, row, 'node_id');
    const legacyTier = Number(
      pair.legacy.ruins_reward_tier ?? pair.legacy.ruinsTier
    );
    const targetTier = Number(pair.target.ruinsTier);
    const legacyPuzzleType = pair.legacy.ruins_puzzle_type
      ?? pair.legacy.ruinsPuzzleType
      ?? null;
    const targetPuzzleType = pair.target.ruinsPuzzleType ?? null;
    if (!Number.isInteger(legacyTier)
        || legacyTier !== targetTier
        || legacyPuzzleType !== targetPuzzleType) {
      throw new Error(
        `${ruinsKey} node ${pair.legacyNodeId} cannot preserve ruins tier `
        + 'or puzzle semantics'
      );
    }
    checks.push({ reference: ruinsKey, legacyNodeId: pair.legacyNodeId });
  }

  return {
    checkedRowCount: checks.length,
    checks: checks.sort((left, right) =>
      left.reference.localeCompare(right.reference)
      || left.legacyNodeId - right.legacyNodeId
    ),
  };
}

function buildCollisionReport(source, mappingPlan) {
  const targetKeyByLegacyId = new Map(
    mappingPlan.mappings.map((mapping) => [
      mapping.legacyNodeId,
      mapping.targetNodeKey,
    ])
  );
  const checks = [];
  for (const reference of source.references) {
    const extraColumns = COLLISION_KEYS[tableKey(reference)];
    if (!extraColumns) continue;
    const rows = source.collisionRows?.[referenceKey(reference)] ?? [];
    const seen = new Set();
    for (const row of rows) {
      const legacyNodeId = Number(row[reference.columnName]);
      const targetNodeKey = targetKeyByLegacyId.get(legacyNodeId);
      if (!targetNodeKey) {
        throw new Error(
          `Cannot collision-check ${referenceKey(reference)} legacy node `
          + legacyNodeId
        );
      }
      const key = canonicalStringify([
        targetNodeKey,
        ...extraColumns.map((column) => row[column]),
      ]);
      if (seen.has(key)) {
        throw new Error(
          'Migration would collide with a unique reward/activity row in '
          + tableKey(reference)
        );
      }
      seen.add(key);
    }
    checks.push({
      reference: referenceKey(reference),
      uniqueColumns: [reference.columnName, ...extraColumns],
      sourceRowCount: rows.length,
      projectedUniqueRowCount: seen.size,
    });
  }
  return {
    checkedReferenceCount: checks.length,
    collisionCount: 0,
    checks,
  };
}

function planHashPayload(plan) {
  return {
    migrationKind: plan.migrationKind,
    sourceSeedVersion: plan.sourceSeedVersion,
    targetSeedVersion: plan.targetSeedVersion,
    worldSeed: plan.worldSeed,
    targetGenerationHash: plan.targetGenerationHash,
    targetOutputHash: plan.targetWorld.metadata.outputHash,
    sourceMetadata: plan.sourceMetadata,
    references: plan.references,
    referenceValues: plan.referenceValues,
    protectedFingerprints: plan.protectedFingerprints,
    sourceStateFingerprints: plan.sourceStateFingerprints,
    mergeRows: plan.mergeRows,
    legacyNodes: plan.legacyNodes,
    persistedRegionIdentities: plan.persistedRegionIdentities,
    regionIdentityReport: plan.regionIdentityReport,
    characterLocations: plan.characterLocations,
    battleNodes: plan.battleNodes,
    activeBattleNodes: plan.activeBattleNodes,
    characterFallbackRelocations: plan.characterFallbackRelocations,
    questProgress: plan.questProgress,
    collisionReport: plan.collisionReport,
    semanticReport: plan.semanticReport,
    semanticOverlay: plan.semanticOverlay,
    mapping: plan.mapping,
    coordinateShift: plan.coordinateShift,
  };
}

function calculateCoordinateShift(legacyNodes, targetNodes) {
  if (legacyNodes.length === 0) return 1;
  const oldXs = legacyNodes.map((node) => Number(node.x_coord));
  const oldYs = legacyNodes.map((node) => Number(node.y_coord));
  const targetXs = targetNodes.map((node) => Number(node.xCoord));
  if (![...oldXs, ...oldYs, ...targetXs].every(Number.isFinite)) {
    throw new Error('Cannot safely shift non-numeric world coordinates');
  }
  const positive = Math.max(...targetXs) - Math.min(...oldXs) + 1;
  const negative = Math.min(...targetXs) - Math.max(...oldXs) - 1;
  const isSafeIntegerShift = (shift) =>
    [...oldXs, ...oldYs].every((value) =>
      Number.isSafeInteger(value + shift)
      && value + shift >= -2147483648
      && value + shift <= 2147483647
    );
  if (isSafeIntegerShift(positive)) return positive;
  if (isSafeIntegerShift(negative)) return negative;
  throw new Error('Cannot shift legacy coordinates within PostgreSQL INTEGER range');
}

function buildPreservationInventory(source) {
  return Object.fromEntries(PRESERVATION_INVENTORY_TABLES.map((tableName) => {
    const fingerprint = source.sourceStateFingerprints?.[tableName]
      ?? source.protectedFingerprints?.[tableName];
    return [tableName, fingerprint?.rowCount ?? null];
  }));
}

/**
 * Build a deterministic migration plan without changing database state.
 */
export async function planPlayerPreservingWorldMigration({
  client,
  worldSeed,
  targetSeedVersion = SEED_VERSION,
  dependencies = {},
} = {}) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Planning requires a transaction-capable client');
  }
  if (targetSeedVersion !== SEED_VERSION) {
    throw new Error(
      `Target seed version ${targetSeedVersion} does not match `
      + `the current persistence version ${SEED_VERSION}`
    );
  }
  const seed = parseWorldSeed(worldSeed);
  const assemble = dependencies.assembleWorld ?? assembleWorld;
  const target = await generateDeterministicTarget(seed, assemble);
  const source = toPlainJson(
    await (dependencies.loadSourceState ?? loadSourceState)(
      client,
      target.world,
      dependencies
    )
  );
  source.collisionRows ??= {};
  source.sourceStateFingerprints ??= {};
  source.mergeRows ??= { discovery: [], clearance: [] };
  source.persistedRegionIdentities ??= [];
  source.battleNodes ??= (source.activeBattleNodes ?? []).map((battle) => ({
    ...battle,
    status: battle.status ?? 'active',
  }));
  source.activeBattleNodes = source.battleNodes
    .filter((battle) => battle.status === 'active');
  assertKnownReferences(source.references);
  const semanticOverlay = applyRuinsSemanticOverlay(
    source,
    target.world,
    dependencies.validateFinalizedWorld ?? validateFinalizedWorld
  );
  const targetWorld = semanticOverlay.world;
  const mappingBuilder = dependencies.buildMappingPlan
    ?? buildWorldMigrationMappingPlan;
  const requiredTargetNodeKeysByLegacyId = buildSemanticTargetEligibility(
    source,
    targetWorld,
    semanticOverlay.carrierByLegacyId
  );
  const mapping = mappingBuilder({
    legacyNodes: source.legacyNodes,
    targetNodes: targetWorld.nodes,
    characterLocations: source.characterLocations,
    activeBattleNodes: source.activeBattleNodes,
    questProgress: source.questProgress,
    requiredTargetNodeKeysByLegacyId,
  });
  assertLiveReferencesMapped(source, mapping, targetWorld);
  const regionIdentityReport = buildRegionIdentityReport(
    source.persistedRegionIdentities,
    targetWorld.regions
  );
  const semanticReport = assertSemanticReferencesPreserved(
    source,
    mapping,
    targetWorld
  );
  const collisionReport = buildCollisionReport(source, mapping);
  const characterFallbackRelocations = buildCharacterFallbackAudit(
    mapping,
    source.legacyNodes,
    targetWorld.nodes
  );

  const plan = {
    migrationKind: 'player_preserving_regeneration',
    sourceSeedVersion: source.sourceMetadata.seed_version == null
      ? null
      : Number(source.sourceMetadata.seed_version),
    targetSeedVersion,
    worldSeed: seed,
    targetGenerationHash: target.generationHash,
    targetWorld,
    sourceMetadata: source.sourceMetadata,
    references: source.references,
    referenceValues: source.referenceValues,
    protectedFingerprints: source.protectedFingerprints,
    sourceStateFingerprints: source.sourceStateFingerprints,
    mergeRows: source.mergeRows,
    legacyNodes: source.legacyNodes,
    persistedRegionIdentities: source.persistedRegionIdentities,
    regionIdentityReport,
    characterLocations: source.characterLocations,
    battleNodes: source.battleNodes,
    activeBattleNodes: source.activeBattleNodes,
    characterFallbackRelocations,
    questProgress: source.questProgress,
    collisionReport,
    semanticReport,
    semanticOverlay: semanticOverlay.manifest,
    mapping,
    coordinateShift: calculateCoordinateShift(
      source.legacyNodes,
      targetWorld.nodes
    ),
  };
  const planHash = sha256(planHashPayload(plan));
  return {
    ...plan,
    planHash,
    source: {
      seedVersion: plan.sourceSeedVersion,
      nodeCount: plan.legacyNodes.length,
      regionCount: plan.regionIdentityReport.persistedRegionCount,
      referencedTableCount: Object.keys(plan.sourceStateFingerprints).length,
      stateFingerprints: plan.sourceStateFingerprints,
    },
    target: {
      seedVersion: plan.targetSeedVersion,
      worldSeed: plan.worldSeed,
      nodeCount: plan.targetWorld.nodes.length,
      regionCount: plan.regionIdentityReport.targetRegionCount,
      generationHash: plan.targetGenerationHash,
      outputHash: plan.targetWorld.metadata.outputHash,
    },
    preservation: {
      mappedNodeCount: mapping.audit.mappedNodeCount,
      unmappedNodeCount: mapping.audit.unmappedNodeCount,
      mappingCollisionCount: mapping.audit.collisionMappingCount,
      directReferenceCount: Object.values(plan.referenceValues)
        .reduce((sum, values) => sum + values.length, 0),
      questRowCount: plan.questProgress.length,
      sourceRowCounts: buildPreservationInventory(source),
      regionIdentity: regionIdentityReport,
      characterFallbackRelocations,
      semanticPreflight: semanticReport,
      semanticOverlay: plan.semanticOverlay,
      collisionPreflight: collisionReport,
    },
    verification: {
      generatedTwiceIdentically: true,
      handledForeignKeyCount: plan.references.length,
      protectedTableFingerprints: plan.protectedFingerprints,
    },
  };
}

async function lockMigrationTables(client, references) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [MIGRATION_LOCK_KEY]
  );
  const publicTables = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const tables = new Set([
    ...BASE_LOCK_TABLES.map((tableName) => `public.${tableName}`),
    ...publicTables.rows.map(({ table_name: tableName }) =>
      `public.${tableName}`
    ),
    ...references.map((reference) =>
      `${reference.schemaName}.${reference.tableName}`
    ),
  ]);
  const names = [...tables]
    .sort()
    .map((name) => {
      const [schema, table] = name.split('.');
      return qualifiedName(schema, table);
    });
  await client.query(`LOCK TABLE ${names.join(', ')} IN ACCESS EXCLUSIVE MODE`);
}

async function discoverReferencesForLock(client, dependencies) {
  const references = await (
    dependencies.enumerateWorldNodeReferences
    ?? enumerateWorldNodeReferences
  )(client);
  assertKnownReferences(references);
  return references;
}

async function archiveTable(
  client,
  migrationId,
  tableName,
  disposition,
  mappedReferencesById = new Map()
) {
  const rows = await client.query(
    `SELECT row_to_json(source_row) AS source_row
     FROM ${qualifiedName('public', tableName)} source_row
     ORDER BY to_jsonb(source_row)::text`
  );
  for (let index = 0; index < rows.rows.length; index += 1) {
    const sourceRow = toPlainJson(rows.rows[index].source_row);
    const ordinal = index + 1;
    const rowHash = sha256(sourceRow);
    const sourceKey = sha256({ rowHash, ordinal });
    const mappedReferences = mappedReferencesById.get(String(sourceRow.id))
      ?? {};
    await client.query(
      `INSERT INTO world_migration_progress_archive
       (migration_id, source_table, source_key, source_identity, source_row,
        disposition, mapped_references)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb)`,
      [
        migrationId,
        tableName,
        sourceKey,
        JSON.stringify({ rowHash, ordinal }),
        JSON.stringify(sourceRow),
        disposition,
        JSON.stringify(mappedReferences),
      ]
    );
  }
  return rows.rows.length;
}

async function archiveSourceState(client, migrationId, plan) {
  const characterFallbackReferences = new Map(
    plan.characterFallbackRelocations.map((relocation) => [
      String(relocation.characterId),
      { current_node_id: relocation },
    ])
  );
  const tables = new Map([
    ['world_nodes', 'historical'],
    ['world_node_connections', 'historical'],
    ['world_regions', 'historical'],
    ['world_obstacles', 'historical'],
    ['character_quests', 'mapped'],
  ]);
  for (const reference of plan.references) {
    if (!GRAPH_REFERENCES.has(referenceKey(reference))) {
      const key = tableKey(reference);
      const disposition = REGENERATED_REFERENCE_TABLES.has(key)
        ? 'regenerated'
        : key === 'public.user_node_discovery'
          ? 'merged'
          : key === 'public.user_node_clearance'
            ? 'coverage'
            : 'mapped';
      tables.set(reference.tableName, disposition);
    }
  }
  const archived = {};
  for (const [tableName, disposition] of [...tables].sort()) {
    archived[tableName] = await archiveTable(
      client,
      migrationId,
      tableName,
      disposition,
      tableName === 'characters'
        ? characterFallbackReferences
        : undefined
    );
  }
  return archived;
}

async function makeGraphsCoexist(client, plan) {
  await client.query(`
    UPDATE world_regions
    SET castle_node_id = NULL, keep_node_id = NULL, guild_node_id = NULL
  `);
  await client.query(`
    UPDATE world_nodes
    SET opening_destination_node_key = NULL
    WHERE id = ANY($1::int[])
  `, [plan.legacyNodes.map((node) => node.id)]);
  await client.query('DELETE FROM npc_shop_inventory');
  await client.query('DELETE FROM world_node_connections');
  await client.query('DELETE FROM world_obstacles');
  await client.query(`
    UPDATE world_nodes
    SET x_coord = x_coord + $1,
        y_coord = y_coord + $1,
        node_key = $2 || id::text
    WHERE id = ANY($3::int[])
  `, [
    plan.coordinateShift,
    `legacy:${plan.planHash.slice(0, 12)}:`,
    plan.legacyNodes.map((node) => node.id),
  ]);
}

async function insertTargetGraph(client, plan, dependencies) {
  const insert = dependencies.insertGraph;
  let inserted;
  if (insert) {
    inserted = await insert(client, plan.targetWorld);
  } else {
    const addRegions = dependencies.insertRegions ?? insertRegions;
    const addNodes = dependencies.insertNodes ?? insertNodes;
    const addConnections = dependencies.insertConnections ?? insertConnections;
    const addObstacles = dependencies.insertObstacles ?? insertObstacles;
    const linkRegions = dependencies.updateRegionReferences
      ?? updateRegionReferences;
    await addRegions(client, plan.targetWorld.regions);
    const nodeIds = await addNodes(client, plan.targetWorld.nodes);
    await addConnections(client, plan.targetWorld.connections, nodeIds);
    await addObstacles(client, plan.targetWorld.obstacles);
    await linkRegions(client, plan.targetWorld.regions, nodeIds);
    inserted = { nodeIds };
  }
  if (!Array.isArray(inserted?.nodeIds)
      || inserted.nodeIds.length !== plan.targetWorld.nodes.length) {
    throw new Error('Target graph insertion returned an invalid node ID list');
  }
  const stockRows = await (
    dependencies.seedShopInventory ?? seedShopInventory
  )(client, inserted.nodeIds, plan.targetWorld.nodes);
  return { ...inserted, shopInventoryRows: stockRows };
}

function targetIdMaps(plan, nodeIds) {
  const idByKey = new Map(
    plan.targetWorld.nodes.map((node, index) => [node.nodeKey, nodeIds[index]])
  );
  const oldToNew = new Map();
  for (const mapping of plan.mapping.mappings) {
    const targetId = idByKey.get(mapping.targetNodeKey);
    if (!Number.isInteger(targetId)) {
      throw new Error(`No inserted node ID for ${mapping.targetNodeKey}`);
    }
    oldToNew.set(mapping.legacyNodeId, targetId);
  }
  return { idByKey, oldToNew };
}

async function assertNoUniqueCollisions(client, plan, oldToNew) {
  for (const reference of plan.references) {
    const extraColumns = COLLISION_KEYS[tableKey(reference)];
    if (!extraColumns || reference.columnName === undefined) continue;
    const rows = await client.query(
      `SELECT ${[
        reference.columnName,
        ...extraColumns,
      ].map(quoteIdentifier).join(', ')}
       FROM ${qualifiedName(reference.schemaName, reference.tableName)}
       WHERE ${quoteIdentifier(reference.columnName)} IS NOT NULL`
    );
    const seen = new Set();
    for (const row of rows.rows) {
      const oldId = Number(row[reference.columnName]);
      const newId = oldToNew.get(oldId);
      if (!Number.isInteger(newId)) continue;
      const key = canonicalStringify([
        newId,
        ...extraColumns.map((column) => row[column]),
      ]);
      if (seen.has(key)) {
        throw new Error(
          'Migration would collide with a unique reward/activity row in '
          + `${tableKey(reference)}`
        );
      }
      seen.add(key);
    }
  }
}

function buildRemappedDiscoveryRows(plan, oldToNew) {
  const remapped = plan.mergeRows.discovery.map((row) => ({
    ...row,
    node_id: oldToNew.get(Number(row.node_id)),
  }));
  if (remapped.some((row) => !Number.isInteger(row.node_id))) {
    throw new Error('Discovery state contains an unmapped node');
  }
  return mergeDiscoveryRecords(remapped);
}

async function remapDiscovery(client, plan, oldToNew) {
  const merged = buildRemappedDiscoveryRows(plan, oldToNew);
  await client.query('DELETE FROM user_node_discovery');
  for (const row of merged) {
    await client.query(
      `INSERT INTO user_node_discovery
       (user_id, node_id, discovery_method, discovered_at)
       VALUES ($1, $2, $3, $4)`,
      [row.userId, row.nodeId, row.discoveryMethod, row.discoveredAt]
    );
  }
  return {
    sourceRows: plan.mergeRows.discovery.length,
    targetRows: merged.length,
  };
}

function buildRemappedClearanceRows(plan, oldToNew, idByKey) {
  const byUser = new Map();
  for (const row of plan.mergeRows.clearance) {
    const group = byUser.get(row.user_id) ?? [];
    group.push(row);
    byUser.set(row.user_id, group);
  }
  const output = [];
  const keyById = new Map(
    [...idByKey].map(([nodeKey, nodeId]) => [nodeId, nodeKey])
  );
  for (const [userId, rows] of byUser) {
    const mappedKeys = rows
      .map((row) => keyById.get(oldToNew.get(Number(row.node_id))))
      .filter(Boolean);
    const expanded = expandFullCombatClearance({
      legacyNodes: plan.legacyNodes,
      targetNodes: plan.targetWorld.nodes,
      clearedLegacyNodeIds: rows.map((row) => Number(row.node_id)),
      mappedTargetNodeKeys: mappedKeys,
    });
    for (const nodeKey of expanded.targetNodeKeys) {
      const nodeId = idByKey.get(nodeKey);
      const matchingRows = rows.filter((row) =>
        oldToNew.get(Number(row.node_id)) === nodeId
      );
      const sourceRow = matchingRows[0] ?? rows[0];
      output.push({
        userId,
        nodeId,
        clearedAt: sourceRow?.cleared_at ?? null,
        battleId: expanded.addedTargetNodeKeys.includes(nodeKey)
          ? null
          : sourceRow?.battle_id ?? null,
      });
    }
  }
  return output.sort((left, right) =>
    String(left.userId).localeCompare(String(right.userId), 'en', {
      numeric: true,
    })
    || left.nodeId - right.nodeId
  );
}

async function remapClearance(client, plan, oldToNew, idByKey) {
  const output = buildRemappedClearanceRows(plan, oldToNew, idByKey);
  await client.query('DELETE FROM user_node_clearance');
  for (const row of output) {
    await client.query(
      `INSERT INTO user_node_clearance
       (user_id, node_id, cleared_at, battle_id)
       VALUES ($1, $2, $3, $4)`,
      [row.userId, row.nodeId, row.clearedAt, row.battleId]
    );
  }
  return {
    sourceRows: plan.mergeRows.clearance.length,
    targetRows: output.length,
  };
}

async function remapQuestProgress(client, oldToNew) {
  const quests = await client.query(
    'SELECT id, node_progress FROM character_quests ORDER BY id'
  );
  for (const quest of quests.rows) {
    const remapped = remapNodeProgress(quest.node_progress, oldToNew);
    await client.query(
      'UPDATE character_quests SET node_progress = $2::jsonb WHERE id = $1',
      [quest.id, JSON.stringify(remapped)]
    );
  }
  return quests.rows.length;
}

async function remapDirectReferences(client, plan, oldToNew, idByKey) {
  await assertNoUniqueCollisions(client, plan, oldToNew);
  const discovery = await remapDiscovery(client, plan, oldToNew);
  const clearance = await remapClearance(client, plan, oldToNew, idByKey);

  for (const reference of plan.references) {
    const key = referenceKey(reference);
    if (reference.targetColumnName !== 'id'
        || GRAPH_REFERENCES.has(key)
        || MERGED_REFERENCE_TABLES.has(tableKey(reference))
        || REGENERATED_REFERENCE_TABLES.has(tableKey(reference))
        || key === 'public.characters.current_node_id') {
      continue;
    }
    const table = qualifiedName(reference.schemaName, reference.tableName);
    const column = quoteIdentifier(reference.columnName);
    for (const [oldId, newId] of oldToNew) {
      await client.query(
        `UPDATE ${table} SET ${column} = $2 WHERE ${column} = $1`,
        [oldId, newId]
      );
    }
  }

  for (const reference of plan.mapping.criticalReferences.characterLocations) {
    const newId = idByKey.get(reference.targetNodeKey);
    if (!Number.isInteger(newId)) {
      throw new Error(`No target ID for character fallback ${reference.targetNodeKey}`);
    }
    await client.query(
      'UPDATE characters SET current_node_id = $2 WHERE id = $1',
      [reference.referenceId, newId]
    );
  }
  const quests = await remapQuestProgress(client, oldToNew);
  return { discovery, clearance, questRows: quests };
}

async function assertNoOldReferences(client, plan) {
  const oldIds = plan.legacyNodes.map((node) => node.id);
  for (const reference of plan.references) {
    if (reference.targetColumnName !== 'id'
        || GRAPH_REFERENCES.has(referenceKey(reference))) {
      continue;
    }
    const result = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM ${qualifiedName(reference.schemaName, reference.tableName)}
       WHERE ${quoteIdentifier(reference.columnName)} = ANY($1::int[])`,
      [oldIds]
    );
    if (Number(result.rows[0].count) !== 0) {
      throw new Error(
        `${referenceKey(reference)} still references a legacy world node`
      );
    }
  }
}

async function verifyRemappedState(client, plan, oldToNew, idByKey) {
  const actualReferences = await loadReferenceValues(client, plan.references);
  for (const reference of plan.references) {
    const key = referenceKey(reference);
    const table = tableKey(reference);
    if (reference.targetColumnName !== 'id'
        || GRAPH_REFERENCES.has(key)
        || MERGED_REFERENCE_TABLES.has(table)
        || REGENERATED_REFERENCE_TABLES.has(table)) {
      continue;
    }
    const expected = key === 'public.characters.current_node_id'
      ? plan.mapping.criticalReferences.characterLocations
        .map((location) => idByKey.get(location.targetNodeKey))
      : (plan.referenceValues[key] ?? [])
        .map((legacyNodeId) => oldToNew.get(legacyNodeId));
    expected.sort((left, right) => left - right);
    if (expected.some((nodeId) => !Number.isInteger(nodeId))
        || canonicalStringify(actualReferences[key] ?? [])
          !== canonicalStringify(expected)) {
      throw new Error(`${key} did not match its projected target references`);
    }
  }

  const discoveryResult = await client.query(`
    SELECT user_id, node_id, discovery_method,
           to_char(
             discovered_at,
             'YYYY-MM-DD"T"HH24:MI:SS.US'
           ) AS discovered_at
    FROM user_node_discovery
    ORDER BY user_id, node_id
  `);
  const actualDiscovery = toPlainJson(discoveryResult.rows).map((row) => ({
    userId: row.user_id,
    nodeId: Number(row.node_id),
    discoveryMethod: row.discovery_method,
    discoveredAt: row.discovered_at,
  }));
  const expectedDiscovery = buildRemappedDiscoveryRows(plan, oldToNew)
    .map((row) => ({
      userId: row.userId,
      nodeId: row.nodeId,
      discoveryMethod: row.discoveryMethod,
      discoveredAt: row.discoveredAt,
    }));
  if (canonicalStringify(actualDiscovery)
      !== canonicalStringify(expectedDiscovery)) {
    throw new Error('user_node_discovery did not match its projected merge');
  }

  const clearanceResult = await client.query(`
    SELECT user_id, node_id,
           to_char(
             cleared_at,
             'YYYY-MM-DD"T"HH24:MI:SS.US'
           ) AS cleared_at,
           battle_id
    FROM user_node_clearance
    ORDER BY user_id, node_id
  `);
  const actualClearance = toPlainJson(clearanceResult.rows).map((row) => ({
    userId: row.user_id,
    nodeId: Number(row.node_id),
    clearedAt: row.cleared_at,
    battleId: row.battle_id,
  }));
  const expectedClearance = buildRemappedClearanceRows(
    plan,
    oldToNew,
    idByKey
  );
  if (canonicalStringify(actualClearance)
      !== canonicalStringify(expectedClearance)) {
    throw new Error('user_node_clearance did not match its projected merge');
  }
  return {
    directReferenceCount: Object.keys(actualReferences).length,
    discoveryRows: actualDiscovery.length,
    clearanceRows: actualClearance.length,
  };
}

async function verifyQuestProgress(client, plan, oldToNew) {
  const result = await client.query(
    'SELECT id, node_progress FROM character_quests ORDER BY id'
  );
  const actual = toPlainJson(result.rows);
  const expected = plan.questProgress.map((quest) => ({
    id: quest.id,
    node_progress: remapNodeProgress(quest.node_progress, oldToNew),
  }));
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    throw new Error('character_quests.node_progress verification failed');
  }
  return { rowCount: actual.length, hash: sha256(actual) };
}

async function writeNodeMapAudit(client, migrationId, plan, idByKey) {
  const oldById = new Map(plan.legacyNodes.map((node) => [node.id, node]));
  const targetByKey = new Map(
    plan.targetWorld.nodes.map((node) => [node.nodeKey, node])
  );
  for (const mapping of plan.mapping.mappings) {
    await client.query(
      `INSERT INTO world_migration_node_maps
       (migration_id, old_node_id, old_node_key, new_node_id, new_node_key,
        mapping_method, confidence, reason, collision_group_size,
        old_node_snapshot, new_node_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
      [
        migrationId,
        mapping.legacyNodeId,
        mapping.legacyNodeKey ?? `legacy-node-${mapping.legacyNodeId}`,
        idByKey.get(mapping.targetNodeKey),
        mapping.targetNodeKey,
        mapping.method,
        mapping.confidence,
        mapping.reason,
        mapping.targetAssignmentCount,
        JSON.stringify(oldById.get(mapping.legacyNodeId)),
        JSON.stringify(targetByKey.get(mapping.targetNodeKey)),
      ]
    );
  }
}

async function verifyProtectedFingerprints(client, plan, dependencies) {
  const actual = await (
    dependencies.fingerprintProtectedTables
    ?? fingerprintProtectedTables
  )(client, plan.references);
  if (canonicalStringify(actual)
      !== canonicalStringify(plan.protectedFingerprints)) {
    throw new Error('Protected player-state fingerprint changed during migration');
  }
  return actual;
}

async function createMigrationRun(client, plan, initiatedBy) {
  const result = await client.query(
    `INSERT INTO world_migration_runs
     (source_seed_version, target_seed_version, world_seed, plan_hash,
      source_metadata, target_metadata, initiated_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, COALESCE($7, CURRENT_USER))
     RETURNING id`,
    [
      plan.sourceSeedVersion,
      plan.targetSeedVersion,
      plan.worldSeed,
      plan.planHash,
      JSON.stringify(plan.sourceMetadata),
      JSON.stringify(plan.targetWorld.metadata),
      initiatedBy ?? null,
    ]
  );
  return result.rows[0].id;
}

/**
 * Execute a previously confirmed plan atomically. Any thrown error rolls back
 * graph, player-state, metadata, and audit writes together.
 */
export async function executePlayerPreservingWorldMigration({
  pool,
  worldSeed,
  targetSeedVersion = SEED_VERSION,
  expectedPlanHash,
  initiatedBy,
  dependencies = {},
} = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('Execution requires a pool with connect()');
  }
  if (!/^[0-9a-f]{64}$/.test(expectedPlanHash ?? '')) {
    throw new TypeError('Execution requires a confirmed 64-character plan hash');
  }
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const references = await discoverReferencesForLock(client, dependencies);
    await (dependencies.lockMigrationTables ?? lockMigrationTables)(
      client,
      references
    );
    const plan = await planPlayerPreservingWorldMigration({
      client,
      worldSeed,
      targetSeedVersion,
      dependencies,
    });
    if (plan.planHash !== expectedPlanHash) {
      throw new Error(
        `Confirmed migration plan changed: expected ${expectedPlanHash}, `
        + `received ${plan.planHash}`
      );
    }

    const migrationId = await (
      dependencies.createMigrationRun ?? createMigrationRun
    )(client, plan, initiatedBy);
    const archivedRows = await (
      dependencies.archiveSourceState ?? archiveSourceState
    )(client, migrationId, plan);
    await (dependencies.makeGraphsCoexist ?? makeGraphsCoexist)(client, plan);
    const inserted = await insertTargetGraph(client, plan, dependencies);
    const { idByKey, oldToNew } = targetIdMaps(plan, inserted.nodeIds);
    const preservation = await (
      dependencies.remapPlayerState ?? remapDirectReferences
    )(client, plan, oldToNew, idByKey);
    await (dependencies.assertNoOldReferences ?? assertNoOldReferences)(
      client,
      plan
    );
    const remapVerification = await (
      dependencies.verifyRemappedState ?? verifyRemappedState
    )(client, plan, oldToNew, idByKey);
    const questVerification = await (
      dependencies.verifyQuestProgress ?? verifyQuestProgress
    )(client, plan, oldToNew);
    await writeNodeMapAudit(client, migrationId, plan, idByKey);
    const protectedFingerprints = await verifyProtectedFingerprints(
      client,
      plan,
      dependencies
    );
    await client.query(
      'DELETE FROM world_nodes WHERE id = ANY($1::int[])',
      [plan.legacyNodes.map((node) => node.id)]
    );
    await (dependencies.saveSeedMetadata ?? saveSeedMetadata)(
      client,
      plan.targetWorld
    );
    const persistence = await (
      dependencies.validatePersistedWorld ?? validatePersistedWorld
    )(client, plan.targetWorld);
    const preservationReport = {
      archivedRows,
      ...preservation,
      regeneratedShopInventoryRows: inserted.shopInventoryRows,
      sourceRowCounts: plan.preservation.sourceRowCounts,
      semanticOverlay: plan.semanticOverlay,
      semanticPreflight: plan.semanticReport,
      collisionPreflight: plan.collisionReport,
      characterFallbackRelocations: plan.characterFallbackRelocations,
      protectedFingerprints,
    };
    const verificationReport = {
      noLegacyReferences: true,
      remappedState: remapVerification,
      questProgress: questVerification,
      persistence,
      targetGenerationHash: plan.targetGenerationHash,
      targetOutputHash: plan.targetWorld.metadata.outputHash,
      semanticOverlayHash: plan.semanticOverlay?.overlayHash ?? null,
    };
    await client.query(
      `UPDATE world_migration_runs
       SET status = 'committed', completed_at = NOW(),
           preservation_report = $2::jsonb,
           verification_report = $3::jsonb
       WHERE id = $1`,
      [
        migrationId,
        JSON.stringify(preservationReport),
        JSON.stringify(verificationReport),
      ]
    );
    await client.query('COMMIT');
    transactionStarted = false;
    return {
      migrationId,
      planHash: plan.planHash,
      target: plan.target,
      preservationReport,
      verificationReport,
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
