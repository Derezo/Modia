const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, it } = require('node:test');
const sharp = require('sharp');

const { compileTileAsset } = require('./isometricCompiler');
const { parseArgs, validate } = require('./validate-isometric-tiles');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const METADATA_DIR = path.join(PROJECT_ROOT, 'ai-image-metadata/tiles');
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createAssetsDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'modia-tile-validator-'));
  temporaryDirectories.push(directory);
  return directory;
}

function options(overrides = {}) {
  return {
    metadataDir: METADATA_DIR,
    assetsDir: createAssetsDirectory(),
    metadataOnly: false,
    allowMissing: false,
    strict: false,
    verbose: false,
    json: false,
    help: false,
    biome: 'forest',
    category: 'floors',
    keys: ['grass_0'],
    ...overrides
  };
}

function codes(issues) {
  return issues.map(issue => issue.code);
}

describe('canonical isometric tile validator', () => {
  it('parses filters and fixture directory overrides', () => {
    assert.deepEqual(
      parseArgs([
        '--assets-dir', '/tmp/tiles',
        '--metadata-dir=/tmp/metadata',
        '--biome=forest',
        '--category', 'floors',
        '--key=grass_0',
        '--key', 'grass_1',
        '--allow-missing',
        '--strict',
        '--json'
      ]),
      {
        metadataDir: '/tmp/metadata',
        assetsDir: '/tmp/tiles',
        metadataOnly: false,
        allowMissing: true,
        strict: true,
        verbose: false,
        json: true,
        help: false,
        biome: 'forest',
        category: 'floors',
        keys: ['grass_0', 'grass_1']
      }
    );
    assert.throws(() => parseArgs(['--not-real']), /Unknown option/);
    assert.throws(() => parseArgs(['--key']), /requires a value/);
  });

  it('validates the repository metadata against the compiler contract', async () => {
    const report = await validate(options({ metadataOnly: true }));

    assert.equal(report.errors.length, 0);
    assert.equal(report.warnings.length, 0);
    assert.equal(report.checked.metadataFiles, 16);
    assert.equal(report.checked.metadataAssets, 281);
  });

  it('accepts a compiler-produced lossless WebP', async () => {
    const testOptions = options();
    const outputPath = path.join(testOptions.assetsDir, 'forest/grass_0.webp');
    await compileTileAsset(
      { key: 'grass_0', terrain: 'grass', _tileCategory: 'floors' },
      'forest',
      outputPath
    );

    const report = await validate(testOptions);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.warnings, []);
    assert.equal(report.checked.imageAssets, 1);
  });

  it('rejects a stale 64x64 opaque tile with actionable issue codes', async () => {
    const testOptions = options();
    const outputPath = path.join(testOptions.assetsDir, 'forest/grass_0.webp');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 3,
        background: { r: 100, g: 130, b: 70 }
      }
    }).webp({ lossless: true }).toFile(outputPath);

    const report = await validate(testOptions);
    assert.deepEqual(codes(report.errors), ['image-width', 'image-height', 'image-alpha']);
    assert.equal(report.checked.imageAssets, 1);
  });

  it('can audit incomplete fixture directories without hiding missing assets', async () => {
    const report = await validate(options({ allowMissing: true }));

    assert.deepEqual(report.errors, []);
    assert.deepEqual(codes(report.warnings), ['missing-asset']);
    assert.match(report.warnings[0].message, /forest\/grass_0\.webp/);
  });
});
