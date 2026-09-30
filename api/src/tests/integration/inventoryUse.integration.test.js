/**
 * POST /api/inventory/use: out-of-battle consumable effects (live server)
 *
 * Each rejection must keep the item (the handler rejects before it
 * decrements), and each success must apply the effect and use one unit.
 *
 * Requires the API server running (PORT, default 3001).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext, request, query } from '../testHelper.js';

describe('POST /api/inventory/use', () => {
  const ctx = createTestContext();
  let user;
  let character;
  const templates = {};
  let legacyTemplateId = null;

  before(async () => {
    user = await ctx.createUser();
    character = await ctx.createCharacter(user.accessToken);
    const rows = await query(
      `SELECT id, name, effect_value FROM item_templates
       WHERE name = ANY($1::text[]) AND item_type = 'consumable'`,
      [['Health Potion', 'Elixir', 'Phoenix Feather', 'Status Cure', 'Mana Potion']]
    );
    for (const row of rows.rows) templates[row.name] = row;
    for (const name of ['Health Potion', 'Elixir', 'Phoenix Feather', 'Status Cure', 'Mana Potion']) {
      assert.ok(templates[name], `${name} template exists`);
    }
    const legacy = await query(
      `INSERT INTO item_templates (name, item_type, stat_bonuses, effect_type)
       VALUES ($1, 'consumable', '{"hp_restore": 20}'::jsonb, NULL)
       RETURNING id`,
      [`Test Legacy Tonic ${Date.now()}`]
    );
    legacyTemplateId = legacy.rows[0].id;
  });

  after(async () => {
    await ctx.cleanup();
    if (legacyTemplateId) {
      await query('DELETE FROM character_items WHERE item_template_id = $1', [legacyTemplateId]);
      await query('DELETE FROM item_templates WHERE id = $1', [legacyTemplateId]);
    }
  });

  async function give(templateId, quantity = 2) {
    const res = await query(
      `INSERT INTO character_items (user_id, item_template_id, quantity)
       VALUES ($1, $2, $3) RETURNING id`,
      [user.userId, templateId, quantity]
    );
    return res.rows[0].id;
  }

  async function setVitals({ hp, mp }) {
    await query(
      `UPDATE characters SET
         hp_current = COALESCE($2, hp_current),
         mp_current = COALESCE($3, mp_current)
       WHERE id = $1`,
      [character.id, hp ?? null, mp ?? null]
    );
    const row = await query('SELECT hp_current, hp_max, mp_current, mp_max FROM characters WHERE id = $1', [character.id]);
    return row.rows[0];
  }

  async function quantityOf(itemId) {
    const res = await query('SELECT quantity FROM character_items WHERE id = $1', [itemId]);
    return res.rows[0]?.quantity ?? 0;
  }

  function use(itemId) {
    return request('POST', '/api/inventory/use', {
      itemInstanceId: itemId,
      targetCharacterId: character.id
    }, user.accessToken);
  }

  it('heal_hp raises HP and uses one potion', async () => {
    const vitals = await setVitals({ hp: 1 });
    const itemId = await give(templates['Health Potion'].id);
    const res = await use(itemId);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const expected = Math.min(templates['Health Potion'].effect_value, vitals.hp_max - 1);
    assert.equal(res.body.effects.hp_restored, expected);
    const after = await setVitals({});
    assert.equal(after.hp_current, 1 + expected);
    assert.equal(await quantityOf(itemId), 1);
  });

  it('heal_hp on a full-HP target is refused and keeps the item', async () => {
    const vitals = await setVitals({});
    await setVitals({ hp: vitals.hp_max });
    const itemId = await give(templates['Health Potion'].id);
    const res = await use(itemId);
    assert.equal(res.status, 400);
    assert.equal(await quantityOf(itemId), 2);
  });

  it('heal_both restores HP and half as much MP', async () => {
    await setVitals({ hp: 1, mp: 0 });
    const itemId = await give(templates.Elixir.id);
    const res = await use(itemId);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.effects.hp_restored > 0);
    const after = await setVitals({});
    assert.equal(after.hp_current, 1 + res.body.effects.hp_restored);
    if (after.mp_max > 0) {
      assert.equal(res.body.effects.mp_restored, Math.min(Math.floor(templates.Elixir.effect_value / 2), after.mp_max));
      assert.equal(after.mp_current, res.body.effects.mp_restored);
    }
    assert.equal(await quantityOf(itemId), 1);
  });

  it('revive on a living target is refused and keeps the item', async () => {
    await setVitals({ hp: 5 });
    const itemId = await give(templates['Phoenix Feather'].id);
    const res = await use(itemId);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /living/);
    assert.equal(await quantityOf(itemId), 2);
  });

  it('revive on a defeated target restores the given percent of max HP', async () => {
    const vitals = await setVitals({ hp: 0 });
    const itemId = await give(templates['Phoenix Feather'].id);
    const res = await use(itemId);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const expected = Math.floor(vitals.hp_max * templates['Phoenix Feather'].effect_value / 100);
    assert.equal(res.body.effects.revived, true);
    const after = await setVitals({});
    assert.equal(after.hp_current, expected);
    assert.equal(await quantityOf(itemId), 1);
  });

  it('a heal on a defeated target is refused and keeps the item', async () => {
    await setVitals({ hp: 0 });
    const itemId = await give(templates['Health Potion'].id);
    const res = await use(itemId);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /defeated/);
    assert.equal(await quantityOf(itemId), 2);
    const after = await setVitals({});
    assert.equal(after.hp_current, 0);
  });

  it('cure_all outside battle is refused and keeps the item', async () => {
    await setVitals({ hp: 10 });
    const itemId = await give(templates['Status Cure'].id);
    const res = await use(itemId);
    assert.equal(res.status, 400);
    assert.match(res.body.error, /status effect/);
    assert.equal(await quantityOf(itemId), 2);
  });

  it('a legacy stat_bonuses-only item still heals', async () => {
    await setVitals({ hp: 1 });
    const itemId = await give(legacyTemplateId, 1);
    const res = await use(itemId);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.effects.hp_restored, 20);
    assert.equal(await quantityOf(itemId), 0, 'the last unit is removed');
  });
});
