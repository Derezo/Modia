import {
  V2_PRODUCTION_NODE_TYPES,
  generateBattleMapV2,
  getV2VisualCapabilities
} from '@modia/shared';
import { battleMapV2ToFlatState } from '@modia/shared/battleMap';
import { BattleGrid } from '../battle/BattleGrid.js';
import { collectBattleMapAssetManifest } from '../battle/BattleMapAssets.js';
import { applyBattleMapPatch } from '../battle/mergeBattleState.js';
import { AssetLoader } from '../core/AssetLoader.js';

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
  const nodeType = String(input.nodeType ?? 'forest');
  if (!V2_PRODUCTION_NODE_TYPES.includes(nodeType)) {
    throw new RangeError(`Unknown production node type: ${nodeType}`);
  }

  return Object.freeze({
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

function paintBackground(context) {
  context.save();
  const gradient = context.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  gradient.addColorStop(0, '#172231');
  gradient.addColorStop(0.6, '#101821');
  gradient.addColorStop(1, '#0a1018');
  context.fillStyle = gradient;
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.restore();
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
  title.textContent = `${request.nodeType} · seed ${request.terrainSeed}`;
  details.textContent =
    `${request.mapWidth}×${request.mapHeight} · BattleMapV2 · rendering`;

  try {
    const battleMap = await generateBattleMapV2(request);
    const state = await battleMapV2ToFlatState(battleMap);
    const assetSummary = await preloadAndVerifyExactAssets(state);

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D context is unavailable');
    paintBackground(context);

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
  seeds: [0, 997]
});

const query = new URLSearchParams(window.location.search);
if (query.get('autorun') !== '0') {
  renderBattleMapVisual({
    nodeType: query.get('nodeType') ?? undefined,
    terrainSeed: query.get('seed') ?? undefined,
    mapWidth: query.get('width') ?? undefined,
    mapHeight: query.get('height') ?? undefined,
    mode: query.get('mode') ?? undefined
  }).catch(() => {});
}
