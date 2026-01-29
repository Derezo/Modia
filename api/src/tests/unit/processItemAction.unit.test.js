/**
 * processItemAction Unit Tests
 *
 * Tests item consumption during battle via processAction(state, unit, 'item', targetTile, itemId).
 * The processItemAction function is internal to actionProcessor.js and invoked through
 * the exported processAction dispatcher.
 *
 * Covers: heal_hp, heal_mp, heal_both, cure_poison, cure_all, revive,
 * overheal capping, quantity decrement/removal, error cases, targeting logic,
 * and NPC consumable handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { processAction } from '../../services/battle/actionProcessor.js';

/**
 * Build a fresh battle state for each test.
 * Deep-cloned via JSON round-trip to prevent cross-test contamination.
 */
function createBaseState() {
  return JSON.parse(JSON.stringify({
    units: [
      {
        id: 'p1', type: 'player', tileX: 3, tileY: 3,
        hp: 100, maxHp: 200, mp: 20, maxMp: 100,
        statusEffects: [], actUsed: false, moveUsed: false, skills: []
      },
      {
        id: 'p2', type: 'player', tileX: 4, tileY: 3,
        hp: 50, maxHp: 200, mp: 10, maxMp: 100,
        statusEffects: [{ type: 'poison' }, { type: 'blind' }],
        actUsed: false, moveUsed: false, skills: []
      },
      {
        id: 'p3_dead', type: 'player', tileX: 5, tileY: 3,
        hp: 0, maxHp: 200, mp: 0, maxMp: 100,
        statusEffects: [], actUsed: false, moveUsed: false, skills: []
      },
      {
        id: 'e1', type: 'enemy', tileX: 7, tileY: 3,
        hp: 100, maxHp: 150, mp: 30, maxMp: 50,
        statusEffects: [{ type: 'poison' }],
        actUsed: false, moveUsed: false, skills: [],
        consumables: [
          { itemId: 12, name: 'Health Potion', effectType: 'heal_hp', effectValue: 50, quantity: 1, inventoryId: 201 }
        ]
      }
    ],
    consumables: [
      { itemId: 12, name: 'Health Potion', effectType: 'heal_hp', effectValue: 50, quantity: 2, inventoryId: 101 },
      { itemId: 13, name: 'Mana Potion', effectType: 'heal_mp', effectValue: 30, quantity: 1, inventoryId: 102 },
      { itemId: 31, name: 'Elixir', effectType: 'heal_both', effectValue: 100, quantity: 1, inventoryId: 103 },
      { itemId: 14, name: 'Antidote', effectType: 'cure_poison', effectValue: 0, quantity: 1, inventoryId: 104 },
      { itemId: 32, name: 'Status Cure', effectType: 'cure_all', effectValue: 0, quantity: 1, inventoryId: 105 },
      { itemId: 15, name: 'Phoenix Feather', effectType: 'revive', effectValue: 50, quantity: 1, inventoryId: 106 }
    ],
    terrain: { width: 10, height: 10, tiles: [] }
  }));
}

/**
 * Add Throw Item skill to a unit at a specified level.
 * Throw Item allows targeting allies with items.
 * Range: 2 + floor(level / 5) tiles
 * Effectiveness: 60% + (level * 2)%
 */
function addThrowItemSkill(unit, level = 20) {
  unit.skills = unit.skills || [];
  unit.skills.push({ id: 'throw_item', level, type: 'passive' });
}

/**
 * Add Efficient Mixing skill to a unit at a specified level.
 * Increases item effectiveness by 10% per level.
 */
function addEfficientMixingSkill(unit, level = 10) {
  unit.skills = unit.skills || [];
  unit.skills.push({ id: 'efficient_mixing', level, type: 'passive' });
}

// ---------------------------------------------------------------------------
// heal_hp
// ---------------------------------------------------------------------------
describe('processItemAction - heal_hp', () => {
  it('restores absolute HP to self when no target tile', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1: hp=100, maxHp=200

    const result = processAction(state, unit, 'item', null, 12);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.strictEqual(unit.hp, 150, 'HP should increase by effectValue (50)');
    assert.strictEqual(result.healing, 50);
    assert.strictEqual(result.effectType, 'heal_hp');
    assert.strictEqual(result.targetId, 'p1');
  });

  it('restores absolute HP to ally at target tile (with Throw Item skill)', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1
    addThrowItemSkill(unit, 20); // Level 20 = 100% effectiveness
    const targetTile = { x: 4, y: 3 }; // p2 location

    const result = processAction(state, unit, 'item', targetTile, 12);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    const p2 = state.units[1];
    assert.strictEqual(p2.hp, 100, 'Ally HP should increase by 50 (50 + 50)');
    assert.strictEqual(result.targetId, 'p2');
  });

  it('returns error when targeting ally without Throw Item skill', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1, no Throw Item skill
    const targetTile = { x: 4, y: 3 }; // p2 location

    const result = processAction(state, unit, 'item', targetTile, 12);

    assert.ok(result.error);
    assert.match(result.error, /throw item/i);
  });

  it('does not overheal past maxHp', () => {
    const state = createBaseState();
    const unit = state.units[0];
    unit.hp = 180; // Only 20 below max

    const result = processAction(state, unit, 'item', null, 12);

    assert.ok(!result.error);
    assert.strictEqual(unit.hp, 200, 'HP should cap at maxHp');
    assert.strictEqual(result.healing, 20, 'Healing reported should be actual amount restored');
  });
});

// ---------------------------------------------------------------------------
// heal_mp
// ---------------------------------------------------------------------------
describe('processItemAction - heal_mp', () => {
  it('restores absolute MP to self', () => {
    const state = createBaseState();
    const unit = state.units[0]; // mp=20, maxMp=100

    const result = processAction(state, unit, 'item', null, 13);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.strictEqual(unit.mp, 50, 'MP should increase by effectValue (30)');
    assert.strictEqual(result.mpRestored, 30);
    assert.strictEqual(result.effectType, 'heal_mp');
  });

  it('does not overheal past maxMp', () => {
    const state = createBaseState();
    const unit = state.units[0];
    unit.mp = 90; // Only 10 below max

    const result = processAction(state, unit, 'item', null, 13);

    assert.ok(!result.error);
    assert.strictEqual(unit.mp, 100, 'MP should cap at maxMp');
    assert.strictEqual(result.mpRestored, 10, 'Restored amount should reflect actual gain');
  });
});

// ---------------------------------------------------------------------------
// heal_both
// ---------------------------------------------------------------------------
describe('processItemAction - heal_both', () => {
  it('restores full effectValue HP and floor(effectValue/2) MP', () => {
    const state = createBaseState();
    const unit = state.units[0]; // hp=100/200, mp=20/100

    const result = processAction(state, unit, 'item', null, 31);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.strictEqual(unit.hp, 200, 'HP should increase by 100 (capped at maxHp)');
    assert.strictEqual(unit.mp, 70, 'MP should increase by floor(100/2) = 50');
    assert.strictEqual(result.healing, 100);
    assert.strictEqual(result.mpRestored, 50);
    assert.strictEqual(result.effectType, 'heal_both');
  });

  it('caps both HP and MP at their maximums', () => {
    const state = createBaseState();
    const unit = state.units[0];
    unit.hp = 190;
    unit.mp = 95;

    const result = processAction(state, unit, 'item', null, 31);

    assert.ok(!result.error);
    assert.strictEqual(unit.hp, 200, 'HP capped at maxHp');
    assert.strictEqual(unit.mp, 100, 'MP capped at maxMp');
    assert.strictEqual(result.healing, 10);
    assert.strictEqual(result.mpRestored, 5);
  });
});

// ---------------------------------------------------------------------------
// cure_poison
// ---------------------------------------------------------------------------
describe('processItemAction - cure_poison', () => {
  it('removes only poison status effect (with Throw Item skill)', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1 uses antidote on p2
    addThrowItemSkill(unit, 20);
    const targetTile = { x: 4, y: 3 }; // p2 has poison + blind

    const result = processAction(state, unit, 'item', targetTile, 14);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    const p2 = state.units[1];
    assert.strictEqual(p2.statusEffects.length, 1, 'Should have 1 effect remaining');
    assert.strictEqual(p2.statusEffects[0].type, 'blind', 'Blind should remain');
    assert.strictEqual(result.effectType, 'cure_poison');
  });

  it('is a no-op when target has no poison', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1 has no poison

    const result = processAction(state, unit, 'item', null, 14);

    assert.ok(!result.error);
    assert.strictEqual(unit.statusEffects.length, 0, 'No effects to remove');
  });
});

// ---------------------------------------------------------------------------
// cure_all
// ---------------------------------------------------------------------------
describe('processItemAction - cure_all', () => {
  it('removes poison, blind, silence, slow, and burn (with Throw Item skill)', () => {
    const state = createBaseState();
    const unit = state.units[0];
    addThrowItemSkill(unit, 20);
    // Give p2 a full set of debuffs plus a buff that should survive
    const p2 = state.units[1];
    p2.statusEffects = [
      { type: 'poison' },
      { type: 'blind' },
      { type: 'silence' },
      { type: 'slow' },
      { type: 'burn' },
      { type: 'regen' } // buff - should NOT be removed
    ];
    const targetTile = { x: 4, y: 3 };

    const result = processAction(state, unit, 'item', targetTile, 32);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.strictEqual(p2.statusEffects.length, 1, 'Only regen should remain');
    assert.strictEqual(p2.statusEffects[0].type, 'regen');
    assert.strictEqual(result.effectType, 'cure_all');
  });
});

// ---------------------------------------------------------------------------
// revive
// ---------------------------------------------------------------------------
describe('processItemAction - revive', () => {
  it('restores dead unit with percentage-based HP (with Throw Item skill)', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1 uses Phoenix Feather
    addThrowItemSkill(unit, 20); // Level 20 = 100% effectiveness
    const targetTile = { x: 5, y: 3 }; // p3_dead: hp=0, maxHp=200

    const result = processAction(state, unit, 'item', targetTile, 15);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    const p3 = state.units[2];
    // effectValue=50 means 50% of maxHp=200 => 100
    assert.strictEqual(p3.hp, 100, 'Revived unit should have 50% of maxHp');
    assert.strictEqual(result.effectType, 'revive');
    assert.strictEqual(result.targetId, 'p3_dead');
  });

  it('returns error when targeting alive unit with revive item', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1 targets self (alive)

    const result = processAction(state, unit, 'item', null, 15);

    assert.ok(result.error, 'Should return an error');
    assert.match(result.error, /not defeated/i);
  });
});

// ---------------------------------------------------------------------------
// Quantity management
// ---------------------------------------------------------------------------
describe('processItemAction - consumable quantity', () => {
  it('decrements quantity after use', () => {
    const state = createBaseState();
    const unit = state.units[0];
    // Health Potion starts with quantity=2
    assert.strictEqual(state.consumables[0].quantity, 2);

    processAction(state, unit, 'item', null, 12);

    assert.strictEqual(state.consumables[0].quantity, 1, 'Quantity should decrement by 1');
  });

  it('removes consumable from array when quantity reaches 0', () => {
    const state = createBaseState();
    const unit = state.units[0];
    // Mana Potion starts with quantity=1
    const initialCount = state.consumables.length;

    processAction(state, unit, 'item', null, 13);

    assert.strictEqual(state.consumables.length, initialCount - 1, 'Consumable should be removed');
    const manaPotion = state.consumables.find(c => c.itemId === 13);
    assert.strictEqual(manaPotion, undefined, 'Mana Potion should no longer exist');
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------
describe('processItemAction - error cases', () => {
  it('returns error for unavailable item', () => {
    const state = createBaseState();
    const unit = state.units[0];

    const result = processAction(state, unit, 'item', null, 999);

    assert.ok(result.error);
    assert.match(result.error, /not available/i);
  });

  it('returns error when targeting dead unit with non-revive item', () => {
    const state = createBaseState();
    const unit = state.units[0];
    addThrowItemSkill(unit, 20); // Need Throw Item to target others
    const targetTile = { x: 5, y: 3 }; // p3_dead

    const result = processAction(state, unit, 'item', targetTile, 12);

    assert.ok(result.error);
    assert.match(result.error, /defeated/i);
  });

  it('returns error when unit has already acted', () => {
    const state = createBaseState();
    const unit = state.units[0];
    unit.actUsed = true;

    const result = processAction(state, unit, 'item', null, 12);

    assert.ok(result.error);
    assert.match(result.error, /already acted/i);
  });

  it('returns error when unit cannot act due to status effect', () => {
    const state = createBaseState();
    const unit = state.units[0];
    unit.statusEffects = [{ type: 'stun' }];

    const result = processAction(state, unit, 'item', null, 12);

    assert.ok(result.error);
    assert.match(result.error, /cannot act/i);
  });
});

// ---------------------------------------------------------------------------
// Targeting logic
// ---------------------------------------------------------------------------
describe('processItemAction - targeting', () => {
  it('targets ally at specified tile (same unit.type) with Throw Item skill', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1 (player)
    addThrowItemSkill(unit, 20);
    const targetTile = { x: 4, y: 3 }; // p2 (player)

    const result = processAction(state, unit, 'item', targetTile, 12);

    assert.ok(!result.error);
    assert.strictEqual(result.targetId, 'p2', 'Should target ally at tile');
  });

  it('defaults to self when no target at tile', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1
    const targetTile = { x: 9, y: 9 }; // empty tile

    const result = processAction(state, unit, 'item', targetTile, 12);

    assert.ok(!result.error);
    assert.strictEqual(result.targetId, 'p1', 'Should default to self');
  });

  it('defaults to self when target at tile is different type (enemy)', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1 (player)
    const targetTile = { x: 7, y: 3 }; // e1 (enemy)

    const result = processAction(state, unit, 'item', targetTile, 12);

    assert.ok(!result.error);
    assert.strictEqual(result.targetId, 'p1', 'Should default to self when target is enemy');
  });
});

// ---------------------------------------------------------------------------
// NPC consumable handling
// ---------------------------------------------------------------------------
describe('processItemAction - NPC consumables', () => {
  it('uses unit.consumables for enemy units (not state.consumables)', () => {
    const state = createBaseState();
    const enemy = state.units[3]; // e1: hp=100, maxHp=150, has own consumables
    const stateConsumableCount = state.consumables.length;

    const result = processAction(state, enemy, 'item', null, 12);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.strictEqual(enemy.hp, 150, 'Enemy HP should increase by 50');
    assert.strictEqual(state.consumables.length, stateConsumableCount, 'state.consumables should be unchanged');
  });

  it('removes NPC consumable from unit.consumables when depleted', () => {
    const state = createBaseState();
    const enemy = state.units[3]; // e1 has quantity=1
    assert.strictEqual(enemy.consumables.length, 1);

    processAction(state, enemy, 'item', null, 12);

    assert.strictEqual(enemy.consumables.length, 0, 'Depleted item should be removed from unit.consumables');
  });
});

// ---------------------------------------------------------------------------
// Result metadata
// ---------------------------------------------------------------------------
describe('processItemAction - result metadata', () => {
  it('includes effectType in result', () => {
    const state = createBaseState();
    const unit = state.units[0];

    const result = processAction(state, unit, 'item', null, 12);

    assert.ok(!result.error);
    assert.strictEqual(result.effectType, 'heal_hp');
  });

  it('includes consumedInventoryId in result', () => {
    const state = createBaseState();
    const unit = state.units[0];

    const result = processAction(state, unit, 'item', null, 12);

    assert.ok(!result.error);
    assert.strictEqual(result.consumedInventoryId, 101);
  });

  it('includes itemName in result', () => {
    const state = createBaseState();
    const unit = state.units[0];

    const result = processAction(state, unit, 'item', null, 12);

    assert.ok(!result.error);
    assert.strictEqual(result.itemName, 'Health Potion');
  });

  it('marks actUsed after successful item use', () => {
    const state = createBaseState();
    const unit = state.units[0];

    processAction(state, unit, 'item', null, 12);

    assert.strictEqual(unit.actUsed, true);
  });

  it('includes itemEffects array with heal entry', () => {
    const state = createBaseState();
    const unit = state.units[0];

    const result = processAction(state, unit, 'item', null, 12);

    assert.ok(Array.isArray(result.itemEffects));
    assert.strictEqual(result.itemEffects.length, 1);
    assert.strictEqual(result.itemEffects[0].type, 'heal');
    assert.strictEqual(result.itemEffects[0].amount, 50);
    assert.strictEqual(result.itemEffects[0].targetId, 'p1');
  });

  it('includes two itemEffects entries for heal_both', () => {
    const state = createBaseState();
    const unit = state.units[0];

    const result = processAction(state, unit, 'item', null, 31);

    assert.ok(Array.isArray(result.itemEffects));
    assert.strictEqual(result.itemEffects.length, 2);
    assert.strictEqual(result.itemEffects[0].type, 'heal');
    assert.strictEqual(result.itemEffects[1].type, 'mpRestore');
  });
});

// ---------------------------------------------------------------------------
// Throw Item skill mechanics
// ---------------------------------------------------------------------------
describe('processItemAction - Throw Item skill', () => {
  it('allows targeting allies within range based on skill level', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1 at (3,3)
    addThrowItemSkill(unit, 5); // Level 5 = range 2 + floor(5/5) = 3
    const targetTile = { x: 4, y: 3 }; // p2 at distance 1

    const result = processAction(state, unit, 'item', targetTile, 12);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.strictEqual(result.targetId, 'p2');
  });

  it('returns error when target is out of throw range', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1 at (3,3)
    addThrowItemSkill(unit, 1); // Level 1 = range 2 + floor(1/5) = 2
    // Move p2 farther away (distance 4)
    state.units[1].tileX = 7;
    state.units[1].tileY = 3;
    const targetTile = { x: 7, y: 3 };

    const result = processAction(state, unit, 'item', targetTile, 12);

    assert.ok(result.error);
    assert.match(result.error, /out of throw range/i);
  });

  it('applies effectiveness penalty at low Throw Item levels', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1
    addThrowItemSkill(unit, 1); // Level 1 = 60% + (1*2)% = 62% effectiveness
    const targetTile = { x: 4, y: 3 }; // p2: hp=50, maxHp=200

    const result = processAction(state, unit, 'item', targetTile, 12);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    // effectValue=50, effectiveness=0.62, so healed amount = floor(50 * 0.62) = 31
    const p2 = state.units[1];
    assert.strictEqual(p2.hp, 81, 'Ally HP should increase by 31 (50 * 0.62)');
    assert.strictEqual(result.effectiveness, 0.62);
  });

  it('applies full effectiveness at Throw Item level 20', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1
    addThrowItemSkill(unit, 20); // Level 20 = 60% + (20*2)% = 100% effectiveness
    const targetTile = { x: 4, y: 3 }; // p2: hp=50, maxHp=200

    const result = processAction(state, unit, 'item', targetTile, 12);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    const p2 = state.units[1];
    assert.strictEqual(p2.hp, 100, 'Ally HP should increase by full 50');
    assert.strictEqual(result.effectiveness, 1.0);
  });

  it('has 100% effectiveness when targeting self (no penalty)', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1: hp=100, maxHp=200
    // No Throw Item skill, but targeting self should still work

    const result = processAction(state, unit, 'item', null, 12);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.strictEqual(unit.hp, 150, 'Self-target HP should increase by full 50');
    assert.strictEqual(result.effectiveness, 1.0);
  });

  it('scales throw range with skill level', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1 at (3,3)
    addThrowItemSkill(unit, 15); // Level 15 = range 2 + floor(15/5) = 5
    // Move p2 to distance 5
    state.units[1].tileX = 8;
    state.units[1].tileY = 3;
    const targetTile = { x: 8, y: 3 };

    const result = processAction(state, unit, 'item', targetTile, 12);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    assert.strictEqual(result.targetId, 'p2');
  });
});

// ---------------------------------------------------------------------------
// Efficient Mixing skill integration
// ---------------------------------------------------------------------------
describe('processItemAction - Efficient Mixing skill', () => {
  it('increases item effectiveness when used on self', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1: hp=100, maxHp=200
    addEfficientMixingSkill(unit, 10); // +100% effectiveness

    const result = processAction(state, unit, 'item', null, 12);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    // effectValue=50, Efficient Mixing bonus = 1 + (10*0.1) = 2.0
    // So healed amount = floor(50 * 2.0) = 100
    assert.strictEqual(unit.hp, 200, 'HP should increase by 100 (50 * 2.0), capped at maxHp');
  });

  it('stacks with Throw Item effectiveness', () => {
    const state = createBaseState();
    const unit = state.units[0]; // p1
    addThrowItemSkill(unit, 10); // Level 10 = 60% + (10*2)% = 80% effectiveness
    addEfficientMixingSkill(unit, 5); // +50% effectiveness bonus
    const targetTile = { x: 4, y: 3 }; // p2: hp=50, maxHp=200

    const result = processAction(state, unit, 'item', targetTile, 12);

    assert.ok(!result.error, `Unexpected error: ${result.error}`);
    // Throw Item: 0.80 effectiveness
    // Efficient Mixing: 1 + (5*0.1) = 1.5 multiplier
    // Final: 0.80 * 1.5 = 1.2
    // Heal: floor(50 * 1.2) = 60
    const p2 = state.units[1];
    assert.strictEqual(p2.hp, 110, 'Ally HP should increase by 60 (50 * 0.80 * 1.5)');
    // Use approximate comparison for floating point
    assert.ok(Math.abs(result.effectiveness - 1.2) < 0.0001, `Effectiveness should be ~1.2, got ${result.effectiveness}`);
  });
});
