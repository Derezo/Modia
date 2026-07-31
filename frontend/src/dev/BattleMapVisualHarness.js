import {
  V2_PRODUCTION_NODE_TYPES,
  generateBattleMapV2,
  getV2VisualCapabilities,
  loadAndFreezeBattleMapV3Final
} from '@modia/shared';
import { battleMapV2ToFlatState } from '@modia/shared/battleMap';
import {
  BattleGrid,
  renderBattleSceneBackdrop
} from '../battle/BattleGrid.js';
import {
  assertBattleMapV3RuntimeManifestSupportsMap,
  collectBattleMapAssetManifest,
  installBattleMapV3RuntimeBundleRegistry
} from '../battle/BattleMapAssets.js';
import { renderMinimap } from '../battle/BattleMinimap.js';
import { applyBattleMapV3RenderAdapter } from '../battle/BattleMapV3RenderAdapter.js';
import { applyBattleMapPatch } from '../battle/mergeBattleState.js';
import { AssetLoader } from '../core/AssetLoader.js';
import battleMapV3RuntimeBundles from '../generated/battleMapV3RuntimeBundles.json';

const runtimeBundleReady =
  installBattleMapV3RuntimeBundleRegistry(battleMapV3RuntimeBundles);

const CANVAS_WIDTH = 2112;
const CANVAS_HEIGHT = 1248;
const DEFAULT_SIZE = 32;
const DEFAULT_MODE = 'pve';
const DEFAULT_PLAYER_COUNT = 1;
const DEFAULT_ENEMY_CAPACITY = 4;
const DIRECTION_NAMES = Object.freeze({
  n: 'north',
  e: 'east',
  s: 'south',
  w: 'west'
});

const canvas = document.querySelector('#battle-map');
const title = document.querySelector('#title');
const details = document.querySelector('#details');
const errorOutput = document.querySelector('#error');
const assetLoader = new AssetLoader();
let assetLoaderReady = null;

function requireInteger(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(
      `${label} must be an integer from ${minimum} to ${maximum}`
    );
  }
  return parsed;
}

function normalizeRequest(input = {}) {
  if (input.artifactUrl) {
    const artifactUrl = String(input.artifactUrl);
    if (!artifactUrl.startsWith('/') || artifactUrl.startsWith('//') ||
        artifactUrl.includes('\\') || artifactUrl.split('/').includes('..')) {
      throw new RangeError('artifactUrl must be a safe root-relative path');
    }
    return Object.freeze({
      kind: 'v3-artifact',
      artifactUrl,
      combatOverlay: input.combatOverlay === true || input.combatOverlay === '1'
    });
  }
  const nodeType = String(input.nodeType ?? 'forest');
  if (!V2_PRODUCTION_NODE_TYPES.includes(nodeType)) {
    throw new RangeError(`Unknown production node type: ${nodeType}`);
  }

  return Object.freeze({
    kind: 'v2-generated',
    nodeType,
    terrainSeed: requireInteger(
      input.terrainSeed ?? input.seed ?? 0,
      'terrainSeed',
      0,
      0x7fffffff
    ),
    mapWidth: requireInteger(
      input.mapWidth ?? input.width ?? DEFAULT_SIZE,
      'mapWidth',
      10,
      64
    ),
    mapHeight: requireInteger(
      input.mapHeight ?? input.height ?? DEFAULT_SIZE,
      'mapHeight',
      10,
      64
    ),
    mode: String(input.mode ?? DEFAULT_MODE),
    playerCount: requireInteger(
      input.playerCount ?? DEFAULT_PLAYER_COUNT,
      'playerCount',
      1,
      8
    ),
    enemyCapacity: requireInteger(
      input.enemyCapacity ?? DEFAULT_ENEMY_CAPACITY,
      'enemyCapacity',
      1,
      32
    )
  });
}

async function loadBattleMapV3Artifact(request) {
  const response = await fetch(request.artifactUrl, {
    credentials: 'same-origin',
    cache: 'no-cache'
  });
  if (!response.ok) {
    throw new Error(
      `V3 visual artifact failed to load: ${request.artifactUrl} (${response.status})`
    );
  }
  const state = await loadAndFreezeBattleMapV3Final(await response.json());
  assertBattleMapV3RuntimeManifestSupportsMap(state);
  assetLoaderReady ??= assetLoader.init();
  await assetLoaderReady;
  const manifest = collectBattleMapAssetManifest(state);
  await assetLoader.preloadBattleMapV3Assets(manifest);
  return { state, manifest };
}

function connectionAssetKey(palette, connection) {
  let direction = connection.direction;
  if ((connection.elevationDelta ?? 0) < 0) {
    direction = { n: 's', e: 'w', s: 'n', w: 'e' }[direction];
  }
  const kind = connection.kind === 'stairs' ? 'stairs' : 'slope';
  const variant = kind === 'stairs' ? 2 : 1;
  if (!DIRECTION_NAMES[direction]) {
    throw new RangeError(
      `Unsupported V2 connection direction: ${String(direction)}`
    );
  }
  return `${palette}:connection:${kind}:${direction}:${variant}`;
}

async function requireExactAsset(assetKey, options = {}) {
  const asset = await assetLoader.loadBattleMapV2Asset(assetKey, options);
  if (!asset) {
    throw new Error(
      `Required exact V2 render asset did not load: ${assetKey} ` +
      `${JSON.stringify(options)}`
    );
  }
  return asset;
}

async function preloadAndVerifyExactAssets(state) {
  assetLoaderReady ??= assetLoader.init();
  await assetLoaderReady;

  const capabilities = getV2VisualCapabilities(state.nodeType);
  const palette = capabilities.palette;
  const manifest = collectBattleMapAssetManifest(state);

  // Exercise the same aggregate preload calls used by BattleScene first.
  await Promise.all([
    assetLoader.preloadTerrainSet(state.nodeType),
    assetLoader.preloadObstacles({ obstacles: manifest })
  ]);

  const exactRequests = new Map();
  const add = (assetKey, options = {}) => {
    const key = `${assetKey}:${JSON.stringify(options)}`;
    exactRequests.set(key, { assetKey, options });
  };

  add(`${palette}:face:stone`);
  for (const variant of state.variants) {
    add(`${palette}:floor:${variant.material}`, {
      variantIndex: variant.variantIndex,
      expectedPalette: palette
    });
  }
  for (const record of state.obstacles) {
    add(record.assetKey, {
      selectionKey: record.id,
      expectedPalette: palette
    });
  }
  for (const record of state.transitions) {
    add(record.assetKey, { expectedPalette: palette });
  }
  for (const record of state.decorations) {
    add(record.assetKey, {
      variantIndex: record.variantIndex,
      expectedPalette: palette
    });
  }
  for (const connection of state.elevationConnections) {
    add(connectionAssetKey(palette, connection), {
      expectedPalette: palette
    });
  }

  await Promise.all(
    [...exactRequests.values()].map(({ assetKey, options }) =>
      requireExactAsset(assetKey, options)
    )
  );

  return {
    exactAssetSelections: exactRequests.size,
    palette
  };
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function cellDistance(left, right) {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function movementHighlightCells(state) {
  const routes = Array.isArray(state.routes) ? state.routes : [];
  const connections = (state.elevationConnections ?? [])
    .filter(connection =>
      connection.traversable &&
      connection.from &&
      connection.to &&
      Math.abs(connection.heightDelta ?? 0) > 0
    );
  const playerAnchor = state.spawnContract?.playerSlots?.[0]?.cell;
  const candidates = [];

  for (const connection of connections) {
    for (const route of routes) {
      const cells = route.cells ?? [];
      const fromIndex = cells.findIndex(cell =>
        cell.x === connection.from.x && cell.y === connection.from.y
      );
      const toIndex = cells.findIndex(cell =>
        cell.x === connection.to.x && cell.y === connection.to.y
      );
      const crossesConnection =
        fromIndex >= 0 &&
        toIndex >= 0 &&
        Math.abs(fromIndex - toIndex) === 1;
      const routeIndex = crossesConnection
        ? Math.min(fromIndex, toIndex)
        : Math.max(fromIndex, toIndex);
      if (routeIndex < 0) continue;

      candidates.push({
        cells,
        connection,
        crossesConnection,
        routeIndex,
        distance: playerAnchor
          ? Math.min(
            cellDistance(playerAnchor, connection.from),
            cellDistance(playerAnchor, connection.to)
          )
          : 0
      });
    }
  }

  candidates.sort((left, right) =>
    Number(right.crossesConnection) - Number(left.crossesConnection) ||
    left.distance - right.distance ||
    String(left.connection.id).localeCompare(String(right.connection.id))
  );

  const selected = candidates[0];
  if (selected) {
    const start = Math.max(0, selected.routeIndex - 3);
    const end = Math.min(selected.cells.length, selected.routeIndex + 6);
    const cells = selected.cells.slice(start, end);
    const keys = new Set(cells.map(cellKey));
    for (const endpoint of [
      selected.connection.from,
      selected.connection.to
    ]) {
      if (!keys.has(cellKey(endpoint))) cells.push(endpoint);
    }
    return cells.slice(0, 10);
  }

  return (routes[0]?.cells ?? []).slice(0, 8);
}

function createCombatUnits(state, grid) {
  const makeUnit = (record, teamId, index, isSelected = false) => {
    const world = grid.gridToScreenWorld(record.cell.x, record.cell.y);
    return Object.freeze({
      id: `visual:${record.id}`,
      gridX: record.cell.x,
      gridY: record.cell.y,
      isSelected,
      screenX: world.x,
      screenY: world.y,
      teamId,
      variant: index,
      isAlive: () => true
    });
  };
  const players = (state.spawnContract?.playerSlots ?? [])
    .slice(0, 4)
    .map((record, index) => makeUnit(record, 1, index, index === 0));
  const opponents = (state.spawnContract?.opponentCandidates ?? [])
    .slice(0, 4)
    .map((record, index) => makeUnit(record, 2, index));
  return [...players, ...opponents];
}

function renderCombatPawn(context, grid, unit) {
  const { x, y } = grid.gridToScreen(unit.gridX, unit.gridY);
  const player = unit.teamId === 1;
  const fill = player
    ? ['#4f9bd8', '#5ba7df', '#418bc8', '#6aaee0'][unit.variant % 4]
    : ['#c94f52', '#d85d59', '#b9444a', '#df6d61'][unit.variant % 4];

  context.save();
  context.fillStyle = 'rgba(9, 13, 18, 0.55)';
  context.beginPath();
  context.ellipse(x, y + 5, 15, 6, 0, 0, Math.PI * 2);
  context.fill();

  if (unit.isSelected) {
    context.strokeStyle = '#f5d24b';
    context.lineWidth = 3;
    context.beginPath();
    context.ellipse(x, y + 3, 18, 9, 0, 0, Math.PI * 2);
    context.stroke();
  }

  context.fillStyle = fill;
  context.strokeStyle = 'rgba(18, 24, 29, 0.9)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x - 9, y + 2);
  context.quadraticCurveTo(x - 8, y - 15, x, y - 18);
  context.quadraticCurveTo(x + 8, y - 15, x + 9, y + 2);
  context.closePath();
  context.fill();
  context.stroke();

  context.fillStyle = player ? '#d7eef9' : '#f4d7cf';
  context.beginPath();
  context.arc(x, y - 23, 6, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  context.fillStyle = 'rgba(13, 20, 24, 0.85)';
  context.fillRect(x - 12, y - 36, 24, 4);
  context.fillStyle = player ? '#58c878' : '#d95c58';
  context.fillRect(x - 11, y - 35, 22, 2);
  context.restore();
}

function renderCombatOverlay(context, grid, state) {
  const movementCells = movementHighlightCells(state);
  const highlights = Object.fromEntries(
    movementCells.map((cell, index) => [
      cellKey(cell),
      index === movementCells.length - 1
        ? 'rgba(100, 180, 255, 0.72)'
        : 'rgba(74, 144, 217, 0.42)'
    ])
  );
  const units = createCombatUnits(state, grid);
  grid.render(context, highlights, null, {
    entities: units,
    renderEntity: unit => renderCombatPawn(context, grid, unit)
  });

  const mapCenter = grid.getMapCenter();
  renderMinimap({
    ctx: context,
    units: new Map(units.map(unit => [unit.id, unit])),
    camera: { x: mapCenter.x, y: mapCenter.y, zoom: 1 },
    grid,
    targetWidth: CANVAS_WIDTH,
    targetHeight: CANVAS_HEIGHT,
    localTeamId: 1
  });

  return Object.freeze({
    movementHighlightCount: movementCells.length,
    mockUnitCount: units.length
  });
}

function summarizeMap(state, request, assetSummary, elapsedMs) {
  return Object.freeze({
    nodeType: request.nodeType,
    seed: request.terrainSeed,
    corpus: request.terrainSeed === 0 ? 'fixed' : 'holdout',
    mode: request.mode,
    mapWidth: state.mapWidth,
    mapHeight: state.mapHeight,
    battleMapSchemaVersion: state.battleMapSchemaVersion,
    terrainGenerationVersion: state.terrainGenerationVersion,
    palette: assetSummary.palette,
    archetype: state.archetype,
    obstacleCount: state.obstacles.length,
    transitionCount: state.transitions.length,
    decorationCount: state.decorations.length,
    elevationConnectionCount: state.elevationConnections.length,
    exactAssetSelections: assetSummary.exactAssetSelections,
    selectedAttempt: state.diagnostics.attempt,
    qualityScore: state.diagnostics.qualityMetrics.score,
    authoritativeHash: state.diagnostics.hashes.authoritativeHash,
    visualHash: state.diagnostics.hashes.visualHash,
    fullHash: state.diagnostics.hashes.fullHash,
    renderDurationMs: elapsedMs
  });
}

export async function renderBattleMapVisual(input = {}) {
  const request = normalizeRequest(input);
  const startedAt = performance.now();
  document.body.dataset.status = 'loading';
  delete document.body.dataset.renderedNodeType;
  delete document.body.dataset.renderedSeed;
  errorOutput.textContent = '';
  title.textContent = request.kind === 'v3-artifact'
    ? `BattleMapV3 · ${request.artifactUrl}`
    : `${request.nodeType} · seed ${request.terrainSeed}`;
  details.textContent = request.kind === 'v3-artifact'
    ? 'Tracked BattleMapV3 artifact · rendering'
    : `${request.mapWidth}×${request.mapHeight} · BattleMapV2 · rendering`;

  try {
    await runtimeBundleReady;
    if (request.kind === 'v3-artifact') {
      const { state, manifest } = await loadBattleMapV3Artifact(request);
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas 2D context is unavailable');
      const grid = new BattleGrid(
        canvas,
        state.dimensions.width,
        state.dimensions.height
      );
      grid.setAssetLoader(assetLoader);
      applyBattleMapV3RenderAdapter(grid, state);
      renderBattleSceneBackdrop(context, {
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        scene: grid.battleMapV3RenderData.scene
      });
      const combatSummary = request.combatOverlay
        ? renderCombatOverlay(context, grid, state)
        : null;
      if (!request.combatOverlay) grid.render(context);
      const bounds = grid.getMapPixelDimensions();
      const result = Object.freeze({
        artifactUrl: request.artifactUrl,
        battleMapSchemaVersion: 3,
        contentId: state.contentId,
        contentVersion: state.contentVersion,
        fullHash: state.hashes.fullHash,
        assetBundleManifestFullHash:
          state.provenance.assetBundle.manifestFullHash,
        exactAssetSelections: manifest.length,
        renderedCells: state.renderMask.flat().filter(Boolean).length,
        worldBounds: bounds,
        renderDurationMs: Math.round(performance.now() - startedAt),
        ...(combatSummary ? { combatOverlay: combatSummary } : {})
      });
      window.__battleMapVisualResult = result;
      document.body.dataset.renderedNodeType = 'battle-map-v3';
      document.body.dataset.renderedSeed = 'artifact';
      document.body.dataset.status = 'ready';
      details.textContent =
        `${state.dimensions.width}×${state.dimensions.height} · ` +
        `${result.renderedCells} rendered cells · ${manifest.length} exact assets` +
        (combatSummary
          ? ` · combat overlay (${combatSummary.mockUnitCount} mock units)`
          : '');
      return result;
    }
    const battleMap = await generateBattleMapV2(request);
    const state = await battleMapV2ToFlatState(battleMap);
    const assetSummary = await preloadAndVerifyExactAssets(state);

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D context is unavailable');
    renderBattleSceneBackdrop(context, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT
    });

    const grid = new BattleGrid(canvas, state.mapWidth, state.mapHeight);
    grid.setAssetLoader(assetLoader);
    applyBattleMapPatch(grid, state);
    grid.render(context);

    const exactMisses = [...assetLoader.failedLookups]
      .filter(key => key.startsWith('v2:') || key.startsWith('connection:'));
    if (exactMisses.length > 0) {
      throw new Error(
        'Production renderer encountered exact V2 asset misses: ' +
        exactMisses.join(', ')
      );
    }

    const result = summarizeMap(
      state,
      request,
      assetSummary,
      Math.round(performance.now() - startedAt)
    );
    window.__battleMapVisualResult = result;
    document.body.dataset.renderedNodeType = request.nodeType;
    document.body.dataset.renderedSeed = String(request.terrainSeed);
    document.body.dataset.status = 'ready';
    details.textContent =
      `${result.mapWidth}×${result.mapHeight} · ${result.palette} palette · ` +
      `attempt ${result.selectedAttempt} · quality ${result.qualityScore}`;
    return result;
  } catch (error) {
    const message = error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
      : String(error);
    document.body.dataset.status = 'error';
    errorOutput.textContent = message;
    window.__battleMapVisualResult = { error: message };
    throw error;
  }
}

window.renderBattleMapVisual = renderBattleMapVisual;
window.__battleMapVisualHarness = Object.freeze({
  nodeTypes: [...V2_PRODUCTION_NODE_TYPES],
  seeds: [0, 997],
  v3ArtifactQuery: 'artifact=/assets/battle-map-v3/<tracked-map>.json',
  v3CombatOverlayQuery:
    'artifact=/assets/battle-map-v3/<tracked-map>.json&combat=1'
});

const query = new URLSearchParams(window.location.search);
if (query.get('autorun') !== '0') {
  renderBattleMapVisual({
    artifactUrl: query.get('artifact') ?? undefined,
    combatOverlay: query.get('combat') === '1',
    nodeType: query.get('nodeType') ?? undefined,
    terrainSeed: query.get('seed') ?? undefined,
    mapWidth: query.get('width') ?? undefined,
    mapHeight: query.get('height') ?? undefined,
    mode: query.get('mode') ?? undefined
  }).catch(() => {});
}
