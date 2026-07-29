import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { compileFeasibilityProfile } from './Feasibility.js';
import {
  V2_PRODUCTION_NODE_TYPES,
  V2_RECIPES,
  getV2Recipe
} from './RecipeRegistry.js';
import {
  V2_RENDER_CAPABILITY_CATALOG,
  assertV2AssetCapability,
  auditV2AuthoredAssets,
  getV2VisualCapabilities,
  listV2AssetCapabilities
} from './RenderCapabilities.js';
import { REQUIRED_VISUAL_COMPOSITIONS } from './VisualLayers.js';

const TRANSITION_KINDS = [
  'bank',
  'cliff',
  'material_edge',
  'route_center',
  'route_edge',
  'route_shoulder',
  'shore',
  'slope',
  'stairs',
  'wetness'
];
const REPOSITORY_ROOT = new URL('../../../', import.meta.url);

function publicResourceExists(resourcePath) {
  return existsSync(new URL(`frontend/public${resourcePath}`, REPOSITORY_ROOT));
}

function paletteMaterials(palette) {
  return [...new Set(
    Object.values(V2_RECIPES)
      .filter(recipe => recipe.renderPalette === palette)
      .flatMap(recipe => [
        ...recipe.renderRequirements.floors
          .map(key => key.split(':').at(-1)),
        recipe.baseMaterial,
        recipe.routeMaterial,
        recipe.hydrology.material
      ])
  )].sort();
}

test('immutable catalog satisfies exact feasibility requirements for every recipe', () => {
  const required = new Set();
  for (const nodeType of V2_PRODUCTION_NODE_TYPES) {
    const recipe = getV2Recipe(nodeType);
    Object.values(recipe.renderRequirements)
      .filter(Array.isArray)
      .flat()
      .forEach(key => required.add(key));
    const feasibility = compileFeasibilityProfile({
      nodeType,
      mode: 'pve',
      mapWidth: 20,
      mapHeight: 20,
      playerCount: 5,
      enemyCapacity: 6
    }, { capabilityCatalog: V2_RENDER_CAPABILITY_CATALOG });
    assert.deepEqual(feasibility.missingCapabilityKeys, []);
  }

  for (const key of required) {
    assert.equal(V2_RENDER_CAPABILITY_CATALOG.has(key), true, key);
  }
  assert.equal(Object.isFrozen(V2_RENDER_CAPABILITY_CATALOG), true);
  assert.throws(
    () => V2_RENDER_CAPABILITY_CATALOG.add('forest:floor:unknown'),
    /immutable/
  );
  assert.throws(
    () => V2_RENDER_CAPABILITY_CATALOG.delete([...required][0]),
    /immutable/
  );
  assert.throws(() => V2_RENDER_CAPABILITY_CATALOG.clear(), /immutable/);
  let callbackSet;
  V2_RENDER_CAPABILITY_CATALOG.forEach((_value, _key, set) => {
    callbackSet = set;
  });
  assert.equal(callbackSet, V2_RENDER_CAPABILITY_CATALOG);
  assert.throws(
    () => callbackSet.add('forest:floor:injected'),
    /immutable/
  );
  assert.equal(
    V2_RENDER_CAPABILITY_CATALOG.has('forest:floor:injected'),
    false
  );
  const value = V2_RENDER_CAPABILITY_CATALOG.valueOf();
  assert.equal(value, V2_RENDER_CAPABILITY_CATALOG);
  assert.throws(
    () => value.add('forest:floor:valueof-injected'),
    /immutable/
  );
  assert.equal(
    V2_RENDER_CAPABILITY_CATALOG.has('forest:floor:valueof-injected'),
    false
  );
});

test('visual capabilities are complete, immutable, and deterministic for every recipe', () => {
  for (const nodeType of V2_PRODUCTION_NODE_TYPES) {
    const recipe = getV2Recipe(nodeType);
    const first = getV2VisualCapabilities(recipe);
    const second = getV2VisualCapabilities(recipe);
    const materials = paletteMaterials(recipe.renderPalette);

    assert.deepEqual(second, first);
    assert.equal(first.palette, recipe.renderPalette);
    assert.deepEqual(Object.keys(first.variants).sort(), materials);
    assert.deepEqual(Object.keys(first.transitions).sort(), TRANSITION_KINDS);
    assert.deepEqual(
      Object.keys(first.decorations).sort(),
      [...new Set(recipe.decorationFamilies)].sort()
    );
    assert.deepEqual(first.compositions, REQUIRED_VISUAL_COMPOSITIONS);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.variants), true);
    assert.equal(Object.isFrozen(first.transitions.shore), true);
    assert.equal(Object.isFrozen(first.compositions[0]), true);
    assert.throws(() => {
      first.palette = 'forest';
    }, TypeError);
  }
});

test('palette capability requests include all recipe decoration families', () => {
  const palettes = new Set(
    Object.values(V2_RECIPES).map(recipe => recipe.renderPalette)
  );
  for (const palette of palettes) {
    const expectedFamilies = [...new Set(
      Object.values(V2_RECIPES)
        .filter(recipe => recipe.renderPalette === palette)
        .flatMap(recipe => recipe.decorationFamilies)
    )].sort();
    const first = getV2VisualCapabilities(palette);
    const second = getV2VisualCapabilities(palette);
    assert.deepEqual(first, second);
    assert.deepEqual(Object.keys(first.decorations).sort(), expectedFamilies);
  }
  assert.throws(
    () => getV2VisualCapabilities({
      renderPalette: 'forest',
      decorationFamilies: []
    }),
    /canonical recipe/
  );
  assert.throws(
    () => getV2VisualCapabilities({
      nodeType: 'forest',
      renderPalette: 'cave'
    }),
    /does not use palette/
  );
});

test('every emitted asset key resolves without transition or decoration bitmaps', () => {
  const emittedKeys = new Set();
  for (const recipe of Object.values(V2_RECIPES)) {
    const visual = getV2VisualCapabilities(recipe);
    Object.values(visual.transitions).forEach(value =>
      emittedKeys.add(value.assetKey)
    );
    Object.values(visual.decorations).forEach(value =>
      emittedKeys.add(value.assetKey)
    );
  }

  for (const assetKey of emittedKeys) {
    const descriptor = assertV2AssetCapability(assetKey);
    assert.equal(descriptor.source, 'code-native-overlay');
    assert.deepEqual(descriptor.resourcePaths, []);
    assert.equal(V2_RENDER_CAPABILITY_CATALOG.has(assetKey), true);
    assert.doesNotMatch(assetKey, /fallback|default/i);
  }
  assert.throws(
    () => assertV2AssetCapability('forest:transition:unknown'),
    /Unknown V2 render asset capability/
  );
});

test('authored sprites resolve to existing exact paths and dirt is code-native', () => {
  const descriptors = listV2AssetCapabilities();
  for (const value of descriptors) {
    if (!value.source.startsWith('authored-sprite')) continue;
    assert.ok(value.resourcePaths.length > 0, value.assetKey);
    value.resourcePaths.forEach(path =>
      assert.equal(publicResourceExists(path), true, `${value.assetKey}: ${path}`)
    );
  }
  for (const palette of ['bridge', 'castle', 'cave', 'forest', 'mountain']) {
    const visual = getV2VisualCapabilities(palette);
    if (Object.hasOwn(visual.variants, 'dirt')) {
      const dirt = assertV2AssetCapability(`${palette}:floor:dirt`);
      assert.equal(dirt.source, 'code-native-surface');
      assert.deepEqual(dirt.resourcePaths, []);
      assert.equal(visual.variants.dirt.count, 1);
    }
    for (const direction of ['n', 'e', 's', 'w']) {
      const assetDirection = {
        n: 'north',
        e: 'east',
        s: 'south',
        w: 'west'
      }[direction];
      const slope = assertV2AssetCapability(
        `${palette}:connection:slope:${direction}:1`
      );
      const stairs = assertV2AssetCapability(
        `${palette}:connection:stairs:${direction}:2`
      );
      assert.deepEqual(slope.resourcePaths, [
        `/assets/sprites/terrain/${palette}/` +
        `slope_${palette}_${assetDirection}_1.webp`
      ]);
      assert.equal(stairs.capabilityKind, 'connection');
      assert.equal(stairs.semantic, `stairs:${direction}:2`);
      assert.deepEqual(stairs.resourcePaths, [
        `/assets/sprites/terrain/${palette}/` +
        `stairs_${palette}_${assetDirection}_2.webp`
      ]);
      assert.equal(publicResourceExists(stairs.resourcePaths[0]), true);
    }
  }
});

test('frontend audit checks authored resources and ignores code-native overlays', () => {
  const descriptors = listV2AssetCapabilities('forest');
  const authored = descriptors
    .flatMap(value => value.resourcePaths);
  const complete = auditV2AuthoredAssets(authored, 'forest');
  const repeated = auditV2AuthoredAssets([...authored].reverse(), 'forest');

  assert.equal(complete.valid, true);
  assert.deepEqual(repeated, complete);
  assert.ok(complete.codeNativeAssetKeys.some(key =>
    key.includes(':transition:')
  ));
  assert.ok(complete.codeNativeAssetKeys.some(key =>
    key.includes(':decoration-family:')
  ));

  const missingPath = complete.authoredResourcePaths[0];
  const incomplete = auditV2AuthoredAssets(
    authored.filter(path => path !== missingPath),
    'forest'
  );
  assert.equal(incomplete.valid, false);
  assert.deepEqual(incomplete.missingAuthoredResourcePaths, [missingPath]);
});

test('recipe-scoped preload includes emitted materials and persisted stairs', () => {
  const recipe = getV2Recipe('orcish_warcamp');
  const descriptors = listV2AssetCapabilities(recipe);
  const keys = new Set(descriptors.map(value => value.assetKey));

  assert.equal(keys.has('mountain:floor:dirt'), true);
  for (const direction of ['n', 'e', 's', 'w']) {
    assert.equal(
      keys.has(`mountain:connection:stairs:${direction}:2`),
      true
    );
  }
  const availablePaths = descriptors.flatMap(value => value.resourcePaths);
  const audit = auditV2AuthoredAssets(availablePaths, recipe);
  assert.equal(audit.valid, true);
  assert.ok(audit.authoredResourcePaths.some(path =>
    path.includes('/stairs_mountain_')
  ));
});
