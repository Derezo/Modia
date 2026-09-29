/**
 * Trait badge icons: every trait the game can show maps to a painted icon
 * that exists, and the badge no longer renders OS emoji.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

globalThis.window ??= {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false }; }
};
globalThis.document ??= {
  // escapeHtml sets textContent and reads innerHTML back
  createElement: () => {
    let text = '';
    return {
      style: {},
      setAttribute() {},
      appendChild() {},
      set textContent(v) { text = String(v); },
      get textContent() { return text; },
      get innerHTML() { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    };
  },
  head: { appendChild() {} },
  body: { appendChild() {} },
  addEventListener() {},
  getElementById() { return null; },
  querySelector() { return null; }
};
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { maxTouchPoints: 0 } });
}

const { TRAIT_ICONS, DEFAULT_TRAIT_ICON, getTraitIcon, renderTraitIcon } = await import('../traitIcons.js');
const { AUGMENT_ICON_FILES } = await import('../../utils/statDisplay.js');
const { SIZE_PRESETS } = await import('../../../../shared/assetPaths.js');

const repoPath = rel => fileURLToPath(new URL(`../../../../${rel}`, import.meta.url));

/** Trait names seeded by api/src/migrations/012_guild_recruitment.sql. */
function seededTraitNames() {
  const sql = readFileSync(repoPath('api/src/migrations/012_guild_recruitment.sql'), 'utf8');
  const names = [];
  for (const block of sql.split('INSERT INTO traits').slice(1)) {
    for (const m of block.split('ON CONFLICT')[0].matchAll(/^\s*\('([^']+)'/gm)) names.push(m[1]);
  }
  return names;
}

/** Racial trait display names from api/src/routes/characters.js. */
function racialTraitNames() {
  const src = readFileSync(repoPath('api/src/routes/characters.js'), 'utf8');
  const block = src.match(/const RACIAL_TRAIT_NAMES = \{([^}]+)\}/);
  assert.ok(block, 'RACIAL_TRAIT_NAMES found');
  return [...block[1].matchAll(/:\s*'([^']+)'/g)].map(m => m[1]);
}

describe('trait icons', () => {
  it('maps every seeded and racial trait to its own entry', () => {
    const seeded = seededTraitNames();
    const racial = racialTraitNames();
    assert.equal(seeded.length, 31);
    assert.equal(racial.length, 5);
    for (const name of [...seeded, ...racial]) {
      assert.ok(TRAIT_ICONS[name], `${name} has an icon`);
    }
  });

  it('points augment entries at augment icons that exist', () => {
    for (const [trait, { category, name }] of Object.entries(TRAIT_ICONS)) {
      if (category === 'augments') assert.ok(AUGMENT_ICON_FILES.has(name), `${trait} -> augments/${name}`);
    }
  });

  const assetsDir = repoPath('frontend/public/assets/icons/png');
  it('has a file for every mapped icon at every icon size', {
    skip: existsSync(assetsDir) ? false : 'frontend/public/assets is gitignored and not present in this checkout'
  }, () => {
    for (const [trait, { category, name }] of Object.entries({ ...TRAIT_ICONS, default: DEFAULT_TRAIT_ICON })) {
      for (const size of SIZE_PRESETS.icons) {
        assert.ok(existsSync(`${assetsDir}/${size}/${category}/${name}.webp`), `${trait}: ${size}/${category}/${name}.webp`);
      }
    }
  });

  it('renders a painted icon instead of emoji', () => {
    const html = renderTraitIcon({ name: 'Lucky Find', type: 'racial' });
    assert.match(html, /\/assets\/icons\/png\/\d+\/resources\/gold\.webp/);
    assert.doesNotMatch(html, /\u{1F9EC}|&#x1F9EC;|⭐|&#x2B50;/u);
  });

  it('falls back to a default icon for unknown traits', () => {
    assert.deepEqual(getTraitIcon({ name: 'Not A Trait' }), DEFAULT_TRAIT_ICON);
    assert.deepEqual(getTraitIcon(null), DEFAULT_TRAIT_ICON);
  });
});
