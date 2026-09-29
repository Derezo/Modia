/**
 * Unit tests for character level service
 *
 * Tests stat gain calculations, especially for fractional growth rates
 * like luck (0.5 for warrior/wizard).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  calculateLevelUpStatGains,
  calculateLevelFromSpentXP,
  getLevelProgress,
  getXPThresholdForLevel
} from '../../services/characterLevelService.js';

describe('calculateLevelUpStatGains', () => {
  describe('luck calculation with fractional growth', () => {
    // Warrior has luck growth of 0.5
    // The bug was: floor(0.5 * 1) = 0 for each level
    // Fixed: cumulative floor difference

    it('should give 0 luck for warrior level 1->2 (correct)', () => {
      // floor(0.5 * 1) - floor(0.5 * 0) = 0 - 0 = 0
      const gains = calculateLevelUpStatGains(1, 2, 'warrior');
      assert.strictEqual(gains.luck, 0);
    });

    it('should give 1 luck for warrior level 2->3', () => {
      // floor(0.5 * 2) - floor(0.5 * 1) = 1 - 0 = 1
      const gains = calculateLevelUpStatGains(2, 3, 'warrior');
      assert.strictEqual(gains.luck, 1);
    });

    it('should give 0 luck for warrior level 3->4', () => {
      // floor(0.5 * 3) - floor(0.5 * 2) = 1 - 1 = 0
      const gains = calculateLevelUpStatGains(3, 4, 'warrior');
      assert.strictEqual(gains.luck, 0);
    });

    it('should give 1 luck for warrior level 4->5', () => {
      // floor(0.5 * 4) - floor(0.5 * 3) = 2 - 1 = 1
      const gains = calculateLevelUpStatGains(4, 5, 'warrior');
      assert.strictEqual(gains.luck, 1);
    });

    it('should give same total luck whether leveling 1->20 at once or step by step', () => {
      // Bulk: level 1->20
      const bulkGains = calculateLevelUpStatGains(1, 20, 'warrior');

      // Step by step: 1->2, 2->3, ..., 19->20
      let stepLuck = 0;
      for (let level = 1; level < 20; level++) {
        const stepGains = calculateLevelUpStatGains(level, level + 1, 'warrior');
        stepLuck += stepGains.luck;
      }

      // Both should equal floor(0.5 * 19) - floor(0.5 * 0) = 9 - 0 = 9
      assert.strictEqual(bulkGains.luck, 9);
      assert.strictEqual(stepLuck, 9);
      assert.strictEqual(bulkGains.luck, stepLuck);
    });

    it('should handle wizard luck growth (also 0.5) correctly', () => {
      const bulkGains = calculateLevelUpStatGains(1, 20, 'wizard');
      let stepLuck = 0;
      for (let level = 1; level < 20; level++) {
        stepLuck += calculateLevelUpStatGains(level, level + 1, 'wizard').luck;
      }

      assert.strictEqual(bulkGains.luck, 9);
      assert.strictEqual(stepLuck, 9);
    });

    it('should handle monk luck growth (1.0) correctly', () => {
      // Monk has luck 1.0, so every level gives 1 luck
      const bulkGains = calculateLevelUpStatGains(1, 20, 'monk');
      let stepLuck = 0;
      for (let level = 1; level < 20; level++) {
        stepLuck += calculateLevelUpStatGains(level, level + 1, 'monk').luck;
      }

      // floor(1.0 * 19) = 19
      assert.strictEqual(bulkGains.luck, 19);
      assert.strictEqual(stepLuck, 19);
    });

    it('should handle guardian luck growth (0.3) correctly', () => {
      // Guardian has luck 0.3
      const bulkGains = calculateLevelUpStatGains(1, 20, 'guardian');
      let stepLuck = 0;
      for (let level = 1; level < 20; level++) {
        stepLuck += calculateLevelUpStatGains(level, level + 1, 'guardian').luck;
      }

      // floor(0.3 * 19) = 5
      assert.strictEqual(bulkGains.luck, 5);
      assert.strictEqual(stepLuck, 5);
    });

    it('should handle warlord luck growth (0.8) correctly', () => {
      // Warlord has luck 0.8
      const bulkGains = calculateLevelUpStatGains(1, 20, 'warlord');
      let stepLuck = 0;
      for (let level = 1; level < 20; level++) {
        stepLuck += calculateLevelUpStatGains(level, level + 1, 'warlord').luck;
      }

      // floor(0.8 * 19) = 15
      assert.strictEqual(bulkGains.luck, 15);
      assert.strictEqual(stepLuck, 15);
    });
  });

  describe('other stats', () => {
    it('should calculate HP gains correctly for warrior', () => {
      // Warrior has HP growth of 15
      const gains = calculateLevelUpStatGains(1, 5, 'warrior');
      // floor(15 * 4) - floor(15 * 0) = 60
      assert.strictEqual(gains.hp, 60);
    });

    it('should calculate MP gains correctly for wizard', () => {
      // Wizard has MP growth of 12
      const gains = calculateLevelUpStatGains(1, 5, 'wizard');
      // floor(12 * 4) = 48
      assert.strictEqual(gains.mp, 48);
    });

    it('should calculate strength gains correctly for warrior', () => {
      // Warrior has strength growth of 3
      const gains = calculateLevelUpStatGains(1, 10, 'warrior');
      // floor(3 * 9) = 27
      assert.strictEqual(gains.str, 27);
    });
  });

  describe('edge cases', () => {
    it('should return zeros for same level', () => {
      const gains = calculateLevelUpStatGains(5, 5, 'warrior');
      assert.strictEqual(gains.luck, 0);
      assert.strictEqual(gains.hp, 0);
      assert.strictEqual(gains.str, 0);
    });

    it('should handle single level gain', () => {
      const gains = calculateLevelUpStatGains(1, 2, 'warrior');
      // HP: floor(15 * 1) - floor(15 * 0) = 15
      assert.strictEqual(gains.hp, 15);
    });

    it('should use warrior as default for unknown class', () => {
      const gains = calculateLevelUpStatGains(1, 5, 'unknown_class');
      // Should use warrior growth rates
      assert.strictEqual(gains.hp, 60); // 15 * 4
    });
  });
});

describe('calculateLevelFromSpentXP', () => {
  it('should return level 1 for 0 XP', () => {
    assert.strictEqual(calculateLevelFromSpentXP(0), 1);
  });

  it('should return level 1 for negative XP', () => {
    assert.strictEqual(calculateLevelFromSpentXP(-100), 1);
  });

  it('should return level 2 at threshold', () => {
    const threshold = getXPThresholdForLevel(2);
    assert.strictEqual(calculateLevelFromSpentXP(threshold), 2);
  });

  it('should return level 1 just below level 2 threshold', () => {
    const threshold = getXPThresholdForLevel(2);
    assert.strictEqual(calculateLevelFromSpentXP(threshold - 1), 1);
  });
});

describe('getLevelProgress', () => {
  it('should return correct progress at start of level', () => {
    const threshold2 = getXPThresholdForLevel(2);
    const progress = getLevelProgress(threshold2, 2);

    assert.strictEqual(progress.current, 0);
    assert.ok(progress.needed > 0);
    assert.strictEqual(progress.percent, 0);
  });

  it('should return 50% progress at midpoint', () => {
    const threshold2 = getXPThresholdForLevel(2);
    const threshold3 = getXPThresholdForLevel(3);
    const midpoint = threshold2 + Math.floor((threshold3 - threshold2) / 2);

    const progress = getLevelProgress(midpoint, 2);

    assert.ok(progress.percent >= 0.49 && progress.percent <= 0.51);
  });
});
