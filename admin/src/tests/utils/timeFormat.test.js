/**
 * Time Format Utility Tests
 */

import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatTime,
  formatDurationHuman,
  formatRelativeTime,
  calculateETA,
} from '../../utils/timeFormat';

describe('Time Format Utilities', () => {
  describe('formatDuration', () => {
    it('should format seconds as MM:SS', () => {
      expect(formatDuration(65)).toBe('1:05');
      expect(formatDuration(0)).toBe('0:00');
      expect(formatDuration(59)).toBe('0:59');
    });

    it('should format with hours when needed', () => {
      expect(formatDuration(3661)).toBe('1:01:01');
      expect(formatDuration(7200)).toBe('2:00:00');
    });

    it('should use placeholder for invalid input', () => {
      expect(formatDuration(null)).toBe('--:--');
      expect(formatDuration(-5)).toBe('--:--');
      expect(formatDuration(NaN)).toBe('--:--');
    });

    it('should allow custom placeholder', () => {
      expect(formatDuration(null, { placeholder: 'N/A' })).toBe('N/A');
    });

    it('should force show hours', () => {
      expect(formatDuration(65, { showHours: true })).toBe('0:01:05');
    });
  });

  describe('formatTime', () => {
    it('should format seconds with 0:00 placeholder', () => {
      expect(formatTime(65)).toBe('1:05');
      expect(formatTime(null)).toBe('0:00');
    });
  });

  describe('formatDurationHuman', () => {
    it('should format short durations', () => {
      expect(formatDurationHuman(500)).toBe('less than a second');
      expect(formatDurationHuman(5000)).toBe('5s');
    });

    it('should format minutes', () => {
      expect(formatDurationHuman(65000)).toBe('1m 5s');
      expect(formatDurationHuman(120000)).toBe('2m 0s');
    });

    it('should format hours', () => {
      expect(formatDurationHuman(3661000)).toBe('1h 1m');
      expect(formatDurationHuman(7200000)).toBe('2h 0m');
    });
  });

  describe('formatRelativeTime', () => {
    it('should format recent times', () => {
      const now = new Date();
      expect(formatRelativeTime(now)).toBe('just now');
    });

    it('should format minutes ago', () => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      expect(formatRelativeTime(fiveMinutesAgo)).toBe('5 minutes ago');
    });

    it('should format hours ago', () => {
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      expect(formatRelativeTime(twoHoursAgo)).toBe('2 hours ago');
    });

    it('should format days ago', () => {
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      expect(formatRelativeTime(threeDaysAgo)).toBe('3 days ago');
    });

    it('should handle invalid dates', () => {
      expect(formatRelativeTime(null)).toBe('Unknown');
      expect(formatRelativeTime('invalid')).toBe('Unknown');
    });
  });

  describe('calculateETA', () => {
    it('should calculate ETA based on progress', () => {
      const startedAt = new Date(Date.now() - 10000); // 10 seconds ago
      const progress = { current: 5, total: 10 };

      const eta = calculateETA(progress, startedAt);

      expect(eta).toBeDefined();
      expect(eta.ms).toBeGreaterThan(0);
      expect(eta.formatted).toBeDefined();
    });

    it('should return null for no progress', () => {
      expect(calculateETA(null, new Date())).toBeNull();
      expect(calculateETA({ current: 0, total: 10 }, new Date())).toBeNull();
      expect(calculateETA({ current: 5, total: 0 }, new Date())).toBeNull();
    });

    it('should return null without startedAt', () => {
      expect(calculateETA({ current: 5, total: 10 }, null)).toBeNull();
    });
  });
});
