import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertBattleMapV2Final
} from '../../battleMap/schema.js';
import { verifyBattleMapV2Final } from '../../battleMap/hashes.js';
import { dispatchBattleMapGeneration } from '../../mapGeneration.js';
import { discretizeElevation } from '../../terrain.js';
import {
  V2_PRODUCTION_NODE_TYPES
} from './RecipeRegistry.js';
import {
  generateBattleMapV2,
  normalizeBattleMapV2Request
} from './BattleMapGenerator.js';

const FOREST_REQUEST = Object.freeze({
  terrainSeed: 11,
  nodeType: 'forest',
  mapWidth: 18,
  mapHeight: 18,
  maxAttempts: 1
});

function macroTemplateProjection(map, samples = 8) {
  const routeCells = new Set(map.features.routes
    .flatMap(route => route.centerline)
    .map(point => `${point.x},${point.y}`));
  const waterCells = new Set(map.features.waterBodies
    .flatMap(water => water.cells)
    .map(point => `${point.x},${point.y}`));
  const protectedCells = new Set();
  for (const zone of map.spawnLayout.protectedZones) {
    for (let y = zone.bounds.minY; y <= zone.bounds.maxY; y++) {
      for (let x = zone.bounds.minX; x <= zone.bounds.maxX; x++) {
        protectedCells.add(`${x},${y}`);
      }
    }
  }
  const tokens = [];
  for (let sampleY = 0; sampleY < samples; sampleY++) {
    for (let sampleX = 0; sampleX < samples; sampleX++) {
      const minX = Math.floor(sampleX * map.mapWidth / samples);
      const maxX = Math.max(minX + 1, Math.floor((sampleX + 1) * map.mapWidth / samples));
      const minY = Math.floor(sampleY * map.mapHeight / samples);
      const maxY = Math.max(minY + 1, Math.floor((sampleY + 1) * map.mapHeight / samples));
      const materials = {};
      let elevation = 0;
      let route = 0;
      let water = 0;
      let protectedZone = 0;
      let count = 0;
      for (let y = minY; y < maxY; y++) {
        for (let x = minX; x < maxX; x++) {
          const material = map.terrain[y][x].material;
          materials[material] = (materials[material] ?? 0) + 1;
          elevation += discretizeElevation(map.elevation[y][x]);
          route += Number(routeCells.has(`${x},${y}`));
          water += Number(waterCells.has(`${x},${y}`));
          protectedZone += Number(protectedCells.has(`${x},${y}`));
          count++;
        }
      }
      const dominantMaterial = Object.entries(materials)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0][0];
      tokens.push([
        dominantMaterial,
        Math.round(elevation / count),
        Math.round(route * 4 / count),
        Math.round(water * 4 / count),
        Math.round(protectedZone * 4 / count)
      ]);
    }
  }
  return JSON.stringify({
    tokens,
    regionDegrees: map.features.regions
      .map(region => region.adjacentRegionIds.length).sort((a, b) => a - b),
    routeLengths: map.features.routes
      .map(route => route.centerline.length).sort((a, b) => a - b),
    connectionKinds: Object.entries(map.elevationConnections.reduce((counts, connection) => {
      counts[connection.kind] = (counts[connection.kind] ?? 0) + 1;
      return counts;
    }, {})).sort(([left], [right]) => left.localeCompare(right))
  });
}

async function dispatchV2(nodeType, terrainSeed, mapWidth, mapHeight) {
  return dispatchBattleMapGeneration({
    terrainGenerationVersion: 2,
    terrainSeed,
    nodeType,
    mapWidth,
    mapHeight,
    options: { mode: 'pve' }
  });
}

test('normalizes a closed request and rejects ambiguous inputs', () => {
  const request = normalizeBattleMapV2Request({
    terrainSeed: 7,
    nodeType: 'forest'
  });
  assert.equal(request.mapWidth, 32);
  assert.equal(request.mapHeight, 32);
  assert.equal(request.mode, 'pve');
  assert.equal(request.playerCount, 5);
  assert.equal(request.enemyCapacity, 6);
  assert.equal(request.enemyCount, 6);
  assert.ok(Object.isFrozen(request));
  assert.throws(
    () => normalizeBattleMapV2Request({
      terrainSeed: 7,
      nodeType: 'forest',
      width: 20
    }),
    /Unknown BattleMapV2 generation request field: width/
  );
  assert.throws(
    () => normalizeBattleMapV2Request({
      terrainSeed: '7',
      nodeType: 'forest'
    }),
    /terrainSeed must be a safe integer/
  );
});

test('generation is deterministic, closed-schema, validated, and hash verified', async () => {
  const first = await generateBattleMapV2(FOREST_REQUEST);
  const second = await generateBattleMapV2(FOREST_REQUEST);

  assert.deepEqual(first, second);
  assertBattleMapV2Final(first);
  assert.equal(await verifyBattleMapV2Final(first), true);
  assert.equal(first.diagnostics.hardValidation.valid, true);
  assert.equal(first.diagnostics.tacticalValidation.passed, true);
  assert.ok(first.diagnostics.qualityMetrics.metrics.every(metric => metric.passed));
  assert.ok(first.diagnostics.qualityMetrics.metrics.some(
    metric => metric.id === 'organic.hydrology-integrity'
  ));
  assert.match(first.diagnostics.hashes.authoritativeHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.diagnostics.hashes.visualHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.diagnostics.hashes.fullHash, /^sha256:[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(first));
});

test('forest output contains connected organic semantic and correlated visual layers', async () => {
  const map = await generateBattleMapV2(FOREST_REQUEST);
  const irregularRegions = map.features.regions.filter(region => {
    const boundsArea =
      (region.bounds.maxX - region.bounds.minX + 1) *
      (region.bounds.maxY - region.bounds.minY + 1);
    return region.area < boundsArea;
  });

  assert.ok(map.features.regions.length >= 3);
  assert.ok(irregularRegions.length >= 1);
  assert.ok(map.features.waterBodies.length >= 1);
  assert.ok(map.features.routes.length >= 2);
  assert.ok(map.features.clearings.length >= 1);
  assert.ok(map.elevationConnections.length >= 1);
  assert.equal(map.variants.length, map.mapWidth * map.mapHeight);
  assert.ok(map.transitions.length >= 1);
  assert.ok(map.decorations.length >= 1);

  const globalFeatureIds = [
    ...map.features.regions,
    ...map.features.waterBodies,
    ...map.features.routes,
    ...map.features.clearings,
    ...map.features.structures
  ].map(feature => feature.id);
  assert.equal(new Set(globalFeatureIds).size, globalFeatureIds.length);
});

test('all production recipes generate operational maps', async () => {
  assert.equal(V2_PRODUCTION_NODE_TYPES.length, 16);
  for (const [index, nodeType] of V2_PRODUCTION_NODE_TYPES.entries()) {
    const arena = nodeType === 'arena' || nodeType === 'guild';
    const map = await generateBattleMapV2({
      terrainSeed: 100 + index,
      nodeType,
      mapWidth: 20,
      mapHeight: 20,
      mode: arena ? 'pvp_coliseum' : 'pve'
    });
    assertBattleMapV2Final(map);
    assert.equal(await verifyBattleMapV2Final(map), true, nodeType);
    assert.equal(map.diagnostics.hardValidation.valid, true, nodeType);
    assert.equal(map.diagnostics.tacticalValidation.passed, true, nodeType);
    assert.ok(map.features.routes.length >= 2, nodeType);
    assert.ok(map.features.regions.length >= 1, nodeType);
  }
});

test('public dispatch accepts compact required hydrology and narrow production recipes', async () => {
  const cases = [
    ['bridge', 10, 10],
    ['volcano', 10, 10],
    ...[
      'forest',
      'cave',
      'mountain',
      'castle',
      'dungeon',
      'swamp',
      'plains',
      'elven_grove',
      'dwarven_mine',
      'vampiric_crypt',
      'orcish_warcamp',
      'human_ruins'
    ].map(nodeType => [nodeType, 11, 16])
  ];
  for (const [nodeType, mapWidth, mapHeight] of cases) {
    const map = await dispatchV2(nodeType, 0, mapWidth, mapHeight);
    assertBattleMapV2Final(map);
    assert.equal(map.diagnostics.hardValidation.valid, true, nodeType);
    assert.equal(map.diagnostics.tacticalValidation.passed, true, nodeType);
  }
});

test('public dispatch preserves cave floor area and mountain route clearance at scale', async () => {
  for (const [mapWidth, mapHeight] of [[24, 32], [32, 32], [48, 40]]) {
    for (const nodeType of ['cave', 'mountain']) {
      const map = await dispatchV2(nodeType, 0, mapWidth, mapHeight);
      assert.equal(map.diagnostics.hardValidation.valid, true, `${nodeType} ${mapWidth}x${mapHeight}`);
      assert.equal(
        map.diagnostics.tacticalValidation.passed,
        true,
        `${nodeType} ${mapWidth}x${mapHeight}`
      );
    }
  }
});

test('mountain ridge hysteresis preserves usable passes without erasing blocking relief', async () => {
  const map = await dispatchV2('mountain', 2, 32, 32);
  const usableArea = map.diagnostics.qualityMetrics.metrics
    .find(metric => metric.id === 'usable-area-ratio');
  const materials = new Set(map.terrain.flat().map(cell => cell.material));

  assert.equal(map.diagnostics.hardValidation.valid, true);
  assert.equal(map.diagnostics.tacticalValidation.passed, true);
  assert.ok(usableArea, 'mountain map omitted usable-area diagnostics');
  assert.ok(usableArea.value >= usableArea.target);
  assert.ok(materials.has('rock'), 'mountain map lost its blocking ridge relief');
  assert.ok(
    [...materials].some(material => material !== 'rock'),
    'mountain ridge consumed the entire navigable floor'
  );
});

test('public dispatch preserves navigable excavated mine area across the bounded corpus', async () => {
  const cases = [
    [997, 32, 32],
    [997, 24, 32],
    [997, 48, 40],
    [0, 32, 32],
    [42, 32, 32],
    [119676, 32, 32]
  ];
  for (const [terrainSeed, mapWidth, mapHeight] of cases) {
    const label = `dwarven_mine seed ${terrainSeed} ${mapWidth}x${mapHeight}`;
    const map = await dispatchV2('dwarven_mine', terrainSeed, mapWidth, mapHeight);
    const usableArea = map.diagnostics.qualityMetrics.metrics
      .find(metric => metric.id === 'usable-area-ratio');
    const materials = new Set(map.terrain.flat().map(cell => cell.material));
    assert.equal(map.diagnostics.hardValidation.valid, true, label);
    assert.equal(map.diagnostics.tacticalValidation.passed, true, label);
    assert.ok(usableArea, `${label} omitted usable-area diagnostics`);
    assert.ok(usableArea.value >= usableArea.target, label);
    assert.ok(materials.has('rock'), `${label} lost its cellular mine walls`);
    assert.ok(
      [...materials].some(material => material !== 'rock'),
      `${label} lost its excavated floor`
    );
  }
});

test('compact constructed recipes retain seed and recipe-scale macro variation', async () => {
  const maps = new Map();
  for (const nodeType of ['arena', 'dungeon', 'vampiric_crypt']) {
    for (const terrainSeed of [0, 997]) {
      const map = await dispatchV2(nodeType, terrainSeed, 10, 10);
      maps.set(`${nodeType}:${terrainSeed}`, map);
      assert.ok(
        new Set(map.terrain.flat().map(cell => cell.material)).size > 1,
        `${nodeType}:${terrainSeed} collapsed to one material`
      );
    }
    assert.notEqual(
      macroTemplateProjection(maps.get(`${nodeType}:0`)),
      macroTemplateProjection(maps.get(`${nodeType}:997`)),
      `${nodeType} compact seeds reused one macro template`
    );
  }
  assert.notEqual(
    macroTemplateProjection(maps.get('dungeon:0')),
    macroTemplateProjection(maps.get('vampiric_crypt:0')),
    'dungeon and vampiric crypt reused one compact macro template'
  );

  for (const terrainSeed of [0, 997]) {
    const [forest, plains] = await Promise.all([
      dispatchV2('forest', terrainSeed, 10, 10),
      dispatchV2('plains', terrainSeed, 10, 10)
    ]);
    assert.notEqual(
      macroTemplateProjection(forest),
      macroTemplateProjection(plains),
      `forest and plains reused one compact macro template for seed ${terrainSeed}`
    );
  }
});
