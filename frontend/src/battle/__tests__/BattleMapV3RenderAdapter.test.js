import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.window ??= { devicePixelRatio: 1, caches: {} };

const {
  createMinimalBattleMapV3CandidateFixture
} = await import('../../../../shared/battleMap/index.js');
const {
  BattleGrid,
  getBattleMapV3DrawGeometry
} = await import('../BattleGrid.js');
const {
  applyBattleMapV3RenderAdapter
} = await import('../BattleMapV3RenderAdapter.js');
const {
  clearBattleMapV3RuntimeManifest,
  getBattleMapV3RendererDescriptor,
  installBattleMapV3RuntimeBundleRegistry,
  setBattleMapV3RuntimeManifest
} = await import('../BattleMapAssets.js');
const {
  createRuntimeBundleForMap
} = await import('./battleMapV3RuntimeFixture.js');

function recordingContext() {
  const draws = [];
  return {
    draws,
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    save() {},
    restore() {},
    translate() {},
    scale() {},
    drawImage(image) { draws.push(image.id); }
  };
}

async function readTrackedJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

describe('BattleMapV3RenderAdapter', () => {
  it('uses logical retina geometry and deterministic transforms for four directions', () => {
    const renderer = {
      width: 256,
      height: 192,
      pivot: { x: 128, y: 128 },
      anchor: { x: 112, y: 120 },
      drawBounds: { x: 0, y: 16, width: 256, height: 176 },
      occlusionBounds: { x: 48, y: 32, width: 160, height: 96 },
      footprint: { x: 0, y: 0, width: 1, height: 2 }
    };
    const profile = {
      sourcePixelScale: 4,
      tileWidth: 64,
      tileHeight: 32,
      elevationStep: 16
    };
    const expectedScale = {
      s: { x: 1, y: 1 },
      e: { x: -1, y: 1 },
      w: { x: 1, y: -1 },
      n: { x: -1, y: -1 }
    };
    for (const direction of ['n', 'e', 's', 'w']) {
      const geometry = getBattleMapV3DrawGeometry({
        renderer,
        renderProfile: profile,
        screenX: 100,
        screenY: 80,
        direction
      });
      assert.deepEqual(geometry.scale, expectedScale[direction]);
      assert.deepEqual(geometry.image, {
        x: -32,
        y: -32,
        width: 64,
        height: 48
      });
      const transformedAnchor = {
        x: geometry.pivotOrigin.x +
          ((renderer.anchor.x - renderer.pivot.x) / 4) * geometry.scale.x,
        y: geometry.pivotOrigin.y +
          ((renderer.anchor.y - renderer.pivot.y) / 4) * geometry.scale.y
      };
      assert.deepEqual(transformedAnchor, { x: 100, y: 80 });
      assert.equal(geometry.drawBounds.width, 64);
      assert.equal(geometry.drawBounds.height, 44);
    }
  });

  it('uses only exact V3 images and renders one anchored obstacle visual', () => {
    const map = createMinimalBattleMapV3CandidateFixture();
    const obstacleAsset = {
      ...map.visualCells[0][0].surface,
      key: 'obstacle:fallen-tree',
      contentHash: `sha256:${'8'.repeat(64)}`,
      immutableUrl: '/assets/battle-map-v3/fixture-assets/v1/fallen-tree.webp'
    };
    map.obstacles.push({
      id: 'obstacle:fallen-tree',
      kind: 'fallen-tree',
      cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }],
      blocking: true,
      movementCost: 0,
      featureId: null,
      anchor: { x: 2, y: 0 },
      occlusionBounds: { x: 1, y: 0, width: 2, height: 1 },
      asset: obstacleAsset
    });
    setBattleMapV3RuntimeManifest(createRuntimeBundleForMap(map, {
      rendererOverrides: {
        [obstacleAsset.key]: {
          width: 192,
          height: 256,
          pivot: { x: 96, y: 224 },
          anchor: { x: 96, y: 224 },
          footprint: { x: 0, y: 0, width: 2, height: 1 },
          collision: {
            kind: 'solid',
            cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
          },
          drawBounds: { x: 0, y: 0, width: 192, height: 256 },
          occlusionBounds: { x: 16, y: 24, width: 160, height: 200 }
        }
      }
    }));

    const grid = new BattleGrid({ width: 320, height: 240 }, 8, 8);
    grid.generateTerrain = () => {
      assert.fail('V3 must never generate procedural terrain');
    };
    const exactImages = new Map([
      [map.visualCells[0][0].surface.key, {
        id: 'surface',
        width: 256,
        height: 128
      }],
      [obstacleAsset.key, {
        id: 'obstacle',
        width: 192,
        height: 256
      }]
    ]);
    grid.setAssetLoader({
      getBattleMapV3Asset: ref => exactImages.get(ref.key) ?? null,
      getBattleMapV2Asset: () => {
        assert.fail('V3 must not use V2 asset resolution');
      },
      getTile: () => assert.fail('V3 must not use legacy tile fallback'),
      getObstacle: () =>
        assert.fail('V3 must not use legacy obstacle fallback')
    });

    applyBattleMapV3RenderAdapter(grid, map);

    assert.equal(grid.getObstacle(1, 0), null);
    assert.equal(grid.getObstacle(2, 0).id, 'obstacle:fallen-tree');
    assert.equal(grid.createTraversalView().obstacles[0][1].blocking, true);
    assert.equal(grid.createTraversalView().obstacles[0][2].blocking, true);

    const ctx = recordingContext();
    grid.renderTileUnified(ctx, 32, 32, 2, 0);
    grid.renderObstacleAt(ctx, 32, 32, grid.getObstacle(2, 0));

    assert.deepEqual(ctx.draws, ['surface', 'obstacle']);
    clearBattleMapV3RuntimeManifest();
  });

  it('renders grassy slopes, discrete stairs, and anchored elevation faces', () => {
    const map = createMinimalBattleMapV3CandidateFixture();
    const sourceAsset = map.visualCells[0][0].surface;
    const stairsAsset = {
      ...sourceAsset,
      key: 'connection:root-stairs',
      contentHash: `sha256:${'7'.repeat(64)}`,
      immutableUrl: '/assets/battle-map-v3/fixture-assets/v1/root-stairs.webp'
    };
    const legacySlopeAsset = {
      ...sourceAsset,
      key: 'connection:legacy-slope',
      contentHash: `sha256:${'6'.repeat(64)}`,
      immutableUrl: '/assets/battle-map-v3/fixture-assets/v1/legacy-slope.webp'
    };
    const faceAsset = {
      ...sourceAsset,
      key: 'boundary:earth-face',
      contentHash: `sha256:${'8'.repeat(64)}`,
      immutableUrl: '/assets/battle-map-v3/fixture-assets/v1/earth-face.webp'
    };
    map.elevationConnections = [{
      id: 'connection:slope',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
      direction: 'e',
      kind: 'slope',
      heightDelta: -1,
      traversable: true,
      bidirectional: true,
      featureId: null,
      asset: legacySlopeAsset
    }, {
      id: 'connection:stairs',
      from: { x: 1, y: 1 },
      to: { x: 1, y: 2 },
      direction: 's',
      kind: 'stairs',
      heightDelta: -1,
      traversable: true,
      bidirectional: true,
      featureId: null,
      asset: stairsAsset
    }];
    map.boundaries = [{
      id: 'boundary:elevation-face:2:2',
      kind: 'elevation-face',
      edges: [{
        cell: { x: 2, y: 2 },
        direction: 'e'
      }],
      featureId: 'fixture:field',
      sceneOnly: true,
      asset: faceAsset
    }, {
      id: 'boundary:elevation-face:2:2:2',
      kind: 'elevation-face',
      edges: [{
        cell: { x: 2, y: 2 },
        direction: 'e'
      }],
      featureId: 'fixture:field',
      sceneOnly: true,
      asset: faceAsset,
      levelOffset: 2
    }];
    setBattleMapV3RuntimeManifest(createRuntimeBundleForMap(map, {
      rendererOverrides: {
        [stairsAsset.key]: {
          width: 256,
          height: 192,
          pivot: { x: 128, y: 128 },
          anchor: { x: 128, y: 128 },
          footprint: { x: 0, y: 0, width: 1, height: 2 },
          collision: {
            kind: 'connection',
            cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }]
          },
          drawBounds: { x: 0, y: 16, width: 256, height: 176 },
          occlusionBounds: { x: 48, y: 32, width: 160, height: 96 }
        },
        [faceAsset.key]: {
          width: 256,
          height: 256,
          pivot: { x: 128, y: 192 },
          anchor: { x: 128, y: 192 },
          footprint: { x: 0, y: 0, width: 1, height: 1 },
          collision: {
            kind: 'boundary',
            cells: [{ x: 0, y: 0 }]
          },
          drawBounds: { x: 0, y: 0, width: 256, height: 256 },
          occlusionBounds: { x: 32, y: 16, width: 192, height: 176 }
        }
      }
    }));

    const grid = new BattleGrid({ width: 320, height: 240 }, 8, 8);
    applyBattleMapV3RenderAdapter(grid, map);
    const layers = grid.battleMapV3RenderData.layers;
    assert.equal(
      layers.flat(2).filter(layer => layer.category === 'elevation-connection').length,
      1
    );
    assert.equal(layers[0][1][0].category, 'elevation-slope');
    assert.equal(layers[0][1][0].record.id, 'connection:slope');
    assert.equal(layers[0][1][0].asset.key, sourceAsset.key);
    assert.equal(layers[0][1][0].direction, 'w');
    assert.equal(layers[2][1][0].record.id, 'connection:stairs');
    assert.equal(layers[2][1][0].direction, 'n');
    const faceLayers = layers[2][2].filter(
      layer => layer.category === 'boundary'
    );
    assert.equal(faceLayers.length, 2);
    assert.ok(faceLayers.every(layer => layer.direction === 'e'));
    assert.ok(faceLayers.every(layer => layer.mirrorDirection === undefined));

    const firstFaceGeometry = grid.getBattleMapV3AssetGeometry(
      layers[2][2][0],
      100,
      80
    );
    assert.deepEqual(firstFaceGeometry.pivotOrigin, {
      x: 116,
      y: 104
    });
    const secondFaceGeometry = grid.getBattleMapV3AssetGeometry(
      layers[2][2][1],
      100,
      80
    );
    assert.deepEqual(secondFaceGeometry.pivotOrigin, {
      x: 116,
      y: 120
    });
    clearBattleMapV3RuntimeManifest();
  });

  it('anchors concrete slope and stair art unflipped in all four directions', () => {
    const map = createMinimalBattleMapV3CandidateFixture();
    const sourceAsset = map.visualCells[0][0].surface;
    const specs = [
      ['slope', 'n', { x: 1, y: 1 }, { x: 1, y: 0 }],
      ['slope', 'e', { x: 2, y: 1 }, { x: 3, y: 1 }],
      ['slope', 's', { x: 4, y: 1 }, { x: 4, y: 2 }],
      ['slope', 'w', { x: 6, y: 1 }, { x: 5, y: 1 }],
      ['stairs', 'n', { x: 1, y: 4 }, { x: 1, y: 3 }],
      ['stairs', 'e', { x: 2, y: 4 }, { x: 3, y: 4 }],
      ['stairs', 's', { x: 4, y: 4 }, { x: 4, y: 5 }],
      ['stairs', 'w', { x: 6, y: 4 }, { x: 5, y: 4 }]
    ];
    const rendererOverrides = {};
    map.elevationConnections = specs.map(
      ([kind, direction, from, to], index) => {
        const asset = {
          ...sourceAsset,
          key: `connection:${kind}:${direction}`,
          contentHash: `sha256:${String(index + 1).repeat(64)}`,
          immutableUrl: `/v3/connection-${kind}-${direction}.webp`
        };
        const horizontal = direction === 'e' || direction === 'w';
        rendererOverrides[asset.key] = {
          category: kind === 'slope'
            ? 'connection-slope'
            : 'connection-stairs',
          stratum: 'connection',
          width: 256,
          height: 192,
          pivot: { x: 128, y: 128 },
          anchor: { x: 128, y: 128 },
          footprint: {
            x: 0,
            y: 0,
            width: horizontal ? 2 : 1,
            height: horizontal ? 1 : 2
          },
          collision: {
            kind: 'connection',
            cells: horizontal
              ? [{ x: 0, y: 0 }, { x: 1, y: 0 }]
              : [{ x: 0, y: 0 }, { x: 0, y: 1 }]
          },
          drawBounds: { x: 0, y: 0, width: 256, height: 192 },
          occlusionBounds: { x: 0, y: 0, width: 1, height: 1 },
          variant: { direction, heightDelta: 1 }
        };
        return {
          id: `connection:${kind}:${direction}`,
          from,
          to,
          direction,
          kind,
          heightDelta: 1,
          traversable: true,
          bidirectional: true,
          featureId: null,
          asset
        };
      }
    );
    setBattleMapV3RuntimeManifest(createRuntimeBundleForMap(map, {
      rendererOverrides
    }));
    const grid = new BattleGrid({ width: 320, height: 240 }, 8, 8);
    applyBattleMapV3RenderAdapter(grid, map);

    const layers = grid.battleMapV3RenderData.layers.flat(2)
      .filter(layer =>
        layer.category === 'elevation-slope' ||
        layer.category === 'elevation-connection'
      );
    assert.equal(layers.length, 8);
    for (const layer of layers) {
      assert.equal(layer.authoredDirectional, true);
      assert.equal(layer.direction, layer.renderer.variant.direction);
      assert.equal(layer.record.heightDelta, layer.renderer.variant.heightDelta);
      assert.deepEqual(
        grid.getBattleMapV3AssetGeometry(layer, 100, 80).scale,
        { x: 1, y: 1 },
        `${layer.record.id} must not be sign-flipped`
      );
      const geometry = grid.getBattleMapV3AssetGeometry(layer, 100, 80);
      assert.deepEqual(
        {
          x: geometry.pivotOrigin.x +
            (layer.renderer.anchor.x - layer.renderer.pivot.x) / 4,
          y: geometry.pivotOrigin.y +
            (layer.renderer.anchor.y - layer.renderer.pivot.y) / 4
        },
        { x: 100, y: 80 },
        `${layer.record.id} is anchored on its canonical low endpoint`
      );
      const bridge = grid.getBattleMapV3ConnectionBridge(layer, 100, 80);
      assert.notDeepEqual(
        bridge.lowMidpoint,
        bridge.highMidpoint,
        `${layer.record.id} spans the canonical low-to-high bridge`
      );
    }
    clearBattleMapV3RuntimeManifest();
  });

  it('fails closed when concrete connection direction or height metadata drifts', () => {
    const map = createMinimalBattleMapV3CandidateFixture();
    const sourceAsset = map.visualCells[0][0].surface;
    const slopeAsset = {
      ...sourceAsset,
      key: 'connection:slope:e',
      contentHash: `sha256:${'4'.repeat(64)}`,
      immutableUrl: '/v3/connection-slope-e.webp'
    };
    map.elevationConnections = [{
      id: 'connection:slope:e',
      from: { x: 1, y: 1 },
      to: { x: 2, y: 1 },
      direction: 'e',
      kind: 'slope',
      heightDelta: 1,
      traversable: true,
      bidirectional: true,
      featureId: null,
      asset: slopeAsset
    }];
    const renderer = {
      category: 'connection-slope',
      stratum: 'connection',
      width: 256,
      height: 192,
      pivot: { x: 128, y: 128 },
      anchor: { x: 128, y: 128 },
      footprint: { x: 0, y: 0, width: 2, height: 1 },
      collision: {
        kind: 'connection',
        cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
      },
      drawBounds: { x: 0, y: 0, width: 256, height: 192 },
      occlusionBounds: { x: 0, y: 0, width: 1, height: 1 }
    };
    for (const variant of [
      { direction: 'w', heightDelta: 1 },
      { direction: 'e', heightDelta: 2 },
      { direction: 'e' },
      undefined
    ]) {
      setBattleMapV3RuntimeManifest(createRuntimeBundleForMap(map, {
        rendererOverrides: {
          [slopeAsset.key]: { ...renderer, variant }
        }
      }));
      const grid = new BattleGrid({ width: 320, height: 240 }, 8, 8);
      assert.throws(
        () => applyBattleMapV3RenderAdapter(grid, map),
        /direction|heightDelta|height delta|variant metadata/
      );
      clearBattleMapV3RuntimeManifest();
    }
  });

  it('keeps concrete boundary art on its authored edge and rejects direction drift', () => {
    const map = createMinimalBattleMapV3CandidateFixture();
    const sourceAsset = map.visualCells[0][0].surface;
    const boundaryAsset = {
      ...sourceAsset,
      key: 'boundary:forest-canopy:w',
      contentHash: `sha256:${'5'.repeat(64)}`,
      immutableUrl: '/v3/boundary-forest-canopy-w.webp'
    };
    map.scene = {
      silhouette: 'organic-island',
      exterior: 'forest-canopy',
      backdrop: {
        kind: 'sky-gradient',
        topColor: '#6688AA',
        horizonColor: '#AACCDE',
        bottomColor: '#DDEEFF',
        hazeColor: '#EEF8FF'
      }
    };
    map.boundaries = [{
      id: 'boundary:forest-canopy:w',
      kind: 'biome-edge',
      edges: [{ cell: { x: 0, y: 0 }, direction: 'w' }],
      featureId: 'fixture:field',
      sceneOnly: true,
      asset: boundaryAsset
    }];
    const override = direction => ({
      category: 'exposed-face-boundary',
      stratum: 'boundary',
      width: 192,
      height: 256,
      pivot: { x: 96, y: 224 },
      anchor: { x: 96, y: 224 },
      footprint: { x: 0, y: 0, width: 1, height: 1 },
      collision: { kind: 'boundary', cells: [{ x: 0, y: 0 }] },
      drawBounds: { x: 0, y: 0, width: 192, height: 256 },
      occlusionBounds: { x: 16, y: 24, width: 160, height: 200 },
      variant: { direction, ecologyProfile: 'heartlands-deciduous', tier: 1 }
    });
    setBattleMapV3RuntimeManifest(createRuntimeBundleForMap(map, {
      rendererOverrides: { [boundaryAsset.key]: override('w') }
    }));
    const grid = new BattleGrid({ width: 320, height: 240 }, 8, 8);
    applyBattleMapV3RenderAdapter(grid, map);
    const layer = grid.battleMapV3RenderData.layers[0][0]
      .find(candidate => candidate.category === 'boundary');
    assert.equal(layer.direction, 'w');
    assert.equal(layer.authoredDirectional, true);
    assert.equal(layer.exteriorStratum, 'rear-canopy');
    assert.deepEqual(
      grid.getBattleMapV3AssetGeometry(layer, 0, 0).scale,
      { x: 1, y: 1 }
    );

    for (const invalidOverride of [
      override('e'),
      {
        ...override('w'),
        variant: {
          ecologyProfile: 'heartlands-deciduous',
          tier: 1
        }
      }
    ]) {
      setBattleMapV3RuntimeManifest(createRuntimeBundleForMap(map, {
        rendererOverrides: { [boundaryAsset.key]: invalidOverride }
      }));
      assert.throws(
        () => applyBattleMapV3RenderAdapter(
          new BattleGrid({ width: 320, height: 240 }, 8, 8),
          map
        ),
        /renderer direction e does not match w|requires concrete direction metadata/
      );
    }
    clearBattleMapV3RuntimeManifest();
  });

  it('binds exact route variants to canonical topology roles', () => {
    const map = createMinimalBattleMapV3CandidateFixture();
    const sourceAsset = map.visualCells[0][0].surface;
    const makeAsset = (role, digit) => ({
      ...sourceAsset,
      key: `route:${role}`,
      contentHash: `sha256:${digit.repeat(64)}`,
      immutableUrl: `/v3/route-${role}.webp`
    });
    const assets = {
      'end-e': makeAsset('end-e', '1'),
      'straight-ew': makeAsset('straight-ew', '2'),
      'end-w': makeAsset('end-w', '3')
    };
    map.routes = [{
      id: 'route:test',
      kind: 'path',
      width: 2,
      cells: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
      visualAssets: [
        { asset: assets['end-e'], cells: [{ x: 1, y: 1 }] },
        { asset: assets['straight-ew'], cells: [{ x: 2, y: 1 }] },
        { asset: assets['end-w'], cells: [{ x: 3, y: 1 }] }
      ]
    }];
    const rendererOverrides = Object.fromEntries(
      Object.entries(assets).map(([role, asset]) => [asset.key, {
        category: 'route-transition',
        stratum: 'route',
        width: 256,
        height: 128,
        pivot: { x: 128, y: 64 },
        anchor: { x: 128, y: 64 },
        footprint: { x: 0, y: 0, width: 1, height: 1 },
        collision: { kind: 'none', cells: [] },
        drawBounds: { x: 0, y: 0, width: 256, height: 128 },
        occlusionBounds: { x: 0, y: 0, width: 0, height: 0 },
        variant: { routeTopology: role, ecologyProfile: 'heartlands-deciduous' }
      }])
    );
    setBattleMapV3RuntimeManifest(createRuntimeBundleForMap(map, {
      rendererOverrides
    }));
    const grid = new BattleGrid({ width: 320, height: 240 }, 8, 8);
    applyBattleMapV3RenderAdapter(grid, map);
    assert.deepEqual(
      [1, 2, 3].map(x => {
        const layer = grid.battleMapV3RenderData.layers[1][x]
          .find(candidate => candidate.category === 'route');
        return {
          role: layer.routeTopology.role,
          authored: layer.authoredTopology,
          variant: layer.renderer.variant.routeTopology
        };
      }),
      [
        { role: 'end-e', authored: true, variant: 'end-e' },
        { role: 'straight-ew', authored: true, variant: 'straight-ew' },
        { role: 'end-w', authored: true, variant: 'end-w' }
      ]
    );

    setBattleMapV3RuntimeManifest(createRuntimeBundleForMap(map, {
      rendererOverrides: {
        ...rendererOverrides,
        [assets['end-e'].key]: {
          ...rendererOverrides[assets['end-e'].key],
          variant: { routeTopology: 'end-w' }
        }
      }
    }));
    assert.throws(
      () => applyBattleMapV3RenderAdapter(
        new BattleGrid({ width: 320, height: 240 }, 8, 8),
        map
      ),
      /renderer topology does not match end-e/
    );
    clearBattleMapV3RuntimeManifest();
  });

  it('emits every authored slope and stair from active forest map A', async () => {
    const [map, runtimeBundles] = await Promise.all([
      readTrackedJson(
        '../../../../battle-maps/compiled/forest/forest-template-01-a.v6.json'
      ),
      readTrackedJson('../../generated/battleMapV3RuntimeBundles.json')
    ]);
    await installBattleMapV3RuntimeBundleRegistry(runtimeBundles);

    const authoredStairs = map.elevationConnections.filter(
      connection => connection.kind === 'stairs'
    );
    const authoredSlopes = map.elevationConnections.filter(
      connection => connection.kind === 'slope'
    );
    assert.equal(authoredStairs.length, 4);

    const grid = new BattleGrid(
      { width: 320, height: 240 },
      map.dimensions.width,
      map.dimensions.height
    );
    applyBattleMapV3RenderAdapter(grid, map);

    const connectionLayers = grid.battleMapV3RenderData.layers
      .flat(2)
      .filter(layer => layer.category === 'elevation-connection');
    assert.equal(connectionLayers.length, authoredStairs.length);
    assert.equal(
      connectionLayers.filter(layer => layer.record.kind === 'stairs').length,
      4
    );
    assert.equal(
      connectionLayers.filter(layer => layer.record.kind === 'slope').length,
      0
    );
    const slopeLayers = grid.battleMapV3RenderData.layers
      .flat(2)
      .filter(layer => layer.category === 'elevation-slope');
    assert.equal(slopeLayers.length, authoredSlopes.length);
    assert.ok(slopeLayers.every(layer => layer.record.kind === 'slope'));
    const routeEndpoint = grid.battleMapV3RenderData.layers[27][10]
      .find(layer => layer.category === 'route');
    assert.deepEqual(routeEndpoint.routeTopology.neighbors, ['n']);
    assert.equal(routeEndpoint.routeTopology.role, 'end-n');
    assert.equal(routeEndpoint.routeTopology.width, 2);
    assert.equal(Number.isSafeInteger(routeEndpoint.routeTopology.visualSeed), true);
    assert.equal(Number.isSafeInteger(routeEndpoint.routeTopology.textureSeed), true);
    const routeNeighbor = grid.battleMapV3RenderData.layers[26][10]
      .find(layer => layer.category === 'route');
    assert.equal(
      routeNeighbor.routeTopology.textureSeed,
      routeEndpoint.routeTopology.textureSeed,
      'one route keeps a stable texture orientation across its cells'
    );
    clearBattleMapV3RuntimeManifest();
  });

  it('derives stable rear-edge undergrowth only from map-pinned decoration assets', async () => {
    const [map, runtimeBundles] = await Promise.all([
      readTrackedJson(
        '../../../../battle-maps/compiled/forest/forest-template-01-b.v9.json'
      ),
      readTrackedJson('../../generated/battleMapV3RuntimeBundles.json')
    ]);
    await installBattleMapV3RuntimeBundleRegistry(runtimeBundles);

    const apply = () => {
      const grid = new BattleGrid(
        { width: 320, height: 240 },
        map.dimensions.width,
        map.dimensions.height
      );
      applyBattleMapV3RenderAdapter(grid, map);
      return grid.battleMapV3RenderData.layers
        .flat(2)
        .filter(layer => layer.record.kind === 'boundary-undergrowth')
        .map(layer => ({
          id: layer.record.id,
          cell: layer.record.cell,
          assetKey: layer.asset.key,
          mirrorDirection: layer.mirrorDirection,
          stratum: layer.renderer.stratum
        }));
    };

    const first = apply();
    const second = apply();
    assert.ok(first.length > 0);
    assert.deepEqual(second, first);
    const pinnedDecorationKeys = new Set(
      map.decorations.map(decoration => decoration.asset.key)
    );
    const routeCells = new Set(
      map.routes.flatMap(route => route.cells.map(cell => `${cell.x},${cell.y}`))
    );
    const obstacleCells = new Set(
      map.obstacles.flatMap(obstacle =>
        obstacle.cells.map(cell => `${cell.x},${cell.y}`)
      )
    );
    assert.ok(first.every(layer => pinnedDecorationKeys.has(layer.assetKey)));
    assert.ok(first.every(layer => layer.stratum === 'decoration'));
    assert.ok(first.every(layer => {
      const key = `${layer.cell.x},${layer.cell.y}`;
      return !routeCells.has(key) && !obstacleCells.has(key);
    }));

    const boundaryGrid = new BattleGrid(
      { width: 320, height: 240 },
      map.dimensions.width,
      map.dimensions.height
    );
    applyBattleMapV3RenderAdapter(boundaryGrid, map);
    const boundaryLayers = boundaryGrid.battleMapV3RenderData.layers
      .flat(2)
      .filter(layer => layer.category === 'boundary');
    const authoredEdgeCount = map.boundaries.reduce(
      (count, boundary) => count + boundary.edges.length,
      0
    );
    const expectedScale = {
      n: { x: -1, y: -1 },
      e: { x: -1, y: 1 },
      s: { x: 1, y: 1 },
      w: { x: 1, y: -1 }
    };
    assert.equal(boundaryLayers.length, authoredEdgeCount);
    for (const layer of boundaryLayers) {
      assert.equal(layer.direction, layer.record.edge.direction);
      assert.equal(layer.mirrorDirection, undefined);
      assert.deepEqual(
        boundaryGrid.getBattleMapV3AssetGeometry(layer, 0, 0).scale,
        expectedScale[layer.record.edge.direction]
      );
    }
    clearBattleMapV3RuntimeManifest();
  });

  it('composes regional perimeter accents only for organic forest scenes', () => {
    const map = createMinimalBattleMapV3CandidateFixture();
    map.theme = 'forest';
    map.contentId = 'regional-forest-perimeter';
    const sourceAsset = map.visualCells[0][0].surface;
    const regionalAsset = {
      ...sourceAsset,
      key: 'heartlands-understory',
      contentHash: `sha256:${'a'.repeat(64)}`,
      immutableUrl: '/v3/heartlands-understory.webp'
    };
    const genericAsset = {
      ...sourceAsset,
      key: 'generic-forest-accent',
      contentHash: `sha256:${'b'.repeat(64)}`,
      immutableUrl: '/v3/generic-forest-accent.webp'
    };
    const boundaryAsset = {
      ...sourceAsset,
      key: 'heartlands-canopy-edge-n',
      contentHash: `sha256:${'c'.repeat(64)}`,
      immutableUrl: '/v3/heartlands-canopy-edge-n.webp'
    };
    map.decorations = [{
      id: 'decoration:heartlands-understory',
      kind: 'biome-accent',
      cell: { x: 2, y: 2 },
      featureId: null,
      anchor: 'tile',
      asset: regionalAsset
    }, {
      id: 'decoration:generic-forest-accent',
      kind: 'biome-accent',
      cell: { x: 3, y: 2 },
      featureId: null,
      anchor: 'tile',
      asset: genericAsset
    }];
    map.boundaries = [{
      id: 'boundary:heartlands-canopy',
      kind: 'biome-edge',
      edges: Array.from({ length: 8 }, (_, x) => ({
        cell: { x, y: 0 },
        direction: 'n'
      })),
      featureId: null,
      sceneOnly: true,
      asset: boundaryAsset
    }];
    const decorationRenderer = ecologyProfile => ({
      category: 'nonblocking-decoration',
      stratum: 'decoration',
      width: 192,
      height: 256,
      pivot: { x: 96, y: 224 },
      anchor: { x: 96, y: 224 },
      footprint: { x: 0, y: 0, width: 1, height: 1 },
      collision: { kind: 'none', cells: [] },
      drawBounds: { x: 0, y: 0, width: 192, height: 256 },
      occlusionBounds: { x: 16, y: 24, width: 160, height: 200 },
      variant: { ecologyProfile, tier: 1 }
    });
    setBattleMapV3RuntimeManifest(createRuntimeBundleForMap(map, {
      rendererOverrides: {
        [regionalAsset.key]:
          decorationRenderer('heartlands-deciduous'),
        [genericAsset.key]:
          decorationRenderer('generic-temperate'),
        [boundaryAsset.key]: {
          category: 'exposed-face-boundary',
          stratum: 'boundary',
          width: 192,
          height: 256,
          pivot: { x: 96, y: 224 },
          anchor: { x: 96, y: 224 },
          footprint: { x: 0, y: 0, width: 1, height: 1 },
          collision: { kind: 'boundary', cells: [{ x: 0, y: 0 }] },
          drawBounds: { x: 0, y: 0, width: 192, height: 256 },
          occlusionBounds: { x: 16, y: 24, width: 160, height: 200 },
          variant: {
            direction: 'n',
            ecologyProfile: 'heartlands-deciduous',
            tier: 1
          }
        }
      }
    }));
    const scene = {
      silhouette: 'organic-island',
      exterior: 'forest-canopy',
      backdrop: {
        kind: 'sky-gradient',
        topColor: '#6688AA',
        horizonColor: '#AACCDE',
        bottomColor: '#DDEEFF',
        hazeColor: '#EEF8FF'
      }
    };
    const compose = ({ theme = 'forest', selectedScene = scene } = {}) => {
      const selectedMap = structuredClone(map);
      selectedMap.theme = theme;
      selectedMap.scene = selectedScene;
      const grid = new BattleGrid({ width: 320, height: 240 }, 8, 8);
      applyBattleMapV3RenderAdapter(grid, selectedMap);
      return grid.battleMapV3RenderData.layers.flat(2)
        .filter(layer => layer.record.kind === 'boundary-undergrowth')
        .map(layer => layer.asset.key);
    };

    const organic = compose();
    assert.ok(organic.length > 0);
    assert.ok(organic.every(key => key === regionalAsset.key));
    assert.deepEqual(compose(), organic, 'regional composition is deterministic');
    assert.deepEqual(compose({
      selectedScene: {
        ...scene,
        silhouette: 'rectangular-platform',
        exterior: 'architectural-skirt'
      }
    }), []);
    assert.deepEqual(compose({
      theme: 'cave',
      selectedScene: {
        ...scene,
        exterior: 'cave-rock'
      }
    }), []);
    clearBattleMapV3RuntimeManifest();
  });

  it('adds deterministic ecology-matched scene-only forest depth without collision', async () => {
    const [map, runtimeBundles] = await Promise.all([
      readTrackedJson(
        '../../../../battle-maps/compiled/forest/forest-template-01-b.v10.json'
      ),
      readTrackedJson('../../generated/battleMapV3RuntimeBundles.json')
    ]);
    await installBattleMapV3RuntimeBundleRegistry(runtimeBundles);

    const compose = (selectedMap = map) => {
      const grid = new BattleGrid(
        { width: 320, height: 240 },
        selectedMap.dimensions.width,
        selectedMap.dimensions.height
      );
      applyBattleMapV3RenderAdapter(grid, selectedMap);
      return {
        grid,
        trees: grid.battleMapV3RenderData.obstacleLayers
          .filter(layer => layer.sceneOnly),
        accents: grid.battleMapV3RenderData.layers
          .flat(2)
          .filter(layer => layer.record.kind === 'scene-floor-accent')
      };
    };
    const first = compose();
    const second = compose();
    const serialize = composition => ({
      trees: composition.trees.map(layer => ({
        id: layer.record.id,
        cell: layer.cell,
        asset: layer.asset.key,
        mirrorDirection: layer.mirrorDirection
      })),
      accents: composition.accents.map(layer => ({
        id: layer.record.id,
        cell: layer.record.cell,
        asset: layer.asset.key,
        mirrorDirection: layer.mirrorDirection
      }))
    });
    assert.deepEqual(serialize(second), serialize(first));
    assert.ok(first.trees.length > 0);
    assert.ok(first.accents.length > 0);

    const routeCells = new Set(
      map.routes.flatMap(route =>
        route.visualAssets.flatMap(visual => visual.cells.map(
          cell => `${cell.x},${cell.y}`
        ))
      )
    );
    const authoredPropCells = new Set([
      ...map.obstacles.flatMap(obstacle =>
        obstacle.cells.map(cell => `${cell.x},${cell.y}`)
      ),
      ...map.decorations.map(decoration =>
        `${decoration.cell.x},${decoration.cell.y}`
      )
    ]);
    const boundaryCells = new Set(
      map.boundaries.flatMap(boundary =>
        boundary.edges.map(edge => `${edge.cell.x},${edge.cell.y}`)
      )
    );
    const authoredTreeAssets = new Set(
      map.obstacles
        .filter(obstacle =>
          /(?:tree|pine|birch)/i.test(`${obstacle.kind}:${obstacle.asset.key}`)
        )
        .map(obstacle => obstacle.asset.key)
    );
    const authoredAccentAssets = new Set(
      map.decorations.map(decoration => decoration.asset.key)
    );
    const ecologyProfiles = new Set(
      map.boundaries
        .filter(boundary => boundary.kind === 'biome-edge')
        .map(boundary => getBattleMapV3RendererDescriptor(
          boundary.asset
        ).variant.ecologyProfile)
    );
    assert.equal(ecologyProfiles.size, 1);
    const [sceneEcology] = ecologyProfiles;

    for (const layer of first.trees) {
      const key = `${layer.cell.x},${layer.cell.y}`;
      assert.equal(map.renderMask[layer.cell.y][layer.cell.x], true);
      assert.equal(map.playableMask[layer.cell.y][layer.cell.x], false);
      assert.equal(routeCells.has(key), false);
      assert.equal(authoredPropCells.has(key), false);
      assert.equal(authoredTreeAssets.has(layer.asset.key), true);
      assert.equal(layer.record.sceneOnly, true);
      assert.equal(layer.record.blocking, false);
      assert.equal(
        getBattleMapV3RendererDescriptor(layer.asset).variant.ecologyProfile,
        sceneEcology
      );
      assert.equal(
        first.grid.getObstacle(layer.cell.x, layer.cell.y),
        null,
        'scene-only trees never enter traversal obstacle state'
      );
    }
    for (const layer of first.accents) {
      const { x, y } = layer.record.cell;
      const key = `${x},${y}`;
      assert.equal(map.renderMask[y][x], true);
      assert.equal(map.playableMask[y][x], true);
      assert.equal(routeCells.has(key), false);
      assert.equal(authoredPropCells.has(key), false);
      assert.equal(boundaryCells.has(key), false);
      assert.equal(authoredAccentAssets.has(layer.asset.key), true);
      assert.equal(layer.sceneOnly, true);
      assert.equal(layer.record.sceneOnly, true);
      assert.equal(
        getBattleMapV3RendererDescriptor(layer.asset).variant.ecologyProfile,
        sceneEcology
      );
    }
    const rectangularMap = structuredClone(map);
    rectangularMap.scene.silhouette = 'rectangular-platform';
    rectangularMap.scene.exterior = 'architectural-skirt';
    const rectangular = compose(rectangularMap);
    assert.deepEqual(rectangular.trees, []);
    assert.deepEqual(rectangular.accents, []);

    const caveMap = structuredClone(map);
    caveMap.theme = 'cave';
    caveMap.scene.exterior = 'cave-rock';
    const cave = compose(caveMap);
    assert.deepEqual(cave.trees, []);
    assert.deepEqual(cave.accents, []);
    clearBattleMapV3RuntimeManifest();
  });

  it('pins a deterministic map-owned regional surface foundation for organic forests', async () => {
    const [map, fallenOakMap, runtimeBundles] = await Promise.all([
      readTrackedJson(
        '../../../../battle-maps/compiled/forest/forest-template-01-b.v11.json'
      ),
      readTrackedJson(
        '../../../../battle-maps/compiled/forest/forest-template-07-a.v6.json'
      ),
      readTrackedJson('../../generated/battleMapV3RuntimeBundles.json')
    ]);
    await installBattleMapV3RuntimeBundleRegistry(runtimeBundles);

    const apply = selectedMap => {
      const grid = new BattleGrid(
        { width: 320, height: 240 },
        selectedMap.dimensions.width,
        selectedMap.dimensions.height
      );
      applyBattleMapV3RenderAdapter(grid, selectedMap);
      return grid;
    };
    const first = apply(map);
    const second = apply(map);
    const foundation = first.battleMapV3RenderData.surfaceFoundation;
    assert.equal(
      first.battleMapV3RenderData.renderProfileId,
      map.renderProfileId
    );
    assert.ok(foundation);
    assert.equal(foundation.renderer.variant.surfaceVariant, 0);
    assert.equal(
      foundation.renderer.variant.ecologyProfile,
      'forest-iron-depths-borderwood'
    );
    assert.equal(
      map.visualCells.flat().some(
        visualCell => visualCell?.surface?.key === foundation.asset.key
      ),
      true,
      'the foundation is an exact asset in this immutable map closure'
    );
    assert.equal(
      second.battleMapV3RenderData.surfaceFoundation.asset.key,
      foundation.asset.key
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(first.createTraversalView())),
      JSON.parse(JSON.stringify(second.createTraversalView()))
    );

    const rectangular = structuredClone(map);
    rectangular.scene.silhouette = 'rectangular-platform';
    rectangular.scene.exterior = 'architectural-skirt';
    assert.equal(
      apply(rectangular).battleMapV3RenderData.surfaceFoundation,
      null
    );

    const cave = structuredClone(map);
    cave.theme = 'cave';
    cave.scene.exterior = 'cave-rock';
    assert.equal(apply(cave).battleMapV3RenderData.surfaceFoundation, null);

    assert.equal(
      fallenOakMap.visualCells.flat().some(
        visualCell =>
          visualCell?.surface?.key ===
          'forest-heartlands-clover-glade-ground'
      ),
      true,
      'the fallen-oak map contains the shared clover semantic surface'
    );
    const fallenOak = apply(fallenOakMap);
    assert.equal(
      fallenOak.battleMapV3RenderData.renderProfileId,
      'forest-heartlands-fallen-oak-v1'
    );
    assert.equal(
      fallenOak.battleMapV3RenderData.surfaceFoundation,
      null,
      'the fallen-oak profile renders semantic surfaces without a shared foundation'
    );
    clearBattleMapV3RuntimeManifest();
  });

  it('fails rendering when decoded dimensions do not match the descriptor', () => {
    const map = createMinimalBattleMapV3CandidateFixture();
    setBattleMapV3RuntimeManifest(createRuntimeBundleForMap(map));
    const grid = new BattleGrid({ width: 320, height: 240 }, 8, 8);
    grid.setAssetLoader({
      getBattleMapV3Asset: () => ({ id: 'bad', width: 64, height: 64 })
    });
    applyBattleMapV3RenderAdapter(grid, map);
    assert.throws(
      () => grid.renderBattleMapV3Tile(recordingContext(), 0, 0, 0, 0),
      /decoded dimensions mismatch/
    );
    clearBattleMapV3RuntimeManifest();
  });

  it('derives camera bounds and center from the rendered silhouette', () => {
    const map = createMinimalBattleMapV3CandidateFixture();
    map.renderMask = map.renderMask.map(row => row.map(() => false));
    map.playableMask = map.playableMask.map(row => row.map(() => false));
    map.renderMask[2][3] = true;
    map.playableMask[2][3] = true;
    setBattleMapV3RuntimeManifest(createRuntimeBundleForMap(map));
    const grid = new BattleGrid({ width: 320, height: 240 }, 8, 8);
    grid.setAssetLoader({
      getBattleMapV3Asset: () => ({ id: 'surface', width: 256, height: 128 })
    });
    applyBattleMapV3RenderAdapter(grid, map);

    const world = grid.gridToScreenWorld(3, 2);
    assert.deepEqual(grid.getMapPixelDimensions(), {
      width: 64,
      height: 32,
      worldMinX: world.x - 32,
      worldMinY: world.y - 16,
      worldMaxX: world.x + 32,
      worldMaxY: world.y + 16,
      offsetX: -(world.x - 32),
      offsetY: -(world.y - 16)
    });
    assert.deepEqual(grid.getMapCenter(), world);
    assert.deepEqual(grid.getRenderedWorldCells(), [{
      x: 3,
      y: 2,
      worldX: world.x,
      worldY: world.y
    }]);
    clearBattleMapV3RuntimeManifest();
  });
});
