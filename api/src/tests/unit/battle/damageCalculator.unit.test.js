import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import {
  calculateMagicalDamage,
  calculatePhysicalDamage
} from '../../../services/battle/damageCalculator.js';

function createUnit(overrides = {}) {
  return {
    type: 'player',
    strength: 100,
    intelligence: 100,
    agility: 0,
    vitality: 0,
    luck: 0,
    attack: 0,
    defense: 0,
    magicAttack: 0,
    magicDefense: 0,
    statusEffects: [],
    traits: [],
    ...overrides
  };
}

function withRandomValues(values, callback) {
  let index = 0;
  const random = mock.method(
    Math,
    'random',
    () => values[Math.min(index++, values.length - 1)]
  );
  try {
    return callback();
  } finally {
    random.mock.restore();
  }
}

describe('zodiac collection combat modifiers', () => {
  it('increases only player physical damage by the cumulative modifier', () => {
    const defender = createUnit({ type: 'enemy', strength: 0, intelligence: 0 });
    const player = createUnit({
      zodiacCollectionBonus: { physicalDamage: 0.03 }
    });
    const enemy = createUnit({
      type: 'enemy',
      zodiacCollectionBonus: { physicalDamage: 0.50 }
    });

    const playerResult = withRandomValues(
      [0.5, 0.99],
      () => calculatePhysicalDamage(player, defender)
    );
    const enemyResult = withRandomValues(
      [0.5, 0.99],
      () => calculatePhysicalDamage(enemy, defender)
    );

    assert.strictEqual(playerResult.damage, 103);
    assert.strictEqual(enemyResult.damage, 100);
  });

  it('applies cumulative defense to physical and magical mitigation', () => {
    const attacker = createUnit();
    const defenderWithoutBonus = createUnit({
      vitality: 100,
      intelligence: 0,
      magicDefense: 100
    });
    const defenderWithBonus = {
      ...defenderWithoutBonus,
      zodiacCollectionBonus: { defense: 0.03 }
    };

    const normalPhysical = withRandomValues(
      [0.5, 0.99],
      () => calculatePhysicalDamage(attacker, defenderWithoutBonus)
    );
    const bonusPhysical = withRandomValues(
      [0.5, 0.99],
      () => calculatePhysicalDamage(attacker, defenderWithBonus)
    );
    const normalMagical = withRandomValues(
      [0.5, 0.99],
      () => calculateMagicalDamage(attacker, defenderWithoutBonus)
    );
    const bonusMagical = withRandomValues(
      [0.5, 0.99],
      () => calculateMagicalDamage(attacker, defenderWithBonus)
    );

    assert.ok(bonusPhysical.damage < normalPhysical.damage);
    assert.ok(bonusMagical.damage < normalMagical.damage);
  });

  it('adds crystal critical chance without changing the existing cap', () => {
    const defender = createUnit({ type: 'enemy' });
    const noBonus = createUnit();
    const withBonus = createUnit({
      zodiacCollectionBonus: { critChance: 0.03 }
    });

    const normalResult = withRandomValues(
      [0.5, 0.06],
      () => calculatePhysicalDamage(noBonus, defender)
    );
    const bonusResult = withRandomValues(
      [0.5, 0.06],
      () => calculatePhysicalDamage(withBonus, defender)
    );

    assert.strictEqual(normalResult.isCritical, false);
    assert.strictEqual(bonusResult.isCritical, true);
  });

  it('preserves physical and magical formulas when no aggregate is present', () => {
    const attacker = createUnit();
    const defender = createUnit({ type: 'enemy', vitality: 0 });

    const physical = withRandomValues(
      [0.5, 0.99],
      () => calculatePhysicalDamage(attacker, defender)
    );
    const magical = withRandomValues(
      [0.5, 0.99],
      () => calculateMagicalDamage(attacker, defender)
    );

    assert.strictEqual(physical.damage, 100);
    // Existing magical defense includes half of defender intelligence:
    // 100 * (1 - 50 / (50 + 80)) = 61.53, floored.
    assert.strictEqual(magical.damage, 61);
    assert.strictEqual(physical.isCritical, false);
    assert.strictEqual(magical.isCritical, false);
  });
});

describe('zodiac signature combat modifiers', () => {
  it("adds Ram's Charge as 25 percentage points of basic crit chance", () => {
    const attacker = createUnit();
    const defender = createUnit({ type: 'enemy' });

    const normal = withRandomValues(
      [0.5, 0.20],
      () => calculatePhysicalDamage(attacker, defender)
    );
    const charged = withRandomValues(
      [0.5, 0.20],
      () => calculatePhysicalDamage(
        attacker,
        defender,
        100,
        null,
        { critChanceBonus: 0.25 }
      )
    );

    assert.strictEqual(normal.isCritical, false);
    assert.strictEqual(charged.isCritical, true);
  });

  it("uses Mountain's Endurance for physical and magical defense", () => {
    const attacker = createUnit();
    const defender = createUnit({
      vitality: 80,
      intelligence: 0,
      magicDefense: 80
    });
    const enduringDefender = {
      ...defender,
      statusEffects: [{
        type: 'defense_up',
        duration: 2,
        value: 0.25,
        modifiers: {
          defense: 1.25,
          magicDefense: 1.25
        }
      }]
    };

    const normalPhysical = withRandomValues(
      [0.5, 0.99],
      () => calculatePhysicalDamage(attacker, defender)
    );
    const enduringPhysical = withRandomValues(
      [0.5, 0.99],
      () => calculatePhysicalDamage(attacker, enduringDefender)
    );
    const normalMagical = withRandomValues(
      [0.5, 0.99],
      () => calculateMagicalDamage(attacker, defender)
    );
    const enduringMagical = withRandomValues(
      [0.5, 0.99],
      () => calculateMagicalDamage(attacker, enduringDefender)
    );

    assert.ok(enduringPhysical.damage < normalPhysical.damage);
    assert.ok(enduringMagical.damage < normalMagical.damage);
  });
});
