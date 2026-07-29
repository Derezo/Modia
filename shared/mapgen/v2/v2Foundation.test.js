import test from 'node:test';
import assert from 'node:assert/strict';

import {
  coordinateHash32,
  deriveAttemptSeed,
  quantizeFixed
} from './Determinism.js';
import { createStageRegistry, executeStagePipeline, CandidateStageError } from './StageRegistry.js';
import { createV2Context } from './V2Context.js';
import { resolveSpawnLayout } from './SpawnLayoutContract.js';

test('attempt and coordinate derivation are deterministic and isolated', () => {
  const first = deriveAttemptSeed(12345, 2, 0);
  assert.equal(first, deriveAttemptSeed(12345, 2, 0));
  assert.notEqual(first, deriveAttemptSeed(12345, 2, 1));
  assert.equal(coordinateHash32(first, 4, 9, 'variant'), coordinateHash32(first, 4, 9, 'variant'));
  assert.notEqual(coordinateHash32(first, 4, 9, 'variant'), coordinateHash32(first, 4, 9, 'terrain'));
  assert.equal(quantizeFixed(0.1234564), 123456);
  assert.equal(quantizeFixed(-0.1234565), -123457);
});

test('required stage outputs are typed, frozen, and observable downstream', async () => {
  const registry = createStageRegistry();
  registry.register({
    id: 'macro',
    inputs: ['request'],
    outputs: ['regionIndex'],
    required: true,
    stream: 'regions',
    run(context) {
      return { regionIndex: { source: context.require('request').nodeType, ids: ['r-1'] } };
    }
  });
  registry.register({
    id: 'refine',
    inputs: ['regionIndex'],
    outputs: ['terrain'],
    required: true,
    stream: 'terrain',
    run(context) {
      return { terrain: [[context.require('regionIndex').ids[0]]] };
    }
  });
  const context = createV2Context({
    width: 10,
    height: 10,
    terrainSeed: 7,
    attempt: 0,
    attemptSeed: deriveAttemptSeed(7, 2, 0)
  });
  context.publish('request', { nodeType: 'forest' }, 'request');
  await executeStagePipeline({ registry, stageIds: ['macro', 'refine'], context });
  assert.deepEqual(context.require('terrain'), [['r-1']]);
  assert.equal(Object.isFrozen(context.require('regionIndex')), true);
  assert.deepEqual(context.getStageEvents().map(event => event.status), ['completed', 'completed']);
});

test('required stage failure rejects while optional failure records omission', async () => {
  const registry = createStageRegistry();
  registry.register({
    id: 'optional-detail',
    inputs: [],
    outputs: ['decorations'],
    required: false,
    stream: 'decorations',
    run() {
      throw new Error('not supported');
    }
  });
  registry.register({
    id: 'required-terrain',
    inputs: [],
    outputs: ['terrain'],
    required: true,
    stream: 'terrain',
    run() {
      return {};
    }
  });
  const context = createV2Context({
    width: 10,
    height: 10,
    terrainSeed: 8,
    attempt: 0,
    attemptSeed: deriveAttemptSeed(8, 2, 0)
  });
  await assert.rejects(
    executeStagePipeline({
      registry,
      stageIds: ['optional-detail', 'required-terrain'],
      context
    }),
    error => error instanceof CandidateStageError && error.code === 'MISSING_OUTPUT'
  );
  assert.equal(context.getStageEvents()[0].status, 'omitted');
});

for (const fixture of [
  { mode: 'pve', mapWidth: 10, mapHeight: 10, playerCount: 5, enemyCapacity: 6 },
  { mode: 'pvp_coliseum', mapWidth: 11, mapHeight: 16, playerCount: 5, enemyCapacity: 5 },
  { mode: 'guild', mapWidth: 23, mapHeight: 17, playerCount: 5, enemyCapacity: 8 },
  { mode: 'pve_coop', mapWidth: 48, mapHeight: 24, playerCount: 5, enemyCapacity: 12 }
]) {
  test(`spawn contract resolves compact geometry for ${fixture.mode} ${fixture.mapWidth}x${fixture.mapHeight}`, () => {
    const layout = resolveSpawnLayout(fixture);
    assert.equal(layout.playerSlots.length, fixture.playerCount);
    assert.equal(layout.enemyCandidateSlots.length, fixture.enemyCapacity);
    assert.equal(layout.coreMask.length, fixture.mapHeight);
    assert.equal(layout.coreMask[0].length, fixture.mapWidth);
    assert.ok(layout.exits.length >= 4);
    assert.equal(
      layout.orientation,
      fixture.mode === 'pvp_coliseum' ? 'north-south' : 'west-east'
    );
    for (const slot of [...layout.playerSlots, ...layout.enemyCandidateSlots]) {
      assert.equal(layout.coreMask[slot.y][slot.x], true);
    }
    for (let y = 0; y < fixture.mapHeight; y++) {
      assert.ok(
        layout.coreMask[y].some(value => !value),
        'protected spawn core must not become a full-width seam'
      );
    }
    for (let x = 0; x < fixture.mapWidth; x++) {
      assert.ok(
        layout.coreMask.some(row => !row[x]),
        'protected spawn core must not become a full-height seam'
      );
    }
  });
}

test('competitive modes use north/south formations on compact non-square maps', () => {
  for (const mode of ['pvp', 'pvp_coliseum']) {
    const layout = resolveSpawnLayout({
      mode,
      mapWidth: 11,
      mapHeight: 16,
      playerCount: 5,
      enemyCapacity: 5
    });
    assert.equal(layout.orientation, 'north-south');
    assert.equal(layout.playerSide, 'north');
    assert.equal(layout.enemySide, 'south');
    assert.ok(layout.playerSlots.every(slot => slot.y < 8));
    assert.ok(layout.enemyCandidateSlots.every(slot => slot.y >= 8));
    assert.ok(layout.exits.filter(exit => exit.side === 'north').length >= 2);
    assert.ok(layout.exits.filter(exit => exit.side === 'south').length >= 2);
  }
});

test('spawn capacity geometry is deterministic for every supported count and mode', () => {
  for (const mode of ['pve', 'guild', 'pvp', 'pvp_coliseum', 'pve_coop']) {
    for (let playerCount = 1; playerCount <= 5; playerCount++) {
      const maximumEnemyCount = mode === 'pvp' || mode === 'pvp_coliseum' ? 5 : 24;
      for (let enemyCapacity = 1; enemyCapacity <= maximumEnemyCount; enemyCapacity++) {
        const request = {
          mode,
          mapWidth: mode === 'pvp' || mode === 'pvp_coliseum' ? 11 : 23,
          mapHeight: mode === 'pvp' || mode === 'pvp_coliseum' ? 16 : 17,
          playerCount,
          enemyCapacity
        };
        const first = resolveSpawnLayout(request);
        const second = resolveSpawnLayout(request);
        assert.deepEqual(first, second);
        assert.equal(first.playerSlots.length, playerCount);
        assert.equal(first.enemyCandidateSlots.length, enemyCapacity);
        assert.ok(first.playerSlots.every(slot => first.playerCoreMask[slot.y][slot.x]));
        assert.ok(first.enemyCandidateSlots.every(
          slot => first.enemyCoreMask[slot.y][slot.x]
        ));
      }
    }
  }
});

test('spawn contract rejects insufficient dimensions before generation', () => {
  assert.throws(
    () => resolveSpawnLayout({
      mode: 'pve',
      mapWidth: 9,
      mapHeight: 10,
      playerCount: 5,
      enemyCapacity: 6
    }),
    /at least 10/
  );
});
