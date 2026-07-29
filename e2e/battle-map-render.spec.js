import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const NODE_TYPES = Object.freeze([
  'forest',
  'cave',
  'mountain',
  'bridge',
  'castle',
  'dungeon',
  'swamp',
  'volcano',
  'plains',
  'arena',
  'guild',
  'elven_grove',
  'dwarven_mine',
  'vampiric_crypt',
  'orcish_warcamp',
  'human_ruins'
]);
const SEEDS = Object.freeze([0, 997]);
const ARTIFACT_ROOT = path.resolve(
  process.env.BATTLE_MAP_VISUAL_OUTPUT_DIR ??
    'artifacts/battle-map-visual-gallery'
);
const SCREENSHOT_ROOT = path.join(ARTIFACT_ROOT, 'screenshots');
const MANIFEST_PATH = path.join(ARTIFACT_ROOT, 'manifest.json');

test.describe.configure({ mode: 'serial' });

test('renders the fixed and holdout V2 gallery with production BattleGrid', async ({
  page
}) => {
  test.setTimeout(12 * 60 * 1000);
  await mkdir(SCREENSHOT_ROOT, { recursive: true });

  const apiRequests = [];
  const exactAssetErrors = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) {
      apiRequests.push(request.url());
    }
  });
  page.on('console', message => {
    if (
      /Exact V2 asset not found|Failed to load exact V2 asset|Exact V2 connection sprite not found|Failed to load exact V2 connection sprite/.test(
        message.text()
      )
    ) {
      exactAssetErrors.push(message.text());
    }
  });

  await page.goto('/battle-map-visual.html?autorun=0');
  await expect
    .poll(() =>
      page.evaluate(() => typeof window.renderBattleMapVisual)
    )
    .toBe('function');

  const manifest = {
    schemaVersion: 1,
    renderer: 'frontend/src/battle/BattleGrid.js',
    assetLoader: 'frontend/src/core/AssetLoader.js',
    adapter: 'shared/battleMap/BattleMapAdapter.js',
    mapProfile: {
      width: 32,
      height: 32,
      mode: 'pve',
      seeds: [...SEEDS],
      nodeTypes: [...NODE_TYPES]
    },
    entries: []
  };

  try {
    for (const seed of SEEDS) {
      for (const nodeType of NODE_TYPES) {
        const result = await page.evaluate(
          request => window.renderBattleMapVisual(request),
          {
            nodeType,
            terrainSeed: seed,
            mapWidth: 32,
            mapHeight: 32,
            mode: 'pve'
          }
        );
        await expect(page.locator('body')).toHaveAttribute(
          'data-status',
          'ready'
        );
        await expect(page.locator('body')).toHaveAttribute(
          'data-rendered-node-type',
          nodeType
        );
        await expect(page.locator('body')).toHaveAttribute(
          'data-rendered-seed',
          String(seed)
        );
        expect(result.error).toBeUndefined();
        expect(result.battleMapSchemaVersion).toBe(2);
        expect(result.terrainGenerationVersion).toBe(2);
        expect(result.qualityScore).toBeGreaterThanOrEqual(0);
        expect(result.authoritativeHash).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(result.visualHash).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(result.fullHash).toMatch(/^sha256:[a-f0-9]{64}$/);

        const filename = `${nodeType}--seed-${seed}.png`;
        await page.locator('.capture').screenshot({
          animations: 'disabled',
          path: path.join(SCREENSHOT_ROOT, filename)
        });
        manifest.entries.push({
          ...result,
          screenshot: `screenshots/${filename}`
        });
      }
    }
  } finally {
    await writeFile(
      MANIFEST_PATH,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );
  }

  expect(manifest.entries).toHaveLength(NODE_TYPES.length * SEEDS.length);
  expect(new Set(manifest.entries.map(entry => entry.nodeType))).toEqual(
    new Set(NODE_TYPES)
  );
  expect(new Set(manifest.entries.map(entry => entry.seed))).toEqual(
    new Set(SEEDS)
  );
  expect(apiRequests).toEqual([]);
  expect(exactAssetErrors).toEqual([]);
});
