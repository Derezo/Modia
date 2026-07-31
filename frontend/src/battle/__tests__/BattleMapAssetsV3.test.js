import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  computeTemplateMapAssetBundleManifestFullHash,
  hashCanonicalV3Value
} from '@modia/shared';
import {
  assertBattleMapV3RuntimeManifestSupportsMap,
  clearBattleMapV3RuntimeManifest,
  collectBattleMapV3AssetManifest,
  getBattleMapV3RendererDescriptor,
  getBattleMapV3RenderProfile,
  installBattleMapV3RuntimeBundle,
  installBattleMapV3RuntimeBundleRegistry,
  isBattleMapV3RuntimeReady,
  setBattleMapV3RuntimeManifest
} from '../BattleMapAssets.js';
import {
  createRuntimeBundleForMap,
  createSignedEmptyRuntimeBundle
} from './battleMapV3RuntimeFixture.js';

const MANIFEST_HASH = `sha256:${'f'.repeat(64)}`;
const RENDERER_MANIFEST_HASH_DOMAIN =
  'modia:battle-art:renderer-manifest:v1';

async function trackedRuntimeBundle() {
  return JSON.parse(await readFile(
    new URL('../../generated/battleMapV3RuntimeBundle.json', import.meta.url),
    'utf8'
  ));
}

function asset(key, hashCharacter, immutableUrl = `/v3/${key}.webp`) {
  return {
    assetBundleId: 'bundle',
    key,
    contentVersion: 1,
    contentHash: `sha256:${hashCharacter.repeat(64)}`,
    immutableUrl
  };
}

function mapWithEveryAssetCategory() {
  return {
    battleMapSchemaVersion: 3,
    provenance: {
      assetBundle: {
        id: 'bundle',
        version: 1,
        manifestFullHash: MANIFEST_HASH
      }
    },
    visualCells: [[{
      surface: asset('surface', '1'),
      overlays: [asset('overlay', '2')]
    }]],
    elevationConnections: [{ asset: asset('connection', '3') }],
    obstacles: [{ asset: asset('obstacle', '4') }],
    decorations: [{ asset: asset('decoration', '5') }],
    boundaries: [{ asset: asset('boundary', '6') }],
    routes: [{
      visualAssets: [{ asset: asset('route', '7') }]
    }]
  };
}

function runtimeManifest(map) {
  return createRuntimeBundleForMap(map);
}

async function signRuntimeBundle(bundle) {
  const signed = structuredClone(bundle);
  signed.rendererManifestFullHash = await hashCanonicalV3Value(
    RENDERER_MANIFEST_HASH_DOMAIN,
    {
      id: signed.id,
      version: signed.version,
      renderProfile: signed.renderProfile,
      renderers: signed.renderers
    }
  );
  signed.manifestFullHash =
    await computeTemplateMapAssetBundleManifestFullHash(signed);
  return signed;
}

async function versionedMapAndBundle(version, hashCharacter) {
  const map = mapWithEveryAssetCategory();
  map.provenance.assetBundle.version = version;
  for (const record of collectBattleMapV3AssetManifest(map)) {
    record.contentVersion = version;
    record.contentHash = `sha256:${hashCharacter.repeat(64)}`;
    record.immutableUrl = `/v3/v${version}/${record.key}.webp`;
  }
  const bundle = await signRuntimeBundle(runtimeManifest(map));
  map.provenance.assetBundle.manifestFullHash = bundle.manifestFullHash;
  return { map, bundle };
}

beforeEach(() => clearBattleMapV3RuntimeManifest());

describe('BattleMapV3 asset manifest', () => {
  it('collects every V3 asset-ref category exactly once', () => {
    const map = mapWithEveryAssetCategory();
    map.elevationConnections.unshift({
      kind: 'slope',
      asset: null
    });
    const manifest = collectBattleMapV3AssetManifest(map);

    assert.deepEqual(
      manifest.map(record => record.key),
      [
        'surface',
        'overlay',
        'connection',
        'obstacle',
        'decoration',
        'boundary',
        'route'
      ]
    );
  });

  it('rejects URL/hash and logical identity conflicts before loading', () => {
    const urlConflict = mapWithEveryAssetCategory();
    urlConflict.visualCells[0][0].overlays.push(
      asset('other', '9', '/v3/surface.webp')
    );
    assert.throws(
      () => collectBattleMapV3AssetManifest(urlConflict),
      /URL\/hash conflict/
    );

    const identityConflict = mapWithEveryAssetCategory();
    identityConflict.visualCells[0][0].overlays.push({
      ...asset('surface', '1'),
      immutableUrl: '/v3/alternate-surface.webp'
    });
    assert.throws(
      () => collectBattleMapV3AssetManifest(identityConflict),
      /identity conflict/
    );
  });

  it('advertises readiness only for a strict matching runtime bundle manifest', () => {
    const map = mapWithEveryAssetCategory();
    assert.equal(isBattleMapV3RuntimeReady(), false);
    assert.throws(
      () => assertBattleMapV3RuntimeManifestSupportsMap(map),
      /not ready/
    );

    setBattleMapV3RuntimeManifest(runtimeManifest(map));
    assert.equal(isBattleMapV3RuntimeReady(), true);
    assert.equal(assertBattleMapV3RuntimeManifestSupportsMap(map), true);
    assert.deepEqual(getBattleMapV3RenderProfile(), {
      id: 'iso64-retina-v3',
      sourcePixelScale: 4,
      tileWidth: 64,
      tileHeight: 32,
      elevationStep: 16
    });
    assert.equal(
      getBattleMapV3RendererDescriptor(map.visualCells[0][0].surface).width,
      256
    );

    const missingAsset = runtimeManifest(map);
    missingAsset.assets.pop();
    missingAsset.renderers.pop();
    setBattleMapV3RuntimeManifest(missingAsset);
    assert.throws(
      () => assertBattleMapV3RuntimeManifestSupportsMap(map),
      /does not contain exact asset route/
    );
  });

  it('rejects renderer closure, dimensions, and render-profile drift', () => {
    const map = mapWithEveryAssetCategory();
    const mismatch = runtimeManifest(map);
    mismatch.renderers[0].sha256 = `sha256:${'0'.repeat(64)}`;
    assert.throws(
      () => setBattleMapV3RuntimeManifest(mismatch),
      /closure mismatch/
    );

    const badDimensions = runtimeManifest(map);
    badDimensions.renderers[0].width = 255;
    assert.throws(
      () => setBattleMapV3RuntimeManifest(badDimensions),
      /divide by sourcePixelScale/
    );

    const badProfile = runtimeManifest(map);
    badProfile.renderProfile.tileWidth = 32;
    assert.throws(
      () => setBattleMapV3RuntimeManifest(badProfile),
      /tileWidth must equal 64/
    );
  });

  it('validates and exposes closed concrete renderer variants', () => {
    const map = mapWithEveryAssetCategory();
    const manifest = runtimeManifest(map);
    const routeRenderer = manifest.renderers.find(
      renderer => renderer.id === 'route'
    );
    routeRenderer.variant = {
      routeTopology: 'corner-ne',
      ecologyProfile: 'heartlands-deciduous',
      tier: 2
    };
    setBattleMapV3RuntimeManifest(manifest);
    assert.deepEqual(
      getBattleMapV3RendererDescriptor(
        map.routes[0].visualAssets[0].asset
      ).variant,
      routeRenderer.variant
    );

    for (const variant of [
      { direction: 'north' },
      { routeTopology: 'turn-ne' },
      { ecologyProfile: '' },
      { tier: 0 },
      { heightDelta: -1 },
      { unexpected: true }
    ]) {
      const invalid = runtimeManifest(map);
      invalid.renderers[0].variant = variant;
      assert.throws(
        () => setBattleMapV3RuntimeManifest(invalid),
        /variant/
      );
    }
  });

  it('accepts compiler-pinned surface diversity only on surface renderers', () => {
    const map = mapWithEveryAssetCategory();
    const manifest = runtimeManifest(map);
    const surfaceRenderer = manifest.renderers.find(
      renderer => renderer.id === 'surface'
    );
    surfaceRenderer.variant = {
      ecologyProfile: 'heartlands-deciduous',
      tier: 1,
      surfaceVariant: 7
    };
    setBattleMapV3RuntimeManifest(manifest);
    assert.equal(
      getBattleMapV3RendererDescriptor(
        map.visualCells[0][0].surface
      ).variant.surfaceVariant,
      7
    );

    for (const surfaceVariant of [-1, 8, 1.5]) {
      const invalid = runtimeManifest(map);
      invalid.renderers.find(renderer => renderer.id === 'surface').variant = {
        surfaceVariant
      };
      assert.throws(
        () => setBattleMapV3RuntimeManifest(invalid),
        /surfaceVariant must be an integer from 0 through 7/
      );
    }

    const wrongCategory = runtimeManifest(map);
    wrongCategory.renderers.find(renderer => renderer.id === 'route').variant = {
      routeTopology: 'isolated',
      surfaceVariant: 0
    };
    assert.throws(
      () => setBattleMapV3RuntimeManifest(wrongCategory),
      /surfaceVariant is supported only by surface renderers/
    );
  });

  it('allows empty occlusion only for non-occluding renderer categories', () => {
    const map = mapWithEveryAssetCategory();
    for (const key of ['surface', 'route', 'decoration']) {
      const manifest = runtimeManifest(map);
      manifest.renderers.find(renderer => renderer.id === key).occlusionBounds = {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      };
      assert.doesNotThrow(() => setBattleMapV3RuntimeManifest(manifest));
    }

    for (const [key, category] of [
      ['connection', 'connection-stairs'],
      ['connection', 'connection-slope'],
      ['obstacle', 'blocking-obstacle'],
      ['boundary', 'exposed-face-boundary']
    ]) {
      const manifest = runtimeManifest(map);
      const renderer = manifest.renderers.find(candidate => candidate.id === key);
      renderer.category = category;
      renderer.occlusionBounds = {
        x: 0,
        y: 0,
        width: 0,
        height: 0
      };
      assert.throws(
        () => setBattleMapV3RuntimeManifest(manifest),
        /occlusionBounds\.width must be an integer from 1/
      );
    }
  });

  it('rejects malformed, degenerate, negative, and out-of-bounds occlusion', () => {
    const invalidBounds = [
      { x: 0, y: 0, width: 0, height: 4 },
      { x: -1, y: 0, width: 0, height: 0 },
      { x: 1, y: 0, width: 0, height: 0 },
      { x: 257, y: 0, width: 0, height: 0 },
      { x: 250, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 1 }
    ];
    for (const occlusionBounds of invalidBounds) {
      const manifest = runtimeManifest(mapWithEveryAssetCategory());
      manifest.renderers.find(renderer => renderer.id === 'surface')
        .occlusionBounds = occlusionBounds;
      assert.throws(
        () => setBattleMapV3RuntimeManifest(manifest),
        /occlusionBounds/
      );
    }
  });

  it('keeps a state-independent signed empty draft non-fatal without V3', async () => {
    const battleMapV3RuntimeBundle = await createSignedEmptyRuntimeBundle();
    assert.equal(
      await installBattleMapV3RuntimeBundle(battleMapV3RuntimeBundle),
      false
    );
    assert.equal(isBattleMapV3RuntimeReady(), false);
    await assert.rejects(
      installBattleMapV3RuntimeBundle({
        ...battleMapV3RuntimeBundle,
        renderProfile: {
          ...battleMapV3RuntimeBundle.renderProfile,
          tileHeight: 64
        }
      }),
      /tileHeight must equal 32/
    );
  });

  it('cryptographically verifies both empty runtime-bundle projections', async () => {
    const battleMapV3RuntimeBundle = await createSignedEmptyRuntimeBundle();
    await assert.rejects(
      installBattleMapV3RuntimeBundle({
        ...battleMapV3RuntimeBundle,
        rendererManifestFullHash: `sha256:${'0'.repeat(64)}`
      }),
      /rendererManifestFullHash does not match/
    );
    await assert.rejects(
      installBattleMapV3RuntimeBundle({
        ...battleMapV3RuntimeBundle,
        manifestFullHash: `sha256:${'0'.repeat(64)}`
      }),
      /manifestFullHash does not match/
    );
    assert.equal(isBattleMapV3RuntimeReady(), false);
  });

  it('cryptographically verifies and installs the tracked non-empty bundle', async () => {
    const battleMapV3RuntimeBundle = await trackedRuntimeBundle();
    assert.ok(battleMapV3RuntimeBundle.assets.length > 0);
    assert.equal(
      await installBattleMapV3RuntimeBundle(battleMapV3RuntimeBundle),
      true
    );
    assert.equal(isBattleMapV3RuntimeReady(), true);
    for (const key of ['forest-dirt-route', 'forest-moss-surface']) {
      const asset = battleMapV3RuntimeBundle.assets.find(
        candidate => candidate.key === key
      );
      assert.deepEqual(
        getBattleMapV3RendererDescriptor({
          assetBundleId: battleMapV3RuntimeBundle.id,
          ...asset
        }).occlusionBounds,
        { x: 0, y: 0, width: 0, height: 0 }
      );
    }
  });

  it('resolves archived and current maps from their exact registry bundles', async () => {
    const archived = await versionedMapAndBundle(1, '1');
    const current = await versionedMapAndBundle(2, '2');

    assert.equal(await installBattleMapV3RuntimeBundleRegistry({
      schemaVersion: 'battle-art-runtime-bundle-registry-v1',
      bundles: [archived.bundle, current.bundle]
    }), true);

    assert.equal(
      assertBattleMapV3RuntimeManifestSupportsMap(archived.map),
      true
    );
    assert.equal(
      getBattleMapV3RendererDescriptor(
        archived.map.visualCells[0][0].surface
      ).contentVersion,
      1
    );

    assert.equal(
      assertBattleMapV3RuntimeManifestSupportsMap(current.map),
      true
    );
    assert.equal(
      getBattleMapV3RendererDescriptor(
        current.map.visualCells[0][0].surface
      ).contentVersion,
      2
    );
  });

  it('fails closed for tampered provenance and never falls back by version', async () => {
    const archived = await versionedMapAndBundle(1, '1');
    const current = await versionedMapAndBundle(2, '2');
    await installBattleMapV3RuntimeBundleRegistry({
      schemaVersion: 'battle-art-runtime-bundle-registry-v1',
      bundles: [archived.bundle, current.bundle]
    });

    for (const assetBundle of [
      {
        ...current.map.provenance.assetBundle,
        id: 'unknown-bundle'
      },
      {
        ...current.map.provenance.assetBundle,
        version: 1
      },
      {
        ...current.map.provenance.assetBundle,
        manifestFullHash: `sha256:${'0'.repeat(64)}`
      },
      {
        ...archived.map.provenance.assetBundle,
        version: 3
      }
    ]) {
      const tampered = structuredClone(current.map);
      tampered.provenance.assetBundle = assetBundle;
      assert.throws(
        () => assertBattleMapV3RuntimeManifestSupportsMap(tampered),
        /pin is unavailable/
      );
      assert.throws(
        () => getBattleMapV3RendererDescriptor(
          tampered.visualCells[0][0].surface
        ),
        /bundle is not selected/
      );
    }
  });

  it('rejects an ambiguous registry atomically', async () => {
    const archived = await versionedMapAndBundle(1, '1');
    const current = await versionedMapAndBundle(2, '2');
    await installBattleMapV3RuntimeBundleRegistry({
      schemaVersion: 'battle-art-runtime-bundle-registry-v1',
      bundles: [current.bundle]
    });

    await assert.rejects(
      installBattleMapV3RuntimeBundleRegistry({
        schemaVersion: 'battle-art-runtime-bundle-registry-v1',
        bundles: [archived.bundle, structuredClone(archived.bundle)]
      }),
      /ambiguous bundle/
    );
    assert.equal(
      assertBattleMapV3RuntimeManifestSupportsMap(current.map),
      true
    );
  });

  it('rejects cross-bundle URL/hash conflicts and ignores an empty registry', async () => {
    const archived = await versionedMapAndBundle(1, '1');
    const current = await versionedMapAndBundle(2, '2');
    await installBattleMapV3RuntimeBundleRegistry({
      schemaVersion: 'battle-art-runtime-bundle-registry-v1',
      bundles: [current.bundle]
    });

    const conflicting = structuredClone(current.bundle);
    conflicting.assets[0].immutableUrl =
      archived.bundle.assets[0].immutableUrl;
    conflicting.renderers[0].immutableUrl =
      archived.bundle.assets[0].immutableUrl;
    const signedConflict = await signRuntimeBundle(conflicting);
    await assert.rejects(
      installBattleMapV3RuntimeBundleRegistry({
        schemaVersion: 'battle-art-runtime-bundle-registry-v1',
        bundles: [archived.bundle, signedConflict]
      }),
      /URL\/hash conflict/
    );

    assert.equal(await installBattleMapV3RuntimeBundleRegistry({
      schemaVersion: 'battle-art-runtime-bundle-registry-v1',
      bundles: []
    }), false);
    assert.equal(
      assertBattleMapV3RuntimeManifestSupportsMap(current.map),
      true
    );
  });
});
