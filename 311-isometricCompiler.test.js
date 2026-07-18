const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, it } = require('node:test');
const sharp = require('sharp');
const { getAssetImagePath } = require('../ai-images/lib/backupUtils');
const { assertCompleteCanonicalMetadata } = require('./generate-isometric-tiles');

const {
  TILE_SPEC,
  inferMaterial,
  inferWallPattern,
  getCompiledOutputPath,
  compileTileAsset,
  createFloorBuffer,
  createWallBuffer,
  createSlopeBuffer
} = require('./isometricCompiler');

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'modia-isometric-tiles-'));
  temporaryDirectories.push(directory);
  return directory;
}

function rgbaAt(buffer, width, x, y) {
  const offset = (y * width + x) * 4;
  return [...buffer.subarray(offset, offset + 4)];
}

function getAlphaStats(buffer, width, height) {
  const stats = {
    transparent: 0,
    partial: 0,
    opaque: 0,
    bounds: { minX: width, minY: height, maxX: -1, maxY: -1 }
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = buffer[(y * width + x) * 4 + 3];
      if (alpha === 0) {
        stats.transparent++;
        continue;
      }

      if (alpha === 255) stats.opaque++;
      else stats.partial++;
      stats.bounds.minX = Math.min(stats.bounds.minX, x);
      stats.bounds.minY = Math.min(stats.bounds.minY, y);
      stats.bounds.maxX = Math.max(stats.bounds.maxX, x);
      stats.bounds.maxY = Math.max(stats.bounds.maxY, y);
    }
  }

  return stats;
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function averageRgbDifference(first, second) {
  return (Math.abs(first[0] - second[0]) +
    Math.abs(first[1] - second[1]) +
    Math.abs(first[2] - second[2])) / 3;
}

function wallWrapDifference(buffer, axis) {
  const width = TILE_SPEC.wallSourceWidth;
  const height = TILE_SPEC.wallSourceHeight;
  const differences = [];

  if (axis === 'horizontal') {
    for (let y = 0; y < height; y++) {
      differences.push(averageRgbDifference(
        rgbaAt(buffer, width, width - 1, y),
        rgbaAt(buffer, width, 0, y)
      ));
    }
  } else {
    for (let x = 0; x < width; x++) {
      differences.push(averageRgbDifference(
        rgbaAt(buffer, width, x, height - 1),
        rgbaAt(buffer, width, x, 0)
      ));
    }
  }

  return {
    average: differences.reduce((sum, value) => sum + value, 0) / differences.length,
    maximum: Math.max(...differences)
  };
}

function assertCanonicalDiamond(buffer) {
  assert.equal(buffer.length, TILE_SPEC.sourceWidth * TILE_SPEC.sourceHeight * 4);
  assert.deepEqual(
    getAlphaStats(buffer, TILE_SPEC.sourceWidth, TILE_SPEC.sourceHeight),
    {
      transparent: 12160,
      partial: 256,
      opaque: 3968,
      bounds: { minX: 0, minY: 32, maxX: 127, maxY: 95 }
    }
  );
  assert.deepEqual(rgbaAt(buffer, TILE_SPEC.sourceWidth, 0, 0), [0, 0, 0, 0]);
  assert.equal(rgbaAt(buffer, TILE_SPEC.sourceWidth, 64, 64)[3], 255);
}

describe('isometric material compiler', () => {
  it('publishes the versioned 2:1 retina geometry contract', () => {
    assert.equal(Object.isFrozen(TILE_SPEC), true);
    assert.deepEqual(TILE_SPEC, {
      version: 3,
      logicalWidth: 64,
      logicalHeight: 64,
      logicalFootprintHeight: 32,
      sourceWidth: 128,
      sourceHeight: 128,
      sourceFootprintHeight: 64,
      wallSourceWidth: 128,
      wallSourceHeight: 32,
      projection: '2:1-diamond',
      anchor: 'center'
    });
  });

  it('infers material details without losing the explicit terrain contract', () => {
    assert.equal(inferMaterial({ key: 'water_0', terrain: 'water' }), 'water');
    assert.equal(inferMaterial({ key: 'floor_0', terrain: 'rock', prompt: 'glacial ice shelf' }), 'ice');
    assert.equal(inferMaterial({ key: 'floor_0', terrain: 'tree', prompt: 'wooden planks' }), 'plank');
    assert.equal(inferMaterial({ key: 'grass_0', terrain: 'grass', prompt: 'moss and fern' }), 'grass');
  });

  it('distinguishes built masonry, natural strata, and timber wall materials', () => {
    assert.equal(inferWallPattern({
      key: 'wall_castle_stone', terrain: 'stone', prompt: 'fitted stone blocks with mortar'
    }, 'castle'), 'masonry');
    assert.equal(inferWallPattern({
      key: 'wall_bridge_stone', terrain: 'stone', prompt: 'carved stone bridge abutment'
    }, 'bridge'), 'masonry');
    assert.equal(inferWallPattern({
      key: 'wall_forest_default', terrain: 'default', prompt: 'earth cliff with grass roots'
    }, 'forest'), 'strata');
    assert.equal(inferWallPattern({
      key: 'wall_cave_rock', terrain: 'rock', prompt: 'rough natural cave rock'
    }, 'cave'), 'strata');
    assert.equal(inferWallPattern({
      key: 'wall_bridge_default', terrain: 'default', prompt: 'weathered wooden support'
    }, 'bridge'), 'timber');
    assert.equal(inferWallPattern({
      key: 'wall_castle_tree', terrain: 'tree', prompt: 'wooden rampart with iron fittings'
    }, 'castle'), 'timber');
  });

  it('creates a centered antialiased diamond with exact alpha coverage', () => {
    const floor = createFloorBuffer({ key: 'grass_0', terrain: 'grass' }, 'forest');
    assertCanonicalDiamond(floor);
  });

  it('is byte-deterministic and uses the asset identity for interior variation', () => {
    const asset = { key: 'grass_0', terrain: 'grass', seed: 17 };
    const first = createFloorBuffer(asset, 'forest');
    const second = createFloorBuffer(asset, 'forest');
    const variant = createFloorBuffer({ ...asset, key: 'grass_1' }, 'forest');

    assert.equal(digest(first), digest(second));
    assert.notEqual(digest(first), digest(variant));
  });

  it('keeps same-terrain variant boundaries byte-identical even when material details differ', () => {
    const iceDetail = createFloorBuffer({
      key: 'rock_0',
      terrain: 'rock',
      prompt: 'glacial ice shelf'
    }, 'mountain');
    const stoneDetail = createFloorBuffer({
      key: 'rock_1',
      terrain: 'rock',
      prompt: 'weathered stone outcrop'
    }, 'mountain');

    let comparedBoundaryPixels = 0;
    let changedInteriorPixels = 0;
    const halfWidth = TILE_SPEC.sourceWidth / 2;
    const halfFootprint = TILE_SPEC.sourceFootprintHeight / 2;
    const centerY = TILE_SPEC.sourceHeight / 2;

    for (let y = 0; y < TILE_SPEC.sourceHeight; y++) {
      for (let x = 0; x < TILE_SPEC.sourceWidth; x++) {
        const nx = (x + 0.5 - halfWidth) / halfWidth;
        const ny = (y + 0.5 - centerY) / halfFootprint;
        const signedEdge = 1 - Math.abs(nx) - Math.abs(ny);
        const first = rgbaAt(iceDetail, TILE_SPEC.sourceWidth, x, y);
        const second = rgbaAt(stoneDetail, TILE_SPEC.sourceWidth, x, y);

        if (first[3] > 0 && signedEdge <= 0.05) {
          comparedBoundaryPixels++;
          assert.deepEqual(second, first, `boundary mismatch at ${x},${y}`);
        } else if (signedEdge >= 0.35 && first.some((value, index) => value !== second[index])) {
          changedInteriorPixels++;
        }
      }
    }

    assert.ok(comparedBoundaryPixels >= 250, `only compared ${comparedBoundaryPixels} boundary pixels`);
    assert.ok(changedInteriorPixels >= 500, `only found ${changedInteriorPixels} changed interior pixels`);
  });

  it('creates a fully opaque wall strip at the canonical source size', () => {
    const wall = createWallBuffer({ key: 'wall_castle_stone', terrain: 'stone' }, 'castle');
    const stats = getAlphaStats(wall, TILE_SPEC.wallSourceWidth, TILE_SPEC.wallSourceHeight);

    assert.equal(wall.length, TILE_SPEC.wallSourceWidth * TILE_SPEC.wallSourceHeight * 4);
    assert.deepEqual(stats, {
      transparent: 0,
      partial: 0,
      opaque: 4096,
      bounds: { minX: 0, minY: 0, maxX: 127, maxY: 31 }
    });
    assert.notDeepEqual(
      rgbaAt(wall, TILE_SPEC.wallSourceWidth, 8, 8),
      rgbaAt(wall, TILE_SPEC.wallSourceWidth, 64, 24)
    );
  });

  it('keeps every wall material continuous across both repeated strip axes', () => {
    const cases = [
      [{ key: 'wall_castle_stone', terrain: 'stone' }, 'castle'],
      [{ key: 'wall_forest_default', terrain: 'grass' }, 'forest'],
      [{ key: 'wall_bridge_wood', terrain: 'tree' }, 'bridge']
    ];

    for (const [asset, biome] of cases) {
      const wall = createWallBuffer(asset, biome);
      const horizontal = wallWrapDifference(wall, 'horizontal');
      const vertical = wallWrapDifference(wall, 'vertical');

      assert.ok(horizontal.average <= 4, `${biome} horizontal average is ${horizontal.average}`);
      assert.ok(horizontal.maximum <= 13, `${biome} horizontal maximum is ${horizontal.maximum}`);
      assert.ok(vertical.average <= 4, `${biome} vertical average is ${vertical.average}`);
      assert.ok(vertical.maximum <= 13, `${biome} vertical maximum is ${vertical.maximum}`);
    }
  });

  it('preserves the diamond mask while making slopes directional', () => {
    const base = { key: 'slope_forest_north_1', terrain: 'grass', direction: 'north' };
    const north = createSlopeBuffer(base, 'forest');
    const south = createSlopeBuffer({ ...base, key: 'slope_forest_south_1', direction: 'south' }, 'forest');

    assertCanonicalDiamond(north);
    assertCanonicalDiamond(south);
    assert.notEqual(digest(north), digest(south));
    for (let pixel = 0; pixel < TILE_SPEC.sourceWidth * TILE_SPEC.sourceHeight; pixel++) {
      assert.equal(north[pixel * 4 + 3], south[pixel * 4 + 3], `alpha differs at pixel ${pixel}`);
    }
  });

  it('uses one flat canonical WebP path per biome and asset key', () => {
    const outputDirectory = path.join('/project', 'terrain');
    assert.equal(
      getCompiledOutputPath(outputDirectory, { key: 'grass_2', _tileCategory: 'floors' }, 'forest'),
      path.join(outputDirectory, 'forest', 'grass_2.webp')
    );
    assert.equal(
      getCompiledOutputPath(outputDirectory, { id: 'wall_castle_stone', _tileCategory: 'walls' }, 'castle'),
      path.join(outputDirectory, 'castle', 'wall_castle_stone.webp')
    );
  });

  it('routes tile backups to the canonical WebP instead of a legacy PNG', () => {
    const imagePath = getAssetImagePath({
      id: 'grass_0',
      _category: 'tiles',
      _biome: 'forest',
      _tileCategory: 'floors'
    });

    assert.equal(path.extname(imagePath), '.webp');
    assert.equal(path.basename(imagePath), 'grass_0.webp');
    assert.equal(fs.existsSync(imagePath), true);
  });

  it('fails a destructive prune closed when a manifest document is incomplete', () => {
    const manifest = {
      assetCount: 1,
      categoryCounts: { floors: 1 },
      categories: ['floors'],
      biomes: ['forest'],
      categoryFiles: { floors: { forest: 'floors/forest.json' } }
    };
    const complete = {
      manifest,
      tiles: [{
        id: 'grass_0',
        _tileCategory: 'floors',
        _biome: 'forest'
      }]
    };

    assert.doesNotThrow(() => assertCompleteCanonicalMetadata(complete));
    assert.throws(
      () => assertCompleteCanonicalMetadata({ manifest, tiles: [] }),
      /Refusing --prune: canonical tile metadata is incomplete/
    );
    assert.throws(
      () => assertCompleteCanonicalMetadata({
        manifest: { ...manifest, assetCount: 2, categoryCounts: { floors: 2 } },
        tiles: [complete.tiles[0], complete.tiles[0]]
      }),
      /duplicate output forest\/grass_0\.webp/
    );
  });

  it('encodes lossless floor, wall, and slope WebPs with the declared geometry', async () => {
    const directory = createTemporaryDirectory();
    const cases = [
      {
        asset: { key: 'grass_0', terrain: 'grass', _tileCategory: 'floors' },
        biome: 'forest',
        width: TILE_SPEC.sourceWidth,
        height: TILE_SPEC.sourceHeight,
        alpha: 'diamond'
      },
      {
        asset: { key: 'wall_castle_stone', terrain: 'stone', _tileCategory: 'walls' },
        biome: 'castle',
        width: TILE_SPEC.wallSourceWidth,
        height: TILE_SPEC.wallSourceHeight,
        alpha: 'opaque'
      },
      {
        asset: { key: 'stairs_cave_east_2', direction: 'east', type: 'stairs', _tileCategory: 'slopes' },
        biome: 'cave',
        width: TILE_SPEC.sourceWidth,
        height: TILE_SPEC.sourceHeight,
        alpha: 'diamond'
      }
    ];

    for (const testCase of cases) {
      const outputPath = getCompiledOutputPath(directory, testCase.asset, testCase.biome);
      const result = await compileTileAsset(testCase.asset, testCase.biome, outputPath);
      const metadata = await sharp(outputPath).metadata();
      const decoded = await sharp(outputPath).ensureAlpha().raw().toBuffer();

      assert.deepEqual(result, {
        success: true,
        outputPath,
        width: testCase.width,
        height: testCase.height
      });
      assert.equal(metadata.format, 'webp');
      assert.equal(metadata.width, testCase.width);
      assert.equal(metadata.height, testCase.height);
      assert.equal(metadata.hasAlpha, testCase.alpha === 'diamond');
      if (testCase.alpha === 'diamond') {
        assertCanonicalDiamond(decoded);
      } else {
        assert.equal(
          getAlphaStats(decoded, testCase.width, testCase.height).opaque,
          testCase.width * testCase.height
        );
      }

      const firstEncoding = fs.readFileSync(outputPath);
      await compileTileAsset(testCase.asset, testCase.biome, outputPath);
      assert.equal(digest(fs.readFileSync(outputPath)), digest(firstEncoding));
    }
  });

  it('does not create directories or files during a dry run', async () => {
    const directory = createTemporaryDirectory();
    const outputPath = path.join(directory, 'not-created', 'grass_0.webp');
    const result = await compileTileAsset(
      { key: 'grass_0', terrain: 'grass', _tileCategory: 'floors' },
      'forest',
      outputPath,
      { dryRun: true }
    );

    assert.equal(result.dryRun, true);
    assert.equal(fs.existsSync(outputPath), false);
    assert.equal(fs.existsSync(path.dirname(outputPath)), false);
  });
});
