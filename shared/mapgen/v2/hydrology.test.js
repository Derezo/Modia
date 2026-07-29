import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { deriveAttemptSeed } from './Determinism.js';
import { compileFeasibilityProfile } from './Feasibility.js';
import {
  conditionHeightWithPriorityFlood,
  generateHydrology
} from './Hydrology.js';
import { generateLandscapeFieldSet } from './LandscapeFields.js';
import { generateTerrainRegions } from './Regions.js';
import { getV2Recipe } from './RecipeRegistry.js';
import { resolveSpawnLayout } from './SpawnLayoutContract.js';

function fixture(nodeType = 'forest', width = 32, height = 24, terrainSeed = 73019) {
  const request = {
    nodeType,
    mode: 'pve',
    mapWidth: width,
    mapHeight: height,
    playerCount: 5,
    enemyCapacity: 8
  };
  const recipe = getV2Recipe(nodeType);
  const feasibility = compileFeasibilityProfile(request);
  const spawnLayout = resolveSpawnLayout(request);
  const attemptSeed = deriveAttemptSeed(terrainSeed, 2, 0);
  const fields = generateLandscapeFieldSet({
    width,
    height,
    attemptSeed,
    recipe,
    feasibility
  });
  const regions = generateTerrainRegions({
    width,
    height,
    recipe,
    fields,
    spawnLayout
  });
  return {
    width,
    height,
    attemptSeed,
    recipe,
    feasibility,
    fields,
    regions,
    spawnLayout
  };
}

function follow(flowDirection, start, limit) {
  const path = [];
  const visited = new Set();
  let current = start;
  while (current) {
    const key = `${current.x},${current.y}`;
    assert.ok(!visited.has(key), `downstream cycle at ${key}`);
    visited.add(key);
    path.push({ x: current.x, y: current.y });
    assert.ok(path.length <= limit);
    current = flowDirection[current.y][current.x];
  }
  return path;
}

function featureBoundary(mask, x, y) {
  return [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) =>
    mask[y + dy]?.[x + dx] === true
  );
}

function assertFourConnected(cells) {
  assert.ok(cells.length > 0);
  const keys = new Set(cells.map(cell => `${cell.x},${cell.y}`));
  const queue = [cells[0]];
  const visited = new Set([`${cells[0].x},${cells[0].y}`]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const next = { x: current.x + dx, y: current.y + dy };
      const key = `${next.x},${next.y}`;
      if (!keys.has(key) || visited.has(key)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  assert.equal(visited.size, keys.size, 'water body must be four-connected');
}

test('Priority-Flood conditions accidental sinks, retains named basin outlets, and is scan invariant', () => {
  const heightField = [
    [0, 0, 0, 0, 0, 0, 0],
    [0, 8, 8, 8, 8, 8, 0],
    [0, 8, 6, 6, 6, 8, 0],
    [0, 8, 6, -9, 6, 8, 0],
    [0, 8, 6, 6, 6, 8, 0],
    [0, 8, 8, 8, 8, 8, 0],
    [0, 0, 0, 0, 0, 0, 0]
  ];
  const options = {
    heightField,
    attemptSeed: deriveAttemptSeed(991, 2, 0)
  };
  const filled = conditionHeightWithPriorityFlood(options);
  const reversed = conditionHeightWithPriorityFlood({
    ...options,
    scanOrder: 'reverse'
  });
  assert.deepEqual(filled, reversed);
  assert.equal(filled.conditionedHeight[3][3], 8);
  const retained = conditionHeightWithPriorityFlood({
    ...options,
    intentionalBasinSeeds: [{ x: 3, y: 3 }]
  });
  assert.equal(retained.conditionedHeight[3][3], -9);
  assert.equal(retained.flowDirection[3][3], null);

  for (let y = 0; y < heightField.length; y++) {
    for (let x = 0; x < heightField[0].length; x++) {
      follow(filled.flowDirection, { x, y }, 49);
    }
  }
  const outletAccumulation = filled.settlementOrder
    .filter(cell => filled.flowDirection[cell.y][cell.x] === null)
    .reduce((total, cell) => total + filled.accumulation[cell.y][cell.x], 0);
  assert.equal(outletAccumulation, 49);
});

test('channel hydrology is deterministic, non-square, protected, schema-shaped, and internally coherent', () => {
  const options = fixture('bridge', 35, 23, 1551);
  const structureFootprints = [
    { footprint: [{ x: 17, y: 10 }, { x: 17, y: 11 }] }
  ];
  const requiredAnchorPairs = [{
    id: 'spawn-approach',
    from: options.spawnLayout.exits[0],
    to: options.spawnLayout.exits.at(-1)
  }];
  const rowMajor = generateHydrology({
    ...options,
    structureFootprints,
    requiredAnchorPairs
  });
  const reverse = generateHydrology({
    ...options,
    structureFootprints,
    requiredAnchorPairs,
    scanOrder: 'reverse'
  });
  assert.deepEqual(rowMajor, reverse);
  assert.ok(Object.isFrozen(rowMajor));
  assert.ok(rowMajor.waterBodies.length > 0);
  assert.ok(rowMajor.centerlines.length > 0);
  assert.equal(rowMajor.quality.valid, true);
  assert.equal(rowMajor.quality.downstreamChainsValid, true);
  assert.ok(
    rowMajor.quality.coverageTiles <= rowMajor.quality.maximumCoverageTiles
  );
  assert.ok(
    rowMajor.quality.maximumObservedChannelWidth <=
      options.feasibility.hydrology.maximumChannelWidth
  );
  assert.ok(
    rowMajor.quality.maximumAxisRun <= options.feasibility.hydrology.maximumAxisRun
  );
  assert.ok(
    rowMajor.quality.maximumWidthJump <= options.feasibility.hydrology.maximumWidthJump
  );

  const occupied = new Set();
  for (const body of rowMajor.waterBodies) {
    assert.deepEqual(Object.keys(body), [
      'id',
      'kind',
      'material',
      'bounds',
      'cells',
      'sourceCells',
      'outletCell',
      'parentRegionId'
    ]);
    assert.deepEqual(Object.keys(body.bounds), ['minX', 'minY', 'maxX', 'maxY']);
    assert.equal(body.material, 'water');
    assert.ok(body.outletCell);
    assertFourConnected(body.cells);
    for (const cell of body.cells) {
      const key = `${cell.x},${cell.y}`;
      assert.ok(!occupied.has(key), `duplicate water ownership at ${key}`);
      occupied.add(key);
      assert.equal(options.spawnLayout.coreMask[cell.y][cell.x], false);
      assert.notDeepEqual(cell, { x: 17, y: 10 });
      assert.notDeepEqual(cell, { x: 17, y: 11 });
      assert.equal(rowMajor.waterMask[cell.y][cell.x], true);
      assert.equal(rowMajor.lavaMask[cell.y][cell.x], false);
    }
  }
  for (const line of rowMajor.centerlines) {
    const traced = follow(
      rowMajor.flowDirection,
      line.sourceCell,
      options.width * options.height
    );
    assert.deepEqual(traced, line.cells);
    assert.deepEqual(traced.at(-1), line.outletCell);
    for (let index = 1; index < line.widths.length; index++) {
      assert.ok(
        Math.abs(line.widths[index] - line.widths[index - 1]) <=
          options.feasibility.hydrology.maximumWidthJump
      );
    }
  }
  for (let y = 0; y < options.height; y++) {
    for (let x = 0; x < options.width; x++) {
      assert.equal(
        rowMajor.bankMask[y][x],
        !rowMajor.featureMask[y][x] &&
          featureBoundary(rowMajor.featureMask, x, y)
      );
      if (rowMajor.wetnessMask[y][x]) {
        assert.ok(rowMajor.distanceToFeature[y][x] >= 1);
        assert.ok(
          rowMajor.distanceToFeature[y][x] <=
            options.feasibility.hydrology.wetnessRadius
        );
      }
    }
  }
  assert.ok(rowMajor.anchorPairEvidence.every(item =>
    item.landOnlyCorridor || item.crossingCandidateIds.length > 0
  ));
});

test('diagonal forest drainage stamps deterministic four-connected channel bodies', () => {
  const options = fixture('forest', 18, 18, 11);
  const first = generateHydrology(options);
  const second = generateHydrology({
    ...options,
    scanOrder: 'reverse'
  });
  assert.deepEqual(first, second);
  assert.ok(first.waterBodies.length > 0);
  assert.ok(first.centerlines.some(line =>
    line.cells.some((cell, index) => {
      const previous = line.cells[index - 1];
      return previous &&
        cell.x !== previous.x &&
        cell.y !== previous.y;
    })
  ));
  for (const body of first.waterBodies) {
    assertFourConnected(body.cells);
    assert.ok(body.cells.some(cell =>
      cell.x === body.outletCell.x && cell.y === body.outletCell.y
    ));
    for (const cell of body.cells) {
      assert.equal(options.spawnLayout.coreMask[cell.y][cell.x], false);
    }
  }
  assert.ok(
    first.quality.coverageTiles <= first.quality.maximumCoverageTiles
  );
});

test('separate channel outlets never publish overlapping water ownership', () => {
  let observedMultipleOutlets = false;
  for (const [nodeType, terrainSeed] of [
    ['forest', 49],
    ['bridge', 25],
    ['forest', 9]
  ]) {
    const options = fixture(nodeType, 18, 18, terrainSeed);
    const result = generateHydrology(options);
    assert.ok(result.waterBodies.length > 0);
    observedMultipleOutlets ||= result.waterBodies.length > 1;
    const occupied = new Set();
    for (const body of result.waterBodies) {
      assertFourConnected(body.cells);
      for (const cell of body.cells) {
        const key = `${cell.x},${cell.y}`;
        assert.ok(!occupied.has(key), `duplicate water ownership at ${key}`);
        occupied.add(key);
      }
    }
    assert.equal(occupied.size, result.quality.coverageTiles);
  }
  assert.equal(observedMultipleOutlets, true);
});

test('retained basin records are explicit and have no declared downstream outlet', () => {
  for (const nodeType of ['cave', 'swamp']) {
    const options = fixture(nodeType, 29, 21, 5011);
    const result = generateHydrology(options);
    assert.ok(result.intentionalBasins.length > 0);
    assert.equal(result.centerlines.length, 0);
    assert.ok(result.waterBodies.length > 0);
    for (const basin of result.waterBodies) {
      assertFourConnected(basin.cells);
      assert.equal(basin.outletCell, null);
      assert.equal(basin.material, 'water');
      assert.ok(basin.sourceCells.length === 1);
      assert.ok(
        result.intentionalBasins.some(record => record.id === basin.id)
      );
    }
    assert.equal(result.quality.downstreamChainsValid, true);
    assert.equal(result.quality.withinCoverageBudget, true);
  }
});

test('standard swamp corpus retains visibly wet basins within its coverage budget', () => {
  for (const terrainSeed of [0, 997]) {
    const options = fixture('swamp', 32, 32, terrainSeed);
    const first = generateHydrology(options);
    const second = generateHydrology(options);
    const formerChannelArea =
      options.feasibility.hydrology.maximumChannelWidth ** 2 +
      options.feasibility.hydrology.maximumChannelWidth;

    assert.deepEqual(first, second, `swamp seed ${terrainSeed} determinism`);
    assert.ok(
      first.quality.coverageTiles >= 25,
      `swamp seed ${terrainSeed} retained only ${first.quality.coverageTiles} wet tiles`
    );
    assert.ok(
      first.waterBodies.some(body => body.cells.length > formerChannelArea),
      `swamp seed ${terrainSeed} remained capped by channel width`
    );
    assert.ok(
      first.quality.coverageTiles <= first.quality.maximumCoverageTiles
    );
    assert.equal(first.quality.withinCoverageBudget, true);
  }
});

test('overlapping retained basins publish only their seed-connected component', () => {
  for (const nodeType of ['cave', 'swamp']) {
    const options = fixture(nodeType, 41, 26, 43);
    const result = generateHydrology(options);
    const occupied = new Set();
    assert.ok(result.waterBodies.length > 0);
    for (const body of result.waterBodies) {
      assertFourConnected(body.cells);
      const cellKeys = new Set(body.cells.map(cell => `${cell.x},${cell.y}`));
      for (const source of body.sourceCells) {
        assert.ok(cellKeys.has(`${source.x},${source.y}`));
      }
      for (const key of cellKeys) {
        assert.ok(!occupied.has(key), `duplicate basin ownership at ${key}`);
        occupied.add(key);
      }
    }
    assert.equal(occupied.size, result.quality.coverageTiles);
  }
});

test('lava uses distinct masks and connection semantics without inheriting water identity', () => {
  const options = fixture('volcano', 37, 25, 8119);
  const result = generateHydrology(options);
  assert.ok(result.centerlines.length > 0);
  assert.ok(result.waterBodies.every(body =>
    body.kind === 'lava' && body.material === 'lava'
  ));
  for (const body of result.waterBodies) assertFourConnected(body.cells);
  assert.ok(result.featureMask.flat().some(Boolean));
  assert.deepEqual(result.lavaMask, result.featureMask);
  assert.ok(result.waterMask.flat().every(value => value === false));
  assert.ok(result.crossingCandidates.every(candidate =>
    candidate.kind === 'lava-connection' && candidate.requiresConnection === true
  ));
  assert.equal(result.quality.downstreamChainsValid, true);
});

test('disabled compact hydrology publishes stable empty masks and verifies land evidence', () => {
  const options = fixture('forest', 13, 13, 404);
  const result = generateHydrology({
    ...options,
    requiredAnchorPairs: [{
      id: 'compact-spawns',
      from: options.spawnLayout.exits[0],
      to: options.spawnLayout.exits.at(-1)
    }]
  });
  assert.equal(result.enabled, false);
  assert.deepEqual(result.waterBodies, []);
  assert.ok(result.featureMask.flat().every(value => value === false));
  assert.equal(result.anchorPairEvidence[0].landOnlyCorridor, true);
  assert.equal(result.quality.valid, true);
});

test('hydrology properties hold across seeds, dimensions, and directed materials', () => {
  const cases = [
    ['forest', 27, 19, 1],
    ['mountain', 38, 17, 2],
    ['bridge', 24, 31, 3],
    ['volcano', 41, 26, 4],
    ['swamp', 33, 22, 5]
  ];
  for (const [nodeType, width, height, seed] of cases) {
    const options = fixture(nodeType, width, height, seed);
    const result = generateHydrology(options);
    const unique = new Set();
    for (const body of result.waterBodies) {
      assertFourConnected(body.cells);
      for (const cell of body.cells) {
        assert.ok(cell.x >= 0 && cell.x < width);
        assert.ok(cell.y >= 0 && cell.y < height);
        assert.equal(options.spawnLayout.coreMask[cell.y][cell.x], false);
        const key = `${cell.x},${cell.y}`;
        assert.ok(!unique.has(key));
        unique.add(key);
      }
    }
    assert.equal(unique.size, result.quality.coverageTiles);
    assert.equal(result.quality.valid, true);
  }
});

test('hydrology implementation has no ambient randomness or fallback dispatch', () => {
  const source = readFileSync(new URL('./Hydrology.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /\|\|\s*['"`](water|stream|none)/);
});
