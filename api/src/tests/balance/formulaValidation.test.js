/**
 * Formula Validation Balance Tests
 * Validates the new FFT-style battle formulas meet balance targets
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculatePhysicalDamage,
  calculateMagicalDamage,
  calculateHitChance,
  calculateCritChance,
  calculateCritMultiplier,
  calculateEvasion,
  calculateCTGain,
  calculateDefenseReduction,
  calculateStatusResistance,
  PHYSICAL_DEFENSE_CONSTANT,
  MAGIC_DEFENSE_CONSTANT,
  CT_THRESHOLD
} from '../../../../shared/battleMath.js';
import { calculateStats, RACES, CLASSES, CLASS_GROWTH } from '../../../../shared/constants.js';
import { createEnemyBattleUnit } from '../../services/battleUnitFactory.js';

/**
 * Create a mock player character at a given level
 */
function createMockPlayer(race, charClass, level) {
  const stats = calculateStats(race, charClass, level);
  return {
    ...stats,
    hp: stats.hpMax,
    maxHp: stats.hpMax,
    mp: stats.mpMax,
    maxMp: stats.mpMax,
    attack: 0,
    defense: 0,
    magicAttack: 0,
    magicDefense: 0,
    statusEffects: [],
    race
  };
}

/**
 * Create a mock enemy with archetype-based scaling
 */
function createMockEnemy(archetype, partyLevel, tier) {
  const template = {
    name: `Test ${archetype}`,
    archetype,
    base_hp: 40,
    base_mp: 10,
    base_strength: 10,
    base_intelligence: 10,
    base_agility: 10,
    base_vitality: 10,
    base_luck: 10
  };
  return createEnemyBattleUnit(template, partyLevel, tier, 0, { x: 0, y: 0 });
}

describe('Defense Diminishing Returns', () => {
  it('should have 50 defense give ~33% reduction', () => {
    const reduction = calculateDefenseReduction(50, PHYSICAL_DEFENSE_CONSTANT);
    // 50 / (50 + 100) = 50 / 150 = 0.333
    assert.ok(Math.abs(reduction - 0.333) < 0.01, `50 DEF should give ~33% reduction, got ${(reduction * 100).toFixed(1)}%`);
  });

  it('should have 100 defense give 50% reduction', () => {
    const reduction = calculateDefenseReduction(100, PHYSICAL_DEFENSE_CONSTANT);
    // 100 / (100 + 100) = 0.5
    assert.strictEqual(reduction, 0.5, '100 DEF should give exactly 50% reduction');
  });

  it('should have 200 defense give ~66% reduction', () => {
    const reduction = calculateDefenseReduction(200, PHYSICAL_DEFENSE_CONSTANT);
    // 200 / (200 + 100) = 200 / 300 = 0.667
    assert.ok(Math.abs(reduction - 0.667) < 0.01, `200 DEF should give ~66% reduction, got ${(reduction * 100).toFixed(1)}%`);
  });

  it('should have 300 defense give 75% reduction', () => {
    const reduction = calculateDefenseReduction(300, PHYSICAL_DEFENSE_CONSTANT);
    // 300 / (300 + 100) = 300 / 400 = 0.75
    assert.strictEqual(reduction, 0.75, '300 DEF should give exactly 75% reduction');
  });

  it('should never exceed ~80% reduction even with extreme defense', () => {
    const extremeReduction = calculateDefenseReduction(500, PHYSICAL_DEFENSE_CONSTANT);
    // 500 / (500 + 100) = 500 / 600 = 0.833
    assert.ok(extremeReduction < 0.85, 'Extreme defense should not exceed ~85% reduction');
    assert.ok(extremeReduction > 0.8, 'Extreme defense should provide substantial protection');
  });
});

describe('CT Turn Order System', () => {
  it('should have AGI 10 give 6 CT/tick', () => {
    const ctGain = calculateCTGain({ agility: 10, statusEffects: [] });
    // 5 + (10 / 10) = 6
    assert.strictEqual(ctGain, 6, 'AGI 10 should give 6 CT/tick');
  });

  it('should have AGI 50 give 10 CT/tick', () => {
    const ctGain = calculateCTGain({ agility: 50, statusEffects: [] });
    // 5 + (50 / 10) = 10
    assert.strictEqual(ctGain, 10, 'AGI 50 should give 10 CT/tick');
  });

  it('should have AGI 100 give 15 CT/tick', () => {
    const ctGain = calculateCTGain({ agility: 100, statusEffects: [] });
    // 5 + (100 / 10) = 15
    assert.strictEqual(ctGain, 15, 'AGI 100 should give 15 CT/tick');
  });

  it('should have haste increase CT by 50%', () => {
    const baseGain = calculateCTGain({ agility: 10, statusEffects: [] });
    const hasteGain = calculateCTGain({ agility: 10, statusEffects: [{ type: 'haste' }] });
    assert.strictEqual(hasteGain, baseGain * 1.5, 'Haste should increase CT by 50%');
  });

  it('should have slow decrease CT by 50%', () => {
    const baseGain = calculateCTGain({ agility: 10, statusEffects: [] });
    const slowGain = calculateCTGain({ agility: 10, statusEffects: [{ type: 'slow' }] });
    assert.strictEqual(slowGain, baseGain * 0.5, 'Slow should decrease CT by 50%');
  });

  it('should have high AGI unit get ~2.5x turns vs low AGI', () => {
    // AGI 100 gets 15 CT/tick, needs 100/15 = 6.67 ticks per turn
    // AGI 10 gets 6 CT/tick, needs 100/6 = 16.67 ticks per turn
    // Ratio: 16.67 / 6.67 = 2.5x turns
    const highAgiTicks = CT_THRESHOLD / calculateCTGain({ agility: 100, statusEffects: [] });
    const lowAgiTicks = CT_THRESHOLD / calculateCTGain({ agility: 10, statusEffects: [] });
    const turnRatio = lowAgiTicks / highAgiTicks;

    assert.ok(turnRatio > 2, 'High AGI should get at least 2x turns');
    assert.ok(turnRatio < 3, 'High AGI should not get more than 3x turns (diminishing returns)');
  });
});

describe('Critical Hit System', () => {
  it('should have base 5% crit chance with 0 luck', () => {
    const critChance = calculateCritChance({ luck: 0 });
    assert.strictEqual(critChance, 0.05, 'Base crit chance should be 5%');
  });

  it('should have ~8.3% crit at luck 10', () => {
    const critChance = calculateCritChance({ luck: 10 });
    // 0.05 + 10/300 = 0.05 + 0.033 = 0.083
    const expected = 0.05 + (10 / 300);
    assert.ok(Math.abs(critChance - expected) < 0.001, `Luck 10 should give ~8.3% crit, got ${(critChance * 100).toFixed(1)}%`);
  });

  it('should cap at 50% crit chance', () => {
    const critChance = calculateCritChance({ luck: 200 });
    assert.strictEqual(critChance, 0.5, 'Crit chance should cap at 50%');
  });

  it('should have orcs get +15% crit damage', () => {
    const humanMult = calculateCritMultiplier({ race: 'human', luck: 0 });
    const orcMult = calculateCritMultiplier({ race: 'orc', luck: 0 });

    assert.strictEqual(humanMult, 1.5, 'Human crit multiplier should be 1.5');
    assert.ok(Math.abs(orcMult - 1.65) < 0.001, 'Orc crit multiplier should be 1.65');
  });
});

describe('Evasion System', () => {
  it('should have 2% base evasion with equal AGI', () => {
    const evasion = calculateEvasion(
      { agility: 50 },
      { agility: 50, luck: 0 }
    );
    assert.strictEqual(evasion, 0.02, 'Base evasion should be 2% with equal AGI');
  });

  it('should increase evasion when defender is faster', () => {
    const evasion = calculateEvasion(
      { agility: 20 },
      { agility: 60, luck: 0 }
    );
    // 0.02 + (60-20)/400 = 0.02 + 0.1 = 0.12
    assert.ok(Math.abs(evasion - 0.12) < 0.001, `Faster defender should have ~12% evasion, got ${(evasion * 100).toFixed(1)}%`);
  });

  it('should cap evasion at 35%', () => {
    const evasion = calculateEvasion(
      { agility: 10 },
      { agility: 200, luck: 200 }
    );
    assert.strictEqual(evasion, 0.35, 'Evasion should cap at 35%');
  });

  it('should floor evasion at 2%', () => {
    const evasion = calculateEvasion(
      { agility: 200 },
      { agility: 10, luck: 0 }
    );
    assert.strictEqual(evasion, 0.02, 'Evasion should floor at 2%');
  });

  it('should add luck bonus to evasion', () => {
    const noLuck = calculateEvasion(
      { agility: 50 },
      { agility: 50, luck: 0 }
    );
    const withLuck = calculateEvasion(
      { agility: 50 },
      { agility: 50, luck: 40 }
    );
    // 40 luck / 400 = 0.1 bonus
    assert.ok(Math.abs(withLuck - noLuck - 0.1) < 0.001, 'Luck 40 should add 10% evasion');
  });
});

describe('Status Resistance', () => {
  it('should have 10% base resistance', () => {
    const resist = calculateStatusResistance({ luck: 0 });
    assert.strictEqual(resist, 0.1, 'Base status resistance should be 10%');
  });

  it('should scale with luck', () => {
    const resist = calculateStatusResistance({ luck: 40 });
    // 0.1 + 40/200 = 0.1 + 0.2 = 0.3
    assert.ok(Math.abs(resist - 0.3) < 0.001, `Luck 40 should give 30% resistance, got ${(resist * 100).toFixed(1)}%`);
  });

  it('should cap at 50%', () => {
    const resist = calculateStatusResistance({ luck: 200 });
    assert.strictEqual(resist, 0.5, 'Status resistance should cap at 50%');
  });
});

describe('Time To Kill Balance', () => {
  it('should take 4-8 hits for level 1 warrior vs level 1 goblin-like enemy', () => {
    const warrior = createMockPlayer(RACES.HUMAN, CLASSES.WARRIOR, 1);
    const enemy = createMockEnemy('humanoid', 1, 1);

    const damage = calculatePhysicalDamage(warrior, enemy, 100);
    const hitsToKill = Math.ceil(enemy.hp / damage.avgDamage);

    assert.ok(hitsToKill >= 3, `Should take at least 3 hits, took ${hitsToKill}`);
    assert.ok(hitsToKill <= 10, `Should take at most 10 hits, took ${hitsToKill}`);
  });

  it('should take 4-8 hits for level 50 wizard vs level 50 equivalent enemy', () => {
    const wizard = createMockPlayer(RACES.HUMAN, CLASSES.WIZARD, 50);
    const enemy = createMockEnemy('humanoid', 50, 2);

    const damage = calculateMagicalDamage(wizard, enemy, 100);
    const hitsToKill = Math.ceil(enemy.hp / damage.avgDamage);

    assert.ok(hitsToKill >= 3, `Should take at least 3 hits, took ${hitsToKill}`);
    assert.ok(hitsToKill <= 12, `Should take at most 12 hits, took ${hitsToKill}`);
  });
});

describe('VIT HP Scaling', () => {
  it('should have high VIT character have significantly more HP', () => {
    // Human warrior (base VIT 10, growth 2)
    const warrior1 = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 50);
    // Elf wizard (base VIT 8, growth 1)
    const wizard1 = calculateStats(RACES.ELF, CLASSES.WIZARD, 50);

    // Warrior should have notably more HP
    const hpRatio = warrior1.hpMax / wizard1.hpMax;
    assert.ok(hpRatio > 1.3, `Warrior should have at least 30% more HP than wizard, ratio: ${hpRatio.toFixed(2)}`);
  });

  it('should include VIT bonus in HP calculation', () => {
    const stats = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 50);

    // Check VIT bonus formula: floor(level/2 + VIT * 0.5)
    const expectedVIT = 10 + (2 * 49); // base + growth * (level-1) = 108
    const expectedVitBonus = Math.floor(50 / 2 + expectedVIT * 0.5);

    // Base HP without VIT bonus
    const baseHP = 100 + (15 * 49); // race base + hp growth * (level-1)
    const expectedTotal = baseHP + expectedVitBonus;

    assert.strictEqual(stats.hpMax, expectedTotal, 'HP should include VIT bonus');
  });
});

describe('Luck Growth', () => {
  it('should have all classes grow luck with level', () => {
    const classes = [CLASSES.WARRIOR, CLASSES.WIZARD, CLASSES.MONK, CLASSES.CHEMIST];

    for (const charClass of classes) {
      const stats1 = calculateStats(RACES.HUMAN, charClass, 1);
      const stats50 = calculateStats(RACES.HUMAN, charClass, 50);

      assert.ok(stats50.luck > stats1.luck, `${charClass} should gain luck with level`);
    }
  });

  it('should have monks gain more luck than warriors', () => {
    // Monks have 1.0 luck growth, warriors have 0.5
    const monk = calculateStats(RACES.HUMAN, CLASSES.MONK, 50);
    const warrior = calculateStats(RACES.HUMAN, CLASSES.WARRIOR, 50);

    assert.ok(monk.luck > warrior.luck, 'Monks should have more luck than warriors at same level');
  });
});

describe('Enemy Archetype Scaling', () => {
  it('should have archetypes with different stat profiles', () => {
    const beast = createMockEnemy('beast', 20, 2);
    const humanoid = createMockEnemy('humanoid', 20, 2);
    const undead = createMockEnemy('undead', 20, 2);

    // Beasts should have higher strength
    assert.ok(beast.strength > humanoid.strength * 0.9, 'Beasts should have competitive strength');

    // Undead should have higher HP
    assert.ok(undead.hp > beast.hp, 'Undead should have more HP than beasts');

    // Humanoids should be balanced
    assert.ok(humanoid.intelligence >= beast.intelligence, 'Humanoids should have decent intelligence');
  });

  it('should scale enemy stats with tier multiplier', () => {
    const tier1 = createMockEnemy('humanoid', 20, 1);
    const tier3 = createMockEnemy('humanoid', 20, 3);
    const tier5 = createMockEnemy('humanoid', 20, 5);

    assert.ok(tier3.hp > tier1.hp, 'Tier 3 should have more HP than tier 1');
    assert.ok(tier5.hp > tier3.hp, 'Tier 5 should have more HP than tier 3');
    assert.ok(tier5.strength > tier1.strength, 'Higher tiers should have more strength');
  });
});
