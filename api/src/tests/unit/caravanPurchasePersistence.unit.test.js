import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { persistCaravanPurchaseItem } from '../../services/caravanService.js';

class FakePurchaseClient {
  constructor() {
    this.calls = [];
    this.templates = new Map();
    this.items = [];
    this.nextTemplateId = 100;
    this.nextItemId = 1000;
  }

  async query(sql, params = []) {
    const compactSql = sql.replace(/\s+/g, ' ').trim();
    this.calls.push({ sql: compactSql, params });

    if (compactSql.startsWith('INSERT INTO item_templates')) {
      const catalogKey = params[0];
      let template = this.templates.get(catalogKey);
      if (!template) {
        template = { id: this.nextTemplateId++, catalogKey };
        this.templates.set(catalogKey, template);
      }
      Object.assign(template, {
        name: params[1],
        description: params[2],
        itemType: params[3],
        equipmentSlot: params[4],
        statBonuses: JSON.parse(params[5]),
        levelRequirement: params[6],
        effectType: params[7],
        effectValue: params[8],
        basePrice: params[9],
        isStackable: params[10],
        spriteId: params[11]
      });
      return { rows: [{ id: template.id }] };
    }

    if (compactSql.startsWith('SELECT id, quantity FROM character_items')) {
      const [userId, templateId] = params;
      const item = this.items.find(candidate =>
        candidate.userId === userId
        && candidate.templateId === templateId
        && candidate.characterId === null
        && candidate.equippedSlot === null
      );
      return { rows: item ? [{ id: item.id, quantity: item.quantity }] : [] };
    }

    if (compactSql.startsWith('UPDATE character_items')) {
      const [quantity, id] = params;
      const item = this.items.find(candidate => candidate.id === id);
      item.quantity += quantity;
      return { rows: [] };
    }

    if (compactSql.startsWith('INSERT INTO character_items')) {
      const hasLiteralQuantity = compactSql.includes('VALUES ($1, $2, 1, $3)');
      const item = {
        id: this.nextItemId++,
        userId: params[0],
        templateId: params[1],
        quantity: hasLiteralQuantity ? 1 : params[2],
        modifications: JSON.parse(hasLiteralQuantity ? params[2] : params[3]),
        characterId: null,
        equippedSlot: null
      };
      this.items.push(item);
      return { rows: [{ id: item.id }] };
    }

    throw new Error(`Unexpected fake-client query: ${compactSql}`);
  }
}

describe('caravan purchase persistence', () => {
  it('upserts Starlight Essence and inserts it with a non-null canonical template ID', async () => {
    const client = new FakePurchaseClient();
    const result = await persistCaravanPurchaseItem(client, 7, {
      itemId: 'starlight_essence',
      name: 'Starlight Essence',
      type: 'material',
      description: 'Captured starlight in liquid form.',
      basePrice: 320,
      sprite_id: 'material_starlight_essence'
    }, 2);

    assert.equal(result.templateId, 100);
    assert.equal(client.templates.size, 1);
    assert.deepEqual(client.templates.get('caravan:starlight_essence'), {
      id: 100,
      catalogKey: 'caravan:starlight_essence',
      name: 'Starlight Essence',
      description: 'Captured starlight in liquid form.',
      itemType: 'material',
      equipmentSlot: null,
      statBonuses: {},
      levelRequirement: 1,
      effectType: null,
      effectValue: null,
      basePrice: 320,
      isStackable: true,
      spriteId: 'material_starlight_essence'
    });
    assert.equal(client.items.length, 1);
    assert.equal(client.items[0].templateId, 100);
    assert.notEqual(client.items[0].templateId, null);
    assert.equal(client.items[0].quantity, 2);
    assert.equal(
      client.items[0].modifications.caravan_item_id,
      'starlight_essence'
    );

    const templateCall = client.calls.find(call =>
      call.sql.startsWith('INSERT INTO item_templates')
    );
    assert.match(templateCall.sql, /ON CONFLICT \(catalog_key\) DO UPDATE/);
    assert.match(templateCall.sql, /RETURNING id$/);
  });

  it('stacks repeated material purchases by user and canonical template', async () => {
    const client = new FakePurchaseClient();
    const moonOre = {
      itemId: 'moon_ore',
      name: 'Moon Ore',
      type: 'material',
      description: 'Ore that glows with lunar energy.',
      basePrice: 200,
      sprite_id: 'material_moon_ore'
    };

    const first = await persistCaravanPurchaseItem(client, 12, moonOre, 2);
    const second = await persistCaravanPurchaseItem(client, 12, moonOre, 3);

    assert.equal(first.templateId, second.templateId);
    assert.equal(client.templates.size, 1);
    assert.equal(client.items.length, 1);
    assert.equal(client.items[0].quantity, 5);
    assert.ok(client.calls.some(call =>
      call.sql.includes('item_template_id = $2')
      && call.sql.includes('character_id IS NULL')
      && call.sql.includes('equipped_slot IS NULL')
      && call.sql.endsWith('FOR UPDATE')
    ));
  });

  it('creates one shared inventory instance per non-stackable item quantity', async () => {
    const client = new FakePurchaseClient();

    const result = await persistCaravanPurchaseItem(client, 19, {
      itemId: 'knights_crest',
      name: "Knight's Crest",
      type: 'accessory',
      description: 'A badge of honor from the Human Kingdom.',
      equipSlot: 'accessory',
      statBonuses: { strength: 3, vitality: 2 },
      levelRequirement: 8,
      basePrice: 350,
      sprite_id: 'amulet_silver'
    }, 3);

    assert.equal(result.isStackable, false);
    assert.equal(client.items.length, 3);
    assert.deepEqual(client.items.map(item => item.quantity), [1, 1, 1]);
    assert.ok(client.items.every(item => item.templateId === result.templateId));
    assert.equal(
      client.calls.filter(call =>
        call.sql.startsWith('INSERT INTO character_items')
      ).length,
      3
    );
  });

  it('maps straightforward healing consumables into canonical effect fields', async () => {
    const client = new FakePurchaseClient();

    await persistCaravanPurchaseItem(client, 23, {
      itemId: 'mega_potion',
      name: 'Mega-Potion',
      type: 'consumable',
      description: 'Restores 150 HP.',
      effect: { hp_restore: 150 },
      basePrice: 150,
      sprite_id: 'potion_health_large'
    }, 1);

    const template = client.templates.get('caravan:mega_potion');
    assert.equal(template.effectType, 'heal_hp');
    assert.equal(template.effectValue, 150);
    assert.deepEqual(template.statBonuses, { hp_restore: 150 });
  });
});
