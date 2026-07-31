import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  checkV3ArchitectureSources,
  findV3ArchitectureViolations,
  isProductionSourcePath,
  V3_ARCHITECTURE_CHECKER_ALLOWLIST,
  V3_BATTLE_MAP_GENERATION_SERVICE_PATH,
  V3_PRODUCTION_SELECTOR_PATH,
  V3_TRACKED_CATALOG_RUNTIME_PATH
} from './check-v3-architecture.js';

function codes(source, filePath = 'api/src/battle/createBattleMapV3.js') {
  return findV3ArchitectureViolations(source, { filePath })
    .map(violation => violation.code);
}

async function actualCatalogFlowSources() {
  const paths = [
    V3_PRODUCTION_SELECTOR_PATH,
    V3_TRACKED_CATALOG_RUNTIME_PATH,
    V3_BATTLE_MAP_GENERATION_SERVICE_PATH
  ];
  return Promise.all(paths.map(async filePath => ({
    filePath,
    source: await readFile(new URL(`../../${filePath}`, import.meta.url), 'utf8')
  })));
}

function mutateSource(sources, filePath, search, replacement) {
  return sources.map(source => {
    if (source.filePath !== filePath) return source;
    const mutated = source.source.replace(search, replacement);
    assert.notEqual(mutated, source.source, `Mutation did not match ${filePath}`);
    return { ...source, source: mutated };
  });
}

function assertCatalogNotAutomatic(sources, label) {
  const violations = checkV3ArchitectureSources(sources);
  assert.ok(
    violations.some(violation => violation.code === 'v3-catalog-not-automatic'),
    `${label}\n${JSON.stringify(violations, null, 2)}`
  );
}

describe('BattleMap V3 static architecture guardrail', () => {
  it('scans production JS/TS and excludes tests, docs, and generated content', () => {
    assert.equal(isProductionSourcePath('api/src/battle/create.ts'), true);
    assert.equal(isProductionSourcePath('frontend/src/map.jsx'), true);
    assert.equal(isProductionSourcePath('api/src/map.test.js'), false);
    assert.equal(isProductionSourcePath('api/src/__tests__/map.js'), false);
    assert.equal(isProductionSourcePath('docs/examples/map.js'), false);
    assert.equal(isProductionSourcePath('content/generated/maps.ts'), false);
    assert.equal(isProductionSourcePath('shared/map.generated.js'), false);
    assert.deepEqual(
      Object.keys(V3_ARCHITECTURE_CHECKER_ALLOWLIST),
      ['scripts/battle-maps/check-v3-architecture.js']
    );
  });

  it('rejects direct BATTLE_MAP_V3_* environment reads', () => {
    for (const source of [
      'const enabled = process.env.BATTLE_MAP_V3_ENABLED;',
      "const release = process.env['BATTLE_MAP_V3_CATALOG_RELEASE'];",
      'const shadow = import.meta.env.BATTLE_MAP_V3_SHADOW_MODE;',
      'const enabled = process.env?.BATTLE_MAP_V3_ENABLED;',
      "const fallback = Deno.env.get('BATTLE_MAP_V3_FALLBACK');",
      'const { BATTLE_MAP_V3_KILL_SWITCH } = process.env;'
    ]) {
      assert.ok(codes(source).includes('v3-specific-environment'), source);
    }
  });

  it('rejects aliased, destructured, optional, and bracket V3 environment reads', () => {
    for (const source of [
      `
        const env = process.env;
        const enabled = env.BATTLE_MAP_V3_ENABLED;
      `,
      `
        const env = process?.env;
        const enabled = env?.['BATTLE_MAP_V3_ENABLED'];
      `,
      `
        const runtime = process;
        const env = runtime['env'];
        const enabled = env?.BATTLE_MAP_V3_ENABLED;
      `,
      `
        const { env: settings } = process;
        const { BATTLE_MAP_V3_CATALOG_RELEASE: release } = settings;
      `,
      `
        let environment;
        environment = import.meta.env;
        const { ['BATTLE_MAP_V3_ROLLOUT']: rollout } = environment;
      `,
      `
        const environment = Bun?.env ?? {};
        const { BATTLE_MAP_V3_KILL_SWITCH = false } = environment;
      `,
      `
        const environment: NodeJS.ProcessEnv = process.env;
        const release = environment?.['BATTLE_MAP_V3_CATALOG_RELEASE'];
      `
    ]) {
      assert.ok(codes(source).includes('v3-specific-environment'), source);
    }
  });

  it('rejects generic environment-derived V3 activation and version selection', () => {
    assert.ok(codes(`
      const battleMapVersion = Number(process.env.BATTLE_MAP_VERSION);
      if (battleMapVersion === 3) return createBattleMapV3();
    `).includes('environment-derived-v3-activation'));
    assert.ok(codes(`
      const v3Enabled = process.env.ENABLE_AUTHORED_MAPS === 'true';
      return v3Enabled ? selectBattleMapV3() : generateBattleMapV2();
    `).includes('environment-derived-v3-activation'));
    assert.ok(codes(
      'const enabled = process.env.AUTHORED_MAPS === "true";',
      'api/src/services/battle/v3/selection.js'
    ).includes('environment-derived-v3-activation'));
  });

  it('rejects feature-flag provider imports in V3 modules', () => {
    assert.ok(codes(`
      import { variation } from '@launchdarkly/node-server-sdk';
      export function selectBattleMapV3() {}
    `).includes('v3-feature-flag-provider'));
    assert.ok(codes(
      "const flags = require('../services/featureFlags.js');",
      'api/src/services/battle/v3/selector.js'
    ).includes('v3-feature-flag-provider'));
  });

  it('rejects aliased feature-flag and config-provider dependencies in V3 selectors', () => {
    const examples = [
      `
        import { featureFlags as catalogPolicy } from '../config/index.js';
        export const selectBattleMapV3 = query =>
          catalogPolicy.isEnabled('battle-map-v3') && query;
      `,
      `
        import { runtimeConfig as policy } from '../config.js';
        export const selectBattleMapV3 = query =>
          policy.get('battleMapV3Enabled') ? query : null;
      `,
      `
        const load = require;
        const { isEnabled: permit } = load('../config.js');
        export const selectBattleMapV3 = query =>
          permit('battle-map-v3') ? query : null;
      `,
      `
        const load = require;
        const provider = load('../feature-flags/provider.js');
        export function selectBattleMapV3(query) {
          return provider.variation('battle-map-v3', query);
        }
      `,
      `
        const settings = require('../config.js');
        const catalogPolicy = settings;
        export const selectBattleMapV3 = query =>
          catalogPolicy.isEnabled('battle-map-v3') && query;
      `,
      `
        import policy from '../services/config-provider.js';
        export const selectBattleMapV3 = query =>
          policy.isEnabled('battle-map-v3') && query;
      `,
      `
        const load = require;
        export const selectBattleMapV3 = query =>
          load('../services/config-provider.js').get('battleMapV3Enabled')
            ? query
            : null;
      `
    ];
    for (const source of examples) {
      assert.ok(codes(
        source,
        'api/src/services/battle/v3/selector.js'
      ).includes('v3-feature-flag-provider'), source);
    }
  });

  it('allows deterministic schema and content config in V3 selectors', () => {
    assert.deepEqual(codes(`
      import {
        battleMapSchemaVersion as schemaVersion,
        supportedThemes
      } from '../content/config.js';
      import renderConfig from '../content/render-config.js';

      export function selectBattleMapV3(entry) {
        return entry.battleMapSchemaVersion === schemaVersion
          && supportedThemes.includes(entry.theme)
          && renderConfig.renderProfileIds.includes(entry.renderProfileId)
          && renderConfig.get('battleMapV3SchemaVersion') === schemaVersion;
      }
    `, 'api/src/services/battle/v3/selector.js'), []);
  });

  it('rejects V3 shadow, kill-switch, rollout, and configurable fallback controls', () => {
    const examples = [
      ['const battleMapV3ShadowEnabled = config.shadowMaps;', 'v3-shadow-control'],
      ['if (v3KillSwitch) return generateBattleMapV2();', 'v3-kill-switch'],
      ['const v3FallbackMode = settings.mapFallback;', 'v3-configurable-fallback'],
      ['const battleMapV3EnabledProfiles = config.profiles;', 'v3-rollout-control'],
      ['if (v3RolloutGate.allows(theme)) selectV3();', 'v3-rollout-control'],
      ['const killSwitch = config.stopMaps;', 'v3-kill-switch']
    ];
    for (const [source, expected] of examples) {
      assert.ok(codes(
        source,
        'api/src/services/battle/v3/selection.js'
      ).includes(expected), source);
    }
  });

  it('allows catalog-driven selection and coverage-only compatibility', () => {
    assert.deepEqual(codes(`
      export function selectMap({ catalog, encounter }) {
        const eligible = catalog.entries.filter(entry =>
          entry.battleMapSchemaVersion === 3
          && entry.theme === encounter.theme
          && entry.tierEligibility.includes(encounter.tier)
        );
        if (eligible.length === 0) {
          recordCatalogCoverageMiss(encounter);
          return createDeterministicV2CompatibilityMap(encounter);
        }
        return stableWeightedCatalogChoice(eligible, encounter.seed);
      }
    `), []);
  });

  it('allows schema validation and offline V2/V3 preview comparisons', () => {
    assert.deepEqual(codes(`
      export function validateBattleMapV3(map) {
        if (map.battleMapSchemaVersion !== 3) {
          throw new TypeError('Expected BattleMapV3');
        }
        return validateCatalogHashes(map);
      }
    `, 'shared/battleMap/v3/schema.ts'), []);
    assert.deepEqual(codes(`
      export async function previewBattleMapV3ShadowComparison(v2, v3) {
        return renderOfflineComparison({ v2, v3 });
      }
    `, 'scripts/battle-maps/preview-v3-comparison.js'), []);
  });

  it('allows offline candidate-generation fallbacks but still rejects V3 env reads', () => {
    const filePath = 'scripts/battle-maps/blueprint-candidate-lifecycle.mjs';
    assert.deepEqual(codes(`
      export function buildCandidatePrompt({ textTemplateFallback = false }) {
        return textTemplateFallback
          ? 'Use the frozen textual template description.'
          : 'Use the staged source image.';
      }
    `, filePath), []);
    assert.ok(codes(`
      const textTemplateFallback =
        process.env.BATTLE_MAP_V3_TEXT_TEMPLATE_FALLBACK === 'true';
    `, filePath).includes('v3-specific-environment'));
  });

  it('ignores prohibited spellings in comments and excluded source files', () => {
    assert.deepEqual(codes(`
      // Never read process.env.BATTLE_MAP_V3_ENABLED here.
      /* v3KillSwitch and v3ShadowMode are forbidden. */
      export const catalogDriven = true;
    `), []);
    assert.deepEqual(checkV3ArchitectureSources([
      {
        filePath: 'api/src/map.test.js',
        source: 'const value = process.env.BATTLE_MAP_V3_ENABLED;'
      },
      {
        filePath: 'docs/generated/example.js',
        source: 'const v3KillSwitch = true;'
      }
    ]), []);
  });

  it('accepts the actual tracked-pin to normalized-release production flow', async () => {
    const violations = checkV3ArchitectureSources(await actualCatalogFlowSources());
    assert.equal(
      violations.some(violation => violation.code === 'v3-catalog-not-automatic'),
      false,
      JSON.stringify(violations, null, 2)
    );
  });

  it('fails closed when an actual production catalog-flow module is missing', async () => {
    const sources = await actualCatalogFlowSources();
    for (const missingPath of [
      V3_PRODUCTION_SELECTOR_PATH,
      V3_TRACKED_CATALOG_RUNTIME_PATH,
      V3_BATTLE_MAP_GENERATION_SERVICE_PATH
    ]) {
      assertCatalogNotAutomatic(
        sources.filter(source => source.filePath !== missingPath),
        `missing ${missingPath}`
      );
    }
    const allRemoved = checkV3ArchitectureSources([], {
      requireAutomaticCatalogFlow: true
    });
    assert.ok(allRemoved.some(
      violation => violation.code === 'v3-catalog-not-automatic'
    ));
  });

  it('rejects mutations that bypass the actual tracked active-pin loader', async () => {
    const sources = await actualCatalogFlowSources();
    assertCatalogNotAutomatic(mutateSource(
      sources,
      V3_TRACKED_CATALOG_RUNTIME_PATH,
      '../../../../battle-maps/catalog/active-release.json',
      '../../../../battle-maps/catalog/untracked-release.json'
    ), 'active catalog pin bypass');
    assertCatalogNotAutomatic(mutateSource(
      sources,
      V3_TRACKED_CATALOG_RUNTIME_PATH,
      'await normalizeBattleMapV3CatalogRelease(',
      'await Promise.resolve('
    ), 'catalog normalization bypass');
    assertCatalogNotAutomatic(mutateSource(
      sources,
      V3_TRACKED_CATALOG_RUNTIME_PATH,
      'selectBattleMapV3CatalogEntry(deployed.release, query)',
      'selectBattleMapV3CatalogEntry({ entries: [] }, query)'
    ), 'deployed release selector bypass');
  });

  it('rejects mutations that bypass production generation wiring or coverage-only V2 compatibility', async () => {
    const sources = await actualCatalogFlowSources();
    assertCatalogNotAutomatic(mutateSource(
      sources,
      V3_BATTLE_MAP_GENERATION_SERVICE_PATH,
      'selectV3 = selectDeployedBattleMapV3,',
      'selectV3 = async () => ({ coverage: "absent" }),'
    ), 'deployed selector default bypass');
    assertCatalogNotAutomatic(mutateSource(
      sources,
      V3_BATTLE_MAP_GENERATION_SERVICE_PATH,
      "if (selection.coverage !== 'absent') {",
      'if (false) {'
    ), 'coverage-only compatibility bypass');
    assertCatalogNotAutomatic(mutateSource(
      sources,
      V3_PRODUCTION_SELECTOR_PATH,
      'await normalizeBattleMapV3CatalogRelease(release)',
      'await Promise.resolve(release)'
    ), 'production selector normalization bypass');
  });
});
