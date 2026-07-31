import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_ROOT = path.join(PROJECT_ROOT, 'frontend/public');
const METADATA_ROOT = path.join(PROJECT_ROOT, 'ai-image-metadata/fishing');

const BACKGROUND_IDS = [
  'heartlands',
  'sylvan_reaches',
  'iron_depths',
  'shadowmere',
  'bloodplains'
];

const GEAR_IDS = [
  'fishing_rod_weathered',
  'fishing_rod_riverwood',
  'fishing_rod_silverline',
  'fishing_rod_runebound',
  'fishing_tackle_earthworm',
  'fishing_tackle_slime_slug',
  'fishing_tackle_gilded_spinner',
  'fishing_tackle_abyssal_lure'
];

async function readJson(filename) {
  return JSON.parse(await fs.readFile(path.join(METADATA_ROOT, filename), 'utf8'));
}

function publicPath(assetPath) {
  assert.match(assetPath, /^\/assets\//);
  return path.join(PUBLIC_ROOT, assetPath);
}

async function inspectAlpha(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({
    resolveWithObject: true
  });
  let foregroundPixels = 0;
  let borderMaximumAlpha = 0;
  for (let offset = 3; offset < data.length; offset += 4) {
    if (data[offset] > 16) foregroundPixels += 1;
  }
  const alphaAt = (x, y) => data[((y * info.width) + x) * 4 + 3];
  for (let offset = 0; offset < info.width; offset += 1) {
    borderMaximumAlpha = Math.max(
      borderMaximumAlpha,
      alphaAt(offset, 0),
      alphaAt(offset, info.height - 1)
    );
  }
  for (let offset = 0; offset < info.height; offset += 1) {
    borderMaximumAlpha = Math.max(
      borderMaximumAlpha,
      alphaAt(0, offset),
      alphaAt(info.width - 1, offset)
    );
  }
  return {
    foregroundCoverage: foregroundPixels / (info.width * info.height),
    borderMaximumAlpha,
    corners: [
      alphaAt(0, 0),
      alphaAt(info.width - 1, 0),
      alphaAt(0, info.height - 1),
      alphaAt(info.width - 1, info.height - 1)
    ]
  };
}

test('fishing background metadata and optimized files satisfy the runtime contract', async () => {
  const manifest = await readJson('manifest.json');
  const metadata = await readJson(manifest.backgrounds);

  assert.deepEqual(metadata.assets.map(asset => asset.id), BACKGROUND_IDS);
  assert.equal(new Set(metadata.assets.map(asset => asset.path)).size, BACKGROUND_IDS.length);

  for (const asset of metadata.assets) {
    assert.ok(asset.prompt.startsWith('Use case: stylized-concept\n'));
    assert.match(asset.prompt, /800x600 logical viewport/);
    assert.match(asset.prompt, /No characters/);
    assert.match(asset.prompt, /No photorealism and no 3D rendering/);

    const file = publicPath(asset.path);
    const [stat, raster] = await Promise.all([fs.stat(file), sharp(file).metadata()]);
    assert.equal(raster.format, manifest.backgroundContract.format, asset.id);
    assert.equal(raster.width, manifest.backgroundContract.width, asset.id);
    assert.equal(raster.height, manifest.backgroundContract.height, asset.id);
    assert.ok(stat.size <= manifest.backgroundContract.maximumBytes, `${asset.id}: ${stat.size} bytes`);
  }
});

test('fishing gear icon metadata covers distinct transparent 32/64/128 variants', async () => {
  const manifest = await readJson('manifest.json');
  const metadata = await readJson(manifest.gearIcons);
  const contentHashes = new Set();

  assert.deepEqual(metadata.assets.map(asset => asset.id), GEAR_IDS);

  for (const asset of metadata.assets) {
    assert.ok(asset.prompt.startsWith('Use case: stylized-concept\n'));
    assert.match(asset.prompt, /chroma-key background for background removal/);
    assert.match(asset.prompt, /no cast shadow/);

    for (const size of manifest.gearIconContract.sizes) {
      const file = publicPath(asset.paths[String(size)]);
      const [buffer, raster] = await Promise.all([fs.readFile(file), sharp(file).metadata()]);
      const alpha = await inspectAlpha(file);

      assert.equal(raster.format, manifest.gearIconContract.format, `${asset.id}:${size}`);
      assert.equal(raster.width, size, `${asset.id}:${size}`);
      assert.equal(raster.height, size, `${asset.id}:${size}`);
      assert.equal(raster.hasAlpha, true, `${asset.id}:${size}`);
      assert.ok(alpha.foregroundCoverage > 0.05, `${asset.id}:${size} too sparse`);
      assert.ok(alpha.foregroundCoverage < 0.75, `${asset.id}:${size} lacks padding`);
      assert.ok(alpha.corners.every(value => value === 0), `${asset.id}:${size} corners not transparent`);
      assert.equal(alpha.borderMaximumAlpha, 0, `${asset.id}:${size} foreground touches canvas edge`);

      if (size === 128) {
        contentHashes.add(crypto.createHash('sha256').update(buffer).digest('hex'));
      }
    }

    const original = sharp(publicPath(asset.paths.original));
    const originalMetadata = await original.metadata();
    assert.equal(originalMetadata.width, 512, `${asset.id}:original`);
    assert.equal(originalMetadata.height, 512, `${asset.id}:original`);
    assert.equal(originalMetadata.hasAlpha, true, `${asset.id}:original`);
  }

  assert.equal(contentHashes.size, GEAR_IDS.length, 'gear icons must be visually distinct files');
});
