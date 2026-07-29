import { deepFreeze } from './V2Context.js';

export const V2_RECIPE_SCHEMA_VERSION = 'battle-map-v2-recipes-v1';
export const V2_RENDER_CAPABILITY_VERSION = 'battle-map-v2-assets-v1';

const MATERIALS = Object.freeze({
  forest: ['grass', 'forest', 'dirt', 'stone', 'rock', 'water'],
  cave: ['stone', 'rock', 'dirt', 'water'],
  mountain: ['stone', 'rock', 'grass', 'cliff', 'water', 'lava'],
  bridge: ['stone', 'dirt', 'grass', 'water'],
  castle: ['stone', 'dirt', 'grass', 'water']
});

const BASE_RECIPES = {
  forest: {
    biome: 'forest',
    archetype: 'woodland-clearings',
    family: 'natural',
    renderPalette: 'forest',
    baseMaterial: 'grass',
    relief: 'rolling',
    waterKind: 'stream',
    obstacleFamilies: ['tree', 'rock'],
    decorationFamilies: ['ground-cover', 'leaf-litter'],
    routeMaterial: 'dirt'
  },
  cave: {
    biome: 'cave',
    archetype: 'connected-caverns',
    family: 'subterranean',
    renderPalette: 'cave',
    baseMaterial: 'stone',
    relief: 'basin',
    waterKind: 'pools',
    obstacleFamilies: ['rock'],
    decorationFamilies: ['mushroom', 'crystal'],
    routeMaterial: 'dirt'
  },
  mountain: {
    biome: 'mountain',
    archetype: 'ridges-and-passes',
    family: 'natural',
    renderPalette: 'mountain',
    baseMaterial: 'stone',
    relief: 'ridged',
    waterKind: 'drainage',
    obstacleFamilies: ['rock'],
    decorationFamilies: ['talus', 'scrub'],
    routeMaterial: 'dirt'
  },
  bridge: {
    biome: 'bridge',
    archetype: 'crossing',
    family: 'constructed',
    renderPalette: 'bridge',
    baseMaterial: 'grass',
    relief: 'river-valley',
    waterKind: 'river',
    obstacleFamilies: ['rock'],
    decorationFamilies: ['reeds', 'debris'],
    routeMaterial: 'stone'
  },
  castle: {
    biome: 'castle',
    archetype: 'courtyard-and-approaches',
    family: 'constructed',
    renderPalette: 'castle',
    baseMaterial: 'stone',
    relief: 'terraced',
    waterKind: 'none',
    obstacleFamilies: ['rock'],
    decorationFamilies: ['rubble', 'moss'],
    routeMaterial: 'stone'
  },
  dungeon: {
    biome: 'dungeon',
    archetype: 'rooms-and-passages',
    family: 'constructed',
    renderPalette: 'castle',
    baseMaterial: 'stone',
    relief: 'flat',
    waterKind: 'pools',
    obstacleFamilies: ['rock'],
    decorationFamilies: ['rubble', 'moss'],
    routeMaterial: 'stone'
  },
  swamp: {
    biome: 'swamp',
    archetype: 'wetland-islands',
    family: 'natural',
    renderPalette: 'forest',
    baseMaterial: 'grass',
    relief: 'lowland',
    waterKind: 'wetland',
    obstacleFamilies: ['tree', 'rock'],
    decorationFamilies: ['reeds', 'ground-cover'],
    routeMaterial: 'dirt'
  },
  volcano: {
    biome: 'volcano',
    archetype: 'lava-drainage',
    family: 'natural',
    renderPalette: 'mountain',
    baseMaterial: 'stone',
    relief: 'ridged',
    waterKind: 'lava',
    obstacleFamilies: ['rock'],
    decorationFamilies: ['ash', 'talus'],
    routeMaterial: 'rock'
  },
  plains: {
    biome: 'plains',
    archetype: 'rolling-grassland',
    family: 'natural',
    renderPalette: 'forest',
    baseMaterial: 'grass',
    relief: 'rolling',
    waterKind: 'stream',
    obstacleFamilies: ['tree', 'rock'],
    decorationFamilies: ['ground-cover'],
    routeMaterial: 'dirt'
  },
  arena: {
    biome: 'arena',
    archetype: 'balanced-arena',
    family: 'arena',
    renderPalette: 'castle',
    baseMaterial: 'stone',
    relief: 'flat',
    waterKind: 'none',
    obstacleFamilies: ['rock'],
    decorationFamilies: ['rubble'],
    routeMaterial: 'stone'
  },
  guild: {
    biome: 'guild',
    archetype: 'guild-proving-ground',
    family: 'arena',
    renderPalette: 'castle',
    baseMaterial: 'stone',
    relief: 'terraced',
    waterKind: 'none',
    obstacleFamilies: ['rock'],
    decorationFamilies: ['rubble', 'moss'],
    routeMaterial: 'stone'
  },
  elven_grove: {
    biome: 'elven_grove',
    archetype: 'sacred-grove',
    family: 'natural',
    renderPalette: 'forest',
    baseMaterial: 'grass',
    relief: 'rolling',
    waterKind: 'stream',
    obstacleFamilies: ['tree', 'rock'],
    decorationFamilies: ['ground-cover', 'leaf-litter'],
    routeMaterial: 'dirt'
  },
  dwarven_mine: {
    biome: 'dwarven_mine',
    archetype: 'excavated-caverns',
    family: 'subterranean',
    renderPalette: 'cave',
    baseMaterial: 'stone',
    relief: 'terraced',
    waterKind: 'pools',
    obstacleFamilies: ['rock'],
    decorationFamilies: ['crystal', 'rubble'],
    routeMaterial: 'dirt'
  },
  vampiric_crypt: {
    biome: 'vampiric_crypt',
    archetype: 'crypt-chambers',
    family: 'constructed',
    renderPalette: 'castle',
    baseMaterial: 'stone',
    relief: 'flat',
    waterKind: 'pools',
    obstacleFamilies: ['rock'],
    decorationFamilies: ['rubble', 'moss'],
    routeMaterial: 'stone'
  },
  orcish_warcamp: {
    biome: 'orcish_warcamp',
    archetype: 'broken-warcamp',
    family: 'constructed',
    renderPalette: 'mountain',
    baseMaterial: 'dirt',
    relief: 'rolling',
    waterKind: 'none',
    obstacleFamilies: ['rock'],
    decorationFamilies: ['ash', 'debris'],
    routeMaterial: 'dirt'
  },
  human_ruins: {
    biome: 'human_ruins',
    archetype: 'overgrown-ruins',
    family: 'constructed',
    renderPalette: 'castle',
    baseMaterial: 'stone',
    relief: 'terraced',
    waterKind: 'none',
    obstacleFamilies: ['rock'],
    decorationFamilies: ['rubble', 'moss'],
    routeMaterial: 'dirt'
  }
};

function naturalParameters(recipe) {
  const isConstructed = recipe.family === 'constructed' || recipe.family === 'arena';
  const hasHydrology = recipe.waterKind !== 'none';
  const hasClosedBasins = recipe.waterKind === 'pools' || recipe.waterKind === 'wetland';
  const isWetland = recipe.waterKind === 'wetland';
  const isLava = recipe.waterKind === 'lava';
  return {
    fields: {
      baseFrequency: isConstructed ? 82000 : 61000,
      octaves: isConstructed ? 3 : 4,
      persistence: isConstructed ? 430000 : 520000,
      warpStrength: isConstructed ? 90000 : 210000,
      ridgeStrength: recipe.relief === 'ridged' ? 620000 : 180000
    },
    regions: {
      minimumRegionArea: isConstructed ? 3 : 6,
      materialBandCount: isConstructed ? 3 : 4
    },
    hydrology: {
      enabled: hasHydrology,
      kind: recipe.waterKind,
      material: isLava ? 'lava' : 'water',
      maximumCoverage: recipe.waterKind === 'wetland' ? 360000 : 190000,
      minimumContributingArea: recipe.waterKind === 'river' ? 12 : 24,
      sourceCountByProfile: {
        compact: hasHydrology && !hasClosedBasins ? 1 : 0,
        standard: recipe.waterKind === 'wetland' ? 3 : (hasHydrology ? 2 : 0),
        large: recipe.waterKind === 'wetland' ? 5 : (hasHydrology ? 3 : 0)
      },
      maximumChannelWidthByProfile: {
        compact: 1,
        standard: recipe.waterKind === 'river' ? 3 : 2,
        large: recipe.waterKind === 'river' || recipe.waterKind === 'wetland' ? 4 : 3
      },
      retainedBasinAreaByProfile: {
        compact: hasClosedBasins ? (isWetland ? 12 : 6) : 0,
        standard: hasClosedBasins ? (isWetland ? 32 : 8) : 0,
        large: hasClosedBasins ? (isWetland ? 56 : 14) : 0
      },
      wetnessRadiusByProfile: {
        compact: 1,
        standard: recipe.waterKind === 'wetland' ? 3 : 2,
        large: recipe.waterKind === 'wetland' ? 4 : 3
      },
      outletPolicy: hasClosedBasins ? 'intentional-basin-or-edge' : 'edge',
      basinPolicy: hasClosedBasins ? 'retain-ranked-basins' : 'condition-all-sinks',
      maximumAxisRun: isConstructed ? 10 : 7,
      maximumWidthJump: 1
    },
    routes: {
      required: true,
      width: recipe.family === 'arena' ? 3 : 2,
      maximumSlope: recipe.relief === 'flat' ? 0 : 1,
      wanderStrength: isConstructed ? 90000 : 310000
    },
    ecology: {
      blockingDensity: recipe.family === 'arena'
        ? 25000
        : isWetland ? 25000 : 105000,
      decorationDensity: recipe.family === 'arena' ? 50000 : 180000,
      minimumBlockerSpacing: recipe.family === 'subterranean' ? 2 : 3
    },
    quality: {
      minimumHydrologyCoverageByProfile: {
        compact: 0,
        standard: isWetland ? 25_000 : 0,
        large: isWetland ? 35_000 : 0
      },
      minimumBlockingObstacleCountByProfile: {
        compact: 0,
        standard: isWetland ? 2 : 0,
        large: isWetland ? 4 : 0
      }
    },
    tactical: {
      minimumUsableArea: recipe.family === 'subterranean' ? 480000 : 600000,
      minimumDisjointRoutes: recipe.family === 'arena' ? 3 : 2,
      maximumDetour: recipe.family === 'subterranean' ? 2600000 : 2100000,
      minimumRouteClearance: recipe.family === 'subterranean' ? 1 : 2,
      competitiveParityTolerance: recipe.family === 'arena' ? 120000 : 250000
    }
  };
}

function capabilityRequirements(recipe) {
  const palette = recipe.renderPalette;
  return {
    capabilityVersion: V2_RENDER_CAPABILITY_VERSION,
    palette,
    floors: MATERIALS[palette].map(material => `${palette}:floor:${material}`),
    exposedFaces: [`${palette}:face:stone`],
    connections: [
      `${palette}:connection:slope:n:1`,
      `${palette}:connection:slope:e:1`,
      `${palette}:connection:slope:s:1`,
      `${palette}:connection:slope:w:1`
    ],
    transitions: [
      `${palette}:transition:terrain-edge`,
      `${palette}:transition:route-edge`,
      `${palette}:transition:cliff`
    ],
    obstacles: recipe.obstacleFamilies.map(kind => `${palette}:obstacle-family:${kind}`),
    decorations: recipe.decorationFamilies.map(
      kind => `${palette}:decoration-family:${kind}`
    )
  };
}

export const V2_PRODUCTION_NODE_TYPES = Object.freeze(Object.keys(BASE_RECIPES));

export const V2_RECIPES = deepFreeze(Object.fromEntries(
  Object.entries(BASE_RECIPES).map(([nodeType, recipe]) => [
    nodeType,
    {
      schemaVersion: V2_RECIPE_SCHEMA_VERSION,
      nodeType,
      ...recipe,
      ...naturalParameters(recipe),
      renderRequirements: capabilityRequirements(recipe),
      supportedModes: recipe.family === 'arena'
        ? ['pve', 'guild', 'pvp', 'pvp_coliseum', 'pve_coop']
        : ['pve', 'guild', 'pve_coop'],
      supportedDimensions: {
        minimumWidth: 10,
        minimumHeight: 10,
        maximumWidth: 64,
        maximumHeight: 64
      },
      degradationOrder: [
        'reduce-optional-decoration-density',
        'reduce-optional-water-bodies',
        'reduce-optional-clearings',
        'reduce-route-width',
        'reduce-protected-core-radius'
      ]
    }
  ])
));

export class UnsupportedV2RecipeError extends RangeError {
  constructor(nodeType) {
    super(`Unsupported V2 battle-map node type: ${String(nodeType)}`);
    this.name = 'UnsupportedV2RecipeError';
    this.code = 'UNSUPPORTED_V2_NODE_TYPE';
    this.nodeType = nodeType;
  }
}

export function getV2Recipe(nodeType) {
  if (typeof nodeType !== 'string' || !Object.hasOwn(V2_RECIPES, nodeType)) {
    throw new UnsupportedV2RecipeError(nodeType);
  }
  return V2_RECIPES[nodeType];
}
