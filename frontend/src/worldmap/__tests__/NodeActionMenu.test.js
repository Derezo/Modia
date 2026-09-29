import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@shared/')) {
      return {
        url: new URL(`../../../../shared/${specifier.slice('@shared/'.length)}`, import.meta.url).href,
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  }
});

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

describe('NodeActionMenu shrine actions', () => {
  it('shows a shrine blessing as the primary action', () => {
    const menu = createMenu();

    menu.rebuildActions({
      id: 84,
      node_type: 'shrine',
      features: []
    });

    const button = menu.actionsInner.querySelector('[data-action="visit_shrine"]');
    assert.ok(button);
    assert.equal(button.classList.contains('node-action-menu__button--primary'), true);
    assert.equal(button.disabled, false);
    assert.equal(
      button.querySelector('[data-action-label="visit_shrine"]').textContent,
      'Receive Blessing'
    );
  });

  it('communicates pending state and prevents another activation', () => {
    const menu = createMenu();
    menu.rebuildActions({
      id: 84,
      node_type: 'shrine',
      features: []
    });

    menu.setActionPending('visit_shrine', true);

    const button = menu.actionsInner.querySelector('[data-action="visit_shrine"]');
    assert.equal(button.disabled, true);
    assert.equal(button.classList.contains('node-action-menu__button--pending'), true);
    assert.equal(
      button.querySelector('[data-action-label="visit_shrine"]').textContent,
      'Receiving…'
    );
  });

  it('keeps the action visible and intelligible during snake-case cooldown state', () => {
    const menu = createMenu();
    const cooldownUntil = Date.now() + (2 * 60 * 60 * 1000) + (15 * 60 * 1000);

    menu.rebuildActions({
      id: 84,
      node_type: 'shrine',
      shrine_cooldown_until: new Date(cooldownUntil).toISOString(),
      features: []
    });

    const button = menu.actionsInner.querySelector('[data-action="visit_shrine"]');
    assert.ok(button);
    assert.equal(button.disabled, true);
    assert.equal(button.classList.contains('node-action-menu__button--cooldown'), true);
    assert.match(
      button.querySelector('[data-action-label="visit_shrine"]').textContent,
      /^Ready in 2h 1[45]m$/
    );
  });

  it('accepts camel-case cooldown state and restores the ready action after expiry', () => {
    const menu = createMenu();

    menu.rebuildActions({
      id: 84,
      node_type: 'shrine',
      shrineCooldownUntil: new Date(Date.now() + 60000).toISOString(),
      features: []
    });

    const button = menu.actionsInner.querySelector('[data-action="visit_shrine"]');
    assert.equal(button.disabled, true);

    menu.updateShrineActionState(button, Date.now() + 120000);

    assert.equal(button.disabled, false);
    assert.equal(button.classList.contains('node-action-menu__button--cooldown'), false);
    assert.equal(
      button.querySelector('[data-action-label="visit_shrine"]').textContent,
      'Receive Blessing'
    );
  });
});

function renderedActions(menu) {
  return menu.actionsInner.children.map(child => child.dataset.action);
}

describe('NodeActionMenu settlement features', () => {
  const CASTLE_FEATURES = [
    'coliseum', 'tavern', 'courtyard', 'throne', 'blacksmith',
    'apothecary', 'temple', 'stables', 'marketplace', 'garrison'
  ];

  it('shows every handled castle feature, including Fast Travel, Courtyard and Rest', () => {
    const menu = createMenu();
    menu.rebuildActions({ id: 1, node_type: 'castle', features: CASTLE_FEATURES });

    const actions = renderedActions(menu);
    for (const feature of [
      'garrison', 'blacksmith', 'marketplace', 'tavern', 'apothecary',
      'coliseum', 'courtyard', 'fast_travel', 'stamina_restore'
    ]) {
      assert.ok(actions.includes(feature), `castle menu is missing ${feature}`);
    }
    for (const dead of ['throne', 'temple', 'stables']) {
      assert.equal(actions.includes(dead), false, `castle menu shows unhandled ${dead}`);
    }
    assert.equal(new Set(actions).size, actions.length, 'no duplicate buttons');
  });

  it('never renders unhandled palace features as Coming Soon buttons', () => {
    const menu = createMenu();
    menu.rebuildActions({
      id: 2,
      node_type: 'palace',
      features: ['throne_room', 'treasury', 'royal_guard']
    });

    assert.deepEqual(renderedActions(menu), ['fast_travel', 'stamina_restore']);
  });

  it('maps city stables to Fast Travel and drops temple', () => {
    const menu = createMenu();
    menu.rebuildActions({ id: 3, node_type: 'city', features: ['tavern', 'stables', 'temple'] });

    assert.deepEqual(renderedActions(menu), ['tavern', 'fast_travel', 'stamina_restore']);
  });

  it('offers Rest at every settlement type the stamina route accepts, and not elsewhere', () => {
    const menu = createMenu();
    for (const nodeType of ['castle', 'city', 'village', 'keep', 'palace']) {
      menu.rebuildActions({ id: 4, node_type: nodeType, features: [] });
      assert.ok(
        renderedActions(menu).includes('stamina_restore'),
        `${nodeType} should offer Rest`
      );
    }
    for (const nodeType of ['forest', 'town', 'fishing_spot', 'guild']) {
      menu.rebuildActions({ id: 5, node_type: nodeType, features: [] });
      assert.equal(
        renderedActions(menu).includes('stamina_restore'),
        false,
        `${nodeType} should not offer Rest`
      );
    }
  });
});
