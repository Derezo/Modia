import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { devicePixelRatio: 1, caches: {} };

const { AssetLoader } = await import('../../core/AssetLoader.js');
const { BattleGrid } = await import('../BattleGrid.js');
const {
  collectBattleMapAssetManifest
} = await import('../BattleMapAssets.js');

function createRecordingContext() {
  const operations = [];
  return {
    operations,
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    save() { operations.push(['save']); },
    restore() { operations.push(['restore']); },
    beginPath() { operations.push(['beginPath']); },
    closePath() { operations.push(['closePath']); },
    moveTo(...args) { operations.push(['moveTo', ...args]); },
    lineTo(...args) { operations.push(['lineTo', ...args]); },
    rect(...args) { operations.push(['rect', ...args]); },
    arc(...args) { operations.push(['arc', ...args]); },
    fill() { operations.push(['fill']); },
    stroke() { operations.push(['stroke']); },
    drawImage(...args) { operations.push(['drawImage', ...args]); }
  };
}

describe('BattleMap visual asset integration', () => {
  it('preloads and renders the final V2 obstacle records with exact assets', async () => {
    const obstacle = {
      id: 'obstacle:rock:2:1',
      x: 2,
      y: 1,
      kind: 'rock',
      assetKey: 'forest:obstacle-family:rock',
      blocking: true
    };
    const transition = {
      id: 'transition:shore:2:1',
      x: 2,
      y: 1,
      kind: 'shore',
      assetKey: 'forest:transition:shore',
      anchor: 'tile_top',
      stratum: 20,
      precedence: 10,
      directionMask: 1
    };
    const decoration = {
      id: 'decoration:ground-cover:2:1',
      x: 2,
      y: 1,
      kind: 'ground-cover',
      assetKey: 'forest:decoration-family:ground-cover',
      anchor: 'below_prop',
      stratum: 0,
      precedence: 0,
      variantIndex: 2
    };
    const state = {
      battleMapSchemaVersion: 2,
      obstacles: [obstacle],
      transitions: [transition],
      decorations: [decoration]
    };

    const manifest = collectBattleMapAssetManifest(state);
    assert.deepEqual(manifest, [obstacle, transition, decoration]);

    const loader = new AssetLoader();
    const loadedPaths = [];
    loader.loadImage = async resourcePath => {
      loadedPaths.push(resourcePath);
      const image = {
        id: resourcePath,
        width: 48,
        height: 48
      };
      loader.cache.set(resourcePath, image);
      return image;
    };
    await loader.preloadObstacles({ obstacles: manifest });

    assert.equal(loadedPaths.length, 1);
    assert.match(loadedPaths[0], /^\/assets\/obstacles\/rocks\/.+\.webp$/);

    const grid = new BattleGrid({ width: 320, height: 240 }, 3, 2);
    grid.nodeType = 'forest';
    grid.setAssetLoader(loader);
    grid.setTerrain([
      ['dirt', 'dirt', 'dirt'],
      ['dirt', 'dirt', 'dirt']
    ]);
    grid.setElevation([
      [0, 0, 0],
      [0, 0, 0]
    ], 'discrete');
    grid.setTileVariants([
      { id: 'variant:0:0', x: 0, y: 0, variantIndex: 0 }
    ]);
    grid.setObstacles(state.obstacles);
    grid.setTransitions(state.transitions);
    grid.setDecorations(state.decorations);

    const composition = [];
    const renderTransition = grid.renderCodeNativeTransition.bind(grid);
    grid.renderCodeNativeTransition = (...args) => {
      composition.push(`transition:${args[3].id}`);
      return renderTransition(...args);
    };
    const renderDecoration = grid.renderCodeNativeDecoration.bind(grid);
    grid.renderCodeNativeDecoration = (...args) => {
      composition.push(`decoration:${args[3].id}`);
      return renderDecoration(...args);
    };
    const renderObstacle = grid.renderObstacleAt.bind(grid);
    grid.renderObstacleAt = (...args) => {
      composition.push(`obstacle:${args[3].id}`);
      return renderObstacle(...args);
    };

    const ctx = createRecordingContext();
    grid.render(ctx);

    assert.deepEqual(composition, [
      `transition:${transition.id}`,
      `decoration:${decoration.id}`,
      `obstacle:${obstacle.id}`
    ]);
    assert.ok(ctx.operations.some(
      ([operation, image]) =>
        operation === 'drawImage' && image.id === loadedPaths[0]
    ));
  });

  it('flattens a hydrated row-major V2 obstacle grid for preloading', () => {
    const obstacle = {
      id: 'obstacle:rock:2:1',
      x: 2,
      y: 1,
      kind: 'rock',
      assetKey: 'forest:obstacle-family:rock',
      blocking: true
    };

    assert.deepEqual(collectBattleMapAssetManifest({
      battleMapSchemaVersion: 2,
      obstacles: [
        [null, null, null],
        [null, null, obstacle]
      ],
      transitions: [],
      decorations: []
    }), [obstacle]);
  });

  it('keeps the legacy manifest deduplication and generic fallback', () => {
    const tree = { type: 'trees', variant: 'oak_tree' };
    const manifest = collectBattleMapAssetManifest(
      { battleMapSchemaVersion: 1 },
      { obstacles: [[tree, null], [{ ...tree }, null]] }
    );
    assert.deepEqual(manifest, [tree]);

    const grid = new BattleGrid({ width: 160, height: 120 }, 1, 1);
    grid.setAssetLoader({ getObstacle: () => null });
    const ctx = createRecordingContext();
    grid.renderObstacleAt(ctx, 32, 32, tree);

    assert.ok(ctx.operations.some(([operation]) => operation === 'fill'));
  });

  it('fails closed when an exact V2 obstacle sprite is unavailable', () => {
    const grid = new BattleGrid({ width: 160, height: 120 }, 1, 1);
    grid.nodeType = 'forest';
    grid.setTileVariants([
      { id: 'variant:0:0', x: 0, y: 0, variantIndex: 0 }
    ]);
    grid.setAssetLoader({
      getBattleMapV2Asset: () => null,
      getObstacle: () => {
        throw new Error('V2 must not use the legacy obstacle fallback');
      }
    });
    const ctx = createRecordingContext();

    grid.renderObstacleAt(ctx, 32, 32, {
      id: 'obstacle:rock:0:0',
      type: 'rock',
      assetKey: 'forest:obstacle-family:rock'
    });

    assert.deepEqual(ctx.operations, []);
  });
});
