const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const {
  EXPECTED_DERIVATION_COUNT,
  ORIGINAL_SIZE,
  buildMetadataEntry,
  canonicalItemAssetPaths,
  inspectItemRaster,
  loadRegistry,
  parseArgs,
  renderDerivedMaster,
  validateRegistry,
  writeDerivedItem
} = require('./complete-runtime-item-assets');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PUBLIC_ASSET_ROOT = path.join(PROJECT_ROOT, 'frontend/public/assets');

test('runtime derivation registry covers all 37 missing category paths', async () => {
  const registry = loadRegistry();
  const expectedIdentities = [
    'accessories/amulet_dreamcatcher',
    'accessories/amulet_trophy',
    'accessories/emblem_palace',
    'armor/armor_caravan',
    'armor/armor_nightstalker',
    'armor/boots_pathfinder',
    'armor/gloves_deepforge',
    'armor/helm_cowl',
    'armor/helm_crown_guard',
    'consumables/bomb_smoke',
    'consumables/lens_scout',
    'consumables/map_treasure',
    'consumables/material_ancient_wood',
    'consumables/material_demon_horn',
    'consumables/material_dragon_scale',
    'consumables/material_ethereal_dust',
    'consumables/material_mermaid_scale',
    'consumables/material_moon_ore',
    'consumables/material_phoenix_ash',
    'consumables/material_starlight_essence',
    'consumables/material_titan_fragment',
    'consumables/material_void_crystal',
    'consumables/mystery_box',
    'consumables/mystery_box_premium',
    'consumables/potion_agility',
    'consumables/potion_blood',
    'consumables/potion_intelligence',
    'consumables/potion_luck',
    'consumables/potion_vitality',
    'consumables/scroll_magic',
    'consumables/token_merchant',
    'weapons/bow_elven',
    'weapons/fist_nomad',
    'weapons/mace_war',
    'weapons/shield_tower',
    'weapons/staff_wanderer',
    'weapons/sword_travelers'
  ];
  assert.equal(registry.items.length, EXPECTED_DERIVATION_COUNT);
  assert.deepEqual(
    registry.items.map(item => `${item.category}/${item.id}`).sort(),
    expectedIdentities
  );
  assert.deepEqual(
    registry.items.reduce((counts, item) => {
      counts[item.category] = (counts[item.category] || 0) + 1;
      return counts;
    }, {}),
    { accessories: 3, armor: 6, consumables: 22, weapons: 6 }
  );
  assert.deepEqual(await validateRegistry(registry), []);
  assert.equal(new Set(registry.items.map(item => item.seed)).size, EXPECTED_DERIVATION_COUNT);
  assert.equal(
    registry.items.filter(item => item.id === 'shield_tower' && item.category === 'weapons').length,
    1
  );
});

test('CLI parsing keeps replacement explicit', () => {
  assert.deepEqual(parseArgs([]), {
    check: false,
    dryRun: false,
    force: false,
    id: null,
    category: null
  });
  assert.equal(parseArgs(['--force', '--id', 'potion_luck']).force, true);
  assert.throws(() => parseArgs(['--check', '--force']), /cannot be combined/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('canonical paths and metadata enumerate original plus all runtime sizes', () => {
  const registry = loadRegistry();
  const item = registry.items.find(entry => entry.id === 'potion_luck');
  const paths = canonicalItemAssetPaths(item, PUBLIC_ASSET_ROOT, registry.sizes);
  assert.match(paths.original, /items\/originals\/consumables\/potion_luck\.webp$/);
  assert.match(paths.sizes[32], /items\/32\/consumables\/potion_luck\.webp$/);
  assert.match(paths.sizes[128], /items\/128\/consumables\/potion_luck\.webp$/);

  const metadata = buildMetadataEntry(item, registry);
  assert.equal(metadata.generated, true);
  assert.equal(metadata.needsRegeneration, false);
  assert.equal(metadata.derivation.sourceAsset, `/assets/${item.sourceAsset}`);
  assert.equal(metadata.assetPaths['64'], '/assets/items/64/consumables/potion_luck.webp');
});

test('different semantic recipes render distinct transparent masters', async () => {
  const registry = loadRegistry();
  const first = registry.items.find(item => item.id === 'amulet_dreamcatcher');
  const second = registry.items.find(item => item.id === 'amulet_trophy');
  const firstBuffer = await renderDerivedMaster(first);
  const secondBuffer = await renderDerivedMaster(second);
  const firstMetadata = await sharp(firstBuffer).metadata();
  const secondMetadata = await sharp(secondBuffer).metadata();

  assert.equal(firstMetadata.width, ORIGINAL_SIZE);
  assert.equal(firstMetadata.height, ORIGINAL_SIZE);
  assert.equal(firstMetadata.hasAlpha, true);
  assert.equal(secondMetadata.hasAlpha, true);
  assert.notEqual(
    crypto.createHash('sha256').update(firstBuffer).digest('hex'),
    crypto.createHash('sha256').update(secondBuffer).digest('hex')
  );
});

test('writer creates valid alpha sizes and preserves them by default', async t => {
  const registry = loadRegistry();
  const item = registry.items.find(entry => entry.id === 'potion_luck');
  const outputAssetRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'modia-runtime-items-'));
  t.after(() => fsp.rm(outputAssetRoot, { recursive: true, force: true }));

  const first = await writeDerivedItem(item, {
    sourceAssetRoot: PUBLIC_ASSET_ROOT,
    outputAssetRoot,
    sizes: registry.sizes
  });
  assert.equal(first.created.length, 4);
  assert.equal(first.replaced.length, 0);

  const paths = canonicalItemAssetPaths(item, outputAssetRoot, registry.sizes);
  for (const size of registry.sizes) {
    const inspection = await inspectItemRaster(paths.sizes[size], size);
    assert.equal(inspection.valid, true, inspection.problems.join('; '));
    assert.ok(inspection.foregroundCoverage > 0.025);
    assert.ok(inspection.foregroundCoverage < 0.9);
  }

  const second = await writeDerivedItem(item, {
    sourceAssetRoot: PUBLIC_ASSET_ROOT,
    outputAssetRoot,
    sizes: registry.sizes
  });
  assert.equal(second.created.length, 0);
  assert.equal(second.preserved.length, 4);
});
