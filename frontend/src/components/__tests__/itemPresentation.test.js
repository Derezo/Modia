/**
 * One presentation for an item's stats, consumable effects and augments.
 *
 * The same item must read identically in the shop detail panel, the item
 * detail modal, the equip modal, the marketplace buyer listing cards and the
 * seller's Sell / My Listings panels, and item tables must not show a
 * consumable effect as a stat.
 */
import { describe, it } from 'node:test';
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

const noop = () => {};
globalThis.window ??= {
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop })
};
if (!globalThis.navigator) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { maxTouchPoints: 0 } });
}
// escapeHtml relies on textContent -> innerHTML serialization; emulate it.
function fakeElement() {
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
}
globalThis.document ??= {
  createElement: fakeElement,
  getElementById: () => null,
  head: { appendChild: noop },
  documentElement: { style: { setProperty: noop }, classList: { add: noop, remove: noop, toggle: noop } },
  body: { classList: { add: noop, remove: noop, toggle: noop } }
};

const {
  sumItemStats,
  formatStatBreakdown,
  getItemStatRows,
  describeAugmentLine
} = await import('../../utils/statDisplay.js');
const { renderItemStatRows } = await import('../ItemStatRows.js');
const { renderAugmentList } = await import('../AugmentList.js');
const { COLUMN_RENDERERS } = await import('../ItemDataTable/itemDataTableColumns.js');
const { formatListingStats } = await import('../../scenes/marketplace/marketplaceUtils.js');
const { ShopScene } = await import('../../scenes/ShopScene.js');
const { MarketplaceItemPanel } = await import('../MarketplaceItemPanel.js');
const { ItemDetailModal } = await import('../modals/ItemDetailModal.js');
const { EquipmentSlotModal } = await import('../modals/EquipmentSlotModal.js');

const MIGHT = { name: 'of Might', category: 'strength', stat: 'strength', value: 8, effect: { type: 'stat_bonus', stat: 'strength' } };
const BLAZING = { name: 'Blazing', category: 'fire', stat: 'agility', value: 2, effect: { type: 'burn_chance', value: 0.1 } };
const SWORD = {
  name: 'Iron Sword of Might',
  type: 'weapon',
  rarity: 'rare',
  baseStats: { attack: 12, strength: 5 },
  bonusStats: { strength: 8, agility: 2 },
  augments: [MIGHT, BLAZING]
};
const POTION = { name: 'Mega-Potion', type: 'consumable', baseStats: { hp_restore: 150 }, bonusStats: {} };

describe('stat helpers', () => {
  it('sumItemStats drops consumable effect keys unless asked to keep them', () => {
    assert.deepEqual(sumItemStats(POTION), {});
    assert.deepEqual(sumItemStats({ baseStats: { hp_restore: 150, vitality: 2 } }), { vitality: 2 });
    assert.deepEqual(sumItemStats(POTION, { includeEffects: true }), { hp_restore: 150 });
  });

  it('formatStatBreakdown only explains a total that mixes base and bonus', () => {
    assert.equal(formatStatBreakdown('strength', 5, 8), '(+5 base +8 bonus)');
    assert.equal(formatStatBreakdown('strength', 0, 8), '');
    assert.equal(formatStatBreakdown('strength', 5, 0), '');
  });

  it('getItemStatRows uses full names, canonical order, breakdowns and template stat bonuses', () => {
    const rows = getItemStatRows(SWORD);
    assert.deepEqual(rows.map(r => [r.label, r.amount, r.breakdown]), [
      ['Attack', '+12', ''],
      ['Strength', '+13', '(+5 base +8 bonus)'],
      ['Agility', '+2', '']
    ]);
    const template = getItemStatRows({ statBonuses: { vitality: -1, luck: 3 } });
    assert.deepEqual(template.map(r => [r.label, r.amount, r.negative]), [['Vitality', '-1', true], ['Luck', '+3', false]]);
    assert.deepEqual(getItemStatRows(POTION), []);
  });
});

describe('describeAugmentLine', () => {
  it('names a stat_bonus augment and points at the stats instead of repeating +8', () => {
    const line = describeAugmentLine(MIGHT);
    assert.equal(line.text, 'of Might (included above)');
    assert.equal(line.inactive, false);
  });

  it('tags an effect the server does not apply yet', () => {
    const line = describeAugmentLine(BLAZING);
    assert.equal(line.inactive, true);
    assert.equal(line.text, 'Blazing: 10% chance to burn (stat bonus included above) - not yet active');
  });
});

describe('consumable effects are effects, never stats', () => {
  it('the shared block shows an Effect row for hp_restore', () => {
    const html = renderItemStatRows(POTION);
    assert.match(html, /item-stat-label">Effect<\/span>\s*<span class="item-stat-value">Restores 150 HP</);
    assert.doesNotMatch(html, /\+150|Hp Restore|HPRE/);
  });

  it('the item table Stats column shows the effect, not "+150 HPRE"', () => {
    const html = COLUMN_RENDERERS.stats(POTION);
    assert.match(html, /item-data-table-effect[^>]*>Restores 150 HP</);
    assert.doesNotMatch(html, /HPRE|\+150/);
    // Scene row adapters keep the API item (with effectType) as _original
    const hiPotion = { name: 'Hi-Potion', baseStats: {}, _original: { effectType: 'heal_hp', effectValue: 50, description: 'Restores 50 HP.' } };
    assert.match(COLUMN_RENDERERS.stats(hiPotion), />Restores 50 HP</);
    // Template shape used by the shop and marketplace browse tables
    assert.doesNotMatch(COLUMN_RENDERERS.stats({ baseStats: { hp_restore: 150 } }), /HPRE/);
  });

  it('the item detail modal shows the potion effect under Stats with no stat row', () => {
    const html = ItemDetailModal.prototype.renderContent.call({ item: POTION, characters: [], renderRequirements: () => '' });
    assert.match(html, /Restores 150 HP/);
    assert.doesNotMatch(html, /Hp Restore|\+150/);
  });

  it('item table augment tooltips use the shared augment wording', () => {
    const html = COLUMN_RENDERERS.augments(SWORD);
    assert.match(html, /of Might \(included above\)/);
    assert.match(html, /not yet active/);
    assert.doesNotMatch(html, /of Might: \+8 Strength/);
  });
});

describe('the same item reads identically in every detail view', () => {
  const statsBlock = renderItemStatRows(SWORD);
  const augmentBlock = renderAugmentList(SWORD.augments);

  it('the shared blocks carry the summed stat, its breakdown and the augment notes', () => {
    assert.match(statsBlock, /Strength<\/span>\s*<span class="item-stat-value">\+13<span class="item-stat-breakdown">\(\+5 base \+8 bonus\)/);
    assert.match(augmentBlock, /of Might<\/span>[\s\S]*\(included above\)/);
    assert.match(augmentBlock, /not yet active/);
    // +8 Strength only in the hover title, never as visible text
    assert.doesNotMatch(augmentBlock, />[^<]*\+8 Strength[^<]*</);
  });

  const surfaces = {
    'shop detail panel': () => ShopScene.prototype.renderDetailStats.call({}, SWORD),
    'item detail modal': () => ItemDetailModal.prototype.renderContent.call({ item: SWORD, characters: [], renderRequirements: () => '' }),
    'equip modal card': () => EquipmentSlotModal.prototype.renderComparisonCard.call({ renderRequirementBadge: () => '' }, SWORD, false),
    'marketplace seller panels (formatListingStats)': () => formatListingStats(SWORD) + renderAugmentList(SWORD.augments),
    'marketplace listing card': () => MarketplaceItemPanel.prototype.renderListingCard.call(
      {
        listings: [],
        capitalize: MarketplaceItemPanel.prototype.capitalize,
        getListingIconItem: MarketplaceItemPanel.prototype.getListingIconItem
      },
      { listingId: 1, generatedName: SWORD.name, rarity: 3, baseStats: SWORD.baseStats, bonusStats: SWORD.bonusStats, augments: SWORD.augments, askPrice: 100, sellerName: 'Seller' }
    )
  };

  for (const [surface, render] of Object.entries(surfaces)) {
    it(`${surface} embeds the shared stat and augment blocks unchanged`, () => {
      const html = render();
      assert.ok(html.includes(statsBlock), `${surface} stat block differs`);
      assert.ok(html.includes(augmentBlock), `${surface} augment block differs`);
    });
  }
});
