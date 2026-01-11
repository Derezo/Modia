/**
 * Boss Service Tests
 *
 * Tests for multi-phase boss encounter mechanics
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  isBoss,
  initializeBossState,
  checkPhaseTransition,
  applyPhaseTransition,
  getPhaseDisplayInfo
} from '../services/bossService.js';

// Mock boss template
function createMockBoss(overrides = {}) {
  return {
    id: 'enemy_0',
    name: 'Forest Guardian',
    type: 'enemy',
    level: 10,
    hp: 500,
    maxHp: 500,
    mp: 100,
    maxMp: 100,
    attack: 20,
    defense: 15,
    magicAttack: 10,
    magicDefense: 10,
    agility: 12,
    templateId: 1,
    skills: [],
    statusEffects: [],
    is_boss: true,
    phases: [
      {
        threshold: 1.0,
        name: 'Awakened',
        abilities: ['plant_vine_lash'],
        statMods: {}
      },
      {
        threshold: 0.5,
        name: 'Enraged',
        abilities: ['plant_vine_lash', 'plant_thorn_volley'],
        statMods: { attack: 1.5, defense: 0.8 },
        onEnter: { effect: 'attack_up', duration: 3 }
      }
    ],
    ...overrides
  };
}

function createMockBattleState(units = []) {
  return {
    units,
    bossStates: {}
  };
}

describe('Boss Service', () => {
  describe('isBoss', () => {
    test('should return true for boss template', () => {
      const boss = createMockBoss();
      assert.strictEqual(isBoss(boss), true);
    });

    test('should return false for non-boss template', () => {
      const enemy = { is_boss: false, phases: null };
      assert.strictEqual(isBoss(enemy), false);
    });

    test('should return false if phases array is empty', () => {
      const enemy = { is_boss: true, phases: [] };
      assert.strictEqual(isBoss(enemy), false);
    });
  });

  describe('initializeBossState', () => {
    test('should initialize boss state correctly', () => {
      const boss = createMockBoss();
      const state = initializeBossState(boss, 123);

      assert.strictEqual(state.battleId, 123);
      assert.strictEqual(state.unitId, 'enemy_0');
      assert.strictEqual(state.currentPhase, 1);
      assert.strictEqual(state.maxPhases, 2);
      assert.strictEqual(state.phaseName, 'Awakened');
      assert.deepStrictEqual(state.phaseThresholds, [1.0, 0.5]);
    });

    test('should return null for non-boss', () => {
      const enemy = { id: 'enemy_0', phases: [] };
      const state = initializeBossState(enemy, 123);
      assert.strictEqual(state, null);
    });

    test('should store base stats for later restoration', () => {
      const boss = createMockBoss();
      const state = initializeBossState(boss, 123);

      assert.strictEqual(state.baseStats.attack, 20);
      assert.strictEqual(state.baseStats.defense, 15);
    });
  });

  describe('checkPhaseTransition', () => {
    test('should detect phase transition when HP crosses threshold', () => {
      const boss = createMockBoss({ hp: 200 }); // 40% HP
      const bossState = {
        currentPhase: 1,
        maxPhases: 2
      };

      const transition = checkPhaseTransition(boss, bossState);

      assert.ok(transition, 'Should detect transition');
      assert.strictEqual(transition.fromPhase, 1);
      assert.strictEqual(transition.toPhase, 2);
      assert.strictEqual(transition.phaseName, 'Enraged');
    });

    test('should not transition when HP is above threshold', () => {
      const boss = createMockBoss({ hp: 400 }); // 80% HP
      const bossState = {
        currentPhase: 1,
        maxPhases: 2
      };

      const transition = checkPhaseTransition(boss, bossState);

      assert.strictEqual(transition, null);
    });

    test('should not re-trigger same phase', () => {
      const boss = createMockBoss({ hp: 200 });
      const bossState = {
        currentPhase: 2, // Already in phase 2
        maxPhases: 2
      };

      const transition = checkPhaseTransition(boss, bossState);

      assert.strictEqual(transition, null);
    });

    test('should handle null boss state', () => {
      const boss = createMockBoss();
      const transition = checkPhaseTransition(boss, null);
      assert.strictEqual(transition, null);
    });
  });

  describe('applyPhaseTransition', () => {
    test('should apply stat modifications', () => {
      const boss = createMockBoss({ hp: 200 });
      const bossState = initializeBossState(boss, 123);
      const battleState = createMockBattleState([boss]);

      const transition = checkPhaseTransition(boss, bossState);
      const effects = applyPhaseTransition(boss, transition, bossState, battleState);

      // Attack should be 1.5x
      assert.strictEqual(boss.attack, 30); // 20 * 1.5
      // Defense should be 0.8x
      assert.strictEqual(boss.defense, 12); // 15 * 0.8

      assert.ok(effects.statChanges.attack);
      assert.ok(effects.statChanges.defense);
    });

    test('should update boss state phase number', () => {
      const boss = createMockBoss({ hp: 200 });
      const bossState = initializeBossState(boss, 123);
      const battleState = createMockBattleState([boss]);

      const transition = checkPhaseTransition(boss, bossState);
      applyPhaseTransition(boss, transition, bossState, battleState);

      assert.strictEqual(bossState.currentPhase, 2);
      assert.strictEqual(bossState.phaseName, 'Enraged');
    });

    test('should apply entry effects', () => {
      const boss = createMockBoss({ hp: 200 });
      const bossState = initializeBossState(boss, 123);
      const battleState = createMockBattleState([boss]);

      const transition = checkPhaseTransition(boss, bossState);
      const effects = applyPhaseTransition(boss, transition, bossState, battleState);

      assert.ok(effects.entryEffects.length > 0);
      assert.ok(boss.statusEffects.length > 0);
      assert.strictEqual(boss.statusEffects[0].type, 'attack_up');
    });
  });

  describe('getPhaseDisplayInfo', () => {
    test('should return phase info for UI', () => {
      const boss = createMockBoss();
      const bossState = initializeBossState(boss, 123);

      const info = getPhaseDisplayInfo(boss, bossState);

      assert.strictEqual(info.name, 'Forest Guardian');
      assert.strictEqual(info.currentPhase, 1);
      assert.strictEqual(info.maxPhases, 2);
      assert.strictEqual(info.phaseName, 'Awakened');
      assert.strictEqual(info.isBoss, true);
    });

    test('should return null for non-boss', () => {
      const enemy = { name: 'Goblin' };
      const info = getPhaseDisplayInfo(enemy, null);
      assert.strictEqual(info, null);
    });
  });
});

describe('Multi-Phase Boss Scenarios', () => {
  test('3-phase boss should transition correctly through all phases', () => {
    const boss = {
      id: 'enemy_0',
      name: 'Cave Troll King',
      type: 'enemy',
      level: 15,
      hp: 700,
      maxHp: 700,
      attack: 35,
      defense: 20,
      magicAttack: 5,
      magicDefense: 10,
      agility: 8,
      templateId: 2,
      skills: [],
      statusEffects: [],
      is_boss: true,
      phases: [
        { threshold: 1.0, name: 'Mighty', abilities: [], statMods: {} },
        { threshold: 0.66, name: 'Summoning', abilities: [], statMods: { attack: 1.2 } },
        { threshold: 0.33, name: 'Berserk', abilities: [], statMods: { attack: 2.0, defense: 0.5 } }
      ]
    };

    const bossState = initializeBossState(boss, 123);
    const battleState = createMockBattleState([boss]);

    // Initial state
    assert.strictEqual(bossState.currentPhase, 1);

    // Damage to 60% HP (below 66% threshold)
    boss.hp = 420;
    let transition = checkPhaseTransition(boss, bossState);
    assert.ok(transition);
    assert.strictEqual(transition.toPhase, 2);
    applyPhaseTransition(boss, transition, bossState, battleState);
    assert.strictEqual(bossState.currentPhase, 2);
    assert.strictEqual(boss.attack, 42); // 35 * 1.2

    // Damage to 30% HP (below 33% threshold)
    boss.hp = 210;
    transition = checkPhaseTransition(boss, bossState);
    assert.ok(transition);
    assert.strictEqual(transition.toPhase, 3);
    applyPhaseTransition(boss, transition, bossState, battleState);
    assert.strictEqual(bossState.currentPhase, 3);
    // Attack is now based on BASE stats * 2.0, not current
    assert.strictEqual(boss.attack, 70); // 35 * 2.0
    assert.strictEqual(boss.defense, 10); // 20 * 0.5
  });
});
