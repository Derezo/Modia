import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
  innerWidth: 390,
  innerHeight: 844,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: true }; }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { maxTouchPoints: 1, vibrate() {} }
});
globalThis.document = {
  createElement() { return { id: '', textContent: '' }; },
  head: { appendChild() {} }
};

const { BattleInputHandler } = await import('../BattleInputHandler.js');

function createHarness(candidateTiles = [{ x: 2, y: 3, elevation: 0 }]) {
  const calls = {
    panStarts: [],
    panUpdates: [],
    panEnds: 0,
    tileClicks: [],
    outroConfirms: 0
  };
  const tile = candidateTiles[0];
  const camera = {
    isPanning: false,
    startPan(x, y) {
      this.isPanning = true;
      calls.panStarts.push({ x, y });
    },
    updatePan(x, y) { calls.panUpdates.push({ x, y }); },
    endPan() {
      this.isPanning = false;
      calls.panEnds++;
    },
    getPanDistance() { return 0; }
  };
  const scene = {
    camera,
    currentAction: null,
    hoveredTile: null,
    lockedTarget: null,
    isPvP: false,
    units: new Map(),
    grid: {
      getTileAtScreen(_x, _y, _camera, includeCandidates = false) {
        return includeCandidates ? candidateTiles : tile;
      }
    },
    ui: {
      hideTargetInfo() {},
      hideDamagePreview() {},
      showTargetInfo() {}
    },
    getUnitAt() { return null; },
    updateDamagePreview() {},
    handleTileClick(x, y, mousePos) {
      calls.tileClicks.push({ x, y, mousePos });
    }
  };
  scene.game = {
    canvas: {
      width: 800,
      height: 600,
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 400, height: 300 };
      }
    },
    input: {
      getCanvasCoords(clientX, clientY) {
        return { x: clientX * 2, y: clientY * 2 };
      },
      getPointerPosition() { return { x: 0, y: 0 }; },
      getPinchState() {
        return { active: false, distance: 0, distanceDelta: 0 };
      }
    }
  };

  return { handler: new BattleInputHandler(scene), scene, calls };
}

function touchEvent(type, clientX, clientY) {
  const touch = { clientX, clientY };
  return {
    type,
    defaultPrevented: false,
    touches: type === 'touchend' ? [] : [touch],
    changedTouches: type === 'touchend' ? [touch] : [],
    preventDefault() { this.defaultPrevented = true; }
  };
}

describe('BattleInputHandler touch gestures', () => {
  it('routes a tap through canvas scaling and the normal tile-click path', () => {
    const { handler, calls } = createHarness();
    const start = touchEvent('touchstart', 50, 75);
    const end = touchEvent('touchend', 50, 75);

    handler.handleTouchStart(start);
    handler.handleTouchEnd(end);

    assert.equal(start.defaultPrevented, true);
    assert.deepEqual(calls.panStarts, [{ x: 100, y: 150 }]);
    assert.equal(calls.panEnds, 1);
    assert.deepEqual(calls.tileClicks, [{
      x: 2,
      y: 3,
      mousePos: { mouseX: 50, mouseY: 75 }
    }]);
  });

  it('pans after crossing touch slop and does not turn the drag into a tap', () => {
    const { handler, calls } = createHarness();

    handler.handleTouchStart(touchEvent('touchstart', 50, 75));
    handler.handleTouchMove(touchEvent('touchmove', 80, 95));
    handler.handleTouchEnd(touchEvent('touchend', 80, 95));

    assert.deepEqual(calls.panUpdates, [{ x: 160, y: 190 }]);
    assert.equal(calls.panEnds, 1);
    assert.deepEqual(calls.tileClicks, []);
  });

  it('keeps ordinary phone-scale finger jitter inside the physical touch slop', () => {
    const { handler, calls } = createHarness();

    handler.handleTouchStart(touchEvent('touchstart', 50, 75));
    // Six CSS pixels becomes twelve logical canvas pixels at this 2x scale;
    // it must remain a tap instead of turning into a pan.
    handler.handleTouchMove(touchEvent('touchmove', 56, 75));
    handler.handleTouchEnd(touchEvent('touchend', 56, 75));

    assert.deepEqual(calls.panUpdates, []);
    assert.equal(calls.tileClicks.length, 1);
  });

  it('suppresses taps for a gesture that becomes multi-touch', () => {
    const { handler, calls } = createHarness();
    handler.handleTouchStart(touchEvent('touchstart', 50, 75));
    handler.handleTouchStart({
      touches: [
        { clientX: 50, clientY: 75 },
        { clientX: 100, clientY: 75 }
      ],
      preventDefault() {}
    });
    handler.handleTouchEnd(touchEvent('touchend', 50, 75));

    assert.deepEqual(calls.tileClicks, []);
  });

  it('taps the currently cycled overlapping candidate', () => {
    const candidates = [
      { x: 2, y: 3, elevation: 2 },
      { x: 1, y: 2, elevation: 0 }
    ];
    const { handler, calls } = createHarness(candidates);

    handler.handleTouchStart(touchEvent('touchstart', 50, 75));
    handler.touchLongPressTriggered = true;
    handler.cycleTileManual();
    handler.handleTouchEnd(touchEvent('touchend', 50, 75));

    handler.handleTouchStart(touchEvent('touchstart', 50, 75));
    handler.handleTouchEnd(touchEvent('touchend', 50, 75));

    assert.equal(calls.tileClicks.length, 1);
    assert.deepEqual(calls.tileClicks[0], {
      x: 1,
      y: 2,
      mousePos: { mouseX: 50, mouseY: 75 }
    });
  });
});

describe('BattleInputHandler outro keyboard controls', () => {
  for (const code of ['Enter', 'Space']) {
    it(`confirms the modal battle outro with ${code}`, () => {
      const { handler, scene, calls } = createHarness();
      scene.outroSequence = {
        handleConfirm() {
          calls.outroConfirms++;
          return true;
        }
      };
      const event = {
        code,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }
      };

      handler.handleKeydown(event);

      assert.equal(calls.outroConfirms, 1);
      assert.equal(event.defaultPrevented, true);
    });
  }
});

describe('BattleInputHandler mouse tile cycling', () => {
  it('clears hover and candidates when a queued pointer event sees no grid', () => {
    const { handler, scene } = createHarness();
    handler.tileCandidates = [{ x: 2, y: 3 }];
    handler.tileCycleIndex = 1;
    handler.tileCycleTimer = 500;
    handler.tileCyclePaused = true;
    scene.hoveredTile = { x: 2, y: 3 };
    scene.grid = null;

    assert.doesNotThrow(() => {
      handler.updatePointerInteraction({ x: 0, y: 0 });
    });
    assert.deepEqual(handler.tileCandidates, []);
    assert.equal(handler.tileCycleIndex, 0);
    assert.equal(handler.tileCycleTimer, 0);
    assert.equal(handler.tileCyclePaused, false);
    assert.equal(scene.hoveredTile, null);
  });

  it('does not resolve a cycled tile after the grid is torn down', () => {
    const { handler, scene } = createHarness();
    handler.tileCandidates = [{ x: 2, y: 3 }];
    scene.hoveredTile = { x: 2, y: 3 };
    scene.grid = null;

    assert.equal(handler.getCycledTileAtPosition({ x: 0, y: 0 }), null);
    assert.deepEqual(handler.tileCandidates, []);
    assert.equal(scene.hoveredTile, null);
  });

  it('clicks the currently cycled overlapping candidate', () => {
    const candidates = [
      { x: 2, y: 3, elevation: 2 },
      { x: 1, y: 2, elevation: 0 }
    ];
    const { handler, calls } = createHarness(candidates);

    handler.updatePointerInteraction({ x: 0, y: 0 });
    handler.cycleTileManual();
    handler.handleMouseUp({ clientX: 10, clientY: 20 });

    assert.deepEqual(calls.tileClicks, [{
      x: 1,
      y: 2,
      mousePos: { mouseX: 10, mouseY: 20 }
    }]);
  });

  it('does not start a pan or select a tile for the secondary button', () => {
    const { handler, calls } = createHarness();

    handler.handleMouseDown({ button: 2 });
    handler.handleMouseUp({ button: 2, clientX: 10, clientY: 20 });

    assert.deepEqual(calls.panStarts, []);
    assert.deepEqual(calls.tileClicks, []);
  });
});
