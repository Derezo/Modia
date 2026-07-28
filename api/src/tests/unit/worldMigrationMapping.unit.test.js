import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorldMigrationMappingPlan,
  expandFullCombatClearance,
  hasFullCombatClearance,
  mergeDiscoveryMethods,
  mergeDiscoveryRecords,
  remapNodeProgress,
} from '../../db/worldMigrationMapping.js';

function legacyNode(id, nodeType, overrides = {}) {
  return {
    id,
    node_key: `legacy:node:${id}`,
    node_type: nodeType,
    name: `${nodeType} ${id}`,
    x_coord: id * 10,
    y_coord: id * 5,
    region_id: 1,
    region_race: 'human',
    difficulty_tier: 1,
    ...overrides,
  };
}

function targetNode(nodeKey, nodeType, overrides = {}) {
  return {
    nodeKey,
    nodeType,
    name: nodeKey,
    xCoord: 0,
    yCoord: 0,
    regionId: 1,
    regionRace: 'human',
    difficultyTier: 1,
    ...overrides,
  };
}

describe('world migration mapping plan', () => {
  it('is deterministic regardless of input order', () => {
    const legacyNodes = [
      legacyNode(2, 'forest', { x_coord: 90 }),
      legacyNode(1, 'forest', { x_coord: 10 }),
    ];
    const targetNodes = [
      targetNode('forest:east', 'forest', { xCoord: 100 }),
      targetNode('forest:west', 'forest', { xCoord: 0 }),
    ];

    const forward = buildWorldMigrationMappingPlan({
      legacyNodes,
      targetNodes,
    });
    const reversed = buildWorldMigrationMappingPlan({
      legacyNodes: [...legacyNodes].reverse(),
      targetNodes: [...targetNodes].reverse(),
    });

    assert.deepEqual(forward, reversed);
    assert.deepEqual(
      forward.mappings.map(({ legacyNodeId, targetNodeKey }) => ({
        legacyNodeId,
        targetNodeKey,
      })),
      [
        { legacyNodeId: 1, targetNodeKey: 'forest:west' },
        { legacyNodeId: 2, targetNodeKey: 'forest:east' },
      ]
    );
  });

  it('maps castle and guild anchors by region identity and role', () => {
    const plan = buildWorldMigrationMappingPlan({
      legacyNodes: [
        legacyNode(1, 'castle', { region_race: 'elf' }),
        legacyNode(2, 'guild', {
          region_race: 'elf',
          guild_type: 'mage',
        }),
      ],
      targetNodes: [
        targetNode('castle:human', 'castle', { regionRace: 'human' }),
        targetNode('castle:elf', 'castle', { regionRace: 'elf' }),
        targetNode('guild:elf:warrior', 'guild', {
          regionRace: 'elf',
          guildType: 'warrior',
        }),
        targetNode('guild:elf:mage', 'guild', {
          regionRace: 'elf',
          guildType: 'mage',
        }),
      ],
    });

    assert.deepEqual(
      plan.mappings.map(({ targetNodeKey, method, confidence }) => ({
        targetNodeKey,
        method,
        confidence,
      })),
      [
        {
          targetNodeKey: 'castle:elf',
          method: 'semantic_anchor',
          confidence: 'high',
        },
        {
          targetNodeKey: 'guild:elf:mage',
          method: 'semantic_anchor',
          confidence: 'high',
        },
      ]
    );
  });

  it('uses an auditable same-class fallback only when the exact type is absent', () => {
    const plan = buildWorldMigrationMappingPlan({
      legacyNodes: [legacyNode(10, 'chest')],
      targetNodes: [targetNode('reward:shrine', 'shrine')],
    });

    assert.equal(plan.mappings[0].targetNodeKey, 'reward:shrine');
    assert.equal(plan.mappings[0].method, 'semantic_class_region');
    assert.equal(plan.mappings[0].confidence, 'low');
    assert.match(plan.mappings[0].reason, /reward_site/);
  });

  it('applies target eligibility before ranking a constrained ruins node', () => {
    const plan = buildWorldMigrationMappingPlan({
      legacyNodes: [legacyNode(10, 'ruins', {
        x_coord: 0,
        difficulty_tier: 1,
      })],
      targetNodes: [
        targetNode('ruins:tier:1', 'ruins', {
          xCoord: 1,
          difficultyTier: 1,
        }),
        targetNode('ruins:tier:3', 'ruins', {
          xCoord: 100,
          difficultyTier: 3,
        }),
      ],
      requiredTargetNodeKeysByLegacyId: {
        10: ['ruins:tier:3'],
      },
    });

    assert.equal(plan.mappings[0].targetNodeKey, 'ruins:tier:3');
    assert.equal(plan.mappings[0].eligibilityConstraintApplied, true);
    assert.deepEqual(
      plan.mappings[0].requiredTargetNodeKeys,
      ['ruins:tier:3']
    );
    assert.equal(plan.audit.eligibilityConstrainedNodeCount, 1);
    assert.equal(plan.audit.eligibilityConstraintUnmappedNodeCount, 0);
  });

  it('audits a constrained node with no eligible compatible target as unmapped', () => {
    const options = {
      legacyNodes: [legacyNode(10, 'ruins')],
      targetNodes: [
        targetNode('ruins:tier:1', 'ruins'),
        targetNode('city:human', 'city'),
      ],
      requiredTargetNodeKeysByLegacyId: {
        10: ['city:human'],
      },
    };
    const plan = buildWorldMigrationMappingPlan(options);

    assert.equal(plan.mappings.length, 0);
    assert.deepEqual(plan.unmapped, [{
      legacyNodeId: 10,
      legacyNodeKey: 'legacy:node:10',
      legacyNodeType: 'ruins',
      semanticClass: 'exploration_site',
      reason: 'target eligibility constraint allows no compatible target',
      eligibilityConstraintApplied: true,
      requiredTargetNodeKeys: ['city:human'],
    }]);
    assert.equal(plan.audit.eligibilityConstraintUnmappedNodeCount, 1);

    assert.throws(
      () => buildWorldMigrationMappingPlan({
        ...options,
        characterLocations: [{ characterId: 42, nodeId: 10 }],
      }),
      /Cannot map character_location 42/
    );
  });

  it('keeps constrained mapping deterministic across all input orderings', () => {
    const legacyNodes = [
      legacyNode(2, 'ruins', { x_coord: 90 }),
      legacyNode(1, 'ruins', { x_coord: 10 }),
    ];
    const targetNodes = [
      targetNode('ruins:east', 'ruins', { xCoord: 100 }),
      targetNode('ruins:west', 'ruins', { xCoord: 0 }),
    ];
    const forward = buildWorldMigrationMappingPlan({
      legacyNodes,
      targetNodes,
      requiredTargetNodeKeysByLegacyId: {
        2: ['ruins:west', 'ruins:east'],
        1: ['ruins:east', 'ruins:west'],
      },
    });
    const reversed = buildWorldMigrationMappingPlan({
      legacyNodes: [...legacyNodes].reverse(),
      targetNodes: [...targetNodes].reverse(),
      requiredTargetNodeKeysByLegacyId: {
        1: ['ruins:west', 'ruins:east'],
        2: ['ruins:east', 'ruins:west'],
      },
    });

    assert.deepEqual(forward, reversed);
    assert.deepEqual(
      forward.mappings.map(({ legacyNodeId, targetNodeKey }) => ({
        legacyNodeId,
        targetNodeKey,
      })),
      [
        { legacyNodeId: 1, targetNodeKey: 'ruins:west' },
        { legacyNodeId: 2, targetNodeKey: 'ruins:east' },
      ]
    );
  });

  it('validates target eligibility constraint input', () => {
    const options = {
      legacyNodes: [legacyNode(10, 'ruins')],
      targetNodes: [targetNode('ruins:tier:1', 'ruins')],
    };

    assert.throws(
      () => buildWorldMigrationMappingPlan({
        ...options,
        requiredTargetNodeKeysByLegacyId: [],
      }),
      /must be a plain object/
    );
    assert.throws(
      () => buildWorldMigrationMappingPlan({
        ...options,
        requiredTargetNodeKeysByLegacyId: null,
      }),
      /must be a plain object/
    );
    assert.throws(
      () => buildWorldMigrationMappingPlan({
        ...options,
        requiredTargetNodeKeysByLegacyId: { 10: 'ruins:tier:1' },
      }),
      /must be an array/
    );
    assert.throws(
      () => buildWorldMigrationMappingPlan({
        ...options,
        requiredTargetNodeKeysByLegacyId: { 999: ['ruins:tier:1'] },
      }),
      /unknown legacy node 999/
    );
  });

  it('balances type shrinkage and reports unavoidable collisions', () => {
    const plan = buildWorldMigrationMappingPlan({
      legacyNodes: [
        legacyNode(1, 'chest', { x_coord: 0 }),
        legacyNode(2, 'chest', { x_coord: 100 }),
        legacyNode(3, 'chest', { x_coord: 2 }),
      ],
      targetNodes: [
        targetNode('chest:left', 'chest', { xCoord: 0 }),
        targetNode('chest:right', 'chest', { xCoord: 100 }),
      ],
    });

    assert.deepEqual(
      plan.mappings.map((mapping) => mapping.targetNodeKey),
      ['chest:left', 'chest:right', 'chest:left']
    );
    assert.equal(plan.audit.collisionTargetCount, 1);
    assert.equal(plan.audit.collisionMappingCount, 2);
    assert.equal(plan.mappings[0].targetAssignmentCount, 2);
    assert.equal(plan.mappings[2].collisionOrdinal, 2);
  });

  it('uses every exact-type target before creating avoidable collisions', () => {
    const plan = buildWorldMigrationMappingPlan({
      legacyNodes: [
        legacyNode(1, 'forest', { region_race: 'human', x_coord: 0 }),
        legacyNode(2, 'forest', { region_race: 'human', x_coord: 1 }),
      ],
      targetNodes: [
        targetNode('forest:human', 'forest', {
          regionRace: 'human',
          xCoord: 0,
        }),
        targetNode('forest:elf', 'forest', {
          regionRace: 'elf',
          xCoord: 100,
        }),
      ],
    });

    assert.deepEqual(
      plan.mappings.map((mapping) => mapping.targetNodeKey),
      ['forest:human', 'forest:elf']
    );
    assert.equal(plan.audit.collisionTargetCount, 0);
  });

  it('fails closed for unmappable critical references', () => {
    assert.throws(
      () => buildWorldMigrationMappingPlan({
        legacyNodes: [legacyNode(1, 'unknown_realm')],
        targetNodes: [targetNode('castle:human', 'castle')],
        characterLocations: [{ characterId: 42, nodeId: 1 }],
      }),
      /Cannot map character_location 42/
    );

    assert.throws(
      () => buildWorldMigrationMappingPlan({
        legacyNodes: [],
        targetNodes: [targetNode('castle:human', 'castle')],
        activeBattleNodes: [{ battleId: 9, nodeId: 999 }],
      }),
      /Cannot map active_battle 9/
    );
  });

  it('permits an explicit, validated home-castle fallback', () => {
    const plan = buildWorldMigrationMappingPlan({
      legacyNodes: [legacyNode(1, 'unknown_realm')],
      targetNodes: [targetNode('castle:human', 'castle')],
      characterLocations: [{
        characterId: 42,
        nodeId: 1,
        homeCastleNodeKey: 'castle:human',
      }],
      activeBattleNodes: [{
        battleId: 9,
        nodeId: 999,
        homeCastleNodeKey: 'castle:human',
      }],
    });

    assert.equal(plan.unmapped.length, 1);
    assert.deepEqual(
      plan.criticalReferences.characterLocations[0],
      {
        kind: 'character_location',
        referenceId: 42,
        legacyNodeId: 1,
        targetNodeKey: 'castle:human',
        method: 'home_castle_fallback',
        reason: 'legacy node was unmappable; explicit home-castle fallback used',
      }
    );
    assert.equal(
      plan.criticalReferences.activeBattleNodes[0].method,
      'home_castle_fallback'
    );
  });
});

describe('discovery collision merging', () => {
  it('uses travel over adjacent over initial regardless of order', () => {
    assert.equal(
      mergeDiscoveryMethods(['initial', 'travel', 'adjacent']),
      'travel'
    );
    assert.equal(mergeDiscoveryMethods(['initial', 'adjacent']), 'adjacent');

    const merged = mergeDiscoveryRecords([
      {
        user_id: 7,
        node_id: 101,
        discovery_method: 'adjacent',
        discovered_at: '2026-02-01T00:00:00Z',
      },
      {
        user_id: 7,
        node_id: 101,
        discovery_method: 'travel',
        discovered_at: '2026-03-01T00:00:00Z',
      },
      {
        user_id: 7,
        node_id: 101,
        discovery_method: 'initial',
        discovered_at: '2026-01-01T00:00:00Z',
      },
    ]);

    assert.deepEqual(merged, [{
      userId: 7,
      nodeId: 101,
      discoveryMethod: 'travel',
      discoveredAt: '2026-03-01T00:00:00Z',
      sourceRecordCount: 3,
    }]);
  });

  it('orders wall-clock collisions without DST or microsecond loss', () => {
    const dstGap = mergeDiscoveryRecords([
      {
        user_id: 7,
        node_id: 101,
        discovery_method: 'travel',
        discovered_at: '2026-03-08T03:15:00.000001',
      },
      {
        user_id: 7,
        node_id: 101,
        discovery_method: 'travel',
        discovered_at: '2026-03-08T02:45:00.999999',
      },
    ]);
    assert.equal(dstGap[0].discoveredAt, '2026-03-08T02:45:00.999999');

    const sameMillisecond = mergeDiscoveryRecords([
      {
        user_id: 7,
        node_id: 101,
        discovery_method: 'travel',
        discovered_at: '2026-03-08T01:59:59.000900',
      },
      {
        user_id: 7,
        node_id: 101,
        discovery_method: 'travel',
        discovered_at: '2026-03-08T01:59:59.000100',
      },
    ]);
    assert.equal(
      sameMillisecond[0].discoveredAt,
      '2026-03-08T01:59:59.000100'
    );
  });
});

describe('full combat clearance preservation', () => {
  const legacyNodes = [
    legacyNode(1, 'forest'),
    legacyNode(2, 'cave'),
    legacyNode(3, 'city'),
  ];
  const targetNodes = [
    targetNode('combat:forest', 'forest'),
    targetNode('combat:cave', 'cave'),
    targetNode('combat:mountain', 'mountain'),
    targetNode('city:new', 'city'),
  ];

  it('detects full legacy combat coverage', () => {
    assert.equal(hasFullCombatClearance(legacyNodes, [1, 2]), true);
    assert.equal(hasFullCombatClearance(legacyNodes, [1]), false);
  });

  it('expands full coverage to every regenerated combat node', () => {
    const expanded = expandFullCombatClearance({
      legacyNodes,
      targetNodes,
      clearedLegacyNodeIds: [1, 2],
      mappedTargetNodeKeys: ['combat:forest'],
    });

    assert.deepEqual(expanded, {
      hadFullLegacyCoverage: true,
      targetNodeKeys: [
        'combat:cave',
        'combat:forest',
        'combat:mountain',
      ],
      addedTargetNodeKeys: ['combat:cave', 'combat:mountain'],
    });
  });

  it('does not grant additional clearance for partial legacy coverage', () => {
    const expanded = expandFullCombatClearance({
      legacyNodes,
      targetNodes,
      clearedLegacyNodeIds: [1],
      mappedTargetNodeKeys: ['combat:forest'],
    });

    assert.deepEqual(expanded, {
      hadFullLegacyCoverage: false,
      targetNodeKeys: ['combat:forest'],
      addedTargetNodeKeys: [],
    });
  });
});

describe('node_progress remapping', () => {
  it('remaps the persisted expanded-node enum keys', () => {
    assert.deepEqual(
      remapNodeProgress(
        {
          fishing_spot: [11],
          merchant_caravan: [12],
        },
        new Map([
          [11, 111],
          [12, 112],
        ])
      ),
      {
        fishing_spot: [111],
        merchant_caravan: [112],
      }
    );
  });

  it('remaps known node ID arrays recursively without touching other numbers', () => {
    const original = {
      forest: [1, 2, 3],
      material_progress: { 1: 99 },
      metadata: {
        required: 2,
        nested: {
          cave: [2],
          score: 3,
        },
      },
      arbitrary_array: [1, { score: 2 }],
    };

    const remapped = remapNodeProgress(
      original,
      new Map([[1, 101], [2, 102], [3, 102]])
    );

    assert.deepEqual(remapped, {
      forest: [101, 102],
      material_progress: { 1: 99 },
      metadata: {
        required: 2,
        nested: {
          cave: [102],
          score: 3,
        },
      },
      arbitrary_array: [1, { score: 2 }],
    });
    assert.deepEqual(original.forest, [1, 2, 3]);
  });

  it('fails closed when a known node_progress ID lacks a mapping', () => {
    assert.throws(
      () => remapNodeProgress({ forest: [404] }, new Map()),
      /Missing node ID mapping for 404 at forest/
    );
  });
});
