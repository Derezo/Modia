/**
 * Database seeder.
 *
 * World assembly is intentionally completed before a database connection is
 * acquired. The finalized model is then persisted, together with its
 * integrity metadata, in one transaction through one client.
 */

import dotenv from 'dotenv';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pg from 'pg';

import { assembleWorld } from './worldgen/worldAssembly.js';
import {
  canonicalStringify,
  parseWorldSeed
} from './worldgen/randomStreams.js';
import { ITEM_TEMPLATES, SHOP_STOCK } from './templates/items.js';
import { ENEMY_TEMPLATES } from './templates/enemies.js';
import { SeededRandom } from '../config/constants.js';
import { GUILD_CONFIG } from './worldgen/constants.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Increment when persisted seed data changes incompatibly.
export const SEED_VERSION = 3;

const FEATURE_TO_SHOP = Object.freeze({
  blacksmith: 'blacksmith',
  apothecary: 'apothecary',
  farm: 'farm'
});

const DESTRUCTIVE_RESET_FLAGS = Object.freeze([
  'ALLOW_DESTRUCTIVE_WORLD_RESET',
  'WORLD_RESET_MAINTENANCE_WINDOW',
  'WORLD_RESET_BACKUP_VERIFIED'
]);

const RESET_ROOT_TABLE_NAMES = Object.freeze([
  'seed_metadata',
  'world_regions',
  'world_obstacles',
  'world_node_connections',
  'world_nodes',
  'item_templates',
  'enemy_templates',
  'npc_shop_inventory',
  'shop_transactions',
  'market_trades',
  'market_orders'
]);

const BOOTSTRAP_REPLACEABLE_TABLES = new Set([
  '"public"."item_templates"',
  '"public"."enemy_templates"'
]);

function asJson(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function asNullableJson(value) {
  return value === null || value === undefined
    ? null
    : JSON.stringify(value);
}

function asNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function asParsedJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function persistenceHash(snapshot) {
  return createHash('sha256')
    .update(canonicalStringify(snapshot))
    .digest('hex');
}

export function isDestructiveWorldResetAuthorized(env = process.env) {
  return DESTRUCTIVE_RESET_FLAGS.every((name) => env[name] === 'true');
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function resetTable(schemaName, tableName) {
  return {
    schemaName,
    tableName,
    identifier: `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`
  };
}

const RESET_ROOT_TABLES = Object.freeze(
  RESET_ROOT_TABLE_NAMES.map((tableName) => Object.freeze(
    resetTable('public', tableName)
  ))
);

async function lockResetTables(client, tables) {
  if (tables.length === 0) return;
  await client.query(
    `LOCK TABLE ${tables
      .map(({ identifier }) => identifier)
      .join(', ')} IN ACCESS EXCLUSIVE MODE`
  );
}

async function loadResetAffectedTables(client) {
  const result = await client.query(
    `WITH RECURSIVE reset_roots(oid) AS (
       SELECT unnest($1::regclass[]::oid[])
     ), affected(oid) AS (
       SELECT oid FROM reset_roots
       UNION
       SELECT edge.child_oid
       FROM (
         SELECT dependency.confrelid AS parent_oid,
                dependency.conrelid AS child_oid
         FROM pg_constraint dependency
         WHERE dependency.contype = 'f'
         UNION
         SELECT inheritance.inhparent AS parent_oid,
                inheritance.inhrelid AS child_oid
         FROM pg_inherits inheritance
       ) edge
       JOIN affected parent ON edge.parent_oid = parent.oid
     )
     SELECT namespace.nspname AS schema_name, relation.relname AS table_name
     FROM affected
     JOIN pg_class relation ON relation.oid = affected.oid
     JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE relation.relkind IN ('r', 'p', 'f')
     ORDER BY namespace.nspname, relation.relname`,
    [RESET_ROOT_TABLES.map(({ identifier }) => identifier)]
  );
  if (result.rows.length < RESET_ROOT_TABLES.length) {
    throw new Error('Unable to determine destructive reset table scope safely');
  }
  return result.rows.map(
    ({ schema_name: schemaName, table_name: tableName }) =>
      resetTable(schemaName, tableName)
  );
}

async function lockResetAffectedTables(client) {
  await lockResetTables(client, RESET_ROOT_TABLES);
  const lockedIdentifiers = new Set(
    RESET_ROOT_TABLES.map(({ identifier }) => identifier)
  );

  let affectedTables;
  let unlockedTables;
  do {
    affectedTables = await loadResetAffectedTables(client);
    unlockedTables = affectedTables.filter(
      ({ identifier }) => !lockedIdentifiers.has(identifier)
    );
    if (unlockedTables.length > 0) {
      await lockResetTables(client, unlockedTables);
      for (const { identifier } of unlockedTables) {
        lockedIdentifiers.add(identifier);
      }
    }
  } while (unlockedTables.length > 0);
  return affectedTables;
}

async function loadResetTargetIdentity(client) {
  const result = await client.query(
    `SELECT current_database() AS database_name,
            current_user AS database_user,
            COALESCE(inet_server_addr()::text, 'local-socket')
              AS server_address,
            inet_server_port() AS server_port`
  );
  const target = result.rows[0];
  if (!target?.database_name
      || !target.database_user
      || !target.server_address) {
    throw new Error('Unable to determine destructive reset target safely');
  }
  return {
    database: target.database_name,
    user: target.database_user,
    serverAddress: target.server_address,
    serverPort: asNumber(target.server_port)
  };
}

async function loadResetScopeCounts(client, affectedTables) {
  const tables = [];
  let totalRows = 0n;
  for (const { identifier } of affectedTables) {
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS reset_row_count FROM ONLY ${identifier}`
    );
    const rawCount = result.rows[0]?.reset_row_count;
    if (!/^\d+$/.test(String(rawCount))) {
      throw new Error('Unable to count destructive reset scope safely');
    }
    const rowCount = BigInt(rawCount);
    totalRows += rowCount;
    tables.push({
      table: identifier,
      rowCount: rowCount.toString(),
      bootstrapReplaceable: BOOTSTRAP_REPLACEABLE_TABLES.has(identifier)
    });
  }
  const protectedRows = tables.reduce(
    (sum, table) => table.bootstrapReplaceable
      ? sum
      : sum + BigInt(table.rowCount),
    0n
  );
  return {
    tables,
    tableCount: tables.length,
    totalRows: totalRows.toString(),
    protectedRows: protectedRows.toString(),
    mode: protectedRows === 0n ? 'empty-bootstrap' : 'destructive-reset'
  };
}

async function buildResetPreflight(client, affectedTables) {
  const [target, scope] = await Promise.all([
    loadResetTargetIdentity(client),
    loadResetScopeCounts(client, affectedTables)
  ]);
  return {
    event: 'world_reset_preflight',
    target,
    scope
  };
}

function emitResetPreflight(logger, report) {
  if (logger === undefined || logger === null) return;
  if (typeof logger !== 'function') {
    throw new TypeError('seedDatabase logger must be a function');
  }
  logger(canonicalStringify(report));
}

function assertResetAuthorized(wouldDeleteRows, env) {
  if (wouldDeleteRows && !isDestructiveWorldResetAuthorized(env)) {
    throw new Error(
      'Refusing destructive world reset: set '
      + DESTRUCTIVE_RESET_FLAGS.join(', ')
      + ' to exact value true'
    );
  }
}

function guildRefreshHour(node) {
  if (node.nodeType !== 'guild') return null;
  return ((node.regionId ?? 0) * 4) % 24;
}

function resolvedGuildClass(node) {
  if (node.nodeType !== 'guild') return null;
  if (node.guildType != null
      && node.guildClass != null
      && node.guildType !== node.guildClass) {
    throw new Error(
      `Guild ${node.nodeKey} has conflicting class metadata: `
      + `${node.guildType} vs ${node.guildClass}`
    );
  }
  const guildClass = node.guildType
    ?? node.guildClass
    ?? GUILD_CONFIG.RACE_PRIMARY_GUILD[node.regionRace];
  if (!GUILD_CONFIG.TYPES.includes(guildClass)) {
    throw new Error(
      `Guild ${node.nodeKey} has no supported finalized guild class`
    );
  }
  if (!String(node.name).toLowerCase().includes(guildClass)) {
    throw new Error(
      `Guild ${node.nodeKey} name "${node.name}" disagrees with class ${guildClass}`
    );
  }
  return guildClass;
}

function normalizeFeatures(features) {
  if (Array.isArray(features)) return features;
  if (typeof features === 'string') {
    try {
      const parsed = JSON.parse(features);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function zodiacSignForNode(node) {
  if (node.zodiacSign != null) return node.zodiacSign;
  return node.nodeType === 'shrine'
      && typeof node.shrineBuffType === 'string'
      && node.shrineBuffType.startsWith('zodiac_')
    ? node.shrineBuffType.slice('zodiac_'.length)
    : null;
}

export function createSeedPool(env = process.env) {
  return new Pool({
    host: env.DB_HOST || 'localhost',
    port: Number.parseInt(env.DB_PORT || '5432', 10),
    database: env.DB_NAME || 'modia',
    user: env.DB_USER || 'modia',
    password: env.DB_PASSWORD || ''
  });
}

export async function seedItems(client) {
  for (const item of ITEM_TEMPLATES) {
    await client.query(
      `INSERT INTO item_templates
       (name, description, item_type, equipment_slot, stat_bonuses,
        level_requirement, effect_type, effect_value, base_price, rarity, sprite_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT DO NOTHING`,
      [
        item.name,
        item.description || null,
        item.item_type,
        item.equipment_slot || null,
        asJson(item.stat_bonuses, {}),
        item.level_requirement ?? 1,
        item.effect_type || null,
        item.effect_value ?? null,
        item.base_price ?? 0,
        item.rarity ?? 1,
        item.sprite_id || null
      ]
    );
  }
}

export async function seedEnemies(client) {
  for (const enemy of ENEMY_TEMPLATES) {
    await client.query(
      `INSERT INTO enemy_templates
       (name, sprite_id, base_hp, base_mp, base_strength, base_intelligence,
        base_agility, base_vitality, base_luck, spawn_node_types, ai_type,
        abilities, drop_table, experience_reward, gold_reward_min,
        gold_reward_max, min_difficulty_tier, archetype, elemental_resistances)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19)
       ON CONFLICT DO NOTHING`,
      [
        enemy.name,
        enemy.sprite_id,
        enemy.base_hp,
        enemy.base_mp,
        enemy.base_strength,
        enemy.base_intelligence,
        enemy.base_agility,
        enemy.base_vitality ?? 5,
        enemy.base_luck ?? 5,
        enemy.spawn_node_types,
        enemy.ai_type || 'aggressive',
        asJson(enemy.abilities, []),
        asJson(enemy.drop_table, {}),
        enemy.experience_reward,
        enemy.gold_reward_min ?? 1,
        enemy.gold_reward_max,
        enemy.min_difficulty_tier ?? 1,
        enemy.archetype || 'humanoid',
        asJson(enemy.elemental_resistances, {})
      ]
    );
  }
}

export async function seedShopInventory(client, nodeIds, nodes) {
  let insertCount = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    for (const feature of normalizeFeatures(nodes[index].features)) {
      const shopType = FEATURE_TO_SHOP[feature];
      const stock = shopType ? SHOP_STOCK[shopType] : null;
      if (!stock) continue;

      for (const item of stock.items) {
        await client.query(
          `INSERT INTO npc_shop_inventory
           (node_id, shop_type, item_template_id, quantity, restock_quantity)
           VALUES ($1, $2, $3, $4, $4)
           ON CONFLICT (node_id, shop_type, item_template_id) DO NOTHING`,
          [nodeIds[index], shopType, item.templateId, item.qty]
        );
        insertCount += 1;
      }
    }
  }
  return insertCount;
}

export async function insertRegions(client, regions) {
  for (const region of regions) {
    await client.query(
      `INSERT INTO world_regions
       (id, race, dominant_terrain, secondary_terrains, boundary_polygon,
        castle_key, generator_x, generator_y)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         race = EXCLUDED.race,
         dominant_terrain = EXCLUDED.dominant_terrain,
         secondary_terrains = EXCLUDED.secondary_terrains,
         boundary_polygon = EXCLUDED.boundary_polygon,
         castle_key = EXCLUDED.castle_key,
         generator_x = EXCLUDED.generator_x,
         generator_y = EXCLUDED.generator_y`,
      [
        region.id,
        region.race,
        region.dominantTerrain,
        asJson(region.secondaryTerrains, []),
        region.boundaryPolygon ? asJson(region.boundaryPolygon, null) : null,
        region.castleKey,
        region.generatorPoint?.x,
        region.generatorPoint?.y
      ]
    );
  }
}

export async function insertNodes(client, nodes) {
  const nodeIds = [];
  for (const node of nodes) {
    const routed = node.routeId != null;
    const result = await client.query(
      `INSERT INTO world_nodes
       (node_key, node_type, name, x_coord, y_coord, distance_from_center,
        features, guild_class, local_seed, difficulty_tier,
        recruit_refresh_hour, is_terminator, shrine_buff_type, zodiac_sign,
        lore_key, region_id, region_race, ring_distance,
        caravan_inventory_seed, caravan_last_refresh, ruins_puzzle_type,
        ruins_reward_tier, opening_role,
        opening_destination_node_key, route_id, route_pair_key, region_pair,
        route_kind, route_order, segment_index, segment_kind,
        difficulty_policy, route_difficulty_tier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24,
               $25, $26, $27, $28, $29, $30, $31, $32, $33)
       RETURNING id`,
      [
        node.nodeKey,
        node.nodeType,
        node.name,
        node.xCoord,
        node.yCoord,
        Math.round(Math.hypot(node.xCoord, node.yCoord)),
        asJson(node.features, []),
        resolvedGuildClass(node),
        node.localSeed,
        node.difficultyTier,
        guildRefreshHour(node),
        node.isTerminator,
        node.shrineBuffType,
        zodiacSignForNode(node),
        node.loreKey,
        node.regionId,
        node.regionRace,
        node.ringDistance,
        node.nodeType === 'merchant_caravan' ? node.localSeed : null,
        null,
        node.ruinsPuzzleType ?? null,
        node.ruinsTier,
        node.openingRole ?? null,
        node.openingDestinationNodeKey ?? null,
        routed ? node.routeId : null,
        routed ? node.routePairKey ?? null : null,
        routed ? asJson(node.regionPair, []) : null,
        routed ? node.routeKind ?? null : null,
        routed ? node.routeOrder ?? null : null,
        routed ? node.segmentIndex ?? null : null,
        routed ? node.segmentKind ?? null : null,
        routed ? node.difficultyPolicy ?? null : null,
        routed ? node.routeDifficultyTier ?? null : null
      ]
    );
    nodeIds.push(result.rows[0].id);
  }
  return nodeIds;
}

export async function insertConnections(client, connections, nodeIds) {
  for (const connection of connections) {
    const fromId = nodeIds[connection.from];
    const toId = nodeIds[connection.to];
    const routed = connection.routeId != null;

    await client.query(
      `INSERT INTO world_node_connections
       (edge_key, from_node_id, to_node_id, path_type, opening_role, route_id,
        route_pair_key, region_pair, route_kind, segment_index, segment_kind,
        segment_order, difficulty_policy, route_difficulty_tier)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14)`,
      [
        connection.edgeKey,
        Math.min(fromId, toId),
        Math.max(fromId, toId),
        connection.pathType,
        connection.openingRole ?? null,
        routed ? connection.routeId : null,
        routed ? connection.routePairKey ?? null : null,
        routed ? asJson(connection.regionPair, []) : null,
        routed ? connection.routeKind ?? null : null,
        routed ? connection.segmentIndex ?? null : null,
        routed ? connection.segmentKind ?? null : null,
        routed ? connection.segmentIndex ?? null : null,
        routed ? connection.difficultyPolicy ?? null : null,
        routed ? connection.routeDifficultyTier ?? null : null
      ]
    );
  }
}

export async function insertObstacles(client, obstacles) {
  // Historical table name: these are decorative world-map landmarks only.
  for (const obstacle of obstacles) {
    await client.query(
      `INSERT INTO world_obstacles
       (obstacle_type, x, y, radius, length, angle)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        obstacle.obstacle_type,
        obstacle.x,
        obstacle.y,
        obstacle.radius,
        obstacle.length,
        obstacle.angle
      ]
    );
  }
}

export async function updateRegionReferences(client, regions, nodeIds) {
  for (const region of regions) {
    await client.query(
      `UPDATE world_regions SET
         castle_node_id = $2,
         keep_node_id = $3,
         guild_node_id = $4
       WHERE id = $1`,
      [
        region.id,
        region.castleNodeIndex === null ? null : nodeIds[region.castleNodeIndex],
        region.keepNodeIndex === null ? null : nodeIds[region.keepNodeIndex],
        region.guildNodeIndex === null ? null : nodeIds[region.guildNodeIndex]
      ]
    );
  }
}

async function initializeDiscovery(client, nodes, nodeIds) {
  const castleIndex = nodes.findIndex((node) => node.nodeType === 'castle');
  const startNodeId = nodeIds[castleIndex >= 0 ? castleIndex : 0];
  if (startNodeId === undefined) {
    throw new Error('Cannot initialize discovery for a world without nodes');
  }

  const users = await client.query('SELECT id FROM users');
  for (const user of users.rows) {
    await client.query(
      'SELECT discover_node_and_adjacent($1, $2)',
      [user.id, startNodeId]
    );
  }
  return startNodeId;
}

export async function saveSeedMetadata(client, world) {
  const itemCount = await client.query('SELECT COUNT(*) FROM item_templates');
  const enemyCount = await client.query('SELECT COUNT(*) FROM enemy_templates');
  const { metadata } = world;

  await client.query(
    `INSERT INTO seed_metadata
     (id, seed_version, world_seed, item_template_count, enemy_template_count,
      world_node_count, generator_version, random_stream_version,
      structural_graph_hash, output_hash, route_manifest,
      route_manifest_hash, migration_overlay, seeded_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
     ON CONFLICT (id) DO UPDATE SET
       seed_version = EXCLUDED.seed_version,
       world_seed = EXCLUDED.world_seed,
       item_template_count = EXCLUDED.item_template_count,
       enemy_template_count = EXCLUDED.enemy_template_count,
       world_node_count = EXCLUDED.world_node_count,
       generator_version = EXCLUDED.generator_version,
       random_stream_version = EXCLUDED.random_stream_version,
       structural_graph_hash = EXCLUDED.structural_graph_hash,
       output_hash = EXCLUDED.output_hash,
       route_manifest = EXCLUDED.route_manifest,
       route_manifest_hash = EXCLUDED.route_manifest_hash,
       migration_overlay = EXCLUDED.migration_overlay,
       seeded_at = NOW()`,
    [
      SEED_VERSION,
      metadata.worldSeed,
      itemCount.rows[0].count,
      enemyCount.rows[0].count,
      world.nodes.length,
      metadata.generatorVersion,
      metadata.randomStreamVersion,
      metadata.structuralHash,
      metadata.outputHash,
      asJson(world.routeManifest, []),
      metadata.routeManifestHash,
      asNullableJson(metadata.migrationOverlay)
    ]
  );
}

/**
 * Persist an already-finalized world. The caller owns the transaction.
 */
export async function persistWorld(client, world) {
  await client.query(
    `TRUNCATE "public"."world_regions", "public"."world_obstacles",
       "public"."world_node_connections", "public"."world_nodes",
       "public"."item_templates", "public"."enemy_templates",
       "public"."npc_shop_inventory", "public"."shop_transactions",
       "public"."market_trades", "public"."market_orders"
     RESTART IDENTITY CASCADE`
  );

  await insertRegions(client, world.regions);
  const nodeIds = await insertNodes(client, world.nodes);
  await insertConnections(client, world.connections, nodeIds);
  await insertObstacles(client, world.obstacles);
  await updateRegionReferences(client, world.regions, nodeIds);
  await seedItems(client);
  await seedEnemies(client);
  const shopInventoryCount = await seedShopInventory(client, nodeIds, world.nodes);
  const startNodeId = await initializeDiscovery(client, world.nodes, nodeIds);
  await saveSeedMetadata(client, world);

  return { nodeIds, startNodeId, shopInventoryCount };
}

function nodeKeyAt(world, index) {
  return index === null || index === undefined
    ? null
    : world.nodes[index]?.nodeKey ?? null;
}

function sortByKey(values, key) {
  return values.sort((left, right) => {
    const leftKey = String(left[key]);
    const rightKey = String(right[key]);
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return 0;
  });
}

function normalizeObstacle(obstacle) {
  return {
    obstacleType: obstacle.obstacleType ?? obstacle.obstacle_type,
    x: asNumber(obstacle.x),
    y: asNumber(obstacle.y),
    radius: asNumber(obstacle.radius),
    length: asNumber(obstacle.length),
    angle: asNumber(obstacle.angle)
  };
}

function sortObstacles(obstacles) {
  return obstacles.sort((left, right) => {
    const leftKey = canonicalStringify(left);
    const rightKey = canonicalStringify(right);
    if (leftKey < rightKey) return -1;
    if (leftKey > rightKey) return 1;
    return 0;
  });
}

/**
 * Normalize exactly the finalized fields that cross the persistence boundary.
 */
export function buildExpectedPersistenceSnapshot(world) {
  return {
    regions: [...world.regions]
      .map((region) => ({
        id: Number(region.id),
        castleKey: region.castleKey,
        generatorX: Number(region.generatorPoint?.x),
        generatorY: Number(region.generatorPoint?.y),
        race: region.race,
        dominantTerrain: region.dominantTerrain,
        secondaryTerrains: region.secondaryTerrains ?? [],
        boundaryPolygon: region.boundaryPolygon ?? null,
        castleNodeKey: nodeKeyAt(world, region.castleNodeIndex),
        keepNodeKey: nodeKeyAt(world, region.keepNodeIndex),
        guildNodeKey: nodeKeyAt(world, region.guildNodeIndex)
      }))
      .sort((left, right) => left.id - right.id),
    nodes: sortByKey(world.nodes.map((node) => {
      const routed = node.routeId != null;
      return {
        nodeKey: node.nodeKey,
        nodeType: node.nodeType,
        name: node.name,
        xCoord: Number(node.xCoord),
        yCoord: Number(node.yCoord),
        distanceFromCenter: Math.round(Math.hypot(node.xCoord, node.yCoord)),
        features: node.features ?? [],
        guildClass: resolvedGuildClass(node),
        localSeed: Number(node.localSeed),
        difficultyTier: Number(node.difficultyTier),
        recruitRefreshHour: guildRefreshHour(node),
        isTerminator: Boolean(node.isTerminator),
        shrineBuffType: node.shrineBuffType ?? null,
        zodiacSign: zodiacSignForNode(node),
        loreKey: node.loreKey ?? null,
        regionId: asNumber(node.regionId),
        regionRace: node.regionRace ?? null,
        ringDistance: asNumber(node.ringDistance),
        caravanInventorySeed: node.nodeType === 'merchant_caravan'
          ? Number(node.localSeed)
          : null,
        caravanLastRefresh: null,
        ruinsPuzzleType: node.ruinsPuzzleType ?? null,
        ruinsRewardTier: asNumber(node.ruinsTier),
        openingRole: node.openingRole ?? null,
        openingDestinationNodeKey: node.openingDestinationNodeKey ?? null,
        routeId: routed ? node.routeId : null,
        routePairKey: routed ? node.routePairKey ?? null : null,
        regionPair: routed ? node.regionPair ?? [] : null,
        routeKind: routed ? node.routeKind ?? null : null,
        routeOrder: routed ? asNumber(node.routeOrder) : null,
        segmentIndex: routed ? asNumber(node.segmentIndex) : null,
        segmentKind: routed ? node.segmentKind ?? null : null,
        difficultyPolicy: routed ? node.difficultyPolicy ?? null : null,
        routeDifficultyTier: routed
          ? asNumber(node.routeDifficultyTier)
          : null
      };
    }), 'nodeKey'),
    connections: sortByKey(world.connections.map((connection) => {
      const fromIndex = Math.min(connection.from, connection.to);
      const toIndex = Math.max(connection.from, connection.to);
      return {
        edgeKey: connection.edgeKey,
        fromNodeKey: world.nodes[fromIndex].nodeKey,
        toNodeKey: world.nodes[toIndex].nodeKey,
        pathType: connection.pathType,
        openingRole: connection.openingRole ?? null,
        routeId: connection.routeId ?? null,
        routePairKey: connection.routeId == null
          ? null
          : connection.routePairKey ?? null,
        regionPair: connection.routeId == null
          ? null
          : connection.regionPair ?? [],
        routeKind: connection.routeId == null
          ? null
          : connection.routeKind ?? null,
        segmentIndex: connection.routeId == null
          ? null
          : asNumber(connection.segmentIndex),
        segmentKind: connection.routeId == null
          ? null
          : connection.segmentKind ?? null,
        segmentOrder: connection.routeId == null
          ? null
          : asNumber(connection.segmentIndex),
        difficultyPolicy: connection.routeId == null
          ? null
          : connection.difficultyPolicy ?? null,
        routeDifficultyTier: connection.routeId == null
          ? null
          : asNumber(connection.routeDifficultyTier)
      };
    }), 'edgeKey'),
    obstacles: sortObstacles(world.obstacles.map(normalizeObstacle)),
    metadata: {
      seedVersion: SEED_VERSION,
      worldSeed: Number(world.metadata.worldSeed),
      worldNodeCount: world.nodes.length,
      generatorVersion: Number(world.metadata.generatorVersion),
      randomStreamVersion: Number(world.metadata.randomStreamVersion),
      structuralGraphHash: world.metadata.structuralHash,
      outputHash: world.metadata.outputHash,
      routeManifest: world.routeManifest ?? [],
      routeManifestHash: world.metadata.routeManifestHash,
      migrationOverlay: world.metadata.migrationOverlay ?? null
    }
  };
}

async function loadPersistenceSnapshot(client) {
  const regions = await client.query(
    `SELECT r.id, r.castle_key, r.generator_x, r.generator_y, r.race,
            r.dominant_terrain, r.secondary_terrains, r.boundary_polygon,
            castle.node_key AS castle_node_key,
            keep.node_key AS keep_node_key, guild.node_key AS guild_node_key
     FROM world_regions r
     LEFT JOIN world_nodes castle ON castle.id = r.castle_node_id
     LEFT JOIN world_nodes keep ON keep.id = r.keep_node_id
     LEFT JOIN world_nodes guild ON guild.id = r.guild_node_id
     ORDER BY r.id`
  );
  const nodes = await client.query(
    `SELECT node_key, node_type::text AS node_type, name, x_coord, y_coord,
            distance_from_center, features, guild_class::text AS guild_class,
            local_seed, difficulty_tier, recruit_refresh_hour,
            is_terminator, shrine_buff_type, zodiac_sign, lore_key, region_id,
            region_race, ring_distance, caravan_inventory_seed,
            caravan_last_refresh, ruins_puzzle_type, ruins_reward_tier,
            opening_role, opening_destination_node_key,
            route_id, route_pair_key, region_pair, route_kind, route_order,
            segment_index, segment_kind, difficulty_policy,
            route_difficulty_tier
     FROM world_nodes
     ORDER BY node_key`
  );
  const connections = await client.query(
    `SELECT c.edge_key, source.node_key AS from_node_key,
            target.node_key AS to_node_key, c.path_type, c.route_id,
            c.opening_role, c.route_pair_key, c.region_pair, c.route_kind,
            c.segment_kind, c.segment_index, c.segment_order,
            c.difficulty_policy, c.route_difficulty_tier
     FROM world_node_connections c
     JOIN world_nodes source ON source.id = c.from_node_id
     JOIN world_nodes target ON target.id = c.to_node_id
     ORDER BY c.edge_key`
  );
  const obstacles = await client.query(
    `SELECT obstacle_type, x, y, radius, length, angle
     FROM world_obstacles`
  );
  const metadata = await client.query(
    `SELECT seed_version, world_seed, world_node_count, generator_version,
            random_stream_version, structural_graph_hash, output_hash,
            route_manifest, route_manifest_hash, migration_overlay
     FROM seed_metadata
     WHERE id = 1`
  );

  if (metadata.rows.length !== 1) {
    throw new Error('Persisted world round-trip found no singleton seed metadata');
  }

  const metadataRow = metadata.rows[0];
  return {
    regions: regions.rows.map((region) => ({
      id: Number(region.id),
      castleKey: region.castle_key,
      generatorX: Number(region.generator_x),
      generatorY: Number(region.generator_y),
      race: region.race,
      dominantTerrain: region.dominant_terrain,
      secondaryTerrains: asParsedJson(region.secondary_terrains, []),
      boundaryPolygon: asParsedJson(region.boundary_polygon, null),
      castleNodeKey: region.castle_node_key ?? null,
      keepNodeKey: region.keep_node_key ?? null,
      guildNodeKey: region.guild_node_key ?? null
    })),
    nodes: sortByKey(nodes.rows.map((node) => ({
      nodeKey: node.node_key,
      nodeType: node.node_type,
      name: node.name,
      xCoord: Number(node.x_coord),
      yCoord: Number(node.y_coord),
      distanceFromCenter: Number(node.distance_from_center),
      features: asParsedJson(node.features, []),
      guildClass: node.guild_class ?? null,
      localSeed: Number(node.local_seed),
      difficultyTier: Number(node.difficulty_tier),
      recruitRefreshHour: asNumber(node.recruit_refresh_hour),
      isTerminator: Boolean(node.is_terminator),
      shrineBuffType: node.shrine_buff_type ?? null,
      zodiacSign: node.zodiac_sign ?? null,
      loreKey: node.lore_key ?? null,
      regionId: asNumber(node.region_id),
      regionRace: node.region_race ?? null,
      ringDistance: asNumber(node.ring_distance),
      caravanInventorySeed: asNumber(node.caravan_inventory_seed),
      caravanLastRefresh: node.caravan_last_refresh === null
        ? null
        : new Date(node.caravan_last_refresh).toISOString(),
      ruinsPuzzleType: node.ruins_puzzle_type ?? null,
      ruinsRewardTier: asNumber(node.ruins_reward_tier),
      openingRole: node.opening_role ?? null,
      openingDestinationNodeKey: node.opening_destination_node_key ?? null,
      routeId: node.route_id ?? null,
      routePairKey: node.route_pair_key ?? null,
      regionPair: node.region_pair === null
        ? null
        : asParsedJson(node.region_pair, []),
      routeKind: node.route_kind ?? null,
      routeOrder: asNumber(node.route_order),
      segmentIndex: asNumber(node.segment_index),
      segmentKind: node.segment_kind ?? null,
      difficultyPolicy: node.difficulty_policy ?? null,
      routeDifficultyTier: asNumber(node.route_difficulty_tier)
    })), 'nodeKey'),
    connections: sortByKey(connections.rows.map((connection) => ({
      edgeKey: connection.edge_key,
      fromNodeKey: connection.from_node_key,
      toNodeKey: connection.to_node_key,
      pathType: connection.path_type,
      openingRole: connection.opening_role ?? null,
      routeId: connection.route_id ?? null,
      routePairKey: connection.route_pair_key ?? null,
      regionPair: connection.region_pair === null
        ? null
        : asParsedJson(connection.region_pair, []),
      routeKind: connection.route_kind ?? null,
      segmentIndex: asNumber(connection.segment_index),
      segmentKind: connection.segment_kind ?? null,
      segmentOrder: asNumber(connection.segment_order),
      difficultyPolicy: connection.difficulty_policy ?? null,
      routeDifficultyTier: asNumber(connection.route_difficulty_tier)
    })), 'edgeKey'),
    obstacles: sortObstacles(obstacles.rows.map(normalizeObstacle)),
    metadata: {
      seedVersion: Number(metadataRow.seed_version),
      worldSeed: Number(metadataRow.world_seed),
      worldNodeCount: Number(metadataRow.world_node_count),
      generatorVersion: Number(metadataRow.generator_version),
      randomStreamVersion: Number(metadataRow.random_stream_version),
      structuralGraphHash: metadataRow.structural_graph_hash?.trim() ?? null,
      outputHash: metadataRow.output_hash?.trim() ?? null,
      routeManifest: asParsedJson(metadataRow.route_manifest, []),
      routeManifestHash: metadataRow.route_manifest_hash?.trim() ?? null,
      migrationOverlay: asParsedJson(metadataRow.migration_overlay, null)
    }
  };
}

/**
 * Query the just-written rows and compare their canonical persisted form with
 * the finalized model before the seed transaction may commit.
 */
export async function validatePersistedWorld(client, world) {
  const expected = buildExpectedPersistenceSnapshot(world);
  const actual = await loadPersistenceSnapshot(client);
  const expectedHash = persistenceHash(expected);
  const actualHash = persistenceHash(actual);
  const routeManifestHash = createHash('sha256')
    .update(canonicalStringify(actual.metadata.routeManifest))
    .digest('hex');

  if (actual.metadata.outputHash !== world.metadata.outputHash) {
    throw new Error(
      'Persisted world output hash does not match generated world output hash'
    );
  }
  if (routeManifestHash !== actual.metadata.routeManifestHash
      || routeManifestHash !== world.metadata.routeManifestHash) {
    throw new Error(
      'Persisted route manifest does not match its canonical route hash'
    );
  }
  if (actualHash !== expectedHash) {
    throw new Error(
      `Persisted world round-trip hash mismatch: expected ${expectedHash}, `
      + `received ${actualHash}`
    );
  }
  return { persistenceHash: actualHash, routeManifestHash };
}

/**
 * Assemble first, then atomically replace the persisted core seed.
 */
export async function seedDatabase({
  pool,
  worldSeed,
  assemble = assembleWorld,
  developerFixtureSeeder,
  validatePersistence = validatePersistedWorld,
  env = process.env,
  logger
} = {}) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('seedDatabase requires a pool with connect()');
  }

  const seed = parseWorldSeed(worldSeed);
  const world = await assemble({ seed });
  if (world?.validation?.valid !== true
      || (world.validation.errors?.length ?? 0) > 0) {
    const codes = (world?.validation?.errors ?? [])
      .slice(0, 10)
      .map((issue) => issue.code ?? issue.message ?? String(issue));
    throw new Error(
      'Refusing to persist a world that failed hard validation'
      + (codes.length > 0 ? `: ${codes.join(', ')}` : '')
    );
  }
  const client = await pool.connect();
  let persistence;
  let developerFixtures = null;
  let roundTripValidation;
  let resetPreflight;
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const affectedTables = await lockResetAffectedTables(client);
    resetPreflight = await buildResetPreflight(client, affectedTables);
    emitResetPreflight(logger, resetPreflight);
    assertResetAuthorized(
      resetPreflight.scope.protectedRows !== '0',
      env
    );
    persistence = await persistWorld(client, world);
    if (developerFixtureSeeder) {
      developerFixtures = await developerFixtureSeeder({
        client,
        startNodeId: persistence.startNodeId,
        world
      });
    }
    roundTripValidation = await validatePersistence(client, world);
    await client.query('COMMIT');
    transactionStarted = false;
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

  return {
    world,
    ...persistence,
    developerFixtures,
    resetPreflight,
    roundTripValidation
  };
}

const DEVELOPER_TEST_ITEMS = Object.freeze([
  { templateId: 5, seed: 999001, level: 90, rarity: 'legendary' },
  { templateId: 9, seed: 999002, level: 80, rarity: 'epic' },
  { templateId: 25, seed: 999003, level: 60, rarity: 'rare' },
  { templateId: 11, seed: 999004, level: 85, rarity: 'legendary' },
  { templateId: 24, seed: 999005, level: 70, rarity: 'epic' },
  { templateId: 10, seed: 999006, level: 50, rarity: 'rare' },
  { templateId: 1, seed: 999007, level: 30, rarity: 'rare' },
  { templateId: 2, seed: 999008, level: 40, rarity: 'epic' },
  { templateId: 3, seed: 999009, level: 50, rarity: 'legendary' },
  { templateId: 7, seed: 999010, level: 35, rarity: 'rare' },
  { templateId: 8, seed: 999011, level: 45, rarity: 'epic' },
  { templateId: 12, seed: 999012, level: 1, rarity: 'common' },
  { templateId: 29, seed: 999013, level: 1, rarity: 'uncommon' },
  { templateId: 15, seed: 999014, level: 1, rarity: 'epic' },
  { templateId: 1, seed: 999015, level: 10, rarity: 'uncommon' },
  { templateId: 7, seed: 999016, level: 15, rarity: 'uncommon' }
]);

const MARKET_TEST_ITEMS = Object.freeze([
  { templateId: 1, basePrice: 50 },
  { templateId: 2, basePrice: 150 },
  { templateId: 7, basePrice: 80 },
  { templateId: 8, basePrice: 250 },
  { templateId: 12, basePrice: 25 },
  { templateId: 13, basePrice: 30 },
  { templateId: 21, basePrice: 40 },
  { templateId: 29, basePrice: 100 },
  { templateId: 10, basePrice: 100 },
  { templateId: 6, basePrice: 45 }
]);

export async function seedMarketplaceData(client, userId, characterId) {
  const rng = new SeededRandom(54321);
  const now = new Date();
  let totalTrades = 0;

  for (const item of MARKET_TEST_ITEMS) {
    const isConsumable = (item.templateId >= 12 && item.templateId <= 15)
      || item.templateId >= 29;
    const tradesPerDay = isConsumable
      ? rng.nextInt(8, 15)
      : rng.nextInt(2, 6);

    for (let daysAgo = 14; daysAgo >= 0; daysAgo -= 1) {
      const dayTrades = rng.nextInt(
        Math.floor(tradesPerDay * 0.5),
        Math.ceil(tradesPerDay * 1.5)
      );
      let priceMultiplier = 1 + (rng.next() - 0.5) * 0.2;
      if (rng.next() < 0.1) {
        priceMultiplier *= 0.8 + rng.next() * 0.4;
      }

      for (let tradeIndex = 0; tradeIndex < dayTrades; tradeIndex += 1) {
        const tradeVariation = 1 + (rng.next() - 0.5) * 0.1;
        const price = Math.round(
          item.basePrice * priceMultiplier * tradeVariation
        );
        const quantity = isConsumable
          ? rng.nextInt(1, 10)
          : rng.nextInt(1, 3);
        const tradeDate = new Date(now);
        tradeDate.setDate(tradeDate.getDate() - daysAgo);
        tradeDate.setHours(
          rng.nextInt(6, 22),
          rng.nextInt(0, 59),
          rng.nextInt(0, 59)
        );

        await client.query(
          `INSERT INTO market_trades
           (buy_order_id, sell_order_id, item_template_id, buyer_id, seller_id,
            price, quantity, total_gold, executed_at)
           VALUES (NULL, NULL, $1, $2, $2, $3, $4, $5, $6)`,
          [
            item.templateId,
            userId,
            price,
            quantity,
            price * quantity,
            tradeDate
          ]
        );
        totalTrades += 1;
      }
    }
  }

  let orderCount = 0;
  for (const item of MARKET_TEST_ITEMS.slice(0, 5)) {
    for (let index = 0; index < rng.nextInt(3, 6); index += 1) {
      await client.query(
        `INSERT INTO market_orders
         (user_id, character_id, item_template_id, side, price, quantity,
          status, created_at)
         VALUES ($1, $2, $3, 'buy', $4, $5, 'open',
                 NOW() - ($6 * INTERVAL '1 hour'))`,
        [
          userId,
          characterId,
          item.templateId,
          Math.round(item.basePrice * (0.85 + rng.next() * 0.1)),
          rng.nextInt(1, 5),
          rng.nextInt(1, 72)
        ]
      );
      orderCount += 1;
    }

    for (let index = 0; index < rng.nextInt(3, 6); index += 1) {
      await client.query(
        `INSERT INTO market_orders
         (user_id, character_id, item_template_id, side, price, quantity,
          status, created_at)
         VALUES ($1, $2, $3, 'sell', $4, $5, 'open',
                 NOW() - ($6 * INTERVAL '1 hour'))`,
        [
          userId,
          characterId,
          item.templateId,
          Math.round(item.basePrice * (1.05 + rng.next() * 0.15)),
          rng.nextInt(1, 5),
          rng.nextInt(1, 72)
        ]
      );
      orderCount += 1;
    }
  }

  return { totalTrades, orderCount };
}

/**
 * Seed development-only fixtures through the caller's transaction client.
 */
export async function seedDeveloperTestData({ client, startNodeId }) {
  if (process.env.NODE_ENV === 'production') {
    return { ok: true, skipped: true };
  }

  const bcrypt = await import('bcrypt');
  const {
    generateItem,
    storeDroppedItem
  } = await import('../services/itemDropService.js');
  const hashedPassword = await bcrypt.default.hash('password', 10);
  const userResult = await client.query(
    `INSERT INTO users (username, email, password_hash, gold)
     VALUES ('derezo', 'derezo@test.local', $1, 30000)
     ON CONFLICT (username) DO UPDATE SET gold = 30000
     RETURNING id`,
    [hashedPassword]
  );
  const userId = userResult.rows[0].id;

  const existingCharacter = await client.query(
    `SELECT id FROM characters
     WHERE user_id = $1 AND name = 'Derezo'`,
    [userId]
  );
  let characterId = existingCharacter.rows[0]?.id;
  if (characterId) {
    await client.query(
      `UPDATE characters
       SET current_node_id = $2, party_slot = COALESCE(party_slot, 1)
       WHERE id = $1`,
      [characterId, startNodeId]
    );
    await client.query(
      'DELETE FROM character_items WHERE character_id = $1 OR user_id = $2',
      [characterId, userId]
    );
  } else {
    const character = await client.query(
      `INSERT INTO characters
       (user_id, name, race, class, gender, level, experience, current_node_id,
        hp_current, hp_max, mp_current, mp_max, strength, intelligence, agility,
        vitality, luck, party_slot)
       VALUES ($1, 'Derezo', 'elf', 'wizard', 'male', 25, 50000, $2,
               200, 200, 300, 300, 12, 35, 18, 14, 15, 1)
       RETURNING id`,
      [userId, startNodeId]
    );
    characterId = character.rows[0].id;
  }

  let createdCount = 0;
  for (const itemDefinition of DEVELOPER_TEST_ITEMS) {
    const item = await generateItem(
      itemDefinition.templateId,
      itemDefinition.seed,
      itemDefinition.level,
      itemDefinition.rarity,
      client
    );
    if (!item) {
      throw new Error(
        `Missing item template ${itemDefinition.templateId} for developer fixture`
      );
    }
    await storeDroppedItem(userId, item, client);
    createdCount += 1;
  }

  await client.query(
    'SELECT discover_node_and_adjacent($1, $2)',
    [userId, startNodeId]
  );
  await client.query(
    `INSERT INTO user_zodiac_crystals (user_id, zodiac_sign, shrine_node_id)
     VALUES ($1, 'aries', NULL)
     ON CONFLICT (user_id, zodiac_sign) DO NOTHING`,
    [userId]
  );

  const marketplace = await seedMarketplaceData(client, userId, characterId);

  return {
    ok: true,
    userId,
    characterId,
    createdCount,
    ...marketplace
  };
}

export async function main() {
  dotenv.config({ path: resolve(__dirname, '../../../.env') });
  const pool = createSeedPool(process.env);
  try {
    const includeDeveloperFixtures = process.env.NODE_ENV !== 'production';
    const result = await seedDatabase({
      pool,
      worldSeed: process.env.WORLD_SEED,
      logger: console.info,
      developerFixtureSeeder: includeDeveloperFixtures
        ? seedDeveloperTestData
        : undefined
    });
    console.log(
      `Seed complete: ${result.world.nodes.length} nodes, `
      + `${result.world.connections.length} connections, `
      + `world seed ${result.world.metadata.worldSeed}`
    );
  } finally {
    await pool.end();
  }
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === __filename;

if (isDirectExecution) {
  main().catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  });
}
