import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function encodeText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener() {},
  removeEventListener() {},
  matchMedia() { return { matches: false }; }
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { maxTouchPoints: 0 }
});
globalThis.document = {
  createElement() {
    let text = '';
    return {
      id: '',
      set textContent(value) { text = String(value); },
      get textContent() { return text; },
      get innerHTML() { return encodeText(text); }
    };
  },
  getElementById() { return null; },
  head: { appendChild() {} }
};

const [
  {
    getAbilityIconPath,
    getAbilityIconSource,
    getAbilityIconFallback,
    renderAbilityIcon
  },
  { renderSkillPanel, renderZodiacPanel },
  { BattleActionBar },
  { BattleContextMenu }
] = await Promise.all([
  import('../AbilityIcon.js'),
  import('../ui/BattleSelectionPanels.js'),
  import('../BattleActionBar.js'),
  import('../BattleContextMenu.js')
]);

function createListContainer() {
  return {
    innerHTML: '',
    querySelectorAll() { return []; }
  };
}

const playerSkill = {
  id: 'fireball',
  name: 'Fireball',
  description: 'Launch a ball of fire',
  type: 'active',
  element: 'fire',
  icon: '🔥',
  mpCost: 18
};

describe('AbilityIcon canonical paths', () => {
  it('uses the generated registry source/id path convention', () => {
    assert.equal(
      getAbilityIconPath('fireball'),
      '/assets/abilities/icons/player/fireball.webp'
    );
    assert.equal(
      getAbilityIconPath({ id: 'flame_burst', source: 'monster' }),
      '/assets/abilities/icons/monster/flame_burst.webp'
    );
    assert.equal(
      getAbilityIconPath({ key: 'dreamwave', zodiacSign: 'pisces' }),
      '/assets/abilities/icons/zodiac/dreamwave.webp'
    );
    assert.equal(
      getAbilityIconPath({ id: 'shock', source: 'monster_skill_tree' }),
      '/assets/abilities/icons/monster/shock.webp'
    );
  });

  it('infers legacy DTO sources without trusting arbitrary path components', () => {
    assert.equal(getAbilityIconSource({ ownerType: 'archetype' }), 'monster');
    assert.equal(getAbilityIconSource({ zodiacSign: 'aries' }), 'zodiac');
    assert.equal(getAbilityIconSource({}), 'player');
    assert.equal(getAbilityIconPath('../escape'), null);
    assert.equal(getAbilityIconPath({ id: 'fireball', source: '../../public' }), null);
  });

  it('preserves explicit, legacy-map, and elemental emoji fallbacks', () => {
    assert.equal(getAbilityIconFallback({ id: 'unknown', icon: '🧪' }), '🧪');
    assert.equal(getAbilityIconFallback({ id: 'fireball' }), '🔥');
    assert.equal(getAbilityIconFallback({ id: 'unknown', element: 'ice' }), '❄️');
    assert.equal(getAbilityIconFallback({ id: 'unknown' }), '✦');
  });

  it('renders a canonical image with CSP-safe fallback metadata', () => {
    const html = renderAbilityIcon(playerSkill);

    assert.match(html, /modia-ability-icon/);
    assert.match(html, /src="\/assets\/abilities\/icons\/player\/fireball\.webp"/);
    assert.match(html, /class="modia-ability-icon__fallback"/);
    assert.match(html, /style="display:none/);
    assert.match(html, />🔥<\/span>/u);
    assert.match(html, /data-image-fallback/);
    assert.match(html, /data-fallback-display="inline-flex"/);
    assert.doesNotMatch(html, /onerror=/);
  });

  it('falls back immediately and escapes content when an ID is invalid', () => {
    const html = renderAbilityIcon({
      id: '../bad',
      name: 'Bad "title" <img>',
      icon: '<img src=x>'
    });

    assert.doesNotMatch(html, /<img class="modia-ability-icon__img"/);
    assert.match(html, /modia-ability-icon--fallback/);
    assert.match(html, /title="Bad &quot;title&quot; &lt;img&gt;"/);
    assert.match(html, /&lt;img src=x&gt;/);
  });
});

describe('battle ability icon surfaces', () => {
  it('renders canonical paths with fallback markup in the selection panel', () => {
    const list = createListContainer();
    renderSkillPanel(list, [playerSkill], 100, () => {});

    assert.match(list.innerHTML, /\/assets\/abilities\/icons\/player\/fireball\.webp/);
    assert.match(list.innerHTML, /modia-ability-icon__fallback/);
    assert.match(list.innerHTML, />🔥<\/span>/u);
    assert.match(list.innerHTML, /Fireball/);
  });

  it('uses the same AbilityIcon HTML in action and context menus', () => {
    const actionBar = new BattleActionBar({});
    const dropdown = createListContainer();
    actionBar.currentUnitMp = 100;
    actionBar.callbacks = { getSkills: () => [playerSkill] };
    actionBar.populateSkillList(dropdown);

    const contextMenu = new BattleContextMenu({});
    contextMenu.currentUnitMp = 100;
    contextMenu.callbacks = { getSkills: () => [playerSkill] };
    const submenu = contextMenu.generateSkillSubmenuHTML();

    for (const html of [dropdown.innerHTML, submenu]) {
      assert.match(html, /modia-ability-icon/);
      assert.match(html, /\/assets\/abilities\/icons\/player\/fireball\.webp/);
      assert.match(html, />🔥<\/span>/u);
    }
  });

  it('routes zodiac abilities through the zodiac registry folder', () => {
    const list = createListContainer();
    const empty = { style: {} };
    renderZodiacPanel(list, empty, [{
      key: 'dreamwave',
      zodiacSign: 'pisces',
      name: 'Dreamwave',
      description: 'Put a target to sleep',
      element: 'water',
      needsTarget: true
    }], () => {});

    assert.equal(empty.style.display, 'none');
    assert.match(list.innerHTML, /\/assets\/abilities\/icons\/zodiac\/dreamwave\.webp/);
    assert.match(list.innerHTML, />💧<\/span>/u);
  });
});
