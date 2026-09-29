/**
 * Item detail fields and out-of-battle potion use (live server)
 *
 * - GET /api/shops/:nodeId/:shopType/sell-inventory carries equipmentSlot and
 *   levelRequirement, like the buy list does
 * - GET /api/inventory/shared carries effectType / effectValue so the client
 *   can pick valid consumable targets
 * - POST /api/inventory/use heals a damaged character with a Health Potion
 *
 * Requires the API server running (PORT, default 3001).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext, request, query } from '../testHelper.js';

describe('item detail fields and potion use (live)', () => {
  const ctx = createTestContext();
  let user;
  let character;
  let weaponTemplate;
  let potionTemplate;
  let weaponInstanceId;
  let potionInstanceId;
  let shopNodeId;
  const shopType = 'blacksmith';

  before(async () => {
    user = await ctx.createUser();
    character = await ctx.createCharacter(user.accessToken);

    const weapon = await query(
      `SELECT id, equipment_slot, level_requirement FROM item_templates
       WHERE item_type = 'weapon' AND equipment_slot IS NOT NULL
         AND level_requirement > 1
         AND (is_tradeable IS NULL OR is_tradeable = TRUE)
       ORDER BY id LIMIT 1`
    );
    weaponTemplate = weapon.rows[0];
    const potion = await query(
      `SELECT id, effect_type, effect_value FROM item_templates
       WHERE name = 'Health Potion' AND effect_type = 'heal_hp' LIMIT 1`
    );
    potionTemplate = potion.rows[0];
    assert.ok(weaponTemplate && potionTemplate, 'fixture templates exist');

    const shop = await query(
      `SELECT DISTINCT node_id FROM npc_shop_inventory
       WHERE shop_type = $1 ORDER BY node_id LIMIT 1`,
      [shopType]
    );
    shopNodeId = shop.rows[0].node_id;
    await query(
      'UPDATE characters SET current_node_id = $1 WHERE id = $2',
      [shopNodeId, character.id]
    );

    const inserted = await query(
      `INSERT INTO character_items (user_id, item_template_id, quantity)
       VALUES ($1, $2, 1), ($1, $3, 2)
       RETURNING id, item_template_id`,
      [user.userId, weaponTemplate.id, potionTemplate.id]
    );
    weaponInstanceId = inserted.rows.find(r => r.item_template_id === weaponTemplate.id).id;
    potionInstanceId = inserted.rows.find(r => r.item_template_id === potionTemplate.id).id;
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('sell-inventory carries equipmentSlot and levelRequirement', async () => {
    const res = await request(
      'GET',
      `/api/shops/${shopNodeId}/${shopType}/sell-inventory`,
      null,
      user.accessToken
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const weapon = res.body.items.find(i => i.instanceId === weaponInstanceId);
    assert.ok(weapon, 'weapon is sellable');
    assert.equal(weapon.equipmentSlot, weaponTemplate.equipment_slot);
    assert.equal(weapon.levelRequirement, weaponTemplate.level_requirement);
  });

  it('shared inventory carries effectType and effectValue', async () => {
    const res = await request('GET', '/api/inventory/shared', null, user.accessToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const potion = res.body.inventory.find(i => i.instanceId === potionInstanceId);
    assert.ok(potion, 'potion is in the shared pool');
    assert.equal(potion.effectType, 'heal_hp');
    assert.equal(potion.effectValue, potionTemplate.effect_value);
    const weapon = res.body.inventory.find(i => i.instanceId === weaponInstanceId);
    assert.equal(weapon.effectType, null);
  });

  it('uses a Health Potion on a damaged character', async () => {
    const before = await query(
      'SELECT hp_max FROM characters WHERE id = $1',
      [character.id]
    );
    const hpMax = before.rows[0].hp_max;
    const damagedHp = Math.max(1, hpMax - potionTemplate.effect_value - 10);
    await query(
      'UPDATE characters SET hp_current = $1 WHERE id = $2',
      [damagedHp, character.id]
    );

    const res = await request('POST', '/api/inventory/use', {
      itemInstanceId: potionInstanceId,
      targetCharacterId: character.id
    }, user.accessToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);

    const expectedHeal = Math.min(potionTemplate.effect_value, hpMax - damagedHp);
    assert.equal(res.body.effects.hp_restored, expectedHeal);

    const after = await query(
      'SELECT hp_current FROM characters WHERE id = $1',
      [character.id]
    );
    assert.equal(after.rows[0].hp_current, damagedHp + expectedHeal);
    const remaining = await query(
      'SELECT quantity FROM character_items WHERE id = $1',
      [potionInstanceId]
    );
    assert.equal(remaining.rows[0].quantity, 1);
  });
});
