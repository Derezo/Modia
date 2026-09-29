/**
 * Battle Math Unit Tests
 * Tests for damage formulas, hit/crit calculations
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculatePhysicalDamage,
  calculateMagicalDamage,
  calculateHealing,
  calculateHitChance,
  calculateCritChance,
  calculateCritMultiplier,
  calculateDamagePreview,
  calculateInitiative,
  calculateDefenseReduction,
  calculateEvasion,
  calculateStatusResistance,
  calculateEffectiveStatusChance,
  calculateCTGain,
  calculateInitialCT,
  predictTicksToAct,
  calculateElevationModifier,
  calculateElevationAccuracyModifier,
  calculateElevationEvasionModifier,
  checkLineOfSight,
  calculateDamagePreviewWithElevation,
  getElementalResistance,
  calculateElementalModifier,
  getElementalEffectivenessDisplay,
  applyVariance,
  calculateItemPreview,
  PHYSICAL_DEFENSE_CONSTANT,
  MAGIC_DEFENSE_CONSTANT,
  CT_THRESHOLD,
  CT_BASE_GAIN,
  CT_AGI_DIVISOR
} from './battleMath.js';

describe('calculatePhysicalDamage', () => {
  it('should calculate base damage from strength and attack', () => {
    const attacker = { strength: 20, attack: 10 };
    const defender = { vitality: 10, defense: 0 };
    const result = calculatePhysicalDamage(attacker, defender, 100);

    assert.ok(result.avgDamage > 0, 'Should deal positive damage');
    assert.ok(result.minDamage <= result.avgDamage, 'Min should be <= avg');
    assert.ok(result.maxDamage >= result.avgDamage, 'Max should be >= avg');
  });

  it('should scale damage with skill power', () => {
    const attacker = { strength: 20, attack: 10 };
    const defender = { vitality: 10, defense: 0 };

    const result100 = calculatePhysicalDamage(attacker, defender, 100);
    const result150 = calculatePhysicalDamage(attacker, defender, 150);
    const result200 = calculatePhysicalDamage(attacker, defender, 200);

    assert.ok(result150.avgDamage > result100.avgDamage, '150% should do more than 100%');
    assert.ok(result200.avgDamage > result150.avgDamage, '200% should do more than 150%');
  });

  it('should reduce damage with defense', () => {
    const attacker = { strength: 20, attack: 10 };
    const lowDef = { vitality: 10, defense: 0 };
    const highDef = { vitality: 10, defense: 50 };

    const resultLow = calculatePhysicalDamage(attacker, lowDef, 100);
    const resultHigh = calculatePhysicalDamage(attacker, highDef, 100);

    assert.ok(resultHigh.avgDamage < resultLow.avgDamage, 'High defense should reduce damage');
  });

  it('should guarantee minimum 1 damage', () => {
    const attacker = { strength: 1, attack: 0 };
    const defender = { vitality: 100, defense: 100 };
    const result = calculatePhysicalDamage(attacker, defender, 100);

    assert.ok(result.minDamage >= 1, 'Min damage should be at least 1');
    assert.ok(result.maxDamage >= 1, 'Max damage should be at least 1');
  });

  it('should have 10% variance range', () => {
    const attacker = { strength: 50, attack: 50 };
    const defender = { vitality: 20, defense: 20 };
    const result = calculatePhysicalDamage(attacker, defender, 100);

    // Variance should be roughly 20% of base (0.9 to 1.1)
    const range = result.maxDamage - result.minDamage;
    const expectedRange = result.avgDamage * 0.2;

    // Allow some tolerance due to floor operations
    assert.ok(Math.abs(range - expectedRange) < 3, 'Variance should be ~20% of average');
  });

  it('should handle missing stats gracefully', () => {
    const attacker = {};
    const defender = {};
    const result = calculatePhysicalDamage(attacker, defender, 100);

    assert.ok(result.minDamage >= 1, 'Should handle missing stats');
  });
});

describe('calculateMagicalDamage', () => {
  it('should calculate base damage from intelligence and magicAttack', () => {
    const attacker = { intelligence: 30, magicAttack: 20 };
    const defender = { intelligence: 10, magicDefense: 0 };
    const result = calculateMagicalDamage(attacker, defender, 100);

    assert.ok(result.avgDamage > 0, 'Should deal positive damage');
  });

  it('should scale damage with skill power', () => {
    const attacker = { intelligence: 30, magicAttack: 20 };
    const defender = { intelligence: 10, magicDefense: 0 };

    const result100 = calculateMagicalDamage(attacker, defender, 100);
    const result200 = calculateMagicalDamage(attacker, defender, 200);

    assert.ok(result200.avgDamage > result100.avgDamage, '200% should do more than 100%');
  });

  it('should reduce damage with magic defense', () => {
    const attacker = { intelligence: 30, magicAttack: 20 };
    const lowDef = { intelligence: 10, magicDefense: 0 };
    const highDef = { intelligence: 10, magicDefense: 100 };

    const resultLow = calculateMagicalDamage(attacker, lowDef, 100);
    const resultHigh = calculateMagicalDamage(attacker, highDef, 100);

    assert.ok(resultHigh.avgDamage < resultLow.avgDamage, 'High magic defense should reduce damage');
  });

  it('should guarantee minimum 1 damage', () => {
    const attacker = { intelligence: 1, magicAttack: 0 };
    const defender = { intelligence: 100, magicDefense: 100 };
    const result = calculateMagicalDamage(attacker, defender, 100);

    assert.ok(result.minDamage >= 1, 'Min damage should be at least 1');
  });
});

describe('calculateHealing', () => {
  it('should calculate healing based on intelligence', () => {
    const caster = { intelligence: 30 };
    const target = { hp: 50, maxHp: 100 };
    const result = calculateHealing(caster, target, 100);

    assert.ok(result.minHeal > 0, 'Should heal positive amount');
    assert.ok(result.maxHeal >= result.minHeal, 'Max should be >= min');
  });

  it('should scale with skill power', () => {
    const caster = { intelligence: 30 };
    const target = { hp: 50, maxHp: 100 };

    const result100 = calculateHealing(caster, target, 100);
    const result200 = calculateHealing(caster, target, 200);

    assert.ok(result200.maxHeal > result100.maxHeal, '200% should heal more');
  });

  it('should detect overheal', () => {
    const caster = { intelligence: 100 };
    const target = { hp: 95, maxHp: 100 }; // Only 5 HP missing

    const result = calculateHealing(caster, target, 100);

    assert.strictEqual(result.isOverheal, true, 'Should detect overheal');
    assert.ok(result.effectiveHeal <= 5, 'Effective heal should be capped at missing HP');
  });

  it('should not report overheal when target needs more', () => {
    const caster = { intelligence: 10 };
    const target = { hp: 10, maxHp: 100 }; // 90 HP missing

    const result = calculateHealing(caster, target, 100);

    assert.strictEqual(result.isOverheal, false, 'Should not overheal');
  });
});

describe('calculateHitChance', () => {
  it('should calculate hit chance with evasion factored in', () => {
    // With equal AGI and no LCK: evasion = 2% base
    // Hit chance = 95% base - 2% evasion = 93%
    const attacker = { agility: 10, statusEffects: [] };
    const defender = { agility: 10, luck: 0 };
    const hitChance = calculateHitChance(attacker, defender);

    // Use approximate comparison for floating point
    assert.ok(Math.abs(hitChance - 0.93) < 0.001, `Hit chance should be ~93% (got ${hitChance})`);
  });

  it('should reduce hit chance against faster targets', () => {
    const attacker = { agility: 10, statusEffects: [] };
    const fastDefender = { agility: 30, luck: 0 };
    const hitChance = calculateHitChance(attacker, fastDefender);

    assert.ok(hitChance < 0.93, 'Hit chance should be reduced against faster target');
  });

  it('should increase hit chance against slower targets up to 98% cap', () => {
    // Faster attacker means defender has lower evasion (floored at MIN_EVASION 2%)
    const attacker = { agility: 100, statusEffects: [] };
    const slowDefender = { agility: 10, luck: 0 };
    const hitChance = calculateHitChance(attacker, slowDefender);

    // Evasion = 2% base + (10-100)/400 = 2% - 22.5% = 2% (floored at MIN_EVASION)
    // Hit = 95% - 2% = 93%
    assert.ok(hitChance <= 0.98, 'Hit chance should not exceed 98%');
    assert.ok(hitChance >= 0.92, 'Hit chance should be at least ~93% against slow target');
  });

  it('should reduce hit chance when blinded', () => {
    const attacker = { agility: 10, statusEffects: [{ type: 'blind' }] };
    const defender = { agility: 10, luck: 0 };
    const hitChance = calculateHitChance(attacker, defender);

    // Base 95% - 2% evasion - 30% blind = 63%
    assert.ok(hitChance < 0.93, 'Blind should reduce hit chance');
    assert.ok(hitChance >= 0.5, 'Hit chance should not go below 50%');
  });

  it('should have minimum 50% hit chance', () => {
    const attacker = { agility: 1, statusEffects: [{ type: 'blind' }] };
    const defender = { agility: 100, luck: 100 };
    const hitChance = calculateHitChance(attacker, defender);

    assert.ok(Math.abs(hitChance - 0.5) < 0.001, 'Hit chance should be at least 50%');
  });

  it('should cap at maximum 98% hit chance', () => {
    const attacker = { agility: 100, statusEffects: [] };
    const defender = { agility: 1, luck: 0 };
    const hitChance = calculateHitChance(attacker, defender);

    assert.ok(hitChance <= 0.98, 'Hit chance should not exceed 98%');
  });
});

describe('calculateCritChance', () => {
  it('should scale crit chance with luck', () => {
    const lowLuck = { luck: 10 };
    const highLuck = { luck: 40 };

    const critLow = calculateCritChance(lowLuck);
    const critHigh = calculateCritChance(highLuck);

    assert.ok(critHigh > critLow, 'Higher luck should mean higher crit chance');
  });

  it('should cap crit chance at 50%', () => {
    // New formula: 5% base + LCK/300, cap at 50%
    const maxLuck = { luck: 200 };
    const critChance = calculateCritChance(maxLuck);

    assert.strictEqual(critChance, 0.50, 'Crit chance should cap at 50%');
  });

  it('should have reasonable crit chance at normal luck', () => {
    // Formula: 5% base + LCK/300
    // LCK 20: 0.05 + 20/300 = 0.05 + 0.0667 = 0.1167
    const normalLuck = { luck: 20 };
    const critChance = calculateCritChance(normalLuck);

    const expected = 0.05 + (20 / 300);
    assert.ok(Math.abs(critChance - expected) < 0.001, `Luck 20 should give ~${(expected * 100).toFixed(1)}% crit`);
  });

  it('should handle missing luck stat', () => {
    // With 0 luck: 5% base + 0/300 = 5%
    const noLuck = {};
    const critChance = calculateCritChance(noLuck);

    assert.strictEqual(critChance, 0.05, 'No luck should give base 5% crit');
  });
});

describe('calculateCritMultiplier', () => {
  it('should return 1.5 base crit multiplier', () => {
    const attacker = { race: 'human' };
    const multiplier = calculateCritMultiplier(attacker);

    assert.strictEqual(multiplier, 1.5, 'Base crit multiplier should be 1.5');
  });

  it('should give orcs 1.65 crit multiplier', () => {
    const orc = { race: 'orc' };
    const multiplier = calculateCritMultiplier(orc);

    // Use approximate equality for floating point
    assert.ok(Math.abs(multiplier - 1.65) < 0.0001, 'Orc crit multiplier should be ~1.65');
  });

  it('should return base multiplier for non-orcs', () => {
    const races = ['human', 'elf', 'dwarf', 'vampire', undefined];
    for (const race of races) {
      const multiplier = calculateCritMultiplier({ race });
      assert.strictEqual(multiplier, 1.5, `${race} should have base 1.5 multiplier`);
    }
  });
});

describe('calculateDamagePreview', () => {
  it('should return physical damage type by default', () => {
    const attacker = { strength: 20, attack: 10 };
    const defender = { vitality: 10, defense: 5, hp: 100 };
    const skill = { power: 100 };

    const preview = calculateDamagePreview(attacker, defender, skill);

    assert.strictEqual(preview.type, 'physical');
    assert.ok(preview.minDamage > 0);
    assert.ok(preview.maxDamage >= preview.minDamage);
  });

  it('should return magical damage type when specified', () => {
    const attacker = { intelligence: 20, magicAttack: 10 };
    const defender = { intelligence: 10, magicDefense: 5, hp: 100 };
    const skill = { power: 100, damageType: 'magical' };

    const preview = calculateDamagePreview(attacker, defender, skill);

    assert.strictEqual(preview.type, 'magical');
  });

  it('should return heal type for healing skills', () => {
    const caster = { intelligence: 30 };
    const target = { hp: 50, maxHp: 100 };
    const skill = { power: 100, effect: 'heal' };

    const preview = calculateDamagePreview(caster, target, skill);

    assert.strictEqual(preview.type, 'heal');
    assert.ok(preview.minHeal > 0);
    assert.strictEqual(preview.hitChance, 1.0, 'Heals should always hit');
    assert.strictEqual(preview.minDamage, null, 'Heals should not have damage');
  });

  it('should indicate willKill when damage exceeds HP', () => {
    const attacker = { strength: 100, attack: 50 };
    const defender = { vitality: 5, defense: 0, hp: 10 };
    const skill = { power: 100 };

    const preview = calculateDamagePreview(attacker, defender, skill);

    assert.strictEqual(preview.willKill, true, 'Should indicate will kill');
  });

  it('should include crit damage calculation', () => {
    const attacker = { strength: 20, attack: 10, luck: 20, race: 'human' };
    const defender = { vitality: 10, defense: 5, hp: 100 };
    const skill = { power: 100 };

    const preview = calculateDamagePreview(attacker, defender, skill);

    assert.ok(preview.critDamage > preview.maxDamage, 'Crit damage should exceed max damage');
    assert.ok(preview.critChance > 0, 'Should have crit chance');
  });
});

describe('calculateInitiative', () => {
  it('should base initiative on agility', () => {
    const slowUnit = { agility: 10 };
    const fastUnit = { agility: 50 };

    // Use fixed random value for deterministic testing
    const slowInit = calculateInitiative(slowUnit, 0.5);
    const fastInit = calculateInitiative(fastUnit, 0.5);

    assert.ok(fastInit > slowInit, 'Faster unit should have higher initiative');
  });

  it('should add random variance', () => {
    // New formula: (AGI / 2) + random(0, 20)
    // AGI 20: base = 10
    const unit = { agility: 20 };

    const initLow = calculateInitiative(unit, 0);    // 20/2 + floor(0 * 21) = 10 + 0 = 10
    const initHigh = calculateInitiative(unit, 0.99); // 20/2 + floor(0.99 * 21) = 10 + 20 = 30

    assert.strictEqual(initLow, 10, 'Min variance should give AGI/2');
    assert.strictEqual(initHigh, 30, 'Max variance should add up to 20');
  });

  it('should handle missing agility', () => {
    // AGI 0: base = 0/2 = 0, + variance
    const unit = {};
    const init = calculateInitiative(unit, 0.5);  // 0/2 + floor(0.5 * 21) = 0 + 10 = 10

    assert.strictEqual(init, 10, 'Default agility 0 with middle variance');
  });
});

// ============================================================================
// NEW TESTS - Comprehensive coverage for all untested exports
// ============================================================================

// --- Additional tests for existing suites ---

describe('calculateCritMultiplier (luck scaling)', () => {
  it('should scale crit multiplier with luck for orcs', () => {
    // Orc with luck 50: 1.5 + 0.15 (orc bonus) + 50/500 = 1.75
    const orc = { race: 'orc', luck: 50 };
    const multiplier = calculateCritMultiplier(orc);
    assert.ok(Math.abs(multiplier - 1.75) < 0.0001, `Orc LCK 50 should be ~1.75 (got ${multiplier})`);
  });

  it('should scale crit multiplier with luck for humans', () => {
    // Human with luck 100: 1.5 + 100/500 = 1.7
    const human = { race: 'human', luck: 100 };
    const multiplier = calculateCritMultiplier(human);
    assert.ok(Math.abs(multiplier - 1.7) < 0.0001, `Human LCK 100 should be ~1.7 (got ${multiplier})`);
  });
});

describe('calculatePhysicalDamage (floor verification)', () => {
  it('should apply floor operation to min and max damage', () => {
    // STR 100, DEF 0 => rawDamage=100, defReduction=0
    // min = floor(100 * 0.9) = 90, max = floor(100 * 1.1) = 110
    const attacker = { strength: 100, attack: 0 };
    const defender = { vitality: 0, defense: 0 };
    const result = calculatePhysicalDamage(attacker, defender, 100);

    assert.strictEqual(result.minDamage, 90, 'Min should be floor(100*0.9)=90');
    assert.strictEqual(result.maxDamage, 110, 'Max should be floor(100*1.1)=110');
  });
});

// --- calculateDefenseReduction ---

describe('calculateDefenseReduction', () => {
  it('should return 0 for zero defense', () => {
    assert.strictEqual(calculateDefenseReduction(0, PHYSICAL_DEFENSE_CONSTANT), 0);
  });

  it('should return 0 for negative defense', () => {
    assert.strictEqual(calculateDefenseReduction(-10, PHYSICAL_DEFENSE_CONSTANT), 0);
  });

  it('should return 50% reduction at 100 DEF with PHYSICAL_DEFENSE_CONSTANT', () => {
    // 100 / (100 + 100) = 0.5
    const reduction = calculateDefenseReduction(100, PHYSICAL_DEFENSE_CONSTANT);
    assert.ok(Math.abs(reduction - 0.5) < 0.0001, `Expected 0.5, got ${reduction}`);
  });

  it('should show diminishing returns at high defense', () => {
    // 200 / (200 + 100) = 0.6667
    const at200 = calculateDefenseReduction(200, PHYSICAL_DEFENSE_CONSTANT);
    // 400 / (400 + 100) = 0.8
    const at400 = calculateDefenseReduction(400, PHYSICAL_DEFENSE_CONSTANT);

    // Doubling from 200 to 400 should not double the reduction
    const gain200to400 = at400 - at200;
    const gain0to200 = at200;
    assert.ok(gain200to400 < gain0to200, 'Diminishing returns: 200->400 gain should be less than 0->200 gain');
    assert.ok(Math.abs(at200 - 2 / 3) < 0.001, `200 DEF should be ~66.7% (got ${at200})`);
  });

  it('should work with magic defense constant', () => {
    // 80 / (80 + 80) = 0.5
    const reduction = calculateDefenseReduction(80, MAGIC_DEFENSE_CONSTANT);
    assert.ok(Math.abs(reduction - 0.5) < 0.0001, `Expected 0.5, got ${reduction}`);
  });
});

// --- calculateEvasion ---

describe('calculateEvasion', () => {
  it('should return 2% base evasion with equal AGI and 0 luck', () => {
    const attacker = { agility: 20 };
    const defender = { agility: 20, luck: 0 };
    const evasion = calculateEvasion(attacker, defender);
    assert.ok(Math.abs(evasion - 0.02) < 0.001, `Equal AGI should give 2% (got ${evasion})`);
  });

  it('should increase evasion when defender is faster', () => {
    const attacker = { agility: 10 };
    const defender = { agility: 50, luck: 0 };
    // 2% + (50-10)/400 = 2% + 10% = 12%
    const evasion = calculateEvasion(attacker, defender);
    assert.ok(Math.abs(evasion - 0.12) < 0.001, `Faster defender should give ~12% (got ${evasion})`);
  });

  it('should decrease evasion when attacker is faster but not below floor', () => {
    const attacker = { agility: 100 };
    const defender = { agility: 10, luck: 0 };
    // 2% + (10-100)/400 = 2% - 22.5% = -20.5% => clamped to 2%
    const evasion = calculateEvasion(attacker, defender);
    assert.strictEqual(evasion, 0.02, 'Should not go below 2% floor');
  });

  it('should add luck bonus for defender', () => {
    const attacker = { agility: 20 };
    const defender = { agility: 20, luck: 40 };
    // 2% + 0 + 40/400 = 2% + 10% = 12%
    const evasion = calculateEvasion(attacker, defender);
    assert.ok(Math.abs(evasion - 0.12) < 0.001, `Luck 40 should give ~12% (got ${evasion})`);
  });

  it('should cap at 35%', () => {
    const attacker = { agility: 1 };
    const defender = { agility: 200, luck: 200 };
    const evasion = calculateEvasion(attacker, defender);
    assert.strictEqual(evasion, 0.35, 'Should cap at 35%');
  });

  it('should maintain 2% floor', () => {
    const attacker = { agility: 200 };
    const defender = { agility: 1, luck: 0 };
    const evasion = calculateEvasion(attacker, defender);
    assert.strictEqual(evasion, 0.02, 'Should have 2% floor');
  });
});

// --- calculateStatusResistance ---

describe('calculateStatusResistance', () => {
  it('should return 10% base resistance at 0 luck', () => {
    const defender = { luck: 0 };
    const resist = calculateStatusResistance(defender);
    assert.ok(Math.abs(resist - 0.10) < 0.001, `Base should be 10% (got ${resist})`);
  });

  it('should scale with luck', () => {
    // LCK 100: 10% + 100/200 = 10% + 50% = 60% => capped at 50%
    const defender = { luck: 100 };
    const resist = calculateStatusResistance(defender);
    assert.strictEqual(resist, 0.50, 'LCK 100 should cap at 50%');
  });

  it('should cap at 50%', () => {
    const defender = { luck: 200 };
    const resist = calculateStatusResistance(defender);
    assert.strictEqual(resist, 0.50, 'Should not exceed 50%');
  });

  it('should add trait bonus', () => {
    const defender = { luck: 0 };
    const resist = calculateStatusResistance(defender, 0.05);
    assert.ok(Math.abs(resist - 0.15) < 0.001, `10% + 5% trait = 15% (got ${resist})`);
  });
});

// --- calculateEffectiveStatusChance ---

describe('calculateEffectiveStatusChance', () => {
  it('should reduce base chance by resistance', () => {
    // Base 80%, defender LCK 0 => resist 10% => effective = 0.8 * (1-0.1) = 0.72
    const defender = { luck: 0 };
    const chance = calculateEffectiveStatusChance(0.8, defender);
    assert.ok(Math.abs(chance - 0.72) < 0.001, `Expected 0.72, got ${chance}`);
  });

  it('should return 0 when base chance is 0', () => {
    const defender = { luck: 50 };
    const chance = calculateEffectiveStatusChance(0, defender);
    assert.strictEqual(chance, 0, 'Zero base chance should stay zero');
  });

  it('should apply trait bonus resistance', () => {
    // Base 50%, LCK 0 + 0.1 trait => resist 20% => effective = 0.5 * 0.8 = 0.4
    const defender = { luck: 0 };
    const chance = calculateEffectiveStatusChance(0.5, defender, 0.1);
    assert.ok(Math.abs(chance - 0.4) < 0.001, `Expected 0.4, got ${chance}`);
  });
});

// --- calculateCTGain ---

describe('calculateCTGain', () => {
  it('should return 5 CT/tick at AGI 0', () => {
    const unit = { agility: 0 };
    const gain = calculateCTGain(unit);
    assert.strictEqual(gain, 5, 'AGI 0 should give base 5 CT/tick');
  });

  it('should return 10 CT/tick at AGI 50', () => {
    // 5 + 50/10 = 10
    const unit = { agility: 50 };
    const gain = calculateCTGain(unit);
    assert.strictEqual(gain, 10, 'AGI 50 should give 10 CT/tick');
  });

  it('should apply 1.5x multiplier with haste', () => {
    // AGI 50: base 10, haste: 15
    const unit = { agility: 50, statusEffects: [{ type: 'haste' }] };
    const gain = calculateCTGain(unit);
    assert.strictEqual(gain, 15, 'Haste should multiply by 1.5');
  });

  it('should apply 0.5x multiplier with slow', () => {
    // AGI 50: base 10, slow: 5
    const unit = { agility: 50, statusEffects: [{ type: 'slow' }] };
    const gain = calculateCTGain(unit);
    assert.strictEqual(gain, 5, 'Slow should multiply by 0.5');
  });

  it('should apply both haste and slow (1.5 * 0.5 = 0.75)', () => {
    // AGI 50: base 10, haste then slow: 10 * 1.5 * 0.5 = 7.5
    const unit = { agility: 50, statusEffects: [{ type: 'haste' }, { type: 'slow' }] };
    const gain = calculateCTGain(unit);
    assert.strictEqual(gain, 7.5, 'Haste + slow should give 0.75x');
  });
});

// --- calculateInitialCT ---

describe('calculateInitialCT', () => {
  it('should be deterministic with fixed random value', () => {
    const unit = { agility: 40 };
    const ct1 = calculateInitialCT(unit, 0.5);
    const ct2 = calculateInitialCT(unit, 0.5);
    assert.strictEqual(ct1, ct2, 'Same input should give same output');
  });

  it('should compute correctly with AGI 40 and random 0.5', () => {
    // base = 40/2 = 20, variance = floor(0.5 * 21) = 10, total = floor(30) = 30
    const unit = { agility: 40 };
    const ct = calculateInitialCT(unit, 0.5);
    assert.strictEqual(ct, 30, 'AGI 40, rand 0.5 => 30');
  });

  it('should have variance range of 0 to 20', () => {
    const unit = { agility: 20 };
    const ctMin = calculateInitialCT(unit, 0);       // 10 + 0 = 10
    const ctMax = calculateInitialCT(unit, 0.99);    // 10 + 20 = 30
    assert.strictEqual(ctMin, 10, 'Random 0 should add 0 variance');
    assert.strictEqual(ctMax, 30, 'Random ~1 should add 20 variance');
  });
});

// --- predictTicksToAct ---

describe('predictTicksToAct', () => {
  it('should predict ticks from CT 0 with AGI 10', () => {
    // ctGain = 5 + 10/10 = 6, ticks = ceil(100/6) = 17
    const unit = { agility: 10 };
    const ticks = predictTicksToAct(unit, 0);
    assert.strictEqual(ticks, 17, 'AGI 10 from CT 0 should take 17 ticks');
  });

  it('should return 0 when already at or above threshold', () => {
    const unit = { agility: 50 };
    assert.strictEqual(predictTicksToAct(unit, 100), 0, 'CT 100 should need 0 ticks');
    assert.strictEqual(predictTicksToAct(unit, 120), 0, 'CT above threshold should need 0 ticks');
  });

  it('should account for haste', () => {
    // AGI 50: base ctGain = 10, haste = 15, ticks = ceil(100/15) = 7
    const unit = { agility: 50, statusEffects: [{ type: 'haste' }] };
    const ticks = predictTicksToAct(unit, 0);
    assert.strictEqual(ticks, 7, 'Haste AGI 50 should take 7 ticks');
  });

  it('should handle partial CT', () => {
    // AGI 50: ctGain=10, remaining=50, ticks = ceil(50/10) = 5
    const unit = { agility: 50 };
    const ticks = predictTicksToAct(unit, 50);
    assert.strictEqual(ticks, 5, 'CT 50 with AGI 50 should take 5 ticks');
  });
});

// --- calculateElevationModifier ---

describe('calculateElevationModifier', () => {
  it('should return 1.0 for same level', () => {
    const result = calculateElevationModifier(0, 0);
    assert.strictEqual(result.modifier, 1.0);
    assert.strictEqual(result.description, 'Same level');
  });

  it('should give +10% per level above for melee', () => {
    const result = calculateElevationModifier(2, 0, 'melee');
    // 2 levels * 10% = 20%
    assert.ok(Math.abs(result.modifier - 1.2) < 0.001, `Expected 1.2, got ${result.modifier}`);
  });

  it('should give +15% per level above for ranged (10% base + 5% ranged bonus)', () => {
    const result = calculateElevationModifier(2, 0, 'ranged');
    // 2 * (10% + 5%) = 30%
    assert.ok(Math.abs(result.modifier - 1.3) < 0.001, `Expected 1.3, got ${result.modifier}`);
  });

  it('should cap bonus at +40%', () => {
    const resultMelee = calculateElevationModifier(5, 0, 'melee');
    // 5 * 10% = 50% => capped at 40%
    assert.ok(Math.abs(resultMelee.modifier - 1.4) < 0.001, `Melee cap should be 1.4 (got ${resultMelee.modifier})`);
  });

  it('should apply -5% penalty per level below', () => {
    const result = calculateElevationModifier(0, 2, 'melee');
    // 2 * 5% = 10% penalty
    assert.ok(Math.abs(result.modifier - 0.9) < 0.001, `Expected 0.9, got ${result.modifier}`);
  });

  it('should cap penalty at -20%', () => {
    const result = calculateElevationModifier(0, 6, 'melee');
    // 6 * 5% = 30% => capped at 20%
    assert.ok(Math.abs(result.modifier - 0.8) < 0.001, `Penalty cap should be 0.8 (got ${result.modifier})`);
  });
});

// --- calculateElevationAccuracyModifier ---

describe('calculateElevationAccuracyModifier', () => {
  it('should return 0 for same level', () => {
    assert.strictEqual(calculateElevationAccuracyModifier(0, 0), 0);
  });

  it('should give +2% per level above', () => {
    const mod = calculateElevationAccuracyModifier(3, 1);
    assert.ok(Math.abs(mod - 0.04) < 0.001, `2 levels above => +4% (got ${mod})`);
  });

  it('should give -2% per level below', () => {
    const mod = calculateElevationAccuracyModifier(0, 2);
    assert.ok(Math.abs(mod - (-0.04)) < 0.001, `2 levels below => -4% (got ${mod})`);
  });

  it('should cap at +8%', () => {
    const mod = calculateElevationAccuracyModifier(6, 0);
    assert.ok(Math.abs(mod - 0.08) < 0.001, `Should cap at +8% (got ${mod})`);
  });

  it('should cap at -8%', () => {
    const mod = calculateElevationAccuracyModifier(0, 6);
    assert.ok(Math.abs(mod - (-0.08)) < 0.001, `Should cap at -8% (got ${mod})`);
  });
});

// --- calculateElevationEvasionModifier ---

describe('calculateElevationEvasionModifier', () => {
  it('should return 0 for same level', () => {
    assert.strictEqual(calculateElevationEvasionModifier(0, 0), 0);
  });

  it('should give +1% evasion per level defender is above', () => {
    // defenderZ=2, attackerZ=0 => elevDiff=2, bonus=2*0.01=0.02
    const mod = calculateElevationEvasionModifier(0, 2);
    assert.ok(Math.abs(mod - 0.02) < 0.001, `Defender 2 above => +2% (got ${mod})`);
  });

  it('should give -2% evasion per level defender is below', () => {
    // defenderZ=0, attackerZ=2 => elevDiff=-2, penalty=-2*0.02=-0.04
    const mod = calculateElevationEvasionModifier(2, 0);
    assert.ok(Math.abs(mod - (-0.04)) < 0.001, `Defender 2 below => -4% (got ${mod})`);
  });

  it('should cap positive modifier at +4%', () => {
    const mod = calculateElevationEvasionModifier(0, 6);
    assert.ok(Math.abs(mod - 0.04) < 0.001, `Should cap at +4% (got ${mod})`);
  });

  it('should cap negative modifier at -8%', () => {
    const mod = calculateElevationEvasionModifier(6, 0);
    assert.ok(Math.abs(mod - (-0.08)) < 0.001, `Should cap at -8% (got ${mod})`);
  });
});

// --- checkLineOfSight ---

describe('checkLineOfSight', () => {
  it('should have LOS when no elevation data provided', () => {
    const result = checkLineOfSight(0, 0, 0, 5, 5, 0, null, null);
    assert.strictEqual(result.hasLOS, true);
    assert.strictEqual(result.blocked, false);
    assert.strictEqual(result.blockingTile, null);
  });

  it('should have LOS on flat terrain with no obstacles', () => {
    const elevation = Array.from({ length: 10 }, () => Array(10).fill(0));
    const terrain = Array.from({ length: 10 }, () => Array(10).fill('grass'));
    const result = checkLineOfSight(0, 0, 0, 5, 5, 0, elevation, terrain);
    assert.strictEqual(result.hasLOS, true);
  });

  it('should be blocked by rock obstacle at same elevation', () => {
    const elevation = Array.from({ length: 10 }, () => Array(10).fill(0));
    const terrain = Array.from({ length: 10 }, () => Array(10).fill('grass'));
    // Place a rock in the middle of the path from (0,0) to (4,4)
    terrain[2][2] = 'rock';
    const result = checkLineOfSight(0, 0, 0, 4, 4, 0, elevation, terrain);
    assert.strictEqual(result.hasLOS, false);
    assert.strictEqual(result.blocked, true);
    assert.ok(result.blockingTile !== null, 'Should report blocking tile');
  });

  it('should see over low obstacle when attacker is high', () => {
    const elevation = Array.from({ length: 10 }, () => Array(10).fill(0));
    const terrain = Array.from({ length: 10 }, () => Array(10).fill('grass'));
    // Place a rock at elevation 0 in the path
    terrain[2][2] = 'rock';
    elevation[2][2] = 0;
    // Attacker at elevation 3, defender at elevation 0
    // The projectile height at step 2 of ~4 steps: 3 + (0-3)*(2/4) = 3 - 1.5 = 1.5
    // Rock at height 0, 0 < 1.5 so it should not block
    const result = checkLineOfSight(0, 0, 3, 4, 4, 0, elevation, terrain);
    assert.strictEqual(result.hasLOS, true, 'High attacker should see over low obstacle');
  });

  it('should have LOS for same-position (distance 0)', () => {
    const elevation = Array.from({ length: 10 }, () => Array(10).fill(0));
    const terrain = Array.from({ length: 10 }, () => Array(10).fill('grass'));
    const result = checkLineOfSight(3, 3, 0, 3, 3, 0, elevation, terrain);
    assert.strictEqual(result.hasLOS, true);
  });
});

// --- calculateDamagePreviewWithElevation ---

describe('calculateDamagePreviewWithElevation', () => {
  it('should not modify healing with elevation', () => {
    const caster = { intelligence: 30 };
    const target = { hp: 50, maxHp: 100 };
    const skill = { power: 100, effect: 'heal' };
    const preview = calculateDamagePreviewWithElevation(caster, target, skill, {
      attackerZ: 3, defenderZ: 0
    });
    assert.strictEqual(preview.type, 'heal');
    assert.strictEqual(preview.elevationModifier, 1.0, 'Healing should not be affected by elevation');
  });

  it('should increase physical damage with height advantage', () => {
    const attacker = { strength: 50, attack: 10 };
    const defender = { vitality: 10, defense: 5, hp: 200 };
    const skill = { power: 100 };

    const flat = calculateDamagePreviewWithElevation(attacker, defender, skill, {
      attackerZ: 0, defenderZ: 0
    });
    const elevated = calculateDamagePreviewWithElevation(attacker, defender, skill, {
      attackerZ: 2, defenderZ: 0
    });

    assert.ok(elevated.maxDamage > flat.maxDamage, 'Elevated attacker should deal more damage');
    assert.ok(elevated.elevationModifier > 1.0, 'Modifier should be > 1.0');
  });

  it('should include baseDamage for comparison', () => {
    const attacker = { strength: 50, attack: 10 };
    const defender = { vitality: 10, defense: 5, hp: 200 };
    const skill = { power: 100 };

    const preview = calculateDamagePreviewWithElevation(attacker, defender, skill, {
      attackerZ: 2, defenderZ: 0
    });

    assert.ok(preview.baseDamage, 'Should include baseDamage object');
    assert.ok(preview.baseDamage.min > 0, 'Base min damage should be positive');
    assert.ok(preview.maxDamage >= preview.baseDamage.max, 'Elevated max should >= base max');
  });
});

// --- getElementalResistance ---

describe('getElementalResistance', () => {
  it('should return 0 for physical element', () => {
    const defender = { race: 'elf' };
    assert.strictEqual(getElementalResistance(defender, 'physical'), 0);
  });

  it('should return 0 for null element', () => {
    const defender = { race: 'elf' };
    assert.strictEqual(getElementalResistance(defender, null), 0);
  });

  it('should return racial resistance for elves vs fire', () => {
    // Elf: fire = -25 (weakness)
    const defender = { race: 'elf' };
    const resist = getElementalResistance(defender, 'fire');
    assert.strictEqual(resist, -25, 'Elf should have -25 fire resistance');
  });

  it('should return racial resistance for vampires vs holy', () => {
    // Vampire: holy = -50 (weakness)
    const defender = { race: 'vampire' };
    const resist = getElementalResistance(defender, 'holy');
    assert.strictEqual(resist, -50, 'Vampire should have -50 holy resistance');
  });

  it('should add innate elemental resistances', () => {
    const defender = { race: 'human', elementalResistances: { fire: 30 } };
    assert.strictEqual(getElementalResistance(defender, 'fire'), 30);
  });

  it('should stack equipment resistances', () => {
    const defender = {
      race: 'human',
      equipment: {
        armor: { elementalResistances: { fire: 20 } },
        shield: { elementalResistances: { fire: 15 } }
      }
    };
    assert.strictEqual(getElementalResistance(defender, 'fire'), 35);
  });

  it('should stack buff resistances', () => {
    const defender = {
      race: 'human',
      statusEffects: [
        { type: 'fire_resist', value: 25 },
        { type: 'elemental_shield', value: 15 }
      ]
    };
    assert.strictEqual(getElementalResistance(defender, 'fire'), 40);
  });

  it('should stack all sources together', () => {
    // Dwarf fire racial: +25
    // Innate: +10
    // Equipment: +20
    // Buff: +25
    const defender = {
      race: 'dwarf',
      elementalResistances: { fire: 10 },
      equipment: { armor: { elementalResistances: { fire: 20 } } },
      statusEffects: [{ type: 'fire_resist', value: 25 }]
    };
    assert.strictEqual(getElementalResistance(defender, 'fire'), 80);
  });
});

// --- calculateElementalModifier ---

describe('calculateElementalModifier', () => {
  it('should return 1.0 for physical/null element', () => {
    assert.strictEqual(calculateElementalModifier({}, 'physical'), 1.0);
    assert.strictEqual(calculateElementalModifier({}, null), 1.0);
  });

  it('should cap resistance modifier at 0.1 minimum', () => {
    // 90 resistance => (100-90)/100 = 0.1
    const defender = { race: 'human', elementalResistances: { fire: 90 } };
    const mod = calculateElementalModifier(defender, 'fire');
    assert.ok(Math.abs(mod - 0.1) < 0.001, `90 resist should give 0.1 (got ${mod})`);
  });

  it('should return 0 for immunity (resistance >= 100)', () => {
    const defender = { race: 'human', elementalResistances: { fire: 100 } };
    assert.strictEqual(calculateElementalModifier(defender, 'fire'), 0);
  });

  it('should return -0.5 for absorb (resistance >= 150)', () => {
    const defender = { race: 'human', elementalResistances: { fire: 150 } };
    assert.strictEqual(calculateElementalModifier(defender, 'fire'), -0.5);
  });

  it('should increase damage for weakness (negative resistance)', () => {
    // Elf fire: -25 => (100 - (-25))/100 = 1.25
    const defender = { race: 'elf' };
    const mod = calculateElementalModifier(defender, 'fire');
    assert.ok(Math.abs(mod - 1.25) < 0.001, `Elf fire weakness should give 1.25 (got ${mod})`);
  });

  it('should give 1.5+ for strong weakness', () => {
    // Vampire holy: -50 => (100-(-50))/100 = 1.5
    const defender = { race: 'vampire' };
    const mod = calculateElementalModifier(defender, 'holy');
    assert.ok(mod >= 1.5, `Vampire holy should be >= 1.5 (got ${mod})`);
  });
});

// --- getElementalEffectivenessDisplay ---

describe('getElementalEffectivenessDisplay', () => {
  it('should return ABSORB for negative modifier', () => {
    const result = getElementalEffectivenessDisplay(-0.5);
    assert.strictEqual(result.text, 'ABSORB');
    assert.strictEqual(result.color, '#44ff88');
  });

  it('should return IMMUNE for modifier 0', () => {
    const result = getElementalEffectivenessDisplay(0);
    assert.strictEqual(result.text, 'IMMUNE');
    assert.strictEqual(result.color, '#888888');
  });

  it('should return RESIST for modifier <= 0.25', () => {
    const result = getElementalEffectivenessDisplay(0.1);
    assert.strictEqual(result.text, 'RESIST');
  });

  it('should return Resist for modifier 0.25 < x <= 0.75', () => {
    const result = getElementalEffectivenessDisplay(0.5);
    assert.strictEqual(result.text, 'Resist');
  });

  it('should return Weak for modifier > 1.0 and < 1.5', () => {
    const result = getElementalEffectivenessDisplay(1.25);
    assert.strictEqual(result.text, 'Weak');
    assert.strictEqual(result.color, '#ffaa44');
  });

  it('should return WEAK! for modifier >= 1.5', () => {
    const result = getElementalEffectivenessDisplay(1.5);
    assert.strictEqual(result.text, 'WEAK!');
    assert.strictEqual(result.color, '#ff4444');
  });

  it('should return null for normal damage (modifier ~1.0)', () => {
    const result = getElementalEffectivenessDisplay(1.0);
    assert.strictEqual(result, null, 'Normal damage should have no special display');
  });
});

// --- applyVariance ---

describe('applyVariance', () => {
  it('should return floor(base * 0.9) when random is 0', () => {
    // base=100, random=0 => variance=0.9 => floor(100*0.9) = 90
    assert.strictEqual(applyVariance(100, 0), 90);
  });

  it('should return floor(base * 1.1) when random is 1', () => {
    // base=100, random=1 => variance=0.9 + 1*0.2 = 1.1 => floor(100*1.1) = 110
    assert.strictEqual(applyVariance(100, 1), 110);
  });

  it('should return floor(base * 1.0) at midpoint random', () => {
    // base=100, random=0.5 => variance=0.9 + 0.5*0.2 = 1.0 => floor(100*1.0) = 100
    assert.strictEqual(applyVariance(100, 0.5), 100);
  });

  it('should floor non-integer results', () => {
    // base=77, random=0 => floor(77 * 0.9) = floor(69.3) = 69
    assert.strictEqual(applyVariance(77, 0), 69);
  });

  it('should handle base of 0', () => {
    assert.strictEqual(applyVariance(0, 0.5), 0);
  });
});

// ============================================================================
// STATUS EFFECT PREVENTION CONSTANTS
// ============================================================================

import {
  PREVENT_ACTING,
  PREVENT_MOVEMENT,
  PREVENT_SKILLS,
  BENEFICIAL_STATUS_EFFECTS,
  isBeneficialStatusEffect,
  CURE_POISON_EFFECTS,
  CURE_ALL_EFFECTS,
  PURIFY_EFFECTS
} from './battleMath.js';

describe('Status effect prevention constants', () => {
  it('PREVENT_ACTING should contain stun, freeze, sleep', () => {
    assert.deepStrictEqual([...PREVENT_ACTING], ['stun', 'freeze', 'sleep']);
  });

  it('PREVENT_MOVEMENT should be PREVENT_ACTING + root', () => {
    assert.deepStrictEqual([...PREVENT_MOVEMENT], ['stun', 'freeze', 'sleep', 'root']);
  });

  it('PREVENT_SKILLS should be PREVENT_ACTING + silence', () => {
    assert.deepStrictEqual([...PREVENT_SKILLS], ['stun', 'freeze', 'sleep', 'silence']);
  });

  it('all PREVENT constants should be frozen', () => {
    assert.ok(Object.isFrozen(PREVENT_ACTING));
    assert.ok(Object.isFrozen(PREVENT_MOVEMENT));
    assert.ok(Object.isFrozen(PREVENT_SKILLS));
  });

  it('PREVENT_MOVEMENT should be a superset of PREVENT_ACTING', () => {
    for (const effect of PREVENT_ACTING) {
      assert.ok(PREVENT_MOVEMENT.includes(effect), `${effect} missing from PREVENT_MOVEMENT`);
    }
  });

  it('PREVENT_SKILLS should be a superset of PREVENT_ACTING', () => {
    for (const effect of PREVENT_ACTING) {
      assert.ok(PREVENT_SKILLS.includes(effect), `${effect} missing from PREVENT_SKILLS`);
    }
  });
});

describe('Cleansable status effect constants', () => {
  it('BENEFICIAL_STATUS_EFFECTS should contain every explicit persisted buff', () => {
    assert.deepStrictEqual([...BENEFICIAL_STATUS_EFFECTS], [
      'rage',
      'fortify',
      'haste',
      'regen',
      'regenerate',
      'attack_up',
      'defense_up',
      'magic_shield',
      'berserk',
      'frenzy',
      'reckless',
      'berserker',
      'martyr',
      'final_stand',
      'mana_shield',
      'amplify',
      'elem_shield',
      'elemental_shield',
      'invisible',
      'shadow_arts',
      'pack_bonus',
      'unmovable'
    ]);
    assert.ok(Object.isFrozen(BENEFICIAL_STATUS_EFFECTS));
  });

  it('identifies explicit and elemental resistance buffs in either status form', () => {
    assert.strictEqual(isBeneficialStatusEffect('shadow_arts'), true);
    assert.strictEqual(
      isBeneficialStatusEffect({ type: 'final_stand', duration: 999 }),
      true
    );
    assert.strictEqual(
      isBeneficialStatusEffect({ type: 'fire_resist', value: 25 }),
      true
    );
    assert.strictEqual(
      isBeneficialStatusEffect({
        type: 'test_rally_buff',
        duration: 2,
        modifiers: { defense: 1.25 }
      }),
      true
    );
    assert.strictEqual(isBeneficialStatusEffect('poison'), false);
    assert.strictEqual(isBeneficialStatusEffect({ type: 'slow' }), false);
    assert.strictEqual(
      isBeneficialStatusEffect({ type: 'slow', modifiers: null }),
      false
    );
    assert.strictEqual(isBeneficialStatusEffect(null), false);
  });

  it('CURE_POISON_EFFECTS should contain only poison', () => {
    assert.deepStrictEqual([...CURE_POISON_EFFECTS], ['poison']);
  });

  it('CURE_ALL_EFFECTS should be a superset of CURE_POISON_EFFECTS', () => {
    for (const effect of CURE_POISON_EFFECTS) {
      assert.ok(CURE_ALL_EFFECTS.includes(effect), `${effect} missing from CURE_ALL_EFFECTS`);
    }
  });

  it('PURIFY_EFFECTS should be a superset of CURE_ALL_EFFECTS', () => {
    for (const effect of CURE_ALL_EFFECTS) {
      assert.ok(PURIFY_EFFECTS.includes(effect), `${effect} missing from PURIFY_EFFECTS`);
    }
  });

  it('all CURE/PURIFY constants should be frozen', () => {
    assert.ok(Object.isFrozen(CURE_POISON_EFFECTS));
    assert.ok(Object.isFrozen(CURE_ALL_EFFECTS));
    assert.ok(Object.isFrozen(PURIFY_EFFECTS));
  });
});

// ============================================================================
// ITEM PREVIEW CALCULATIONS
// ============================================================================

describe('calculateItemPreview', () => {
  describe('heal_hp items', () => {
    it('should calculate effective HP heal amount', () => {
      const item = { effect_type: 'heal_hp', effect_value: 50 };
      const target = { hp: 60, maxHp: 100 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.type, 'heal');
      assert.strictEqual(result.minHeal, 50);
      assert.strictEqual(result.maxHeal, 50);
      assert.strictEqual(result.effectiveHeal, 40); // Only 40 HP missing
      assert.strictEqual(result.isOverheal, true);
      assert.strictEqual(result.hitChance, 1.0);
    });

    it('should not overheal when target needs more HP', () => {
      const item = { effect_type: 'heal_hp', effect_value: 30 };
      const target = { hp: 20, maxHp: 100 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.effectiveHeal, 30);
      assert.strictEqual(result.isOverheal, false);
    });

    it('should handle snake_case target properties', () => {
      const item = { effect_type: 'heal_hp', effect_value: 50 };
      const target = { hp_current: 60, hp_max: 100 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.effectiveHeal, 40);
      assert.strictEqual(result.isOverheal, true);
    });

    it('should handle target at full HP', () => {
      const item = { effect_type: 'heal_hp', effect_value: 50 };
      const target = { hp: 100, maxHp: 100 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.effectiveHeal, 0);
      assert.strictEqual(result.isOverheal, true);
    });
  });

  describe('heal_mp items', () => {
    it('should calculate effective MP restore amount', () => {
      const item = { effect_type: 'heal_mp', effect_value: 30 };
      const target = { mp: 10, maxMp: 50 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.type, 'mp_restore');
      assert.strictEqual(result.minRestore, 30);
      assert.strictEqual(result.maxRestore, 30);
      assert.strictEqual(result.effectiveRestore, 30);
      assert.strictEqual(result.isOverheal, false);
      assert.strictEqual(result.hitChance, 1.0);
    });

    it('should detect MP overheal', () => {
      const item = { effect_type: 'heal_mp', effect_value: 50 };
      const target = { mp: 40, maxMp: 50 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.effectiveRestore, 10);
      assert.strictEqual(result.isOverheal, true);
    });

    it('should handle snake_case MP properties', () => {
      const item = { effect_type: 'heal_mp', effect_value: 20 };
      const target = { mp_current: 30, mp_max: 50 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.effectiveRestore, 20);
    });
  });

  describe('heal_both items (elixirs)', () => {
    it('should restore HP at full value and MP at half value', () => {
      const item = { effect_type: 'heal_both', effect_value: 100 };
      const target = { hp: 50, maxHp: 200, mp: 20, maxMp: 100 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.type, 'heal_both');
      assert.strictEqual(result.hpValue, 100);
      assert.strictEqual(result.mpValue, 50); // Half of effect_value
      assert.strictEqual(result.effectiveHpHeal, 100);
      assert.strictEqual(result.effectiveMpRestore, 50);
      assert.strictEqual(result.hitChance, 1.0);
    });

    it('should detect HP and MP overheal separately', () => {
      const item = { effect_type: 'heal_both', effect_value: 100 };
      const target = { hp: 180, maxHp: 200, mp: 90, maxMp: 100 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.isHpOverheal, true); // 100 heal but only 20 missing
      assert.strictEqual(result.isMpOverheal, true); // 50 restore but only 10 missing
      assert.strictEqual(result.effectiveHpHeal, 20);
      assert.strictEqual(result.effectiveMpRestore, 10);
    });
  });

  describe('cure_poison items', () => {
    it('should detect poison status to cure', () => {
      const item = { effect_type: 'cure_poison' };
      const target = { statusEffects: [{ type: 'poison' }] };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.type, 'cure');
      assert.strictEqual(result.willCure, true);
      assert.deepStrictEqual(result.curedEffects, ['poison']);
      assert.strictEqual(result.hitChance, 1.0);
    });

    it('should indicate no status to cure when target not poisoned', () => {
      const item = { effect_type: 'cure_poison' };
      const target = { statusEffects: [] };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.willCure, false);
    });

    it('should handle missing statusEffects array', () => {
      const item = { effect_type: 'cure_poison' };
      const target = { hp: 50, maxHp: 100 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.willCure, false);
    });
  });

  describe('cure_all items', () => {
    it('should identify multiple curable status effects', () => {
      const item = { effect_type: 'cure_all' };
      const target = { statusEffects: [{ type: 'poison' }, { type: 'blind' }, { type: 'stun' }] };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.type, 'cure');
      assert.strictEqual(result.willCure, true);
      // stun is not in CURE_ALL_EFFECTS, so only poison and blind
      assert.deepStrictEqual(result.activeEffects, ['poison', 'blind']);
    });

    it('should report curedEffects from CURE_ALL_EFFECTS constant', () => {
      const item = { effect_type: 'cure_all' };
      const target = { statusEffects: [{ type: 'poison' }] };
      const result = calculateItemPreview(item, target);

      assert.deepStrictEqual(result.curedEffects, CURE_ALL_EFFECTS);
    });

    it('should indicate no cure when no matching effects', () => {
      const item = { effect_type: 'cure_all' };
      const target = { statusEffects: [{ type: 'stun' }, { type: 'haste' }] };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.willCure, false);
      assert.deepStrictEqual(result.activeEffects, []);
    });
  });

  describe('revive items', () => {
    it('should calculate revival HP based on percentage', () => {
      const item = { effect_type: 'revive', effect_value: 50 };
      const target = { hp: 0, maxHp: 200 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.type, 'revive');
      assert.strictEqual(result.willRevive, true);
      assert.strictEqual(result.revivePercent, 50);
      assert.strictEqual(result.reviveHp, 100); // 50% of 200
      assert.strictEqual(result.targetMaxHp, 200);
      assert.strictEqual(result.hitChance, 1.0);
    });

    it('should indicate target not KO when target is alive', () => {
      const item = { effect_type: 'revive', effect_value: 50 };
      const target = { hp: 50, maxHp: 200 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.willRevive, false);
    });

    it('should handle negative HP as dead', () => {
      const item = { effect_type: 'revive', effect_value: 25 };
      const target = { hp: -10, maxHp: 100 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.willRevive, true);
      assert.strictEqual(result.reviveHp, 25);
    });
  });

  describe('edge cases', () => {
    it('should return null for null item', () => {
      const result = calculateItemPreview(null, { hp: 50, maxHp: 100 });
      assert.strictEqual(result, null);
    });

    it('should return null for undefined item', () => {
      const result = calculateItemPreview(undefined, { hp: 50, maxHp: 100 });
      assert.strictEqual(result, null);
    });

    it('should return null for item without effect_type', () => {
      const item = { name: 'Broken Item', effect_value: 50 };
      const result = calculateItemPreview(item, { hp: 50, maxHp: 100 });
      assert.strictEqual(result, null);
    });

    it('should return null for unknown effect_type', () => {
      const item = { effect_type: 'unknown_effect', effect_value: 50 };
      const result = calculateItemPreview(item, { hp: 50, maxHp: 100 });
      assert.strictEqual(result, null);
    });

    it('should handle zero effect_value', () => {
      const item = { effect_type: 'heal_hp', effect_value: 0 };
      const target = { hp: 50, maxHp: 100 };
      const result = calculateItemPreview(item, target);

      assert.strictEqual(result.minHeal, 0);
      assert.strictEqual(result.effectiveHeal, 0);
    });

    it('should use default maxHp when missing', () => {
      const item = { effect_type: 'heal_hp', effect_value: 50 };
      const target = { hp: 50 }; // No maxHp
      const result = calculateItemPreview(item, target);

      // Default maxHp is 100, so 50 missing HP
      assert.strictEqual(result.effectiveHeal, 50);
      assert.strictEqual(result.isOverheal, false);
    });

    it('should use default maxMp when missing', () => {
      const item = { effect_type: 'heal_mp', effect_value: 30 };
      const target = { mp: 20 }; // No maxMp
      const result = calculateItemPreview(item, target);

      // Default maxMp is 50, so 30 missing MP
      assert.strictEqual(result.effectiveRestore, 30);
      assert.strictEqual(result.isOverheal, false);
    });
  });
});

describe('calculateDamagePreview skill hit chance', () => {
  const attacker = { strength: 30, intelligence: 30, agility: 20, luck: 10 };
  const defender = { vitality: 20, intelligence: 20, agility: 20, luck: 10, hp: 100, maxHp: 100 };

  it('should return hitChance 1.0 for healing skills (Potion Toss)', () => {
    const healSkill = {
      id: 'potion_toss',
      power: 100,
      effect: 'heal',
      targetAlly: true
    };
    const preview = calculateDamagePreview(attacker, defender, healSkill);

    assert.strictEqual(preview.type, 'heal');
    assert.strictEqual(preview.hitChance, 1.0, 'Heals should always hit');
  });

  it('should return null for no-damage skills (Taunt)', () => {
    const tauntSkill = {
      id: 'taunt',
      power: 0,
      effect: 'taunt'
    };
    const preview = calculateDamagePreview(attacker, defender, tauntSkill);

    assert.strictEqual(preview, null, 'No-damage skills should return null');
  });

  it('should calculate real hit chance for offensive multi-hit skills (Thousand Fists)', () => {
    const thousandFists = {
      id: 'thousand_fists',
      power: 30,
      hits: 5,
      damageType: 'physical'
    };
    const preview = calculateDamagePreview(attacker, defender, thousandFists);

    assert.ok(preview.hits === 5, 'Multi-hit should report 5 hits');
    // With equal AGI, hit chance should be close to BASE_ACCURACY (0.95) minus BASE_EVASION (0.02)
    assert.ok(preview.hitChance < 1.0, 'Offensive skills should not have 100% hit');
    assert.ok(preview.hitChance >= 0.50, 'Hit chance should be at least 50%');
  });

  it('should apply skill accuracy to hit chance (Wild Swing)', () => {
    const wildSwing = {
      id: 'wild_swing',
      power: 200,
      accuracy: 0.5,
      damageType: 'physical'
    };
    const normalAttack = {
      id: 'normal_attack',
      power: 100,
      damageType: 'physical'
    };

    const wildSwingPreview = calculateDamagePreview(attacker, defender, wildSwing);
    const normalPreview = calculateDamagePreview(attacker, defender, normalAttack);

    // Wild Swing should have roughly half the normal hit chance
    assert.ok(
      wildSwingPreview.hitChance < normalPreview.hitChance * 0.6,
      `Wild Swing (${wildSwingPreview.hitChance}) should have much lower hit than normal (${normalPreview.hitChance})`
    );
    // Wild Swing with 0.5 accuracy: 0.93 (approx) * 0.5 = ~0.465
    assert.ok(
      wildSwingPreview.hitChance >= 0.25 && wildSwingPreview.hitChance <= 0.55,
      `Wild Swing hit chance should be around 45-50%, got ${wildSwingPreview.hitChance}`
    );
  });

  it('should return hitChance 1.0 for ally-targeted skills', () => {
    const allyBuffSkill = {
      id: 'protect',
      power: 0,
      effect: 'defense_up',
      targetAlly: true
    };
    // For ally-targeted skills with power 0, preview returns null
    // Let's test with a heal percent skill instead
    const allyHealSkill = {
      id: 'heal_light',
      healPercent: 25,
      targetAlly: true
    };
    const preview = calculateDamagePreview(attacker, defender, allyHealSkill);

    assert.strictEqual(preview.hitChance, 1.0, 'Ally-targeted heals should always hit');
  });

  it('should return hitChance 1.0 for self-targeted skills', () => {
    const selfBuffSkill = {
      id: 'meditation',
      healPercent: 10,
      targetSelf: true
    };
    const preview = calculateDamagePreview(attacker, attacker, selfBuffSkill);

    assert.strictEqual(preview.hitChance, 1.0, 'Self-targeted skills should always hit');
  });
});
