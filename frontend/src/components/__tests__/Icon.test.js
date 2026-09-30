import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const noop = () => {};
globalThis.window ??= {
  innerWidth: 1280,
  innerHeight: 720,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
  addEventListener: noop,
  removeEventListener: noop
};
globalThis.document ??= {
  createElement: () => {
    // escapeHtml serializes textContent through innerHTML, which encodes & < > only
    let text = '';
    return {
      style: { setProperty: noop },
      classList: { add: noop, remove: noop, toggle: noop },
      appendChild: noop,
      setAttribute: noop,
      set textContent(value) { text = String(value); },
      get textContent() { return text; },
      get innerHTML() { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    };
  },
  getElementById: () => null,
  head: { appendChild: noop },
  documentElement: { style: { setProperty: noop }, classList: { add: noop, remove: noop, toggle: noop } },
  body: { classList: { add: noop, remove: noop, toggle: noop } }
};

const { Icon, iconPlaceholderGlyph } = await import('../Icon.js');

describe('Icon missing-image fallback', () => {
  it('marks icon images for the CSP-safe fallback handler with a placeholder sibling', () => {
    const html = Icon.html('menu', 'formation', { size: 'md' });
    assert.match(html, /<img[^>]*data-image-fallback/);
    assert.doesNotMatch(html, /onerror/i);
    // The placeholder must be the image's next element sibling (showImageFallback contract)
    assert.match(html, /data-fallback-display="inline-flex">\s*<span class="modia-icon__placeholder"[^>]*display: none/);
  });

  it('renders a visible placeholder and no <img> when there is no icon name', () => {
    const html = Icon.html('menu', '', { size: 'md' });
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /modia-icon__placeholder[^>]*display: inline-flex/);
  });

  it('uses the first letter of the icon name as the placeholder glyph', () => {
    assert.equal(iconPlaceholderGlyph('formation'), 'F');
    assert.equal(iconPlaceholderGlyph('_hp_potion'), 'H');
    assert.equal(iconPlaceholderGlyph(''), '•');
  });
});

describe('Icon attribute escaping', () => {
  it('encodes quotes in data-derived title text so it cannot add attributes', () => {
    const html = Icon.html('augments', 'fire', { title: 'Blaze" onmouseover="alert(1)' });
    assert.doesNotMatch(html, /onmouseover="/);
    assert.match(html, /title="Blaze&quot; onmouseover=&quot;alert\(1\)"/);
  });

  it('encodes single quotes and angle brackets in the title', () => {
    const html = Icon.html('augments', 'fire', { title: "it's <b>" });
    assert.match(html, /title="it&#39;s &lt;b&gt;"/);
  });
});
