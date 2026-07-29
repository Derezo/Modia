import { deepCloneJsonValue, deepFreeze } from './canonicalJson.js';
import {
  createBattleMapCanonicalVectors,
  finalizeBattleMapV2
} from './hashes.js';

function diagnostics(algorithms = []) {
  return {
    resolvedRecipe: {
      recipeId: 'fixture',
      recipeVersion: '1',
      renderPalette: 'forest',
      quantization: {
        scale: 1000,
        rounding: 'half-away-from-zero'
      },
      parameters: [
        { name: 'relief', value: 0 },
        { name: 'waterEnabled', value: true }
      ]
    },
    attempt: 0,
    streamVersion: 'named-streams-v1',
    hashVersion: 'sha256-cjson-v1',
    algorithms,
    hardValidation: {
      valid: true,
      checks: []
    },
    tacticalValidation: {
      passed: true,
      checks: []
    },
    qualityMetrics: {
      score: 1,
      metrics: []
    }
  };
}

export const MINIMAL_BATTLE_MAP_V2_CANDIDATE = deepFreeze({
  battleMapSchemaVersion: 2,
  terrainGenerationVersion: 2,
  terrainSeed: 0,
  mapWidth: 1,
  mapHeight: 1,
  nodeType: 'fixture',
  biome: 'forest',
  archetype: 'minimal',
  elevationFormat: 'normalized',
  terrain: [[{
    material: 'grass',
    movementCost: 1,
    passable: true,
    regionId: null
  }]],
  elevation: [[0]],
  elevationConnections: [],
  obstacles: [],
  spawnLayout: {
    slots: [],
    protectedZones: [],
    stagingRegions: [],
    exits: [],
    minimumApproachExits: 0
  },
  variants: [],
  transitions: [],
  decorations: [],
  features: {
    regions: [],
    waterBodies: [],
    routes: [],
    clearings: [],
    structures: []
  },
  diagnostics: diagnostics()
});

export const REPRESENTATIVE_BATTLE_MAP_V2_CANDIDATE = deepFreeze({
  battleMapSchemaVersion: 2,
  terrainGenerationVersion: 2,
  terrainSeed: 424242,
  mapWidth: 3,
  mapHeight: 2,
  nodeType: 'forest',
  biome: 'forest',
  archetype: 'organic_crossing',
  elevationFormat: 'normalized',
  terrain: [
    [
      { material: 'grass', movementCost: 1, passable: true, regionId: 'region:grove' },
      { material: 'path', movementCost: 1, passable: true, regionId: 'region:grove' },
      { material: 'water', movementCost: 2, passable: true, regionId: 'region:grove' }
    ],
    [
      { material: 'grass', movementCost: 1, passable: true, regionId: 'region:grove' },
      { material: 'path', movementCost: 1, passable: true, regionId: 'region:grove' },
      { material: 'stone', movementCost: 1.5, passable: true, regionId: 'region:grove' }
    ]
  ],
  elevation: [
    [0.5, 0.5, 0.25],
    [0.5, 0.75, 0.75]
  ],
  elevationConnections: [{
    id: 'connection:ramp-1',
    from: { x: 0, y: 1 },
    to: { x: 1, y: 1 },
    kind: 'ramp',
    direction: 'e',
    elevationDelta: 0.25,
    bidirectional: true,
    featureId: 'route:main'
  }],
  obstacles: [{
    id: 'obstacle:tree-1',
    x: 0,
    y: 0,
    kind: 'tree',
    assetKey: 'forest/tree/oak-1',
    blocking: true,
    movementCost: 0,
    featureId: 'region:grove'
  }],
  spawnLayout: {
    slots: [
      { id: 'spawn:player-1', side: 'player', role: 'formation', x: 0, y: 1, selected: true },
      { id: 'spawn:enemy-1', side: 'enemy', role: 'candidate', x: 2, y: 1, selected: true }
    ],
    protectedZones: [{
      id: 'zone:player-core',
      kind: 'core',
      side: 'player',
      bounds: { minX: 0, minY: 1, maxX: 0, maxY: 1 },
      minimumClearance: 1
    }],
    stagingRegions: [{
      id: 'staging:enemy',
      side: 'enemy',
      strategy: 'ranged',
      bounds: { minX: 2, minY: 0, maxX: 2, maxY: 1 },
      capacity: 2
    }],
    exits: [{
      id: 'exit:player-east',
      zoneId: 'zone:player-core',
      x: 1,
      y: 1
    }],
    minimumApproachExits: 1
  },
  variants: [{
    id: 'variant:grass-1',
    x: 0,
    y: 1,
    material: 'grass',
    variantIndex: 2,
    featureId: 'clearing:start'
  }],
  transitions: [{
    id: 'transition:shore-1',
    x: 2,
    y: 0,
    kind: 'shore',
    directionMask: 8,
    assetKey: 'forest/shore/west',
    anchor: 'tile_top',
    stratum: 20,
    precedence: 10,
    featureId: 'water:stream'
  }],
  decorations: [{
    id: 'decoration:reeds-1',
    x: 2,
    y: 0,
    kind: 'reeds',
    assetKey: 'forest/decoration/reeds-1',
    variantIndex: 0,
    anchor: 'above_connection',
    featureId: 'water:stream'
  }],
  features: {
    regions: [{
      id: 'region:grove',
      kind: 'grove',
      material: 'grass',
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
      area: 6,
      adjacentRegionIds: [],
      parentFeatureId: null
    }],
    waterBodies: [{
      id: 'water:stream',
      kind: 'stream',
      material: 'water',
      bounds: { minX: 2, minY: 0, maxX: 2, maxY: 0 },
      cells: [{ x: 2, y: 0 }],
      sourceCells: [{ x: 2, y: 0 }],
      outletCell: { x: 2, y: 0 },
      parentRegionId: 'region:grove'
    }],
    routes: [{
      id: 'route:main',
      kind: 'approach',
      material: 'path',
      centerline: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
      width: 1,
      required: true,
      anchorFeatureIds: ['clearing:start', 'structure:gate']
    }],
    clearings: [{
      id: 'clearing:start',
      kind: 'spawn',
      bounds: { minX: 0, minY: 1, maxX: 1, maxY: 1 },
      cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }],
      parentRegionId: 'region:grove'
    }],
    structures: [{
      id: 'structure:gate',
      kind: 'gate',
      assetKey: 'forest/structure/gate-1',
      footprint: [{ x: 2, y: 1 }],
      entrances: [{ x: 1, y: 1 }],
      parentRegionId: 'region:grove'
    }]
  },
  diagnostics: diagnostics([{
    id: 'algorithm:fields',
    stage: 'fields',
    version: '1',
    optional: false,
    status: 'applied',
    outputFeatureIds: ['region:grove', 'water:stream', 'route:main', 'clearing:start', 'structure:gate']
  }])
});

export function createMinimalBattleMapV2CandidateFixture() {
  return deepCloneJsonValue(MINIMAL_BATTLE_MAP_V2_CANDIDATE);
}

export function createRepresentativeBattleMapV2CandidateFixture() {
  return deepCloneJsonValue(REPRESENTATIVE_BATTLE_MAP_V2_CANDIDATE);
}

export async function createMinimalBattleMapV2FinalFixture() {
  return finalizeBattleMapV2(createMinimalBattleMapV2CandidateFixture());
}

export async function createRepresentativeBattleMapV2FinalFixture() {
  return finalizeBattleMapV2(createRepresentativeBattleMapV2CandidateFixture());
}

/**
 * Published materialized projection and canonical-byte vector. The byte strings
 * are UTF-8 text; consumers can compare TextEncoder output exactly.
 */
export const REPRESENTATIVE_BATTLE_MAP_V2_CANONICAL_VECTOR =
  deepFreeze(createBattleMapCanonicalVectors(REPRESENTATIVE_BATTLE_MAP_V2_CANDIDATE));

// Fixed independently checked digests for the representative candidate.
export const REPRESENTATIVE_BATTLE_MAP_V2_EXPECTED_HASHES = deepFreeze({
  authoritativeHash: 'sha256:e25ba878a128df46b706d4fe2c3d8ce42f2e80abdda5c509549677844de1962a',
  visualHash: 'sha256:af2a89448bbf8778e570b87d6420e5391d8fcaba4fdd80f3cdd022004d24d793',
  fullHash: 'sha256:21d9f553c6e8ecaee54c9bd1e3b65a2cc3834df863051f490c62d18aebc62480'
});
