import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach(value => this.values.add(value));
  }

  remove(...values) {
    values.forEach(value => this.values.delete(value));
  }

  toggle(value, force) {
    if (force === true) this.values.add(value);
    else if (force === false) this.values.delete(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.classList = new FakeClassList();
    this.style = {};
    this.textContent = '';
    this.disabled = false;
    this.listeners = new Map();
    this._innerHTML = '';
  }

  set className(value) {
    this.classList = new FakeClassList();
    value.split(/\s+/).filter(Boolean).forEach(name => this.classList.add(name));
  }

  get className() {
    return [...this.classList.values].join(' ');
  }

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  querySelector(selector) {
    const match = selector.match(/^\[data-([a-z-]+)="([^"]+)"\]$/);
    if (!match) return null;
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = match[2];

    for (const child of this.children) {
      if (child.dataset?.[key] === value) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  }

  getBoundingClientRect() {
    return { left: 100, right: 200 };
  }
}

let NodeActionMenu;

before(async () => {
  const elementsById = new Map();
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
    createElement: tagName => new FakeElement(tagName),
    getElementById: id => elementsById.get(id) || null,
    head: {
      appendChild(element) {
        if (element.id) elementsById.set(element.id, element);
        return element;
      }
    }
  };

  ({ NodeActionMenu } = await import('../NodeActionMenu.js'));
});

function createMenu(onAction = () => {}) {
  return new NodeActionMenu({ game: {}, onAction });
}

describe('NodeActionMenu chest actions', () => {
  it('shows an unclaimed chest as the primary Collect Treasure action', () => {
    const menu = createMenu();

    menu.rebuildActions({
      id: 12,
      node_type: 'chest',
      chest_claimed: false,
      features: []
    });

    const button = menu.actionsInner.querySelector('[data-action="claim_chest"]');
    assert.ok(button);
    assert.equal(button.classList.contains('node-action-menu__button--primary'), true);
    assert.equal(
      button.querySelector('[data-action-label="claim_chest"]').textContent,
      'Collect Treasure'
    );
  });

  it('does not offer a claim for either supported claimed-state field', () => {
    const menu = createMenu();

    for (const claimedState of [{ chest_claimed: true }, { claimed: true }]) {
      menu.rebuildActions({
        id: 12,
        node_type: 'chest',
        features: [],
        ...claimedState
      });

      assert.equal(
        menu.actionsInner.querySelector('[data-action="claim_chest"]'),
        null
      );
    }
  });

  it('disables the claim control and communicates pending state', () => {
    const menu = createMenu();
    menu.rebuildActions({
      id: 12,
      node_type: 'chest',
      chest_claimed: false,
      features: []
    });

    menu.setActionPending('claim_chest', true);

    const button = menu.actionsInner.querySelector('[data-action="claim_chest"]');
    assert.equal(button.disabled, true);
    assert.equal(
      button.querySelector('[data-action-label="claim_chest"]').textContent,
      'Collecting…'
    );
  });
});
