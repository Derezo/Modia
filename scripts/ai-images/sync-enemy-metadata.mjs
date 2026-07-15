#!/usr/bin/env node
/**
 * Reconcile enemy generation metadata with the canonical runtime art tree.
 *
 * The runtime identity map owns an active enemy's canonical biome. Physical
 * sprite sheets own generation status. This script moves metadata entries to
 * their canonical biome document, synchronizes both animation status fields,
 * and refreshes the character manifests without creating or changing pixels.
 *
 * Usage:
 *   node scripts/ai-images/sync-enemy-metadata.mjs
 *   node scripts/ai-images/sync-enemy-metadata.mjs --check
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../..');

export const ENEMY_BIOME_ORDER = Object.freeze([
  'forest',
  'cave',
  'mountain',
  'bridge',
  'castle',
  'palace'
]);

const NEW_BIOME_DEFAULTS = Object.freeze({
  palace: Object.freeze({
    description: 'Palace biome enemy sprite sheets',
    biomeTraits: 'opulent royal palace halls polished stone gold trim deep crimson banners'
  })
});

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function orderedBiomes(values) {
  const unique = [...new Set(values)];
  return unique.sort((left, right) => {
    const leftIndex = ENEMY_BIOME_ORDER.indexOf(left);
    const rightIndex = ENEMY_BIOME_ORDER.indexOf(right);
    const leftRank = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const rightRank = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    return leftRank - rightRank || left.localeCompare(right);
  });
}

function assertBiome(value, context) {
  if (!/^[a-z0-9_]+$/.test(String(value || ''))) {
    throw new Error(`Invalid enemy biome ${JSON.stringify(value)} in ${context}`);
  }
}

function assertEnemyId(value, context) {
  if (!/^[a-z0-9_]+$/.test(String(value || ''))) {
    throw new Error(`Invalid enemy id ${JSON.stringify(value)} in ${context}`);
  }
}

/** Parse the deliberately small sync/check CLI surface. */
export function parseArgs(argv) {
  const options = {
    check: false,
    json: false,
    help: false,
    projectRoot: DEFAULT_PROJECT_ROOT
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--check') options.check = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--root') {
      const value = argv[++index];
      if (!value) throw new Error('--root requires a path');
      options.projectRoot = path.resolve(value);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function loadCanonicalBiomes(projectRoot) {
  const modulePath = path.join(projectRoot, 'shared/assetPaths.js');
  const module = await import(pathToFileURL(modulePath).href);
  return module.ENEMY_PRIMARY_BIOMES || module.NPC_PRIMARY_BIOMES || {};
}

async function loadEnemyDocuments(projectRoot) {
  const metadataDir = path.join(projectRoot, 'ai-image-metadata/characters/enemies');
  const fileNames = (await fs.readdir(metadataDir))
    .filter(fileName => fileName.endsWith('.json'))
    .sort();

  return Promise.all(fileNames.map(async fileName => {
    const filePath = path.join(metadataDir, fileName);
    const data = await readJson(filePath);
    assertBiome(data.biome, fileName);
    return { fileName, filePath, data };
  }));
}

function buildNewBiomeDocument(biome, fallbackVersion) {
  const defaults = NEW_BIOME_DEFAULTS[biome] || {};
  const title = biome.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  return {
    version: fallbackVersion || '1.1.0',
    category: 'enemies',
    biome,
    description: defaults.description || `${title} biome enemy sprite sheets`,
    biomeTraits: defaults.biomeTraits || `${biome.replaceAll('_', ' ')} environment`,
    totalAssets: 0,
    totalAnimations: 0,
    enemies: []
  };
}

async function reconcileEnemy(enemy, canonicalBiome, publicAssetRoot) {
  const animations = enemy.animations && typeof enemy.animations === 'object'
    ? Object.entries(enemy.animations)
    : [];
  const generatedAnimations = {};
  const reconciledAnimations = {};
  let generatedAnimationStatusChanges = 0;
  let nestedAnimationStatusChanges = 0;

  for (const [animation, animationMetadata] of animations) {
    const filePath = path.join(
      publicAssetRoot,
      'characters/enemies',
      canonicalBiome,
      enemy.id,
      `${enemy.id}_${animation}.webp`
    );
    const exists = await pathExists(filePath);
    const previousGenerated = enemy.generatedAnimations?.[animation];
    const previousNestedGenerated = animationMetadata?.generated;
    if (previousGenerated !== exists) generatedAnimationStatusChanges++;
    if (previousNestedGenerated !== exists) nestedAnimationStatusChanges++;
    generatedAnimations[animation] = exists;
    reconciledAnimations[animation] = {
      ...animationMetadata,
      generated: exists
    };
  }

  const generated = animations.length > 0 && Object.values(generatedAnimations).every(Boolean);
  return {
    enemy: {
      ...enemy,
      animations: reconciledAnimations,
      generatedAnimations,
      generated
    },
    generatedAnimationStatusChanges,
    nestedAnimationStatusChanges,
    aggregateStatusChange: Boolean(enemy.generated) !== generated ? 1 : 0,
    presentFiles: Object.values(generatedAnimations).filter(Boolean).length,
    declaredFiles: animations.length
  };
}

function updateCharacterManifest(manifest, documentsByBiome) {
  const biomes = orderedBiomes(documentsByBiome.keys());
  const categoryFiles = Object.fromEntries(
    biomes.map(biome => [biome, `enemies/${biome}.json`])
  );
  const enemyCounts = Object.fromEntries(
    biomes.map(biome => [biome, documentsByBiome.get(biome).enemies.length])
  );
  const totalEnemies = [...documentsByBiome.values()]
    .reduce((sum, document) => sum + document.enemies.length, 0);

  return {
    ...manifest,
    categoryFiles: {
      ...manifest.categoryFiles,
      enemies: categoryFiles
    },
    enemyCounts,
    totalEnemies
  };
}

function updateMasterManifest(manifest, documentsByBiome) {
  const characters = manifest.categories?.characters;
  if (!characters) return manifest;
  const enemyFiles = orderedBiomes(documentsByBiome.keys())
    .map(biome => `characters/enemies/${biome}.json`);
  const nonEnemyFiles = (characters.files || [])
    .filter(file => !file.startsWith('characters/enemies/'));
  const enemyCount = [...documentsByBiome.values()]
    .reduce((sum, document) => sum + document.enemies.length, 0);
  const playerVariantCount = Number(characters.playerVariantCount || 0);
  const legacyPlayerArchetypes = Number(characters.legacyPlayerArchetypes || 0);

  return {
    ...manifest,
    categories: {
      ...manifest.categories,
      characters: {
        ...characters,
        assetCount: playerVariantCount + legacyPlayerArchetypes + enemyCount,
        enemyCount,
        files: [...nonEnemyFiles, ...enemyFiles]
      }
    }
  };
}

/**
 * Build the exact expected documents and a diff summary without writing.
 * Tests may inject canonicalBiomes; production reads the shared runtime map.
 */
export async function buildEnemyMetadataSync(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || DEFAULT_PROJECT_ROOT);
  const canonicalBiomes = options.canonicalBiomes || await loadCanonicalBiomes(projectRoot);
  const documents = await loadEnemyDocuments(projectRoot);
  const publicAssetRoot = path.join(projectRoot, 'frontend/public/assets');
  const documentByBiome = new Map();
  const seenIds = new Set();
  const entries = [];

  for (const document of documents) {
    if (documentByBiome.has(document.data.biome)) {
      throw new Error(`Duplicate metadata document for biome ${document.data.biome}`);
    }
    documentByBiome.set(document.data.biome, document);
    for (const [sourceIndex, enemy] of (document.data.enemies || []).entries()) {
      assertEnemyId(enemy.id, document.fileName);
      if (seenIds.has(enemy.id)) throw new Error(`Duplicate enemy metadata id: ${enemy.id}`);
      seenIds.add(enemy.id);
      const canonicalBiome = canonicalBiomes[enemy.id] || document.data.biome;
      assertBiome(canonicalBiome, enemy.id);
      entries.push({
        enemy,
        declaredBiome: document.data.biome,
        canonicalBiome,
        sourceFileName: document.fileName,
        sourceIndex
      });
    }
  }

  const targetBiomes = orderedBiomes([
    ...documentByBiome.keys(),
    ...entries.map(entry => entry.canonicalBiome)
  ]);
  const fallbackVersion = documents[0]?.data.version || '1.1.0';
  const outputDocuments = new Map();
  const stats = {
    enemies: entries.length,
    declaredAnimations: 0,
    presentFiles: 0,
    biomeMoves: 0,
    generatedAnimationStatusChanges: 0,
    nestedAnimationStatusChanges: 0,
    aggregateStatusChanges: 0
  };

  for (const biome of targetBiomes) {
    const base = documentByBiome.get(biome)?.data
      || buildNewBiomeDocument(biome, fallbackVersion);
    const biomeEntries = entries
      .filter(entry => entry.canonicalBiome === biome)
      .sort((left, right) => {
        const leftMoved = left.declaredBiome === biome ? 0 : 1;
        const rightMoved = right.declaredBiome === biome ? 0 : 1;
        return leftMoved - rightMoved
          || left.sourceFileName.localeCompare(right.sourceFileName)
          || left.sourceIndex - right.sourceIndex;
      });
    const reconciledEnemies = [];

    for (const entry of biomeEntries) {
      const result = await reconcileEnemy(entry.enemy, biome, publicAssetRoot);
      reconciledEnemies.push(result.enemy);
      stats.declaredAnimations += result.declaredFiles;
      stats.presentFiles += result.presentFiles;
      stats.generatedAnimationStatusChanges += result.generatedAnimationStatusChanges;
      stats.nestedAnimationStatusChanges += result.nestedAnimationStatusChanges;
      stats.aggregateStatusChanges += result.aggregateStatusChange;
      if (entry.declaredBiome !== biome) stats.biomeMoves++;
    }

    outputDocuments.set(biome, {
      ...base,
      biome,
      totalAssets: reconciledEnemies.length,
      totalAnimations: reconciledEnemies.reduce(
        (sum, enemy) => sum + Object.keys(enemy.animations || {}).length,
        0
      ),
      enemies: reconciledEnemies
    });
  }

  const expectedFiles = new Map();
  const metadataDir = path.join(projectRoot, 'ai-image-metadata/characters/enemies');
  for (const biome of targetBiomes) {
    expectedFiles.set(
      path.join(metadataDir, `${biome}.json`),
      serialize(outputDocuments.get(biome))
    );
  }

  const characterManifestPath = path.join(projectRoot, 'ai-image-metadata/characters/manifest.json');
  if (await pathExists(characterManifestPath)) {
    const manifest = await readJson(characterManifestPath);
    const expectedManifest = updateCharacterManifest(manifest, outputDocuments);
    const currentEnemyContract = {
      categoryFiles: manifest.categoryFiles?.enemies,
      enemyCounts: manifest.enemyCounts,
      totalEnemies: manifest.totalEnemies
    };
    const expectedEnemyContract = {
      categoryFiles: expectedManifest.categoryFiles?.enemies,
      enemyCounts: expectedManifest.enemyCounts,
      totalEnemies: expectedManifest.totalEnemies
    };
    if (JSON.stringify(currentEnemyContract) !== JSON.stringify(expectedEnemyContract)) {
      expectedFiles.set(characterManifestPath, serialize(expectedManifest));
    }
  }

  const masterManifestPath = path.join(projectRoot, 'ai-image-metadata/manifest.json');
  if (await pathExists(masterManifestPath)) {
    const manifest = await readJson(masterManifestPath);
    const expectedManifest = updateMasterManifest(manifest, outputDocuments);
    const currentCharacters = manifest.categories?.characters;
    const expectedCharacters = expectedManifest.categories?.characters;
    const currentEnemyContract = {
      assetCount: currentCharacters?.assetCount,
      enemyCount: currentCharacters?.enemyCount,
      files: currentCharacters?.files
    };
    const expectedEnemyContract = {
      assetCount: expectedCharacters?.assetCount,
      enemyCount: expectedCharacters?.enemyCount,
      files: expectedCharacters?.files
    };
    if (JSON.stringify(currentEnemyContract) !== JSON.stringify(expectedEnemyContract)) {
      expectedFiles.set(masterManifestPath, serialize(expectedManifest));
    }
  }

  const changedFiles = [];
  for (const [filePath, expected] of expectedFiles) {
    const current = await pathExists(filePath) ? await fs.readFile(filePath, 'utf8') : '';
    if (current !== expected) changedFiles.push(path.relative(projectRoot, filePath).replaceAll(path.sep, '/'));
  }

  return {
    projectRoot,
    expectedFiles,
    changedFiles: changedFiles.sort(),
    outOfDate: changedFiles.length > 0,
    stats
  };
}

/** Write a previously built sync result. */
export async function writeEnemyMetadataSync(result) {
  for (const [filePath, contents] of result.expectedFiles) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, contents);
  }
}

function helpText() {
  return `Synchronize enemy generation metadata with canonical runtime sheets

Usage:
  node scripts/ai-images/sync-enemy-metadata.mjs [options]

Options:
  --check       Report drift and exit non-zero without writing
  --json        Emit a machine-readable summary
  --root <dir>  Operate on another Modia checkout (primarily for tests)
  --help, -h    Show this help
`;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(helpText());
    return;
  }

  try {
    const result = await buildEnemyMetadataSync({ projectRoot: options.projectRoot });
    const summary = {
      status: result.outOfDate ? (options.check ? 'out_of_date' : 'updated') : 'current',
      changedFiles: result.changedFiles,
      ...result.stats
    };

    if (result.outOfDate && !options.check) await writeEnemyMetadataSync(result);

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else if (result.outOfDate && options.check) {
      console.error(`Enemy metadata is out of date (${result.changedFiles.length} files):`);
      for (const file of result.changedFiles) console.error(`  - ${file}`);
      console.error('Run npm run ai:sync:enemy-metadata.');
    } else {
      const verb = result.outOfDate ? 'Updated' : 'Verified';
      console.log(`${verb} ${result.stats.enemies} enemies / ${result.stats.declaredAnimations} declared animations.`);
      console.log(`Canonical sheets present: ${result.stats.presentFiles}/${result.stats.declaredAnimations}; biome moves: ${result.stats.biomeMoves}.`);
    }

    if (options.check && result.outOfDate) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 2;
  }
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
