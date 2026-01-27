/**
 * Format Utility Tests
 */

import { describe, it, expect } from 'vitest';
import {
  formatSize,
  formatTimestamp,
  formatDuration,
} from '../../utils/format';

describe('Format Utilities', () => {
  describe('formatSize', () => {
    it('should format bytes', () => {
      expect(formatSize(500)).toBe('500.0 B');
    });

    it('should format kilobytes', () => {
      expect(formatSize(1024)).toBe('1.0 KB');
      expect(formatSize(1536)).toBe('1.5 KB');
    });

    it('should format megabytes', () => {
      expect(formatSize(1048576)).toBe('1.0 MB');
      expect(formatSize(1572864)).toBe('1.5 MB');
    });

    it('should format gigabytes', () => {
      expect(formatSize(1073741824)).toBe('1.0 GB');
    });

    it('should handle null/undefined', () => {
      expect(formatSize(null)).toBe('Unknown');
      expect(formatSize(undefined)).toBe('Unknown');
      expect(formatSize(0)).toBe('Unknown');
    });
  });

  describe('formatTimestamp', () => {
    it('should format YYYY-MM-DD_HH-MM-SS format', () => {
      const result = formatTimestamp('2024-01-15_14-30-45');
      expect(result).toBeDefined();
      expect(result).not.toBe('Unknown');
    });

    it('should handle ISO date strings', () => {
      const result = formatTimestamp('2024-01-15T14:30:45.000Z');
      expect(result).toBeDefined();
      expect(result).not.toBe('Unknown');
    });

    it('should handle null/undefined', () => {
      expect(formatTimestamp(null)).toBe('Unknown');
      expect(formatTimestamp(undefined)).toBe('Unknown');
    });

    it('should return raw timestamp for unrecognized formats', () => {
      expect(formatTimestamp('invalid')).toBe('invalid');
    });
  });

  describe('formatDuration', () => {
    it('should format seconds', () => {
      expect(formatDuration(5000)).toBe('5s');
      expect(formatDuration(30000)).toBe('30s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(65000)).toBe('1m 5s');
      expect(formatDuration(120000)).toBe('2m');
    });

    it('should format hours and minutes', () => {
      expect(formatDuration(3660000)).toBe('1h 1m');
      expect(formatDuration(7200000)).toBe('2h');
    });

    it('should handle edge cases', () => {
      expect(formatDuration(0)).toBe('0s');
      expect(formatDuration(-1000)).toBe('0s');
      expect(formatDuration(null)).toBe('0s');
      expect(formatDuration(undefined)).toBe('0s');
    });
  });
});
