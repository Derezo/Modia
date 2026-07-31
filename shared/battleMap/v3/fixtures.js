import { finalizeBattleMapV3 } from './hashes.js';

const HASHES = Object.freeze({
  source: `sha256:${'1'.repeat(64)}`,
  blueprint: `sha256:${'2'.repeat(64)}`,
  assets: `sha256:${'3'.repeat(64)}`,
  tiles: `sha256:${'4'.repeat(64)}`,
  compiler: `sha256:${'5'.repeat(64)}`,
  validator: `sha256:${'6'.repeat(64)}`,
  surface: `sha256:${'7'.repeat(64)}`
});

function coord(x, y) {
  return { x, y };
}

function surfaceAsset() {
  return {
    assetBundleId: 'fixture-assets',
    key: 'surface:grass',
    contentVersion: 1,
    contentHash: HASHES.surface,
    immutableUrl: '/assets/battle-map-v3/fixture-assets/v1/surface-grass.webp'
  };
}

export function createMinimalBattleMapV3CandidateFixture() {
  const width = 8;
  const height = 8;
  const playerSlots = Array.from({ length: 5 }, (_, index) => ({
    id: `player:${index + 1}`,
    cell: coord(1, index + 1),
    role: 'formation',
    tags: ['player']
  }));
  const opponentCandidates = Array.from({ length: 7 }, (_, index) => ({
    id: `opponent:${index + 1}`,
    cell: coord(6, index),
    tags: ['opponent'],
    zoneId: 'zone:opponent',
    minimumClearance: 0,
    tacticalAnnotationIds: []
  }));
  return {
    battleMapSchemaVersion: 3,
    terrainGenerationVersion: 3,
    contentId: 'fixture:map',
    contentVersion: 1,
    templateId: 'fixture:template',
    templateRevision: 1,
    theme: 'forest',
    renderProfileId: 'fixture:forest',
    tierEligibility: ['default'],
    supportedModes: ['pve'],
    dimensions: { width, height },
    provenance: {
      sourceSidecar: { id: 'fixture:source', version: 1, fullHash: HASHES.source },
      approvedBlueprint: { id: 'fixture:blueprint', version: 1, fullHash: HASHES.blueprint },
      assetBundle: { id: 'fixture-assets', version: 1, manifestFullHash: HASHES.assets },
      tileCatalog: { id: 'fixture:tiles', version: 1, fullHash: HASHES.tiles },
      compiler: { id: 'fixture:compiler', version: 1, fullHash: HASHES.compiler },
      validator: { id: 'fixture:validator', version: 1, fullHash: HASHES.validator }
    },
    renderMask: Array.from({ length: height }, () => Array(width).fill(true)),
    playableMask: Array.from({ length: height }, () => Array(width).fill(true)),
    terrain: Array.from({ length: height }, () => Array.from({ length: width }, () => ({
      material: 'grass',
      passable: true,
      movementCost: 1,
      featureId: 'feature:field'
    }))),
    elevation: Array.from({ length: height }, () => Array(width).fill(0)),
    elevationConnections: [],
    visualCells: Array.from({ length: height }, () => Array.from({ length: width }, () => ({
      surface: surfaceAsset(),
      overlays: []
    }))),
    obstacles: [],
    decorations: [],
    boundaries: [],
    routes: [],
    features: [{
      id: 'feature:field',
      kind: 'biome-region',
      cells: [coord(0, 0)],
      ownerFeatureId: null,
      annotations: ['fixture']
    }],
    spawnContract: {
      capacities: {
        playerCapacity: 5,
        candidatePoolSize: 7,
        maxAssignableOpponents: 7
      },
      formationFacing: { player: 'e', opponent: 'w' },
      playerSlots,
      opponentCandidates,
      opponentZones: [{
        id: 'zone:opponent',
        cells: opponentCandidates.map(candidate => candidate.cell),
        tags: ['opponent'],
        capacity: 7
      }],
      protectedClearances: [],
      exits: [{
        id: 'exit:player',
        side: 'player',
        cell: coord(2, 3),
        approachRegionId: 'approach:player'
      }, {
        id: 'exit:opponent',
        side: 'opponent',
        cell: coord(5, 3),
        approachRegionId: 'approach:opponent'
      }],
      approachRegions: [{
        id: 'approach:player',
        side: 'player',
        cells: [coord(2, 3)]
      }, {
        id: 'approach:opponent',
        side: 'opponent',
        cells: [coord(5, 3)]
      }],
      minimumRouteConstraints: {
        minimumIndependentExits: 1,
        requireMutualReachability: true,
        maximumTraversableElevationDelta: 1
      },
      tacticalAnnotations: []
    },
    hashVersion: 'sha256-cjson-v1'
  };
}

export async function createMinimalBattleMapV3FinalFixture() {
  return finalizeBattleMapV3(createMinimalBattleMapV3CandidateFixture());
}
