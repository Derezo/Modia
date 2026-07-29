import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildEnemyMetadataSync,
  parseArgs,
  writeEnemyMetadataSync
} from './sync-enemy-metadata.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');

function enemy(id, animations, generatedAnimations = {}, generated = false) {
  return {
    id,
    animations: Object.fromEntries(animations.map(animation => [animation, {
      id: `${id}_${animation}`,
      frameCount: 8,
      generated: false
    }])),
    generatedAnimations,
    generated
  };
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function makeFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'modia-enemy-metadata-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const metadataRoot = path.join(root, 'ai-image-metadata/characters/enemies');
  const common = {
    version: '1.1.0',
    category: 'enemies',
    biomeTraits: 'fixture',
    totalAssets: 1,
    totalAnimations: 1
  };

  await writeJson(path.join(metadataRoot, 'castle.json'), {
    ...common,
    biome: 'castle',
    description: 'Castle enemies',
    enemies: [enemy('dark_knight', ['idle'], { idle: false }, false)]
  });
  await writeJson(path.join(metadataRoot, 'cave.json'), {
    ...common,
    biome: 'cave',
    description: 'Cave enemies',
    enemies: [enemy('cave_beast', ['idle', 'dead'], {}, true)]
  });
  await writeJson(path.join(root, 'ai-image-metadata/characters/manifest.json'), {
    categoryFiles: { enemies: { cave: 'enemies/cave.json', palace: 'enemies/castle.json' } },
    enemyCounts: { cave: 1, palace: 1 },
    totalEnemies: 2
  });
  await writeJson(path.join(root, 'ai-image-metadata/manifest.json'), {
    categories: {
      characters: {
        assetCount: 22,
        playerVariantCount: 10,
        legacyPlayerArchetypes: 10,
        enemyCount: 2,
        files: ['characters/players.json', 'characters/enemies/cave.json', 'characters/enemies/castle.json']
      }
    }
  });

  const idleSheet = path.join(
    root,
    'frontend/public/assets/characters/enemies/palace/dark_knight/dark_knight_idle.webp'
  );
  await fs.mkdir(path.dirname(idleSheet), { recursive: true });
  await fs.writeFile(idleSheet, 'fixture');
  return root;
}

test('CLI parsing supports check/json/root and rejects unknown flags', () => {
  const options = parseArgs(['--check', '--json', '--root', '/tmp/example']);
  assert.equal(options.check, true);
  assert.equal(options.json, true);
  assert.equal(options.projectRoot, '/tmp/example');
  assert.throws(() => parseArgs(['--unknown']), /Unknown option/);
  assert.throws(() => parseArgs(['--root']), /requires a path/);
});

test('sync moves canonical identities and derives every status from files', async t => {
  const projectRoot = await makeFixture(t);
  const first = await buildEnemyMetadataSync({
    projectRoot,
    canonicalBiomes: { dark_knight: 'palace' }
  });

  assert.equal(first.outOfDate, true);
  assert.equal(first.stats.biomeMoves, 1);
  assert.equal(first.stats.generatedAnimationStatusChanges, 3);
  assert.equal(first.stats.nestedAnimationStatusChanges, 1);
  assert.equal(first.stats.aggregateStatusChanges, 2);
  assert.equal(first.stats.presentFiles, 1);
  assert.ok(first.changedFiles.includes('ai-image-metadata/characters/enemies/palace.json'));

  await writeEnemyMetadataSync(first);
  const palace = JSON.parse(await fs.readFile(
    path.join(projectRoot, 'ai-image-metadata/characters/enemies/palace.json'),
    'utf8'
  ));
  const castle = JSON.parse(await fs.readFile(
    path.join(projectRoot, 'ai-image-metadata/characters/enemies/castle.json'),
    'utf8'
  ));
  const cave = JSON.parse(await fs.readFile(
    path.join(projectRoot, 'ai-image-metadata/characters/enemies/cave.json'),
    'utf8'
  ));
  const characterManifest = JSON.parse(await fs.readFile(
    path.join(projectRoot, 'ai-image-metadata/characters/manifest.json'),
    'utf8'
  ));

  assert.deepEqual(castle.enemies, []);
  assert.equal(palace.enemies[0].animations.idle.generated, true);
  assert.deepEqual(palace.enemies[0].generatedAnimations, { idle: true });
  assert.equal(palace.enemies[0].generated, true);
  assert.deepEqual(cave.enemies[0].generatedAnimations, { idle: false, dead: false });
  assert.equal(cave.enemies[0].generated, false);
  assert.deepEqual(characterManifest.categoryFiles.enemies, {
    cave: 'enemies/cave.json',
    castle: 'enemies/castle.json',
    palace: 'enemies/palace.json'
  });

  const second = await buildEnemyMetadataSync({
    projectRoot,
    canonicalBiomes: { dark_knight: 'palace' }
  });
  assert.equal(second.outOfDate, false);
  assert.deepEqual(second.changedFiles, []);
  assert.equal(second.stats.biomeMoves, 0);
  assert.equal(second.stats.generatedAnimationStatusChanges, 0);
  assert.equal(second.stats.nestedAnimationStatusChanges, 0);
  assert.equal(second.stats.aggregateStatusChanges, 0);
});

test('repository enemy metadata matches canonical sheets after sync', async () => {
  const result = await buildEnemyMetadataSync({ projectRoot: PROJECT_ROOT });
  assert.equal(result.stats.enemies, 16);
  assert.equal(result.stats.declaredAnimations, 80);
  assert.equal(result.outOfDate, false, result.changedFiles.join('\n'));
});
