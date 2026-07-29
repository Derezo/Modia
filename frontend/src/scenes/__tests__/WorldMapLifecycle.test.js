import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

let server;
let exitWorldMap;
let renderWorldMap;

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
});
