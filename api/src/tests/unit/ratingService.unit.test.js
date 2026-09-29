/**
 * Unit tests for ratingService.js
 *
 * Tests ELO rating calculations including:
 * - Equal ratings case (should yield symmetric changes)
 * - Favorite winning (expected outcome, lower reward)
 * - Underdog winning (upset, higher reward)
 * - Forfeit penalty application
 * - Underdog bonus clamping
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  calculateRatingChange,
  calculateExpectedScore,
  calculateUnderdogBonus,
  applyForfeitPenalty,
  K_FACTOR,
  FORFEIT_PENALTY_MULTIPLIER,
  MIN_UNDERDOG_BONUS,
  MAX_UNDERDOG_BONUS
} from '../../services/ratingService.js';

describe('ratingService - ELO Calculations', () => {
  describe('calculateExpectedScore', () => {
    it('should return 0.5 for equal ratings', () => {
      const expected = calculateExpectedScore(1200, 1200);
      assert.strictEqual(expected, 0.5, 'Equal ratings should yield 50% expected score');
    });

    it('should return higher expectation for stronger player', () => {
      const expected = calculateExpectedScore(1400, 1200);
      assert.ok(expected > 0.5, 'Higher rated player should have >50% expectation');
      assert.ok(expected < 1.0, 'Expected score should be less than 1');
    });

    it('should return lower expectation for weaker player', () => {
      const expected = calculateExpectedScore(1200, 1400);
      assert.ok(expected < 0.5, 'Lower rated player should have <50% expectation');
      assert.ok(expected > 0.0, 'Expected score should be greater than 0');
    });

    it('should be symmetric', () => {
      const strongerExpected = calculateExpectedScore(1400, 1200);
      const weakerExpected = calculateExpectedScore(1200, 1400);
      const sum = strongerExpected + weakerExpected;
      assert.ok(
        Math.abs(sum - 1.0) < 0.0001,
        `Expected scores should sum to 1.0, got ${sum}`
      );
    });
  });

  describe('calculateRatingChange', () => {
    it('should yield symmetric 16/16 changes for equal ratings and PPR', () => {
      // Equal ratings (1200 vs 1200), equal power (100 vs 100)
      const result = calculateRatingChange(1200, 1200, 100, 100);

      // With equal ratings, expectedWinner = 0.5
      // winnerGain = K * (1 - 0.5) * 1.0 = 32 * 0.5 = 16
      // loserLoss = K * (1 - 0.5) = 32 * 0.5 = 16
      assert.strictEqual(result.winnerGain, 16, 'Equal ratings should yield 16 point gain');
      assert.strictEqual(result.loserLoss, 16, 'Equal ratings should yield 16 point loss');
    });

    it('should give smaller reward when favorite wins', () => {
      // Higher rated (1400) beats lower rated (1200), equal power
      const result = calculateRatingChange(1400, 1200, 100, 100);

      // Expected outcome for winner is high, so reward is low
      assert.ok(
        result.winnerGain < 16,
        `Favorite winning should get <16 points, got ${result.winnerGain}`
      );
      assert.ok(
        result.loserLoss < 16,
        `Favorite winning means loser loses <16 points, got ${result.loserLoss}`
      );
    });

    it('should give larger reward when underdog wins (rating)', () => {
      // Lower rated (1200) beats higher rated (1400), equal power
      const result = calculateRatingChange(1200, 1400, 100, 100);

      // Unexpected outcome for winner, so reward is high
      assert.ok(
        result.winnerGain > 16,
        `Underdog winning should get >16 points, got ${result.winnerGain}`
      );
      assert.ok(
        result.loserLoss > 16,
        `Upset means loser loses >16 points, got ${result.loserLoss}`
      );
    });

    it('should apply underdog bonus for weaker power winning', () => {
      // Equal ratings, but winner has weaker power (50 vs 100)
      const result = calculateRatingChange(1200, 1200, 50, 100);

      // powerRatio = loserPPR / winnerPPR = 100/50 = 2.0 (max bonus)
      // winnerGain = K * 0.5 * 2.0 = 32
      assert.strictEqual(
        result.winnerGain,
        32,
        `Power underdog winning should get max bonus, got ${result.winnerGain}`
      );
      // loserLoss stays at base rate
      assert.strictEqual(result.loserLoss, 16);
    });

    it('should clamp underdog bonus to max 2.0', () => {
      // Winner has much weaker power (10 vs 100)
      const result = calculateRatingChange(1200, 1200, 10, 100);

      // powerRatio = 100/10 = 10.0, but clamped to 2.0
      // winnerGain = K * 0.5 * 2.0 = 32
      assert.strictEqual(
        result.winnerGain,
        32,
        `Bonus should be clamped to 2.0, got ${result.winnerGain}`
      );
    });

    it('should reduce bonus when stronger power wins', () => {
      // Equal ratings, but winner has stronger power (100 vs 50)
      const result = calculateRatingChange(1200, 1200, 100, 50);

      // powerRatio = loserPPR / winnerPPR = 50/100 = 0.5 (min bonus)
      // winnerGain = K * 0.5 * 0.5 = 8
      assert.strictEqual(
        result.winnerGain,
        8,
        `Power favorite winning should get reduced bonus, got ${result.winnerGain}`
      );
    });

    it('should enforce minimum 1 point gain/loss', () => {
      // Massive rating difference where expected outcome is ~100%
      const result = calculateRatingChange(2400, 800, 100, 100);

      assert.ok(
        result.winnerGain >= 1,
        `Minimum gain should be 1, got ${result.winnerGain}`
      );
      assert.ok(
        result.loserLoss >= 1,
        `Minimum loss should be 1, got ${result.loserLoss}`
      );
    });
  });

  describe('calculateUnderdogBonus', () => {
    it('should return 1.0 for equal power', () => {
      const bonus = calculateUnderdogBonus(100, 100);
      assert.strictEqual(bonus, 1.0);
    });

    it('should return > 1.0 when winner has lower power', () => {
      const bonus = calculateUnderdogBonus(50, 100);
      assert.strictEqual(bonus, 2.0, 'Power ratio 100/50 = 2.0');
    });

    it('should return < 1.0 when winner has higher power', () => {
      const bonus = calculateUnderdogBonus(100, 50);
      assert.strictEqual(bonus, 0.5, 'Power ratio 50/100 = 0.5');
    });

    it('should clamp to MIN_UNDERDOG_BONUS', () => {
      const bonus = calculateUnderdogBonus(1000, 10);
      assert.strictEqual(bonus, MIN_UNDERDOG_BONUS);
    });

    it('should clamp to MAX_UNDERDOG_BONUS', () => {
      const bonus = calculateUnderdogBonus(10, 1000);
      assert.strictEqual(bonus, MAX_UNDERDOG_BONUS);
    });

    it('should return 1.0 for zero or negative PPR', () => {
      assert.strictEqual(calculateUnderdogBonus(0, 100), 1.0);
      assert.strictEqual(calculateUnderdogBonus(100, 0), 1.0);
      assert.strictEqual(calculateUnderdogBonus(-1, 100), 1.0);
    });
  });

  describe('applyForfeitPenalty', () => {
    it('should apply 25% penalty', () => {
      const baseLoss = 16;
      const penalized = applyForfeitPenalty(baseLoss);
      assert.strictEqual(
        penalized,
        Math.round(baseLoss * FORFEIT_PENALTY_MULTIPLIER),
        `Expected ${baseLoss} * ${FORFEIT_PENALTY_MULTIPLIER} = ${penalized}`
      );
    });

    it('should round the result', () => {
      const baseLoss = 13;
      const penalized = applyForfeitPenalty(baseLoss);
      // 13 * 1.25 = 16.25 -> 16
      assert.strictEqual(penalized, 16);
    });
  });

  describe('Constants', () => {
    it('should have correct K_FACTOR', () => {
      assert.strictEqual(K_FACTOR, 32);
    });

    it('should have correct FORFEIT_PENALTY_MULTIPLIER', () => {
      assert.strictEqual(FORFEIT_PENALTY_MULTIPLIER, 1.25);
    });

    it('should have correct MIN_UNDERDOG_BONUS', () => {
      assert.strictEqual(MIN_UNDERDOG_BONUS, 0.5);
    });

    it('should have correct MAX_UNDERDOG_BONUS', () => {
      assert.strictEqual(MAX_UNDERDOG_BONUS, 2.0);
    });
  });
});
