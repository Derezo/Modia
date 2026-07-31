import assert from 'node:assert/strict';
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  BUNDLE_PATH,
  BUNDLE_REGISTRY_PATH,
  DESCRIPTOR_SCHEMA_V1,
  DESCRIPTOR_SCHEMA_V2,
  FRONTEND_BUNDLE_PATH,
  FRONTEND_BUNDLE_REGISTRY_PATH,
  INVENTORY_PATH,
  READINESS_PLAN_SCHEMA,
  THEMES,
  TIER_BANDS,
  assertDescriptor,
  assertReadinessPlan,
  assertV2DescriptorsPlanned,
  auditBattleArt,
  buildBundle,
  buildBundleRegistry,
  buildInventory,
  buildReadinessMatrix,
  draftDescriptor,
  loadBattleArt,
  readJson,
  reportReadinessMatrix,
  scaffoldReadinessDescriptors,
  stableJson
} from './lifecycle.mjs';
import { parseGenerateArgs } from './generate.mjs';
import { parseCommand } from './cli.mjs';
import {
  clearBattleMapV3RuntimeManifest,
  setBattleMapV3RuntimeManifest
} from '../../frontend/src/battle/BattleMapAssets.js';
import {
  BATTLE_MAP_V3_SUPPORTED_THEMES,
  resolveBattleMapV3Tier
} from '../../shared/battleMap/BattleMapV3Resolvers.js';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../..');
const temporaryRoots = [];

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'modia-battle-art-v2-'));
  temporaryRoots.push(root);
  const metadataRoot = path.join(root, 'ai-image-metadata/battle-art');
  await mkdir(metadataRoot, { recursive: true });
  await copyFile(
    path.join(REPOSITORY_ROOT, 'ai-image-metadata/battle-art/manifest.json'),
    path.join(metadataRoot, 'manifest.json')
  );
  for (const directory of ['prompts', 'descriptors']) {
    await cp(
      path.join(REPOSITORY_ROOT, `ai-image-metadata/battle-art/${directory}`),
      path.join(metadataRoot, directory),
      { recursive: true }
    );
  }
  const reference =
    'ai-image-metadata/battle-maps/sources/forest/forest-template-01/reference.png';
  await mkdir(path.dirname(path.join(root, reference)), { recursive: true });
  await copyFile(
    path.join(REPOSITORY_ROOT, reference),
    path.join(root, reference)
  );
  const manifest = (await readJson(root,
    'ai-image-metadata/battle-art/manifest.json')).value;
  manifest.historicalReleases = [];
  const descriptors = [];
  for (const relative of manifest.descriptors) {
    const descriptor = (await readJson(root, relative)).value;
    const draft = {
      ...descriptor,
      status: 'draft',
      content: {
        ...descriptor.content,
        sourceSha256: null,
        runtimeSha256: null,
        immutableUrl: null
      },
      source: null
    };
    await writeFile(path.join(root, relative), stableJson(draft));
    descriptors.push({ path: relative, descriptor: draft });
  }
  await writeFile(
    path.join(root, 'ai-image-metadata/battle-art/manifest.json'),
    stableJson(manifest)
  );
  const bundle = await buildBundle(manifest, descriptors);
  const registry = buildBundleRegistry([], bundle);
  for (const [relative, value] of [
    [BUNDLE_PATH, bundle],
    [BUNDLE_REGISTRY_PATH, registry],
    [INVENTORY_PATH, buildInventory(manifest, descriptors)],
    [FRONTEND_BUNDLE_PATH, bundle],
    [FRONTEND_BUNDLE_REGISTRY_PATH, registry]
  ]) {
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), stableJson(value));
  }
  return root;
}

function requirement({
  descriptorId,
  familyGroup,
  variantId,
  category,
  direction = null,
  routeTopology = null,
  surfaceVariant = category === 'surface' ? 0 : null,
  heightDelta = 0
}) {
  return {
    descriptorId,
    familyGroup,
    variantId,
    category,
    direction,
    routeTopology,
    surfaceVariant,
    heightDelta
  };
}

function planFor(requirements, {
  theme = 'forest',
  ecologyProfile = 'heartlands',
  tierBand = 1
} = {}) {
  return {
    schemaVersion: READINESS_PLAN_SCHEMA,
    plans: [{
      theme,
      ecologyProfile,
      tierBand,
      requirements
    }]
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(root => rm(root, {
      recursive: true,
      force: true
    }))
  );
});

describe('battle-art descriptor v2 variants', () => {
  it('reads and compiles descriptor v1 without changing its runtime projection', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const legacy = loaded.descriptors.filter(entry => (
      entry.descriptor.schemaVersion === DESCRIPTOR_SCHEMA_V1
    ));
    assert.ok(legacy.length > 0);
    const bundle = await buildBundle(loaded.manifest, legacy);
    assert.ok(bundle.renderers.length > 0);
    assert.ok(bundle.renderers.every(renderer => (
      !Object.hasOwn(renderer, 'variant')
      && !Object.hasOwn(renderer, 'familyGroup')
      && !Object.hasOwn(renderer, 'variantId')
      && !Object.hasOwn(renderer, 'capabilities')
    )));
  });

  it('validates closed v2 capabilities and projects exact concrete metadata', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptor = draftDescriptor({
      manifest: loaded.manifest,
      theme: 'forest',
      category: 'connection-slope',
      id: 'heartlands-slope-n-grade-1',
      familyGroup: 'heartlands-slope',
      variantId: 'grade-1-n',
      direction: 'n',
      ecologyProfile: 'heartlands',
      tierBands: [1, 2],
      heightDeltas: [1]
    });
    assert.equal(descriptor.schemaVersion, DESCRIPTOR_SCHEMA_V2);
    assertDescriptor(descriptor, loaded.manifest);
    const compiled = structuredClone(descriptor);
    compiled.status = 'compiled';
    compiled.content.runtimeSha256 = `sha256:${'1'.repeat(64)}`;
    compiled.content.immutableUrl =
      `/assets/battle-map-v3/test/${'1'.repeat(64)}.webp`;
    const bundle = await buildBundle(loaded.manifest, [{
      path: 'unused.json',
      descriptor: compiled
    }]);
    assert.deepEqual(bundle.renderers[0].variant, {
      direction: 'n',
      ecologyProfile: 'heartlands',
      heightDelta: 1
    });
    assert.equal(Object.hasOwn(bundle.renderers[0], 'familyGroup'), false);
    assert.equal(Object.hasOwn(bundle.renderers[0], 'variantId'), false);
    assert.equal(Object.hasOwn(bundle.renderers[0], 'capabilities'), false);
    try {
      assert.doesNotThrow(() => setBattleMapV3RuntimeManifest(bundle));
    } finally {
      clearBattleMapV3RuntimeManifest();
    }

    const openCapabilities = structuredClone(descriptor);
    openCapabilities.capabilities.untracked = true;
    assert.throws(
      () => assertDescriptor(openCapabilities, loaded.manifest),
      /capabilities\.untracked is not allowed/
    );
    const directionless = structuredClone(descriptor);
    directionless.capabilities.direction = null;
    assert.throws(
      () => assertDescriptor(directionless, loaded.manifest),
      /requires direction/
    );
    const route = draftDescriptor({
      manifest: loaded.manifest,
      theme: 'forest',
      category: 'route-transition',
      id: 'heartlands-route-corner',
      familyGroup: 'heartlands-route',
      variantId: 'corner',
      ecologyProfile: 'heartlands',
      routeTopology: 'corner-ne'
    });
    route.capabilities.routeTopology = 'bend';
    assert.throws(
      () => assertDescriptor(route, loaded.manifest),
      /routeTopology is unsupported/
    );
    const surface = draftDescriptor({
      manifest: loaded.manifest,
      theme: 'forest',
      category: 'surface',
      id: 'heartlands-surface-3',
      familyGroup: 'heartlands-surface',
      variantId: 'surface-3',
      surfaceVariant: 3,
      ecologyProfile: 'heartlands'
    });
    const compiledSurface = structuredClone(surface);
    compiledSurface.status = 'compiled';
    compiledSurface.content.runtimeSha256 = `sha256:${'2'.repeat(64)}`;
    compiledSurface.content.immutableUrl =
      `/assets/battle-map-v3/test/${'2'.repeat(64)}.webp`;
    const surfaceBundle = await buildBundle(loaded.manifest, [{
        path: 'surface.json',
        descriptor: compiledSurface
      }]);
    assert.deepEqual(
      surfaceBundle.renderers[0].variant,
      {
        surfaceVariant: 3,
        ecologyProfile: 'heartlands',
        tier: 1
      }
    );
    try {
      assert.doesNotThrow(() => setBattleMapV3RuntimeManifest(surfaceBundle));
    } finally {
      clearBattleMapV3RuntimeManifest();
    }
    assert.match(surface.generationPrompt, /surface variant 3/);
  });

  it('uses category-specific isometric pivots for authored v2 assets', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const expected = new Map([
      ['surface', { x: 128, y: 64 }],
      ['route-transition', { x: 128, y: 64 }],
      ['connection-stairs', { x: 128, y: 128 }],
      ['connection-slope', { x: 128, y: 128 }],
      ['exposed-face-boundary', { x: 128, y: 192 }],
      ['blocking-obstacle', { x: 96, y: 224 }],
      ['nonblocking-decoration', { x: 64, y: 160 }]
    ]);
    for (const [category, pivot] of expected) {
      const descriptor = draftDescriptor({
        manifest: loaded.manifest,
        theme: 'forest',
        category,
        id: `pivot-${category}`,
        ecologyProfile: 'forest-iron-depths-borderwood'
      });
      assert.deepEqual(descriptor.placement.pivot, pivot);
      assert.deepEqual(descriptor.placement.anchor, pivot);
    }
  });

  it('pins regional species and geology direction into deterministic prompts', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const artDirection =
      'Heartlands woodland uses mature oak, silver birch, warm loam, and rounded fieldstone.';
    const descriptor = draftDescriptor({
      manifest: loaded.manifest,
      theme: 'forest',
      category: 'blocking-obstacle',
      id: 'heartlands-oak-obstacle',
      ecologyProfile: 'forest-heartlands-woodland',
      regionalArtDirection: artDirection
    });
    assert.match(descriptor.generationPrompt, new RegExp(artDirection));
    assert.throws(
      () => draftDescriptor({
        manifest: loaded.manifest,
        theme: 'cave',
        category: 'surface',
        id: 'unsafe-direction',
        regionalArtDirection: 'too short'
      }),
      /20–1200/
    );
  });

  it('reports complete directional slopes and every route topology', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const entries = [];
    const requirements = [];
    for (const direction of ['n', 'e', 's', 'w']) {
      const id = `heartlands-slope-${direction}`;
      entries.push({
        path: `${id}.json`,
        descriptor: draftDescriptor({
          manifest: loaded.manifest,
          theme: 'forest',
          category: 'connection-slope',
          id,
          familyGroup: 'heartlands-slope',
          variantId: `grade-1-${direction}`,
          direction,
          ecologyProfile: 'heartlands',
          heightDeltas: [1]
        })
      });
      requirements.push(requirement({
        descriptorId: id,
        familyGroup: 'heartlands-slope',
        variantId: `grade-1-${direction}`,
        category: 'connection-slope',
        direction,
        heightDelta: 1
      }));
      const placement = entries.at(-1).descriptor.placement;
      assert.deepEqual(
        {
          width: placement.footprint.width,
          height: placement.footprint.height,
          cells: placement.collision.cells
        },
        ['e', 'w'].includes(direction)
          ? {
              width: 2,
              height: 1,
              cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
            }
          : {
              width: 1,
              height: 2,
              cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }]
            }
      );
    }
    for (const routeTopology of [
      'end-n',
      'end-e',
      'end-s',
      'end-w',
      'straight-ns',
      'straight-ew',
      'corner-ne',
      'corner-es',
      'corner-sw',
      'corner-wn',
      'tee-nes',
      'tee-esw',
      'tee-nsw',
      'tee-wne',
      'cross',
      'isolated'
    ]) {
      const id = `heartlands-route-${routeTopology}`;
      entries.push({
        path: `${id}.json`,
        descriptor: draftDescriptor({
          manifest: loaded.manifest,
          theme: 'forest',
          category: 'route-transition',
          id,
          familyGroup: 'heartlands-route',
          variantId: routeTopology,
          routeTopology,
          ecologyProfile: 'heartlands'
        })
      });
      requirements.push(requirement({
        descriptorId: id,
        familyGroup: 'heartlands-route',
        variantId: routeTopology,
        category: 'route-transition',
        routeTopology
      }));
    }
    const plan = planFor(requirements);
    const complete = buildReadinessMatrix({
      ...loaded,
      descriptors: entries
    }, plan);
    assert.deepEqual(
      {
        required: complete.required,
        present: complete.present,
        missing: complete.missing,
        ambiguous: complete.ambiguous
      },
      { required: 20, present: 20, missing: 0, ambiguous: 0 }
    );
    const incomplete = buildReadinessMatrix({
      ...loaded,
      descriptors: entries.slice(0, -1)
    }, plan);
    assert.equal(incomplete.missing, 1);
    assert.match(entries[0].descriptor.generationPrompt, /final authored direction n/);
    assert.match(entries[0].descriptor.generationPrompt, /height magnitude 1/);
    assert.match(entries.at(-1).descriptor.generationPrompt, /exact route topology isolated/);
    assert.match(entries.at(-1).descriptor.generationPrompt, /ecology profile heartlands/);
    assert.match(entries.at(-1).descriptor.generationPrompt, /no.*baked backdrop/i);
  });
});

describe('battle-art readiness plan commands', () => {
  it('rejects ambiguous plan duplicates and ambiguous concrete capabilities', async () => {
    const duplicate = requirement({
      descriptorId: 'heartlands-route-corner',
      familyGroup: 'heartlands-route',
      variantId: 'corner-ne',
      category: 'route-transition',
      routeTopology: 'corner-ne'
    });
    assert.throws(
      () => assertReadinessPlan(planFor([duplicate, structuredClone(duplicate)])),
      /ambiguous duplicate requirement/
    );
    assert.throws(
      () => assertReadinessPlan(planFor([requirement({
        descriptorId: 'broken-route',
        familyGroup: 'broken-route',
        variantId: 'broken',
        category: 'route-transition'
      })])),
      /route-transition requires routeTopology/
    );
    assert.throws(
      () => assertReadinessPlan(planFor([requirement({
        descriptorId: 'contradictory-route',
        familyGroup: 'contradictory-route',
        variantId: 'end-n',
        category: 'route-transition',
        direction: 'e',
        routeTopology: 'end-n'
      })])),
      /direction must be null for route-transition/
    );
    assert.throws(
      () => assertReadinessPlan(planFor([{
        ...requirement({
          descriptorId: 'broken-obstacle',
          familyGroup: 'broken-obstacle',
          variantId: 'broken',
          category: 'blocking-obstacle'
        }),
        surfaceVariant: 1
      }])),
      /surfaceVariant is only valid for surface/
    );

    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptors = ['a', 'b'].map(id => ({
      path: `${id}.json`,
      descriptor: draftDescriptor({
        manifest: loaded.manifest,
        theme: 'forest',
        category: 'route-transition',
        id,
        familyGroup: 'heartlands-route',
        variantId: 'corner-ne',
        routeTopology: 'corner-ne',
        ecologyProfile: 'heartlands'
      })
    }));
    const matrix = buildReadinessMatrix({
      ...loaded,
      descriptors
    }, planFor([{
      ...duplicate,
      descriptorId: null
    }]));
    assert.equal(matrix.ambiguous, 1);
  });

  it('reports readiness for all 16 themes before any images or maps exist', () => {
    const plan = {
      schemaVersion: READINESS_PLAN_SCHEMA,
      plans: THEMES.map(theme => ({
        theme,
        ecologyProfile: `${theme}-default`,
        tierBand: 1,
        requirements: [requirement({
          descriptorId: `${theme}-surface-base`,
          familyGroup: `${theme}-surface`,
          variantId: 'base',
          category: 'surface'
        })]
      }))
    };
    const matrix = buildReadinessMatrix({ descriptors: [] }, plan);
    assert.equal(matrix.plans, 16);
    assert.equal(matrix.required, 16);
    assert.equal(matrix.missing, 16);
    assert.equal(matrix.present, 0);
  });

  it('keeps art tier bands aligned with the five runtime encounter tiers', () => {
    assert.deepEqual(THEMES, BATTLE_MAP_V3_SUPPORTED_THEMES);
    assert.deepEqual(TIER_BANDS, [1, 2, 3, 4, 5]);
    assert.deepEqual(
      TIER_BANDS.map(difficultyTier => resolveBattleMapV3Tier({
        mode: 'pve',
        difficultyTier
      }).sourceTier),
      TIER_BANDS
    );
    const invalidPlan = {
      schemaVersion: READINESS_PLAN_SCHEMA,
      plans: [{
        theme: 'forest',
        ecologyProfile: 'heartlands',
        tierBand: 6,
        requirements: [requirement({
          descriptorId: 'heartlands-surface-base',
          familyGroup: 'heartlands-surface',
          variantId: 'base',
          category: 'surface'
        })]
      }]
    };
    assert.throws(
      () => assertReadinessPlan(invalidPlan),
      /tierBand must be <= 5/
    );
    assert.throws(
      () => parseGenerateArgs(['--tier', '6']),
      /--tier must be between 1 and 5/
    );
  });

  it('rejects unplanned regional descriptors and extra tier claims', async () => {
    const loaded = await loadBattleArt(REPOSITORY_ROOT);
    const descriptor = draftDescriptor({
      manifest: loaded.manifest,
      theme: 'forest',
      category: 'surface',
      id: 'heartlands-surface-base',
      familyGroup: 'heartlands-surface',
      variantId: 'base',
      surfaceVariant: 0,
      ecologyProfile: 'heartlands',
      tierBands: [1]
    });
    const plan = planFor([requirement({
      descriptorId: descriptor.id,
      familyGroup: descriptor.familyGroup,
      variantId: descriptor.variantId,
      category: 'surface',
      surfaceVariant: 0
    })]);
    assert.doesNotThrow(() => assertV2DescriptorsPlanned([descriptor], plan));
    const unplanned = structuredClone(descriptor);
    unplanned.id = 'heartlands-surface-unplanned';
    assert.throws(
      () => assertV2DescriptorsPlanned([unplanned], plan),
      /not declared by the reviewed readiness plan/
    );
    const tierDrift = structuredClone(descriptor);
    tierDrift.capabilities.tierBands = [1, 2];
    assert.throws(
      () => assertV2DescriptorsPlanned([tierDrift], plan),
      /tier bands do not exactly match/
    );
  });

  it('keeps the production Borderwood route profile complete for future maps', async () => {
    const profile = JSON.parse(await readFile(
      path.join(REPOSITORY_ROOT, 'battle-maps/render-profiles/forest.json'),
      'utf8'
    ));
    const actual = profile.assetBindings
      .filter(binding => (
        binding.category === 'route'
        && binding.match.ecologyProfile === 'forest-iron-depths-borderwood'
        && binding.match.tier === 1
      ))
      .map(binding => binding.match.routeTopology)
      .sort();
    assert.deepEqual(actual, [
      'corner-es',
      'corner-ne',
      'corner-sw',
      'corner-wn',
      'cross',
      'end-e',
      'end-n',
      'end-s',
      'end-w',
      'isolated',
      'straight-ew',
      'straight-ns',
      'tee-esw',
      'tee-nes',
      'tee-nsw',
      'tee-wne'
    ]);
  });

  it('supports metadata-only reporting and deterministic no-overwrite scaffold', async () => {
    const root = await fixture();
    const relative = 'docs/readiness-plan.json';
    const slopeRequirement = requirement({
      descriptorId: 'heartlands-slope-n-grade-1',
      familyGroup: 'heartlands-slope',
      variantId: 'grade-1-n',
      category: 'connection-slope',
      direction: 'n',
      heightDelta: 1
    });
    const plan = {
      schemaVersion: READINESS_PLAN_SCHEMA,
      plans: [1, 2].map(tierBand => ({
        theme: 'forest',
        ecologyProfile: 'heartlands',
        tierBand,
        requirements: [structuredClone(slopeRequirement)]
      }))
    };
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await writeFile(path.join(root, relative), stableJson(plan));
    const before = (await loadBattleArt(root)).descriptors.length;
    const report = await reportReadinessMatrix({
      root,
      plan: relative,
      metadataOnly: true
    });
    assert.equal(report.missing, 2);
    assert.equal((await loadBattleArt(root)).descriptors.length, before);
    await assert.rejects(
      reportReadinessMatrix({ root, plan: relative }),
      /missing 2 concrete family/
    );

    const options = {
      root,
      plan: relative,
      theme: 'forest',
      ecologyProfile: 'heartlands',
      tier: 1,
      category: 'connection-slope'
    };
    const scaffolded = await scaffoldReadinessDescriptors(options);
    assert.equal(scaffolded.descriptors.length, 1);
    const descriptor = (await readJson(
      root,
      scaffolded.descriptors[0].descriptor
    )).value;
    assert.equal(descriptor.schemaVersion, DESCRIPTOR_SCHEMA_V2);
    assert.equal(descriptor.capabilities.direction, 'n');
    assert.deepEqual(descriptor.capabilities.tierBands, [1, 2]);
    assert.deepEqual(descriptor.capabilities.heightDeltas, [1]);
    await assert.rejects(
      auditBattleArt({ root }),
      /readiness plan is missing/
    );
    await scaffoldReadinessDescriptors({ ...options, check: true });
    await assert.rejects(
      scaffoldReadinessDescriptors(options),
      /already exists; use --force/
    );
    const expanded = planFor([
      requirement({
        descriptorId: 'aaa-heartlands-surface-base',
        familyGroup: 'heartlands-surface',
        variantId: 'base',
        category: 'surface'
      }),
      slopeRequirement
    ]);
    await writeFile(path.join(root, relative), stableJson(expanded));
    await assert.rejects(
      scaffoldReadinessDescriptors({
        ...options,
        category: undefined
      }),
      /already exists; use --force/
    );
    await assert.rejects(
      readFile(path.join(
        root,
        'ai-image-metadata/battle-art/descriptors/forest/'
          + 'aaa-heartlands-surface-base.json'
      )),
      error => error.code === 'ENOENT'
    );
  });

  it('rejects cross-tier connection magnitude conflicts before any scaffold write', async () => {
    const root = await fixture();
    const relative = 'docs/conflicting-readiness-plan.json';
    const conflict = {
      schemaVersion: READINESS_PLAN_SCHEMA,
      plans: [
        {
          theme: 'forest',
          ecologyProfile: 'heartlands',
          tierBand: 1,
          requirements: [
            requirement({
              descriptorId: 'aaa-heartlands-surface-0',
              familyGroup: 'heartlands-surface',
              variantId: 'surface-0',
              category: 'surface'
            }),
            requirement({
              descriptorId: 'zzz-heartlands-slope-n',
              familyGroup: 'heartlands-slope',
              variantId: 'grade-n',
              category: 'connection-slope',
              direction: 'n',
              heightDelta: 1
            })
          ]
        },
        {
          theme: 'forest',
          ecologyProfile: 'heartlands',
          tierBand: 2,
          requirements: [requirement({
            descriptorId: 'zzz-heartlands-slope-n',
            familyGroup: 'heartlands-slope',
            variantId: 'grade-n',
            category: 'connection-slope',
            direction: 'n',
            heightDelta: 2
          })]
        }
      ]
    };
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await writeFile(path.join(root, relative), stableJson(conflict));
    await assert.rejects(
      scaffoldReadinessDescriptors({
        root,
        plan: relative,
        theme: 'forest',
        ecologyProfile: 'heartlands',
        tier: 1,
        category: undefined
      }),
      /conflicting capabilities across plan rows/
    );
    await assert.rejects(
      readFile(path.join(
        root,
        'ai-image-metadata/battle-art/descriptors/forest/'
          + 'aaa-heartlands-surface-0.json'
      )),
      error => error.code === 'ENOENT'
    );
  });

  it('parses repeatable family and biome/tier/category selectors compatibly', () => {
    const generated = parseGenerateArgs([
      '--theme', 'forest',
      '--ecology-profile', 'heartlands',
      '--tier', '2',
      '--category', 'surface',
      '--surface-variant', '3',
      '--family', 'surface-a',
      '--family=surface-b'
    ]);
    assert.deepEqual(generated.families, ['surface-a', 'surface-b']);
    assert.equal(generated.ecologyProfile, 'heartlands');
    assert.equal(generated.tier, 2);
    assert.equal(generated.surfaceVariant, 3);
    const matrix = parseCommand([
      'matrix',
      '--theme', 'forest',
      '--ecology-profile', 'heartlands',
      '--tier', '2',
      '--category', 'surface',
      '--surface-variant', '3',
      '--family', 'surface-a',
      '--family', 'surface-b',
      '--metadata-only'
    ]);
    assert.deepEqual(matrix.options.families, ['surface-a', 'surface-b']);
    assert.equal(matrix.options.metadataOnly, true);
    for (const command of ['preview', 'audit', 'inventory']) {
      const parsed = parseCommand([
        command,
        '--theme', 'forest',
        '--ecology-profile', 'heartlands',
        '--tier', '2',
        '--category', 'surface',
        '--surface-variant', '3',
        '--family', 'surface-a',
        '--family', 'surface-b'
      ]);
      assert.deepEqual(
        {
          theme: parsed.options.theme,
          ecologyProfile: parsed.options.ecologyProfile,
          tier: parsed.options.tier,
          category: parsed.options.category,
          surfaceVariant: parsed.options.surfaceVariant,
          families: parsed.options.families
        },
        {
          theme: 'forest',
          ecologyProfile: 'heartlands',
          tier: 2,
          category: 'surface',
          surfaceVariant: 3,
          families: ['surface-a', 'surface-b']
        }
      );
    }
    const draft = parseCommand([
      'draft',
      '--theme', 'forest',
      '--category', 'connection-slope',
      '--family', 'slope-s',
      '--family-group', 'heartlands-slope',
      '--variant', 'grade-1-s',
      '--direction', 's',
      '--ecology-profile', 'heartlands',
      '--tier', '1',
      '--tier', '2',
      '--height-delta', '1'
    ]);
    assert.deepEqual(draft.options.tierBands, [1, 2]);
    assert.deepEqual(draft.options.heightDeltas, [1]);
    const surfaceDraft = parseCommand([
      'draft',
      '--theme', 'forest',
      '--category', 'surface',
      '--family', 'surface-7',
      '--surface-variant', '7'
    ]);
    assert.equal(surfaceDraft.options.surfaceVariant, 7);
  });

  it('publishes matrix and scaffold npm entry points', async () => {
    const packageJson = JSON.parse(await readFile(
      path.join(REPOSITORY_ROOT, 'package.json'),
      'utf8'
    ));
    assert.equal(
      packageJson.scripts['battle-art:matrix'],
      'node scripts/battle-art/cli.mjs matrix'
    );
    assert.equal(
      packageJson.scripts['battle-art:scaffold'],
      'node scripts/battle-art/cli.mjs scaffold'
    );
    assert.equal(
      packageJson.scripts['battle-art:inventory'],
      'node scripts/battle-art/cli.mjs inventory'
    );
  });
});
