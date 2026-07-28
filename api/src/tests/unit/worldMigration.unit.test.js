import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  executePlayerPreservingWorldMigration,
  planPlayerPreservingWorldMigration,
} from '../../db/worldMigration.js';

function targetWorld() {
  return {
    config: {},
    castles: [],
    regions: [],
    nodes: [
      {
        nodeKey: 'castle:human',
        nodeType: 'castle',
        name: 'Human Castle',
        xCoord: 0,
        yCoord: 0,
        regionRace: 'human',
        difficultyTier: 1,
      },
      {
        nodeKey: 'forest:human:1',
        nodeType: 'forest',
        name: 'Human Forest',
        xCoord: 10,
        yCoord: 0,
        regionRace: 'human',
        difficultyTier: 1,
      },
    ],
    connections: [],
    routeManifest: [],
    obstacles: [],
    metadata: {
      outputHash: 'fixture-output-hash',
    },
    validation: {
      valid: true,
      errors: [],
      warnings: [],
    },
  };
}

function reference(tableName, columnName, targetColumnName = 'id') {
  return {
    schemaName: 'public',
    tableName,
    columnName,
    targetColumnName,
    constraintName: `${tableName}_${columnName}_fkey`,
  };
}

function sourceState(overrides = {}) {
  const references = [
    reference('characters', 'current_node_id'),
    reference('battles', 'node_id'),
  ];
  return {
    legacyNodes: [
      {
        id: 1,
        node_key: 'castle:human',
        node_type: 'castle',
        name: 'Human Castle',
        x_coord: 0,
        y_coord: 0,
        region_race: 'human',
        difficulty_tier: 1,
      },
      {
        id: 2,
        node_key: 'forest:human:1',
        node_type: 'forest',
        name: 'Human Forest',
        x_coord: 10,
        y_coord: 0,
        region_race: 'human',
        difficulty_tier: 1,
      },
    ],
    sourceMetadata: {
      seed_version: 2,
      world_seed: 7,
    },
    references,
    referenceValues: {
      'public.characters.current_node_id': [1],
      'public.battles.node_id': [2],
    },
    characterLocations: [{
      characterId: 11,
      nodeId: 1,
      homeCastleNodeKey: 'castle:human',
    }],
    activeBattleNodes: [{
      battleId: 21,
      nodeId: 2,
    }],
    protectedFingerprints: {
      accounts: { rowCount: 1, hash: 'protected' },
      users: { rowCount: 3, hash: 'users' },
      character_items: { rowCount: 5, hash: 'items' },
      character_skills: { rowCount: 7, hash: 'skills' },
      character_traits: { rowCount: 11, hash: 'traits' },
    },
    sourceStateFingerprints: {
      characters: { rowCount: 2, hash: 'characters' },
      character_quests: { rowCount: 13, hash: 'quests' },
      user_node_discovery: { rowCount: 17, hash: 'discovery' },
      user_node_clearance: { rowCount: 19, hash: 'clearance' },
    },
    questProgress: [{
      id: 31,
      node_progress: {
        forest: [2],
        enemy_kills: { wolf: 2 },
      },
    }],
    ...overrides,
  };
}

function planningDependencies(source = sourceState(), events = []) {
  return {
    assembleWorld: async () => {
      events.push('assemble');
      return structuredClone(targetWorld());
    },
    loadSourceState: async () => {
      events.push('load-source');
      return structuredClone(source);
    },
    validateFinalizedWorld: (world) => ({
      ...world.validation,
      valid: true,
      errors: [],
    }),
  };
}

const readOnlyClient = {
  query() {
    throw new Error('unexpected database query');
  },
};

describe('player-preserving world migration planning', () => {
  it('generates twice and returns the same deterministic confirmation hash', async () => {
    const events = [];
    const dependencies = planningDependencies(sourceState(), events);

    const first = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: '123',
      dependencies,
    });
    const second = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies,
    });

    assert.match(first.planHash, /^[0-9a-f]{64}$/);
    assert.equal(first.planHash, second.planHash);
    assert.equal(first.targetGenerationHash, second.targetGenerationHash);
    assert.equal(events.filter((event) => event === 'assemble').length, 4);
    assert.equal(first.questProgress[0].node_progress.forest[0], 2);
    assert.equal(first.source.nodeCount, 2);
    assert.equal(first.target.nodeCount, 2);
    assert.equal(first.preservation.collisionPreflight.collisionCount, 0);
    assert.deepEqual(first.preservation.sourceRowCounts, {
      users: 3,
      characters: 2,
      character_items: 5,
      character_skills: 7,
      character_traits: 11,
      character_quests: 13,
      user_node_discovery: 17,
      user_node_clearance: 19,
    });
    assert.equal(first.verification.generatedTwiceIdentically, true);
  });

  it('normalizes PostgreSQL Date values before hashing the plan', async () => {
    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    const source = sourceState({
      sourceMetadata: {
        seed_version: 2,
        generated_at: createdAt,
      },
      legacyNodes: sourceState().legacyNodes.map((node) => ({
        ...node,
        created_at: createdAt,
      })),
    });

    const plan = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies: planningDependencies(source),
    });

    assert.equal(plan.sourceMetadata.generated_at, createdAt.toISOString());
    assert.equal(plan.legacyNodes[0].created_at, createdAt.toISOString());
    assert.match(plan.planHash, /^[0-9a-f]{64}$/);
  });

  it('plans a normally mapped character whose home region is unset', async () => {
    const source = sourceState({
      characterLocations: [{
        characterId: 11,
        nodeId: 2,
        homeCastleNodeKey: null,
      }],
    });

    const plan = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies: planningDependencies(source),
    });

    assert.match(plan.planHash, /^[0-9a-f]{64}$/);
    assert.deepEqual(plan.characterFallbackRelocations, []);
    assert.deepEqual(plan.mapping.criticalReferences.characterLocations, [{
      kind: 'character_location',
      referenceId: 11,
      legacyNodeId: 2,
      targetNodeKey: 'forest:human:1',
      method: 'mapped',
      reason: 'resolved through stable_key',
    }]);
  });

  it('fails closed when the two generated targets differ', async () => {
    let assembly = 0;
    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies: {
          ...planningDependencies(),
          assembleWorld: async () => {
            const world = targetWorld();
            world.nodes[0].name = `Castle ${assembly++}`;
            return world;
          },
        },
      }),
      /nondeterministic/
    );
  });

  it('rejects an unhandled world_nodes foreign key even through injection', async () => {
    const unknown = reference('new_player_state', 'node_id');
    const source = sourceState({
      references: [unknown],
      referenceValues: {
        'public.new_player_state.node_id': [1],
      },
    });

    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies: planningDependencies(source),
      }),
      /Unhandled single-column foreign key.*new_player_state/
    );
  });

  it('rejects composite world_nodes foreign keys instead of filtering them out', async () => {
    const composite = {
      ...reference('characters', 'current_node_id'),
      columnCount: 2,
      constraintName: 'characters_composite_world_node_fkey',
    };
    const source = sourceState({
      references: [composite],
      referenceValues: {
        'public.characters.current_node_id': [1],
      },
    });

    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies: planningDependencies(source),
      }),
      /Composite foreign key.*characters_composite_world_node_fkey/
    );
  });

  it('detects reward collisions in the read-only confirmed plan', async () => {
    const chestReference = reference('user_chest_claims', 'node_id');
    const source = sourceState({
      legacyNodes: [
        {
          id: 3,
          node_key: 'old:chest:3',
          node_type: 'chest',
          name: 'Old Chest A',
          x_coord: 20,
          y_coord: 0,
          difficulty_tier: 1,
        },
        {
          id: 4,
          node_key: 'old:chest:4',
          node_type: 'chest',
          name: 'Old Chest B',
          x_coord: 21,
          y_coord: 0,
          difficulty_tier: 1,
        },
      ],
      references: [chestReference],
      referenceValues: {
        'public.user_chest_claims.node_id': [3, 4],
      },
      collisionRows: {
        'public.user_chest_claims.node_id': [
          { node_id: 3, user_id: 8 },
          { node_id: 4, user_id: 8 },
        ],
      },
      characterLocations: [],
      activeBattleNodes: [],
      questProgress: [],
    });
    const world = targetWorld();
    world.nodes = [{
      nodeKey: 'new:chest',
      nodeType: 'chest',
      name: 'New Chest',
      xCoord: 0,
      yCoord: 0,
      difficultyTier: 1,
    }];

    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies: {
          loadSourceState: async () => structuredClone(source),
          assembleWorld: async () => structuredClone(world),
        },
      }),
      /collide with a unique reward\/activity row/
    );
  });

  it('rejects live direct and quest references to unmapped legacy nodes', async () => {
    const legacyNodes = [{
      id: 99,
      node_key: 'unknown:99',
      node_type: 'unknown_realm',
      name: 'Unknown',
      x_coord: 50,
      y_coord: 50,
      difficulty_tier: 1,
    }];
    const chatReference = reference('chat_messages', 'node_id');

    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies: planningDependencies(sourceState({
          legacyNodes,
          references: [chatReference],
          referenceValues: { 'public.chat_messages.node_id': [99] },
          characterLocations: [],
          activeBattleNodes: [],
          questProgress: [],
        })),
      }),
      /Cannot preserve live public\.chat_messages\.node_id reference/
    );

    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies: planningDependencies(sourceState({
          legacyNodes,
          references: [],
          referenceValues: {},
          characterLocations: [],
          activeBattleNodes: [],
          questProgress: [{
            id: 41,
            node_progress: { forest: [99] },
          }],
        })),
      }),
      /Cannot preserve character_quests\.node_progress/
    );
  });

  it('requires both sides of an active battle mapping to be combat nodes', async () => {
    const source = sourceState({
      referenceValues: {
        'public.characters.current_node_id': [1],
        'public.battles.node_id': [1],
      },
      activeBattleNodes: [{ battleId: 22, nodeId: 1 }],
    });

    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies: planningDependencies(source),
      }),
      /Active battle 22 cannot move from castle/
    );

    const combatSource = sourceState({
      legacyNodes: [{
        id: 2,
        node_key: 'old:forest',
        node_type: 'forest',
        name: 'Old Forest',
        x_coord: 10,
        y_coord: 0,
        difficulty_tier: 1,
      }],
      references: [reference('battles', 'node_id')],
      referenceValues: { 'public.battles.node_id': [2] },
      characterLocations: [],
      activeBattleNodes: [{ battleId: 23, nodeId: 2 }],
      questProgress: [],
    });
    const mountainWorld = targetWorld();
    mountainWorld.nodes = [{
      nodeKey: 'new:mountain',
      nodeType: 'mountain',
      name: 'New Mountain',
      xCoord: 0,
      yCoord: 0,
      difficultyTier: 1,
    }];
    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies: {
          loadSourceState: async () => structuredClone(combatSource),
          assembleWorld: async () => structuredClone(mountainWorld),
        },
      }),
      /battle 23 \(active\).*exact node type forest/
    );
  });

  it('requires inactive battle history to retain its exact node type', async () => {
    const source = sourceState({
      legacyNodes: [{
        id: 2,
        node_key: 'old:forest',
        node_type: 'forest',
        name: 'Old Forest',
        x_coord: 10,
        y_coord: 0,
        difficulty_tier: 1,
      }],
      references: [reference('battles', 'node_id')],
      referenceValues: { 'public.battles.node_id': [2] },
      characterLocations: [],
      battleNodes: [{
        battleId: 24,
        nodeId: 2,
        status: 'victory',
      }],
      activeBattleNodes: [],
      questProgress: [],
    });
    const mountainWorld = targetWorld();
    mountainWorld.nodes = [{
      nodeKey: 'new:mountain',
      nodeType: 'mountain',
      name: 'New Mountain',
      xCoord: 0,
      yCoord: 0,
      difficultyTier: 1,
    }];

    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies: {
          loadSourceState: async () => structuredClone(source),
          assembleWorld: async () => structuredClone(mountainWorld),
        },
      }),
      /battle 24 \(victory\).*exact node type forest/
    );
  });

  it('selects a farther exact-type target for inactive battle history', async () => {
    const source = sourceState({
      legacyNodes: [{
        id: 2,
        node_key: 'old:forest',
        node_type: 'forest',
        name: 'Old Forest',
        x_coord: 0,
        y_coord: 0,
        difficulty_tier: 1,
      }],
      references: [reference('battles', 'node_id')],
      referenceValues: { 'public.battles.node_id': [2] },
      characterLocations: [],
      battleNodes: [{
        battleId: 25,
        nodeId: 2,
        status: 'victory',
      }],
      activeBattleNodes: [],
      questProgress: [],
    });
    const world = targetWorld();
    world.nodes = [
      {
        nodeKey: 'near:mountain',
        nodeType: 'mountain',
        name: 'Near Mountain',
        xCoord: 0,
        yCoord: 0,
        difficultyTier: 1,
      },
      {
        nodeKey: 'far:forest',
        nodeType: 'forest',
        name: 'Far Forest',
        xCoord: 100,
        yCoord: 0,
        difficultyTier: 1,
      },
    ];

    const plan = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies: {
        loadSourceState: async () => structuredClone(source),
        assembleWorld: async () => structuredClone(world),
      },
    });

    assert.equal(plan.mapping.mappings[0].targetNodeKey, 'far:forest');
    assert.deepEqual(
      plan.mapping.mappings[0].requiredTargetNodeKeys,
      ['far:forest']
    );
  });

  it('preflights persisted region generator identity compatibility', async () => {
    const source = sourceState({
      persistedRegionIdentities: [{
        id: 1,
        castle_key: null,
        generator_x: null,
        generator_y: null,
      }],
    });
    const world = targetWorld();
    world.regions = [{
      id: 1,
      castleKey: 'castle:human',
      generatorPoint: { x: 0, y: 0 },
    }];
    const plan = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies: {
        loadSourceState: async () => structuredClone(source),
        assembleWorld: async () => structuredClone(world),
      },
    });

    assert.equal(plan.preservation.regionIdentity.initializedCount, 1);
    assert.equal(
      plan.preservation.regionIdentity.compatibility[0].status,
      'initialization'
    );

    source.persistedRegionIdentities[0] = {
      id: 1,
      castle_key: 'castle:human',
      generator_x: 5,
      generator_y: 6,
    };
    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies: {
          loadSourceState: async () => structuredClone(source),
          assembleWorld: async () => structuredClone(world),
        },
      }),
      /Persisted region 1 generator identity is incompatible/
    );
  });

  it('fails closed when a persisted region race is permuted', async () => {
    const source = sourceState({
      persistedRegionIdentities: [{
        id: 1,
        race: 'human',
        castle_key: 'castle:human',
        generator_x: 0,
        generator_y: 0,
      }],
    });
    const world = targetWorld();
    world.regions = [{
      id: 1,
      race: 'elf',
      castleKey: 'castle:human',
      generatorPoint: { x: 0, y: 0 },
    }];

    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies: {
          loadSourceState: async () => structuredClone(source),
          assembleWorld: async () => structuredClone(world),
        },
      }),
      /Persisted region 1 race is incompatible/
    );
  });

  it('audits every home-castle fallback relocation deterministically', async () => {
    const source = sourceState({
      legacyNodes: [
        ...sourceState().legacyNodes,
        {
          id: 99,
          node_key: 'legacy:void',
          node_type: 'void',
          name: 'Legacy Void',
          x_coord: 50,
          y_coord: 50,
          difficulty_tier: 1,
        },
      ],
      references: [reference('characters', 'current_node_id')],
      referenceValues: {
        'public.characters.current_node_id': [99, 99],
      },
      characterLocations: [
        {
          characterId: 22,
          nodeId: 99,
          homeCastleNodeKey: 'castle:elf',
        },
        {
          characterId: 11,
          nodeId: 99,
          homeCastleNodeKey: 'castle:human',
        },
      ],
      battleNodes: [],
      activeBattleNodes: [],
      questProgress: [],
    });
    const world = targetWorld();
    world.nodes.push({
      nodeKey: 'castle:elf',
      nodeType: 'castle',
      name: 'Elf Castle',
      xCoord: 20,
      yCoord: 0,
      regionRace: 'elf',
      difficultyTier: 1,
    });

    const plan = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies: {
        loadSourceState: async () => structuredClone(source),
        assembleWorld: async () => structuredClone(world),
      },
    });

    assert.deepEqual(plan.characterFallbackRelocations, [
      {
        kind: 'character_location',
        characterId: 11,
        legacyNodeId: 99,
        legacyNodeKey: 'legacy:void',
        legacyNodeType: 'void',
        targetNodeKey: 'castle:human',
        targetNodeType: 'castle',
        method: 'home_castle_fallback',
        reason: 'legacy node was unmappable; explicit home-castle fallback used',
      },
      {
        kind: 'character_location',
        characterId: 22,
        legacyNodeId: 99,
        legacyNodeKey: 'legacy:void',
        legacyNodeType: 'void',
        targetNodeKey: 'castle:elf',
        targetNodeType: 'castle',
        method: 'home_castle_fallback',
        reason: 'legacy node was unmappable; explicit home-castle fallback used',
      },
    ]);
    assert.deepEqual(
      plan.preservation.characterFallbackRelocations,
      plan.characterFallbackRelocations
    );
  });

  it('requires progression-node semantics to survive remapping', async () => {
    const references = [
      reference('user_zodiac_crystals', 'shrine_node_id'),
      reference('user_discoveries', 'node_id'),
      reference('user_ruins_completions', 'node_id'),
    ];
    const source = sourceState({
      legacyNodes: [
        {
          id: 5,
          node_key: 'shrine:aries',
          node_type: 'shrine',
          shrine_buff_type: 'zodiac_aries',
          x_coord: 0,
          y_coord: 0,
          difficulty_tier: 1,
        },
        {
          id: 6,
          node_key: 'discovery:lore',
          node_type: 'discovery',
          lore_key: 'lore_dragon',
          x_coord: 10,
          y_coord: 0,
          difficulty_tier: 1,
        },
        {
          id: 7,
          node_key: 'ruins:tier-1',
          node_type: 'ruins',
          ruins_reward_tier: 1,
          ruins_puzzle_type: null,
          x_coord: 20,
          y_coord: 0,
          difficulty_tier: 1,
        },
        {
          id: 8,
          node_key: 'shrine:taurus',
          node_type: 'shrine',
          shrine_buff_type: 'zodiac_taurus',
          x_coord: 30,
          y_coord: 0,
          difficulty_tier: 1,
        },
      ],
      references,
      referenceValues: {
        'public.user_zodiac_crystals.shrine_node_id': [5, 8],
        'public.user_discoveries.node_id': [6],
        'public.user_ruins_completions.node_id': [7],
      },
      collisionRows: {
        'public.user_zodiac_crystals.shrine_node_id': [
          {
            shrine_node_id: 8,
            zodiac_sign: 'taurus',
          },
          {
            shrine_node_id: 5,
            zodiac_sign: 'aries',
          },
        ],
        'public.user_discoveries.node_id': [{
          node_id: 6,
          user_id: 2,
          lore_key: 'lore_dragon',
        }],
        'public.user_ruins_completions.node_id': [{
          node_id: 7,
          user_id: 2,
          puzzle_solved: true,
          reward_claimed: true,
        }],
      },
      characterLocations: [],
      activeBattleNodes: [],
      questProgress: [],
    });
    const world = targetWorld();
    world.nodes = [
      {
        nodeKey: 'shrine:aries',
        nodeType: 'shrine',
        shrineBuffType: 'zodiac_aries',
        xCoord: 0,
        yCoord: 0,
        difficultyTier: 1,
      },
      {
        nodeKey: 'discovery:lore',
        nodeType: 'discovery',
        loreKey: 'lore_dragon',
        xCoord: 10,
        yCoord: 0,
        difficultyTier: 1,
      },
      {
        nodeKey: 'ruins:tier-1',
        nodeType: 'ruins',
        ruinsTier: 1,
        xCoord: 20,
        yCoord: 0,
        difficultyTier: 1,
      },
      {
        nodeKey: 'shrine:taurus',
        nodeType: 'shrine',
        shrineBuffType: 'zodiac_taurus',
        xCoord: 30,
        yCoord: 0,
        difficultyTier: 1,
      },
    ];
    const dependencies = {
      loadSourceState: async () => structuredClone(source),
      assembleWorld: async () => structuredClone(world),
      validateFinalizedWorld: (candidate) => ({
        ...candidate.validation,
        valid: true,
        errors: [],
      }),
    };

    const plan = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies,
    });
    assert.equal(plan.preservation.semanticPreflight.checkedRowCount, 4);

    source.collisionRows[
      'public.user_zodiac_crystals.shrine_node_id'
    ].reverse();
    const reorderedPlan = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies,
    });
    assert.equal(reorderedPlan.planHash, plan.planHash);

    world.nodes[0].shrineBuffType = 'zodiac_taurus';
    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies,
      }),
      /cannot preserve zodiac sign aries/
    );

    world.nodes[0].shrineBuffType = 'zodiac_aries';
    world.nodes[1].loreKey = 'lore_changed';
    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies,
      }),
      /cannot preserve lore key lore_dragon/
    );

    world.nodes[1].loreKey = 'lore_dragon';
    world.nodes[2].ruinsTier = 2;
    const tierOverlay = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies,
    });
    assert.equal(tierOverlay.semanticOverlay.assignments.length, 1);
    assert.deepEqual(tierOverlay.semanticOverlay.assignments[0].before, {
      ruinsTier: 2,
      ruinsPuzzleType: null,
    });
    assert.deepEqual(tierOverlay.semanticOverlay.assignments[0].after, {
      ruinsTier: 1,
      ruinsPuzzleType: null,
    });
    assert.equal(tierOverlay.semanticOverlay.assignments[0].changed, true);
    assert.equal(tierOverlay.targetWorld.nodes[2].ruinsTier, 1);
    assert.equal(world.nodes[2].ruinsTier, 2);
    assert.notEqual(
      tierOverlay.target.outputHash,
      tierOverlay.semanticOverlay.baseTargetMetadata.outputHash
    );

    world.nodes[2].ruinsTier = 1;
    world.nodes[2].ruinsPuzzleType = 'glyphs';
    const puzzleOverlay = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies,
    });
    assert.equal(
      puzzleOverlay.semanticOverlay.assignments[0].after.ruinsPuzzleType,
      null
    );
    assert.equal(
      puzzleOverlay.targetWorld.nodes[2].ruinsPuzzleType,
      null
    );

    world.nodes[2].ruinsTier = 2;
    world.nodes[2].ruinsPuzzleType = null;
    world.nodes.push({
      nodeKey: 'ruins:compatible',
      nodeType: 'ruins',
      ruinsTier: 1,
      ruinsPuzzleType: null,
      xCoord: 21,
      yCoord: 0,
      difficultyTier: 1,
    });
    const semanticRemap = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies,
    });
    const ruinsMapping = semanticRemap.mapping.mappings.find(
      ({ legacyNodeId }) => legacyNodeId === 7
    );
    assert.equal(ruinsMapping.targetNodeKey, 'ruins:compatible');
    assert.equal(ruinsMapping.eligibilityConstraintApplied, true);
    assert.deepEqual(
      ruinsMapping.requiredTargetNodeKeys,
      ['ruins:compatible']
    );
  });

  it('reserves distinct deterministic ruins carriers or fails for capacity', async () => {
    const source = sourceState({
      legacyNodes: [
        {
          id: 7,
          node_key: 'legacy:ruins:west',
          node_type: 'ruins',
          ruins_reward_tier: 1,
          ruins_puzzle_type: null,
          x_coord: 0,
          y_coord: 0,
          difficulty_tier: 1,
          region_id: 1,
        },
        {
          id: 9,
          node_key: 'legacy:ruins:east',
          node_type: 'ruins',
          ruins_reward_tier: 1,
          ruins_puzzle_type: 'glyphs',
          x_coord: 100,
          y_coord: 0,
          difficulty_tier: 1,
          region_id: 2,
        },
      ],
      references: [reference('user_ruins_completions', 'node_id')],
      referenceValues: {
        'public.user_ruins_completions.node_id': [7, 7, 9],
      },
      collisionRows: {
        'public.user_ruins_completions.node_id': [
          {
            node_id: 9,
            user_id: 2,
            puzzle_solved: true,
            reward_claimed: true,
          },
          {
            node_id: 7,
            user_id: 2,
            puzzle_solved: true,
            reward_claimed: true,
          },
          {
            node_id: 7,
            user_id: 3,
            puzzle_solved: true,
            reward_claimed: true,
          },
        ],
      },
      characterLocations: [],
      activeBattleNodes: [],
      questProgress: [],
    });
    const world = targetWorld();
    world.nodes = [
      {
        nodeKey: 'generated:ruins:west',
        nodeType: 'ruins',
        ruinsTier: 2,
        ruinsPuzzleType: null,
        xCoord: 1,
        yCoord: 0,
        difficultyTier: 2,
        regionId: 1,
      },
      {
        nodeKey: 'generated:ruins:east',
        nodeType: 'ruins',
        ruinsTier: 3,
        ruinsPuzzleType: null,
        xCoord: 99,
        yCoord: 0,
        difficultyTier: 3,
        regionId: 2,
      },
    ];
    const dependencies = {
      loadSourceState: async () => structuredClone(source),
      assembleWorld: async () => structuredClone(world),
      validateFinalizedWorld: (candidate) => ({
        ...candidate.validation,
        valid: true,
        errors: [],
      }),
    };

    const plan = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies,
    });
    assert.deepEqual(
      plan.semanticOverlay.assignments.map((assignment) => ({
        legacy: assignment.sourceLegacyNodeId,
        carrier: assignment.targetNodeKey,
        completions: assignment.affectedCompletionCount,
      })),
      [
        {
          legacy: 7,
          carrier: 'generated:ruins:west',
          completions: 2,
        },
        {
          legacy: 9,
          carrier: 'generated:ruins:east',
          completions: 1,
        },
      ]
    );
    assert.equal(
      new Set(
        plan.mapping.mappings.map((mapping) => mapping.targetNodeKey)
      ).size,
      2
    );
    assert.equal(plan.preservation.collisionPreflight.collisionCount, 0);

    world.nodes.pop();
    await assert.rejects(
      planPlayerPreservingWorldMigration({
        client: readOnlyClient,
        worldSeed: 123,
        dependencies,
      }),
      /1 ruins carrier.*2 referenced legacy ruins/
    );
  });
});

function fakePool(events, queryHandler) {
  const client = {
    async query(sql, parameters) {
      const normalized = sql.trim().replace(/\s+/g, ' ');
      events.push(normalized);
      const handled = queryHandler?.(normalized, parameters);
      if (handled) return handled;
      return { rows: [] };
    },
    release() {
      events.push('release');
    },
  };
  return {
    client,
    pool: {
      async connect() {
        events.push('connect');
        return client;
      },
    },
  };
}

function executionDependencies(source, events, overrides = {}) {
  return {
    ...planningDependencies(source, events),
    enumerateWorldNodeReferences: async () => {
      events.push('enumerate');
      return source.references;
    },
    lockMigrationTables: async () => {
      events.push('lock');
    },
    createMigrationRun: async () => {
      events.push('create-run');
      return 51;
    },
    archiveSourceState: async () => {
      events.push('archive');
      return { world_nodes: source.legacyNodes.length };
    },
    makeGraphsCoexist: async () => {
      events.push('coexist');
    },
    insertGraph: async () => {
      events.push('insert-graph');
      return { nodeIds: [101, 102] };
    },
    remapPlayerState: async (_client, _plan, oldToNew) => {
      events.push('remap');
      assert.deepEqual([...oldToNew], [[1, 101], [2, 102]]);
      return { remappedRows: 2 };
    },
    assertNoOldReferences: async () => {
      events.push('assert-no-old-references');
    },
    verifyRemappedState: async () => {
      events.push('verify-remapped-state');
      return {
        directReferenceCount: 2,
        discoveryRows: 0,
        clearanceRows: 0,
      };
    },
    verifyQuestProgress: async () => {
      events.push('verify-quest-progress');
      return { rowCount: source.questProgress.length, hash: 'quest-hash' };
    },
    fingerprintProtectedTables: async () => {
      events.push('fingerprint');
      return source.protectedFingerprints;
    },
    saveSeedMetadata: async () => {
      events.push('save-metadata');
    },
    validatePersistedWorld: async () => {
      events.push('validate-persistence');
      return { valid: true };
    },
    ...overrides,
  };
}

describe('player-preserving world migration execution', () => {
  it('archives fallback-remapped character locations for recovery', async () => {
    const source = sourceState({
      legacyNodes: [
        ...sourceState().legacyNodes,
        {
          id: 99,
          node_key: 'legacy:void',
          node_type: 'void',
          name: 'Legacy Void',
          x_coord: 50,
          y_coord: 50,
          difficulty_tier: 1,
        },
      ],
      references: [reference('characters', 'current_node_id')],
      referenceValues: {
        'public.characters.current_node_id': [99],
      },
      characterLocations: [{
        characterId: 11,
        nodeId: 99,
        homeCastleNodeKey: 'castle:human',
      }],
      battleNodes: [],
      activeBattleNodes: [],
      questProgress: [],
    });
    const preview = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies: planningDependencies(source),
    });
    const events = [];
    let archivedCharacterReferences;
    const { pool } = fakePool(events, (sql, parameters) => {
      if (sql.includes('FROM "public"."characters" source_row')) {
        return {
          rows: [{
            source_row: {
              id: 11,
              current_node_id: 99,
            },
          }],
        };
      }
      if (
        sql.startsWith('INSERT INTO world_migration_progress_archive')
        && parameters?.[1] === 'characters'
      ) {
        archivedCharacterReferences = JSON.parse(parameters[6]);
      }
      return undefined;
    });

    await executePlayerPreservingWorldMigration({
      pool,
      worldSeed: 123,
      expectedPlanHash: preview.planHash,
      initiatedBy: 'unit-test',
      dependencies: executionDependencies(source, events, {
        archiveSourceState: null,
      }),
    });

    assert.deepEqual(archivedCharacterReferences, {
      current_node_id: preview.characterFallbackRelocations[0],
    });
  });

  it('replans after locks and commits all work in one transaction', async () => {
    const source = sourceState();
    const preview = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies: planningDependencies(source),
    });
    const events = [];
    const { pool } = fakePool(events);

    const result = await executePlayerPreservingWorldMigration({
      pool,
      worldSeed: 123,
      expectedPlanHash: preview.planHash,
      initiatedBy: 'unit-test',
      dependencies: executionDependencies(source, events),
    });

    assert.equal(result.migrationId, 51);
    assert.equal(result.planHash, preview.planHash);
    assert.deepEqual(
      result.preservationReport.sourceRowCounts,
      preview.preservation.sourceRowCounts
    );
    assert.deepEqual(
      result.preservationReport.characterFallbackRelocations,
      preview.characterFallbackRelocations
    );
    assert.equal('targetWorld' in result, false);
    assert.ok(events.indexOf('lock') < events.indexOf('load-source'));
    assert.ok(events.indexOf('load-source') < events.indexOf('create-run'));
    assert.ok(events.includes('BEGIN'));
    assert.ok(events.includes('COMMIT'));
    assert.ok(!events.includes('ROLLBACK'));
    assert.equal(events.at(-1), 'release');
  });

  it('rolls back a stale confirmation before creating an audit run', async () => {
    const source = sourceState();
    const events = [];
    const { pool } = fakePool(events);

    await assert.rejects(
      executePlayerPreservingWorldMigration({
        pool,
        worldSeed: 123,
        expectedPlanHash: '0'.repeat(64),
        dependencies: executionDependencies(source, events),
      }),
      /Confirmed migration plan changed/
    );

    assert.ok(events.includes('lock'));
    assert.ok(events.includes('ROLLBACK'));
    assert.ok(!events.includes('create-run'));
    assert.ok(!events.includes('COMMIT'));
    assert.equal(events.at(-1), 'release');
  });

  it('rolls back every graph and player-state write when remapping fails', async () => {
    const source = sourceState();
    const preview = await planPlayerPreservingWorldMigration({
      client: readOnlyClient,
      worldSeed: 123,
      dependencies: planningDependencies(source),
    });
    const events = [];
    const { pool } = fakePool(events);

    await assert.rejects(
      executePlayerPreservingWorldMigration({
        pool,
        worldSeed: 123,
        expectedPlanHash: preview.planHash,
        dependencies: executionDependencies(source, events, {
          remapPlayerState: async () => {
            events.push('remap');
            throw new Error('injected remap failure');
          },
        }),
      }),
      /injected remap failure/
    );

    assert.ok(events.indexOf('archive') < events.indexOf('remap'));
    assert.ok(events.indexOf('insert-graph') < events.indexOf('remap'));
    assert.ok(events.includes('ROLLBACK'));
    assert.ok(!events.includes('COMMIT'));
    assert.equal(events.at(-1), 'release');
  });
});
