const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const {
  translateLegacyAiTileArgs,
  translateLegacyValidatorArgs
} = require('./legacyTileAdapters');
const { OBSTACLES_DIR, parseArgs } = require('./generate-tiles');
const { buildCategoryArgs } = require('../ai-images/generate-all');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function run(relativeScript, args) {
  return spawnSync(process.execPath, [path.join(PROJECT_ROOT, relativeScript), ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8'
  });
}

describe('legacy tile entry-point adapters', () => {
  it('translates safe AI-era selectors into canonical compiler arguments', () => {
    assert.deepEqual(
      translateLegacyAiTileArgs([
        '--biome=forest', '--category', 'walls', '--key=wall_forest_default',
        '--dry-run', '--force'
      ]),
      [
        '--biome', 'forest', '--category', 'walls', '--key', 'wall_forest_default',
        '--dry-run', '--force'
      ]
    );
  });

  it('rejects AI-only controls with an actionable material-compiler message', () => {
    assert.throws(
      () => translateLegacyAiTileArgs(['--huggingface', '--lora', 'v2']),
      /deterministic iso64-retina-v3 material compiler/
    );
  });

  it('maps the legacy validator fix flag to a strict read-only audit', () => {
    assert.deepEqual(
      translateLegacyValidatorArgs(['--fix', '--metadata-only']),
      ['--strict', '--verbose', '--metadata-only']
    );
  });

  it('keeps obstacle-only mode separate from canonical terrain arguments', () => {
    const parsed = parseArgs(['--obstacles', '--force', '--verbose']);
    assert.equal(parsed.obstaclesOnly, true);
    assert.equal(parsed.terrainOnly, false);
    assert.deepEqual(parsed.canonicalArgs, ['--force', '--verbose']);
    assert.equal(
      OBSTACLES_DIR,
      path.join(PROJECT_ROOT, 'frontend/public/assets/obstacles')
    );
  });

  it('closes tile metadata status when aggregate generation delegates to the compiler', () => {
    assert.deepEqual(
      buildCategoryArgs('tiles', {
        dryRun: false,
        force: true,
        verbose: false,
        quiet: false,
        delay: 2000,
        huggingface: false,
        local: true
      }),
      ['--force', '--update-metadata']
    );
  });

  it('delegates the retired AI generator help to the canonical compiler', () => {
    const result = run('scripts/ai-images/generate-tiles.js', ['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Canonical v3 geometry|Isometric Tile Material Compiler/);
    assert.match(result.stderr, /delegates/);
  });

  it('rejects AI generation controls at the retired executable boundary', () => {
    const result = run('scripts/ai-images/generate-tiles.js', ['--huggingface']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Legacy AI option --huggingface/);
    assert.match(result.stderr, /deterministic iso64-retina-v3 material compiler/);
  });

  it('delegates the retired validator help to the canonical validator', () => {
    const result = run('scripts/ai-images/validate-tile-system.js', ['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Canonical Isometric Tile Validator/);
  });

  it('routes procedural terrain mode through a write-free canonical dry run', () => {
    const result = run('scripts/tiles/generate-tiles.js', [
      '--terrain', '--dry-run', '--biome', 'forest', '--category', 'walls',
      '--key', 'wall_forest_default', '--verbose'
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /Delegating terrain to the canonical v3 compiler/);
    assert.match(result.stdout, /Would compile 1\/1 asset\(s\)/);
  });

  it('shows the compatibility command help without running either generator', () => {
    const result = run('scripts/tiles/generate-tiles.js', ['--help']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Legacy Tile\/Obstacle Compatibility Command/);
    assert.match(result.stdout, /--obstacles/);
  });

  it('rejects invalid canonical selectors instead of silently compiling nothing', () => {
    const invalidBiome = run('scripts/tiles/generate-isometric-tiles.js', [
      '--biome', 'abyss', '--dry-run'
    ]);
    assert.equal(invalidBiome.status, 1);
    assert.match(invalidBiome.stderr, /Unsupported tile biome "abyss"/);

    const invalidKey = run('scripts/tiles/generate-isometric-tiles.js', [
      '--key=missing_tile', '--dry-run'
    ]);
    assert.equal(invalidKey.status, 1);
    assert.match(invalidKey.stderr, /Unknown tile key: missing_tile/);

    const missingValue = run('scripts/tiles/generate-isometric-tiles.js', ['--category']);
    assert.equal(missingValue.status, 1);
    assert.match(missingValue.stderr, /--category requires a value/);
  });
});
