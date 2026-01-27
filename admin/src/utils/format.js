/**
 * Formatting Utilities
 * Shared formatting functions for the admin dashboard.
 */

/**
 * Format file size to human readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size like "1.5 MB"
 */
export function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Format timestamp to readable date
 * Handles YYYY-MM-DD_HH-MM-SS format from backup filenames
 * @param {string} timestamp - Timestamp string
 * @returns {string} Formatted date string
 */
export function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown';

  // Handle YYYY-MM-DD_HH-MM-SS format (backup filenames)
  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    const date = new Date(year, month - 1, day, hour, minute, second);
    return date.toLocaleString();
  }

  // Try to parse as ISO date
  try {
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) {
      return date.toLocaleString();
    }
  } catch {
    // Fall through to return raw timestamp
  }

  return timestamp;
}

/**
 * Format duration in milliseconds to human readable
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration like "1h 30m"
 */
export function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

export default {
  formatSize,
  formatTimestamp,
  formatDuration
};
