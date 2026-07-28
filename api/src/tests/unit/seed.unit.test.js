import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  SEED_VERSION,
  buildExpectedPersistenceSnapshot,
  seedDatabase,
  seedDeveloperTestData,
  validatePersistedWorld
} from '../../db/seed.js';
import { canonicalStringify } from '../../db/worldgen/randomStreams.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const RESET_ROOT_TABLES = [
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
];

function finalizedWorld(seed = 123456) {
  const world = {
    config: {
      seed,
      worldSeed: seed,
      generatorVersion: 2,
      randomStreamVersion: 3
    },
    castles: [],
    regions: [{
      id: 1,
      name: 'Heartlands',
      race: 'human',
      dominantTerrain: 'plains',
      secondaryTerrains: ['forest'],
      boundaryPolygon: [[0, 0], [1, 1]],
      castleKey: 'castle:1',
      generatorPoint: { x: 0, y: 0 },
      castleNodeIndex: 0,
      keepNodeIndex: null,
      guildNodeIndex: 1
    }],
    nodes: [{
      nodeKey: 'region:1:node:0000',
      nodeType: 'castle',
      name: 'Human Castle',
      xCoord: 0,
      yCoord: 0,
      features: [],
      guildType: null,
      guildClass: null,
      localSeed: 111,
      difficultyTier: 1,
      isTerminator: false,
      shrineBuffType: null,
      loreKey: null,
      regionId: 1,
      regionRace: 'human',
      ringDistance: 0,
      ruinsTier: null,
      openingRole: null,
      openingDestinationNodeKey: 'region:1:node:0001',
      routeId: null,
      routePairKey: null,
      regionPair: [],
      routeKind: null,
      routeOrder: null,
      segmentIndex: null,
      segmentKind: null,
      difficultyPolicy: null,
      routeDifficultyTier: null
    }, {
      nodeKey: 'region:1:node:0001',
      nodeType: 'guild',
      name: 'Warrior Guild',
      xCoord: 2,
      yCoord: 1,
      features: ['blacksmith'],
      guildType: 'warrior',
      guildClass: null,
      localSeed: -2147483648,
      difficultyTier: 2,
      isTerminator: false,
      shrineBuffType: null,
      loreKey: null,
      regionId: 1,
      regionRace: 'human',
      ringDistance: 2,
      ruinsTier: null,
      openingRole: 'designated_safe_destination',
      openingDestinationNodeKey: null,
      routeId: null,
      routePairKey: null,
      regionPair: [],
      routeKind: null,
      routeOrder: null,
      segmentIndex: null,
      segmentKind: null,
      difficultyPolicy: null,
      routeDifficultyTier: null
    }, {
      nodeKey: 'region:1:node:0002',
      nodeType: 'ruins',
      name: 'Old Ruins',
      xCoord: 4,
      yCoord: 3,
      features: [],
      guildType: null,
      guildClass: null,
      localSeed: 2147483647,
      difficultyTier: 3,
      isTerminator: true,
      shrineBuffType: null,
      loreKey: 'old_ruins',
      regionId: 1,
      regionRace: 'human',
      ringDistance: 3,
      ruinsTier: 3,
      openingRole: null,
      openingDestinationNodeKey: null,
      routeId: null,
      routePairKey: null,
      regionPair: [],
      routeKind: null,
      routeOrder: null,
      segmentIndex: null,
      segmentKind: null,
      difficultyPolicy: null,
      routeDifficultyTier: null
    }],
    connections: [{
      edgeKey: 'edge:00000',
      from: 0,
      to: 2,
      fromNodeKey: 'region:1:node:0000',
      toNodeKey: 'region:1:node:0002',
      pathType: 'trail',
      openingRole: 'tier_1_boundary_edge',
      routeId: 'wilderness:1-2',
      routePairKey: 'route-pair:1-2',
      regionPair: [1, 2],
      routeKind: 'wilderness',
      segmentKind: 'wilderness',
      segmentOrder: 4,
      segmentIndex: 4,
      difficultyPolicy: 'higher_risk_wilderness',
      routeDifficultyTier: 4
    }],
    routeManifest: [{
      edgeKey: 'edge:00000',
      routeId: 'wilderness:1-2',
      routePairKey: 'route-pair:1-2',
      regionPair: [1, 2],
      routeKind: 'wilderness',
      segmentKind: 'wilderness',
      segmentOrder: 4,
      segmentIndex: 4,
      pathType: 'trail',
      difficultyPolicy: 'higher_risk_wilderness'
    }],
    obstacles: [{
      obstacle_type: 'lake',
      x: 10,
      y: 12,
      radius: 3,
      length: null,
      angle: null
    }],
    metadata: {
      worldSeed: seed,
      generatorVersion: 2,
      randomStreamVersion: 3,
      structuralHash: HASH_A,
      outputHash: HASH_B,
      routeManifestHash: null
    },
    validation: { valid: true, errors: [], warnings: [] }
  };
  world.metadata.routeManifestHash = createHash('sha256')
    .update(canonicalStringify(world.routeManifest))
    .digest('hex');
  return world;
}

const successfulValidation = async () => ({ persistenceHash: HASH_A });

function createFakeDatabase({
  failPattern,
  worldNodeCount = 0,
  worldNodeCounts,
  affectedTable = 'world_nodes',
  affectedSchema = 'public',
  dependencySnapshots,
  developerFixtureData = false
} = {}) {
  const queries = [];
  const events = [];
  let nextNodeId = 100;
  let nodeCountRead = 0;
  let dependencyRead = 0;

  function hasConfiguredRows(normalized) {
    return normalized.includes(
      `"${affectedSchema}"."${affectedTable}"`
    );
  }

  const client = {
    released: false,
    async query(text, params = []) {
      const normalized = text.trim().replace(/\s+/g, ' ');
      queries.push({ text: normalized, params });
      events.push(normalized.split(' ')[0]);
      if (failPattern && normalized.includes(failPattern)) {
        throw new Error('simulated persistence failure');
      }
      if (normalized.startsWith('INSERT INTO world_nodes')) {
        return { rows: [{ id: nextNodeId++ }] };
      }
      if (developerFixtureData && normalized.startsWith('INSERT INTO users')) {
        return { rows: [{ id: 7 }] };
      }
      if (developerFixtureData
          && normalized.startsWith('SELECT id FROM characters')) {
        return { rows: [{ id: 8 }] };
      }
      if (developerFixtureData
          && normalized.startsWith('SELECT id, name, item_type')) {
        return {
          rows: [{
            id: params[0],
            name: 'Test Sword',
            item_type: 'weapon',
            equipment_slot: 'weapon',
            stat_bonuses: { strength: 1 },
            level_requirement: 1,
            base_price: 10,
            rarity: 1,
            sprite_id: 'test'
          }]
        };
      }
      if (normalized === 'SELECT id FROM users') {
        return { rows: [{ id: 7 }] };
      }
      if (normalized.startsWith('WITH RECURSIVE reset_roots')) {
        const snapshot = dependencySnapshots?.[
          Math.min(dependencyRead, dependencySnapshots.length - 1)
        ] ?? [];
        dependencyRead += 1;
        const affectedRelations = [
          ...RESET_ROOT_TABLES.map((tableName) => ({
            schema_name: 'public',
            table_name: tableName
          })),
          ...snapshot
        ];
        return {
          rows: [...new Map(
            affectedRelations.map((table) => [
              `${table.schema_name}.${table.table_name}`,
              table
            ])
          ).values()].sort((left, right) =>
            `${left.schema_name}.${left.table_name}`.localeCompare(
              `${right.schema_name}.${right.table_name}`
            ))
        };
      }
      if (normalized.startsWith('SELECT current_database()')) {
        return {
          rows: [{
            database_name: 'modia_seed_test',
            database_user: 'modia_test',
            server_address: '127.0.0.1',
            server_port: 5432
          }]
        };
      }
      if (normalized.startsWith(
        'SELECT COUNT(*)::bigint AS reset_row_count FROM'
      )) {
        return {
          rows: [{
            reset_row_count: String(
              hasConfiguredRows(normalized) ? worldNodeCount : 0
            )
          }]
        };
      }
      if (normalized.startsWith('SELECT EXISTS (SELECT 1 FROM')) {
        if (!hasConfiguredRows(normalized)) {
          return { rows: [{ has_rows: false }] };
        }
        const count = worldNodeCounts?.[
          Math.min(nodeCountRead, worldNodeCounts.length - 1)
        ] ?? worldNodeCount;
        nodeCountRead += 1;
        return { rows: [{ has_rows: count > 0 }] };
      }
      if (normalized.startsWith('SELECT COUNT(*)')) {
        return { rows: [{ count: '2' }] };
      }
      return { rows: [] };
    },
    release() {
      this.released = true;
      events.push('release');
    }
  };
  const pool = {
    connectCalls: 0,
    async connect() {
      this.connectCalls += 1;
      events.push('connect');
      return client;
    }
  };
  return { pool, client, queries, events };
}

function createRoundTripClient(world, mutate = () => {}) {
  const snapshot = structuredClone(buildExpectedPersistenceSnapshot(world));
  mutate(snapshot);
  const queries = [];
  return {
    queries,
    async query(text) {
      const normalized = text.trim().replace(/\s+/g, ' ');
      queries.push(normalized);
      if (normalized.startsWith('SELECT r.id')) {
        return {
          rows: snapshot.regions.map((region) => ({
            id: String(region.id),
            castle_key: region.castleKey,
            generator_x: String(region.generatorX),
            generator_y: String(region.generatorY),
            race: region.race,
            dominant_terrain: region.dominantTerrain,
            secondary_terrains: JSON.stringify(region.secondaryTerrains),
            boundary_polygon: JSON.stringify(region.boundaryPolygon),
            castle_node_key: region.castleNodeKey,
            keep_node_key: region.keepNodeKey,
            guild_node_key: region.guildNodeKey
          }))
        };
      }
      if (normalized.startsWith('SELECT node_key')) {
        return {
          rows: snapshot.nodes.map((node) => ({
            node_key: node.nodeKey,
            node_type: node.nodeType,
            name: node.name,
            x_coord: String(node.xCoord),
            y_coord: String(node.yCoord),
            distance_from_center: String(node.distanceFromCenter),
            features: JSON.stringify(node.features),
            guild_class: node.guildClass,
            local_seed: String(node.localSeed),
            difficulty_tier: String(node.difficultyTier),
            recruit_refresh_hour: node.recruitRefreshHour,
            is_terminator: node.isTerminator,
            shrine_buff_type: node.shrineBuffType,
            zodiac_sign: node.zodiacSign,
            lore_key: node.loreKey,
            region_id: node.regionId,
            region_race: node.regionRace,
            ring_distance: node.ringDistance,
            caravan_inventory_seed: node.caravanInventorySeed,
            caravan_last_refresh: node.caravanLastRefresh,
            ruins_puzzle_type: node.ruinsPuzzleType,
            ruins_reward_tier: node.ruinsRewardTier,
            opening_role: node.openingRole,
            opening_destination_node_key: node.openingDestinationNodeKey,
            route_id: node.routeId,
            route_pair_key: node.routePairKey,
            region_pair: node.regionPair === null
              ? null
              : JSON.stringify(node.regionPair),
            route_kind: node.routeKind,
            route_order: node.routeOrder,
            segment_index: node.segmentIndex,
            segment_kind: node.segmentKind,
            difficulty_policy: node.difficultyPolicy,
            route_difficulty_tier: node.routeDifficultyTier
          }))
        };
      }
      if (normalized.startsWith('SELECT c.edge_key')) {
        return {
          rows: snapshot.connections.map((connection) => ({
            edge_key: connection.edgeKey,
            from_node_key: connection.fromNodeKey,
            to_node_key: connection.toNodeKey,
            path_type: connection.pathType,
            opening_role: connection.openingRole,
            route_id: connection.routeId,
            route_pair_key: connection.routePairKey,
            region_pair: JSON.stringify(connection.regionPair),
            route_kind: connection.routeKind,
            segment_index: String(connection.segmentIndex),
            segment_kind: connection.segmentKind,
            segment_order: String(connection.segmentOrder),
            difficulty_policy: connection.difficultyPolicy,
            route_difficulty_tier: connection.routeDifficultyTier
          }))
        };
      }
      if (normalized.startsWith('SELECT obstacle_type')) {
        return {
          rows: snapshot.obstacles.map((obstacle) => ({
            obstacle_type: obstacle.obstacleType,
            x: String(obstacle.x),
            y: String(obstacle.y),
            radius: obstacle.radius === null ? null : String(obstacle.radius),
            length: obstacle.length === null ? null : String(obstacle.length),
            angle: obstacle.angle === null ? null : String(obstacle.angle)
          }))
        };
      }
      if (normalized.startsWith('SELECT seed_version')) {
        return {
          rows: [{
            seed_version: String(snapshot.metadata.seedVersion),
            world_seed: String(snapshot.metadata.worldSeed),
            world_node_count: String(snapshot.metadata.worldNodeCount),
            generator_version: String(snapshot.metadata.generatorVersion),
            random_stream_version:
              String(snapshot.metadata.randomStreamVersion),
            structural_graph_hash:
              `${snapshot.metadata.structuralGraphHash}   `,
            output_hash: `${snapshot.metadata.outputHash}   `,
            route_manifest: JSON.stringify(snapshot.metadata.routeManifest),
            route_manifest_hash:
              `${snapshot.metadata.routeManifestHash}   `,
            migration_overlay: snapshot.metadata.migrationOverlay === null
              ? null
              : JSON.stringify(snapshot.metadata.migrationOverlay)
          }]
        };
      }
      throw new Error(`Unexpected round-trip query: ${normalized}`);
    }
  };
}

describe('database seed transaction', () => {
  it('assembles before connecting or truncating and uses only one client', async () => {
    const fake = createFakeDatabase();
    const world = finalizedWorld(-77);
    const assemblyInputs = [];

    const result = await seedDatabase({
      pool: fake.pool,
      worldSeed: '-77',
      assemble(input) {
        fake.events.push('assemble');
        assemblyInputs.push(input);
        return world;
      },
      validatePersistence: successfulValidation
    });

    assert.deepEqual(assemblyInputs, [{ seed: -77 }]);
    assert.equal(fake.events[0], 'assemble');
    assert.equal(fake.events[1], 'connect');
    const beginIndex = fake.queries.findIndex(({ text }) => text === 'BEGIN');
    const lockIndex = fake.queries.findIndex(({ text }) =>
      text.startsWith('LOCK TABLE '));
    const truncateIndex = fake.queries.findIndex(({ text }) =>
      text.startsWith('TRUNCATE '));
    assert.equal(beginIndex, 0);
    assert.ok(lockIndex > beginIndex);
    assert.match(
      fake.queries[lockIndex].text,
      /^LOCK TABLE "public"."seed_metadata", "public"."world_regions"/
    );
    const dependencyIndex = fake.queries.findIndex(({ text }) =>
      text.startsWith('WITH RECURSIVE reset_roots'));
    assert.ok(dependencyIndex > lockIndex);
    assert.ok(truncateIndex > lockIndex);
    assert.equal(fake.queries.at(-1).text, 'COMMIT');
    assert.equal(fake.pool.connectCalls, 1);
    assert.equal(fake.client.released, true);
    assert.equal(result.world, world);
  });

  it('prints the exact reset scope after locking and before mutation', async () => {
    const fake = createFakeDatabase({
      affectedTable: 'world_nodes',
      worldNodeCount: 4
    });
    const messages = [];

    const result = await seedDatabase({
      pool: fake.pool,
      worldSeed: 13,
      assemble: () => finalizedWorld(13),
      validatePersistence: successfulValidation,
      logger(message) {
        messages.push({
          message,
          queryCount: fake.queries.length
        });
      },
      env: {
        ALLOW_DESTRUCTIVE_WORLD_RESET: 'true',
        WORLD_RESET_MAINTENANCE_WINDOW: 'true',
        WORLD_RESET_BACKUP_VERIFIED: 'true'
      }
    });

    assert.equal(messages.length, 1);
    const report = JSON.parse(messages[0].message);
    assert.equal(report.event, 'world_reset_preflight');
    assert.deepEqual(report.target, {
      database: 'modia_seed_test',
      serverAddress: '127.0.0.1',
      serverPort: 5432,
      user: 'modia_test'
    });
    assert.equal(report.scope.tableCount, RESET_ROOT_TABLES.length);
    assert.equal(report.scope.totalRows, '4');
    assert.equal(report.scope.protectedRows, '4');
    assert.equal(report.scope.mode, 'destructive-reset');
    assert.deepEqual(
      report.scope.tables.map(({ table }) => table),
      RESET_ROOT_TABLES
        .map((table) => `"public"."${table}"`)
        .sort()
    );
    assert.deepEqual(
      report.scope.tables.find(({ table }) =>
        table === '"public"."world_nodes"'),
      {
        table: '"public"."world_nodes"',
        rowCount: '4',
        bootstrapReplaceable: false
      }
    );
    const beginIndex = fake.queries.findIndex(({ text }) => text === 'BEGIN');
    const lockIndex = fake.queries.findIndex(({ text }) =>
      text.startsWith('LOCK TABLE '));
    const truncateIndex = fake.queries.findIndex(({ text }) =>
      text.startsWith('TRUNCATE '));
    assert.ok(beginIndex >= 0);
    assert.ok(lockIndex > beginIndex);
    assert.ok(messages[0].queryCount > lockIndex);
    assert.ok(messages[0].queryCount <= truncateIndex);
    assert.deepEqual(result.resetPreflight, report);
  });

  it('persists finalized node, edge, and integrity metadata fields', async () => {
    const fake = createFakeDatabase();
    const world = finalizedWorld();

    await seedDatabase({
      pool: fake.pool,
      worldSeed: undefined,
      assemble: () => world,
      validatePersistence: successfulValidation
    });

    const nodeInserts = fake.queries.filter(({ text }) =>
      text.startsWith('INSERT INTO world_nodes'));
    assert.equal(nodeInserts.length, 3);
    assert.deepEqual(
      nodeInserts[1].params.slice(0, 18),
      [
        'region:1:node:0001',
        'guild',
        'Warrior Guild',
        2,
        1,
        2,
        '["blacksmith"]',
        'warrior',
        -2147483648,
        2,
        4,
        false,
        null,
        null,
        null,
        1,
        'human',
        2
      ]
    );
    assert.equal(nodeInserts[2].params[8], 2147483647);
    assert.equal(nodeInserts[2].params[21], 3);

    const edgeInsert = fake.queries.find(({ text }) =>
      text.startsWith('INSERT INTO world_node_connections'));
    assert.deepEqual(edgeInsert.params, [
      'edge:00000',
      100,
      102,
      'trail',
      'tier_1_boundary_edge',
      'wilderness:1-2',
      'route-pair:1-2',
      '[1,2]',
      'wilderness',
      4,
      'wilderness',
      4,
      'higher_risk_wilderness',
      4
    ]);

    const metadataInsert = fake.queries.find(({ text }) =>
      text.startsWith('INSERT INTO seed_metadata'));
    assert.deepEqual(metadataInsert.params, [
      SEED_VERSION,
      123456,
      '2',
      '2',
      3,
      2,
      3,
      HASH_A,
      HASH_B,
      JSON.stringify(world.routeManifest),
      world.metadata.routeManifestHash,
      null
    ]);
  });

  it('persists a deterministic world migration overlay manifest', async () => {
    const fake = createFakeDatabase();
    const world = finalizedWorld();
    world.metadata.migrationOverlay = {
      version: 1,
      ruins: [{
        legacyNodeId: 10,
        targetNodeKey: 'region:1:node:0002',
        ruinsTier: 1,
        ruinsPuzzleType: null
      }]
    };

    await seedDatabase({
      pool: fake.pool,
      worldSeed: undefined,
      assemble: () => world,
      validatePersistence: successfulValidation
    });

    const metadataInsert = fake.queries.find(({ text }) =>
      text.startsWith('INSERT INTO seed_metadata'));
    assert.equal(
      metadataInsert.params.at(-1),
      JSON.stringify(world.metadata.migrationOverlay)
    );
    assert.match(metadataInsert.text, /\bmigration_overlay\b/);
  });

  it('persists the gameplay zodiac identity derived from a zodiac shrine', async () => {
    const fake = createFakeDatabase();
    const world = finalizedWorld();
    Object.assign(world.nodes[1], {
      nodeType: 'shrine',
      shrineBuffType: 'zodiac_aries'
    });

    await seedDatabase({
      pool: fake.pool,
      worldSeed: undefined,
      assemble: () => world,
      validatePersistence: successfulValidation
    });

    const shrineInsert = fake.queries.filter(({ text }) =>
      text.startsWith('INSERT INTO world_nodes'))[1];
    assert.equal(shrineInsert.params[12], 'zodiac_aries');
    assert.equal(shrineInsert.params[13], 'aries');

    const snapshot = buildExpectedPersistenceSnapshot(world);
    assert.equal(snapshot.nodes.find(({ nodeType }) =>
      nodeType === 'shrine').zodiacSign, 'aries');
  });

  it('rolls back failures after truncation, world inserts, and late helpers', async () => {
    const failurePoints = [
      'INSERT INTO world_regions',
      'INSERT INTO item_templates',
      'INSERT INTO seed_metadata'
    ];

    for (const failPattern of failurePoints) {
      const fake = createFakeDatabase({ failPattern });

      await assert.rejects(
        seedDatabase({
          pool: fake.pool,
          worldSeed: 5,
          assemble: () => finalizedWorld(5),
          validatePersistence: successfulValidation
        }),
        /simulated persistence failure/
      );

      assert.ok(
        fake.queries.some(({ text }) => text === 'ROLLBACK'),
        `expected rollback after ${failPattern}`
      );
      assert.ok(
        !fake.queries.some(({ text }) => text === 'COMMIT'),
        `unexpected commit after ${failPattern}`
      );
      assert.equal(fake.client.released, true);
    }
  });

  it('rejects ambiguous seeds before assembly or database access', async () => {
    const fake = createFakeDatabase();
    let assembled = false;

    await assert.rejects(
      seedDatabase({
        pool: fake.pool,
        worldSeed: '',
        assemble() {
          assembled = true;
        }
      }),
      /World seed/
    );

    assert.equal(assembled, false);
    assert.equal(fake.pool.connectCalls, 0);
    assert.equal(fake.queries.length, 0);
  });

  it('rejects hard validation failures before database access', async () => {
    const fake = createFakeDatabase();
    const invalidWorld = finalizedWorld(6);
    invalidWorld.validation = {
      valid: false,
      errors: [{ code: 'ORPHAN_NODE' }],
      warnings: []
    };

    await assert.rejects(
      seedDatabase({
        pool: fake.pool,
        worldSeed: 6,
        assemble: () => invalidWorld
      }),
      /failed hard validation: ORPHAN_NODE/
    );

    assert.equal(fake.pool.connectCalls, 0);
    assert.equal(fake.queries.length, 0);
  });

  it('runs optional developer fixtures on the seed client before commit', async () => {
    const fake = createFakeDatabase();

    const result = await seedDatabase({
      pool: fake.pool,
      worldSeed: 9,
      assemble: () => finalizedWorld(9),
      validatePersistence: successfulValidation,
      async developerFixtureSeeder({ client, startNodeId, world }) {
        assert.equal(client, fake.client);
        assert.equal(startNodeId, 100);
        assert.equal(world.metadata.worldSeed, 9);
        fake.events.push('fixtures');
        await client.query('INSERT INTO developer_fixture DEFAULT VALUES');
        return { ok: true, createdCount: 16 };
      }
    });

    assert.ok(fake.events.indexOf('BEGIN') < fake.events.indexOf('fixtures'));
    assert.ok(fake.events.indexOf('fixtures') < fake.events.indexOf('COMMIT'));
    assert.ok(fake.events.indexOf('COMMIT') < fake.events.indexOf('release'));
    assert.ok(!fake.queries.some(({ text }) => text === 'ROLLBACK'));
    assert.deepEqual(
      result.developerFixtures,
      { ok: true, createdCount: 16 }
    );
  });

  it('rolls back core and fixture mutations when developer fixtures fail', async () => {
    const fake = createFakeDatabase();

    await assert.rejects(
      seedDatabase({
        pool: fake.pool,
        worldSeed: 9,
        assemble: () => finalizedWorld(9),
        validatePersistence: successfulValidation,
        async developerFixtureSeeder({ client }) {
          assert.equal(client, fake.client);
          fake.events.push('fixtures');
          await client.query('INSERT INTO developer_fixture DEFAULT VALUES');
          throw new Error('fixture failure');
        }
      }),
      /fixture failure/
    );

    assert.ok(fake.events.indexOf('fixtures') < fake.events.indexOf('ROLLBACK'));
    assert.ok(!fake.queries.some(({ text }) => text === 'COMMIT'));
    assert.equal(fake.client.released, true);
  });

  it('refuses a locked destructive reset unless every flag is exact true', async () => {
    for (const env of [
      {},
      {
        ALLOW_DESTRUCTIVE_WORLD_RESET: 'true',
        WORLD_RESET_MAINTENANCE_WINDOW: 'true'
      },
      {
        ALLOW_DESTRUCTIVE_WORLD_RESET: 'TRUE',
        WORLD_RESET_MAINTENANCE_WINDOW: 'true',
        WORLD_RESET_BACKUP_VERIFIED: 'true'
      }
    ]) {
      const fake = createFakeDatabase({ worldNodeCount: 4 });
      await assert.rejects(
        seedDatabase({
          pool: fake.pool,
          worldSeed: 12,
          assemble: () => finalizedWorld(12),
          validatePersistence: successfulValidation,
          env
        }),
        /Refusing destructive world reset/
      );
      assert.ok(fake.queries.some(({ text }) => text === 'BEGIN'));
      assert.ok(fake.queries.some(({ text }) =>
        text.startsWith('LOCK TABLE ')));
      assert.ok(!fake.queries.some(({ text }) => text.startsWith('TRUNCATE ')));
      assert.ok(fake.queries.some(({ text }) => text === 'ROLLBACK'));
      assert.equal(fake.client.released, true);
    }
  });

  it('refuses when a helper-owned reset table has data but world_nodes is empty', async () => {
    const fake = createFakeDatabase({
      affectedTable: 'market_orders',
      worldNodeCount: 1
    });
    await assert.rejects(
      seedDatabase({
        pool: fake.pool,
        worldSeed: 12,
        assemble: () => finalizedWorld(12),
        validatePersistence: successfulValidation,
        env: {}
      }),
      /Refusing destructive world reset/
    );

    assert.ok(fake.queries.some(({ text }) =>
      text.includes('"public"."market_orders"')));
    assert.ok(fake.queries.some(({ text }) => text === 'BEGIN'));
    assert.ok(fake.queries.some(({ text }) => text.startsWith('LOCK TABLE ')));
    assert.ok(!fake.queries.some(({ text }) => text.startsWith('TRUNCATE ')));
    assert.ok(fake.queries.some(({ text }) => text === 'ROLLBACK'));
  });

  it('permits empty bootstrap when only migration-owned templates exist', async () => {
    const fake = createFakeDatabase({
      affectedTable: 'item_templates',
      worldNodeCount: 6
    });
    const messages = [];

    const result = await seedDatabase({
      pool: fake.pool,
      worldSeed: 12,
      assemble: () => finalizedWorld(12),
      validatePersistence: successfulValidation,
      logger: (message) => messages.push(JSON.parse(message)),
      env: {}
    });

    assert.equal(messages[0].scope.mode, 'empty-bootstrap');
    assert.equal(messages[0].scope.totalRows, '6');
    assert.equal(messages[0].scope.protectedRows, '0');
    assert.ok(fake.queries.some(({ text }) => text === 'COMMIT'));
    assert.equal(result.world.metadata.worldSeed, 12);
  });

  it('treats a cross-schema same-name inherited descendant as protected', async () => {
    const fake = createFakeDatabase({
      affectedSchema: 'custom',
      affectedTable: 'item_templates',
      worldNodeCount: 1,
      dependencySnapshots: [[{
        schema_name: 'custom',
        table_name: 'item_templates'
      }]]
    });
    const messages = [];

    await assert.rejects(
      seedDatabase({
        pool: fake.pool,
        worldSeed: 12,
        assemble: () => finalizedWorld(12),
        validatePersistence: successfulValidation,
        logger: (message) => messages.push(JSON.parse(message)),
        env: {}
      }),
      /Refusing destructive world reset/
    );

    assert.deepEqual(
      messages[0].scope.tables.find(
        ({ table }) => table === '"custom"."item_templates"'
      ),
      {
        table: '"custom"."item_templates"',
        rowCount: '1',
        bootstrapReplaceable: false
      }
    );
    assert.equal(messages[0].scope.protectedRows, '1');
    const catalogQuery = fake.queries.find(({ text }) =>
      text.startsWith('WITH RECURSIVE reset_roots'));
    assert.match(catalogQuery.text, /FROM pg_constraint dependency/);
    assert.match(catalogQuery.text, /FROM pg_inherits inheritance/);
    assert.match(catalogQuery.text, /relation\.relkind IN \('r', 'p', 'f'\)/);
    assert.ok(fake.queries.some(({ text }) =>
      text ===
        'SELECT COUNT(*)::bigint AS reset_row_count FROM ONLY '
        + '"custom"."item_templates"'));
    const countQueries = fake.queries.filter(({ text }) =>
      text.startsWith(
        'SELECT COUNT(*)::bigint AS reset_row_count FROM ONLY '
      ));
    assert.equal(countQueries.length, RESET_ROOT_TABLES.length + 1);
    assert.ok(countQueries.every(({ text }) =>
      /FROM ONLY "[^"]+"\."[^"]+"$/.test(text)));
    assert.ok(!fake.queries.some(({ text }) => text.startsWith('TRUNCATE ')));
    assert.ok(fake.queries.some(({ text }) => text === 'ROLLBACK'));
  });

  it('locks and re-discovers dependency chains to a fixed point', async () => {
    const child = {
      schema_name: 'public',
      table_name: 'reset_child'
    };
    const grandchild = {
      schema_name: 'custom',
      table_name: 'reset_grandchild'
    };
    const fake = createFakeDatabase({
      affectedSchema: 'custom',
      affectedTable: 'reset_grandchild',
      worldNodeCount: 1,
      dependencySnapshots: [
        [child],
        [child, grandchild],
        [child, grandchild]
      ]
    });

    await assert.rejects(
      seedDatabase({
        pool: fake.pool,
        worldSeed: 12,
        assemble: () => finalizedWorld(12),
        validatePersistence: successfulValidation,
        env: {}
      }),
      /Refusing destructive world reset/
    );

    const lockQueries = fake.queries.filter(({ text }) =>
      text.startsWith('LOCK TABLE '));
    assert.equal(lockQueries.length, 3);
    assert.match(lockQueries[0].text, /"public"."seed_metadata"/);
    assert.equal(
      lockQueries[1].text,
      'LOCK TABLE "public"."reset_child" IN ACCESS EXCLUSIVE MODE'
    );
    assert.equal(
      lockQueries[2].text,
      'LOCK TABLE "custom"."reset_grandchild" IN ACCESS EXCLUSIVE MODE'
    );
    assert.equal(
      fake.queries.filter(({ text }) =>
        text.startsWith('WITH RECURSIVE reset_roots')).length,
      3
    );
    const lastLockIndex = fake.queries.findLastIndex(({ text }) =>
      text.startsWith('LOCK TABLE '));
    const firstCountIndex = fake.queries.findIndex(({ text }) =>
      text.startsWith('SELECT COUNT(*)::bigint AS reset_row_count FROM'));
    assert.ok(firstCountIndex > lastLockIndex);
    assert.ok(!fake.queries.some(({ text }) => text.startsWith('TRUNCATE ')));
  });

  it('permits a direct nonempty reset only when every authorization flag is true', async () => {
    const fake = createFakeDatabase({ worldNodeCount: 4 });
    await seedDatabase({
      pool: fake.pool,
      worldSeed: 12,
      assemble: () => finalizedWorld(12),
      validatePersistence: successfulValidation,
      env: {
        ALLOW_DESTRUCTIVE_WORLD_RESET: 'true',
        WORLD_RESET_MAINTENANCE_WINDOW: 'true',
        WORLD_RESET_BACKUP_VERIFIED: 'true'
      }
    });

    assert.ok(fake.queries.some(({ text }) => text === 'BEGIN'));
    assert.ok(fake.queries.some(({ text }) => text.startsWith('TRUNCATE ')));
    assert.ok(fake.queries.some(({ text }) => text === 'COMMIT'));
  });

  it('checks authorization under a table lock before truncating', async () => {
    const fake = createFakeDatabase({ worldNodeCount: 1 });
    await assert.rejects(
      seedDatabase({
        pool: fake.pool,
        worldSeed: 12,
        assemble: () => finalizedWorld(12),
        validatePersistence: successfulValidation,
        env: {}
      }),
      /Refusing destructive world reset/
    );

    assert.ok(fake.queries.some(({ text }) => text.startsWith('LOCK TABLE ')));
    assert.ok(fake.queries.some(({ text }) => text === 'ROLLBACK'));
    assert.ok(!fake.queries.some(({ text }) => text.startsWith('TRUNCATE ')));
  });

  it('runs persistence round-trip validation after fixtures and before commit', async () => {
    const fake = createFakeDatabase();
    await seedDatabase({
      pool: fake.pool,
      worldSeed: 19,
      assemble: () => finalizedWorld(19),
      async developerFixtureSeeder() {
        fake.events.push('fixtures');
      },
      async validatePersistence(client, world) {
        assert.equal(client, fake.client);
        assert.equal(world.metadata.worldSeed, 19);
        fake.events.push('round-trip');
        return { persistenceHash: HASH_C };
      }
    });

    assert.ok(fake.events.indexOf('fixtures') < fake.events.indexOf('round-trip'));
    assert.ok(fake.events.indexOf('round-trip') < fake.events.indexOf('COMMIT'));
  });

  it('rolls back when pre-commit persistence validation fails', async () => {
    const fake = createFakeDatabase();
    await assert.rejects(
      seedDatabase({
        pool: fake.pool,
        worldSeed: 20,
        assemble: () => finalizedWorld(20),
        async validatePersistence() {
          throw new Error('round-trip mismatch');
        }
      }),
      /round-trip mismatch/
    );
    assert.ok(fake.queries.some(({ text }) => text === 'ROLLBACK'));
    assert.ok(!fake.queries.some(({ text }) => text === 'COMMIT'));
  });

  it('keeps the real developer fixture path on the seed client and rolls it back', async () => {
    const fake = createFakeDatabase({
      developerFixtureData: true,
      failPattern: 'INSERT INTO market_trades'
    });

    await assert.rejects(
      seedDatabase({
        pool: fake.pool,
        worldSeed: 21,
        assemble: () => finalizedWorld(21),
        developerFixtureSeeder: seedDeveloperTestData,
        validatePersistence: successfulValidation
      }),
      /simulated persistence failure/
    );

    assert.equal(
      fake.queries.filter(({ text }) =>
        text.startsWith('SELECT id, name, item_type')).length,
      16
    );
    assert.equal(
      fake.queries.filter(({ text }) =>
        text.startsWith('INSERT INTO character_items')).length,
      16
    );
    assert.ok(fake.queries.some(({ text }) => text === 'ROLLBACK'));
    assert.ok(!fake.queries.some(({ text }) => text === 'COMMIT'));
  });
});

describe('persisted world round-trip validation', () => {
  it('normalizes queried PostgreSQL values and accepts the finalized snapshot', async () => {
    const world = finalizedWorld();
    const client = createRoundTripClient(world);
    const result = await validatePersistedWorld(client, world);

    assert.match(result.persistenceHash, /^[0-9a-f]{64}$/);
    assert.equal(client.queries.length, 5);
  });

  it('round-trips a deterministic world migration overlay manifest', async () => {
    const world = finalizedWorld();
    world.metadata.migrationOverlay = {
      version: 1,
      ruins: [{
        legacyNodeId: 10,
        targetNodeKey: 'region:1:node:0002',
        ruinsTier: 1,
        ruinsPuzzleType: null
      }]
    };
    const client = createRoundTripClient(world);

    const result = await validatePersistedWorld(client, world);

    assert.match(result.persistenceHash, /^[0-9a-f]{64}$/);
    assert.match(
      client.queries.find((query) => query.startsWith('SELECT seed_version')),
      /\bmigration_overlay\b/
    );
  });

  it('rejects a persisted migration overlay that differs from the model', async () => {
    const world = finalizedWorld();
    world.metadata.migrationOverlay = {
      version: 1,
      ruins: []
    };
    const client = createRoundTripClient(world, (snapshot) => {
      snapshot.metadata.migrationOverlay.ruins.push({
        legacyNodeId: 10,
        targetNodeKey: 'region:1:node:0002'
      });
    });

    await assert.rejects(
      validatePersistedWorld(client, world),
      /round-trip hash mismatch/
    );
  });

  it('rejects a queried field that differs from the generated world', async () => {
    const world = finalizedWorld();
    const client = createRoundTripClient(world, (snapshot) => {
      snapshot.connections[0].segmentOrder += 1;
    });

    await assert.rejects(
      validatePersistedWorld(client, world),
      /round-trip hash mismatch/
    );
  });
});
