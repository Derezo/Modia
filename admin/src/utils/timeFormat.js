/**
 * Time Formatting Utilities
 * Shared utilities for formatting time durations
 *
 * @module timeFormat
 */

/**
 * Format seconds as MM:SS or HH:MM:SS
 * @param {number} seconds - Total seconds
 * @param {object} options - Formatting options
 * @param {string} [options.placeholder='--:--'] - Value to return for invalid input
 * @param {boolean} [options.showHours=false] - Always show hours even if < 1 hour
 * @returns {string} Formatted time string
 */
export function formatDuration(seconds, options = {}) {
  const { placeholder = '--:--', showHours = false } = options;

  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return placeholder;
  }

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0 || showHours) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Alias for formatDuration with '0:00' placeholder
 * @param {number} seconds - Total seconds
 * @returns {string} Formatted time string
 */
export function formatTime(seconds) {
  return formatDuration(seconds, { placeholder: '0:00' });
}

/**
 * Format milliseconds as human-readable duration
 * @param {number} ms - Milliseconds
 * @returns {string} Human-readable duration (e.g., "2h 15m", "45s")
 */
export function formatDurationHuman(ms) {
  if (!ms || ms < 1000) return 'less than a second';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Format a date as relative time (e.g., "2 hours ago")
 * @param {Date|string|number} date - Date to format
 * @returns {string} Relative time string
 */
export function formatRelativeTime(date) {
  if (!date) return 'Unknown';

  const now = Date.now();
  const then = new Date(date).getTime();

  if (!Number.isFinite(then)) return 'Unknown';

  const diffMs = now - then;

  if (diffMs < 0) return 'in the future';

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'just now';
}
