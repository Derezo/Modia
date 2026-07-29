import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BATTLE_MAP_V2_ENABLED_MODES_ENV,
  generateBattleMap,
  isBattleMapV2EnabledForMode,
  selectBattleMapGenerationVersion
} from '../../../services/battle/battleMapGenerationService.js';
import {
  createBattleMapCapabilities
} from '../../../../../shared/battleStateProtocol.js';
import {
  BATTLE_MAP_HASH_VERSION,
  battleMapV2FromFlatState
} from '../../../../../shared/battleMap/index.js';

const v2Capabilities = createBattleMapCapabilities({
  supportedBattleMapSchemaVersions: [1, 2],
  supportedHashVersions: [BATTLE_MAP_HASH_VERSION],
  supportedMutableStateProtocolVersions: [1]
});

describe('authoritative battle-map generation', () => {
  it('requires both the canonical rollout gate and V2 client negotiation', () => {
    assert.equal(BATTLE_MAP_V2_ENABLED_MODES_ENV, 'BATTLE_MAP_V2_ENABLED_MODES');
    assert.equal(isBattleMapV2EnabledForMode('pve', ''), false);
    assert.equal(isBattleMapV2EnabledForMode('pve', 'guild,pve'), true);
    assert.equal(isBattleMapV2EnabledForMode('pvp_coliseum', '*'), true);
    assert.equal(selectBattleMapGenerationVersion({
      mode: 'pve',
      allowV2: false,
      clientCapabilities: v2Capabilities
    }), 1);
    assert.equal(selectBattleMapGenerationVersion({
      mode: 'pve',
      allowV2: true,
      clientCapabilities: null
    }), 1);
    assert.equal(selectBattleMapGenerationVersion({
      mode: 'pve',
      allowV2: true,
      clientCapabilities: v2Capabilities
    }), 2);
  });

  it('keeps absent capabilities on deterministic V1 persistence', async () => {
    const generated = await generateBattleMap({
      terrainSeed: 12345,
      nodeType: 'forest',
      mapWidth: 16,
      mapHeight: 16,
      mode: 'pve',
      playerCount: 1,
      enemyCount: 0,
      allowV2: true,
      initialMutableState: {
        turn: 1,
        units: [{ id: 'player:1', type: 'player', tileX: 2, tileY: 8 }]
      }
    });

    assert.equal(generated.battleMapSchemaVersion, 1);
    assert.equal(generated.finalMap, null);
    assert.equal(generated.legacyFlatState.terrainSeed, 12345);
    assert.equal(generated.legacyFlatState.mapSeed, undefined);
    assert.equal(generated.flatState.units[0].tileX, 2);
  });

  it('creates and reloads the same immutable V2 map and flat engine state', async () => {
    const request = {
      terrainSeed: 24680,
      nodeType: 'arena',
      mapWidth: 16,
      mapHeight: 16,
      mode: 'pvp_coliseum',
      playerCount: 1,
      enemyCount: 1,
      allowV2: true,
      clientCapabilities: v2Capabilities,
      initialMutableState: {
        turn: 1,
        units: [
          { id: 'team:1', type: 'player', teamId: 1 },
          { id: 'team:2', type: 'player', teamId: 2 }
        ]
      }
    };
    const first = await generateBattleMap(request);
    const repeated = await generateBattleMap(request);
    const reloaded = await battleMapV2FromFlatState(first.flatState);

    assert.equal(first.battleMapSchemaVersion, 2);
    assert.equal(first.legacyFlatState, null);
    assert.equal(
      first.finalMap.diagnostics.hashes.fullHash,
      repeated.finalMap.diagnostics.hashes.fullHash
    );
    assert.deepEqual(reloaded, first.finalMap);
    assert.equal(Object.isFrozen(first.finalMap), true);
    assert.equal(Object.isFrozen(first.flatState), true);
    assert.notEqual(first.flatState.units[0].tileY, first.flatState.units[1].tileY);
    assert.throws(() => {
      first.finalMap.terrain[0][0].passable = false;
    }, TypeError);
  });

  it('preserves relative formation depth and lateral order in valid V2 slots', async () => {
    const units = [
      { id: 'p1-deep-right', type: 'player', teamId: 1, tileX: 10, tileY: 24 },
      { id: 'p2-deep-right', type: 'player', teamId: 2, tileX: 10, tileY: 7 },
      { id: 'p1-shallow-right', type: 'player', teamId: 1, tileX: 10, tileY: 27 },
      { id: 'p2-shallow-right', type: 'player', teamId: 2, tileX: 10, tileY: 4 },
      { id: 'p1-deep-left', type: 'player', teamId: 1, tileX: 2, tileY: 24 },
      { id: 'p2-deep-left', type: 'player', teamId: 2, tileX: 2, tileY: 7 },
      { id: 'p1-shallow-left', type: 'player', teamId: 1, tileX: 2, tileY: 27 },
      { id: 'p2-shallow-left', type: 'player', teamId: 2, tileX: 2, tileY: 4 }
    ];
    const generated = await generateBattleMap({
      terrainSeed: 97531,
      nodeType: 'arena',
      mapWidth: 16,
      mapHeight: 16,
      mode: 'pvp_coliseum',
      playerCount: 4,
      enemyCount: 4,
      enemyCapacity: 4,
      existingUnits: units,
      initialMutableState: { units },
      allowV2: true,
      clientCapabilities: v2Capabilities
    });
    const byId = new Map(generated.flatState.units.map(unit => [unit.id, unit]));

    // Team one is authored from the south and placed on V2's north side.
    assert.ok(byId.get('p1-shallow-left').tileY < byId.get('p1-deep-left').tileY);
    assert.ok(byId.get('p1-shallow-left').tileX < byId.get('p1-shallow-right').tileX);

    // Team two is authored from the north and placed on V2's south side.
    assert.ok(byId.get('p2-shallow-left').tileY > byId.get('p2-deep-left').tileY);
    assert.ok(byId.get('p2-shallow-left').tileX < byId.get('p2-shallow-right').tileX);
  });

  it('keeps volcanic rock as semantic floor and blockers as explicit records', async () => {
    const generated = await generateBattleMap({
      terrainSeed: 1,
      nodeType: 'volcano',
      mapWidth: 16,
      mapHeight: 16,
      mode: 'pve',
      playerCount: 1,
      enemyCount: 1,
      allowV2: true,
      clientCapabilities: v2Capabilities
    });
    const rockCells = generated.finalMap.terrain
      .flat()
      .filter(cell => cell.material === 'rock');

    assert.ok(rockCells.length > 0);
    assert.ok(rockCells.every(cell => cell.passable === true));
    assert.ok(generated.finalMap.obstacles.length > 0);
    assert.ok(generated.finalMap.obstacles.every(obstacle => (
      Number.isInteger(obstacle.x) && Number.isInteger(obstacle.y)
    )));
  });
});
