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

  contains(value) {
    return this.values.has(value);
  }
}

class FakeStyle {
  setProperty(name, value) {
    this[name] = value;
  }
}

class FakeElement {
  constructor(tagName, isFragment = false) {
    this.tagName = tagName.toUpperCase();
    this.isFragment = isFragment;
    this.children = [];
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this.style = new FakeStyle();
    this._textContent = '';
    this._innerHTML = null;
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
    if (this._innerHTML !== null) return this._innerHTML;
    return this._textContent
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  set textContent(value) {
    this._textContent = String(value);
    this._innerHTML = null;
  }

  get textContent() {
    return this._textContent;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child) {
    if (child.isFragment) {
      child.children.forEach(fragmentChild => this.appendChild(fragmentChild));
      return child;
    }

    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    this.children = this.children.filter(candidate => candidate !== child);
    child.parentNode = null;
    return child;
  }

  addEventListener() {}

  matches(selector) {
    if (selector.startsWith('.')) {
      return this.classList.contains(selector.slice(1));
    }

    if (selector.startsWith('#')) {
      return this.id === selector.slice(1);
    }

    const attributeMatch = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attributeMatch) {
      const [, name, value] = attributeMatch;
      return this.attributes.has(name)
        && (value === undefined || this.getAttribute(name) === value);
    }

    return this.tagName === selector.toUpperCase();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.matches(selector)) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}

let ZodiacCrystalDetailModal;
let injectedStyle;

before(async () => {
  const elementsById = new Map();
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { maxTouchPoints: 0 }
  });
  globalThis.window = {
    innerWidth: 1280,
    matchMedia() {
      return { matches: false };
    },
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.document = {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    createDocumentFragment() {
      return new FakeElement('#fragment', true);
    },
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    addEventListener() {},
    head: {
      appendChild(element) {
        if (element.id) elementsById.set(element.id, element);
        injectedStyle = element;
        return element;
      }
    }
  };

  ({ ZodiacCrystalDetailModal } = await import('../ZodiacCrystalDetailModal.js'));
});

function renderModal(crystal, sign = 'aries') {
  const modal = new ZodiacCrystalDetailModal({
    game: { uiOverlay: new FakeElement('div') },
    sign,
    crystal,
    onClose() {}
  });
  modal.abortController = new AbortController();
  modal.createElement();
  return modal;
}

describe('ZodiacCrystalDetailModal artwork', () => {
  it('renders the canonical collected artwork with accessible decorative treatment', () => {
    const modal = renderModal({
      collected: true,
      collectedAt: '2026-01-15T12:00:00.000Z',
      shrineName: 'Sunspire Sanctum'
    });

    const image = modal.element.querySelector('.zodiac-detail-orb-image');
    assert.equal(image.src, '/assets/icons/png/256/zodiac/aries.webp');
    assert.equal(image.alt, 'Aries Crystal');
    assert.equal(image.classList.contains('zodiac-detail-orb-image--collected'), true);

    const decoration = modal.element.querySelector('.zodiac-detail-decoration');
    assert.ok(decoration);
    assert.equal(decoration.getAttribute('aria-hidden'), 'true');
    assert.equal(decoration.querySelectorAll('.zodiac-detail-sparkle').length, 4);
    assert.equal(
      modal.element.querySelector('.zodiac-detail-ambient-glow').getAttribute('aria-hidden'),
      'true'
    );

    const collectionInfo = modal.element.querySelector('.zodiac-detail-collected');
    assert.match(collectionInfo.innerHTML, /Jan 15, 2026/);
    assert.match(collectionInfo.innerHTML, /Sunspire Sanctum/);
    assert.doesNotMatch(collectionInfo.innerHTML, /Unknown date/);
  });

  it('renders the canonical locked artwork without collected decoration', () => {
    const modal = renderModal({ collected: false }, 'pisces');

    const image = modal.element.querySelector('.zodiac-detail-orb-image');
    assert.equal(image.src, '/assets/icons/png/256/zodiac/pisces_locked.webp');
    assert.equal(image.alt, 'Pisces Crystal (Locked)');
    assert.equal(modal.element.querySelector('.zodiac-detail-decoration'), null);
  });

  it('retains snake-case collection metadata compatibility', () => {
    const modal = renderModal({
      collected: true,
      collected_at: '2025-06-10T12:00:00.000Z',
      shrine_name: 'Moonpool Shrine'
    }, 'cancer');
    const collectionInfo = modal.element.querySelector('.zodiac-detail-collected');

    assert.match(collectionInfo.innerHTML, /Jun 10, 2025/);
    assert.match(collectionInfo.innerHTML, /Moonpool Shrine/);
  });
});

describe('ZodiacCrystalDetailModal accessibility and motion', () => {
  it('exposes dialog semantics, a labelled title, and an accessible close button', () => {
    const modal = renderModal({ collected: false }, 'taurus');
    const dialog = modal.element.querySelector('.zodiac-detail-modal');
    const titleId = dialog.getAttribute('aria-labelledby');

    assert.equal(dialog.getAttribute('role'), 'dialog');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
    assert.equal(titleId, 'zodiac-crystal-detail-title-taurus');
    assert.ok(modal.element.querySelector(`#${titleId}`));
    assert.equal(
      modal.element.querySelector('.zodiac-detail-close').getAttribute('aria-label'),
      'Close zodiac crystal details'
    );
  });

  it('keeps decorative layers inert and disables nonessential motion when requested', () => {
    assert.match(
      injectedStyle.textContent,
      /\.zodiac-detail-decoration\s*\{[^}]*pointer-events:\s*none;/s
    );
    assert.match(
      injectedStyle.textContent,
      /@media \(prefers-reduced-motion:\s*reduce\)/
    );
    assert.match(
      injectedStyle.textContent,
      /\.zodiac-detail-ambient-glow,[\s\S]*animation:\s*none;/
    );
    assert.match(
      injectedStyle.textContent,
      /\.zodiac-detail-orb-image\s*\{[^}]*z-index:\s*2;[\s\S]*\.zodiac-detail-decoration\s*\{[^}]*z-index:\s*3;/s
    );
    assert.match(
      injectedStyle.textContent,
      /@media \(max-width:\s*480px\)[\s\S]*\.zodiac-detail-orb-container\s*\{[^}]*width:\s*200px;[^}]*height:\s*200px;[\s\S]*\.zodiac-detail-orb-image\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s
    );
  });
});
