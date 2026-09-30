/**
 * Equipment stat aggregation parity (live server + database)
 *
 * The same equipped rows must give the same gear totals in every path:
 * - SQL: buildEquipmentStatsLateral (battle, coliseum, GET /characters/:id/stats)
 * - JS:  sumEquipmentStats (guildmaster battle)
 * - Client: withEquipmentStats over the GET /characters equipment payload
 *   (FormationScene / BattleFormationScene)
 *
 * The rows cover the cases where the old per-object JS fallback disagreed
 * with the per-key SQL: a fixed-gear drop written with baseStats {}, and a
 * rolled item whose baseStats lacks a template key.
 *
 * Requires the API server running (PORT, default 3001).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createTestContext, request, query } from '../testHelper.js';
import { sumEquipmentStats } from '../../services/equipmentStats.js';
import { withEquipmentStats } from '../../../../frontend/src/utils/effectiveStats.js';

const PRIMARY = ['strength', 'intelligence', 'agility', 'vitality', 'luck'];

describe('equipment stat parity: SQL lateral, JS sum and client', () => {
  const ctx = createTestContext();
  let user;
  let character;

  before(async () => {
    user = await ctx.createUser();
    character = await ctx.createCharacter(user.accessToken);

    // One template per slot that has at least two stat keys, so a partial
    // baseStats can omit one of them
    const templates = await query(
      `SELECT DISTINCT ON (equipment_slot) id, equipment_slot, stat_bonuses
       FROM item_templates
       WHERE equipment_slot IN ('main_hand', 'head', 'body')
         AND stat_bonuses IS NOT NULL
         AND (SELECT COUNT(*) FROM jsonb_object_keys(stat_bonuses)) >= 2
       ORDER BY equipment_slot, id`
    );
    const bySlot = Object.fromEntries(templates.rows.map(r => [r.equipment_slot, r]));
    assert.ok(bySlot.main_hand && bySlot.head && bySlot.body, 'fixture templates exist');

    const [firstKey] = Object.keys(bySlot.head.stat_bonuses);
    const rows = [
      // Fixed-gear drop: baseStats {} must keep the template stats
      [bySlot.main_hand.id, 'main_hand', { baseStats: {} }],
      // Rolled item missing a template key: that key falls back to the template
      [bySlot.head.id, 'head', { baseStats: { [firstKey]: 11 }, bonusStats: { luck: 2 } }],
      // Rolled item with an augment bonus and a legacy top-level key
      [bySlot.body.id, 'body', { baseStats: { vitality: 4, hp_max: 9 }, bonusStats: { strength: 3 }, agility: 1 }]
    ];
    // A new character starts with starter gear; clear it so each slot holds
    // exactly one fixture row (GET /characters keys equipment by slot)
    await query(
      'DELETE FROM character_items WHERE character_id = $1 AND equipped_slot IS NOT NULL',
      [character.id]
    );
    for (const [templateId, slot, modifications] of rows) {
      await query(
        `INSERT INTO character_items (character_id, item_template_id, quantity, equipped_slot, modifications)
         VALUES ($1, $2, 1, $3, $4)`,
        [character.id, templateId, slot, JSON.stringify(modifications)]
      );
    }
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('sumEquipmentStats matches the SQL lateral used by battle and /stats', async () => {
    const res = await request('GET', `/api/characters/${character.id}/stats`, null, user.accessToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const sqlBonuses = res.body.stats.equipmentBonuses;

    const equipped = await query(
      `SELECT it.stat_bonuses, ci.modifications
       FROM character_items ci JOIN item_templates it ON ci.item_template_id = it.id
       WHERE ci.character_id = $1 AND ci.equipped_slot IS NOT NULL`,
      [character.id]
    );
    const jsBonuses = sumEquipmentStats(equipped.rows);

    assert.deepEqual(jsBonuses, sqlBonuses);
    // The {} drop contributed its template stats
    assert.ok(Object.values(sqlBonuses).some(v => v > 0));
  });

  it('the client total over GET /characters matches /stats for primary stats and HP/MP', async () => {
    const [listRes, statsRes] = await Promise.all([
      request('GET', '/api/characters', null, user.accessToken),
      request('GET', `/api/characters/${character.id}/stats`, null, user.accessToken)
    ]);
    assert.equal(listRes.status, 200);
    const row = listRes.body.characters.find(c => c.id === character.id);
    const client = withEquipmentStats(row);
    const stats = statsRes.body.stats;

    // Includes the body row's legacy top-level agility: 1, which the payload
    // folds into bonusStats (resolveItemBonusStats)
    for (const key of PRIMARY) {
      assert.equal(client[key], stats[key], key);
    }
    assert.equal(client.hp_max, stats.hp.max, 'hp_max');
    assert.equal(client.mp_max, stats.mp.max, 'mp_max');
  });
});
