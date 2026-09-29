import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  TEMPLATE_MAP_COMPILER_VERSION,
  compileTemplateMapBlueprint,
  computeTemplateMapAssetBundleManifestFullHash,
  computeTemplateMapBlueprintFullHash,
  computeTemplateMapSourceSidecarFullHash,
  computeTemplateMapTileCatalogFullHash,
  finalizeBattleMapV3,
  normalizeBattleMapV3Final
} from '../../shared/battleMap/v3/index.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../..');
const PROFILE_PATH = 'battle-maps/render-profiles/cave-limestone-v1.json';
const CATALOG_PATH = 'battle-maps/tile-catalogs/cave-limestone-v1.json';
const DESCRIPTOR_DIRECTORY =
  'ai-image-metadata/battle-art/descriptors/cave';
const BLUEPRINT_DIRECTORY =
  'ai-image-metadata/battle-maps/blueprints/cave/cave-template-01';
const SIDECAR_PATH =
  'ai-image-metadata/battle-maps/templates/cave/cave-template-01.json';
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const DIRECTIONS = ['n', 'e', 's', 'w'];
const ROUTE_TOPOLOGIES = [
  'isolated',
  'end-n', 'end-e', 'end-s', 'end-w',
  'straight-ns', 'straight-ew',
  'corner-ne', 'corner-es', 'corner-sw', 'corner-wn',
  'tee-nes', 'tee-esw', 'tee-nsw', 'tee-wne',
  'cross'
];
const CATEGORY_MAP = new Map([
  ['surface', 'surface'],
  ['route-transition', 'route'],
  ['connection-stairs', 'connection'],
  ['connection-slope', 'connection'],
  ['exposed-face-boundary', 'boundary'],
  ['blocking-obstacle', 'obstacle'],
  ['nonblocking-decoration', 'decoration']
]);

function exactKeys(value, expected, label) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} keys`);
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(PROJECT_ROOT, relativePath), 'utf8'));
}

function hash(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function bindingIdentity(binding) {
  return JSON.stringify([
    binding.category,
    binding.symbol,
    Object.entries(binding.match).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  ]);
}

function descriptorSymbol(descriptor) {
  return descriptor.familyGroup.replace(/^cave-limestone-/, '');
}

function descriptorMatch(descriptor) {
  const match = { ecologyProfile: descriptor.capabilities.ecologyProfile };
  if (descriptor.capabilities.direction !== null) {
    match.direction = descriptor.capabilities.direction;
  }
  if (descriptor.capabilities.routeTopology !== null) {
    match.routeTopology = descriptor.capabilities.routeTopology;
  }
  if (descriptor.capabilities.surfaceVariant !== null) {
    match.surfaceVariant = descriptor.capabilities.surfaceVariant;
  }
  if (descriptor.capabilities.heightDeltas[0] === 1) match.heightDelta = 1;
  return match;
}

async function readCaveDescriptors() {
  const names = (await readdir(path.join(PROJECT_ROOT, DESCRIPTOR_DIRECTORY)))
    .filter(name => name.endsWith('.json'))
    .sort();
  return Promise.all(names.map(name => readJson(`${DESCRIPTOR_DIRECTORY}/${name}`)));
}

function expectedFamilies() {
  return [
    ['surface', 'worn-floor'],
    ['route', 'curved-passage'],
    ['connection', 'natural-ramp'],
    ['connection', 'carved-stairs'],
    ['boundary', 'flowstone-edge'],
    ['boundary', 'layered-face'],
    ['obstacle', 'stalagmite-cluster'],
    ['obstacle', 'broken-column'],
    ['obstacle', 'flowstone-curtain'],
    ['obstacle', 'fallen-rock'],
    ['decoration', 'calcite-crystals'],
    ['decoration', 'mineral-staining'],
    ['decoration', 'scattered-rubble']
  ].map(([category, symbol]) => `${category}:${symbol}`).sort();
}

test('cave limestone release inputs are closed, canonical, and binding-complete against descriptor capabilities',
  async () => {
    const [profile, catalog, descriptors] = await Promise.all([
      readJson(PROFILE_PATH),
      readJson(CATALOG_PATH),
      readCaveDescriptors()
    ]);

    exactKeys(profile, [
      'schemaVersion', 'id', 'theme', 'ecologyProfile', 'assetBundleId',
      'scene', 'surfaceVariantCount', 'elevationFaceSymbols', 'assetBindings'
    ], 'render profile');
    exactKeys(profile.scene, ['silhouette', 'exterior', 'backdrop'], 'scene');
    exactKeys(profile.scene.backdrop, [
      'kind', 'topColor', 'horizonColor', 'bottomColor', 'hazeColor'
    ], 'scene backdrop');
    assert.deepEqual({
      schemaVersion: profile.schemaVersion,
      id: profile.id,
      theme: profile.theme,
      ecologyProfile: profile.ecologyProfile,
      assetBundleId: profile.assetBundleId,
      silhouette: profile.scene.silhouette,
      exterior: profile.scene.exterior,
      backdropKind: profile.scene.backdrop.kind,
      surfaceVariantCount: profile.surfaceVariantCount,
      elevationFaceSymbols: profile.elevationFaceSymbols
    }, {
      schemaVersion: 'battle-map-render-profile-v2',
      id: 'cave-limestone-v1',
      theme: 'cave',
      ecologyProfile: 'cave-limestone',
      assetBundleId: 'battle-art-descriptors-2026-07-30',
      silhouette: 'organic-island',
      exterior: 'cave-rock',
      backdropKind: 'cavern-gradient',
      surfaceVariantCount: 4,
      elevationFaceSymbols: { 'worn-floor': 'layered-face' }
    });
    for (const color of Object.values(profile.scene.backdrop).slice(1)) {
      assert.match(color, /^#[0-9A-F]{6}$/);
    }

    exactKeys(catalog, [
      'id', 'version', 'fullHash', 'renderProfileId', 'materials'
    ], 'tile catalog');
    assert.deepEqual(catalog, {
      id: 'cave-limestone-v1-tiles',
      version: 1,
      fullHash:
        'sha256:110368099f3f911057dcb0a3f58cb07808fbbb4278f70f0fc69b625845de3fd1',
      renderProfileId: 'cave-limestone-v1',
      materials: [{
        symbol: 'worn-floor',
        material: 'limestone-floor',
        passable: true,
        movementCost: 1
      }]
    });
    assert.equal(await computeTemplateMapTileCatalogFullHash(catalog), catalog.fullHash);

    assert.equal(descriptors.length, 43);
    assert.equal(profile.assetBindings.length, 43);
    assert.equal(new Set(profile.assetBindings.map(bindingIdentity)).size, 43);
    assert.equal(new Set(profile.assetBindings.map(binding => binding.assetKey)).size, 43);
    assert.deepEqual(
      profile.assetBindings.map(binding => binding.assetKey).sort(),
      descriptors.map(descriptor => descriptor.id).sort()
    );

    const bindingsByAsset = new Map(
      profile.assetBindings.map(binding => [binding.assetKey, binding])
    );
    for (const descriptor of descriptors) {
      assert.equal(descriptor.schemaVersion, 'battle-art-family-descriptor-v2');
      assert.equal(descriptor.theme, 'cave');
      exactKeys(descriptor.capabilities, [
        'direction', 'routeTopology', 'surfaceVariant', 'ecologyProfile',
        'tierBands', 'heightDeltas'
      ], `${descriptor.id} capabilities`);
      assert.equal(descriptor.capabilities.ecologyProfile, 'cave-limestone');
      assert.deepEqual(descriptor.capabilities.tierBands, [1, 2, 3, 4, 5]);
      assert.deepEqual(
        descriptor.capabilities.heightDeltas,
        ['connection-stairs', 'connection-slope', 'exposed-face-boundary']
          .includes(descriptor.category) ? [1] : [0]
      );
      assert.equal(Object.hasOwn(bindingsByAsset.get(descriptor.id).match, 'tier'), false);
      assert.deepEqual(bindingsByAsset.get(descriptor.id), {
        category: CATEGORY_MAP.get(descriptor.category),
        symbol: descriptorSymbol(descriptor),
        match: descriptorMatch(descriptor),
        assetKey: descriptor.id
      });
    }

    assert.deepEqual(
      [...new Set(profile.assetBindings.map(
        binding => `${binding.category}:${binding.symbol}`
      ))].sort(),
      expectedFamilies()
    );
    assert.deepEqual(
      profile.assetBindings.filter(binding => binding.category === 'surface')
        .map(binding => binding.match.surfaceVariant).sort(),
      [0, 1, 2, 3]
    );
    assert.deepEqual(
      profile.assetBindings.filter(binding => binding.category === 'route')
        .map(binding => binding.match.routeTopology).sort(),
      [...ROUTE_TOPOLOGIES].sort()
    );
    for (const symbol of [
      'carved-stairs', 'natural-ramp', 'flowstone-edge', 'layered-face'
    ]) {
      assert.deepEqual(
        profile.assetBindings.filter(binding => binding.symbol === symbol)
          .map(binding => binding.match.direction).sort(),
        [...DIRECTIONS].sort()
      );
    }
  });

test('cave limestone contract-only synthetic bundle compiles/finalizes A/B/C without claiming release readiness',
  async () => {
    const [profile, catalog, sourceSidecar] = await Promise.all([
      readJson(PROFILE_PATH),
      readJson(CATALOG_PATH),
      readJson(SIDECAR_PATH)
    ]);
    // This fake bundle proves compiler capability closure only. Descriptor
    // lifecycle status and a real compiled runtime bundle remain the release
    // readiness authorities.
    const assetBundle = {
      id: profile.assetBundleId,
      version: 1,
      manifestFullHash: hash('placeholder-manifest'),
      rendererManifestFullHash: hash('synthetic-cave-renderers'),
      assets: profile.assetBindings.map(binding => ({
        key: binding.assetKey,
        contentVersion: 1,
        contentHash: hash(binding.assetKey),
        immutableUrl: `/synthetic/cave/${binding.assetKey}.webp`
      }))
    };
    assetBundle.manifestFullHash =
      await computeTemplateMapAssetBundleManifestFullHash(assetBundle);
    const sourceSidecarFullHash =
      await computeTemplateMapSourceSidecarFullHash(sourceSidecar);

    for (const variant of ['a', 'b', 'c']) {
      const blueprint = await readJson(
        `${BLUEPRINT_DIRECTORY}/cave-template-01-${variant}.json`
      );
      assert.deepEqual(
        blueprint.expectedAssetFamilies.map(
          family => `${family.category}:${family.symbol}`
        ).sort(),
        expectedFamilies()
      );
      const blueprintFullHash = await computeTemplateMapBlueprintFullHash(blueprint);
      const context = {
        identity: {
          contentId: `cave-template-01-${variant}`,
          contentVersion: 1,
          templateRevision: 1,
          theme: 'cave',
          tierEligibility: [...sourceSidecar.tierEligibility],
          supportedModes: [...sourceSidecar.supportedModes]
        },
        sourceSidecar,
        renderProfile: profile,
        tileCatalog: catalog,
        assetBundle,
        provenance: {
          sourceSidecar: {
            id: sourceSidecar.id,
            version: 1,
            fullHash: sourceSidecarFullHash
          },
          approvedBlueprint: {
            id: blueprint.candidateId,
            version: 1,
            fullHash: blueprintFullHash
          },
          compiler: {
            id: 'template-map-compiler',
            version: TEMPLATE_MAP_COMPILER_VERSION,
            fullHash: sourceSidecar.pins.compilerSha256
          },
          validator: {
            id: 'battle-map-v3-validator',
            version: 1,
            fullHash: hash('cave-validator')
          }
        }
      };

      const candidate = await compileTemplateMapBlueprint(blueprint, context);
      assert.equal(candidate.ecologyProfile, 'cave-limestone');
      assert.equal(candidate.renderProfileId, 'cave-limestone-v1');
      const finalMap = await finalizeBattleMapV3(candidate);
      assert.match(finalMap.hashes.fullHash, HASH_PATTERN);
      assert.deepEqual(await normalizeBattleMapV3Final(finalMap), finalMap);
    }
  });
