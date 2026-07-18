'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');

const registry = require('../../ai-image-metadata/abilities/abilities.json');
const manifest = require('../../ai-image-metadata/abilities/manifest.json');
const {
  ICON_SIZE,
  COMPILER_VERSION,
  buildIconRecipe,
  renderAbilityIcon,
  updateGeneratedRegistry
} = require('./compile-ability-icons');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function outputFile(ability) {
  return path.join(PROJECT_ROOT, 'frontend/public', ability.iconAssetPath.slice(1));
}

function recipeFingerprint(recipe) {
  return JSON.stringify({
    action: [
      recipe.action.id,
      recipe.action.size,
      recipe.action.rotation,
      recipe.action.left,
      recipe.action.top
    ],
    impact: [recipe.impactBadge.id, recipe.impactBadge.rotation],
    projectile: recipe.projectileBadge
      ? [recipe.projectileBadge.id, recipe.projectileBadge.rotation]
      : null,
    status: recipe.statusBadge?.id || null,
    variant: recipe.variant
  });
}

test('builds a unique deterministic recipe from semantic Modia icon families', () => {
  const recipes = registry.abilities.map(ability => buildIconRecipe(ability, { projectRoot: PROJECT_ROOT }));
  assert.equal(recipes.length, 164);
  assert.equal(new Set(recipes.map(recipeFingerprint)).size, recipes.length);

  for (const recipe of recipes) {
    assert.equal(recipe.compilerVersion, COMPILER_VERSION);
    assert.equal(recipe.action.family, 'actions');
    assert.equal(recipe.impactBadge.family, 'augments');
    assert.ok(['augments', 'actions'].includes(recipe.projectileBadge?.family || 'augments'));
    assert.ok(['status', 'actions'].includes(recipe.statusBadge?.family || 'actions'));
    for (const layer of [recipe.action, recipe.impactBadge, recipe.projectileBadge, recipe.statusBadge]) {
      if (layer) assert.ok(fs.existsSync(layer.path), `${recipe.id} source layer ${layer.path} is missing`);
    }
    assert.doesNotMatch(recipe.digestHex, /[^a-f0-9]/);
  }
});

test('renders byte-stable square lossless WebP icons with real transparency', async () => {
  const ability = registry.abilities.find(entry => entry.id === 'alchemical_warfare');
  const first = await renderAbilityIcon(ability, { projectRoot: PROJECT_ROOT });
  const second = await renderAbilityIcon(ability, { projectRoot: PROJECT_ROOT });
  assert.deepEqual(first, second);

  const metadata = await sharp(first).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, ICON_SIZE);
  assert.equal(metadata.height, ICON_SIZE);
  assert.equal(metadata.hasAlpha, true);
  const stats = await sharp(first).ensureAlpha().stats();
  assert.equal(stats.channels[3].min, 0);
  assert.equal(stats.channels[3].max, 255);
});

test('checked-in canonical outputs cover all sources and contain no duplicate or near-copy icons', async () => {
  assert.deepEqual(manifest.countsBySource, { monster: 80, player: 72, zodiac: 12 });
  assert.equal(manifest.generatedAbilities, 164);
  assert.equal(manifest.missingAbilities, 0);

  const records = [];
  for (const ability of registry.abilities) {
    const file = outputFile(ability);
    assert.ok(fs.existsSync(file), `${ability.source}/${ability.id} icon is missing`);
    const content = fs.readFileSync(file);
    const perceptualPixels = await sharp(content)
      .flatten({ background: '#15131a' })
      .resize(24, 24, { fit: 'fill' })
      .raw()
      .toBuffer();
    records.push({
      id: ability.id,
      contentHash: crypto.createHash('sha256').update(content).digest('hex'),
      perceptualPixels
    });
  }

  assert.equal(new Set(records.map(record => record.contentHash)).size, records.length);
  let closestPair = { difference: Infinity, ids: [] };
  for (let left = 0; left < records.length; left++) {
    for (let right = left + 1; right < records.length; right++) {
      let channelDelta = 0;
      for (let channel = 0; channel < records[left].perceptualPixels.length; channel++) {
        channelDelta += Math.abs(
          records[left].perceptualPixels[channel] - records[right].perceptualPixels[channel]
        );
      }
      const normalizedDifference = channelDelta /
        (records[left].perceptualPixels.length * 255);
      if (normalizedDifference < closestPair.difference) {
        closestPair = {
          difference: normalizedDifference,
          ids: [records[left].id, records[right].id]
        };
      }
    }
  }
  assert.ok(
    closestPair.difference >= 0.008,
    `near-copy icons ${closestPair.ids.join('/')} differ by only ${closestPair.difference}`
  );
});

test('generated metadata preserves an existing timestamp and initializes new entries once', () => {
  const updated = updateGeneratedRegistry({
    abilities: [
      { id: 'old', generatedAt: '2026-01-01T00:00:00.000Z', needsRegeneration: true },
      { id: 'new', generatedAt: null, needsRegeneration: false }
    ]
  }, '2026-07-15T07:30:00.000Z');

  assert.deepEqual(updated.abilities, [
    {
      id: 'old',
      generatedAt: '2026-01-01T00:00:00.000Z',
      generated: true,
      status: 'generated',
      needsRegeneration: false
    },
    {
      id: 'new',
      generatedAt: '2026-07-15T07:30:00.000Z',
      generated: true,
      status: 'generated',
      needsRegeneration: false
    }
  ]);
});

test('compiler check verifies icon bytes and sync-safe metadata together', () => {
  const result = spawnSync(process.execPath, [
    path.join(PROJECT_ROOT, 'scripts/ai-images/compile-ability-icons.js'),
    '--check'
  ], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Ability visual metadata is current \(164 active abilities\)/);
  assert.match(result.stdout, /Ability icons are current \(164\/164, compiler 1\.0\.0\)/);
});
