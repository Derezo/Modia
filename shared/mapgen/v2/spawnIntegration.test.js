import test from 'node:test';
import assert from 'node:assert/strict';

import { MINIMAL_BATTLE_MAP_V2_CANDIDATE } from '../../battleMap/fixtures.js';
import { validateBattleMapV2Candidate } from '../../battleMap/schema.js';
import { resolveSpawnLayout } from './SpawnLayoutContract.js';
import {
  applySpawnFeatherEdits,
  integrateActualSpawns,
  SpawnIntegrationError,
  V2_ENEMY_SPAWN_STRATEGIES
} from './SpawnIntegration.js';

function grid(width, height, create) {
  return Array.from(
    { length: height },
    (_, y) => Array.from({ length: width }, (_, x) => create(x, y))
  );
}

function layers(width, height) {
  return {
    terrain: grid(width, height, () => ({
      material: 'grass',
      movementCost: 1,
      passable: true,
      regionId: null
    })),
    elevation: grid(width, height, () => 0.33),
    elevationConnections: [],
    obstacles: []
  };
}

function integrate(request, overrides = {}) {
  const spawnLayout = resolveSpawnLayout(request);
  return integrateActualSpawns({
    spawnLayout,
    ...layers(request.mapWidth, request.mapHeight),
    enemyCount: request.enemyCount ?? request.enemyCapacity,
    enemyStrategy: 'formation',
    ...overrides
  });
}

function assertExactRecordKeys(record, keys) {
  assert.deepEqual(Object.keys(record).sort(), [...keys].sort());
}

test('actual spawn integration supports every declared mode and capacity count', () => {
  for (const mode of ['pve', 'guild', 'pvp', 'pvp_coliseum', 'pve_coop']) {
    const arena = mode === 'pvp' || mode === 'pvp_coliseum';
    const mapWidth = arena ? 11 : 23;
    const mapHeight = arena ? 16 : 17;
    const maximumEnemyCount = arena ? 5 : 24;
    for (let playerCount = 1; playerCount <= 5; playerCount++) {
      for (let enemyCount = 1; enemyCount <= maximumEnemyCount; enemyCount++) {
        const result = integrate({
          mode,
          mapWidth,
          mapHeight,
          playerCount,
          enemyCapacity: maximumEnemyCount,
          enemyCount
        });
        assert.equal(result.selectedPlayerSlots.length, playerCount);
        assert.equal(result.selectedEnemySlots.length, enemyCount);
        assert.equal(
          new Set(result.reservedPositions.map(point => `${point.x},${point.y}`)).size,
          playerCount + enemyCount
        );
        assert.ok(result.reservedPositions.every(
          point => result.reservationMask[point.y][point.x]
        ));
      }
    }
  }
});

test('11x16 coliseum serialization uses exact arena north/south record sides', () => {
  const result = integrate({
    mode: 'pvp_coliseum',
    mapWidth: 11,
    mapHeight: 16,
    playerCount: 5,
    enemyCapacity: 5,
    enemyCount: 5
  });
  assert.ok(result.spawnLayout.slots.slice(0, 5).every(
    slot => slot.side === 'arena_north' && slot.y < 8
  ));
  assert.ok(result.spawnLayout.slots.slice(5).every(
    slot => slot.side === 'arena_south' && slot.y >= 8
  ));
  assert.ok(result.spawnLayout.protectedZones.some(
    zone => zone.side === 'arena_north'
  ));
  assert.ok(result.spawnLayout.protectedZones.some(
    zone => zone.side === 'arena_south'
  ));
  assertExactRecordKeys(result.spawnLayout, [
    'slots',
    'protectedZones',
    'stagingRegions',
    'exits',
    'minimumApproachExits'
  ]);
  result.spawnLayout.slots.forEach(slot => assertExactRecordKeys(slot, [
    'id', 'side', 'role', 'x', 'y', 'selected'
  ]));
  result.spawnLayout.protectedZones.forEach(zone => assertExactRecordKeys(zone, [
    'id', 'kind', 'side', 'bounds', 'minimumClearance'
  ]));
  result.spawnLayout.stagingRegions.forEach(region => assertExactRecordKeys(region, [
    'id', 'side', 'strategy', 'bounds', 'capacity'
  ]));
  result.spawnLayout.exits.forEach(exit => assertExactRecordKeys(exit, [
    'id', 'zoneId', 'x', 'y'
  ]));
  const candidateValidation = validateBattleMapV2Candidate({
    ...MINIMAL_BATTLE_MAP_V2_CANDIDATE,
    mapWidth: 11,
    mapHeight: 16,
    terrain: result.terrain,
    elevation: result.elevation,
    elevationConnections: result.elevationConnections,
    obstacles: result.obstacles,
    spawnLayout: result.spawnLayout
  });
  assert.deepEqual(candidateValidation.errors, []);
});

test('non-square PvE integration selects each explicit strategy deterministically', () => {
  const request = {
    mode: 'pve',
    mapWidth: 23,
    mapHeight: 17,
    playerCount: 5,
    enemyCapacity: 12
  };
  const spawnLayout = resolveSpawnLayout(request);
  const mapLayers = layers(request.mapWidth, request.mapHeight);
  const routes = [{
    id: 'route:main',
    centerline: Array.from(
      { length: request.mapWidth - 4 },
      (_, index) => ({ x: index + 2, y: 8 })
    )
  }];
  for (const enemyStrategy of V2_ENEMY_SPAWN_STRATEGIES) {
    const options = {
      spawnLayout,
      ...mapLayers,
      routes: { features: routes },
      enemyCount: 8,
      enemyStrategy
    };
    const first = integrateActualSpawns(options);
    const second = integrateActualSpawns(options);
    assert.deepEqual(first.selectedEnemySlots, second.selectedEnemySlots);
    assert.equal(first.selectedEnemySlots.length, 8);
    assert.ok(first.spawnLayout.slots.filter(
      slot => slot.side === 'enemy' && slot.selected
    ).every(slot => slot.role === enemyStrategy));
  }
});

test('spawn integration rejects blocked, occupied, or non-flat protected cores', () => {
  const request = {
    mode: 'guild',
    mapWidth: 23,
    mapHeight: 17,
    playerCount: 5,
    enemyCapacity: 8
  };
  const spawnLayout = resolveSpawnLayout(request);
  const mapLayers = layers(request.mapWidth, request.mapHeight);
  const player = spawnLayout.playerSlots[0];
  assert.throws(
    () => integrateActualSpawns({
      spawnLayout,
      ...mapLayers,
      obstacles: [{
        id: 'obstacle:test',
        x: player.x,
        y: player.y,
        blocking: true
      }],
      enemyCount: 8
    }),
    error => error instanceof SpawnIntegrationError &&
      error.code === 'PROTECTED_CORE_BLOCKED'
  );
  assert.throws(
    () => integrateActualSpawns({
      spawnLayout,
      ...mapLayers,
      existingUnits: [{ id: 'unit:test', x: player.x, y: player.y }],
      enemyCount: 8
    }),
    error => error instanceof SpawnIntegrationError &&
      error.code === 'PROTECTED_CORE_BLOCKED'
  );
  const raised = mapLayers.elevation.map(row => [...row]);
  raised[player.y][player.x] = 0.54;
  assert.throws(
    () => integrateActualSpawns({
      spawnLayout,
      ...mapLayers,
      elevation: raised,
      enemyCount: 8
    }),
    error => error instanceof SpawnIntegrationError &&
      error.code === 'PROTECTED_CORE_NOT_FLAT'
  );
});

test('feathering is immutable, typed, boundary-local, and cannot clear a core', () => {
  const request = {
    mode: 'pve',
    mapWidth: 23,
    mapHeight: 17,
    playerCount: 5,
    enemyCapacity: 8
  };
  const spawnLayout = resolveSpawnLayout(request);
  const mapLayers = layers(request.mapWidth, request.mapHeight);
  let featherPoint;
  for (let y = 0; y < request.mapHeight && !featherPoint; y++) {
    for (let x = 0; x < request.mapWidth; x++) {
      if (spawnLayout.featherMask[y][x] && !spawnLayout.coreMask[y][x]) {
        featherPoint = { x, y };
        break;
      }
    }
  }
  const edit = {
    id: 'spawn-feather:path-01',
    type: 'spawn-feather-cell',
    layer: 'terrain',
    x: featherPoint.x,
    y: featherPoint.y,
    value: {
      material: 'path',
      movementCost: 1,
      passable: true,
      regionId: null
    }
  };
  const applied = applySpawnFeatherEdits({
    spawnLayout,
    ...mapLayers,
    edits: [edit]
  });
  assert.equal(mapLayers.terrain[featherPoint.y][featherPoint.x].material, 'grass');
  assert.equal(applied.terrain[featherPoint.y][featherPoint.x].material, 'path');
  assert.equal(Object.isFrozen(applied.terrain), true);

  const corePoint = spawnLayout.playerSlots[0];
  assert.throws(
    () => applySpawnFeatherEdits({
      spawnLayout,
      ...mapLayers,
      edits: [{
        ...edit,
        id: 'spawn-feather:bad-01',
        x: corePoint.x,
        y: corePoint.y
      }]
    }),
    error => error instanceof SpawnIntegrationError &&
      error.code === 'FEATHER_EDIT_OUTSIDE_BOUNDARY'
  );
});

test('unknown spawn strategies fail explicitly without fallback', () => {
  const request = {
    mode: 'pve',
    mapWidth: 23,
    mapHeight: 17,
    playerCount: 5,
    enemyCapacity: 8
  };
  assert.throws(
    () => integrate(request, { enemyStrategy: 'whatever-is-open' }),
    /Unsupported enemy spawn strategy/
  );
});
