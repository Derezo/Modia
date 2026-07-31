import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BATTLE_MAP_V2_ENABLED_MODES_ENV,
  extractBattleMutableStateForCommit,
  generateBattleMap,
  isBattleMapV2EnabledForMode,
  selectBattleMapGenerationVersion
} from '../../../services/battle/battleMapGenerationService.js';
import {
  processAction
} from '../../../services/battle/actionProcessor.js';
import {
  calculatePathCost
} from '../../../services/battle/movementService.js';
import {
  createBattleMapEcologyContext
} from '../../../services/battle/BattleMapEcologyContext.js';
import {
  createBattleMapCapabilities
} from '../../../../../shared/battleStateProtocol.js';
import {
  BATTLE_MAP_HASH_VERSION,
  battleMapV2FromFlatState,
  battleMapV3FromFlatState,
  createMinimalBattleMapV3FinalFixture
} from '../../../../../shared/battleMap/index.js';

const v2Capabilities = createBattleMapCapabilities({
  supportedBattleMapSchemaVersions: [1, 2],
  supportedHashVersions: [BATTLE_MAP_HASH_VERSION],
  supportedMutableStateProtocolVersions: [1]
});
const v3Capabilities = createBattleMapCapabilities({
  supportedBattleMapSchemaVersions: [1, 2, 3],
  supportedHashVersions: [BATTLE_MAP_HASH_VERSION],
  supportedMutableStateProtocolVersions: [1]
});
const borderwoodEcologyContext = createBattleMapEcologyContext({
  id: 1,
  name: 'Whispering Woods',
  node_type: 'forest',
  difficulty_tier: 1,
  local_seed: 731,
  region_id: 1,
  region_race: 'dwarf',
  region_dominant_terrain: 'forest'
});

const absentV3Coverage = async () => ({
  coverage: 'absent',
  map: null,
  provenance: null
});

const generateWithAbsentV3Coverage = request => generateBattleMap(
  request,
  { selectV3: absentV3Coverage }
);

describe('authoritative battle-map generation', () => {
  it('strictly projects committed flat states without accepting unknown fields', () => {
    const mutableState = extractBattleMutableStateForCommit({
      turn: 3,
      units: [{ id: 'player:1', hp: 12 }],
      terrain: [[{ material: 'grass' }]]
    });

    assert.equal(mutableState.turn, 3);
    assert.deepEqual(mutableState.units, [{ id: 'player:1', hp: 12 }]);
    assert.equal(Object.hasOwn(mutableState, 'terrain'), false);
    assert.throws(
      () => extractBattleMutableStateForCommit({ turn: 3, unexpectedCombatField: true }),
      /unexpectedCombatField is not part of BattleMutableStateV1/
    );
    assert.throws(
      () => extractBattleMutableStateForCommit({ turn: 3, mapSeed: 99 }),
      /map alias/
    );
  });

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

  it('uses V2 compatibility only for catalog coverage absence and never creates V1', async () => {
    await assert.rejects(
      generateWithAbsentV3Coverage({
        terrainSeed: 12345,
        nodeType: 'forest',
        mapWidth: 16,
        mapHeight: 16,
        mode: 'pve',
        difficultyTier: 1,
        playerCount: 1,
        enemyCount: 1,
        clientCapabilities: null,
        initialMutableState: {
          turn: 1,
          units: [
            { id: 'player:1', type: 'player' },
            { id: 'enemy:1', type: 'enemy' }
          ]
        }
      }),
      error => error.code === 'battle_map_upgrade_required'
    );

    const generated = await generateWithAbsentV3Coverage({
      terrainSeed: 12345,
      nodeType: 'forest',
      mapWidth: 16,
      mapHeight: 16,
      mode: 'pve',
      difficultyTier: 1,
      playerCount: 1,
      enemyCount: 1,
      allowV2: false,
      clientCapabilities: v2Capabilities,
      initialMutableState: {
        turn: 1,
        units: [
          { id: 'player:1', type: 'player' },
          { id: 'enemy:1', type: 'enemy' }
        ]
      }
    });

    assert.equal(generated.catalogCoverage, 'absent');
    assert.equal(generated.battleMapSchemaVersion, 2);
    assert.equal(generated.legacyFlatState, null);
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
      competitiveBand: 'test-band',
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
    const first = await generateWithAbsentV3Coverage(request);
    const repeated = await generateWithAbsentV3Coverage(request);
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
    const generated = await generateWithAbsentV3Coverage({
      terrainSeed: 97531,
      nodeType: 'arena',
      mapWidth: 16,
      mapHeight: 16,
      mode: 'pvp_coliseum',
      playerCount: 4,
      enemyCount: 4,
      enemyCapacity: 4,
      competitiveBand: 'test-band',
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
    const generated = await generateWithAbsentV3Coverage({
      terrainSeed: 1,
      nodeType: 'volcano',
      mapWidth: 16,
      mapHeight: 16,
      mode: 'pve',
      playerCount: 1,
      enemyCount: 1,
      difficultyTier: 1,
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

  it('automatically selects covered V3 content independent of client downgrade preferences', async () => {
    const map = await createMinimalBattleMapV3FinalFixture();
    const provenance = {
      catalogReleaseId: 'catalog:test-v1',
      catalogFullHash: `sha256:${'a'.repeat(64)}`,
      selectorVersion: 1,
      selectorDigest: `sha256:${'b'.repeat(64)}`,
      encounterSeed: 731,
      theme: map.theme,
      sourceTier: 1,
      selectionBand: 'tier-1',
      mode: 'pve',
      partyCapacityBand: 'players-1-5',
      opposingRosterCapacityBand: 'opponents-1-7',
      selectedEntryId: 'entry:forest:test',
      mapContentId: map.contentId,
      mapContentVersion: map.contentVersion,
      mapFullHash: map.hashes.fullHash
    };
    const selectV3 = async () => ({
      coverage: 'selected',
      map,
      provenance
    });
    const request = {
      terrainSeed: 731,
      nodeType: 'forest',
      mapWidth: map.dimensions.width,
      mapHeight: map.dimensions.height,
      mode: 'pve',
      difficultyTier: 1,
      playerCount: 1,
      enemyCount: 1,
      initialMutableState: {
        turn: 1,
        units: [
          { id: 'player:1', type: 'player', movement: 4 },
          { id: 'enemy:1', type: 'enemy', movement: 4 }
        ]
      }
    };

    await assert.rejects(
      generateBattleMap({
        ...request,
        clientCapabilities: v2Capabilities
      }, { selectV3 }),
      error => error.code === 'battle_map_upgrade_required'
    );

    const generated = await generateBattleMap({
      ...request,
      clientCapabilities: v3Capabilities
    }, { selectV3 });
    assert.equal(generated.battleMapSchemaVersion, 3);
    assert.equal(generated.catalogCoverage, 'selected');
    assert.deepEqual(generated.selectionProvenance, provenance);
    assert.deepEqual(await battleMapV3FromFlatState(generated.flatState), map);
    assert.ok(generated.flatState.units.every(unit => (
      Number.isInteger(unit.tileX) && Number.isInteger(unit.tileY)
    )));
  });

  it('selects, hydrates, and plays across the active forest v12 elevation contract', async () => {
    const request = {
      terrainSeed: 731,
      nodeType: 'forest',
      mapWidth: 32,
      mapHeight: 32,
      mode: 'pve',
      difficultyTier: 1,
      playerCount: 1,
      enemyCount: 1,
      ecologyContext: borderwoodEcologyContext,
      initialMutableState: {
        turn: 1,
        units: [
          {
            id: 'player:1',
            type: 'player',
            class: 'ninja',
            hp: 100,
            maxHp: 100,
            mp: 50,
            maxMp: 50,
            movement: 5,
            attackRange: 1,
            statusEffects: [],
            skills: [],
            skillCooldowns: {}
          },
          {
            id: 'enemy:1',
            type: 'enemy',
            hp: 100,
            maxHp: 100,
            movement: 3,
            statusEffects: []
          }
        ]
      }
    };

    await assert.rejects(
      generateBattleMap({
        ...request,
        clientCapabilities: v2Capabilities
      }),
      error => error.code === 'battle_map_upgrade_required'
    );
    const generated = await generateBattleMap({
      ...request,
      clientCapabilities: v3Capabilities
    });

    assert.equal(generated.battleMapSchemaVersion, 3);
    assert.equal(generated.catalogCoverage, 'selected');
    assert.equal(
      generated.selectionProvenance.catalogReleaseId,
      'battle-map-v3-forest-pilot-2026-07-30-r6'
    );
    assert.equal(
      generated.selectionProvenance.catalogFullHash,
      'sha256:76af233bcb30c9716e1e07652134fbb9efdc928a83888f956ee321ad8d7cc85e'
    );
    assert.equal(
      generated.selectionProvenance.ecologyProfile,
      'forest-iron-depths-borderwood'
    );
    assert.equal(generated.selectionProvenance.mapContentId, 'forest-template-01-b');
    assert.equal(generated.selectionProvenance.mapContentVersion, 12);
    assert.equal(generated.ecologyContext, borderwoodEcologyContext);
    assert.ok(generated.flatState.units.every(unit => (
      Number.isInteger(unit.tileX)
      && Number.isInteger(unit.tileY)
      && generated.finalMap.playableMask[unit.tileY][unit.tileX] === true
    )));

    const hydrated = await battleMapV3FromFlatState(generated.flatState);
    assert.deepEqual(hydrated, generated.finalMap);
    const stairs = hydrated.elevationConnections.filter(
      connection => connection.kind === 'stairs'
    );
    const slopes = hydrated.elevationConnections.filter(
      connection => connection.kind === 'slope'
    );
    assert.equal(stairs.length, 4);
    assert.equal(slopes.length, 4);
    assert.deepEqual(
      hydrated.elevationConnections.map(connection => ({
        kind: connection.kind,
        direction: connection.direction,
        assetKey: connection.asset.key
      })),
      [
        {
          kind: 'stairs',
          direction: 'n',
          assetKey: 'forest-borderwood-root-stairs-n'
        },
        {
          kind: 'slope',
          direction: 'e',
          assetKey: 'forest-borderwood-earth-ramp-e'
        },
        {
          kind: 'stairs',
          direction: 'n',
          assetKey: 'forest-borderwood-root-stairs-s'
        },
        {
          kind: 'stairs',
          direction: 'n',
          assetKey: 'forest-borderwood-root-stairs-s'
        },
        {
          kind: 'slope',
          direction: 'n',
          assetKey: 'forest-borderwood-earth-ramp-n'
        },
        {
          kind: 'stairs',
          direction: 'n',
          assetKey: 'forest-borderwood-root-stairs-n'
        },
        {
          kind: 'slope',
          direction: 'n',
          assetKey: 'forest-borderwood-earth-ramp-s'
        },
        {
          kind: 'slope',
          direction: 'n',
          assetKey: 'forest-borderwood-earth-ramp-s'
        }
      ]
    );
    assert.ok(hydrated.elevationConnections.every(connection => (
      connection.traversable === true
      && connection.bidirectional === true
      && connection.asset.immutableUrl.includes(
        `/forest/connection-${connection.kind}/`
      )
    )));

    const stair = stairs[0];
    assert.equal(hydrated.playableMask[stair.from.y][stair.from.x], true);
    assert.equal(hydrated.playableMask[stair.to.y][stair.to.x], true);
    const slope = slopes[0];
    assert.equal(hydrated.playableMask[slope.from.y][slope.from.x], true);
    assert.equal(hydrated.playableMask[slope.to.y][slope.to.x], true);

    const state = structuredClone(generated.flatState);
    const actor = {
      ...state.units.find(unit => unit.id === 'player:1'),
      tileX: stair.from.x,
      tileY: stair.from.y,
      class: 'ninja',
      moveUsed: false,
      actUsed: false,
      turnPhase: 'ready',
      statusEffects: []
    };
    state.units = [actor];

    for (const connection of [stair, slope]) {
      actor.tileX = connection.from.x;
      actor.tileY = connection.from.y;
      actor.moveUsed = false;
      actor.turnPhase = 'ready';
      const traversalState = {
        ...structuredClone(state),
        units: []
      };
      assert.equal(calculatePathCost(
        connection.from.x,
        connection.from.y,
        connection.to.x,
        connection.to.y,
        traversalState,
        2
      ), 2);
      assert.equal(calculatePathCost(
        connection.to.x,
        connection.to.y,
        connection.from.x,
        connection.from.y,
        traversalState,
        2
      ), 2);
      const disabledConnectionState = structuredClone(traversalState);
      disabledConnectionState.elevationConnections =
        disabledConnectionState.elevationConnections.map(record => (
          record.id === connection.id
            ? { ...record, traversable: false }
            : record
        ));
      assert.equal(calculatePathCost(
        connection.from.x,
        connection.from.y,
        connection.to.x,
        connection.to.y,
        disabledConnectionState,
        2
      ), Infinity);
      assert.equal(calculatePathCost(
        connection.to.x,
        connection.to.y,
        connection.from.x,
        connection.from.y,
        disabledConnectionState,
        2
      ), Infinity);

      const ascent = processAction(state, actor, 'move', connection.to);
      assert.equal(ascent.moved, true);
      assert.deepEqual(
        { x: actor.tileX, y: actor.tileY },
        connection.to
      );
      assert.equal(actor.moveUsed, true);

      actor.moveUsed = false;
      actor.turnPhase = 'ready';
      const descent = processAction(state, actor, 'move', connection.from);
      assert.equal(descent.moved, true);
      assert.deepEqual(
        { x: actor.tileX, y: actor.tileY },
        connection.from
      );
    }

    const blockingCells = new Set(
      hydrated.obstacles
        .filter(obstacle => obstacle.blocking)
        .flatMap(obstacle => obstacle.cells)
        .map(cell => `${cell.x},${cell.y}`)
    );
    let obstacleProbe = null;
    for (const obstacle of hydrated.obstacles.filter(record => record.blocking)) {
      for (const target of obstacle.cells) {
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const from = { x: target.x + dx, y: target.y + dy };
          if (
            hydrated.playableMask[from.y]?.[from.x] === true
            && hydrated.terrain[from.y]?.[from.x]?.passable === true
            && !blockingCells.has(`${from.x},${from.y}`)
          ) {
            obstacleProbe = { from, target };
            break;
          }
        }
        if (obstacleProbe) break;
      }
      if (obstacleProbe) break;
    }
    assert.ok(obstacleProbe, 'expected an approachable blocking forest obstacle');

    actor.tileX = obstacleProbe.from.x;
    actor.tileY = obstacleProbe.from.y;
    actor.moveUsed = false;
    actor.turnPhase = 'ready';
    const blocked = processAction(state, actor, 'move', obstacleProbe.target);
    assert.equal(blocked.moved, false);
    assert.match(blocked.error, /unreachable/);
    assert.deepEqual(
      { x: actor.tileX, y: actor.tileY },
      obstacleProbe.from
    );
  });
});
