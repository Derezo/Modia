import {
  assertBattleMapV3RuntimeManifestSupportsMap,
  getBattleMapV3RendererDescriptor,
  getBattleMapV3RenderProfile
} from './BattleMapAssets.js';

function createLayerGrid(width, height) {
  return Array.from(
    { length: height },
    () => Array.from({ length: width }, () => [])
  );
}

const CATEGORY_BY_LAYER = Object.freeze({
  surface: 'surface',
  route: 'route-transition',
  'elevation-connection': 'connection-stairs',
  'elevation-slope': 'surface',
  boundary: 'exposed-face-boundary',
  obstacle: 'blocking-obstacle',
  decoration: 'nonblocking-decoration'
});
const CARDINAL_DIRECTIONS = Object.freeze(['n', 'e', 's', 'w']);
const PERIMETER_ACCENT_KINDS = new Set([
  'biome-accent',
  'boundary-accent',
  'boundary-undergrowth',
  'understory-accent'
]);
const TREE_OBSTACLE_KIND = /(?:tree|pine|birch|cedar|fir|spruce|willow|oak|elm|ash)/i;

const CARDINAL_STEPS = Object.freeze([
  Object.freeze({ direction: 'n', dx: 0, dy: -1 }),
  Object.freeze({ direction: 'e', dx: 1, dy: 0 }),
  Object.freeze({ direction: 's', dx: 0, dy: 1 }),
  Object.freeze({ direction: 'w', dx: -1, dy: 0 })
]);

function stableVisualSeed(...parts) {
  let value = 0x811c9dc5;
  for (const character of parts.join(':')) {
    value ^= character.codePointAt(0);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function rendererEcologyProfile(renderer) {
  return renderer?.variant?.ecologyProfile ?? null;
}

function uniqueAssetRecords(records) {
  const recordsByAsset = new Map();
  for (const record of records) {
    if (!recordsByAsset.has(record.asset.key)) {
      recordsByAsset.set(record.asset.key, record);
    }
  }
  return [...recordsByAsset.values()].sort((left, right) =>
    left.asset.key.localeCompare(right.asset.key)
  );
}

function cardinalDirection(from, to) {
  if (to.x === from.x && to.y === from.y - 1) return 'n';
  if (to.x === from.x + 1 && to.y === from.y) return 'e';
  if (to.x === from.x && to.y === from.y + 1) return 's';
  if (to.x === from.x - 1 && to.y === from.y) return 'w';
  return null;
}

function reverseDirection(direction) {
  return { n: 's', e: 'w', s: 'n', w: 'e' }[direction] ?? null;
}

function routeTopologyRole(neighbors) {
  const set = new Set(neighbors);
  const mask = CARDINAL_DIRECTIONS.filter(direction => set.has(direction)).join('');
  const roles = {
    '': 'isolated',
    n: 'end-n',
    e: 'end-e',
    s: 'end-s',
    w: 'end-w',
    ns: 'straight-ns',
    ew: 'straight-ew',
    ne: 'corner-ne',
    es: 'corner-es',
    sw: 'corner-sw',
    nw: 'corner-wn',
    nes: 'tee-nes',
    esw: 'tee-esw',
    nsw: 'tee-nsw',
    new: 'tee-wne',
    nesw: 'cross'
  };
  return roles[mask];
}

function assertDirectionalVariant(renderer, {
  direction,
  heightDelta = null,
  routeTopology = null,
  requireDirection = false,
  requireHeightDelta = false,
  requireRouteTopology = false,
  path
}) {
  const variant = renderer.variant;
  if (!variant) {
    if (requireDirection || requireHeightDelta || requireRouteTopology) {
      throw new TypeError(`${path} renderer requires concrete variant metadata`);
    }
    return false;
  }
  if (requireDirection && variant.direction === undefined) {
    throw new TypeError(`${path} renderer requires concrete direction metadata`);
  }
  if (requireHeightDelta && variant.heightDelta === undefined) {
    throw new TypeError(`${path} renderer requires concrete heightDelta metadata`);
  }
  if (requireRouteTopology && variant.routeTopology === undefined) {
    throw new TypeError(`${path} renderer requires concrete routeTopology metadata`);
  }
  if (
    direction !== null &&
    variant.direction !== undefined &&
    variant.direction !== direction
  ) {
    throw new TypeError(
      `${path} renderer direction ${variant.direction} does not match ${direction}`
    );
  }
  if (
    heightDelta !== null &&
    variant.heightDelta !== undefined &&
    variant.heightDelta !== Math.abs(heightDelta)
  ) {
    throw new TypeError(
      `${path} renderer does not support height delta ${Math.abs(heightDelta)}`
    );
  }
  if (
    routeTopology !== null &&
    variant.routeTopology !== undefined &&
    variant.routeTopology !== routeTopology
  ) {
    throw new TypeError(
      `${path} renderer topology does not match ${routeTopology || '<isolated>'}`
    );
  }
  return true;
}

function stairRenderPlacement(connection) {
  const endpointDirection = connection.direction ??
    cardinalDirection(connection.from, connection.to);
  if (!endpointDirection) return null;
  if (connection.heightDelta < 0) {
    return {
      cell: connection.to,
      direction: reverseDirection(endpointDirection)
    };
  }
  return {
    cell: connection.from,
    direction: endpointDirection
  };
}

function assertLayerRenderer(asset, category, path) {
  const renderer = getBattleMapV3RendererDescriptor(asset);
  const expected = CATEGORY_BY_LAYER[category];
  if (renderer.category !== expected) {
    throw new TypeError(
      `${path} requires ${expected} renderer, received ${renderer.category}`
    );
  }
  return renderer;
}

function assertFootprint(
  renderer,
  cells,
  direction,
  path,
  authoredDirectional = false
) {
  const xs = cells.map(cell => cell.x);
  const ys = cells.map(cell => cell.y);
  const actual = {
    width: Math.max(...xs) - Math.min(...xs) + 1,
    height: Math.max(...ys) - Math.min(...ys) + 1
  };
  const directionalSwap =
    !authoredDirectional && ['e', 'w'].includes(direction);
  const expected = directionalSwap
    ? {
      width: renderer.footprint.height,
      height: renderer.footprint.width
    }
    : {
      width: renderer.footprint.width,
      height: renderer.footprint.height
    };
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new TypeError(
      `${path} footprint ${actual.width}x${actual.height} does not match ` +
      `renderer footprint ${expected.width}x${expected.height}`
    );
  }
}

function addLayer(layerGrid, cell, asset, category, record, direction = null) {
  if (!cell || !asset) return;
  const renderer = assertLayerRenderer(
    asset,
    category,
    `BattleMapV3 ${category} asset ${asset.key}`
  );
  if (
    ['elevation-connection', 'elevation-slope', 'boundary'].includes(category) &&
    !CARDINAL_DIRECTIONS.includes(direction)
  ) {
    throw new TypeError(`BattleMapV3 ${category} requires a cardinal direction`);
  }
  layerGrid[cell.y][cell.x].push({
    asset,
    category,
    record,
    renderer,
    direction
  });
}

/**
 * Apply one already verified BattleMapV3 payload to BattleGrid.
 *
 * V3 is intentionally a separate renderer contract: this adapter never calls
 * terrain generation, V2 variant setters, or legacy transition/decor loaders.
 */
export function applyBattleMapV3RenderAdapter(grid, map) {
  if (!grid || typeof grid !== 'object') {
    throw new TypeError('BattleMapV3 renderer requires a BattleGrid');
  }
  if (map?.battleMapSchemaVersion !== 3) {
    throw new TypeError('BattleMapV3 renderer requires schema 3');
  }
  const width = map.dimensions?.width;
  const height = map.dimensions?.height;
  if (width !== grid.width || height !== grid.height) {
    throw new RangeError('BattleMapV3 dimensions do not match BattleGrid');
  }
  assertBattleMapV3RuntimeManifestSupportsMap(map);
  const renderProfile = getBattleMapV3RenderProfile();

  const layers = createLayerGrid(width, height);
  const surfaceRenderers = createLayerGrid(width, height);
  map.visualCells.forEach((row, y) => row.forEach((visualCell, x) => {
    if (visualCell?.surface) {
      surfaceRenderers[y][x] = assertLayerRenderer(
        visualCell.surface,
        'surface',
        `BattleMapV3 visualCells[${y}][${x}].surface`
      );
    }
    for (const asset of visualCell?.overlays ?? []) {
      throw new TypeError(
        `BattleMapV3 visualCells[${y}][${x}] contains unsupported untyped overlay ${asset.key}`
      );
    }
  }));
  for (const connection of map.elevationConnections) {
    const placement = stairRenderPlacement(connection);
    if (!placement) {
      throw new TypeError(
        `BattleMapV3 ${connection.kind} connection ${connection.id} requires cardinal endpoints`
      );
    }
    if (connection.kind === 'slope') {
      const exactRenderer = connection.asset
        ? getBattleMapV3RendererDescriptor(connection.asset)
        : null;
      if (exactRenderer?.category === 'connection-slope' ||
          exactRenderer?.variant) {
        if (exactRenderer.category !== 'connection-slope') {
          throw new TypeError(
            `BattleMapV3 slope connection ${connection.id} requires a connection-slope renderer`
          );
        }
        assertDirectionalVariant(exactRenderer, {
          direction: placement.direction,
          heightDelta: connection.heightDelta,
          requireDirection: true,
          requireHeightDelta: true,
          path: `BattleMapV3 slope connection ${connection.id}`
        });
        assertFootprint(
          exactRenderer,
          [connection.from, connection.to],
          placement.direction,
          `BattleMapV3 connection ${connection.id}`,
          true
        );
        layers[placement.cell.y][placement.cell.x].push({
          asset: connection.asset,
          category: 'elevation-slope',
          record: connection,
          renderer: exactRenderer,
          direction: placement.direction,
          authoredDirectional: true
        });
        continue;
      }
      const visualCell =
        map.visualCells[placement.cell.y]?.[placement.cell.x];
      const renderer =
        surfaceRenderers[placement.cell.y]?.[placement.cell.x];
      if (!visualCell?.surface || !renderer) {
        throw new TypeError(
          `BattleMapV3 slope connection ${connection.id} requires a low-endpoint surface`
        );
      }
      layers[placement.cell.y][placement.cell.x].push({
        asset: visualCell.surface,
        category: 'elevation-slope',
        record: connection,
        renderer,
        direction: placement.direction,
        authoredDirectional: false
      });
      continue;
    }
    if (connection.kind !== 'stairs') continue;
    if (!connection.asset) {
      throw new TypeError(
        `BattleMapV3 stairs connection ${connection.id} requires an exact asset`
      );
    }
    addLayer(
      layers,
      placement.cell,
      connection.asset,
      'elevation-connection',
      connection,
      placement.direction
    );
    const layer = layers[placement.cell.y][placement.cell.x].at(-1);
    layer.authoredDirectional = assertDirectionalVariant(layer.renderer, {
      direction: placement.direction,
      heightDelta: connection.heightDelta,
      requireDirection: layer.renderer.variant !== undefined,
      requireHeightDelta: layer.renderer.variant !== undefined,
      path: `BattleMapV3 stairs connection ${connection.id}`
    });
    assertFootprint(
      layer.renderer,
      [connection.from, connection.to],
      placement.direction,
      `BattleMapV3 connection ${connection.id}`,
      layer.authoredDirectional
    );
  }
  const routeCells = new Set(
    map.routes.flatMap(route =>
      route.visualAssets.flatMap(visual => visual.cells.map(cellKey))
    )
  );
  for (const route of map.routes) {
    const routeCellsForRoute = new Set(
      route.visualAssets.flatMap(
        visual => visual.cells.map(cellKey)
      )
    );
    const textureSeed = stableVisualSeed(
      map.contentId,
      map.contentVersion,
      route.id
    );
    for (const visual of route.visualAssets) {
      for (const cell of visual.cells) {
        addLayer(layers, cell, visual.asset, 'route', visual);
        const layer = layers[cell.y][cell.x].at(-1);
        const neighbors = CARDINAL_STEPS
          .filter(step =>
            routeCellsForRoute.has(`${cell.x + step.dx},${cell.y + step.dy}`)
          )
          .map(step => step.direction);
        const topologyRole = routeTopologyRole(neighbors);
        assertDirectionalVariant(layer.renderer, {
          direction: null,
          routeTopology: topologyRole,
          requireRouteTopology: layer.renderer.variant !== undefined,
          path: `BattleMapV3 route ${route.id} at ${cell.x},${cell.y}`
        });
        layer.routeTopology = {
          neighbors,
          role: topologyRole,
          textureSeed,
          width: route.width,
          visualSeed: stableVisualSeed(
            map.contentId,
            map.contentVersion,
            route.id,
            cell.x,
            cell.y
          )
        };
        layer.authoredTopology = layer.renderer.variant?.routeTopology !== undefined;
      }
    }
  }
  for (const decoration of map.decorations) {
    addLayer(
      layers,
      decoration.cell,
      decoration.asset,
      'decoration',
      decoration
    );
    layers[decoration.cell.y][decoration.cell.x].at(-1).mirrorDirection =
      stableVisualSeed(map.contentId, decoration.id) & 1 ? 'e' : 's';
  }
  const perimeterAccentRecords = map.decorations
    .map(decoration => ({
      decoration,
      renderer: getBattleMapV3RendererDescriptor(decoration.asset)
    }))
    .filter(({ decoration, renderer }) =>
      PERIMETER_ACCENT_KINDS.has(decoration.kind) &&
      renderer.category === 'nonblocking-decoration'
    );
  const authoredEcologyProfiles = new Set(
    [
      ...map.boundaries.map(boundary => boundary.asset),
      ...map.obstacles.map(obstacle => obstacle.asset),
      ...map.decorations.map(decoration => decoration.asset)
    ]
      .map(asset => rendererEcologyProfile(
        getBattleMapV3RendererDescriptor(asset)
      ))
      .filter(Boolean)
  );
  const soleAuthoredEcology = authoredEcologyProfiles.size === 1
    ? [...authoredEcologyProfiles][0]
    : null;
  const forestEdgeEcologies = new Set(
    map.boundaries
      .filter(boundary => boundary.kind === 'biome-edge')
      .map(boundary => rendererEcologyProfile(
        getBattleMapV3RendererDescriptor(boundary.asset)
      ))
      .filter(Boolean)
  );
  const sceneEcology = forestEdgeEcologies.size === 1
    ? [...forestEdgeEcologies][0]
    : soleAuthoredEcology;
  const sceneAwareOrganicForest =
    map.theme === 'forest' &&
    map.scene?.silhouette === 'organic-island' &&
    map.scene.exterior === 'forest-canopy';
  const surfaceFoundation = sceneAwareOrganicForest
    ? uniqueAssetRecords(
      map.visualCells
        .flat()
        .filter(visualCell => visualCell?.surface)
        .map(visualCell => ({ asset: visualCell.surface }))
    )
      .map(({ asset }) => ({
        asset,
        renderer: getBattleMapV3RendererDescriptor(asset)
      }))
      .filter(({ renderer }) =>
        renderer.category === 'surface' &&
        Boolean(sceneEcology) &&
        rendererEcologyProfile(renderer) === sceneEcology
      )
      .sort((left, right) =>
        (left.renderer.variant?.surfaceVariant ?? Number.MAX_SAFE_INTEGER) -
          (right.renderer.variant?.surfaceVariant ?? Number.MAX_SAFE_INTEGER) ||
        left.asset.key.localeCompare(right.asset.key)
      )[0] ?? null
    : null;
  const legacyForestComposition =
    map.theme === 'forest' && !map.scene;
  const composeForestPerimeter =
    sceneAwareOrganicForest || legacyForestComposition;
  const edgeAccentCells = new Set();
  const occupiedPropCells = new Set([
    ...map.decorations.map(decoration => cellKey(decoration.cell)),
    ...map.obstacles.flatMap(obstacle => obstacle.cells.map(cellKey))
  ]);
  const biomeEdgeDirectionsByCell = new Map();
  for (const boundary of map.boundaries) {
    if (boundary.kind !== 'biome-edge') continue;
    for (const edge of boundary.edges) {
      const key = cellKey(edge.cell);
      const directions = biomeEdgeDirectionsByCell.get(key) ?? [];
      directions.push(edge.direction);
      biomeEdgeDirectionsByCell.set(key, directions);
    }
  }
  for (const boundary of map.boundaries) {
    for (const edge of boundary.edges) {
      addLayer(layers, edge.cell, boundary.asset, 'boundary', {
        ...boundary,
        edge
      }, edge.direction);
      const layer = layers[edge.cell.y][edge.cell.x].at(-1);
      layer.authoredDirectional = assertDirectionalVariant(layer.renderer, {
        direction: edge.direction,
        requireDirection: layer.renderer.variant !== undefined,
        path: `BattleMapV3 boundary ${boundary.id} at ${edge.cell.x},${edge.cell.y}`
      });
      if (
        map.scene?.silhouette === 'organic-island' &&
        map.scene.exterior !== 'none' &&
        boundary.kind === 'biome-edge'
      ) {
        layer.exteriorMode = map.scene.exterior;
        layer.exteriorStratum = ['n', 'w'].includes(edge.direction)
          ? 'rear-canopy'
          : 'front-skirt';
      }
      const visualSeed = stableVisualSeed(
        map.contentId,
        boundary.id,
        edge.cell.x,
        edge.cell.y,
        edge.direction
      );
      const brightness = 96 + visualSeed % 9;
      const saturation = 95 + ((visualSeed >>> 4) % 11);
      layer.visualTreatment = {
        filter: `brightness(${brightness}%) saturate(${saturation}%)`
      };

      // New forest releases may carry approved low vegetation in their exact
      // asset closure. Reuse those pinned assets as sparse, deterministic
      // perimeter undergrowth so a long biome edge does not read as a tiled
      // fence. This is visual-only and never changes collision or playability.
      const edgeKey = cellKey(edge.cell);
      const accentSeed = stableVisualSeed(
        map.contentId,
        map.contentVersion,
        'boundary-undergrowth',
        edge.cell.x,
        edge.cell.y
      );
      const boundaryEcology =
        rendererEcologyProfile(layer.renderer) ?? soleAuthoredEcology;
      const eligibleAccentRecords = perimeterAccentRecords.filter(
        ({ renderer }) => {
          if (legacyForestComposition) return true;
          const ecology = rendererEcologyProfile(renderer);
          return Boolean(boundaryEcology) && ecology === boundaryEcology;
        }
      );
      if (
        composeForestPerimeter
        &&
        boundary.kind === 'biome-edge'
        && eligibleAccentRecords.length > 0
        && !edgeAccentCells.has(edgeKey)
        && !occupiedPropCells.has(edgeKey)
        && !routeCells.has(edgeKey)
        && (biomeEdgeDirectionsByCell.get(edgeKey) ?? [])
          .every(direction => direction === 'n' || direction === 'w')
        && accentSeed % 4 === 0
      ) {
        const accentRecord = eligibleAccentRecords[
          (accentSeed >>> 8) % eligibleAccentRecords.length
        ];
        const asset = accentRecord.decoration.asset;
        addLayer(
          layers,
          edge.cell,
          asset,
          'decoration',
          {
            id: `visual:boundary-undergrowth:${edge.cell.x}:${edge.cell.y}`,
            kind: 'boundary-undergrowth',
            cell: edge.cell,
            featureId: boundary.featureId,
            anchor: 'tile',
            asset
          }
        );
        layers[edge.cell.y][edge.cell.x].at(-1).mirrorDirection =
          accentSeed & 1 ? 'e' : 's';
        edgeAccentCells.add(edgeKey);
      }
    }
  }
  const obstacleLayers = map.obstacles.map(obstacle => ({
    asset: obstacle.asset,
    category: 'obstacle',
    record: obstacle,
    renderer: assertLayerRenderer(
      obstacle.asset,
      'obstacle',
      `BattleMapV3 obstacle ${obstacle.id}`
    ),
    direction: null,
    mirrorDirection:
      stableVisualSeed(map.contentId, obstacle.id) & 1 ? 'e' : 's',
    cell: obstacle.anchor
  })).map(layer => {
    assertFootprint(
      layer.renderer,
      layer.record.cells,
      null,
      `BattleMapV3 obstacle ${layer.record.id}`
    );
    return layer;
  });
  if (sceneAwareOrganicForest && sceneEcology) {
    const treeRecords = uniqueAssetRecords(map.obstacles.filter(obstacle => {
      const renderer = getBattleMapV3RendererDescriptor(obstacle.asset);
      return renderer.category === 'blocking-obstacle' &&
        renderer.footprint.width === 1 &&
        renderer.footprint.height === 1 &&
        rendererEcologyProfile(renderer) === sceneEcology &&
        (
          TREE_OBSTACLE_KIND.test(obstacle.kind) ||
          TREE_OBSTACLE_KIND.test(obstacle.asset.key)
        );
    }));
    const floorAccentRecords = uniqueAssetRecords(
      map.decorations.filter(decoration => {
        const renderer = getBattleMapV3RendererDescriptor(decoration.asset);
        return renderer.category === 'nonblocking-decoration' &&
          PERIMETER_ACCENT_KINDS.has(decoration.kind) &&
          rendererEcologyProfile(renderer) === sceneEcology;
      })
    );
    const boundaryCells = new Set(
      map.boundaries.flatMap(boundary =>
        boundary.edges.map(edge => cellKey(edge.cell))
      )
    );

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = { x, y };
        const key = cellKey(cell);
        if (
          !map.renderMask[y][x] ||
          occupiedPropCells.has(key) ||
          edgeAccentCells.has(key) ||
          routeCells.has(key) ||
          !map.visualCells[y][x]?.surface
        ) {
          continue;
        }

        if (!map.playableMask[y][x] && treeRecords.length > 0) {
          const treeSeed = stableVisualSeed(
            map.contentId,
            map.contentVersion,
            'scene-tree',
            x,
            y
          );
          if (treeSeed % 3 === 0) {
            const source = treeRecords[
              (treeSeed >>> 8) % treeRecords.length
            ];
            const renderer = getBattleMapV3RendererDescriptor(source.asset);
            obstacleLayers.push({
              asset: source.asset,
              category: 'obstacle',
              record: {
                id: `visual:scene-tree:${x}:${y}`,
                kind: 'scene-tree',
                cells: [cell],
                anchor: cell,
                blocking: false,
                movementCost: 1,
                featureId: null,
                sceneOnly: true,
                asset: source.asset
              },
              renderer,
              direction: null,
              mirrorDirection: treeSeed & 1 ? 'e' : 's',
              cell,
              sceneOnly: true
            });
          }
          continue;
        }

        if (
          map.playableMask[y][x] &&
          floorAccentRecords.length > 0 &&
          !boundaryCells.has(key)
        ) {
          const accentSeed = stableVisualSeed(
            map.contentId,
            map.contentVersion,
            'scene-floor-accent',
            x,
            y
          );
          if (accentSeed % 23 !== 0) continue;
          const source = floorAccentRecords[
            (accentSeed >>> 8) % floorAccentRecords.length
          ];
          addLayer(layers, cell, source.asset, 'decoration', {
            id: `visual:scene-floor-accent:${x}:${y}`,
            kind: 'scene-floor-accent',
            cell,
            featureId: null,
            anchor: 'tile',
            sceneOnly: true,
            asset: source.asset
          });
          const layer = layers[y][x].at(-1);
          layer.mirrorDirection = accentSeed & 1 ? 'e' : 's';
          layer.sceneOnly = true;
        }
      }
    }
  }

  grid.setTerrain(map.terrain);
  grid.setElevation(map.elevation, 'discrete');
  grid.setObstacles(map.obstacles);
  grid.setElevationConnections(map.elevationConnections);
  grid.setMasks(map.renderMask, map.playableMask);
  grid.setBattleMapV3RenderData({
    visualCells: map.visualCells,
    surfaceRenderers,
    layers,
    obstacleLayers,
    renderProfile,
    scene: map.scene ?? null,
    surfaceFoundation
  });
  return grid;
}
