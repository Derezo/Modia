/**
 * The equip rule shared by POST /api/inventory/equip and the client's slot
 * pickers / Quick Equip / GEAR badge (frontend/src/utils/statDisplay.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getValidSlotsForItemType,
  getSlotMismatch,
  getRequirementFailure,
  parseRestrictionList
} from './equipmentRules.js';

describe('getSlotMismatch', () => {
  it('rejects a slot the item type cannot use', () => {
    assert.deepEqual(getSlotMismatch('armor', null, 'main_hand'), { reason: 'type' });
    assert.deepEqual(getSlotMismatch('consumable', null, 'accessory'), { reason: 'type' });
    assert.deepEqual(getSlotMismatch('weapon', null, undefined), { reason: 'type' });
  });

  it('keeps an item in its template slot (no dual-wield)', () => {
    assert.equal(getSlotMismatch('weapon', 'main_hand', 'main_hand'), null);
    assert.deepEqual(getSlotMismatch('weapon', 'main_hand', 'off_hand'), { reason: 'template_slot', slot: 'main_hand' });
    assert.equal(getSlotMismatch('weapon', 'off_hand', 'off_hand'), null);
    assert.deepEqual(getSlotMismatch('weapon', 'off_hand', 'main_hand'), { reason: 'template_slot', slot: 'off_hand' });
    assert.deepEqual(getSlotMismatch('armor', 'head', 'body'), { reason: 'template_slot', slot: 'head' });
  });

  it('allows any slot of the type when the template names none', () => {
    assert.equal(getSlotMismatch('armor', null, 'feet'), null);
    assert.equal(getSlotMismatch('Weapon', null, 'off_hand'), null);
  });

  it('maps item types to the equipment_slot enum', () => {
    assert.deepEqual([...getValidSlotsForItemType('weapon')], ['main_hand', 'off_hand']);
    assert.deepEqual([...getValidSlotsForItemType('accessory')], ['accessory']);
    assert.deepEqual([...getValidSlotsForItemType('material')], []);
  });
});

describe('getRequirementFailure', () => {
  const warrior = { level: 10, class: 'warrior', race: 'dwarf' };

  it('passes when there are no requirements', () => {
    assert.equal(getRequirementFailure({}, warrior), null);
    assert.equal(getRequirementFailure({ level: 0, classes: [], races: [] }, warrior), null);
  });

  it('checks level first', () => {
    assert.deepEqual(
      getRequirementFailure({ level: 15, classes: ['mage'] }, warrior),
      { reason: 'level', level: 15 }
    );
    assert.equal(getRequirementFailure({ level: 10 }, warrior), null);
  });

  it('checks class, then race, case-insensitively', () => {
    assert.deepEqual(getRequirementFailure({ classes: ['mage', 'rogue'] }, warrior), { reason: 'class', allowed: ['mage', 'rogue'] });
    assert.equal(getRequirementFailure({ classes: ['Warrior'] }, warrior), null);
    assert.deepEqual(getRequirementFailure({ races: ['elf'] }, warrior), { reason: 'race', allowed: ['elf'] });
    assert.equal(getRequirementFailure({ races: ['DWARF'] }, warrior), null);
  });

  it('reads the Postgres enum-array literal node-postgres returns', () => {
    assert.deepEqual(parseRestrictionList('{warrior,mage}'), ['warrior', 'mage']);
    assert.deepEqual(parseRestrictionList('{}'), []);
    assert.deepEqual(parseRestrictionList('warrior'), ['warrior']);
    assert.deepEqual(parseRestrictionList(null), []);
    assert.equal(getRequirementFailure({ classes: '{warrior,mage}' }, warrior), null);
    // '{archmage}' must not match 'mage' as a substring
    assert.deepEqual(
      getRequirementFailure({ classes: '{archmage}' }, { level: 1, class: 'mage' }),
      { reason: 'class', allowed: ['archmage'] }
    );
  });
});
