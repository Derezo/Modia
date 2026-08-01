import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  BATTLE_MAP_V3_CATALOG_SCHEMA_VERSION,
  BATTLE_MAP_V3_SELECTOR_VERSION,
  computeTemplateMapAssetBundleManifestFullHash,
  computeTemplateMapBlueprintFullHash,
  computeTemplateMapSourceSidecarFullHash,
  createMinimalBattleMapV3FinalFixture,
  finalizeBattleMapV3CatalogRelease
} from '../../shared/battleMap/v3/index.js';
import {
  selectBattleMapV3CatalogEntry
} from '../../shared/battleMap/BattleMapV3Selector.js';
import {
  buildBundleRegistry,
  computeBattleArtRendererManifestFullHash
} from '../battle-art/lifecycle.mjs';
import {
  createBlueprintContractExample
} from './blueprint-candidate-lifecycle.mjs';
import {
  CATALOG_DEFINITION_SCHEMA,
  COMPILER_SOURCE_FILES,
  COMPILER_SOURCE_SET_DOMAIN,
  ContentReleaseInternals,
  REQUIRED_BATTLE_MAP_V3_COVERAGE_QUERIES,
  REQUIRED_BATTLE_MAP_V3_ECOLOGY_COVERAGE_QUERIES,
  VALIDATOR_SOURCE_FILES,
  VALIDATOR_SOURCE_SET_DOMAIN,
  buildCatalogRelease,
  checkReleaseCoverage,
  computeSourceSetFullHash,
  parseApprovalArgs,
  parseCatalogArgs,
  parseCompileArgs
} from './content-release-lifecycle.mjs';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');

function coverageDefinition(
  entries,
  coverageQueries = REQUIRED_BATTLE_MAP_V3_ECOLOGY_COVERAGE_QUERIES
) {
  return {
    schemaVersion: CATALOG_DEFINITION_SCHEMA,
    catalogReleaseId: 'catalog:test-v1',
    entries,
    coverageQueries: coverageQueries.map(query => structuredClone(query))
  };
}

function catalogEntry(query) {
  const ecologyProfile = query.ecologyProfile ?? `ecology:${query.theme}`;
  const ecologySuffix = query.ecologyProfile === undefined
    ? ''
    : `:${query.ecologyProfile}`;
  return {
    id:
      `entry:${query.theme}:${query.mode}:${query.selectionBand}${ecologySuffix}`,
    mapContentId:
      `map:${query.theme}:${query.mode}:${query.selectionBand}${ecologySuffix}`,
    mapContentVersion: 1,
    mapFullHash: HASH_A,
    catalogReleaseId: 'catalog:test-v1',
    theme: query.theme,
    ecologyProfile,
    renderProfileId: `profile:${query.theme}`,
    tierEligibility: [query.selectionBand],
    supportedModes: [query.mode],
    orientation: 'isometric-diamond',
    teamLayout: query.teamLayout,
    dimensions: { width: 32, height: 32 },
    playerCapacity: 5,
    candidatePoolSize: 24,
    maxAssignableOpponents: 7,
    assetBundleId: 'bundle:test',
    assetBundleManifestFullHash: HASH_B,
    weight: 1,
    bossCapable: query.requireBossCapable,
    competitiveParity: query.requireCompetitiveParity,
    sourceTemplateId: `template:${query.theme}`
  };
}

function definitionEntry(entry) {
  return {
    id: entry.id,
    mapPath: `battle-maps/compiled/${entry.theme}/${entry.mapContentId}.v1.json`,
    approvalPath:
      `battle-maps/approvals/${entry.theme}/${entry.mapContentId}.v1.json`,
    approvalFileSha256: HASH_A,
    orientation: entry.orientation,
    teamLayout: entry.teamLayout,
    weight: entry.weight,
    bossCapable: entry.bossCapable,
    competitiveParity: entry.competitiveParity
  };
}

test('closed command parsing rejects unknown, conflicting, and unsafe arguments', () => {
  assert.deepEqual(
    parseCompileArgs([
      '--theme', 'forest',
      '--template', 'forest-template-01',
      '--all-approved',
      '--metadata-only'
    ]).binaryMode,
    'metadata'
  );
  assert.throws(
    () => parseCompileArgs([
      '--theme', 'forest',
      '--template', 'forest-template-01',
      '--map', 'map-a',
      '--all-approved'
    ]),
    /exactly one/
  );
  assert.throws(
    () => parseCompileArgs([
      '--theme', 'forest',
      '--template', 'forest-template-01',
      '--all-approved',
      '--network'
    ]),
    /Unknown argument/
  );
  assert.throws(
    () => parseApprovalArgs([
      '--theme', 'forest',
      '--template', 'forest-template-01',
      '--map', 'map-a',
      '--screenshot', '../escape.png',
      '--reviewer', 'codex'
    ]),
    /traversal segment/
  );
  assert.throws(
    () => parseCatalogArgs([
      '--release', 'catalog:test-v1',
      '--activate',
      '--metadata-only'
    ]),
    /cannot be combined/
  );
});

test('blueprint approval indexes preserve legacy v1 and require hash-pinned v2 rationale', () => {
  const makeEntries = (templateId, v2 = false) => ['a', 'b', 'c'].map(suffix => {
    const id = `${templateId}-${suffix}`;
    return {
      id,
      blueprintPath:
        `ai-image-metadata/battle-maps/blueprints/forest/${templateId}/${id}.json`,
      approvalPath:
        `ai-image-metadata/battle-maps/blueprints/forest/${templateId}/${id}.approval.json`,
      blueprintFullHash: HASH_A,
      sourceImageSha256: HASH_B,
      promptProfileSha256: HASH_A,
      reviewer: 'reviewer-1',
      decision: 'approved',
      ...(v2 ? { reason: `Approved ${suffix}`, approvalFullHash: HASH_B } : {})
    };
  });
  const finalize = projection => ({
    ...projection,
    fullHash: ContentReleaseInternals.stableSha256(projection)
  });

  const legacy = finalize({
    schemaVersion: 'battle-map-blueprint-approval-index-v1',
    theme: 'forest',
    templateId: 'forest-template-02',
    entries: makeEntries('forest-template-02')
  });
  assert.equal(
    ContentReleaseInternals.validateApprovalIndex(legacy, {
      theme: 'forest',
      templateId: 'forest-template-02',
      expectedPath: 'legacy/approvals.json',
      expectedHash: legacy.fullHash
    }),
    legacy
  );

  const v2 = finalize({
    schemaVersion: 'battle-map-blueprint-approval-index-v2',
    theme: 'forest',
    templateId: 'forest-template-03',
    entries: makeEntries('forest-template-03', true)
  });
  assert.equal(
    ContentReleaseInternals.validateApprovalIndex(v2, {
      theme: 'forest',
      templateId: 'forest-template-03',
      expectedPath: 'v2/approvals.json',
      expectedHash: v2.fullHash
    }),
    v2
  );

  const tampered = structuredClone(v2);
  tampered.entries[0].reason = 'Changed after approval';
  assert.throws(
    () => ContentReleaseInternals.validateApprovalIndex(tampered, {
      theme: 'forest',
      templateId: 'forest-template-03',
      expectedPath: 'v2/approvals.json',
      expectedHash: v2.fullHash
    }),
    /hash mismatch/
  );
  const missingReason = structuredClone(v2);
  delete missingReason.entries[0].reason;
  assert.throws(
    () => ContentReleaseInternals.validateApprovalIndex(missingReason, {
      theme: 'forest',
      templateId: 'forest-template-03',
      expectedPath: 'v2/approvals.json',
      expectedHash: v2.fullHash
    }),
    /reason is required/
  );
  const upgradedLegacy = structuredClone(legacy);
  upgradedLegacy.schemaVersion = 'battle-map-blueprint-approval-index-v2';
  assert.throws(
    () => ContentReleaseInternals.validateApprovalIndex(upgradedLegacy, {
      theme: 'forest',
      templateId: 'forest-template-02',
      expectedPath: 'legacy/approvals.json',
      expectedHash: legacy.fullHash
    }),
    /identity is invalid/
  );

  const blueprintPrompt = {
    id: 'map-blueprint-v1',
    path: 'ai-image-metadata/battle-maps/prompts/map-blueprint-v1.json',
    sha256: HASH_A
  };
  const recordContext = {
    theme: 'forest',
    templateId: 'forest-template-02',
    sidecar: { sourceImage: { sha256: HASH_B } },
    blueprintPrompt
  };
  assert.deepEqual(
    ContentReleaseInternals.blueprintPromptProfile('forest-template-02'),
    {
      id: 'map-blueprint-v1',
      path: 'ai-image-metadata/battle-maps/prompts/map-blueprint-v1.json',
      schema: 'battle-map-blueprint-prompt-profile-v1'
    }
  );
  const v2BlueprintPrompt = {
    id: 'map-blueprint-v2',
    path: 'ai-image-metadata/battle-maps/prompts/map-blueprint-v2.json',
    sha256: HASH_B
  };
  assert.deepEqual(
    ContentReleaseInternals.blueprintPromptProfile('forest-template-03'),
    {
      id: 'map-blueprint-v2',
      path: 'ai-image-metadata/battle-maps/prompts/map-blueprint-v2.json',
      schema: 'battle-map-blueprint-prompt-profile-v2'
    }
  );
  assert.deepEqual(
    ContentReleaseInternals.blueprintPromptProfile('forest-template-04'),
    ContentReleaseInternals.blueprintPromptProfile('forest-template-03')
  );
  const legacyRecord = {
    schemaVersion: 'battle-map-blueprint-approval-v1',
    id: legacy.entries[0].id,
    theme: 'forest',
    templateId: 'forest-template-02',
    decision: 'approved',
    reviewer: legacy.entries[0].reviewer,
    blueprintPath: legacy.entries[0].blueprintPath,
    blueprintFileSha256: HASH_A,
    blueprintFullHash: legacy.entries[0].blueprintFullHash,
    sourceImageSha256: legacy.entries[0].sourceImageSha256,
    promptProfile: blueprintPrompt
  };
  assert.equal(
    ContentReleaseInternals.validateBlueprintApprovalRecord(
      legacyRecord,
      legacy.entries[0],
      recordContext
    ),
    legacyRecord
  );

  const v2Entry = structuredClone(v2.entries[0]);
  v2Entry.promptProfileSha256 = v2BlueprintPrompt.sha256;
  const v2RecordProjection = {
    ...legacyRecord,
    schemaVersion: 'battle-map-blueprint-approval-v2',
    id: v2Entry.id,
    templateId: 'forest-template-03',
    reviewer: v2Entry.reviewer,
    blueprintPath: v2Entry.blueprintPath,
    blueprintFullHash: v2Entry.blueprintFullHash,
    sourceImageSha256: v2Entry.sourceImageSha256,
    promptProfile: v2BlueprintPrompt,
    reason: v2Entry.reason
  };
  const v2Record = finalize(v2RecordProjection);
  v2Entry.approvalFullHash = v2Record.fullHash;
  assert.equal(
    ContentReleaseInternals.validateBlueprintApprovalRecord(
      v2Record,
      v2Entry,
      {
        ...recordContext,
        templateId: 'forest-template-03',
        blueprintPrompt: v2BlueprintPrompt
      }
    ),
    v2Record
  );
  const tamperedRecord = structuredClone(v2Record);
  tamperedRecord.reason = 'Changed without refreshing the approval hash.';
  assert.throws(
    () => ContentReleaseInternals.validateBlueprintApprovalRecord(
      tamperedRecord,
      v2Entry,
      {
        ...recordContext,
        templateId: 'forest-template-03',
        blueprintPrompt: v2BlueprintPrompt
      }
    ),
    /full hash mismatch/
  );
});

test('release validation rejects excessive V2 connections after every pin is refreshed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-v3-semantic-release-'));
  const sidecar = JSON.parse(await readFile(
    path.join(
      PROJECT_ROOT,
      'ai-image-metadata/battle-maps/templates/forest/forest-template-01.json'
    ),
    'utf8'
  ));
  sidecar.id = 'forest-template-03';
  sidecar.candidateMaps = [
    'forest-template-03-a',
    'forest-template-03-b',
    'forest-template-03-c'
  ];
  sidecar.routeIntent.primaryApproaches[0] =
    'Build two interlocking loops through a shared central crossing.';
  sidecar.routeIntent.secondaryApproaches[0] =
    'Keep the figure-eight centerline connected by authored route cells.';

  const mapId = sidecar.candidateMaps[0];
  const blueprint = createBlueprintContractExample(sidecar, mapId);
  const requiredRouteCellKeys = new Set(
    blueprint.routes
      .filter(route => route.required)
      .flatMap(route => route.cells)
      .map(cell => `${cell.x},${cell.y}`)
  );
  const routeTouchingEdges = [];
  for (let y = 0; y < blueprint.dimensions.height; y += 1) {
    for (let x = 0; x < blueprint.dimensions.width; x += 1) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const from = { x, y };
        const to = { x: x + dx, y: y + dy };
        if (
          to.x >= blueprint.dimensions.width
          || to.y >= blueprint.dimensions.height
          || (
            !requiredRouteCellKeys.has(`${from.x},${from.y}`)
            && !requiredRouteCellKeys.has(`${to.x},${to.y}`)
          )
        ) continue;
        routeTouchingEdges.push({ from, to });
      }
    }
  }
  assert.ok(routeTouchingEdges.length >= 33);
  blueprint.connections = routeTouchingEdges
    .slice(0, 33)
    .map(({ from, to }, index) => {
      const kind = index % 2 === 0 ? 'stairs' : 'slope';
      return {
        id: `connection:release-regression:${index}`,
        from,
        to,
        kind,
        traversable: true,
        bidirectional: true,
        featureId: 'feature:terraces',
        assetFamily: kind
      };
    });

  const blueprintPath =
    `ai-image-metadata/battle-maps/blueprints/forest/forest-template-03/${mapId}.json`;
  const approvalPath =
    `ai-image-metadata/battle-maps/blueprints/forest/forest-template-03/`
      + `${mapId}.approval.json`;
  const indexPath =
    'ai-image-metadata/battle-maps/blueprints/forest/forest-template-03/approvals.json';
  const sidecarPath =
    'ai-image-metadata/battle-maps/templates/forest/forest-template-03.json';
  const recipePath =
    'battle-maps/compile-recipes/forest/forest-template-03.json';
  const blueprintBytes = Buffer.from(`${JSON.stringify(blueprint, null, 2)}\n`);
  const blueprintFullHash = await computeTemplateMapBlueprintFullHash(blueprint);
  const promptProfile = {
    id: 'map-blueprint-v2',
    path: 'ai-image-metadata/battle-maps/prompts/map-blueprint-v2.json',
    sha256: HASH_A
  };
  const approvalProjection = {
    schemaVersion: 'battle-map-blueprint-approval-v2',
    id: mapId,
    theme: 'forest',
    templateId: sidecar.id,
    decision: 'approved',
    reviewer: 'reviewer-1',
    blueprintPath,
    blueprintFileSha256: ContentReleaseInternals.bytesSha256(blueprintBytes),
    blueprintFullHash,
    sourceImageSha256: sidecar.sourceImage.sha256,
    promptProfile,
    reason: 'All structural evidence was deliberately rehashed for this regression.'
  };
  const approval = {
    ...approvalProjection,
    fullHash: ContentReleaseInternals.stableSha256(approvalProjection)
  };
  const entry = {
    id: mapId,
    blueprintPath,
    approvalPath,
    blueprintFullHash,
    sourceImageSha256: sidecar.sourceImage.sha256,
    promptProfileSha256: promptProfile.sha256,
    reviewer: approval.reviewer,
    decision: 'approved',
    reason: approval.reason,
    approvalFullHash: approval.fullHash
  };
  const indexProjection = {
    schemaVersion: 'battle-map-blueprint-approval-index-v2',
    theme: 'forest',
    templateId: sidecar.id,
    entries: [
      entry,
      ...['b', 'c'].map(suffix => ({
        ...entry,
        id: `forest-template-03-${suffix}`,
        blueprintPath:
          `ai-image-metadata/battle-maps/blueprints/forest/forest-template-03/`
            + `forest-template-03-${suffix}.json`,
        approvalPath:
          `ai-image-metadata/battle-maps/blueprints/forest/forest-template-03/`
            + `forest-template-03-${suffix}.approval.json`
      }))
    ]
  };
  const index = {
    ...indexProjection,
    fullHash: ContentReleaseInternals.stableSha256(indexProjection)
  };
  sidecar.pins.approvedBlueprintSha256 = index.fullHash;
  const recipe = JSON.parse(await readFile(
    path.join(
      PROJECT_ROOT,
      'battle-maps/compile-recipes/forest/forest-template-01.json'
    ),
    'utf8'
  ));
  recipe.templateId = sidecar.id;
  recipe.sourceSidecar = {
    path: sidecarPath,
    fullHash: await computeTemplateMapSourceSidecarFullHash(sidecar)
  };
  recipe.blueprintApprovalIndex = {
    path: indexPath,
    fullHash: index.fullHash
  };
  recipe.maps = sidecar.candidateMaps.map((blueprintId, index) => ({
    blueprintId,
    contentId: blueprintId,
    contentVersion: index + 1,
    templateRevision: 1
  }));

  for (const [relativePath, value] of [
    [blueprintPath, blueprintBytes],
    [approvalPath, Buffer.from(`${JSON.stringify(approval, null, 2)}\n`)],
    [indexPath, Buffer.from(`${JSON.stringify(index, null, 2)}\n`)],
    [sidecarPath, Buffer.from(`${JSON.stringify(sidecar, null, 2)}\n`)],
    [recipePath, Buffer.from(`${JSON.stringify(recipe, null, 2)}\n`)]
  ]) {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, value);
  }

  assert.equal(sidecar.pins.approvedBlueprintSha256, recipe.blueprintApprovalIndex.fullHash);
  assert.equal(
    ContentReleaseInternals.validateRecipeShape(recipe, 'forest', sidecar.id),
    recipe
  );
  assert.equal(
    ContentReleaseInternals.validateApprovalIndex(index, {
      theme: 'forest',
      templateId: sidecar.id,
      expectedPath: recipe.blueprintApprovalIndex.path,
      expectedHash: recipe.blueprintApprovalIndex.fullHash
    }),
    index
  );
  assert.equal(
    ContentReleaseInternals.validateBlueprintApprovalRecord(
      approval,
      entry,
      {
        theme: 'forest',
        templateId: sidecar.id,
        sidecar,
        blueprintPrompt: promptProfile
      }
    ),
    approval
  );
  await assert.rejects(
    ContentReleaseInternals.validateBlueprintApproval(
      root,
      entry,
      {
        theme: 'forest',
        templateId: sidecar.id,
        sidecar,
        blueprintPrompt: promptProfile
      }
    ),
    /33 traversable elevation connections; at most the fixed map width of 32/
  );
});

test('source-set identities are deterministic and bind ordered exact file pins', () => {
  const sourceSet = {
    id: 'compiler:v3',
    version: 1,
    fullHash: HASH_A,
    sourceFiles: [
      { path: 'shared/battleMap/v3/compiler.js', sha256: HASH_A },
      { path: 'shared/battleMap/v3/schema.js', sha256: HASH_B }
    ]
  };
  const hash = computeSourceSetFullHash(sourceSet, COMPILER_SOURCE_SET_DOMAIN);
  assert.match(hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    hash,
    computeSourceSetFullHash(structuredClone(sourceSet), COMPILER_SOURCE_SET_DOMAIN)
  );
  const changed = structuredClone(sourceSet);
  changed.sourceFiles[1].sha256 = HASH_A;
  assert.notEqual(hash, computeSourceSetFullHash(changed, COMPILER_SOURCE_SET_DOMAIN));
});

test('source-set validation detects a transitive dependency byte change', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-v3-source-set-'));
  const sourceFiles = [];
  for (const relativePath of COMPILER_SOURCE_FILES) {
    const absolute = path.join(root, ...relativePath.split('/'));
    await mkdir(path.dirname(absolute), { recursive: true });
    const bytes = Buffer.from(`fixture:${relativePath}`);
    await writeFile(absolute, bytes);
    sourceFiles.push({
      path: relativePath,
      sha256: ContentReleaseInternals.bytesSha256(bytes)
    });
  }
  const sourceSet = {
    id: 'compiler:v3',
    version: 1,
    fullHash: HASH_A,
    sourceFiles
  };
  sourceSet.fullHash = computeSourceSetFullHash(
    sourceSet,
    COMPILER_SOURCE_SET_DOMAIN
  );
  await ContentReleaseInternals.validateSourceSet(
    root,
    sourceSet,
    'compiler source set',
    COMPILER_SOURCE_SET_DOMAIN,
    COMPILER_SOURCE_FILES
  );
  await writeFile(
    path.join(root, 'shared/terrain.js'),
    'changed traversal semantics'
  );
  await assert.rejects(
    ContentReleaseInternals.validateSourceSet(
      root,
      sourceSet,
      'compiler source set',
      COMPILER_SOURCE_SET_DOMAIN,
      COMPILER_SOURCE_FILES
    ),
    /file hash mismatch/
  );
});

test('validator identity binds battle-art and screenshot validation dependencies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-v3-validator-set-'));
  const sourceFiles = [];
  for (const relativePath of VALIDATOR_SOURCE_FILES) {
    const absolute = path.join(root, ...relativePath.split('/'));
    await mkdir(path.dirname(absolute), { recursive: true });
    const bytes = Buffer.from(`fixture:${relativePath}`);
    await writeFile(absolute, bytes);
    sourceFiles.push({
      path: relativePath,
      sha256: ContentReleaseInternals.bytesSha256(bytes)
    });
  }
  const sourceSet = {
    id: 'validator:v3',
    version: 1,
    fullHash: HASH_A,
    sourceFiles
  };
  sourceSet.fullHash = computeSourceSetFullHash(
    sourceSet,
    VALIDATOR_SOURCE_SET_DOMAIN
  );
  await ContentReleaseInternals.validateSourceSet(
    root,
    sourceSet,
    'validator source set',
    VALIDATOR_SOURCE_SET_DOMAIN,
    VALIDATOR_SOURCE_FILES
  );
  await writeFile(
    path.join(root, 'scripts/battle-art/lifecycle.mjs'),
    'changed art acceptance'
  );
  await assert.rejects(
    ContentReleaseInternals.validateSourceSet(
      root,
      sourceSet,
      'validator source set',
      VALIDATOR_SOURCE_SET_DOMAIN,
      VALIDATOR_SOURCE_FILES
    ),
    /file hash mismatch/
  );
});

test('tracked path resolution rejects traversal and every symlink component', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-v3-content-path-'));
  await mkdir(path.join(root, 'safe'));
  await writeFile(path.join(root, 'safe', 'file.json'), '{}');
  await symlink(path.join(root, 'safe'), path.join(root, 'linked'));

  assert.throws(
    () => ContentReleaseInternals.resolveTracked(root, 'safe/../escape', 'fixture'),
    /traversal/
  );
  await assert.rejects(
    ContentReleaseInternals.assertNoSymlinkPath(root, 'linked/file.json', {
      label: 'fixture'
    }),
    /forbidden symlink/
  );
});

test('immutable atomic publication never overwrites a concurrent different writer', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-v3-atomic-'));
  const relative = 'battle-maps/compiled/forest/concurrent.v1.json';
  const writes = await Promise.allSettled([
    ContentReleaseInternals.atomicWrite(root, relative, Buffer.from('first'), {
      immutable: true,
      label: 'concurrent fixture'
    }),
    ContentReleaseInternals.atomicWrite(root, relative, Buffer.from('second'), {
      immutable: true,
      label: 'concurrent fixture'
    })
  ]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(writes.filter(result => result.status === 'rejected').length, 1);
  assert.match(
    writes.find(result => result.status === 'rejected').reason.message,
    /immutable bytes|different bytes/
  );
  const published = await readFile(path.join(root, ...relative.split('/')), 'utf8');
  assert.ok(published === 'first' || published === 'second');

  const outside = path.join(root, 'outside.json');
  await writeFile(outside, 'outside');
  await symlink(outside, path.join(root, 'leaf-link.json'));
  await assert.rejects(
    ContentReleaseInternals.readTrackedBytes(root, 'leaf-link.json', 'leaf fixture'),
    /forbidden symlink/
  );
});

test('metadata mode validates binary pins while skipping only file bytes', async () => {
  const skipped = [];
  await assert.rejects(
    ContentReleaseInternals.validateBinaryPin(
      '/not-read',
      { path: '../escape.webp', sha256: HASH_A },
      'asset fixture',
      'metadata',
      skipped
    ),
    /traversal segment/
  );
  assert.equal(skipped.length, 0);
  assert.equal(
    await ContentReleaseInternals.validateBinaryPin(
      '/not-read',
      { path: 'frontend/public/asset.webp', sha256: HASH_A, bytes: 1 },
      'asset fixture',
      'metadata',
      skipped
    ),
    false
  );
  assert.deepEqual(skipped, [{
    path: 'frontend/public/asset.webp',
    expectedSha256: HASH_A,
    reason: 'metadata-only'
  }]);
});

test('screenshot evidence must decode as a sufficiently sized PNG', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'modia-v3-screenshot-'));
  await writeFile(path.join(root, 'review.png'), 'not an image');
  const pin = {
    path: 'review.png',
    bytes: 12,
    width: 1280,
    height: 720,
    format: 'png',
    sha256: ContentReleaseInternals.bytesSha256(Buffer.from('not an image'))
  };
  await assert.rejects(
    ContentReleaseInternals.validateScreenshotEvidence(root, pin, 'require', []),
    /image|unsupported|Input|decode/i
  );
});

test('exact asset closure rejects map references changed after compilation', async () => {
  const map = await createMinimalBattleMapV3FinalFixture();
  const asset = {
    key: 'surface:grass',
    contentVersion: 1,
    contentHash: map.visualCells[0][0].surface.contentHash,
    immutableUrl: map.visualCells[0][0].surface.immutableUrl
  };
  const bundle = {
    id: 'fixture-assets',
    version: 1,
    manifestFullHash: HASH_A,
    assets: [asset]
  };
  assert.doesNotThrow(() => ContentReleaseInternals.assertExactMapAssets(map, bundle));
  const changed = structuredClone(map);
  changed.visualCells[0][0].surface.contentHash = HASH_A;
  assert.throws(
    () => ContentReleaseInternals.assertExactMapAssets(changed, bundle),
    /does not exactly match/
  );
});

test('release renderer contracts bind exact categories and logical footprints', async () => {
  const map = structuredClone(await createMinimalBattleMapV3FinalFixture());
  const surfaceAsset = map.visualCells[0][0].surface;
  const obstacleAsset = {
    assetBundleId: 'fixture-assets',
    key: 'obstacle:fallen-tree',
    contentVersion: 1,
    contentHash: HASH_A,
    immutableUrl: '/assets/battle-map-v3/fixture-assets/v1/fallen-tree.webp'
  };
  const connectionAsset = {
    assetBundleId: 'fixture-assets',
    key: 'connection:stairs',
    contentVersion: 1,
    contentHash: HASH_B,
    immutableUrl: '/assets/battle-map-v3/fixture-assets/v1/stairs.webp'
  };
  map.obstacles.push({
    id: 'obstacle:fallen-tree',
    cells: [{ x: 2, y: 2 }, { x: 3, y: 2 }],
    asset: obstacleAsset
  });
  map.elevationConnections.push({
    id: 'connection:east-stairs',
    kind: 'stairs',
    from: { x: 3, y: 3 },
    to: { x: 4, y: 3 },
    direction: 'e',
    asset: connectionAsset
  }, {
    id: 'connection:assetless-slope',
    kind: 'slope',
    from: { x: 4, y: 4 },
    to: { x: 4, y: 5 },
    direction: 's',
    asset: null
  });
  const renderer = (asset, category, footprint) => ({
    id: asset.key,
    theme: 'forest',
    category,
    contentVersion: asset.contentVersion,
    sha256: asset.contentHash,
    immutableUrl: asset.immutableUrl,
    footprint
  });
  const artBundle = {
    renderers: [
      renderer(surfaceAsset, 'surface', { x: 0, y: 0, width: 1, height: 1 }),
      renderer(
        obstacleAsset,
        'blocking-obstacle',
        { x: 0, y: 0, width: 2, height: 1 }
      ),
      renderer(
        connectionAsset,
        'connection-stairs',
        { x: 0, y: 0, width: 1, height: 2 }
      )
    ]
  };

  assert.doesNotThrow(() =>
    ContentReleaseInternals.assertMapRendererContracts(map, artBundle)
  );
  assert.equal(
    ContentReleaseInternals.collectMapAssetRefs(map).includes(null),
    false
  );

  const wrongFootprint = structuredClone(artBundle);
  wrongFootprint.renderers.find(
    record => record.id === obstacleAsset.key
  ).footprint = { x: 0, y: 0, width: 1, height: 1 };
  assert.throws(
    () => ContentReleaseInternals.assertMapRendererContracts(map, wrongFootprint),
    /obstacle:fallen-tree footprint 2x1 does not match renderer footprint 1x1/
  );

  const wrongCategory = structuredClone(artBundle);
  wrongCategory.renderers.find(
    record => record.id === connectionAsset.key
  ).category = 'route-transition';
  assert.throws(
    () => ContentReleaseInternals.assertMapRendererContracts(map, wrongCategory),
    /requires connection-stairs renderer, received route-transition/
  );

  const wrongExactDescriptor = structuredClone(artBundle);
  wrongExactDescriptor.renderers.find(
    record => record.id === obstacleAsset.key
  ).sha256 = HASH_B;
  assert.throws(
    () =>
      ContentReleaseInternals.assertMapRendererContracts(map, wrongExactDescriptor),
    /does not match its exact renderer descriptor/
  );

  const missingStairs = structuredClone(map);
  missingStairs.elevationConnections[0].asset = null;
  assert.doesNotThrow(() =>
    ContentReleaseInternals.assertMapRendererContracts(
      missingStairs,
      artBundle
    )
  );

  missingStairs.ecologyProfile = 'forest-iron-depths-borderwood';
  missingStairs.elevationConnections[0].heightDelta = 1;
  const v2ArtBundle = structuredClone(artBundle);
  for (const record of v2ArtBundle.renderers) {
    record.variant = {
      ecologyProfile: missingStairs.ecologyProfile
    };
  }
  assert.throws(
    () => ContentReleaseInternals.assertMapRendererContracts(
      missingStairs,
      v2ArtBundle
    ),
    /stairs requires an exact directional connection renderer/
  );
});

test('compile recipes resolve exact immutable art history instead of mutable current', () => {
  const bundle = (version, manifestFullHash) => ({
    id: 'bundle-history',
    version,
    manifestFullHash,
    assets: [{ key: `asset-v${version}` }],
    renderers: [{ id: `asset-v${version}` }]
  });
  const v1 = bundle(1, `sha256:${'1'.repeat(64)}`);
  const v2 = bundle(2, `sha256:${'2'.repeat(64)}`);
  const v3 = bundle(3, `sha256:${'3'.repeat(64)}`);
  const release = value => ({
    path: `ai-image-metadata/battle-art/releases/${value.id}.v${value.version}.json`,
    release: { bundle: value }
  });
  const history = [release(v1), release(v2)];
  const registryWithReplacedCurrent = buildBundleRegistry(history, v3);

  assert.deepEqual(
    ContentReleaseInternals.resolveRecipeArtBundle(
      history,
      registryWithReplacedCurrent,
      v1.manifestFullHash,
      {
        id: v1.id,
        version: v1.version,
        manifestFullHash: v1.manifestFullHash
      }
    ),
    { path: release(v1).path, bundle: v1 }
  );
  assert.deepEqual(
    ContentReleaseInternals.resolveRecipeArtBundle(
      history,
      registryWithReplacedCurrent,
      v2.manifestFullHash
    ),
    { path: release(v2).path, bundle: v2 }
  );
  assert.throws(
    () => ContentReleaseInternals.resolveRecipeArtBundle(
      history,
      registryWithReplacedCurrent,
      v3.manifestFullHash,
      {
        id: v3.id,
        version: v3.version,
        manifestFullHash: v3.manifestFullHash
      }
    ),
    /has no immutable release archive/
  );
});

test('capability claims fail closed when the map-bound report does not prove them', async () => {
  const map = await createMinimalBattleMapV3FinalFixture();
  const report = ContentReleaseInternals.deriveMapCapabilityReport(map);
  assert.equal(report.bossCapable, false);
  assert.equal(report.competitiveParity, false);
  assert.throws(
    () => ContentReleaseInternals.assertCapabilityClaims(
      { bossCapable: true, competitiveParity: false },
      report,
      map.contentId
    ),
    /falsely claims boss/
  );
  assert.throws(
    () => ContentReleaseInternals.assertCapabilityClaims(
      { bossCapable: false, competitiveParity: true },
      report,
      map.contentId
    ),
    /falsely claims competitive parity/
  );

  const competitiveMap = structuredClone(map);
  competitiveMap.supportedModes = ['pvp_coliseum'];
  competitiveMap.tierEligibility = ['1v1', '3v3', '5v5'];
  competitiveMap.spawnContract.capacities.maxAssignableOpponents = 5;
  const competitiveReport =
    ContentReleaseInternals.deriveMapCapabilityReport(competitiveMap);
  assert.deepEqual(
    competitiveReport.parityCases.map(record => record.size),
    [1, 3, 5]
  );
  for (const parityCase of competitiveReport.parityCases) {
    if (parityCase.player !== null) {
      assert.ok(Object.hasOwn(parityCase.player, 'meanRangeTargets'));
      assert.ok(Object.hasOwn(parityCase.opponent, 'meanRangeTargets'));
    }
  }
});

test('diversity canonicalization collapses translated, reflected, and permuted clones', () => {
  const original = [
    { label: 'route:main', x: 2, y: 3 },
    { label: 'route:main', x: 3, y: 3 },
    { label: 'formation:player', x: 2, y: 4 }
  ];
  const transformedAndPermuted = [
    { label: 'formation:player', x: 18, y: 8 },
    { label: 'route:main', x: 19, y: 9 },
    { label: 'route:main', x: 18, y: 9 }
  ];
  assert.equal(
    ContentReleaseInternals.canonicalizeCoordinateItems(original),
    ContentReleaseInternals.canonicalizeCoordinateItems(transformedAndPermuted)
  );
});

test('renderer-aware art projection remains compatible with the shared bundle hash contract', async () => {
  const base = {
    id: 'bundle:test',
    version: 1,
    manifestFullHash: null,
    rendererManifestFullHash: null,
    assets: [{
      key: 'asset:test',
      contentVersion: 1,
      contentHash: HASH_A,
      immutableUrl: '/assets/battle-map-v3/bundle-test/asset-test.webp'
    }]
  };
  const renderers = [{
    id: 'asset:test',
    contentVersion: 1,
    sha256: HASH_A,
    immutableUrl: '/assets/battle-map-v3/bundle-test/asset-test.webp'
  }];
  const renderProfile = {
    id: 'iso64-retina-v3',
    geometryVersion: 1
  };
  base.rendererManifestFullHash = await computeBattleArtRendererManifestFullHash({
    ...base,
    renderProfile,
    renderers
  });
  base.manifestFullHash = await computeTemplateMapAssetBundleManifestFullHash(base);
  const projection = await ContentReleaseInternals.compilerAssetBundleProjection({
    schemaVersion: 'battle-art-runtime-bundle-v1',
    ...base,
    renderProfile,
    renderers
  });
  assert.equal(projection.manifestFullHash, base.manifestFullHash);
  assert.equal(projection.rendererManifestFullHash, base.rendererManifestFullHash);
  assert.doesNotThrow(() =>
    ContentReleaseInternals.assertRuntimeBundleMirror(
      { id: 'bundle', assets: [1] },
      { assets: [1], id: 'bundle' }
    )
  );
  assert.throws(
    () => ContentReleaseInternals.assertRuntimeBundleMirror(
      { id: 'bundle', assets: [1] },
      { id: 'bundle', assets: [2] }
    ),
    /mirror is stale/
  );
});

test('coverage validation exercises every declared theme and capacity case without network', async () => {
  assert.equal(REQUIRED_BATTLE_MAP_V3_COVERAGE_QUERIES.length, 78);
  assert.equal(REQUIRED_BATTLE_MAP_V3_ECOLOGY_COVERAGE_QUERIES.length, 118);
  assert.equal(new Set(
    REQUIRED_BATTLE_MAP_V3_ECOLOGY_COVERAGE_QUERIES.map(
      query => `${query.theme}\0${query.ecologyProfile}`
    )
  ).size, 24);

  const entries = REQUIRED_BATTLE_MAP_V3_ECOLOGY_COVERAGE_QUERIES
    .map(catalogEntry)
    .sort((left, right) => left.mapContentId.localeCompare(right.mapContentId));
  const release = await finalizeBattleMapV3CatalogRelease({
    catalogSchemaVersion: BATTLE_MAP_V3_CATALOG_SCHEMA_VERSION,
    catalogReleaseId: 'catalog:test-v1',
    selectorVersion: BATTLE_MAP_V3_SELECTOR_VERSION,
    assetBundlePins: [{
      assetBundleId: 'bundle:test',
      manifestFullHash: HASH_B
    }],
    entries
  });
  const definitionEntries = entries
    .map(entry => ({
      id: entry.id,
      mapPath: `battle-maps/compiled/${entry.theme}/${entry.mapContentId}.v1.json`,
      approvalPath:
        `battle-maps/approvals/${entry.theme}/${entry.mapContentId}.v1.json`,
      approvalFileSha256: HASH_A,
      orientation: entry.orientation,
      teamLayout: entry.teamLayout,
      weight: entry.weight,
      bossCapable: entry.bossCapable,
      competitiveParity: entry.competitiveParity
    }))
    .sort((left, right) => left.mapPath.localeCompare(right.mapPath));
  const definition = coverageDefinition(definitionEntries);
  ContentReleaseInternals.validateCatalogDefinition(definition, 'catalog:test-v1');
  assert.throws(
    () => ContentReleaseInternals.assertCompleteReleaseCorpus(release, []),
    /exactly 144/
  );

  const previousFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('network is forbidden in release tests');
  };
  try {
    const result = await checkReleaseCoverage(release, definition, {
      requireComplete: true
    });
    const expectedQueryCount =
      REQUIRED_BATTLE_MAP_V3_ECOLOGY_COVERAGE_QUERIES
      .reduce(
        (total, query) =>
          total + query.playerCounts.length * query.opponentCounts.length,
        0
      );
    assert.equal(result.queryCount, expectedQueryCount);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }

  const incomplete = structuredClone(definition);
  incomplete.coverageQueries.pop();
  assert.doesNotThrow(() =>
    ContentReleaseInternals.validateCatalogDefinition(
      incomplete,
      'catalog:test-v1'
    )
  );
  await assert.rejects(
    checkReleaseCoverage(release, incomplete, { requireComplete: true }),
    /full authoritative/
  );

  const missingRegionalEcology = structuredClone(definition);
  const regionalIndex = missingRegionalEcology.coverageQueries.findIndex(
    query =>
      query.id === 'coverage:forest:pve:tier-1'
      && query.ecologyProfile === 'forest-iron-depths-borderwood'
  );
  assert.notEqual(regionalIndex, -1);
  missingRegionalEcology.coverageQueries.splice(regionalIndex, 1);
  assert.doesNotThrow(() =>
    ContentReleaseInternals.validateCatalogDefinition(
      missingRegionalEcology,
      'catalog:test-v1'
    )
  );
  await assert.rejects(
    checkReleaseCoverage(release, missingRegionalEcology, {
      requireComplete: true
    }),
    /118-case theme\/ecology/
  );
});

test('coverage supports repeated authoritative cases qualified by ecology and legacy v1 cases', async () => {
  const targetQuery = REQUIRED_BATTLE_MAP_V3_COVERAGE_QUERIES.find(query =>
    query.theme === 'forest'
    && query.mode === 'pve'
    && query.selectionBand === 'tier-1'
  );
  const alternateEcologyProfile = 'ecology:forest:alternate';
  const entries = REQUIRED_BATTLE_MAP_V3_COVERAGE_QUERIES.map(catalogEntry);
  entries.push({
    ...catalogEntry(targetQuery),
    id: `${catalogEntry(targetQuery).id}:alternate`,
    mapContentId: `${catalogEntry(targetQuery).mapContentId}:alternate`,
    ecologyProfile: alternateEcologyProfile
  });
  entries.sort((left, right) =>
    left.mapContentId.localeCompare(right.mapContentId)
  );
  const release = await finalizeBattleMapV3CatalogRelease({
    catalogSchemaVersion: BATTLE_MAP_V3_CATALOG_SCHEMA_VERSION,
    catalogReleaseId: 'catalog:test-v1',
    selectorVersion: BATTLE_MAP_V3_SELECTOR_VERSION,
    assetBundlePins: [{
      assetBundleId: 'bundle:test',
      manifestFullHash: HASH_B
    }],
    entries
  });
  const partialCoverageQueries = REQUIRED_BATTLE_MAP_V3_COVERAGE_QUERIES
    .map(query => ({
      ...structuredClone(query),
      ecologyProfile: `ecology:${query.theme}`
    }));
  const definition = coverageDefinition(
    entries.map(definitionEntry).sort((left, right) =>
      left.mapPath < right.mapPath ? -1 : left.mapPath > right.mapPath ? 1 : 0
    ),
    partialCoverageQueries
  );
  const qualifiedCase = definition.coverageQueries.find(query =>
    query.id === targetQuery.id
  );
  definition.coverageQueries.push({
    ...structuredClone(qualifiedCase),
    ecologyProfile: alternateEcologyProfile
  });
  definition.coverageQueries.sort((left, right) => {
    const leftKey = `${left.id}\0${left.ecologyProfile ?? ''}`;
    const rightKey = `${right.id}\0${right.ecologyProfile ?? ''}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  assert.doesNotThrow(() =>
    ContentReleaseInternals.validateCatalogDefinition(
      definition,
      'catalog:test-v1'
    )
  );
  const result = await checkReleaseCoverage(release, definition);
  const addedQueryCount =
    targetQuery.playerCounts.length * targetQuery.opponentCounts.length;
  assert.equal(
    result.queryCount,
    REQUIRED_BATTLE_MAP_V3_COVERAGE_QUERIES.reduce(
      (total, query) =>
        total + query.playerCounts.length * query.opponentCounts.length,
      addedQueryCount
    )
  );
  assert.ok(result.selections.some(selection =>
    selection.coverageId === targetQuery.id
    && selection.selectedEntryId.endsWith(':alternate')
  ));

  const legacyEntry = { ...catalogEntry(targetQuery) };
  delete legacyEntry.ecologyProfile;
  const legacyRelease = await finalizeBattleMapV3CatalogRelease({
    catalogSchemaVersion: 1,
    catalogReleaseId: 'catalog:test-v1',
    selectorVersion: 1,
    assetBundlePins: [{
      assetBundleId: 'bundle:test',
      manifestFullHash: HASH_B
    }],
    entries: [legacyEntry]
  });
  const legacyDefinition = {
    schemaVersion: CATALOG_DEFINITION_SCHEMA,
    catalogReleaseId: 'catalog:test-v1',
    entries: [definitionEntry(legacyEntry)],
    coverageQueries: [structuredClone(targetQuery)]
  };
  ContentReleaseInternals.validateCatalogDefinition(
    legacyDefinition,
    'catalog:test-v1'
  );
  assert.equal(
    (await checkReleaseCoverage(legacyRelease, legacyDefinition)).queryCount,
    targetQuery.playerCounts.length * targetQuery.opponentCounts.length
  );
});

test('coverage rejects every undersized positive-weight entry in an eligible capacity band', async () => {
  const targetQuery = REQUIRED_BATTLE_MAP_V3_COVERAGE_QUERIES.find(query =>
    query.theme === 'forest'
    && query.mode === 'pve'
    && query.selectionBand === 'tier-1'
  );
  const entries = ['a', 'b'].map(suffix => ({
    ...catalogEntry(targetQuery),
    id: `${catalogEntry(targetQuery).id}:${suffix}`,
    mapContentId: `${catalogEntry(targetQuery).mapContentId}:${suffix}`
  }));
  const releaseCandidate = {
    catalogSchemaVersion: BATTLE_MAP_V3_CATALOG_SCHEMA_VERSION,
    catalogReleaseId: 'catalog:test-v1',
    selectorVersion: BATTLE_MAP_V3_SELECTOR_VERSION,
    assetBundlePins: [{
      assetBundleId: 'bundle:test',
      manifestFullHash: HASH_B
    }],
    entries
  };
  const allFullCapacityRelease =
    await finalizeBattleMapV3CatalogRelease(releaseCandidate);
  const definition = {
    schemaVersion: CATALOG_DEFINITION_SCHEMA,
    catalogReleaseId: 'catalog:test-v1',
    entries: entries.map(definitionEntry),
    coverageQueries: [{
      ...structuredClone(targetQuery),
      ecologyProfile: 'ecology:forest'
    }]
  };
  const maximumQuery = ContentReleaseInternals.expandCoverageQueries(definition)
    .find(item => item.query.playerCount === 5 && item.query.opponentCount === 7)
    .query;
  const seedZeroSelection = await selectBattleMapV3CatalogEntry(
    allFullCapacityRelease,
    maximumQuery
  );
  const undersizedEntryId = entries.find(entry =>
    entry.id !== seedZeroSelection.entry.id
  ).id;
  const mixedCapacityEntries = entries.map(entry =>
    entry.id === undersizedEntryId
      ? { ...entry, playerCapacity: 4, maxAssignableOpponents: 6 }
      : entry
  );
  const mixedCapacityRelease = await finalizeBattleMapV3CatalogRelease({
    ...releaseCandidate,
    entries: mixedCapacityEntries
  });
  assert.equal(
    (await selectBattleMapV3CatalogEntry(
      mixedCapacityRelease,
      maximumQuery
    )).entry.id,
    seedZeroSelection.entry.id,
    'seed zero still selects the full-capacity entry'
  );

  await assert.rejects(
    checkReleaseCoverage(mixedCapacityRelease, definition),
    /eligible.*supports only 4 players and 6 opponents.*requires 5 players and 7 opponents/
  );

  const arenaQuery = REQUIRED_BATTLE_MAP_V3_COVERAGE_QUERIES.find(query =>
    query.theme === 'arena' && query.selectionBand === '1v1'
  );
  const arenaEntry = {
    ...catalogEntry(arenaQuery),
    playerCapacity: 1,
    maxAssignableOpponents: 1
  };
  const arenaRelease = await finalizeBattleMapV3CatalogRelease({
    ...releaseCandidate,
    entries: [arenaEntry]
  });
  const arenaDefinition = {
    schemaVersion: CATALOG_DEFINITION_SCHEMA,
    catalogReleaseId: 'catalog:test-v1',
    entries: [definitionEntry(arenaEntry)],
    coverageQueries: [{
      ...structuredClone(arenaQuery),
      ecologyProfile: 'ecology:arena'
    }]
  };
  await assert.rejects(
    checkReleaseCoverage(arenaRelease, arenaDefinition),
    /supports only 1 players and 1 opponents.*requires 5 players and 7 opponents/
  );
});

test('metadata mode is explicitly barred from changing the tracked active pin', async () => {
  await assert.rejects(
    buildCatalogRelease({
      projectRoot: '/definitely/not/read',
      releaseId: 'catalog:test-v1',
      binaryMode: 'metadata',
      activate: true
    }),
    /requires restored local binary verification/
  );
});
