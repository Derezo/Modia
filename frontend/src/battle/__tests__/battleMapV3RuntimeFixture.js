import {
  computeTemplateMapAssetBundleManifestFullHash,
  hashCanonicalV3Value
} from '../../../../shared/battleMap/index.js';
import { collectBattleMapV3AssetManifest } from '../BattleMapAssets.js';

const BATTLE_ART_RENDERER_MANIFEST_HASH_DOMAIN =
  'modia:battle-art:renderer-manifest:v1';

export const TEST_RENDER_PROFILE = Object.freeze({
  id: 'iso64-retina-v3',
  sourcePixelScale: 4,
  tileWidth: 64,
  tileHeight: 32,
  elevationStep: 16
});

const CATEGORY = Object.freeze({
  surface: ['surface', 'surface'],
  overlay: ['route-transition', 'route'],
  route: ['route-transition', 'route'],
  slope: ['connection-slope', 'connection'],
  connection: ['connection-stairs', 'connection'],
  boundary: ['exposed-face-boundary', 'boundary'],
  obstacle: ['blocking-obstacle', 'obstacle'],
  decoration: ['nonblocking-decoration', 'decoration']
});

function rendererKind(key) {
  const prefix = key.split(':')[0];
  return CATEGORY[prefix] ?? CATEGORY.surface;
}

export function createRuntimeBundleForMap(map, {
  rendererOverrides = {}
} = {}) {
  const assets = collectBattleMapV3AssetManifest(map).map(({
    assetBundleId: _assetBundleId,
    ...asset
  }) => asset);
  const renderers = assets.map(asset => {
    const [category, stratum] = rendererKind(asset.key);
    const isSurface = stratum === 'surface' || stratum === 'route';
    const width = isSurface ? 256 : 192;
    const height = isSurface ? 128 : 256;
    const pivot = isSurface ? { x: width / 2, y: height / 2 } : {
      x: width / 2,
      y: height - 32
    };
    return {
      id: asset.key,
      theme: 'forest',
      category,
      contentVersion: asset.contentVersion,
      sha256: asset.contentHash,
      immutableUrl: asset.immutableUrl,
      width,
      height,
      pivot,
      anchor: { ...pivot },
      footprint: { x: 0, y: 0, width: 1, height: 1 },
      collision: {
        kind: category === 'blocking-obstacle'
          ? 'solid'
          : ['connection-slope', 'connection-stairs'].includes(category)
            ? 'connection'
            : category === 'exposed-face-boundary'
              ? 'boundary'
              : 'none',
        cells: [
          'blocking-obstacle',
          'connection-slope',
          'connection-stairs',
          'exposed-face-boundary'
        ]
          .includes(category)
          ? [{ x: 0, y: 0 }]
          : []
      },
      drawBounds: { x: 0, y: 0, width, height },
      occlusionBounds: {
        x: 0,
        y: isSurface ? 0 : 32,
        width,
        height: isSurface ? height : height - 32
      },
      stratum,
      ...rendererOverrides[asset.key]
    };
  });
  return {
    schemaVersion: 'battle-art-runtime-bundle-v1',
    id: map.provenance.assetBundle.id,
    version: map.provenance.assetBundle.version,
    manifestFullHash: map.provenance.assetBundle.manifestFullHash,
    rendererManifestFullHash: `sha256:${'9'.repeat(64)}`,
    renderProfile: { ...TEST_RENDER_PROFILE },
    assets,
    renderers
  };
}

export async function createSignedEmptyRuntimeBundle({
  id = 'empty-draft',
  version = 1
} = {}) {
  const bundle = {
    schemaVersion: 'battle-art-runtime-bundle-v1',
    id,
    version,
    manifestFullHash: null,
    rendererManifestFullHash: null,
    renderProfile: { ...TEST_RENDER_PROFILE },
    assets: [],
    renderers: []
  };
  bundle.rendererManifestFullHash = await hashCanonicalV3Value(
    BATTLE_ART_RENDERER_MANIFEST_HASH_DOMAIN,
    {
      id,
      version,
      renderProfile: bundle.renderProfile,
      renderers: bundle.renderers
    }
  );
  bundle.manifestFullHash =
    await computeTemplateMapAssetBundleManifestFullHash(bundle);
  return bundle;
}
