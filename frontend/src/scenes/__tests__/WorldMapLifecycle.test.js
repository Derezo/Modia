import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server;
let exitWorldMap;
let renderWorldMap;
let WorldMapScene;

before(async () => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { maxTouchPoints: 0 }
  });
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.document = {
    createElement: () => ({
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild() {},
      addEventListener() {},
      remove() {}
    }),
    getElementById: () => null,
    head: { appendChild() {} },
    body: { appendChild() {} }
  };

  server = await createServer({
    configFile: './vite.config.js',
    server: { middlewareMode: true },
    appType: 'custom'
  });

  const sceneModule = await server.ssrLoadModule('/src/scenes/WorldMapScene.js');
  exitWorldMap = sceneModule.WorldMapScene.prototype.exit;
  renderWorldMap = sceneModule.WorldMapScene.prototype.render;
  WorldMapScene = sceneModule.WorldMapScene;
});

after(async () => {
  await server?.close();
});

describe('WorldMapScene lifecycle', () => {
  it('does not render the previous minimap while reused scene data is loading', () => {
    let staleMinimapRenderCount = 0;
    const scene = {
      minimap: {
        render() {
          staleMinimapRenderCount += 1;
        }
      },
      pathSystem: {
        destroy() {},
        hasPathPreview: () => false,
        isNodeReachable: () => false
      },
      inputHandler: { destroy() {} },
      cleanupWebSocketHandlers() {},
      profileDropdown: null,
      hudPanel: null,
      partyInviteModal: null,
      nodeActionMenu: null,
      nodeHoverTooltip: null,
      questMarkerManager: null,
      questProgressHUD: null,
      fogOverlay: null,
      hudCanvas: null,
      responsiveUnsubscribe: null,
      uiElement: null,
      nodes: Array.from({ length: 88 }, (_, index) => ({
        id: index + 1,
        x_coord: 0,
        y_coord: 0
      })),
      connections: [],
      obstacles: [],
      regions: [],
      showRegionBoundaries: false,
      watchtowerView: null,
      currentNode: null,
      hoveredNode: null,
      mapCharacter: null,
      cameraX: 0,
      cameraY: 0,
      nodeSpacing: 60,
      game: { targetWidth: 1280, targetHeight: 720 },
      connectionRenderer: {
        renderWatchtowerConnections() {},
        renderConnections() {},
        renderLockedPaths() {}
      },
      questMarkerRenderer: { render() {} },
      nodeRenderer: { renderNode() {} }
    };

    exitWorldMap.call(scene);

    // Re-entry replaces effects synchronously, then awaits initialization and
    // world data. SceneManager may render during that pending load.
    scene.effects = {
      discoveredNodes: new Set(),
      visitedNodes: new Set(),
      renderBackdrop() {}
    };
    renderWorldMap.call(scene, { save() {}, restore() {} });

    assert.equal(scene.minimap, null);
    assert.equal(staleMinimapRenderCount, 0);
  });

  it('opts into the fluid viewport and hands the canvas back to 800x600 on exit', () => {
    const calls = [];
    const game = {
      targetWidth: 1298,
      targetHeight: 600,
      applyViewport(scene, options) {
        calls.push({ scene, options });
      }
    };
    const scene = new WorldMapScene(game);
    assert.equal(scene.fluidViewport, true);

    exitWorldMap.call(scene);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].scene, null, 'exit restores the fixed viewport for the next scene');
    assert.deepEqual(calls[0].options, { notify: false });
    assert.equal(scene._viewportSize, null);
  });

  it('keeps the same world point centred when the logical viewport changes size', () => {
    const fogCalls = [];
    const scene = {
      game: { targetWidth: 960, targetHeight: 600 },
      _viewportSize: { width: 800, height: 600 },
      cameraX: -100,
      cameraY: 50,
      fogOverlay: {
        setCanvasDimensions(width, height) { fogCalls.push(['dims', width, height]); },
        updateOverlayPosition() { fogCalls.push(['position']); }
      },
      hudRepositioned: 0,
      updateHUDCanvasPosition() { this.hudRepositioned += 1; }
    };

    WorldMapScene.prototype.onResize.call(scene);

    // Centre moved from x=400 to x=480: camera shifts by half the growth.
    assert.equal(scene.cameraX, -20);
    assert.equal(scene.cameraY, 50);
    assert.deepEqual(scene._viewportSize, { width: 960, height: 600 });
    assert.deepEqual(fogCalls, [['dims', 960, 600], ['position']]);
    assert.equal(scene.hudRepositioned, 1);

    // Same size again: no drift.
    WorldMapScene.prototype.onResize.call(scene);
    assert.equal(scene.cameraX, -20);
  });
});
