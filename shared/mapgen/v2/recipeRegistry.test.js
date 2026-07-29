import test from 'node:test';
import assert from 'node:assert/strict';

import {
  V2_PRODUCTION_NODE_TYPES,
  V2_RECIPES,
  getV2Recipe,
  UnsupportedV2RecipeError
} from './RecipeRegistry.js';
import { compileFeasibilityProfile, V2FeasibilityError } from './Feasibility.js';

const EXPECTED_NODE_TYPES = [
  'forest', 'cave', 'mountain', 'bridge', 'castle', 'dungeon', 'swamp',
  'volcano', 'plains', 'arena', 'guild', 'elven_grove', 'dwarven_mine',
  'vampiric_crypt', 'orcish_warcamp', 'human_ruins'
];

test('all production V2 node types have deliberate recipes and render palettes', () => {
  assert.deepEqual(V2_PRODUCTION_NODE_TYPES, EXPECTED_NODE_TYPES);
  for (const nodeType of EXPECTED_NODE_TYPES) {
    const recipe = getV2Recipe(nodeType);
    assert.equal(recipe.nodeType, nodeType);
    assert.match(recipe.renderPalette, /^(forest|cave|mountain|bridge|castle)$/);
    assert.ok(recipe.renderRequirements.floors.length > 0);
    assert.ok(recipe.renderRequirements.transitions.length > 0);
    assert.equal(Object.isFrozen(recipe.renderRequirements), true);
  }
  assert.notEqual(V2_RECIPES.swamp, V2_RECIPES.forest);
  assert.equal(V2_RECIPES.swamp.renderPalette, 'forest');
  assert.equal(V2_RECIPES.volcano.renderPalette, 'mountain');
});

test('unknown V2 nodes never fall through to a forest recipe', () => {
  assert.throws(
    () => getV2Recipe('unknown_biome'),
    error => error instanceof UnsupportedV2RecipeError &&
      error.code === 'UNSUPPORTED_V2_NODE_TYPE'
  );
});

test('feasibility compiles deterministic size-scaled budgets without attempt seeds', () => {
  const request = {
    nodeType: 'forest',
    mode: 'pve',
    mapWidth: 32,
    mapHeight: 24,
    playerCount: 5,
    enemyCapacity: 8
  };
  const first = compileFeasibilityProfile(request);
  assert.deepEqual(first, compileFeasibilityProfile(request));
  assert.equal(first.dimensions.profile, 'standard');
  assert.ok(first.budgets.regionCount >= 3);
  assert.equal(first.hydrology.enabled, true);
  assert.equal(first.hydrology.kind, 'stream');
  assert.ok(first.hydrology.minimumContributingArea >= 4);
  assert.ok(first.requiredCapabilityKeys.every(key => typeof key === 'string'));
  assert.equal(Object.isFrozen(first.budgets), true);
});

test('required compact hydrology resolves a feasible one-tile bridge channel', () => {
  const profile = compileFeasibilityProfile({
    nodeType: 'bridge',
    mode: 'pve',
    mapWidth: 10,
    mapHeight: 10,
    playerCount: 5,
    enemyCapacity: 6
  });
  assert.equal(profile.dimensions.profile, 'compact');
  assert.deepEqual(
    profile.requiredFeatures.find(feature => feature.kind === 'river'),
    { kind: 'river', minimumFootprint: 10 }
  );
  assert.equal(profile.hydrology.enabled, true);
  assert.equal(profile.hydrology.sourceCount, 1);
  assert.equal(profile.hydrology.maximumChannelWidth, 1);
});

test('swamp retained basins and identity gates scale independently of channel width', () => {
  const recipe = getV2Recipe('swamp');
  const standard = compileFeasibilityProfile({
    nodeType: 'swamp',
    mode: 'pve',
    mapWidth: 32,
    mapHeight: 32,
    playerCount: 5,
    enemyCapacity: 6
  });
  const smaller = compileFeasibilityProfile({
    nodeType: 'swamp',
    mode: 'pve',
    mapWidth: 20,
    mapHeight: 20,
    playerCount: 5,
    enemyCapacity: 6
  });
  const large = compileFeasibilityProfile({
    nodeType: 'swamp',
    mode: 'pve',
    mapWidth: 40,
    mapHeight: 40,
    playerCount: 5,
    enemyCapacity: 6
  });

  assert.deepEqual(recipe.hydrology.retainedBasinAreaByProfile, {
    compact: 12,
    standard: 32,
    large: 56
  });
  assert.equal(standard.hydrology.maximumChannelWidth, 2);
  assert.equal(standard.hydrology.retainedBasinArea, 32);
  assert.ok(
    standard.hydrology.retainedBasinArea >
      standard.hydrology.maximumChannelWidth ** 2 +
        standard.hydrology.maximumChannelWidth
  );
  assert.equal(smaller.budgets.waterBodyCount, 1);
  assert.equal(smaller.hydrology.retainedBasinArea, 32);
  assert.equal(large.hydrology.maximumChannelWidth, 4);
  assert.equal(large.hydrology.retainedBasinArea, 56);
  assert.ok(
    large.hydrology.retainedBasinArea >
      large.hydrology.maximumChannelWidth ** 2 +
        large.hydrology.maximumChannelWidth
  );
  assert.equal(
    recipe.quality.minimumHydrologyCoverageByProfile.standard,
    25_000
  );
  assert.equal(
    recipe.quality.minimumBlockingObstacleCountByProfile.standard,
    2
  );
});

test('capability preflight returns exact missing keys instead of using fallback assets', () => {
  const catalog = new Set();
  assert.throws(
    () => compileFeasibilityProfile({
      nodeType: 'forest',
      mode: 'pve',
      mapWidth: 20,
      mapHeight: 20,
      playerCount: 5,
      enemyCapacity: 6
    }, { capabilityCatalog: catalog }),
    error => error instanceof V2FeasibilityError &&
      error.code === 'MISSING_RENDER_CAPABILITY' &&
      error.details.missingCapabilityKeys.length > 0
  );
});
