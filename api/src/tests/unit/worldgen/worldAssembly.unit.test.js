import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assembleWorld,
  calculateWorldOutputHash,
  canonicalizeEdges,
  ensureCastleOpenings
} from '../../../db/worldgen/worldAssembly.js';
import { canonicalStringify } from '../../../db/worldgen/randomStreams.js';
import {
  validateAndCleanup,
  validateFinalizedWorld,
  validatePhase6
} from '../../../db/worldgen/validation.js';

function withoutGeneratorLogs(callback) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return callback();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

async function withoutGeneratorLogsAsync(callback) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return await callback();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

describe('assembleWorld', () => {
  it('is deterministic and emits a canonical stable-key graph', () => {
    const first = withoutGeneratorLogs(() => assembleWorld({ seed: 12345 }));
    const second = withoutGeneratorLogs(() => assembleWorld({ seed: 12345 }));

    assert.equal(canonicalStringify(first), canonicalStringify(second));
    assert.equal(first.validation.valid, true);
    assert.equal(
      calculateWorldOutputHash(first),
      first.metadata.outputHash
    );
    assert.equal(new Set(first.nodes.map((node) => node.nodeKey)).size, first.nodes.length);
    assert.equal(
      new Set(first.nodes.map((node) => `${node.x},${node.y}`)).size,
      first.nodes.length
    );
    for (const edge of first.connections) {
      assert.equal(first.nodes[edge.from].nodeKey, edge.fromNodeKey);
      assert.equal(first.nodes[edge.to].nodeKey, edge.toNodeKey);
    }
  });

  it('passes the castle, Phase-4 infill, and shuffled-region regression seeds', () => {
    for (const seed of [
      18, 22, 79, 86, 111, 115, 118, 164, 212, 247, 300, 320, 365, 445, 468,
      2421, 2854, 3262, 3918, 12345
    ]) {
      const world = withoutGeneratorLogs(() => assembleWorld({ seed }));
      assert.equal(world.validation.valid, true, `seed ${seed}`);
      assert.equal(world.castles.length, 5, `seed ${seed}`);
      assert.equal(world.regions.length, 5, `seed ${seed}`);
      for (const region of world.regions) {
        const guilds = world.nodes.filter((node) =>
          node.regionId === region.id && node.nodeType === 'guild'
        );
        assert.equal(guilds.length, 3, `seed ${seed}, region ${region.id}`);
        assert.equal(
          new Set(guilds.map((guild) => guild.guildClass)).size,
          3,
          `seed ${seed}, region ${region.id}`
        );
      }
    }
  });

  it('can be validated repeatedly without modifying the finalized model', () => {
    const world = withoutGeneratorLogs(() => assembleWorld({ seed: 86 }));
    const fingerprint = canonicalStringify(world);

    const first = withoutGeneratorLogs(() => validateFinalizedWorld(world));
    const second = withoutGeneratorLogs(() => validateFinalizedWorld(world));

    assert.deepEqual(first, second);
    assert.equal(first.valid, true);
    assert.equal(canonicalStringify(world), fingerprint);
  });

  it('hard-fails finalized ring, route-tier, and guild domains', () => {
    const source = withoutGeneratorLogs(() => assembleWorld({ seed: 86 }));
    const cases = [
      {
        code: 'CASTLE_RING_DISTANCE_INVALID',
        mutate(world) {
          world.nodes.find((node) => node.nodeType === 'castle').ringDistance = 1;
        }
      },
      {
        code: 'RING_DISTANCE_INVALID',
        mutate(world) {
          world.nodes.find((node) =>
            node.regionId == null && node.nodeType !== 'palace'
          ).ringDistance = 3;
        }
      },
      {
        code: 'ROUTE_DIFFICULTY_PRECEDENCE_INVALID',
        mutate(world) {
          const node = world.nodes.find((candidate) =>
            candidate.routeDifficultyTier != null
          );
          node.difficultyTier = node.routeDifficultyTier === 5
            ? 4
            : node.routeDifficultyTier + 1;
        }
      },
      {
        code: 'GUILD_DISTRIBUTION_INVALID',
        mutate(world) {
          const guild = world.nodes.find((node) => node.nodeType === 'guild');
          guild.guildType = 'bard';
          guild.guildClass = 'bard';
        }
      },
      {
        code: 'GUILD_DISTRIBUTION_INVALID',
        mutate(world) {
          world.nodes.find((node) => node.nodeType === 'guild').nodeType = 'village';
        }
      }
    ];

    for (const fixture of cases) {
      const world = structuredClone(source);
      fixture.mutate(world);
      const result = withoutGeneratorLogs(() => validateFinalizedWorld(world));
      assert.equal(result.valid, false, fixture.code);
      assert.ok(result.errors.some((error) => error.code === fixture.code));
    }
  });

  it('keeps the complete route envelope null on ordinary nodes and edges', () => {
    const source = withoutGeneratorLogs(() => assembleWorld({ seed: 123456 }));
    const routeFields = [
      'routePairKey',
      'routeKind',
      'routeOrder',
      'segmentIndex',
      'segmentKind',
      'difficultyPolicy',
      'routeDifficultyTier'
    ];
    for (const candidate of [
      ...source.nodes.filter((node) => !node.routeId),
      ...source.connections.filter((edge) => !edge.routeId)
    ]) {
      for (const field of routeFields) {
        assert.equal(candidate[field] ?? null, null, `${candidate.nodeKey ?? candidate.edgeKey}.${field}`);
      }
      assert.deepEqual(candidate.regionPair ?? [], []);
    }

    const nodeWorld = structuredClone(source);
    nodeWorld.nodes.find((node) => !node.routeId).segmentKind = 'regional';
    const nodeValidation = withoutGeneratorLogs(() =>
      validateFinalizedWorld(nodeWorld)
    );
    assert.ok(nodeValidation.errors.some((error) =>
      error.code === 'ORDINARY_NODE_ROUTE_METADATA_INVALID'
    ));

    const edgeWorld = structuredClone(source);
    edgeWorld.connections.find((edge) => !edge.routeId).segmentOrder = 0;
    const edgeValidation = withoutGeneratorLogs(() =>
      validateFinalizedWorld(edgeWorld)
    );
    assert.ok(edgeValidation.errors.some((error) =>
      error.code === 'ORDINARY_EDGE_ROUTE_METADATA_INVALID'
    ));
  });

  it('rejects duplicate undirected edges during canonicalization', () => {
    const nodeIndexByKey = new Map([
      ['node:a', 0],
      ['node:b', 1]
    ]);
    assert.throws(
      () => canonicalizeEdges([
        { fromNodeKey: 'node:a', toNodeKey: 'node:b' },
        { fromNodeKey: 'node:b', toNodeKey: 'node:a' }
      ], nodeIndexByKey),
      /Duplicate undirected edge/
    );
  });

  it('rejects self-consistent fabricated route-pair metadata', () => {
    const world = structuredClone(
      withoutGeneratorLogs(() => assembleWorld({ seed: 12345 }))
    );
    const connection = world.connections.find((edge) =>
      edge.routeId && edge.routeKind !== 'palace'
    );
    const manifestEntry = world.routeManifest.find((entry) =>
      entry.routeId === connection.routeId
    );
    for (const routeConnection of world.connections.filter((edge) =>
      edge.routeId === connection.routeId
    )) {
      routeConnection.regionPair = [98, 99];
      routeConnection.routePairKey = 'route-pair:98-99';
    }
    manifestEntry.regionPair = [98, 99];
    manifestEntry.routePairKey = 'route-pair:98-99';

    const validation = withoutGeneratorLogs(() => validateFinalizedWorld(world));
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((error) =>
      error.code === 'ROUTE_ENDPOINT_IDENTITY_MISMATCH'
    ));
  });

  it('requires each competing route variant to attach to both regions', () => {
    const world = structuredClone(
      withoutGeneratorLogs(() => assembleWorld({ seed: 12345 }))
    );
    const routeId = 'trade:1-2';
    const regionalEndpoints = world.connections
      .filter((edge) => edge.routeId === routeId)
      .flatMap((edge) => [world.nodes[edge.from], world.nodes[edge.to]])
      .filter((node) => Number.isInteger(node.regionId));
    const regionTwoTerminal = regionalEndpoints.find((node) => node.regionId === 2);
    assert.ok(regionTwoTerminal);
    regionTwoTerminal.regionId = null;

    const validation = withoutGeneratorLogs(() => validateFinalizedWorld(world));
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some((error) =>
      error.code === 'ROUTE_ENDPOINT_REGIONS_INVALID'
      && error.routeId === routeId
    ));
  });

  it('preserves and deterministically rewires an invalid castle neighbor', () => {
    const createFixture = () => ({
      nodes: [
        { nodeKey: 'castle', nodeType: 'castle', regionId: 1, x: 0, y: 0 },
        { nodeKey: 'ruins', nodeType: 'ruins', regionId: 1, x: 5, y: 0 },
        { nodeKey: 'forest', nodeType: 'forest', regionId: 1, x: 5, y: 1 },
        { nodeKey: 'village', nodeType: 'village', regionId: 1, x: 2, y: 0 }
      ],
      edges: [
        { fromNodeKey: 'castle', toNodeKey: 'ruins' },
        { fromNodeKey: 'castle', toNodeKey: 'forest' }
      ]
    });
    const first = createFixture();
    const second = createFixture();

    ensureCastleOpenings(first.nodes, first.edges);
    ensureCastleOpenings(second.nodes, second.edges);

    assert.deepEqual(first, second);
    assert.equal(first.nodes.find((node) => node.nodeKey === 'ruins').nodeType, 'ruins');
    assert.ok(first.edges.some((edge) =>
      [edge.fromNodeKey, edge.toNodeKey].includes('ruins')
      && [edge.fromNodeKey, edge.toNodeKey].includes('forest')
    ));
    assert.ok(!first.edges.some((edge) =>
      [edge.fromNodeKey, edge.toNodeKey].includes('ruins')
      && [edge.fromNodeKey, edge.toNodeKey].includes('castle')
    ));
  });

  it('fails instead of fabricating a fallback opening destination', () => {
    const nodes = [
      { nodeKey: 'castle', nodeType: 'castle', regionId: 1, x: 0, y: 0 },
      { nodeKey: 'forest', nodeType: 'forest', regionId: 1, x: 8, y: 0 }
    ];
    const edges = [{ fromNodeKey: 'castle', toNodeKey: 'forest' }];

    assert.throws(
      () => ensureCastleOpenings(nodes, edges),
      /no valid existing settlement or guild/
    );
    assert.equal(nodes.some((node) =>
      node.nodeKey === 'region:1:opening-destination'
    ), false);
  });

  it('keeps legacy Phase-6 entrypoints on the canonical read-only pipeline', async () => {
    const world = withoutGeneratorLogs(() => assembleWorld({ seed: 22 }));
    const fingerprint = canonicalStringify(world);
    const compatibility = validateAndCleanup(world);

    assert.equal(compatibility.validation.valid, true);
    assert.equal(canonicalStringify(world), fingerprint);
    assert.throws(
      () => validateAndCleanup(world.nodes, world.connections),
      /finalized canonical world/
    );

    const phase6 = await withoutGeneratorLogsAsync(() => validatePhase6(22));
    assert.equal(phase6.passed, true);
    assert.equal(phase6.world.metadata.structuralHash, world.metadata.structuralHash);
  });

  it('derives integer local seeds from stable node identity', () => {
    const world = withoutGeneratorLogs(() => assembleWorld({ seed: 445 }));
    const second = withoutGeneratorLogs(() => assembleWorld({ seed: 445 }));

    assert.deepEqual(
      world.nodes.map(({ nodeKey, localSeed }) => [nodeKey, localSeed]),
      second.nodes.map(({ nodeKey, localSeed }) => [nodeKey, localSeed])
    );
    assert.ok(world.nodes.every((node) =>
      Number.isInteger(node.localSeed)
      && node.localSeed >= -2147483648
      && node.localSeed <= 2147483647
    ));
    assert.equal(new Set(world.nodes.map((node) => node.localSeed)).size, world.nodes.length);
  });

  it('finalizes designated castle openings and Tier-1 blocked boundaries', () => {
    const world = withoutGeneratorLogs(() => assembleWorld({ seed: 123456 }));
    assert.equal(world.validation.metrics.openingComponents.length, 5);
    for (const opening of world.validation.metrics.openingComponents) {
      assert.ok(opening.safeComponentSize >= 2);
      assert.ok(opening.safeComponentSize <= 8);
      assert.ok(opening.boundarySize >= 1);
    }
    assert.equal(
      world.connections.filter((edge) =>
        edge.openingRole === 'designated_safe_edge'
      ).length,
      5
    );
    for (const castle of world.nodes.filter((node) => node.nodeType === 'castle')) {
      const destination = world.nodes.find((node) =>
        node.nodeKey === castle.openingDestinationNodeKey
      );
      assert.ok(destination);
      assert.equal(destination.regionId, castle.regionId);
      assert.ok(['city', 'village', 'guild', 'keep'].includes(destination.nodeType));
      assert.ok(world.connections.some((edge) =>
        edge.openingRole === 'designated_safe_edge'
        && [edge.fromNodeKey, edge.toNodeKey].includes(castle.nodeKey)
        && [edge.fromNodeKey, edge.toNodeKey].includes(destination.nodeKey)
      ));
    }
  });

  it('keeps every blocking trade segment below its wilderness pair', () => {
    const world = withoutGeneratorLogs(() => assembleWorld({ seed: 123456 }));
    const pairs = new Map();
    for (const node of world.nodes) {
      if (!node.routePairKey || !['trade', 'wilderness'].includes(node.routeKind)
          || !node.blockedByDefault) continue;
      const pair = pairs.get(node.routePairKey) ?? { trade: [], wilderness: [] };
      pair[node.routeKind].push(node.difficultyTier);
      pairs.set(node.routePairKey, pair);
    }
    for (const pair of pairs.values()) {
      if (!pair.trade.length || !pair.wilderness.length) continue;
      const wildernessFloor = Math.min(...pair.wilderness);
      assert.ok(wildernessFloor >= 2);
      assert.ok(pair.trade.every((tier) => tier <= wildernessFloor - 1));
    }
    assert.ok(world.nodes
      .filter((node) => node.routeKind && node.isIntermediateNode)
      .every((node) =>
        Number.isInteger(node.segmentIndex)
        && typeof node.segmentKind === 'string'
        && typeof node.difficultyPolicy === 'string'
      ));
  });

  it('assigns a stable, contiguous segment order to every persisted route', () => {
    const world = withoutGeneratorLogs(() => assembleWorld({ seed: 123456 }));
    const routes = Map.groupBy(
      world.connections.filter((edge) => edge.routeId),
      (edge) => edge.routeId
    );
    assert.equal(world.routeManifest.length, routes.size);
    for (const [routeId, routeEdges] of routes) {
      const orders = routeEdges.map((edge) => edge.segmentOrder).sort((a, b) => a - b);
      assert.deepEqual(orders, Array.from({ length: routeEdges.length }, (_, index) => index));
      assert.ok(routeEdges.every((edge) => edge.segmentIndex === edge.segmentOrder));
      const manifestEntry = world.routeManifest.find((entry) => entry.routeId === routeId);
      assert.ok(manifestEntry);
      assert.deepEqual(
        manifestEntry.segments.map((segment) => segment.segmentIndex),
        Array.from({ length: routeEdges.length }, (_, index) => index)
      );
    }
  });

  it('assigns mostly degree-2 reward sites without reducing its target', () => {
    const world = withoutGeneratorLogs(() => assembleWorld({ seed: 123456 }));
    assert.equal(world.rewardSiteStats.assigned, world.rewardSiteStats.target);
    const degreeByNodeKey = new Map(world.nodes.map((node) => [node.nodeKey, 0]));
    for (const edge of world.connections) {
      degreeByNodeKey.set(
        edge.fromNodeKey,
        degreeByNodeKey.get(edge.fromNodeKey) + 1
      );
      degreeByNodeKey.set(
        edge.toNodeKey,
        degreeByNodeKey.get(edge.toNodeKey) + 1
      );
    }
    const actualDeadEnds = world.nodes.filter((node) =>
      node.isTerminator && degreeByNodeKey.get(node.nodeKey) === 1
    ).length;
    assert.equal(world.rewardSiteStats.deadEndsAssigned, actualDeadEnds);
    const ratio = actualDeadEnds / world.rewardSiteStats.assigned;
    assert.ok(ratio >= 0.10 && ratio <= 0.20);
    assert.ok(world.rewardSiteStats.gateDeltas.every(({ minimumDelta, gateVector }) =>
      minimumDelta >= 0
      && gateVector.length > 0
      && gateVector.every(({ before, after, delta, sourceComponentNodeKeys }) =>
        Number.isFinite(before)
        && Number.isFinite(after)
        && delta >= 0
        && sourceComponentNodeKeys.length >= 2
      )
    ));
    assert.ok(world.validation.metrics.graphQuality.graphStretch.length > 0);
    assert.ok(world.validation.metrics.graphQuality.graphStretch.every((entry) =>
      Number.isFinite(entry.hopStretch)
      && Number.isFinite(entry.euclideanStretch)
      && entry.hopStretch >= 1
      && entry.euclideanStretch >= 1
    ));
  });
});
