const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CATEGORY_METADATA,
  createCharacterValidationResult,
  isCharacterRuntimeIssue,
  validateCategory
} = require('./validate-asset-paths');

function makeRuntimeReport(issues = []) {
  return {
    summary: {
      players: {
        variants: 300,
        expectedSheets: 1456,
        presentSheets: 1456,
        validSheets: 1455
      },
      enemies: {
        authoredProvenance: {
          runtimeIdentities: 16,
          completeIdentities: 16
        },
        uniqueResolvedSheets: 80,
        validResolvedSheets: 79
      }
    },
    issues
  };
}

test('characters category no longer declares legacy top-level registry metadata', () => {
  assert.deepEqual(CATEGORY_METADATA.characters, {
    canonicalRuntimeValidation: true
  });
});

test('overlay metadata routes through its declared subcategory', () => {
  assert.equal(
    CATEGORY_METADATA.overlays.getSubcategory({
      category: 'overlays',
      subcategory: 'augments'
    }),
    'augments'
  );
  assert.equal(
    CATEGORY_METADATA.overlays.getSubcategory({
      category: 'overlays',
      subcategory: 'rarity'
    }),
    'rarity'
  );
});

test('character runtime issue routing includes authored characters but not unrelated assets', () => {
  assert.equal(isCharacterRuntimeIssue({ scope: 'players', code: 'player_sheet_missing' }), true);
  assert.equal(isCharacterRuntimeIssue({ scope: 'enemies', code: 'enemy_authored_spec_missing' }), true);
  assert.equal(isCharacterRuntimeIssue({ scope: 'metadata', code: 'sprite_contract' }), true);
  assert.equal(isCharacterRuntimeIssue({ scope: 'metadata', code: 'item_manifest_count_mismatch' }), false);
  assert.equal(isCharacterRuntimeIssue({ scope: 'items', code: 'item_size_missing' }), false);
});

test('canonical character report fails only on character-scoped runtime errors', () => {
  const report = makeRuntimeReport([
    {
      severity: 'error',
      scope: 'enemies',
      code: 'enemy_authored_sources_incomplete',
      id: 'forest_slime',
      message: 'forest_slime has incomplete authored sources'
    },
    {
      severity: 'warning',
      scope: 'players',
      code: 'player_orphan_file',
      path: 'frontend/public/assets/characters/player/legacy.webp',
      message: 'legacy player file is unreferenced'
    },
    {
      severity: 'error',
      scope: 'items',
      code: 'item_size_missing',
      id: 'iron_sword',
      message: 'unrelated item error'
    }
  ]);

  const result = createCharacterValidationResult(report);

  assert.equal(result.validator, 'canonical-strict-runtime');
  assert.equal(result.valid, 1534);
  assert.equal(result.totalMetadata, 316);
  assert.equal(result.totalFiles, 1536);
  assert.equal(result.canonicalSummary.status, 'fail');
  assert.equal(result.canonicalSummary.errors, 1);
  assert.equal(result.canonicalSummary.warnings, 1);
  assert.deepEqual(result.missing.map(issue => issue.code), [
    'enemy_authored_sources_incomplete'
  ]);
  assert.deepEqual(result.orphaned.map(issue => issue.code), [
    'player_orphan_file'
  ]);
});

test('validateCategory delegates characters to the injected canonical runtime report', async () => {
  const result = await validateCategory('characters', {
    runtimeReport: makeRuntimeReport([])
  });

  assert.equal(result.category, 'characters');
  assert.equal(result.validator, 'canonical-strict-runtime');
  assert.equal(result.canonicalSummary.status, 'pass');
  assert.equal(result.missing.length, 0);
});
