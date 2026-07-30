/**
 * Stamina Service Unit Tests
 * Tests for stamina calculation logic
 *
 * Only testing the pure function calculateCurrentStamina.
 * Database-dependent functions are tested via integration tests.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import {
  calculateCurrentStamina,
  calculateStaminaState,
  getStaminaInfo,
  mergeStaminaRegenWindows,
  REGEN_INTERVAL_MS,
  DEFAULT_MAX_STAMINA
} from '../../services/staminaService.js';

describe('calculateCurrentStamina', () => {
  describe('edge cases', () => {
    it('should use DEFAULT_MAX_STAMINA when stamina is undefined', () => {
      const character = {
        stamina: undefined,
        max_stamina: DEFAULT_MAX_STAMINA,
        stamina_updated_at: new Date().toISOString()
      };

      const result = calculateCurrentStamina(character);

      assert.strictEqual(result, DEFAULT_MAX_STAMINA);
    });

    it('should use DEFAULT_MAX_STAMINA when max_stamina is undefined', () => {
      const character = {
        stamina: 5,
        max_stamina: undefined,
        stamina_updated_at: new Date().toISOString()
      };

      const result = calculateCurrentStamina(character);

      // Should cap at default max
      assert.ok(result <= DEFAULT_MAX_STAMINA);
    });

    it('should clamp negative stamina to 0', () => {
      const character = {
        stamina: -5,
        max_stamina: 8,
        stamina_updated_at: new Date().toISOString()
      };

      const result = calculateCurrentStamina(character);

      // Should start from 0, not negative
      assert.ok(result >= 0);
    });
  });

  describe('at max stamina', () => {
    it('should return max when stamina equals max', () => {
      const character = {
        stamina: 8,
        max_stamina: 8,
        stamina_updated_at: new Date().toISOString()
      };

      const result = calculateCurrentStamina(character);

      assert.strictEqual(result, 8);
    });

    it('should cap at max even if stored stamina exceeds max', () => {
      const character = {
        stamina: 10,
        max_stamina: 8,
        stamina_updated_at: new Date().toISOString()
      };

      const result = calculateCurrentStamina(character);

      assert.strictEqual(result, 8);
    });
  });

  describe('regeneration', () => {
    it('should not regenerate when at max stamina', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const character = {
        stamina: 8,
        max_stamina: 8,
        stamina_updated_at: oneHourAgo.toISOString()
      };

      const result = calculateCurrentStamina(character);

      assert.strictEqual(result, 8);
    });

    it('should regenerate stamina based on elapsed time', () => {
      // Set updated_at to 3 intervals ago
      const threeIntervalsAgo = new Date(Date.now() - (3 * REGEN_INTERVAL_MS));
      const character = {
        stamina: 3,
        max_stamina: 8,
        stamina_updated_at: threeIntervalsAgo.toISOString()
      };

      const result = calculateCurrentStamina(character);

      // Should have regenerated 3 points: 3 + 3 = 6
      assert.strictEqual(result, 6);
    });

    it('should cap regeneration at max stamina', () => {
      // Set updated_at to 10 intervals ago (more than needed to reach max)
      const tenIntervalsAgo = new Date(Date.now() - (10 * REGEN_INTERVAL_MS));
      const character = {
        stamina: 3,
        max_stamina: 8,
        stamina_updated_at: tenIntervalsAgo.toISOString()
      };

      const result = calculateCurrentStamina(character);

      // Should be capped at 8, not 3 + 10 = 13
      assert.strictEqual(result, 8);
    });

    it('should not regenerate if less than one interval has passed', () => {
      // Set updated_at to half an interval ago
      const halfIntervalAgo = new Date(Date.now() - (REGEN_INTERVAL_MS / 2));
      const character = {
        stamina: 5,
        max_stamina: 8,
        stamina_updated_at: halfIntervalAgo.toISOString()
      };

      const result = calculateCurrentStamina(character);

      // No regen points yet
      assert.strictEqual(result, 5);
    });

    it('should floor partial intervals (no fractional regen)', () => {
      // Set updated_at to 2.9 intervals ago
      const almostThreeIntervals = new Date(Date.now() - (2.9 * REGEN_INTERVAL_MS));
      const character = {
        stamina: 3,
        max_stamina: 8,
        stamina_updated_at: almostThreeIntervals.toISOString()
      };

      const result = calculateCurrentStamina(character);

      // Should only regenerate 2 points (floored): 3 + 2 = 5
      assert.strictEqual(result, 5);
    });

    it('should handle zero stamina correctly', () => {
      // Set updated_at to 4 intervals ago
      const fourIntervalsAgo = new Date(Date.now() - (4 * REGEN_INTERVAL_MS));
      const character = {
        stamina: 0,
        max_stamina: 8,
        stamina_updated_at: fourIntervalsAgo.toISOString()
      };

      const result = calculateCurrentStamina(character);

      // Should have regenerated 4 points: 0 + 4 = 4
      assert.strictEqual(result, 4);
    });
  });

  describe('clock skew handling', () => {
    it('should handle future timestamps gracefully (no negative regen)', () => {
      // Simulate clock skew: updated_at is in the future
      const futureTime = new Date(Date.now() + (5 * REGEN_INTERVAL_MS));
      const character = {
        stamina: 5,
        max_stamina: 8,
        stamina_updated_at: futureTime.toISOString()
      };

      const result = calculateCurrentStamina(character);

      // Should not subtract stamina - just return current
      assert.strictEqual(result, 5);
    });

    it('should handle null stamina_updated_at', () => {
      const character = {
        stamina: 5,
        max_stamina: 8,
        stamina_updated_at: null
      };

      const result = calculateCurrentStamina(character);

      // Should use Date.now() as fallback, meaning no regen
      assert.strictEqual(result, 5);
    });
  });

  describe('custom max stamina', () => {
    it('should respect custom max_stamina higher than default', () => {
      const character = {
        stamina: 10,
        max_stamina: 12,
        stamina_updated_at: new Date().toISOString()
      };

      const result = calculateCurrentStamina(character);

      assert.strictEqual(result, 10);
    });

    it('should respect custom max_stamina lower than default', () => {
      const character = {
        stamina: 5,
        max_stamina: 4,
        stamina_updated_at: new Date().toISOString()
      };

      const result = calculateCurrentStamina(character);

      // Current exceeds max, should be capped
      assert.strictEqual(result, 4);
    });

    it('should regenerate up to custom max', () => {
      const manyIntervalsAgo = new Date(Date.now() - (20 * REGEN_INTERVAL_MS));
      const character = {
        stamina: 0,
        max_stamina: 12,
        stamina_updated_at: manyIntervalsAgo.toISOString()
      };

      const result = calculateCurrentStamina(character);

      // Should cap at custom max of 12
      assert.strictEqual(result, 12);
    });
  });
});

describe('Constants', () => {
  it('should have sensible REGEN_INTERVAL_MS', () => {
    // Should be between 1 second and 10 minutes
    assert.ok(REGEN_INTERVAL_MS >= 1000, 'Interval should be at least 1 second');
    assert.ok(REGEN_INTERVAL_MS <= 600000, 'Interval should be at most 10 minutes');
  });

  it('should have sensible DEFAULT_MAX_STAMINA', () => {
    assert.ok(DEFAULT_MAX_STAMINA > 0, 'Default max should be positive');
    assert.ok(DEFAULT_MAX_STAMINA <= 100, 'Default max should be reasonable');
  });
});

describe('stamina shrine regeneration', () => {
  const nowMs = Date.parse('2026-07-29T12:00:00.000Z');

  function makeCharacter(elapsedIntervals, stamina = 0) {
    return {
      stamina,
      max_stamina: 20,
      stamina_updated_at: new Date(
        nowMs - (elapsedIntervals * REGEN_INTERVAL_MS)
      ).toISOString()
    };
  }

  it('regenerates 50% faster only while the blessing is active', () => {
    const character = makeCharacter(2);
    const state = calculateStaminaState(character, {
      now: nowMs,
      regenWindows: [{
        startsAt: character.stamina_updated_at,
        expiresAt: new Date(nowMs + REGEN_INTERVAL_MS)
      }]
    });

    assert.equal(state.current, 3);
    assert.equal(state.staminaRegenBonusActive, true);
    assert.equal(
      state.regenIntervalSeconds,
      REGEN_INTERVAL_MS / 1.5 / 1000
    );
  });

  it('does not retroactively accelerate time before shrine activation', () => {
    const character = makeCharacter(2);
    const state = calculateStaminaState(character, {
      now: nowMs,
      regenWindows: [{
        startsAt: new Date(nowMs - REGEN_INTERVAL_MS),
        expiresAt: new Date(nowMs + REGEN_INTERVAL_MS)
      }]
    });

    assert.equal(state.current, 2);
  });

  it('does not stack overlapping same-type blessings', () => {
    const character = makeCharacter(2);
    const sharedStart = new Date(nowMs - (2 * REGEN_INTERVAL_MS));
    const sharedEnd = new Date(nowMs + REGEN_INTERVAL_MS);
    const state = calculateStaminaState(character, {
      now: nowMs,
      regenWindows: [
        { startsAt: sharedStart, expiresAt: sharedEnd },
        { startsAt: sharedStart, expiresAt: sharedEnd }
      ]
    });

    assert.equal(state.current, 3);
    assert.deepEqual(
      mergeStaminaRegenWindows([
        { startsAt: sharedStart, expiresAt: sharedEnd },
        { startsAt: sharedStart, expiresAt: sharedEnd }
      ]),
      [{ startsAt: sharedStart.getTime(), expiresAt: sharedEnd.getTime() }]
    );
  });

  it('preserves stamina earned before expiry without continuing the bonus', () => {
    const character = makeCharacter(4);
    const state = calculateStaminaState(character, {
      now: nowMs,
      regenWindows: [{
        startsAt: new Date(nowMs - (4 * REGEN_INTERVAL_MS)),
        expiresAt: new Date(nowMs - (2 * REGEN_INTERVAL_MS))
      }]
    });

    assert.equal(state.current, 5);
    assert.equal(state.staminaRegenBonusActive, false);
    assert.equal(state.regenIntervalSeconds, REGEN_INTERVAL_MS / 1000);
    assert.equal(
      Date.parse(state.nextRegenAt) - nowMs,
      REGEN_INTERVAL_MS
    );
  });

  it('uses the boosted rate for the next-regeneration countdown', () => {
    const character = makeCharacter(0, 3);
    const state = calculateStaminaState(character, {
      now: nowMs,
      regenWindows: [{
        startsAt: new Date(nowMs),
        expiresAt: new Date(nowMs + REGEN_INTERVAL_MS)
      }]
    });

    assert.ok(
      Math.abs(
        (Date.parse(state.nextRegenAt) - nowMs) -
        (REGEN_INTERVAL_MS / 1.5)
      ) < 1
    );
  });

  it('resolves the character owner before loading their blessing windows', async () => {
    const character = makeCharacter(2);
    const calls = [];
    const state = await getStaminaInfo(99, {
      now: new Date(nowMs),
      queryFn: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.includes('FROM characters')) {
          return { rows: [{ ...character, user_id: 17 }] };
        }
        return {
          rows: [{
            last_visited_at: character.stamina_updated_at,
            expires_at: new Date(nowMs + REGEN_INTERVAL_MS).toISOString()
          }]
        };
      }
    });

    assert.equal(state.current, 3);
    assert.deepEqual(calls[0].params, [99]);
    assert.equal(calls[1].params[0], 17);
    assert.match(calls[1].sql, /buff_type = 'stamina_regen'/);
  });
});
