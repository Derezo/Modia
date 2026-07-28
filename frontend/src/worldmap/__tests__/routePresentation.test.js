import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getWorldRouteStyle } from '../PathRenderer.js';
import {
  getRouteDescriptionsForNode,
  hasVisibleCompetingRoutePair,
  WorldMapConnectionRenderer
} from '../WorldMapConnectionRenderer.js';
import {
  findInteractiveNodeAtPosition,
  WorldMapInputHandler
} from '../WorldMapInputHandler.js';

function createMockCanvasContext() {
  let dash = [];
  const stack = [];
  const strokes = [];
  const filledRects = [];
  const ctx = {
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    globalAlpha: 1,
    strokes,
    filledRects,
    save() {
      stack.push({
        dash: [...dash],
        lineWidth: this.lineWidth,
        strokeStyle: this.strokeStyle,
        globalAlpha: this.globalAlpha
      });
    },
    restore() {
      const state = stack.pop();
      if (!state) return;
      dash = state.dash;
      this.lineWidth = state.lineWidth;
      this.strokeStyle = state.strokeStyle;
      this.globalAlpha = state.globalAlpha;
    },
    setLineDash(value) {
      dash = [...value];
    },
    getLineDash() {
      return [...dash];
    },
    stroke() {
      strokes.push({
        color: this.strokeStyle,
        width: this.lineWidth,
        lineDash: [...dash]
      });
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    closePath() {},
    arc() {},
    fill() {},
    fillRect(x, y, width, height) {
      filledRects.push({ x, y, width, height });
    },
    strokeRect() {},
    fillText() {},
    translate() {},
    rotate() {}
  };
  return ctx;
}

function installBrowserGlobals() {
  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.parentNode = null;
      this.style = {};
      this.attributes = new Map();
      this.hidden = false;
      this.offsetHeight = 80;
      this._classNames = new Set();
      this._className = '';
      this._textContent = '';
      this.classList = {
        add: (...names) => names.forEach((name) => this._classNames.add(name)),
        remove: (...names) => names.forEach((name) => this._classNames.delete(name)),
        toggle: (name, force) => {
          const shouldAdd = force ?? !this._classNames.has(name);
          if (shouldAdd) this._classNames.add(name);
          else this._classNames.delete(name);
          return shouldAdd;
        }
      };
    }

    set className(value) {
      this._className = value;
      this._classNames = new Set(value.split(/\s+/).filter(Boolean));
    }

    get className() {
      return this._className;
    }

    set textContent(value) {
      this._textContent = String(value);
    }

    get textContent() {
      return this._textContent;
    }

    set innerHTML(_value) {
      this.children = [];
      this._textContent = '';
    }

    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }

    removeChild(child) {
      this.children = this.children.filter((candidate) => candidate !== child);
      child.parentNode = null;
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }

    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }

    removeAttribute(name) {
      this.attributes.delete(name);
    }

    addEventListener() {}
  }

  const head = new FakeElement('head');
  globalThis.window = {
    innerWidth: 1024,
    addEventListener() {},
    matchMedia: () => ({ matches: false })
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { maxTouchPoints: 0 }
  });
  globalThis.document = {
    head,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById: () => null
  };
}

describe('world route presentation', () => {
  it('distinguishes every route surface without color at supported scales', () => {
    for (const scale of [0.5, 1, 2]) {
      const styles = [
        getWorldRouteStyle('road', 'trade', true, scale),
        getWorldRouteStyle('trail', 'wilderness', true, scale),
        getWorldRouteStyle('bridge', 'trade', true, scale),
        getWorldRouteStyle('tunnel', 'wilderness', true, scale)
      ];
      const nonColorSignatures = styles.map(({ width, lineDash }) =>
        JSON.stringify({ width, lineDash })
      );

      assert.equal(new Set(nonColorSignatures).size, 4);
      assert.deepEqual(styles.map((style) => style.width * scale), [4, 2, 5, 3]);
    }
  });

  it('gives bridge and tunnel segments distinct patterns and widths', () => {
    const bridge = getWorldRouteStyle('bridge');
    const tunnel = getWorldRouteStyle('tunnel');

    assert.notEqual(bridge.width, tunnel.width);
    assert.notDeepEqual(bridge.lineDash, tunnel.lineDash);
  });

  it('preserves special segment styling on lower-risk trade routes', () => {
    const bridge = getWorldRouteStyle('bridge', 'trade');
    const tunnel = getWorldRouteStyle('tunnel', 'trade');
    const road = getWorldRouteStyle('road', 'trade');

    assert.notEqual(bridge.width, road.width);
    assert.notDeepEqual(tunnel.lineDash, road.lineDash);
    assert.match(bridge.label, /Lower-risk combat bridge crossing/);
    assert.match(tunnel.label, /Lower-risk combat tunnel passage/);
  });

  it('keeps route risk and special surface cues independent', () => {
    for (const surface of ['bridge', 'tunnel']) {
      const trade = getWorldRouteStyle(surface, 'trade');
      const wilderness = getWorldRouteStyle(surface, 'wilderness');

      assert.equal(trade.width, wilderness.width);
      assert.notDeepEqual(trade.lineDash, wilderness.lineDash);
      assert.match(trade.label, /Lower-risk combat/);
      assert.match(wilderness.label, /Higher-risk wilderness/);
    }

    const crossProduct = ['road', 'trail', 'bridge', 'tunnel'].flatMap((surface) =>
      ['trade', 'wilderness'].map((risk) => getWorldRouteStyle(surface, risk))
    );
    assert.equal(new Set(crossProduct.map(({ width, lineDash }) =>
      JSON.stringify({ width, lineDash })
    )).size, 8);
  });

  it('uses concise risk language without promising route rewards', () => {
    const descriptions = getRouteDescriptionsForNode([
      {
        from_node_id: 1,
        to_node_id: 2,
        path_type: 'road',
        route_kind: 'trade'
      },
      {
        from_node_id: 1,
        to_node_id: 3,
        path_type: 'trail',
        route_kind: 'wilderness'
      }
    ], 1);

    assert.deepEqual(descriptions, [
      'Lower-risk combat road',
      'Higher-risk wilderness trail'
    ]);
    assert.doesNotMatch(descriptions.join(' '), /safe|reward|loot|value/i);
  });

  it('shows the choice legend only when both discovered alternatives share a pair', () => {
    assert.equal(hasVisibleCompetingRoutePair([
      { route_pair_key: 'pair:1-2', route_kind: 'trade' }
    ]), false);
    assert.equal(hasVisibleCompetingRoutePair([
      { route_pair_key: 'pair:1-2', route_kind: 'trade' },
      { route_pair_key: 'pair:2-3', route_kind: 'wilderness' }
    ]), false);
    assert.equal(hasVisibleCompetingRoutePair([
      { route_pair_key: 'pair:1-2', route_kind: 'trade' },
      { route_pair_key: 'pair:1-2', route_kind: 'wilderness' }
    ]), true);
  });

  it('keeps legend text and layout readable at supported display scales', () => {
    for (const scale of [0.5, 1, 2]) {
      const renderer = new WorldMapConnectionRenderer({
        connections: [
          { route_pair_key: 'pair:1-2', route_kind: 'trade' },
          { route_pair_key: 'pair:1-2', route_kind: 'wilderness' }
        ],
        game: { targetWidth: 800, targetHeight: 600, scale }
      });
      const ctx = createMockCanvasContext();

      renderer.renderRouteLegend(ctx);

      assert.equal(ctx.filledRects[0].width * scale, 228);
      assert.equal(Number.parseFloat(ctx.font) * scale, 12);
    }
  });

  it('applies distinct width and pattern cues in the fallback canvas renderer', () => {
    for (const scale of [0.5, 1, 2]) {
      const pathTypes = ['road', 'trail', 'bridge', 'tunnel'];
      const nodes = pathTypes.flatMap((_pathType, index) => ([
        { id: index * 2 + 1, x_coord: 1, y_coord: index + 1 },
        { id: index * 2 + 2, x_coord: 3, y_coord: index + 1 }
      ]));
      const connections = pathTypes.map((pathType, index) => ({
        from_node_id: index * 2 + 1,
        to_node_id: index * 2 + 2,
        path_type: pathType,
        route_kind: pathType === 'road' ? 'trade' : 'wilderness'
      }));
      const renderer = new WorldMapConnectionRenderer({
        connections,
        nodes,
        nodeSpacing: 60,
        cameraX: 0,
        cameraY: 0,
        effects: null,
        game: { targetWidth: 800, targetHeight: 600, scale },
        pathSystem: { isNodeReachable: () => true }
      });
      const ctx = createMockCanvasContext();

      renderer.renderConnections(ctx);

      const mainStrokes = ctx.strokes.filter(({ color }) =>
        color !== 'rgba(0, 0, 0, 0.3)'
      );
      const signatures = mainStrokes.map(({ width, lineDash }) =>
        JSON.stringify({ width, lineDash })
      );
      assert.equal(mainStrokes.length, 4);
      assert.equal(new Set(signatures).size, 4);
    }
  });
});

describe('world-map landmark layering and interaction', () => {
  it('renders decorative landmarks before routes and interactive nodes', async () => {
    installBrowserGlobals();
    const { WorldMapEffects } = await import('../WorldMapEffects.js');
    const calls = [];
    const effects = Object.create(WorldMapEffects.prototype);
    effects.renderParchmentBackground = () => calls.push('background');
    effects.renderObstacles = () => calls.push('landmarks');
    effects.renderRegionIllustrations = () => calls.push('regions');
    effects.renderHandDrawnPaths = () => calls.push('routes');
    effects.renderNodeMarkers = () => calls.push('nodes');
    effects.renderFogOfWar = () => calls.push('fog');
    effects.renderNodeLabels = () => calls.push('labels');

    effects.render({}, 0, 0, 800, 600, [], [], []);

    assert.ok(calls.indexOf('landmarks') < calls.indexOf('routes'));
    assert.ok(calls.indexOf('routes') < calls.indexOf('nodes'));
  });

  it('keeps route patterns distinct in the organic effects renderer', async () => {
    installBrowserGlobals();
    const { WorldMapEffects } = await import('../WorldMapEffects.js');
    const effects = Object.create(WorldMapEffects.prototype);
    effects.useOrganicPaths = true;

    for (const scale of [0.5, 1, 2]) {
      const signatures = [];
      for (const [index, pathType] of ['road', 'trail', 'bridge', 'tunnel'].entries()) {
        const routeKind = pathType === 'road' ? 'trade' : 'wilderness';
        const style = getWorldRouteStyle(pathType, routeKind, true, scale);
        const ctx = createMockCanvasContext();

        effects.renderTexturedPath(
          ctx, 20, 40 + index * 50, 220, 40 + index * 50,
          pathType, { x: 120, y: 40 + index * 50 },
          index * 2 + 1, index * 2 + 2, routeKind, scale
        );

        const mainStroke = ctx.strokes.find(({ color, width }) =>
          color === style.color && width === style.width
        );
        assert.ok(mainStroke, `${pathType} main stroke should be rendered`);
        signatures.push(JSON.stringify({
          width: mainStroke.width,
          lineDash: mainStroke.lineDash
        }));
      }
      assert.equal(new Set(signatures).size, 4);
    }
  });

  it('does not let a decorative landmark intercept a node click', () => {
    const node = { id: 7, x_coord: 2, y_coord: 3 };
    let traveledTo = null;
    const scene = {
      nodes: [node],
      obstacles: [{ id: 99, x: 2, y: 3, obstacle_type: 'lake' }],
      currentNode: { id: 1 },
      nodeSpacing: 60,
      nodeSize: 30,
      cameraX: 0,
      cameraY: 0,
      pathSystem: { isNodeReachable: () => true },
      game: { input: { getPointerPosition: () => ({ x: 120, y: 180 }) } },
      hudPanel: null,
      minimap: null,
      getNodeAtPosition(screenX, screenY) {
        return findInteractiveNodeAtPosition(this, screenX, screenY);
      },
      travelToNode: (destination) => {
        traveledTo = destination;
      }
    };

    new WorldMapInputHandler(scene).handleClick();

    assert.equal(traveledTo, node);
  });

  it('exposes route risk text through an accessible tooltip', async () => {
    installBrowserGlobals();
    const { NodeHoverTooltip } = await import('../NodeHoverTooltip.js');
    const tooltip = new NodeHoverTooltip({ game: {} });

    assert.equal(tooltip.element.getAttribute('role'), 'tooltip');
    assert.equal(tooltip.element.id, 'world-map-node-tooltip');
    assert.equal(tooltip.element.getAttribute('aria-hidden'), 'true');
    assert.equal(tooltip.routeElement.getAttribute('role'), 'status');
    assert.equal(tooltip.routeElement.getAttribute('aria-live'), 'polite');

    tooltip.show(
      { id: 4, name: 'Pine Pass', node_type: 'forest', visited: true },
      200,
      160,
      {
        isDiscovered: true,
        isVisited: true,
        nodeSize: 30,
        canvasHeight: 600,
        routeDescriptions: ['Higher-risk wilderness trail']
      }
    );

    assert.equal(tooltip.element.getAttribute('aria-hidden'), 'false');
    assert.equal(tooltip.routeElement.hidden, false);
    assert.equal(tooltip.routeElement.textContent, 'Higher-risk wilderness trail');
    assert.doesNotMatch(tooltip.routeElement.textContent, /reward|loot|value/i);

    tooltip.hide();
    assert.equal(tooltip.element.getAttribute('aria-hidden'), 'true');
    tooltip.destroy();
  });

  it('supports keyboard inspection and travel for reachable nodes', () => {
    const nodes = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const inspected = [];
    let traveledTo = null;
    const attributes = new Map();
    const canvas = {
      addEventListener() {},
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: (name) => attributes.delete(name)
    };
    const scene = {
      nodes,
      currentNode: nodes[0],
      hoveredNode: null,
      game: { canvas },
      pathSystem: {
        isNodeReachable: (id) => id !== 3,
        updatePathPreview: (node) => inspected.push(node?.id ?? null)
      },
      updateHoverTooltip: (node) => inspected.push(`tooltip:${node?.id ?? 'none'}`),
      travelToNode: (node) => {
        traveledTo = node;
      }
    };
    const handler = new WorldMapInputHandler(scene);
    const arrowEvent = { key: 'ArrowRight', preventDefault() {} };

    handler.setup();
    assert.equal(canvas.tabIndex, 0);
    assert.equal(canvas.getAttribute('aria-describedby'), 'world-map-node-tooltip');
    handler.handleKeyDown(arrowEvent);
    handler.handleKeyDown({ key: 'Enter', preventDefault() {} });

    assert.equal(scene.hoveredNode, nodes[1]);
    assert.equal(traveledTo, nodes[1]);
    assert.ok(inspected.includes('tooltip:2'));
    handler.destroy();
    assert.equal(canvas.getAttribute('aria-describedby'), null);
  });
});
