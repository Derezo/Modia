import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateItemPower, canCharacterEquip, hasEquipmentUpgrade } from '../statDisplay.js';

const SLOTS = ['head', 'body', 'main_hand', 'feet', 'accessory'];

describe('hasEquipmentUpgrade (Formation upgrade badge)', () => {
  const character = { class: 'warrior', level: 5 };
  const equipment = { head: { type: 'armor', equipmentSlot: 'head', baseStats: { vitality: 2 } } };

  it('sums a bonus stat that shares a key with a base stat', () => {
    assert.equal(calculateItemPower({ baseStats: { strength: 5 }, bonusStats: { strength: 3 } }), 8);
  });

  it('ignores stronger items that belong to a different template slot', () => {
    const inventory = [{ type: 'armor', equipmentSlot: 'body', baseStats: { vitality: 1 } }];
    // body is empty, so a body armor IS an upgrade there, but not for head
    assert.equal(canCharacterEquip(inventory[0], 'head', character), false);
    assert.equal(hasEquipmentUpgrade(equipment, inventory, character, ['head']), false);
    assert.equal(hasEquipmentUpgrade(equipment, inventory, character, SLOTS), true);
  });

  it('ignores items above the character level or for another class', () => {
    assert.equal(hasEquipmentUpgrade(equipment, [
      { type: 'armor', equipmentSlot: 'head', level_requirement: 10, baseStats: { vitality: 9 } }
    ], character, SLOTS), false);
    assert.equal(hasEquipmentUpgrade(equipment, [
      { type: 'armor', equipmentSlot: 'head', class_restriction: ['wizard'], baseStats: { vitality: 9 } }
    ], character, SLOTS), false);
    assert.equal(hasEquipmentUpgrade(equipment, [
      { type: 'armor', equipmentSlot: 'head', class_restriction: 'wizard', baseStats: { vitality: 9 } }
    ], character, SLOTS), false);
  });

  it('flags a usable, stronger item', () => {
    assert.equal(hasEquipmentUpgrade(equipment, [
      { type: 'armor', equipmentSlot: 'head', baseStats: { vitality: 1 }, bonusStats: { vitality: 4 } }
    ], character, SLOTS), true);
  });

  it('returns false when equipment data is missing', () => {
    assert.equal(hasEquipmentUpgrade(null, [{ type: 'armor' }], character, SLOTS), false);
  });
});
