#!/usr/bin/env node

/**
 * Validate the canonical v3 isometric tile metadata and generated WebPs.
 *
 * Unlike the legacy validator, this command uses Sharp (the same decoder used
 * by the build pipeline), understands the flat biome/key.webp namespace, and
 * verifies the pixel-level alpha geometry that the renderer depends on.
 */

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { TILE_SPEC } = require('./isometricCompiler');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_METADATA_DIR = path.join(PROJECT_ROOT, 'ai-image-metadata/tiles');
const DEFAULT_ASSETS_DIR = path.join(PROJECT_ROOT, 'frontend/public/assets/sprites/terrain');
const IMAGE_EXTENSIONS = new Set(['.png', '.webp', '.jpg', '.jpeg', '.avif']);
const CATEGORIES = new Set(['floors', 'walls', 'slopes']);
const DIRECTIONS = new Set(['north', 'south', 'east', 'west']);
const SAFE_IDENTIFIER = /^[a-z0-9][a-z0-9_-]*$/;

function parseArgs(argv) {
  const options = {
    metadataDir: DEFAULT_METADATA_DIR,
    assetsDir: DEFAULT_ASSETS_DIR,
    metadataOnly: false,
    allowMissing: false,
    strict: false,
    verbose: false,
    json: false,
    help: false,
    biome: null,
    category: null,
    keys: []
  };

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const nextValue = () => {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new Error(`${argument} requires a value`);
      return value;
    };

    if (argument === '--metadata-dir') options.metadataDir = path.resolve(nextValue());
    else if (argument.startsWith('--metadata-dir=')) options.metadataDir = path.resolve(argument.slice(15));
    else if (argument === '--assets-dir') options.assetsDir = path.resolve(nextValue());
    else if (argument.startsWith('--assets-dir=')) options.assetsDir = path.resolve(argument.slice(13));
    else if (argument === '--biome') options.biome = nextValue();
    else if (argument.startsWith('--biome=')) options.biome = argument.slice(8);
    else if (argument === '--category') options.category = nextValue();
    else if (argument.startsWith('--category=')) options.category = argument.slice(11);
    else if (argument === '--key') options.keys.push(nextValue());
    else if (argument.startsWith('--key=')) options.keys.push(argument.slice(6));
    else if (argument === '--metadata-only') options.metadataOnly = true;
    else if (argument === '--allow-missing') options.allowMissing = true;
    else if (argument === '--strict') options.strict = true;
    else if (argument === '--verbose' || argument === '-v') options.verbose = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

function showHelp() {
  console.log(`
Canonical Isometric Tile Validator

Usage:
  node scripts/tiles/validate-isometric-tiles.js [options]

Options:
  --metadata-only         validate manifest and metadata without reading assets
  --allow-missing         report missing canonical assets as warnings
  --strict                reject unexpected/legacy image files too
  --biome <name>          validate one biome
  --category <name>       validate floors, walls, or slopes
  --key <id>              validate one key (repeatable)
  --metadata-dir <path>   override metadata root (fixture support)
  --assets-dir <path>     override generated terrain root
  --verbose, -v           print individual issues and checked files
  --json                  emit a machine-readable report
  --help, -h              show this help

Canonical v${TILE_SPEC.version} geometry:
  floor/slope source      ${TILE_SPEC.sourceWidth}x${TILE_SPEC.sourceHeight}
  floor/slope footprint   ${TILE_SPEC.sourceWidth}x${TILE_SPEC.sourceFootprintHeight}
  wall source             ${TILE_SPEC.wallSourceWidth}x${TILE_SPEC.wallSourceHeight}
  logical render box      ${TILE_SPEC.logicalWidth}x${TILE_SPEC.logicalHeight}
  logical footprint       ${TILE_SPEC.logicalWidth}x${TILE_SPEC.logicalFootprintHeight}
`);
}

function createReport() {
  return {
    contractVersion: TILE_SPEC.version,
    errors: [],
    warnings: [],
    info: [],
    checked: {
      metadataFiles: 0,
      metadataAssets: 0,
      imageAssets: 0,
      edgeGroups: 0
    }
  };
}

function addIssue(report, level, code, message, file = null) {
  report[level].push({ code, message, ...(file ? { file } : {}) });
}

function relativeToProject(filePath) {
  const relative = path.relative(PROJECT_ROOT, filePath);
  return relative.startsWith('..') ? filePath : relative;
}

function readJson(filePath, report) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    report.checked.metadataFiles++;
    return parsed;
  } catch (error) {
    addIssue(report, 'errors', 'invalid-json', `Cannot read JSON: ${error.message}`, relativeToProject(filePath));
    return null;
  }
}

function assertContractValue(report, actual, expected, label) {
  if (actual !== expected) {
    addIssue(report, 'errors', 'manifest-contract', `${label} is ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`);
  }
}

function validateManifestContract(manifest, report) {
  const geometry = manifest.geometry || {};
  const logical = geometry.logical || {};
  const sources = geometry.sources || {};
  const floor = sources.floor || {};
  const slope = sources.slope || {};
  const wall = sources.wall || {};

  assertContractValue(report, Number.parseInt(manifest.version, 10), TILE_SPEC.version, 'manifest major version');
  assertContractValue(report, geometry.profile, `iso64-retina-v${TILE_SPEC.version}`, 'geometry.profile');
  assertContractValue(report, geometry.projection, TILE_SPEC.projection, 'geometry.projection');
  assertContractValue(report, geometry.anchor, TILE_SPEC.anchor, 'geometry.anchor');
  assertContractValue(report, geometry.format, 'webp', 'geometry.format');
  assertContractValue(report, geometry.alpha && geometry.alpha.diamond, 'straight-antialiased', 'geometry.alpha.diamond');
  assertContractValue(report, geometry.alpha && geometry.alpha.wall, 'opaque', 'geometry.alpha.wall');
  assertContractValue(report, geometry.sourceScale, 2, 'geometry.sourceScale');
  assertContractValue(report, logical.width, TILE_SPEC.logicalWidth, 'geometry.logical.width');
  assertContractValue(report, logical.height, TILE_SPEC.logicalHeight, 'geometry.logical.height');
  assertContractValue(report, logical.footprintWidth, TILE_SPEC.logicalWidth, 'geometry.logical.footprintWidth');
  assertContractValue(report, logical.footprintHeight, TILE_SPEC.logicalFootprintHeight, 'geometry.logical.footprintHeight');
  assertContractValue(report, floor.width, TILE_SPEC.sourceWidth, 'geometry.sources.floor.width');
  assertContractValue(report, floor.height, TILE_SPEC.sourceHeight, 'geometry.sources.floor.height');
  assertContractValue(report, floor.footprintWidth, TILE_SPEC.sourceWidth, 'geometry.sources.floor.footprintWidth');
  assertContractValue(report, floor.footprintHeight, TILE_SPEC.sourceFootprintHeight, 'geometry.sources.floor.footprintHeight');
  assertContractValue(report, slope.width, TILE_SPEC.sourceWidth, 'geometry.sources.slope.width');
  assertContractValue(report, slope.height, TILE_SPEC.sourceHeight, 'geometry.sources.slope.height');
  assertContractValue(report, slope.footprintWidth, TILE_SPEC.sourceWidth, 'geometry.sources.slope.footprintWidth');
  assertContractValue(report, slope.footprintHeight, TILE_SPEC.sourceFootprintHeight, 'geometry.sources.slope.footprintHeight');
  assertContractValue(report, wall.width, TILE_SPEC.wallSourceWidth, 'geometry.sources.wall.width');
  assertContractValue(report, wall.height, TILE_SPEC.wallSourceHeight, 'geometry.sources.wall.height');

  if (!Array.isArray(manifest.categories) || new Set(manifest.categories).size !== manifest.categories.length) {
    addIssue(report, 'errors', 'manifest-categories', 'manifest.categories must be a unique array');
  }
  if (!Array.isArray(manifest.biomes) || new Set(manifest.biomes).size !== manifest.biomes.length) {
    addIssue(report, 'errors', 'manifest-biomes', 'manifest.biomes must be a unique array');
  }
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function loadMetadata(options, report) {
  const manifestPath = path.join(options.metadataDir, 'manifest.json');
  const manifest = readJson(manifestPath, report);
  if (!manifest) return { manifest: null, assets: [] };

  validateManifestContract(manifest, report);
  const assets = [];
  const outputOwners = new Map();
  const categoryFiles = manifest.categoryFiles || {};

  for (const category of manifest.categories || []) {
    if (!CATEGORIES.has(category)) {
      addIssue(report, 'errors', 'unknown-category', `Unsupported tile category ${JSON.stringify(category)}`);
    }
    const filesByBiome = categoryFiles[category];
    if (!filesByBiome || typeof filesByBiome !== 'object') {
      addIssue(report, 'errors', 'missing-category-files', `No categoryFiles entry for ${category}`);
      continue;
    }

    for (const biome of manifest.biomes || []) {
      const relativeFile = filesByBiome[biome];
      if (!relativeFile) {
        addIssue(report, 'errors', 'missing-biome-file', `No metadata file for ${category}/${biome}`);
        continue;
      }

      const metadataPath = path.resolve(options.metadataDir, relativeFile);
      if (!isInside(options.metadataDir, metadataPath)) {
        addIssue(report, 'errors', 'unsafe-metadata-path', `Metadata path escapes its root: ${relativeFile}`);
        continue;
      }

      const document = readJson(metadataPath, report);
      if (!document) continue;
      if (document.category !== category) {
        addIssue(report, 'errors', 'category-mismatch', `Document category is ${JSON.stringify(document.category)}; expected ${category}`, relativeToProject(metadataPath));
      }
      if (document.biome !== biome) {
        addIssue(report, 'errors', 'biome-mismatch', `Document biome is ${JSON.stringify(document.biome)}; expected ${biome}`, relativeToProject(metadataPath));
      }
      if (!Array.isArray(document.tiles) || document.tiles.length === 0) {
        addIssue(report, 'errors', 'empty-metadata', 'Document must contain a non-empty tiles array', relativeToProject(metadataPath));
        continue;
      }

      const keysInDocument = new Set();
      for (const tile of document.tiles) {
        report.checked.metadataAssets++;
        const key = tile && tile.key;
        if (typeof key !== 'string' || !SAFE_IDENTIFIER.test(key)) {
          addIssue(report, 'errors', 'unsafe-key', `Invalid canonical key ${JSON.stringify(key)}`, relativeToProject(metadataPath));
          continue;
        }
        if (keysInDocument.has(key)) {
          addIssue(report, 'errors', 'duplicate-key', `Duplicate key ${key}`, relativeToProject(metadataPath));
          continue;
        }
        keysInDocument.add(key);

        if (category === 'floors') {
          if (typeof tile.terrain !== 'string' || !SAFE_IDENTIFIER.test(tile.terrain)) {
            addIssue(report, 'errors', 'invalid-terrain', `${key} needs a safe terrain identifier`, relativeToProject(metadataPath));
          }
          if (tile.variant !== undefined && (!Number.isInteger(tile.variant) || tile.variant < 0)) {
            addIssue(report, 'errors', 'invalid-variant', `${key} has invalid variant ${JSON.stringify(tile.variant)}`, relativeToProject(metadataPath));
          }
        } else if (category === 'walls') {
          if (typeof tile.terrain !== 'string' || !SAFE_IDENTIFIER.test(tile.terrain)) {
            addIssue(report, 'errors', 'invalid-terrain', `${key} needs a safe terrain identifier`, relativeToProject(metadataPath));
          }
        } else if (!DIRECTIONS.has(tile.direction)) {
          addIssue(report, 'errors', 'invalid-direction', `${key} has invalid slope direction ${JSON.stringify(tile.direction)}`, relativeToProject(metadataPath));
        }

        const relativeOutput = path.posix.join(biome, `${key}.webp`);
        if (outputOwners.has(relativeOutput)) {
          addIssue(
            report,
            'errors',
            'output-collision',
            `${category}/${biome}/${key} collides with ${outputOwners.get(relativeOutput)}`,
            relativeToProject(metadataPath)
          );
        } else {
          outputOwners.set(relativeOutput, `${category}/${biome}/${key}`);
        }

        assets.push({ ...tile, category, biome, relativeOutput, metadataPath });
      }
    }
  }

  if (manifest.assetCount !== undefined && manifest.assetCount !== assets.length) {
    addIssue(report, 'errors', 'asset-count', `manifest.assetCount is ${manifest.assetCount}; loaded ${assets.length}`);
  }
  if (manifest.categoryCounts) {
    for (const category of manifest.categories || []) {
      const actual = assets.filter(asset => asset.category === category).length;
      if (manifest.categoryCounts[category] !== actual) {
        addIssue(report, 'errors', 'category-count', `categoryCounts.${category} is ${manifest.categoryCounts[category]}; loaded ${actual}`);
      }
    }
  }

  return { manifest, assets };
}

function filterAssets(assets, options, report) {
  const wantedKeys = new Set(options.keys);
  const selected = assets.filter(asset => {
    if (options.biome && asset.biome !== options.biome) return false;
    if (options.category && asset.category !== options.category) return false;
    if (wantedKeys.size > 0 && !wantedKeys.has(asset.key)) return false;
    return true;
  });

  if (options.biome && !assets.some(asset => asset.biome === options.biome)) {
    addIssue(report, 'errors', 'unknown-filter', `No metadata exists for biome ${options.biome}`);
  }
  if (options.category && !CATEGORIES.has(options.category)) {
    addIssue(report, 'errors', 'unknown-filter', `Unknown category ${options.category}`);
  }
  for (const key of wantedKeys) {
    if (!assets.some(asset => asset.key === key)) {
      addIssue(report, 'errors', 'unknown-filter', `No metadata exists for key ${key}`);
    }
  }
  return selected;
}

function getAlphaStats(buffer, width, height) {
  const result = {
    transparent: 0,
    partial: 0,
    opaque: 0,
    minX: width,
    minY: height,
    maxX: -1,
    maxY: -1
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = buffer[(y * width + x) * 4 + 3];
      if (alpha === 0) {
        result.transparent++;
      } else {
        if (alpha === 255) result.opaque++;
        else result.partial++;
        result.minX = Math.min(result.minX, x);
        result.minY = Math.min(result.minY, y);
        result.maxX = Math.max(result.maxX, x);
        result.maxY = Math.max(result.maxY, y);
      }
    }
  }
  return result;
}

function assertImageValue(report, actual, expected, code, label, file) {
  if (actual !== expected) {
    addIssue(report, 'errors', code, `${label} is ${actual}; expected ${expected}`, file);
  }
}

function validateDiamondAlpha(report, stats, file) {
  const top = (TILE_SPEC.sourceHeight - TILE_SPEC.sourceFootprintHeight) / 2;
  assertImageValue(report, stats.transparent, 12160, 'alpha-geometry', 'transparent pixel count', file);
  assertImageValue(report, stats.partial, 256, 'alpha-geometry', 'partially transparent pixel count', file);
  assertImageValue(report, stats.opaque, 3968, 'alpha-geometry', 'opaque pixel count', file);
  assertImageValue(report, stats.minX, 0, 'alpha-bounds', 'alpha minX', file);
  assertImageValue(report, stats.maxX, TILE_SPEC.sourceWidth - 1, 'alpha-bounds', 'alpha maxX', file);
  assertImageValue(report, stats.minY, top, 'alpha-bounds', 'alpha minY', file);
  assertImageValue(report, stats.maxY, top + TILE_SPEC.sourceFootprintHeight - 1, 'alpha-bounds', 'alpha maxY', file);
}

function validateWallAlpha(report, stats, file) {
  assertImageValue(report, stats.transparent, 0, 'alpha-geometry', 'transparent pixel count', file);
  assertImageValue(report, stats.partial, 0, 'alpha-geometry', 'partially transparent pixel count', file);
  assertImageValue(report, stats.opaque, TILE_SPEC.wallSourceWidth * TILE_SPEC.wallSourceHeight, 'alpha-geometry', 'opaque pixel count', file);
}

function getBoundarySignature(buffer) {
  const values = [];
  const halfWidth = TILE_SPEC.sourceWidth / 2;
  const halfFootprint = TILE_SPEC.sourceFootprintHeight / 2;
  const centerY = TILE_SPEC.sourceHeight / 2;

  for (let y = 0; y < TILE_SPEC.sourceHeight; y++) {
    for (let x = 0; x < TILE_SPEC.sourceWidth; x++) {
      const nx = (x + 0.5 - halfWidth) / halfWidth;
      const ny = (y + 0.5 - centerY) / halfFootprint;
      const signedEdge = 1 - Math.abs(nx) - Math.abs(ny);
      const offset = (y * TILE_SPEC.sourceWidth + x) * 4;
      if (buffer[offset + 3] > 0 && signedEdge <= 0.05) {
        values.push(buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]);
      }
    }
  }
  return Buffer.from(values).toString('base64');
}

async function validateImages(assets, options, report) {
  const decodedFloors = [];

  for (const asset of assets) {
    const absolutePath = path.join(options.assetsDir, asset.relativeOutput);
    const displayPath = relativeToProject(absolutePath);
    if (!fs.existsSync(absolutePath)) {
      addIssue(
        report,
        options.allowMissing ? 'warnings' : 'errors',
        'missing-asset',
        `Missing canonical asset ${asset.relativeOutput}`,
        displayPath
      );
      continue;
    }

    try {
      const metadata = await sharp(absolutePath).metadata();
      const expectedWidth = asset.category === 'walls' ? TILE_SPEC.wallSourceWidth : TILE_SPEC.sourceWidth;
      const expectedHeight = asset.category === 'walls' ? TILE_SPEC.wallSourceHeight : TILE_SPEC.sourceHeight;
      report.checked.imageAssets++;

      assertImageValue(report, metadata.format, 'webp', 'image-format', 'image format', displayPath);
      assertImageValue(report, metadata.width, expectedWidth, 'image-width', 'image width', displayPath);
      assertImageValue(report, metadata.height, expectedHeight, 'image-height', 'image height', displayPath);
      assertImageValue(
        report,
        metadata.hasAlpha,
        asset.category !== 'walls',
        'image-alpha',
        'hasAlpha',
        displayPath
      );

      if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) continue;
      const decoded = await sharp(absolutePath).ensureAlpha().raw().toBuffer();
      const stats = getAlphaStats(decoded, expectedWidth, expectedHeight);
      if (asset.category === 'walls') validateWallAlpha(report, stats, displayPath);
      else validateDiamondAlpha(report, stats, displayPath);
      if (asset.category === 'floors') decodedFloors.push({ asset, buffer: decoded, displayPath });
    } catch (error) {
      addIssue(report, 'errors', 'image-decode', `Sharp cannot decode image: ${error.message}`, displayPath);
    }
  }

  const boundaryByTerrain = new Map();
  for (const decoded of decodedFloors) {
    const terrainGroup = `${decoded.asset.biome}/${decoded.asset.terrain}`;
    const signature = getBoundarySignature(decoded.buffer);
    const first = boundaryByTerrain.get(terrainGroup);
    if (!first) {
      boundaryByTerrain.set(terrainGroup, { signature, file: decoded.displayPath, count: 1 });
    } else {
      first.count++;
      if (first.signature !== signature) {
        addIssue(
          report,
          'errors',
          'edge-seam',
          `Boundary pixels differ from ${first.file} for terrain group ${terrainGroup}`,
          decoded.displayPath
        );
      }
    }
  }
  report.checked.edgeGroups = [...boundaryByTerrain.values()].filter(group => group.count > 1).length;
}

function walkImages(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkImages(absolutePath));
    else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolutePath);
  }
  return files;
}

function validateUnexpectedAssets(assets, options, report) {
  if (!options.strict || options.metadataOnly || options.biome || options.category || options.keys.length > 0) return;
  const expected = new Set(assets.map(asset => path.normalize(path.join(options.assetsDir, asset.relativeOutput))));
  for (const imagePath of walkImages(options.assetsDir)) {
    if (expected.has(path.normalize(imagePath))) continue;
    const relative = path.relative(options.assetsDir, imagePath).split(path.sep).join('/');
    const isLegacy = /(?:_elev\d+|_pit)\.(?:png|webp)$/i.test(relative);
    addIssue(
      report,
      'errors',
      isLegacy ? 'legacy-asset' : 'unexpected-asset',
      `${isLegacy ? 'Legacy' : 'Unexpected'} image is outside the canonical metadata contract: ${relative}`,
      relativeToProject(imagePath)
    );
  }
}

async function validate(options) {
  const report = createReport();
  const { manifest, assets } = loadMetadata(options, report);
  if (!manifest) return report;
  const selected = filterAssets(assets, options, report);
  if (selected.length === 0 && report.errors.length === 0) {
    addIssue(report, 'warnings', 'empty-selection', 'No tile assets matched the selected filters');
  }

  if (!options.metadataOnly) await validateImages(selected, options, report);
  validateUnexpectedAssets(assets, options, report);
  addIssue(
    report,
    'info',
    'summary',
    `Loaded ${report.checked.metadataAssets} metadata assets; validated ${report.checked.imageAssets} images and ${report.checked.edgeGroups} multi-variant edge groups`
  );
  return report;
}

function printReport(report, options) {
  if (options.json) {
    console.log(JSON.stringify({ ok: report.errors.length === 0, ...report }, null, 2));
    return;
  }

  console.log(`Canonical isometric tiles v${report.contractVersion}`);
  console.log(`Metadata: ${report.checked.metadataAssets} assets in ${report.checked.metadataFiles} files`);
  console.log(`Images: ${report.checked.imageAssets}; edge groups: ${report.checked.edgeGroups}`);
  console.log(`Result: ${report.errors.length === 0 ? 'PASS' : 'FAIL'} (${report.errors.length} errors, ${report.warnings.length} warnings)`);

  const issues = [...report.errors, ...report.warnings];
  if (options.verbose || issues.length > 0) {
    for (const issue of issues) {
      const location = issue.file ? ` [${issue.file}]` : '';
      console.log(`  ${issue.code}: ${issue.message}${location}`);
    }
  }
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
    showHelp();
    return;
  }

  const report = await validate(options);
  printReport(report, options);
  if (report.errors.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseArgs,
  validate,
  getAlphaStats,
  getBoundarySignature
};
