/**
 * Combat augment effects (crit_chance, crit_damage, lifesteal, ...) must be
 * loaded for every battle mode: PvE start, guildmaster advancement and
 * coliseum. Previously only POST /battle/start passed them, so the augments
 * silently did nothing in advancement and ranked PvP.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadEquipmentAugmentEffects } from '../../services/battle/equipmentAugmentEffects.js';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readSource = relativePath => readFile(resolve(sourceRoot, relativePath), 'utf8');

describe('loadEquipmentAugmentEffects', () => {
  it('aggregates equipped augment effects per character', async () => {
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
        return {
          rows: [
            { character_id: 1, modifications: { augments: [{ effect: { type: 'crit_chance', value: 0.05 } }] } },
            { character_id: 1, modifications: JSON.stringify({ augments: [{ effect: { type: 'lifesteal', value: 0.1 } }] }) },
            { character_id: 2, modifications: { augments: [{ effect: { type: 'crit_damage', value: 0.2 } }] } }
          ]
        };
      }
    };
    const effects = await loadEquipmentAugmentEffects(client, [1, 2, 3, 2]);
    assert.deepEqual(effects, {
      1: { crit_chance: 0.05, lifesteal: 0.1 },
      2: { crit_damage: 0.2 },
      3: {}
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /equipped_slot IS NOT NULL/);
    assert.deepEqual(calls[0].params, [[1, 2, 3]]);
  });

  it('skips the query when there are no characters', async () => {
    const client = { query: () => assert.fail('no query expected') };
    assert.deepEqual(await loadEquipmentAugmentEffects(client, []), {});
  });

  it('is passed to createPlayerBattleUnit by every battle mode', async () => {
    const pve = await readSource('routes/battle.js');
    assert.match(pve, /equipmentAugmentEffects: characterAugmentEffects\[character\.id\]/);
    assert.match(pve, /await loadEquipmentAugmentEffects\(/);

    const guildmaster = await readSource('services/guildmasterBattleService.js');
    assert.match(guildmaster, /equipmentAugmentEffects: augmentEffects\[Number\(character\.id\)\]/);

    const coliseum = await readSource('services/coliseum/matchLifecycle.js');
    const passes = coliseum.match(/equipmentAugmentEffects: augmentEffects\[Number\(char\.id\)\]/g) || [];
    assert.equal(passes.length, 2, 'both coliseum teams get augment effects');
  });
});
