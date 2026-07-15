import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function encodeText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const elementsById = new Map();

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
  createElement(tagName) {
    if (tagName === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            globalCompositeOperation: 'source-over',
            globalAlpha: 1,
            imageSmoothingEnabled: true,
            clearRect() {},
            drawImage() {}
          };
        },
        toDataURL() { return 'data:image/png;base64,composited'; }
      };
    }
    let text = '';
    return {
      id: '',
      set textContent(value) { text = String(value); },
      get textContent() { return text; },
      get innerHTML() { return encodeText(text); }
    };
  },
  getElementById(id) {
    return elementsById.get(id) || null;
  },
  head: {
    appendChild(element) {
      if (element.id) elementsById.set(element.id, element);
    }
  }
};

class FakeImage {
  static instances = [];

  constructor() {
    this.complete = false;
    this.naturalWidth = 0;
    this.onload = null;
    this.onerror = null;
    FakeImage.instances.push(this);
  }

  set src(value) {
    this._src = value;
    this.complete = true;
    this.naturalWidth = 32;
    this.onload?.();
  }

  get src() {
    return this._src;
  }
}

globalThis.Image = FakeImage;

const [
  { getBattleItemCompositeSrc, getBattleItemIconSrc },
  { renderItemPanel },
  { BattleActionBar },
  { BattleContextMenu },
  { BattleOutroSequence }
] = await Promise.all([
  import('../BattleItemIcon.js'),
  import('../ui/BattleSelectionPanels.js'),
  import('../BattleActionBar.js'),
  import('../BattleContextMenu.js'),
  import('../BattleOutroSequence.js')
]);

const battleItem = {
  itemId: '12" onclick="attack()',
  inventoryId: "34' onpointerover='attack()",
  name: 'Health Potion <img src=x>',
  description: 'Restore "HP" onpointerover="attack()"',
  quantity: 0,
  spriteId: 'potion_health'
};

function createListContainer() {
  return {
    innerHTML: '',
    querySelectorAll() { return []; }
  };
}

function createCanvasContext() {
  const images = [];
  const text = [];
  return {
    images,
    text,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillStyle: '#000000',
    font: '10px sans-serif',
    save() {},
    restore() {},
    translate() {},
    scale() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    drawImage(...args) { images.push(args); },
    measureText(value) { return { width: String(value).length * 7 }; },
    fillText(value, x, y) {
      text.push({
        value,
        x,
        y,
        textAlign: this.textAlign,
        textBaseline: this.textBaseline,
        fillStyle: this.fillStyle,
        font: this.font
      });
    }
  };
}

describe('canonical battle item icons', () => {
  beforeEach(() => {
    FakeImage.instances.length = 0;
  });

  it('maps battle DTO item types to the canonical sized asset folders', () => {
    assert.equal(
      getBattleItemIconSrc(battleItem, { size: 'sm' }),
      '/assets/items/32/consumables/potion_health.webp'
    );
    assert.equal(
      getBattleItemIconSrc({ spriteId: 'armor_chain', itemType: 'armor' }),
      '/assets/items/32/armor/armor_chain.webp'
    );
    assert.equal(
      getBattleItemIconSrc({ sprite_id: 'ring_gem', item_type: 'accessory' }),
      '/assets/items/32/accessories/ring_gem.webp'
    );
  });

  it('renders BattleSelectionPanels items with ItemIcon and attribute-safe metadata', () => {
    const list = createListContainer();
    const noItems = { style: {} };

    renderItemPanel(list, noItems, [battleItem], () => {});

    assert.equal(noItems.style.display, 'none');
    assert.match(list.innerHTML, /modia-item-icon/);
    assert.match(list.innerHTML, /\/assets\/items\/32\/consumables\/potion_health\.webp/);
    assert.match(list.innerHTML, /data-image-fallback/);
    assert.doesNotMatch(list.innerHTML, /onerror=/);
    assert.match(list.innerHTML, /Health Potion &lt;img src=x&gt;/);
    assert.match(list.innerHTML, /data-item-id="12&quot; onclick=&quot;attack\(\)"/);
    assert.match(list.innerHTML, /onpointerover=&#39;attack\(\)/);
    assert.doesNotMatch(list.innerHTML, /🧪|📦|💊|💣/u);
    assert.doesNotMatch(list.innerHTML, /data-item-id="12" onclick=/);
  });

  it('uses the same ItemIcon HTML in the action bar and context menu', () => {
    const actionBar = new BattleActionBar({});
    const dropdown = createListContainer();
    actionBar.callbacks = { getItems: () => [battleItem] };
    actionBar.populateItemList(dropdown);

    const contextMenu = new BattleContextMenu({});
    contextMenu.callbacks = { getItems: () => [battleItem] };
    const submenu = contextMenu.generateItemSubmenuHTML();

    for (const html of [dropdown.innerHTML, submenu]) {
      assert.match(html, /modia-item-icon/);
      assert.match(html, /\/assets\/items\/32\/consumables\/potion_health\.webp/);
      assert.match(html, />x0<\/span>/);
      assert.doesNotMatch(html, /🧪|⚗️|💎|🍃/u);
      assert.doesNotMatch(html, /data-item-id="12" onclick=/);
    }
  });

  it('preloads and draws the canonical sprite in battle loot cards', () => {
    const scene = { game: { canvas: {}, targetWidth: 800, targetHeight: 600 } };
    const outro = new BattleOutroSequence(scene);
    const loot = {
      name: 'Iron Sword',
      itemType: 'weapon',
      rarity: 'rare',
      spriteId: 'sword_long'
    };

    outro.preloadItemIcons([loot]);
    const ctx = createCanvasContext();
    outro.renderItem(ctx, loot, 0, 0, 1);

    assert.equal(FakeImage.instances.length, 1);
    assert.equal(FakeImage.instances[0].src, '/assets/items/32/weapons/sword_long.webp');
    assert.deepEqual(ctx.images, [[FakeImage.instances[0], 24, 10, 32, 32]]);
    assert.equal(ctx.text.some(entry => entry.value === 'I'), false);

    const name = ctx.text.find(entry => entry.value.startsWith('Iron'));
    assert.ok(name);
    assert.equal(name.textAlign, 'center');
    assert.equal(name.textBaseline, 'middle');
  });

  it('wraps complete item names inside compact horizontal reward cards', () => {
    const scene = { game: { canvas: {}, targetWidth: 800, targetHeight: 600, scale: 1 } };
    const outro = new BattleOutroSequence(scene);
    const loot = {
      name: 'Copper Chainmail of the Mountain',
      itemType: 'armor',
      rarity: 'common',
      spriteId: 'armor_chain'
    };
    const ctx = createCanvasContext();

    outro.preloadItemIcons([loot]);
    outro.renderItem(ctx, loot, 0, 0, 1, { width: 277, height: 56 }, false);

    const nameLines = ctx.text.filter(entry =>
      entry.value.includes('Copper') || entry.value === 'Mountain'
    );
    const metadata = ctx.text.find(entry => entry.value === 'Common · Armor');
    assert.deepEqual(nameLines.map(entry => entry.value), [
      'Copper Chainmail of the',
      'Mountain'
    ]);
    assert.equal(ctx.text.some(entry => entry.value.includes('…')), false);
    assert.equal(nameLines.every(entry => entry.textAlign === 'left'), true);
    assert.equal(metadata.textAlign, 'left');
    assert.ok(nameLines.every(entry => entry.x > 40 && entry.x < 277));
    assert.ok(metadata.x > 40 && metadata.x < 277);
  });

  it('preserves the longest generated names without ellipses or overflow', () => {
    const scene = { game: { canvas: {}, targetWidth: 800, targetHeight: 600, scale: 1 } };
    const outro = new BattleOutroSequence(scene);
    const ctx = createCanvasContext();
    const fullName = 'Superior Demonslayer Platinum Lucky Charm of Fortitude';
    const item = {
      name: fullName,
      itemType: 'accessory',
      rarity: 'uncommon',
      spriteId: 'ring_gem'
    };

    outro.preloadItemIcons([item]);
    outro.renderItem(ctx, item, 0, 0, 1, { width: 277, height: 56 }, false);

    const metadata = ctx.text.find(entry => entry.value === 'Uncommon · Accessory');
    const nameLines = ctx.text.filter(entry => entry !== metadata);
    const textWidth = 277 - nameLines[0].x - 10;
    assert.equal(nameLines.map(entry => entry.value).join(' '), fullName);
    assert.equal(nameLines.some(entry => entry.value.includes('…')), false);
    assert.equal(nameLines.length, 2);
    assert.equal(nameLines.every(entry => ctx.measureText(entry.value).width <= textWidth), true);
    assert.ok(metadata);
  });

  it('character-wraps an unusually long single-token name without data loss', () => {
    const scene = { game: { canvas: {}, targetWidth: 800, targetHeight: 600, scale: 1 } };
    const outro = new BattleOutroSequence(scene);
    const ctx = createCanvasContext();
    const fullName = 'AnUnusuallyLongUnbrokenProceduralRelicNameForTesting';

    const lines = outro.wrapCanvasText(ctx, fullName, 140);

    assert.equal(lines.join(''), fullName);
    assert.equal(lines.every(line => ctx.measureText(line).width <= 140), true);
  });

  it('uses exactly two wide, shorter columns for a four-item reward', () => {
    const scene = { game: { canvas: {}, targetWidth: 800, targetHeight: 600, scale: 1 } };
    const outro = new BattleOutroSequence(scene);
    const layout = outro.getRewardLayout(800, 600, 4, {
      compact: false,
      viewportWidth: 800,
      viewportHeight: 600,
      canvasScale: 1
    });

    assert.equal(layout.cards.length, 4);
    assert.equal(new Set(layout.cards.map(card => card.x)).size, 2);
    assert.equal(new Set(layout.cards.map(card => card.y)).size, 2);
    assert.ok(layout.cards.every(card => card.width >= 270));
    assert.ok(layout.cards.every(card => card.height <= 56));
  });

  it('centers a single reward without stretching its compact card', () => {
    const scene = { game: { canvas: {}, targetWidth: 800, targetHeight: 600, scale: 1 } };
    const outro = new BattleOutroSequence(scene);
    const layout = outro.getRewardLayout(800, 600, 1, {
      compact: false,
      viewportWidth: 800,
      viewportHeight: 600,
      canvasScale: 1
    });
    const [card] = layout.cards;

    assert.ok(card.width >= 270 && card.width <= 280);
    assert.equal(card.x + card.width / 2, 400);
  });

  it('never exceeds two loot columns for one through nine drops', () => {
    const scene = { game: { canvas: {}, targetWidth: 800, targetHeight: 600, scale: 1 } };
    const outro = new BattleOutroSequence(scene);

    for (let itemCount = 1; itemCount <= 9; itemCount++) {
      const layout = outro.getRewardLayout(800, 600, itemCount, {
        compact: false,
        viewportWidth: 800,
        viewportHeight: 600,
        canvasScale: 1
      });
      const cardsPerRow = new Map();
      for (const card of layout.cards) {
        cardsPerRow.set(card.y, (cardsPerRow.get(card.y) || 0) + 1);
      }
      assert.equal([...cardsPerRow.values()].every(count => count <= 2), true);
      for (const card of layout.cards) {
        assert.ok(card.x >= layout.panel.x);
        assert.ok(card.x + card.width <= layout.panel.x + layout.panel.width);
        assert.ok(card.y >= layout.panel.y);
        assert.ok(card.y + card.height <= layout.panel.y + layout.panel.height);
      }
    }
  });

  it('bounds large mobile loot drops and preserves a physical 44px CTA', () => {
    const scene = { game: { canvas: {}, targetWidth: 800, targetHeight: 600, scale: 0.4875 } };
    const outro = new BattleOutroSequence(scene);
    const layout = outro.getRewardLayout(800, 600, 9, {
      compact: true,
      viewportWidth: 390,
      viewportHeight: 844,
      canvasScale: 0.4875
    });

    assert.equal(layout.cards.length, 6);
    assert.equal(layout.cards.at(-1).overflow, true);
    assert.equal(layout.overflowCount, 4);
    assert.ok(layout.button.height * 0.4875 >= 44);
    assert.ok(layout.panel.y + layout.panel.height < layout.button.y);

    for (const card of layout.cards) {
      assert.ok(card.x >= layout.panel.x);
      assert.ok(card.x + card.width <= layout.panel.x + layout.panel.width);
      assert.ok(card.y >= layout.panel.y);
      assert.ok(card.y + card.height <= layout.panel.y + layout.panel.height);
    }
  });

  for (const viewportWidth of [320, 360, 390]) {
    it(`keeps the Continue target at least 44px tall at ${viewportWidth}px`, () => {
      const canvasScale = viewportWidth / 800;
      const scene = { game: { canvas: {}, targetWidth: 800, targetHeight: 600, scale: canvasScale } };
      const outro = new BattleOutroSequence(scene);
      const layout = outro.getRewardLayout(800, 600, 2, {
        compact: true,
        viewportWidth,
        viewportHeight: 844,
        canvasScale
      });

      assert.ok(layout.button.height * canvasScale >= 44 - Number.EPSILON);
    });
  }

  it('reserves a footer for the PvP surrender penalty below Continue', () => {
    const scene = { game: { canvas: {}, targetWidth: 800, targetHeight: 600, scale: 1 } };
    const outro = new BattleOutroSequence(scene);
    const ctx = createCanvasContext();
    outro.status = 'defeat';
    outro.rewards = {};
    outro.pvpResult = { surrenderPenalty: true };

    outro.renderContinueButton(ctx, 800, 600);
    outro.renderSurrenderPenaltyMessage(ctx, 800, 600);

    const penalty = ctx.text.find(entry => entry.value.includes('Surrender penalty'));
    const buttonBottom = outro.continueButtonRect.y + outro.continueButtonRect.height;
    assert.ok(penalty);
    assert.ok(buttonBottom + 12 < penalty.y - 7);
  });

  it('keeps Continue visually attached to a short victory reward panel', () => {
    const scene = { game: { canvas: {}, targetWidth: 800, targetHeight: 600, scale: 1 } };
    const outro = new BattleOutroSequence(scene);
    const ctx = createCanvasContext();
    outro.status = 'victory';
    outro.rewards = { items: [{}, {}] };

    const layout = outro.getRewardLayout(800, 600, 2);
    outro.renderContinueButton(ctx, 800, 600);

    const panelBottom = layout.panel.y + layout.panel.height;
    assert.equal(outro.continueButtonRect.y - panelBottom, 24);
  });

  it('uses the explicit missing-asset mark instead of a first letter', () => {
    const scene = { game: { canvas: {}, targetWidth: 800, targetHeight: 600 } };
    const outro = new BattleOutroSequence(scene);
    const ctx = createCanvasContext();

    outro.renderItem(ctx, {
      name: 'Health Potion',
      itemType: 'consumable',
      rarity: 'common'
    }, 0, 0, 1);

    assert.equal(ctx.images.length, 0);
    assert.equal(ctx.text.some(entry => entry.value === '✗'), true);
    assert.equal(ctx.text.some(entry => entry.value === 'H'), false);
  });

  it('keeps augment overlays on canvas item sources through ItemIcon compositing', async () => {
    const src = await getBattleItemCompositeSrc({
      name: 'Burning Sword',
      itemType: 'weapon',
      rarity: 'rare',
      spriteId: 'sword_long',
      augments: [{ category: 'fire' }]
    });

    assert.equal(src, 'data:image/png;base64,composited');
    assert.equal(
      FakeImage.instances.some(image => image.src === '/assets/items/32/weapons/sword_long.webp'),
      true
    );
    assert.equal(
      FakeImage.instances.some(image => image.src === '/assets/overlays/128/augments/augment_fire.webp'),
      true
    );
  });
});
