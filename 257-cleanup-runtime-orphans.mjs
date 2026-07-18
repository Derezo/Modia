#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRuntimeAssetReport } from './validate-runtime-assets.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APPLY = process.argv.includes('--apply');
const cliArguments = process.argv.slice(2);

if (cliArguments.some(argument => !['--apply', '--dry-run'].includes(argument))) {
  console.error('Usage: node scripts/ai-images/cleanup-runtime-orphans.mjs [--dry-run|--apply]');
  process.exit(2);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  fs.writeFileSync(
    path.join(PROJECT_ROOT, relativePath),
    `${JSON.stringify(value, null, 2)}\n`
  );
}

function removeEmptyParents(filePath) {
  const assetsRoot = path.join(PROJECT_ROOT, 'frontend/public/assets');
  let directory = path.dirname(filePath);
  while (directory.startsWith(`${assetsRoot}${path.sep}`)) {
    if (fs.readdirSync(directory).length > 0) break;
    fs.rmdirSync(directory);
    directory = path.dirname(directory);
  }
}

function groupBy(entries, keyForEntry) {
  const groups = new Map();
  for (const entry of entries) {
    const key = keyForEntry(entry);
    groups.set(key, [...(groups.get(key) || []), entry]);
  }
  return groups;
}

function pruneMetadata(report) {
  const enemyOrphansByFile = groupBy(
    report.checks.enemies.orphanMetadata,
    entry => entry.metadataFile
  );
  const itemOrphansByFile = groupBy(
    report.checks.items.orphanMetadata,
    entry => entry.metadataFile
  );

  for (const [relativePath, entries] of enemyOrphansByFile) {
    const ids = new Set(entries.map(entry => entry.id));
    const metadata = readJson(relativePath);
    metadata.enemies = metadata.enemies.filter(enemy => !ids.has(enemy.id));
    metadata.totalAssets = metadata.enemies.length;
    metadata.totalAnimations = metadata.enemies.reduce(
      (total, enemy) => total + Object.keys(enemy.animations || {}).length,
      0
    );
    writeJson(relativePath, metadata);
  }

  for (const [relativePath, entries] of itemOrphansByFile) {
    const ids = new Set(entries.map(entry => entry.id));
    const metadata = readJson(relativePath);
    metadata.items = metadata.items.filter(item => !ids.has(item.id));
    writeJson(relativePath, metadata);
  }

  const characterManifestPath = 'ai-image-metadata/characters/manifest.json';
  const characterManifest = readJson(characterManifestPath);
  for (const [biome, relativeFile] of Object.entries(characterManifest.categoryFiles.enemies)) {
    characterManifest.enemyCounts[biome] = readJson(
      `ai-image-metadata/characters/${relativeFile}`
    ).enemies.length;
  }
  characterManifest.totalEnemies = Object.values(characterManifest.enemyCounts)
    .reduce((total, count) => total + count, 0);
  writeJson(characterManifestPath, characterManifest);

  const itemManifestPath = 'ai-image-metadata/items/manifest.json';
  const itemManifest = readJson(itemManifestPath);
  for (const [category, relativeFile] of Object.entries(itemManifest.categoryFiles)) {
    const count = readJson(`ai-image-metadata/items/${relativeFile}`).items.length;
    itemManifest.layeredComposition.baseAssets[category] = count;
  }
  itemManifest.totalAssets = Object.values(itemManifest.layeredComposition.baseAssets)
    .reduce((total, count) => total + count, 0);
  writeJson(itemManifestPath, itemManifest);
}

const report = await createRuntimeAssetReport({ projectRoot: PROJECT_ROOT });
const reportedFiles = [
  ...report.checks.players.orphanFiles,
  ...report.checks.players.legacyFallbackFiles,
  ...report.checks.enemies.orphanFiles,
  ...report.checks.items.orphanFiles
].map(entry => entry.path);

// These predate the canonical animation atlas and audio manifests. They are
// outside the WebP-only runtime report, but have no source or metadata consumer.
const knownLegacyFiles = [
  'frontend/public/assets/characters/player/warrior/warrior_walk_down.png',
  'frontend/public/assets/characters/player/warrior/warrior_walk_left.png',
  'frontend/public/assets/characters/player/warrior/warrior_walk_right.png',
  'frontend/public/assets/characters/player/warrior/warrior_walk_up.png',
  'frontend/public/assets/audio/music/core/title_theme-old.mp3',
  'frontend/public/assets/audio/music/core/title_theme-old.opus',
  'frontend/public/assets/audio/music/core/title_theme_v2-old.mp3',
  'frontend/public/assets/audio/music/core/title_theme_v2-old.opus'
];

const files = [...new Set([...reportedFiles, ...knownLegacyFiles])]
  .filter(relativePath => fs.existsSync(path.join(PROJECT_ROOT, relativePath)));
const bytes = files.reduce(
  (total, relativePath) => total + fs.statSync(path.join(PROJECT_ROOT, relativePath)).size,
  0
);

console.log(`${APPLY ? 'Removing' : 'Would remove'} ${files.length} runtime-orphan files (${(bytes / 1024 / 1024).toFixed(2)} MiB).`);
console.log(`  player orphans: ${report.checks.players.orphanFiles.length}`);
console.log(`  legacy player fallbacks: ${report.checks.players.legacyFallbackFiles.length}`);
console.log(`  enemy sprite orphans: ${report.checks.enemies.orphanFiles.length}`);
console.log(`  item size-variant orphans: ${report.checks.items.orphanFiles.length}`);
console.log(`  known legacy PNG/audio files: ${knownLegacyFiles.length}`);
console.log(`  enemy metadata records: ${report.checks.enemies.orphanMetadata.length}`);
console.log(`  item metadata records: ${report.checks.items.orphanMetadata.length}`);

if (!APPLY) {
  console.log('Dry run only; pass --apply to perform the cleanup.');
  process.exit(0);
}

pruneMetadata(report);
for (const relativePath of files) {
  const absolutePath = path.join(PROJECT_ROOT, relativePath);
  fs.unlinkSync(absolutePath);
  removeEmptyParents(absolutePath);
}

console.log('Cleanup complete.');
