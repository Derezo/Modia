/**
 * Boss Phase Dead Check Unit Tests
 *
 * Verifies that checkAllBossTransitions and processBossDamage skip dead
 * bosses (hp <= 0). This prevents spurious phase-transition banners on
 * dead bosses.
 *
 * Regression tests for the guards in api/src/routes/battle.js that prevent
 * phase transitions on bosses killed by single-target hits, AoE damage, or
 * DoT ticks. The hp check in processBossDamage is the authoritative guard;
 * the route's inline checks are defensive redundancy.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  checkAllBossTransitions,
  processBossDamage
} from '../../../services/bossService.js';

describe('checkAllBossTransitions', () => {
  it('should skip bosses with hp <= 0', () => {
    const battleState = {
      units: [
        {
          id: 'boss1',
          name: 'Dead Boss',
          type: 'enemy',
          hp: 0,
          maxHp: 100,
          phases: [
            { name: 'Phase 1', threshold: 1.0 },
            { name: 'Phase 2', threshold: 0.5 },
            { name: 'Phase 3', threshold: 0.25 }
          ]
        }
      ],
      bossStates: {
        boss1: {
          currentPhase: 1,
          maxPhases: 3,
          phaseName: 'Phase 1',
          baseStats: { attack: 10, defense: 5, magicAttack: 10, magicDefense: 5, agility: 10 }
        }
      }
    };

    const transitions = checkAllBossTransitions(battleState);

    assert.strictEqual(transitions.length, 0, 'Should not transition a dead boss');
    assert.strictEqual(
      battleState.bossStates.boss1.currentPhase,
      1,
      'Boss phase should remain unchanged'
    );
  });

  it('should process living bosses normally', () => {
    const battleState = {
      units: [
        {
          id: 'boss1',
          name: 'Living Boss',
          type: 'enemy',
          hp: 40,  // 40% HP, below 50% threshold
          maxHp: 100,
          phases: [
            { name: 'Phase 1', threshold: 1.0 },
            { name: 'Phase 2', threshold: 0.5 },
            { name: 'Phase 3', threshold: 0.25 }
          ]
        }
      ],
      bossStates: {
        boss1: {
          currentPhase: 1,
          maxPhases: 3,
          phaseName: 'Phase 1',
          baseStats: { attack: 10, defense: 5, magicAttack: 10, magicDefense: 5, agility: 10 }
        }
      }
    };

    const transitions = checkAllBossTransitions(battleState);

    assert.strictEqual(transitions.length, 1, 'Should transition the living boss');
    assert.strictEqual(transitions[0].toPhase, 2, 'Should transition to phase 2');
    assert.strictEqual(transitions[0].phaseName, 'Phase 2', 'Should have correct phase name');
    assert.strictEqual(
      battleState.bossStates.boss1.currentPhase,
      2,
      'Boss state should be updated to phase 2'
    );
  });

  it('should skip dead boss in multi-boss scenario', () => {
    const battleState = {
      units: [
        {
          id: 'boss1',
          name: 'Dead Boss',
          type: 'enemy',
          hp: 0,
          maxHp: 100,
          phases: [
            { name: 'Phase 1', threshold: 1.0 },
            { name: 'Phase 2', threshold: 0.5 }
          ]
        },
        {
          id: 'boss2',
          name: 'Living Boss',
          type: 'enemy',
          hp: 30,  // 30% HP, below 50% threshold
          maxHp: 100,
          phases: [
            { name: 'Phase 1', threshold: 1.0 },
            { name: 'Phase 2', threshold: 0.5 }
          ]
        }
      ],
      bossStates: {
        boss1: {
          currentPhase: 1,
          maxPhases: 2,
          phaseName: 'Phase 1',
          baseStats: { attack: 10, defense: 5, magicAttack: 10, magicDefense: 5, agility: 10 }
        },
        boss2: {
          currentPhase: 1,
          maxPhases: 2,
          phaseName: 'Phase 1',
          baseStats: { attack: 10, defense: 5, magicAttack: 10, magicDefense: 5, agility: 10 }
        }
      }
    };

    const transitions = checkAllBossTransitions(battleState);

    // Only boss2 should transition
    assert.strictEqual(transitions.length, 1, 'Should only transition the living boss');
    assert.strictEqual(transitions[0].unitId, 'boss2', 'Should be boss2');
    assert.strictEqual(
      battleState.bossStates.boss1.currentPhase,
      1,
      'Dead boss phase should remain unchanged'
    );
    assert.strictEqual(
      battleState.bossStates.boss2.currentPhase,
      2,
      'Living boss should transition to phase 2'
    );
  });

  it('should handle negative hp as dead', () => {
    const battleState = {
      units: [
        {
          id: 'boss1',
          name: 'Overkilled Boss',
          type: 'enemy',
          hp: -50,  // Overkill damage
          maxHp: 100,
          phases: [
            { name: 'Phase 1', threshold: 1.0 },
            { name: 'Phase 2', threshold: 0.5 }
          ]
        }
      ],
      bossStates: {
        boss1: {
          currentPhase: 1,
          maxPhases: 2,
          phaseName: 'Phase 1',
          baseStats: { attack: 10, defense: 5, magicAttack: 10, magicDefense: 5, agility: 10 }
        }
      }
    };

    const transitions = checkAllBossTransitions(battleState);

    assert.strictEqual(transitions.length, 0, 'Should not transition a boss with negative hp');
  });
});

/**
 * processBossDamage tests - these verify the direct function call that
 * battle.js uses for single-target, AoE, and DoT damage paths.
 *
 * Without the hp <= 0 guard in processBossDamage, a dead boss at 0% HP
 * would cross any remaining threshold (since hpPercent = 0/maxHp = 0),
 * triggering spurious phase transitions on corpses.
 */
describe('processBossDamage', () => {
  it('should return null for dead boss (hp = 0)', () => {
    const boss = {
      id: 'boss1',
      name: 'Dead Boss',
      type: 'enemy',
      hp: 0,
      maxHp: 100,
      phases: [
        { name: 'Phase 1', threshold: 1.0 },
        { name: 'Phase 2', threshold: 0.5 },
        { name: 'Phase 3', threshold: 0.25 }
      ],
      skills: [],
      statusEffects: []
    };
    const bossState = {
      currentPhase: 1,
      maxPhases: 3,
      phaseName: 'Phase 1',
      baseStats: { attack: 10, defense: 5, magicAttack: 10, magicDefense: 5, agility: 10 }
    };
    const battleState = { units: [boss], bossStates: { boss1: bossState } };

    // This damage would have killed the boss; now checking phase after death
    const result = processBossDamage(boss, bossState, 50, battleState);

    assert.strictEqual(result, null, 'Dead boss should not trigger phase transition');
    assert.strictEqual(bossState.currentPhase, 1, 'Phase should remain unchanged');
  });

  it('should return null for overkilled boss (hp < 0)', () => {
    const boss = {
      id: 'boss1',
      name: 'Overkilled Boss',
      type: 'enemy',
      hp: -30,
      maxHp: 100,
      phases: [
        { name: 'Phase 1', threshold: 1.0 },
        { name: 'Phase 2', threshold: 0.5 }
      ],
      skills: [],
      statusEffects: []
    };
    const bossState = {
      currentPhase: 1,
      maxPhases: 2,
      phaseName: 'Phase 1',
      baseStats: { attack: 10, defense: 5, magicAttack: 10, magicDefense: 5, agility: 10 }
    };
    const battleState = { units: [boss], bossStates: { boss1: bossState } };

    const result = processBossDamage(boss, bossState, 50, battleState);

    assert.strictEqual(result, null, 'Overkilled boss should not trigger phase transition');
    assert.strictEqual(bossState.currentPhase, 1, 'Phase should remain unchanged');
  });

  it('should return null when boss is null or undefined', () => {
    const bossState = {
      currentPhase: 1,
      maxPhases: 2,
      phaseName: 'Phase 1',
      baseStats: { attack: 10, defense: 5, magicAttack: 10, magicDefense: 5, agility: 10 }
    };
    const battleState = { units: [], bossStates: {} };

    assert.strictEqual(
      processBossDamage(null, bossState, 50, battleState),
      null,
      'Null boss should return null'
    );
    assert.strictEqual(
      processBossDamage(undefined, bossState, 50, battleState),
      null,
      'Undefined boss should return null'
    );
  });

  it('should return null when bossState is null', () => {
    const boss = {
      id: 'boss1',
      name: 'Boss',
      hp: 50,
      maxHp: 100,
      phases: [{ name: 'Phase 1', threshold: 1.0 }]
    };
    const battleState = { units: [boss], bossStates: {} };

    const result = processBossDamage(boss, null, 50, battleState);

    assert.strictEqual(result, null, 'Null bossState should return null');
  });

  it('should trigger phase transition for living boss crossing threshold', () => {
    const boss = {
      id: 'boss1',
      name: 'Living Boss',
      type: 'enemy',
      hp: 40,  // 40% HP, below 50% threshold
      maxHp: 100,
      phases: [
        { name: 'Phase 1', threshold: 1.0 },
        { name: 'Phase 2', threshold: 0.5 },
        { name: 'Phase 3', threshold: 0.25 }
      ],
      skills: [],
      statusEffects: []
    };
    const bossState = {
      currentPhase: 1,
      maxPhases: 3,
      phaseName: 'Phase 1',
      baseStats: { attack: 10, defense: 5, magicAttack: 10, magicDefense: 5, agility: 10 }
    };
    const battleState = { units: [boss], bossStates: { boss1: bossState } };

    const result = processBossDamage(boss, bossState, 60, battleState);

    assert.ok(result !== null, 'Living boss should trigger phase transition');
    assert.strictEqual(result.toPhase, 2, 'Should transition to phase 2');
    assert.strictEqual(result.phaseName, 'Phase 2', 'Should have correct phase name');
    assert.strictEqual(bossState.currentPhase, 2, 'Boss state should be updated');
  });

  it('should not transition living boss above all thresholds', () => {
    const boss = {
      id: 'boss1',
      name: 'Healthy Boss',
      type: 'enemy',
      hp: 80,  // 80% HP, above all transition thresholds
      maxHp: 100,
      phases: [
        { name: 'Phase 1', threshold: 1.0 },
        { name: 'Phase 2', threshold: 0.5 }
      ],
      skills: [],
      statusEffects: []
    };
    const bossState = {
      currentPhase: 1,
      maxPhases: 2,
      phaseName: 'Phase 1',
      baseStats: { attack: 10, defense: 5, magicAttack: 10, magicDefense: 5, agility: 10 }
    };
    const battleState = { units: [boss], bossStates: { boss1: bossState } };

    const result = processBossDamage(boss, bossState, 20, battleState);

    assert.strictEqual(result, null, 'Boss above threshold should not transition');
    assert.strictEqual(bossState.currentPhase, 1, 'Phase should remain at 1');
  });
});
