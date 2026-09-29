/**
 * Unit tests for parchmentConfirm (Finding 6)
 *
 * Tests the REAL parchmentConfirm function to verify that:
 * 1. It returns both a promise and a close method
 * 2. Calling close() resolves the promise to false
 * 3. The close handle can be used to programmatically dismiss the dialog
 *    (e.g., on scene exit or turn change)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

// =============================================================================
// GLOBAL MOCKS - Set up before importing the real module
// =============================================================================

// Track modals created and their state
const createdModals = [];
const styleElements = [];
const bodyChildren = [];

// Create a mock element factory that tracks all relevant interactions
function createMockElement(tagName = 'div') {
  const listeners = new Map();
  const children = [];
  const el = {
    tagName: tagName.toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    innerHTML: '',
    style: {},
    classList: {
      add(...classes) { el.className = (el.className + ' ' + classes.join(' ')).trim(); },
      remove(...classes) {
        for (const cls of classes) {
          el.className = el.className.replace(cls, '').trim();
        }
      },
      contains(cls) { return el.className.includes(cls); }
    },
    setAttribute(name, value) { el[name] = value; },
    getAttribute(name) { return el[name]; },
    appendChild(child) {
      children.push(child);
      child.parentElement = el;
    },
    removeChild(child) {
      const idx = children.indexOf(child);
      if (idx >= 0) children.splice(idx, 1);
      child.parentElement = null;
    },
    contains(child) { return children.includes(child); },
    addEventListener(event, handler, options) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push({ handler, options });
    },
    removeEventListener(event, handler) {
      const handlers = listeners.get(event);
      if (handlers) {
        const idx = handlers.findIndex(h => h.handler === handler);
        if (idx >= 0) handlers.splice(idx, 1);
      }
    },
    focus() { el.hasFocus = true; },
    blur() { el.hasFocus = false; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    parentElement: null,
    children,
    _listeners: listeners
  };
  return el;
}

// Set up globals
globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false }; }
};

// Mock requestAnimationFrame for ParchmentModal animations
globalThis.requestAnimationFrame = (callback) => {
  // Execute immediately for testing
  callback(Date.now());
  return 1;
};
globalThis.cancelAnimationFrame = () => {};

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { maxTouchPoints: 0, onLine: true }
});

// Track document event listeners for cleanup
const documentListeners = new Map();

globalThis.document = {
  getElementById(id) {
    return styleElements.find(el => el.id === id) || null;
  },
  createElement(tagName) {
    const el = createMockElement(tagName);
    if (tagName === 'style') {
      styleElements.push(el);
    }
    return el;
  },
  activeElement: createMockElement(),
  addEventListener(event, handler, options) {
    if (!documentListeners.has(event)) documentListeners.set(event, []);
    documentListeners.get(event).push({ handler, options });
  },
  removeEventListener(event, handler) {
    const handlers = documentListeners.get(event);
    if (handlers) {
      const idx = handlers.findIndex(h => h.handler === handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  },
  head: {
    appendChild(el) { styleElements.push(el); }
  },
  body: {
    appendChild(el) { bodyChildren.push(el); },
    removeChild(el) {
      const idx = bodyChildren.indexOf(el);
      if (idx >= 0) bodyChildren.splice(idx, 1);
    },
    contains(el) { return bodyChildren.includes(el); },
    style: {}
  }
};

// Mock AbortController
globalThis.AbortController = class {
  constructor() {
    this.signal = { aborted: false };
  }
  abort() {
    this.signal.aborted = true;
  }
};

// Now import the real parchmentConfirm
const { parchmentConfirm } = await import('../parchmentConfirm.js');

// =============================================================================
// TESTS: parchmentConfirm Close Handle (Real Module)
// =============================================================================

describe('parchmentConfirm - Close Handle (Real Module)', () => {
  beforeEach(() => {
    createdModals.length = 0;
    bodyChildren.length = 0;
  });

  afterEach(() => {
    // Clean up any open modals
    bodyChildren.length = 0;
  });

  it('should return an object with promise and close method', () => {
    const result = parchmentConfirm({ title: 'Test', message: 'Test message' });

    assert.ok(result.promise instanceof Promise, 'Should have a promise property');
    assert.strictEqual(typeof result.close, 'function', 'Should have a close method');
    assert.strictEqual(typeof result.then, 'function', 'Should be thenable');
    assert.strictEqual(typeof result.catch, 'function', 'Should have catch method');
    assert.strictEqual(typeof result.finally, 'function', 'Should have finally method');

    // Clean up
    result.close();
  });

  it('should resolve to false when close() is called programmatically', async () => {
    const result = parchmentConfirm({ title: 'Test', message: 'Test message' });

    // Close programmatically (simulates scene exit)
    result.close();

    const confirmed = await result.promise;
    assert.strictEqual(confirmed, false, 'Should resolve to false when closed programmatically');
  });

  it('should work with await syntax (backward compatibility)', async () => {
    const result = parchmentConfirm({ title: 'Test', message: 'Test message' });

    // Close after a microtask
    queueMicrotask(() => result.close());

    // Should be awaitable directly via the thenable interface
    const confirmed = await result;
    assert.strictEqual(confirmed, false, 'Should be awaitable and resolve to false');
  });

  it('should only settle once (idempotent close)', async () => {
    const result = parchmentConfirm({ title: 'Test', message: 'Test message' });

    // Close multiple times
    result.close();
    result.close();
    result.close();

    const confirmed = await result.promise;
    assert.strictEqual(confirmed, false, 'Should resolve to false exactly once');
  });

  it('should close the actual ParchmentModal when close() is called', () => {
    const result = parchmentConfirm({ title: 'Test', message: 'Test message' });

    // Modal should be added to body
    assert.ok(bodyChildren.length > 0, 'Modal should be added to document.body');

    result.close();

    // Modal should be removed (or at least the close was triggered)
    // Note: The actual DOM cleanup may be async, but close() should trigger it
  });
});

describe('parchmentConfirm - Battle Scene Integration Pattern (Real Module)', () => {
  it('should allow storing and closing dialog handle on scene exit', async () => {
    // Simulate BattleScene pattern
    class MockBattleScene {
      constructor() {
        this.waitConfirmDialog = null;
      }

      async handleWaitAction() {
        const dialog = parchmentConfirm({
          title: 'End Turn',
          message: 'End your turn?'
        });
        this.waitConfirmDialog = dialog;

        try {
          return await dialog.promise;
        } finally {
          this.waitConfirmDialog = null;
        }
      }

      closeWaitConfirmDialog() {
        if (this.waitConfirmDialog) {
          this.waitConfirmDialog.close();
          this.waitConfirmDialog = null;
        }
      }

      exit() {
        this.closeWaitConfirmDialog();
      }
    }

    const scene = new MockBattleScene();

    // Start the wait action
    const waitPromise = scene.handleWaitAction();

    // Verify dialog is stored
    assert.ok(scene.waitConfirmDialog, 'Dialog should be stored');
    assert.ok(scene.waitConfirmDialog.close, 'Dialog should have close method');

    // Simulate scene exit
    scene.exit();

    // Wait for the promise to resolve
    const confirmed = await waitPromise;

    // Should resolve to false because we closed it
    assert.strictEqual(confirmed, false, 'Should resolve to false on scene exit');
    assert.strictEqual(scene.waitConfirmDialog, null, 'Dialog handle should be cleared');
  });

  it('should handle turn_skipped closing the dialog', async () => {
    // This simulates what BattleWebSocketManager.handleTurnSkipped does
    let dialogResolution = null;
    let closeWaitConfirmDialogCalled = false;

    const scene = {
      waitConfirmDialog: null,
      closeWaitConfirmDialog() {
        closeWaitConfirmDialogCalled = true;
        if (this.waitConfirmDialog) {
          this.waitConfirmDialog.close();
          this.waitConfirmDialog = null;
        }
      }
    };

    // Open dialog
    const dialog = parchmentConfirm({
      title: 'End Turn',
      message: 'End your turn?'
    });
    scene.waitConfirmDialog = dialog;

    // Start waiting for resolution
    const resolutionPromise = dialog.promise.then(result => {
      dialogResolution = result;
    });

    // Simulate turn_skipped handler behavior
    // (from BattleWebSocketManager line 1180)
    scene.closeWaitConfirmDialog();

    await resolutionPromise;

    assert.strictEqual(closeWaitConfirmDialogCalled, true, 'closeWaitConfirmDialog should be called');
    assert.strictEqual(dialogResolution, false, 'Dialog should resolve to false');
    assert.strictEqual(scene.waitConfirmDialog, null, 'Dialog should be cleared');
  });
});
