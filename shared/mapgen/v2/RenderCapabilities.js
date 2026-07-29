import {
  V2_PRODUCTION_NODE_TYPES,
  V2_RECIPES,
  getV2Recipe
} from './RecipeRegistry.js';
import { REQUIRED_VISUAL_COMPOSITIONS } from './VisualLayers.js';
import { deepFreeze } from './V2Context.js';

export const V2_RENDER_CAPABILITY_CATALOG_VERSION =
  'battle-map-v2-render-capabilities-v1';

const PALETTES = Object.freeze([
  'bridge',
  'castle',
  'cave',
  'forest',
  'mountain'
]);
const TRANSITION_CAPABILITIES = deepFreeze({
  material_edge: {
    assetName: 'terrain-edge',
    anchor: 'tile_top',
    stratum: 10,
    precedence: 10
  },
  shore: {
    assetName: 'shore',
    anchor: 'tile_top',
    stratum: 20,
    precedence: 10
  },
  bank: {
    assetName: 'bank',
    anchor: 'tile_top',
    stratum: 20,
    precedence: 20
  },
  wetness: {
    assetName: 'wetness',
    anchor: 'tile_top',
    stratum: 20,
    precedence: 30
  },
  route_edge: {
    assetName: 'route-edge',
    anchor: 'tile_top',
    stratum: 30,
    precedence: 10
  },
  route_shoulder: {
    assetName: 'route-shoulder',
    anchor: 'tile_top',
    stratum: 30,
    precedence: 20
  },
  route_center: {
    assetName: 'route-center',
    anchor: 'tile_top',
    stratum: 30,
    precedence: 30
  },
  cliff: {
    assetName: 'cliff',
    anchor: 'exposed_face',
    stratum: 40,
    precedence: 10
  },
  slope: {
    assetName: 'slope',
    anchor: 'above_connection',
    stratum: 50,
    precedence: 10
  },
  stairs: {
    assetName: 'stairs',
    anchor: 'above_connection',
    stratum: 50,
    precedence: 20
  }
});
const DIRECTIONS = Object.freeze({
  n: 'north',
  e: 'east',
  s: 'south',
  w: 'west'
});
const OBSTACLE_PATHS = deepFreeze({
  rock: [
    '/assets/obstacles/rocks/mountain_boulder.webp',
    '/assets/obstacles/rocks/rock_large.webp',
    '/assets/obstacles/rocks/rock_medium.webp',
    '/assets/obstacles/rocks/rock_small.webp',
    '/assets/obstacles/rocks/stalagmite.webp'
  ],
  tree: [
    '/assets/obstacles/trees/dead_tree.webp',
    '/assets/obstacles/trees/mountain_pine.webp',
    '/assets/obstacles/trees/mushroom_large.webp',
    '/assets/obstacles/trees/oak_tree.webp',
    '/assets/obstacles/trees/pine_tree.webp'
  ]
});

function immutableSet(values) {
  const target = new Set(values);
  const rejectMutation = () => {
    throw new TypeError('V2 render capability catalog is immutable');
  };
  const facade = new Proxy(target, {
    get(set, property) {
      if (property === 'add' || property === 'delete' || property === 'clear') {
        return rejectMutation;
      }
      if (property === 'size') return set.size;
      if (property === 'has') return value => set.has(value);
      if (property === Symbol.iterator) {
        return () => set[Symbol.iterator]();
      }
      if (property === 'entries' || property === 'keys' ||
          property === 'values') {
        return () => set[property]();
      }
      if (property === 'forEach') {
        return (callback, thisArg) => set.forEach((value, key) =>
          callback.call(thisArg, value, key, facade)
        );
      }
      if (property === 'valueOf') return () => facade;
      return Reflect.get(set, property, facade);
    },
    defineProperty: () => false,
    deleteProperty: () => false,
    set: () => false
  });
  return Object.freeze(facade);
}

function recipeMaterials(recipe) {
  return [...new Set([
    ...recipe.renderRequirements.floors
      .map(key => key.split(':').at(-1)),
    recipe.baseMaterial,
    recipe.routeMaterial,
    recipe.hydrology.material
  ])].sort();
}

function paletteProfiles() {
  const profiles = new Map(PALETTES.map(palette => [
    palette,
    { materials: new Set(), obstacles: new Set(), decorations: new Set() }
  ]));
  for (const nodeType of V2_PRODUCTION_NODE_TYPES) {
    const recipe = getV2Recipe(nodeType);
    const profile = profiles.get(recipe.renderPalette);
    recipeMaterials(recipe).forEach(material => profile.materials.add(material));
    recipe.obstacleFamilies.forEach(family => profile.obstacles.add(family));
    recipe.decorationFamilies.forEach(family => profile.decorations.add(family));
  }
  return profiles;
}

function descriptor({
  assetKey,
  palette,
  capabilityKind,
  semantic,
  source,
  renderer,
  resourcePaths = []
}) {
  return deepFreeze({
    assetKey,
    palette,
    capabilityKind,
    semantic,
    source,
    renderer,
    resourcePaths: [...resourcePaths].sort()
  });
}

function buildDescriptors() {
  const profiles = paletteProfiles();
  const values = [];
  for (const palette of PALETTES) {
    const profile = profiles.get(palette);
    for (const material of [...profile.materials].sort()) {
      const key = `${palette}:floor:${material}`;
      if (material === 'dirt') {
        values.push(descriptor({
          assetKey: key,
          palette,
          capabilityKind: 'floor',
          semantic: material,
          source: 'code-native-surface',
          renderer: 'terrain-floor'
        }));
      } else {
        values.push(descriptor({
          assetKey: key,
          palette,
          capabilityKind: 'floor',
          semantic: material,
          source: 'authored-sprite',
          renderer: 'terrain-floor',
          resourcePaths: Array.from(
            { length: 4 },
            (_, variant) =>
              `/assets/sprites/terrain/${palette}/${material}_${variant}.webp`
          )
        }));
      }
    }
    values.push(descriptor({
      assetKey: `${palette}:face:stone`,
      palette,
      capabilityKind: 'face',
      semantic: 'stone',
      source: 'authored-sprite',
      renderer: 'exposed-face',
      resourcePaths: [
        `/assets/sprites/terrain/${palette}/wall_${palette}_stone.webp`
      ]
    }));
    for (const [direction, assetDirection] of Object.entries(DIRECTIONS)) {
      values.push(descriptor({
        assetKey: `${palette}:connection:slope:${direction}:1`,
        palette,
        capabilityKind: 'connection',
        semantic: `slope:${direction}:1`,
        source: 'authored-sprite',
        renderer: 'elevation-connection',
        resourcePaths: [
          `/assets/sprites/terrain/${palette}/` +
          `slope_${palette}_${assetDirection}_1.webp`
        ]
      }));
      values.push(descriptor({
        assetKey: `${palette}:connection:stairs:${direction}:2`,
        palette,
        capabilityKind: 'connection',
        semantic: `stairs:${direction}:2`,
        source: 'authored-sprite',
        renderer: 'elevation-connection',
        resourcePaths: [
          `/assets/sprites/terrain/${palette}/` +
          `stairs_${palette}_${assetDirection}_2.webp`
        ]
      }));
    }
    for (const transition of new Set([
      'terrain-edge',
      ...Object.values(TRANSITION_CAPABILITIES)
        .map(capability => capability.assetName)
    ])) {
      values.push(descriptor({
        assetKey: `${palette}:transition:${transition}`,
        palette,
        capabilityKind: 'transition',
        semantic: transition,
        source: 'code-native-overlay',
        renderer: 'semantic-transition'
      }));
    }
    for (const family of [...profile.obstacles].sort()) {
      values.push(descriptor({
        assetKey: `${palette}:obstacle-family:${family}`,
        palette,
        capabilityKind: 'obstacle',
        semantic: family,
        source: 'authored-sprite-family',
        renderer: 'obstacle-family',
        resourcePaths: OBSTACLE_PATHS[family]
      }));
    }
    for (const family of [...profile.decorations].sort()) {
      values.push(descriptor({
        assetKey: `${palette}:decoration-family:${family}`,
        palette,
        capabilityKind: 'decoration',
        semantic: family,
        source: 'code-native-overlay',
        renderer: 'nonblocking-decoration'
      }));
    }
  }
  return values.sort((left, right) =>
    left.assetKey.localeCompare(right.assetKey)
  );
}

const ASSET_DESCRIPTORS = deepFreeze(buildDescriptors());
const ASSET_DESCRIPTOR_BY_KEY = new Map(
  ASSET_DESCRIPTORS.map(value => [value.assetKey, value])
);

/**
 * Strict capability Set consumed directly by compileFeasibilityProfile.
 * Mutation methods throw; there is no default or cross-palette resolution.
 */
export const V2_RENDER_CAPABILITY_CATALOG = immutableSet(
  ASSET_DESCRIPTORS.map(value => value.assetKey)
);

function resolveRecipe(recipeOrPalette) {
  if (typeof recipeOrPalette === 'string') {
    if (PALETTES.includes(recipeOrPalette)) {
      return deepFreeze({
        renderPalette: recipeOrPalette,
        decorationFamilies: [
          ...paletteProfiles().get(recipeOrPalette).decorations
        ].sort()
      });
    }
    if (Object.hasOwn(V2_RECIPES, recipeOrPalette)) {
      return getV2Recipe(recipeOrPalette);
    }
    throw new RangeError(
      `Unknown V2 recipe or render palette: ${recipeOrPalette}`
    );
  }
  if (!recipeOrPalette || typeof recipeOrPalette !== 'object' ||
      typeof recipeOrPalette.nodeType !== 'string') {
    throw new TypeError(
      'V2 visual capabilities require a canonical recipe or known render palette'
    );
  }
  const recipe = getV2Recipe(recipeOrPalette.nodeType);
  if (recipeOrPalette.renderPalette !== undefined &&
      recipeOrPalette.renderPalette !== recipe.renderPalette) {
    throw new RangeError(
      `Recipe ${recipe.nodeType} does not use palette ` +
      `${String(recipeOrPalette.renderPalette)}`
    );
  }
  return recipe;
}

function requireKnownFamilies(recipe, profile) {
  for (const family of recipe.decorationFamilies) {
    if (!profile.decorations.has(family)) {
      throw new RangeError(
        `Decoration family ${family} is unavailable for ${recipe.renderPalette}`
      );
    }
  }
}

/**
 * Compile the exact frozen object accepted by generateVisualLayers.
 */
export function getV2VisualCapabilities(recipeOrPalette) {
  const recipe = resolveRecipe(recipeOrPalette);
  const palette = recipe.renderPalette;
  const profile = paletteProfiles().get(palette);
  requireKnownFamilies(recipe, profile);
  const variants = {};
  for (const material of [...profile.materials].sort()) {
    const authored = material !== 'dirt';
    variants[material] = {
      count: authored ? 4 : 1,
      maximumFraction: authored ? 600_000 : 1_000_000
    };
  }
  const transitions = {};
  for (const [kind, capability] of Object.entries(TRANSITION_CAPABILITIES)) {
    transitions[kind] = {
      assetKey: `${palette}:transition:${capability.assetName}`,
      anchor: capability.anchor,
      stratum: capability.stratum,
      precedence: capability.precedence
    };
  }
  const decorations = {};
  for (const family of [...new Set(recipe.decorationFamilies)].sort()) {
    decorations[family] = {
      assetKey: `${palette}:decoration-family:${family}`,
      variantCount: 4,
      anchor: 'tile_top'
    };
  }
  const result = deepFreeze({
    palette,
    variants,
    transitions,
    decorations,
    compositions: REQUIRED_VISUAL_COMPOSITIONS.map(value => ({ ...value }))
  });
  for (const capability of [
    ...Object.values(result.transitions),
    ...Object.values(result.decorations)
  ]) {
    assertV2AssetCapability(capability.assetKey);
  }
  return result;
}

/**
 * Resolve one capability exactly. Unknown and cross-palette keys fail closed.
 */
export function assertV2AssetCapability(assetKey) {
  if (typeof assetKey !== 'string' || !ASSET_DESCRIPTOR_BY_KEY.has(assetKey)) {
    throw new RangeError(`Unknown V2 render asset capability: ${String(assetKey)}`);
  }
  return ASSET_DESCRIPTOR_BY_KEY.get(assetKey);
}

function scopedKeys(recipeOrPalette) {
  if (recipeOrPalette === undefined || recipeOrPalette === null) {
    return [...V2_RENDER_CAPABILITY_CATALOG].sort();
  }
  const recipe = resolveRecipe(recipeOrPalette);
  const prefix = `${recipe.renderPalette}:`;
  if (typeof recipeOrPalette === 'string' &&
      PALETTES.includes(recipeOrPalette)) {
    return [...V2_RENDER_CAPABILITY_CATALOG]
      .filter(key => key.startsWith(prefix))
      .sort();
  }
  const visual = getV2VisualCapabilities(recipe);
  return [...new Set([
    ...(recipe.renderRequirements
      ? Object.values(recipe.renderRequirements)
        .filter(Array.isArray)
        .flat()
      : []),
    ...Object.keys(visual.variants)
      .map(material => `${recipe.renderPalette}:floor:${material}`),
    ...Object.keys(DIRECTIONS).flatMap(direction => [
      `${recipe.renderPalette}:connection:slope:${direction}:1`,
      `${recipe.renderPalette}:connection:stairs:${direction}:2`
    ]),
    ...Object.values(visual.transitions).map(value => value.assetKey),
    ...Object.values(visual.decorations).map(value => value.assetKey)
  ])].sort();
}

export function listV2AssetCapabilities(recipeOrPalette) {
  return deepFreeze(
    scopedKeys(recipeOrPalette).map(assertV2AssetCapability)
  );
}

/**
 * Audit authored resources only. Code-native surfaces and overlays are
 * resolved directly by the renderer and never request a bitmap.
 */
export function auditV2AuthoredAssets(availableResourcePaths, recipeOrPalette) {
  if (!availableResourcePaths ||
      typeof availableResourcePaths[Symbol.iterator] !== 'function') {
    throw new TypeError('availableResourcePaths must be an iterable');
  }
  const available = new Set(availableResourcePaths);
  const capabilities = listV2AssetCapabilities(recipeOrPalette);
  const authoredResourcePaths = [...new Set(
    capabilities
      .filter(value => value.source.startsWith('authored-sprite'))
      .flatMap(value => value.resourcePaths)
  )].sort();
  const codeNativeAssetKeys = capabilities
    .filter(value => value.source.startsWith('code-native'))
    .map(value => value.assetKey)
    .sort();
  const missingAuthoredResourcePaths = authoredResourcePaths
    .filter(path => !available.has(path));
  return deepFreeze({
    valid: missingAuthoredResourcePaths.length === 0,
    authoredResourcePaths,
    codeNativeAssetKeys,
    missingAuthoredResourcePaths
  });
}
