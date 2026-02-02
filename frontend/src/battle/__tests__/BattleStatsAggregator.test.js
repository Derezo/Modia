/**
 * BattleStatsAggregator Unit Tests
 *
 * Tests for aggregating per-unit battle statistics from log entries.
 * Covers damage tracking, kills, deaths, and MVP calculation.
 *
 * Run with: node --test frontend/src/battle/__tests__/BattleStatsAggregator.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { BattleStatsAggregator } from '../BattleStatsAggregator.js';

// ============================================================================
// Mock Factories
// ============================================================================

/**
 * Create a mock unit with default values
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock unit object
 */
function createMockUnit(overrides = {}) {
  return {
    id: 1,
    name: 'TestUnit',
    class: 'warrior',
    race: 'human',
    level: 10,
    teamId: 1,
    ownerId: 100,
    hp: 100,
    ...overrides
  };
}

/**
 * Create a mock log entry in frontend format (actor/target objects)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock log entry
 */
function createFrontendLogEntry(overrides = {}) {
  return {
    actor: { id: 1, name: 'Attacker' },
    target: { id: 2, name: 'Defender' },
    result: {
      damage: 50,
      healing: 0,
      targetDefeated: false
    },
    ...overrides
  };
}

/**
 * Create a mock log entry in backend format (actorId/targetId)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock log entry
 */
function createBackendLogEntry(overrides = {}) {
  return {
    actorId: 1,
    targetId: 2,
    result: {
      damage: 50,
      healing: 0,
      targetDefeated: false
    },
    ...overrides
  };
}

/**
 * Create a mock log entry with flat damage format (no nested result)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock log entry
 */
function createFlatLogEntry(overrides = {}) {
  return {
    actorId: 1,
    targetId: 2,
    damage: 50,
    healing: 0,
    targetDefeated: false,
    ...overrides
  };
}

// ============================================================================
// calculate() Tests
// ============================================================================

describe('BattleStatsAggregator', () => {
  describe('calculate()', () => {
    describe('empty and null handling', () => {
      it('returns empty array for empty units', () => {
        const aggregator = new BattleStatsAggregator([], []);
        const stats = aggregator.calculate();

        assert.ok(Array.isArray(stats));
        assert.strictEqual(stats.length, 0);
      });

      it('returns empty array for null units', () => {
        const aggregator = new BattleStatsAggregator(null, []);
        const stats = aggregator.calculate();

        assert.ok(Array.isArray(stats));
        assert.strictEqual(stats.length, 0);
      });

      it('returns empty array for undefined units', () => {
        const aggregator = new BattleStatsAggregator(undefined, []);
        const stats = aggregator.calculate();

        assert.ok(Array.isArray(stats));
        assert.strictEqual(stats.length, 0);
      });

      it('handles null log entries gracefully', () => {
        const units = [createMockUnit()];
        const aggregator = new BattleStatsAggregator(units, null);
        const stats = aggregator.calculate();

        assert.strictEqual(stats.length, 1);
        assert.strictEqual(stats[0].damageDealt, 0);
      });

      it('handles undefined log entries gracefully', () => {
        const units = [createMockUnit()];
        const aggregator = new BattleStatsAggregator(units, undefined);
        const stats = aggregator.calculate();

        assert.strictEqual(stats.length, 1);
        assert.strictEqual(stats[0].damageDealt, 0);
      });
    });

    describe('stat initialization from unit data', () => {
      it('initializes stats from unit data', () => {
        const unit = createMockUnit({
          id: 42,
          name: 'Hero',
          class: 'mage',
          race: 'elf',
          level: 25,
          teamId: 2,
          ownerId: 500,
          hp: 100
        });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats.length, 1);
        assert.strictEqual(stats[0].id, 42);
        assert.strictEqual(stats[0].name, 'Hero');
        assert.strictEqual(stats[0].class, 'mage');
        assert.strictEqual(stats[0].race, 'elf');
        assert.strictEqual(stats[0].level, 25);
        assert.strictEqual(stats[0].teamId, 2);
        assert.strictEqual(stats[0].ownerId, 500);
      });

      it('defaults name to Unknown when missing', () => {
        const unit = createMockUnit({ name: undefined });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].name, 'Unknown');
      });

      it('defaults name to Unknown when null', () => {
        const unit = createMockUnit({ name: null });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].name, 'Unknown');
      });

      it('defaults class to null when missing', () => {
        const unit = createMockUnit({ class: undefined });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].class, null);
      });

      it('defaults race to null when missing', () => {
        const unit = createMockUnit({ race: undefined });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].race, null);
      });

      it('defaults level to 1 when missing', () => {
        const unit = createMockUnit({ level: undefined });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].level, 1);
      });

      it('defaults teamId to null when missing', () => {
        const unit = createMockUnit({ teamId: undefined });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].teamId, null);
      });

      it('defaults ownerId to null when missing', () => {
        const unit = createMockUnit({ ownerId: undefined });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].ownerId, null);
      });

      it('initializes combat stats to zero', () => {
        const unit = createMockUnit();
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].damageDealt, 0);
        assert.strictEqual(stats[0].damageTaken, 0);
        assert.strictEqual(stats[0].healingDone, 0);
        assert.strictEqual(stats[0].kills, 0);
      });
    });

    describe('death tracking', () => {
      it('counts death when unit HP is 0', () => {
        const unit = createMockUnit({ hp: 0 });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].deaths, 1);
      });

      it('counts death when unit HP is negative', () => {
        const unit = createMockUnit({ hp: -10 });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].deaths, 1);
      });

      it('does not count death when unit HP is positive', () => {
        const unit = createMockUnit({ hp: 100 });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].deaths, 0);
      });

      it('does not count death when unit HP is 1', () => {
        const unit = createMockUnit({ hp: 1 });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].deaths, 0);
      });

      it('counts death when HP is null (defaults to 0)', () => {
        const unit = createMockUnit({ hp: null });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].deaths, 1);
      });

      it('counts death when HP is undefined (defaults to 0)', () => {
        const unit = createMockUnit({ hp: undefined });
        const aggregator = new BattleStatsAggregator([unit], []);
        const stats = aggregator.calculate();

        assert.strictEqual(stats[0].deaths, 1);
      });
    });

    describe('damage dealt aggregation', () => {
      it('aggregates damage dealt from log entries', () => {
        const units = [
          createMockUnit({ id: 1 }),
          createMockUnit({ id: 2 })
        ];
        const logs = [
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 2 }, result: { damage: 50 } }),
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 2 }, result: { damage: 30 } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.damageDealt, 80);
      });

      it('does not count zero damage', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 2 }, result: { damage: 0 } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.damageDealt, 0);
      });

      it('does not count negative damage', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 2 }, result: { damage: -10 } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.damageDealt, 0);
      });
    });

    describe('damage taken aggregation', () => {
      it('aggregates damage taken by target', () => {
        const units = [
          createMockUnit({ id: 1 }),
          createMockUnit({ id: 2 })
        ];
        const logs = [
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 2 }, result: { damage: 50 } }),
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 2 }, result: { damage: 25 } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit2Stats = stats.find(s => s.id === 2);
        assert.strictEqual(unit2Stats.damageTaken, 75);
      });

      it('tracks damage taken from multiple attackers', () => {
        const units = [
          createMockUnit({ id: 1 }),
          createMockUnit({ id: 2 }),
          createMockUnit({ id: 3 })
        ];
        const logs = [
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 3 }, result: { damage: 40 } }),
          createFrontendLogEntry({ actor: { id: 2 }, target: { id: 3 }, result: { damage: 60 } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit3Stats = stats.find(s => s.id === 3);
        assert.strictEqual(unit3Stats.damageTaken, 100);
      });
    });

    describe('nested result.damage format', () => {
      it('handles nested result.damage format', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          {
            actor: { id: 1 },
            target: { id: 2 },
            result: { damage: 75, healing: 0, targetDefeated: false }
          }
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.damageDealt, 75);
      });

      it('handles nested result with missing damage', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          {
            actor: { id: 1 },
            target: { id: 2 },
            result: { healing: 0, targetDefeated: false }
          }
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.damageDealt, 0);
      });
    });

    describe('frontend log format with actor.id/target.id', () => {
      it('handles frontend log format with actor.id', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          createFrontendLogEntry({
            actor: { id: 1, name: 'Attacker' },
            target: { id: 2, name: 'Defender' },
            result: { damage: 100 }
          })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        const unit2Stats = stats.find(s => s.id === 2);
        assert.strictEqual(unit1Stats.damageDealt, 100);
        assert.strictEqual(unit2Stats.damageTaken, 100);
      });

      it('handles frontend log format with target.id', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          {
            actor: { id: 1 },
            target: { id: 2 },
            result: { damage: 50, targetDefeated: true }
          }
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.kills, 1);
      });
    });

    describe('backend log format with actorId/targetId', () => {
      it('handles backend log format with actorId', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          createBackendLogEntry({
            actorId: 1,
            targetId: 2,
            result: { damage: 80 }
          })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.damageDealt, 80);
      });

      it('handles backend log format with targetId', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          createBackendLogEntry({
            actorId: 1,
            targetId: 2,
            result: { damage: 60 }
          })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit2Stats = stats.find(s => s.id === 2);
        assert.strictEqual(unit2Stats.damageTaken, 60);
      });

      it('handles result.targetId for target identification', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          {
            actorId: 1,
            result: { damage: 45, targetId: 2 }
          }
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit2Stats = stats.find(s => s.id === 2);
        assert.strictEqual(unit2Stats.damageTaken, 45);
      });
    });

    describe('flat log format (no nested result)', () => {
      it('handles flat damage format', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          createFlatLogEntry({ actorId: 1, targetId: 2, damage: 55 })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.damageDealt, 55);
      });

      it('handles flat healing format', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          createFlatLogEntry({ actorId: 1, targetId: 2, damage: 0, healing: 30 })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.healingDone, 30);
      });

      it('handles flat targetDefeated format', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          createFlatLogEntry({ actorId: 1, targetId: 2, damage: 100, targetDefeated: true })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.kills, 1);
      });
    });

    describe('kill tracking', () => {
      it('counts kills from targetDefeated', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          createFrontendLogEntry({
            actor: { id: 1 },
            target: { id: 2 },
            result: { damage: 100, targetDefeated: true }
          })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.kills, 1);
      });

      it('counts multiple kills', () => {
        const units = [
          createMockUnit({ id: 1 }),
          createMockUnit({ id: 2 }),
          createMockUnit({ id: 3 })
        ];
        const logs = [
          createFrontendLogEntry({
            actor: { id: 1 },
            target: { id: 2 },
            result: { damage: 100, targetDefeated: true }
          }),
          createFrontendLogEntry({
            actor: { id: 1 },
            target: { id: 3 },
            result: { damage: 100, targetDefeated: true }
          })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.kills, 2);
      });

      it('does not count kills when targetDefeated is false', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          createFrontendLogEntry({
            actor: { id: 1 },
            target: { id: 2 },
            result: { damage: 50, targetDefeated: false }
          })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.kills, 0);
      });
    });

    describe('healing tracking', () => {
      it('aggregates healing done by actor', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          createFrontendLogEntry({
            actor: { id: 1 },
            target: { id: 2 },
            result: { damage: 0, healing: 50 }
          })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.healingDone, 50);
      });

      it('aggregates multiple healing actions', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          createFrontendLogEntry({
            actor: { id: 1 },
            target: { id: 2 },
            result: { healing: 30 }
          }),
          createFrontendLogEntry({
            actor: { id: 1 },
            target: { id: 2 },
            result: { healing: 20 }
          })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.healingDone, 50);
      });

      it('does not count zero healing', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          createFrontendLogEntry({
            actor: { id: 1 },
            target: { id: 2 },
            result: { healing: 0 }
          })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.healingDone, 0);
      });
    });

    describe('null/undefined entry handling', () => {
      it('handles null entries in log array', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          null,
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 2 }, result: { damage: 50 } }),
          null
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.damageDealt, 50);
      });

      it('handles undefined entries in log array', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          undefined,
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 2 }, result: { damage: 30 } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.damageDealt, 30);
      });

      it('handles entries with missing actor', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          { target: { id: 2 }, result: { damage: 50 } }
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        // Should not crash, damage dealt stays 0
        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.damageDealt, 0);
      });

      it('handles entries with missing target', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          { actor: { id: 1 }, result: { damage: 50 } }
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        // Damage dealt should be tracked for actor
        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.damageDealt, 50);

        // But no target takes damage
        const unit2Stats = stats.find(s => s.id === 2);
        assert.strictEqual(unit2Stats.damageTaken, 0);
      });

      it('handles entries with null result', () => {
        const units = [createMockUnit({ id: 1 }), createMockUnit({ id: 2 })];
        const logs = [
          { actor: { id: 1 }, target: { id: 2 }, result: null }
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        // Should not crash
        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.damageDealt, 0);
      });

      it('ignores log entries for unknown unit IDs', () => {
        const units = [createMockUnit({ id: 1 })];
        const logs = [
          createFrontendLogEntry({
            actor: { id: 999 },
            target: { id: 1 },
            result: { damage: 100 }
          })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        // Unit 1 should have damage taken, but no unit 999 in stats
        const unit1Stats = stats.find(s => s.id === 1);
        assert.strictEqual(unit1Stats.damageTaken, 100);
        assert.strictEqual(stats.length, 1);
      });
    });

    describe('multiple units and complex scenarios', () => {
      it('tracks stats for multiple units correctly', () => {
        const units = [
          createMockUnit({ id: 1, teamId: 1 }),
          createMockUnit({ id: 2, teamId: 1 }),
          createMockUnit({ id: 3, teamId: 2 }),
          createMockUnit({ id: 4, teamId: 2, hp: 0 })
        ];
        const logs = [
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 3 }, result: { damage: 50 } }),
          createFrontendLogEntry({ actor: { id: 2 }, target: { id: 3 }, result: { damage: 30 } }),
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 4 }, result: { damage: 100, targetDefeated: true } }),
          createFrontendLogEntry({ actor: { id: 2 }, target: { id: 1 }, result: { healing: 40 } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const stats = aggregator.calculate();

        const unit1Stats = stats.find(s => s.id === 1);
        const unit2Stats = stats.find(s => s.id === 2);
        const unit3Stats = stats.find(s => s.id === 3);
        const unit4Stats = stats.find(s => s.id === 4);

        assert.strictEqual(unit1Stats.damageDealt, 150);
        assert.strictEqual(unit1Stats.kills, 1);
        assert.strictEqual(unit2Stats.damageDealt, 30);
        assert.strictEqual(unit2Stats.healingDone, 40);
        assert.strictEqual(unit3Stats.damageTaken, 80);
        assert.strictEqual(unit4Stats.damageTaken, 100);
        assert.strictEqual(unit4Stats.deaths, 1);
      });
    });
  });

  // ============================================================================
  // getMVP() Tests
  // ============================================================================

  describe('getMVP()', () => {
    describe('empty team handling', () => {
      it('returns null for team with no units', () => {
        const units = [
          createMockUnit({ id: 1, teamId: 1 }),
          createMockUnit({ id: 2, teamId: 1 })
        ];
        const aggregator = new BattleStatsAggregator(units, []);
        const mvp = aggregator.getMVP(2); // Team 2 doesn't exist

        assert.strictEqual(mvp, null);
      });

      it('returns null for empty units array', () => {
        const aggregator = new BattleStatsAggregator([], []);
        const mvp = aggregator.getMVP(1);

        assert.strictEqual(mvp, null);
      });
    });

    describe('damage-based MVP selection', () => {
      it('returns unit with highest damage dealt', () => {
        const units = [
          createMockUnit({ id: 1, teamId: 1 }),
          createMockUnit({ id: 2, teamId: 1 }),
          createMockUnit({ id: 3, teamId: 1 })
        ];
        const logs = [
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 'enemy' }, result: { damage: 100 } }),
          createFrontendLogEntry({ actor: { id: 2 }, target: { id: 'enemy' }, result: { damage: 200 } }),
          createFrontendLogEntry({ actor: { id: 3 }, target: { id: 'enemy' }, result: { damage: 50 } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const mvp = aggregator.getMVP(1);

        assert.strictEqual(mvp.id, 2);
        assert.strictEqual(mvp.damageDealt, 200);
      });

      it('selects MVP from correct team only', () => {
        const units = [
          createMockUnit({ id: 1, teamId: 1 }),
          createMockUnit({ id: 2, teamId: 2 })
        ];
        const logs = [
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 'enemy' }, result: { damage: 50 } }),
          createFrontendLogEntry({ actor: { id: 2 }, target: { id: 'enemy' }, result: { damage: 200 } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const mvpTeam1 = aggregator.getMVP(1);
        const mvpTeam2 = aggregator.getMVP(2);

        assert.strictEqual(mvpTeam1.id, 1);
        assert.strictEqual(mvpTeam2.id, 2);
      });
    });

    describe('kills as tiebreaker', () => {
      it('uses kills as tiebreaker when damage is equal', () => {
        const units = [
          createMockUnit({ id: 1, teamId: 1 }),
          createMockUnit({ id: 2, teamId: 1 })
        ];
        const logs = [
          // Both deal 100 damage total
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 'e1' }, result: { damage: 100, targetDefeated: false } }),
          createFrontendLogEntry({ actor: { id: 2 }, target: { id: 'e1' }, result: { damage: 50, targetDefeated: true } }),
          createFrontendLogEntry({ actor: { id: 2 }, target: { id: 'e2' }, result: { damage: 50, targetDefeated: true } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const mvp = aggregator.getMVP(1);

        // Unit 2 has more kills (2 vs 0), so should be MVP
        assert.strictEqual(mvp.id, 2);
        assert.strictEqual(mvp.kills, 2);
      });

      it('prefers more kills with same damage', () => {
        const units = [
          createMockUnit({ id: 1, teamId: 1 }),
          createMockUnit({ id: 2, teamId: 1 }),
          createMockUnit({ id: 3, teamId: 1 })
        ];
        const logs = [
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 'e1' }, result: { damage: 50, targetDefeated: true } }),
          createFrontendLogEntry({ actor: { id: 2 }, target: { id: 'e2' }, result: { damage: 50, targetDefeated: true } }),
          createFrontendLogEntry({ actor: { id: 2 }, target: { id: 'e3' }, result: { damage: 0, targetDefeated: true } }),
          createFrontendLogEntry({ actor: { id: 3 }, target: { id: 'e4' }, result: { damage: 50, targetDefeated: false } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const mvp = aggregator.getMVP(1);

        // All have 50 damage, but unit 2 has 2 kills
        assert.strictEqual(mvp.id, 2);
      });
    });

    describe('deaths as secondary tiebreaker', () => {
      it('uses deaths as secondary tiebreaker (fewer deaths wins)', () => {
        const units = [
          createMockUnit({ id: 1, teamId: 1, hp: 0 }),   // Dead
          createMockUnit({ id: 2, teamId: 1, hp: 100 }) // Alive
        ];
        const logs = [
          // Both deal same damage and have same kills
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 'e1' }, result: { damage: 100, targetDefeated: true } }),
          createFrontendLogEntry({ actor: { id: 2 }, target: { id: 'e2' }, result: { damage: 100, targetDefeated: true } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const mvp = aggregator.getMVP(1);

        // Unit 2 has fewer deaths (0 vs 1)
        assert.strictEqual(mvp.id, 2);
        assert.strictEqual(mvp.deaths, 0);
      });

      it('prefers alive unit when damage and kills are equal', () => {
        const units = [
          createMockUnit({ id: 1, teamId: 1, hp: 50 }),
          createMockUnit({ id: 2, teamId: 1, hp: 0 }),
          createMockUnit({ id: 3, teamId: 1, hp: 0 })
        ];
        const logs = [
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 'e1' }, result: { damage: 100 } }),
          createFrontendLogEntry({ actor: { id: 2 }, target: { id: 'e2' }, result: { damage: 100 } }),
          createFrontendLogEntry({ actor: { id: 3 }, target: { id: 'e3' }, result: { damage: 100 } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const mvp = aggregator.getMVP(1);

        // Unit 1 is the only alive unit
        assert.strictEqual(mvp.id, 1);
      });
    });

    describe('edge cases', () => {
      it('returns single unit as MVP when only one on team', () => {
        const units = [
          createMockUnit({ id: 1, teamId: 1 }),
          createMockUnit({ id: 2, teamId: 2 })
        ];
        const aggregator = new BattleStatsAggregator(units, []);
        const mvp = aggregator.getMVP(1);

        assert.strictEqual(mvp.id, 1);
      });

      it('handles string teamId', () => {
        const units = [
          createMockUnit({ id: 1, teamId: 'team_a' }),
          createMockUnit({ id: 2, teamId: 'team_a' })
        ];
        const logs = [
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 'e1' }, result: { damage: 150 } }),
          createFrontendLogEntry({ actor: { id: 2 }, target: { id: 'e2' }, result: { damage: 50 } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const mvp = aggregator.getMVP('team_a');

        assert.strictEqual(mvp.id, 1);
      });

      it('handles numeric teamId 0', () => {
        const units = [
          createMockUnit({ id: 1, teamId: 0 }),
          createMockUnit({ id: 2, teamId: 0 })
        ];
        const logs = [
          createFrontendLogEntry({ actor: { id: 2 }, target: { id: 'e1' }, result: { damage: 200 } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const mvp = aggregator.getMVP(0);

        assert.strictEqual(mvp.id, 2);
      });

      it('returns correct MVP stats object', () => {
        const units = [
          createMockUnit({ id: 1, name: 'Hero', class: 'warrior', race: 'human', level: 20, teamId: 1, ownerId: 100, hp: 80 })
        ];
        const logs = [
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 'e1' }, result: { damage: 100, targetDefeated: true } }),
          createFrontendLogEntry({ actor: { id: 1 }, target: { id: 'ally' }, result: { healing: 50 } })
        ];
        const aggregator = new BattleStatsAggregator(units, logs);
        const mvp = aggregator.getMVP(1);

        assert.strictEqual(mvp.id, 1);
        assert.strictEqual(mvp.name, 'Hero');
        assert.strictEqual(mvp.class, 'warrior');
        assert.strictEqual(mvp.race, 'human');
        assert.strictEqual(mvp.level, 20);
        assert.strictEqual(mvp.teamId, 1);
        assert.strictEqual(mvp.ownerId, 100);
        assert.strictEqual(mvp.damageDealt, 100);
        assert.strictEqual(mvp.damageTaken, 0);
        assert.strictEqual(mvp.healingDone, 50);
        assert.strictEqual(mvp.kills, 1);
        assert.strictEqual(mvp.deaths, 0);
      });
    });
  });
});
