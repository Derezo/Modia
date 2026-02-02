/**
 * Unit tests for coliseum/statistics.js - calculateEnhancedMatchStats
 *
 * Tests the enhanced per-unit match statistics calculation including:
 * - Battle lookup and validation
 * - Per-unit damage dealt/taken tracking
 * - Healing done calculation
 * - Kill/death counting
 * - Battle summary (turns, duration)
 *
 * Note: These tests use an extracted version of the calculation logic
 * to enable pure unit testing without database dependencies. The logic
 * mirrors the implementation in statistics.js.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// =============================================================================
// EXTRACTED LOGIC FOR TESTING
// =============================================================================

/**
 * Calculate enhanced match stats - extracted logic from statistics.js
 * This mirrors the implementation in calculateEnhancedMatchStats but accepts
 * a query function parameter for testability.
 *
 * @param {number} battleId - Battle ID
 * @param {Function} queryFn - Database query function
 * @returns {Promise<Object|null>} Enhanced match statistics
 */
async function calculateEnhancedMatchStatsLogic(battleId, queryFn) {
  const result = await queryFn(
    'SELECT battle_state, started_at FROM battles WHERE id = $1',
    [battleId]
  );

  if (result.rows.length === 0) return null;

  const { battle_state: state, started_at } = result.rows[0];

  if (!state || !state.units) return null;

  // Build unit stats map for O(1) lookup
  const unitStatsMap = new Map();

  for (const unit of state.units) {
    unitStatsMap.set(unit.id, {
      id: unit.id,
      name: unit.name,
      class: unit.class,
      race: unit.race,
      level: unit.level,
      teamId: unit.teamId,
      ownerId: unit.ownerId,
      damageDealt: 0,
      damageTaken: 0,
      healingDone: 0,
      kills: 0,
      deaths: unit.hp <= 0 ? 1 : 0,
      survivedWith: Math.max(0, unit.hp)
    });
  }

  // Parse battle log for damage/healing/kills
  if (state.log && Array.isArray(state.log)) {
    for (const entry of state.log) {
      const actorId = entry.actorId;
      const targetId = entry.targetId;

      // Check for damage at both nesting levels
      const damage = entry.damage ?? entry.result?.damage ?? 0;
      if (damage > 0) {
        const actorStats = unitStatsMap.get(actorId);
        if (actorStats) {
          actorStats.damageDealt += damage;
        }
        const targetStats = unitStatsMap.get(targetId);
        if (targetStats) {
          targetStats.damageTaken += damage;
        }
      }

      // Check for healing at both nesting levels
      const healing = entry.healing ?? entry.result?.healing ?? 0;
      if (healing > 0) {
        const actorStats = unitStatsMap.get(actorId);
        if (actorStats) {
          actorStats.healingDone += healing;
        }
      }

      // Check for kills at both nesting levels
      const targetDefeated = entry.targetDefeated ?? entry.result?.targetDefeated ?? false;
      if (targetDefeated) {
        const actorStats = unitStatsMap.get(actorId);
        if (actorStats) {
          actorStats.kills += 1;
        }
      }
    }
  }

  // Convert map to array for return value
  const unitStats = Array.from(unitStatsMap.values());

  return {
    unitStats,
    battleSummary: {
      totalTurns: state.turn || 0,
      durationSeconds: Math.floor((Date.now() - new Date(started_at).getTime()) / 1000)
    }
  };
}

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create a mock query function that returns configured responses
 */
function createMockQueryFn(response) {
  const calls = [];
  const fn = async (sql, params) => {
    calls.push({ sql, params });
    return response;
  };
  fn.getCalls = () => calls;
  return fn;
}

/**
 * Create a mock battle unit for testing
 */
function createMockUnit(overrides = {}) {
  const id = overrides.id ?? `unit_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return {
    id,
    name: overrides.name ?? `Unit_${id}`,
    class: overrides.class ?? 'warrior',
    race: overrides.race ?? 'human',
    level: overrides.level ?? 10,
    teamId: overrides.teamId ?? 1,
    ownerId: overrides.ownerId ?? 1,
    hp: overrides.hp ?? 100,
    maxHp: overrides.maxHp ?? 100,
    ...overrides
  };
}

/**
 * Create a mock battle state
 */
function createMockBattleState(overrides = {}) {
  return {
    units: overrides.units ?? [
      createMockUnit({ id: 'unit1', teamId: 1 }),
      createMockUnit({ id: 'unit2', teamId: 2 })
    ],
    log: overrides.log ?? [],
    turn: overrides.turn ?? 5,
    ...overrides
  };
}

/**
 * Create a log entry for damage
 */
function createDamageLogEntry(actorId, targetId, damage, options = {}) {
  const entry = {
    actorId,
    targetId,
    type: options.type ?? 'attack'
  };

  if (options.nested) {
    entry.result = { damage };
    if (options.targetDefeated) {
      entry.result.targetDefeated = true;
    }
  } else {
    entry.damage = damage;
    if (options.targetDefeated) {
      entry.targetDefeated = true;
    }
  }

  return entry;
}

/**
 * Create a log entry for healing
 */
function createHealingLogEntry(actorId, targetId, healing, options = {}) {
  const entry = {
    actorId,
    targetId,
    type: options.type ?? 'heal'
  };

  if (options.nested) {
    entry.result = { healing };
  } else {
    entry.healing = healing;
  }

  return entry;
}

// =============================================================================
// TESTS
// =============================================================================

describe('calculateEnhancedMatchStats', () => {
  // =========================================================================
  // NULL RETURN CASES
  // =========================================================================

  describe('returns null for invalid battles', () => {
    it('should return null for non-existent battle', async () => {
      const mockQueryFn = createMockQueryFn({ rows: [] });

      const result = await calculateEnhancedMatchStatsLogic(99999, mockQueryFn);

      assert.strictEqual(result, null);
      const calls = mockQueryFn.getCalls();
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].params[0], 99999);
    });

    it('should return null when battle_state is null', async () => {
      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: null,
          started_at: new Date()
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.strictEqual(result, null);
    });

    it('should return null when units array is missing from state', async () => {
      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: { log: [], turn: 3 }, // No units property
          started_at: new Date()
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.strictEqual(result, null);
    });

    it('should return null when units is undefined', async () => {
      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: { units: undefined, log: [], turn: 3 },
          started_at: new Date()
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.strictEqual(result, null);
    });
  });

  // =========================================================================
  // DAMAGE CALCULATION
  // =========================================================================

  describe('damage calculations', () => {
    it('should calculate damage dealt from top-level entry.damage', async () => {
      const unit1 = createMockUnit({ id: 'attacker', teamId: 1 });
      const unit2 = createMockUnit({ id: 'defender', teamId: 2 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: [
              createDamageLogEntry('attacker', 'defender', 50),
              createDamageLogEntry('attacker', 'defender', 30)
            ]
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      const attackerStats = result.unitStats.find(u => u.id === 'attacker');
      assert.strictEqual(attackerStats.damageDealt, 80);
    });

    it('should calculate damage dealt from nested entry.result.damage', async () => {
      const unit1 = createMockUnit({ id: 'attacker', teamId: 1 });
      const unit2 = createMockUnit({ id: 'defender', teamId: 2 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: [
              createDamageLogEntry('attacker', 'defender', 75, { nested: true }),
              createDamageLogEntry('attacker', 'defender', 25, { nested: true })
            ]
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      const attackerStats = result.unitStats.find(u => u.id === 'attacker');
      assert.strictEqual(attackerStats.damageDealt, 100);
    });

    it('should calculate damage taken by target', async () => {
      const unit1 = createMockUnit({ id: 'attacker', teamId: 1 });
      const unit2 = createMockUnit({ id: 'defender', teamId: 2 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: [
              createDamageLogEntry('attacker', 'defender', 40),
              createDamageLogEntry('attacker', 'defender', 60)
            ]
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      const defenderStats = result.unitStats.find(u => u.id === 'defender');
      assert.strictEqual(defenderStats.damageTaken, 100);
    });

    it('should handle mixed damage format (top-level and nested)', async () => {
      const unit1 = createMockUnit({ id: 'attacker', teamId: 1 });
      const unit2 = createMockUnit({ id: 'defender', teamId: 2 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: [
              createDamageLogEntry('attacker', 'defender', 50), // top-level
              createDamageLogEntry('attacker', 'defender', 50, { nested: true }) // nested
            ]
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      const attackerStats = result.unitStats.find(u => u.id === 'attacker');
      assert.strictEqual(attackerStats.damageDealt, 100);
    });
  });

  // =========================================================================
  // HEALING CALCULATION
  // =========================================================================

  describe('healing calculations', () => {
    it('should calculate healing done from top-level entry.healing', async () => {
      const unit1 = createMockUnit({ id: 'healer', teamId: 1, class: 'cleric' });
      const unit2 = createMockUnit({ id: 'ally', teamId: 1 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: [
              createHealingLogEntry('healer', 'ally', 30),
              createHealingLogEntry('healer', 'ally', 20)
            ]
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      const healerStats = result.unitStats.find(u => u.id === 'healer');
      assert.strictEqual(healerStats.healingDone, 50);
    });

    it('should calculate healing done from nested entry.result.healing', async () => {
      const unit1 = createMockUnit({ id: 'healer', teamId: 1, class: 'cleric' });
      const unit2 = createMockUnit({ id: 'ally', teamId: 1 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: [
              createHealingLogEntry('healer', 'ally', 45, { nested: true }),
              createHealingLogEntry('healer', 'ally', 55, { nested: true })
            ]
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      const healerStats = result.unitStats.find(u => u.id === 'healer');
      assert.strictEqual(healerStats.healingDone, 100);
    });
  });

  // =========================================================================
  // KILL/DEATH TRACKING
  // =========================================================================

  describe('kill and death tracking', () => {
    it('should count kills from top-level targetDefeated field', async () => {
      const unit1 = createMockUnit({ id: 'killer', teamId: 1 });
      const unit2 = createMockUnit({ id: 'victim', teamId: 2, hp: 0 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: [
              createDamageLogEntry('killer', 'victim', 100, { targetDefeated: true })
            ]
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      const killerStats = result.unitStats.find(u => u.id === 'killer');
      assert.strictEqual(killerStats.kills, 1);
    });

    it('should count kills from nested result.targetDefeated field', async () => {
      const unit1 = createMockUnit({ id: 'killer', teamId: 1 });
      const unit2 = createMockUnit({ id: 'victim1', teamId: 2, hp: 0 });
      const unit3 = createMockUnit({ id: 'victim2', teamId: 2, hp: 0 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2, unit3],
            log: [
              createDamageLogEntry('killer', 'victim1', 100, { nested: true, targetDefeated: true }),
              createDamageLogEntry('killer', 'victim2', 100, { nested: true, targetDefeated: true })
            ]
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      const killerStats = result.unitStats.find(u => u.id === 'killer');
      assert.strictEqual(killerStats.kills, 2);
    });

    it('should count deaths based on unit HP <= 0', async () => {
      const unit1 = createMockUnit({ id: 'survivor', teamId: 1, hp: 50 });
      const unit2 = createMockUnit({ id: 'dead1', teamId: 2, hp: 0 });
      const unit3 = createMockUnit({ id: 'dead2', teamId: 2, hp: -10 }); // Overkill

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2, unit3],
            log: []
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);

      const survivorStats = result.unitStats.find(u => u.id === 'survivor');
      assert.strictEqual(survivorStats.deaths, 0);
      assert.strictEqual(survivorStats.survivedWith, 50);

      const dead1Stats = result.unitStats.find(u => u.id === 'dead1');
      assert.strictEqual(dead1Stats.deaths, 1);
      assert.strictEqual(dead1Stats.survivedWith, 0);

      const dead2Stats = result.unitStats.find(u => u.id === 'dead2');
      assert.strictEqual(dead2Stats.deaths, 1);
      assert.strictEqual(dead2Stats.survivedWith, 0); // Math.max(0, -10) = 0
    });
  });

  // =========================================================================
  // EMPTY LOG HANDLING
  // =========================================================================

  describe('empty and missing log handling', () => {
    it('should handle empty battle log gracefully', async () => {
      const unit1 = createMockUnit({ id: 'unit1', teamId: 1 });
      const unit2 = createMockUnit({ id: 'unit2', teamId: 2 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: []
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      assert.strictEqual(result.unitStats.length, 2);

      for (const stats of result.unitStats) {
        assert.strictEqual(stats.damageDealt, 0);
        assert.strictEqual(stats.damageTaken, 0);
        assert.strictEqual(stats.healingDone, 0);
        assert.strictEqual(stats.kills, 0);
      }
    });

    it('should handle missing log property gracefully', async () => {
      const unit1 = createMockUnit({ id: 'unit1', teamId: 1 });
      const unit2 = createMockUnit({ id: 'unit2', teamId: 2 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: {
            units: [unit1, unit2],
            turn: 3
            // No log property
          },
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      assert.strictEqual(result.unitStats.length, 2);

      for (const stats of result.unitStats) {
        assert.strictEqual(stats.damageDealt, 0);
        assert.strictEqual(stats.damageTaken, 0);
        assert.strictEqual(stats.healingDone, 0);
        assert.strictEqual(stats.kills, 0);
      }
    });

    it('should handle null log property gracefully', async () => {
      const unit1 = createMockUnit({ id: 'unit1', teamId: 1 });
      const unit2 = createMockUnit({ id: 'unit2', teamId: 2 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: {
            units: [unit1, unit2],
            log: null,
            turn: 3
          },
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      assert.strictEqual(result.unitStats.length, 2);
    });
  });

  // =========================================================================
  // MISSING ACTOR/TARGET HANDLING
  // =========================================================================

  describe('missing actorId/targetId handling', () => {
    it('should handle log entries with missing actorId', async () => {
      const unit1 = createMockUnit({ id: 'unit1', teamId: 1 });
      const unit2 = createMockUnit({ id: 'unit2', teamId: 2 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: [
              { targetId: 'unit2', damage: 50 }, // Missing actorId
              createDamageLogEntry('unit1', 'unit2', 30)
            ]
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      // The entry with missing actorId should not crash, damage should still be tracked for target
      const unit1Stats = result.unitStats.find(u => u.id === 'unit1');
      const unit2Stats = result.unitStats.find(u => u.id === 'unit2');

      assert.strictEqual(unit1Stats.damageDealt, 30); // Only the valid entry
      assert.strictEqual(unit2Stats.damageTaken, 80); // Both entries (50 + 30)
    });

    it('should handle log entries with missing targetId', async () => {
      const unit1 = createMockUnit({ id: 'unit1', teamId: 1 });
      const unit2 = createMockUnit({ id: 'unit2', teamId: 2 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: [
              { actorId: 'unit1', damage: 50 }, // Missing targetId
              createDamageLogEntry('unit1', 'unit2', 30)
            ]
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      const unit1Stats = result.unitStats.find(u => u.id === 'unit1');
      const unit2Stats = result.unitStats.find(u => u.id === 'unit2');

      assert.strictEqual(unit1Stats.damageDealt, 80); // Both entries (50 + 30)
      assert.strictEqual(unit2Stats.damageTaken, 30); // Only the valid entry
    });

    it('should handle log entries with non-existent unit IDs', async () => {
      const unit1 = createMockUnit({ id: 'unit1', teamId: 1 });
      const unit2 = createMockUnit({ id: 'unit2', teamId: 2 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: [
              createDamageLogEntry('ghost_unit', 'unit2', 50), // Non-existent actor
              createDamageLogEntry('unit1', 'ghost_unit', 30), // Non-existent target
              createDamageLogEntry('unit1', 'unit2', 20) // Valid entry
            ]
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      const unit1Stats = result.unitStats.find(u => u.id === 'unit1');
      const unit2Stats = result.unitStats.find(u => u.id === 'unit2');

      // Only valid entries should be counted for existing units
      assert.strictEqual(unit1Stats.damageDealt, 50); // 30 (ghost target) + 20 (valid)
      assert.strictEqual(unit2Stats.damageTaken, 70); // 50 (ghost actor) + 20 (valid)
    });
  });

  // =========================================================================
  // BATTLE SUMMARY
  // =========================================================================

  describe('battle summary', () => {
    it('should return correct totalTurns from state', async () => {
      const unit1 = createMockUnit({ id: 'unit1', teamId: 1 });
      const unit2 = createMockUnit({ id: 'unit2', teamId: 2 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: [],
            turn: 15
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      assert.strictEqual(result.battleSummary.totalTurns, 15);
    });

    it('should return 0 totalTurns when turn is missing', async () => {
      const unit1 = createMockUnit({ id: 'unit1', teamId: 1 });
      const unit2 = createMockUnit({ id: 'unit2', teamId: 2 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: {
            units: [unit1, unit2],
            log: []
            // No turn property
          },
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      assert.strictEqual(result.battleSummary.totalTurns, 0);
    });

    it('should calculate durationSeconds correctly', async () => {
      const unit1 = createMockUnit({ id: 'unit1', teamId: 1 });
      const unit2 = createMockUnit({ id: 'unit2', teamId: 2 });

      // Battle started 120 seconds ago
      const startTime = new Date(Date.now() - 120000);

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: []
          }),
          started_at: startTime
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      // Allow 1 second tolerance for test execution time
      assert.ok(
        result.battleSummary.durationSeconds >= 119 && result.battleSummary.durationSeconds <= 121,
        `Expected duration ~120s, got ${result.battleSummary.durationSeconds}s`
      );
    });
  });

  // =========================================================================
  // UNIT STATS STRUCTURE
  // =========================================================================

  describe('unit stats structure', () => {
    it('should include all required fields in unit stats', async () => {
      const unit1 = createMockUnit({
        id: 'test_unit',
        name: 'Test Warrior',
        class: 'warrior',
        race: 'human',
        level: 25,
        teamId: 1,
        ownerId: 123,
        hp: 75
      });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1],
            log: []
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      assert.strictEqual(result.unitStats.length, 1);

      const stats = result.unitStats[0];
      assert.strictEqual(stats.id, 'test_unit');
      assert.strictEqual(stats.name, 'Test Warrior');
      assert.strictEqual(stats.class, 'warrior');
      assert.strictEqual(stats.race, 'human');
      assert.strictEqual(stats.level, 25);
      assert.strictEqual(stats.teamId, 1);
      assert.strictEqual(stats.ownerId, 123);
      assert.strictEqual(stats.damageDealt, 0);
      assert.strictEqual(stats.damageTaken, 0);
      assert.strictEqual(stats.healingDone, 0);
      assert.strictEqual(stats.kills, 0);
      assert.strictEqual(stats.deaths, 0);
      assert.strictEqual(stats.survivedWith, 75);
    });

    it('should return unitStats as an array', async () => {
      const unit1 = createMockUnit({ id: 'unit1', teamId: 1 });
      const unit2 = createMockUnit({ id: 'unit2', teamId: 2 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [unit1, unit2],
            log: []
          }),
          started_at: new Date(Date.now() - 60000)
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);
      assert.ok(Array.isArray(result.unitStats));
      assert.strictEqual(result.unitStats.length, 2);
    });
  });

  // =========================================================================
  // COMPREHENSIVE SCENARIO
  // =========================================================================

  describe('comprehensive battle scenario', () => {
    it('should correctly calculate all stats for a complete battle', async () => {
      const warrior = createMockUnit({ id: 'warrior', name: 'Tank', class: 'warrior', teamId: 1, hp: 20 });
      const mage = createMockUnit({ id: 'mage', name: 'Nuker', class: 'mage', teamId: 1, hp: 80 });
      const cleric = createMockUnit({ id: 'cleric', name: 'Healer', class: 'cleric', teamId: 1, hp: 100 });
      const enemy1 = createMockUnit({ id: 'enemy1', name: 'Goblin', teamId: 2, hp: 0 });
      const enemy2 = createMockUnit({ id: 'enemy2', name: 'Orc', teamId: 2, hp: 0 });

      const mockQueryFn = createMockQueryFn({
        rows: [{
          battle_state: createMockBattleState({
            units: [warrior, mage, cleric, enemy1, enemy2],
            log: [
              // Turn 1: Mage attacks enemy1
              createDamageLogEntry('mage', 'enemy1', 80),
              // Turn 2: Enemy1 attacks warrior
              createDamageLogEntry('enemy1', 'warrior', 40),
              // Turn 3: Cleric heals warrior
              createHealingLogEntry('cleric', 'warrior', 30),
              // Turn 4: Mage kills enemy1
              createDamageLogEntry('mage', 'enemy1', 60, { targetDefeated: true }),
              // Turn 5: Enemy2 attacks mage
              createDamageLogEntry('enemy2', 'mage', 20),
              // Turn 6: Warrior attacks enemy2
              createDamageLogEntry('warrior', 'enemy2', 50),
              // Turn 7: Mage kills enemy2
              createDamageLogEntry('mage', 'enemy2', 70, { nested: true, targetDefeated: true })
            ],
            turn: 7
          }),
          started_at: new Date(Date.now() - 180000) // 3 minutes
        }]
      });

      const result = await calculateEnhancedMatchStatsLogic(1, mockQueryFn);

      assert.ok(result);

      // Verify warrior stats
      const warriorStats = result.unitStats.find(u => u.id === 'warrior');
      assert.strictEqual(warriorStats.damageDealt, 50);
      assert.strictEqual(warriorStats.damageTaken, 40);
      assert.strictEqual(warriorStats.healingDone, 0);
      assert.strictEqual(warriorStats.kills, 0);
      assert.strictEqual(warriorStats.deaths, 0);
      assert.strictEqual(warriorStats.survivedWith, 20);

      // Verify mage stats
      const mageStats = result.unitStats.find(u => u.id === 'mage');
      assert.strictEqual(mageStats.damageDealt, 210); // 80 + 60 + 70
      assert.strictEqual(mageStats.damageTaken, 20);
      assert.strictEqual(mageStats.healingDone, 0);
      assert.strictEqual(mageStats.kills, 2);
      assert.strictEqual(mageStats.deaths, 0);

      // Verify cleric stats
      const clericStats = result.unitStats.find(u => u.id === 'cleric');
      assert.strictEqual(clericStats.damageDealt, 0);
      assert.strictEqual(clericStats.damageTaken, 0);
      assert.strictEqual(clericStats.healingDone, 30);
      assert.strictEqual(clericStats.kills, 0);
      assert.strictEqual(clericStats.deaths, 0);

      // Verify enemy1 stats
      const enemy1Stats = result.unitStats.find(u => u.id === 'enemy1');
      assert.strictEqual(enemy1Stats.damageDealt, 40);
      assert.strictEqual(enemy1Stats.damageTaken, 140); // 80 + 60
      assert.strictEqual(enemy1Stats.deaths, 1);

      // Verify enemy2 stats
      const enemy2Stats = result.unitStats.find(u => u.id === 'enemy2');
      assert.strictEqual(enemy2Stats.damageDealt, 20);
      assert.strictEqual(enemy2Stats.damageTaken, 120); // 50 + 70
      assert.strictEqual(enemy2Stats.deaths, 1);

      // Verify battle summary
      assert.strictEqual(result.battleSummary.totalTurns, 7);
      assert.ok(result.battleSummary.durationSeconds >= 179 && result.battleSummary.durationSeconds <= 181);
    });
  });
});
