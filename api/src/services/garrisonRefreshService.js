/**
 * Garrison Refresh Service
 *
 * Handles periodic refresh of castle garrison recruits.
 * Runs at the start of every hour to refresh unpurchased recruits.
 *
 * Each castle maintains its own pool of regionally-weighted recruits
 * that refresh hourly to encourage exploration and repeat visits.
 *
 * @module garrisonRefreshService
 */

import { refreshAllGarrisons } from './garrisonService.js';

/**
 * How often to check for garrison refresh (in milliseconds)
 * Runs at the top of every hour
 * @type {number}
 */
const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

/** Interval reference for cleanup */
let refreshIntervalId = null;

/** Timeout reference for initial alignment to hour boundary */
let initialTimeoutId = null;

/**
 * Calculate milliseconds until the next hour boundary
 * @returns {number} Milliseconds until next hour (minute 0)
 */
function calculateMsUntilNextHour() {
  const now = new Date();
  const nextHour = new Date(now);
  nextHour.setUTCHours(nextHour.getUTCHours() + 1, 0, 0, 0);
  return nextHour - now;
}

/**
 * Execute the garrison refresh
 * Wraps refreshAllGarrisons with logging and error handling
 */
async function executeRefresh() {
  console.log('[Garrison] Starting hourly refresh...');
  try {
    const result = await refreshAllGarrisons();
    console.log(
      '[Garrison] Hourly refresh complete: ' +
      `${result.deletedCount} old recruits removed, ` +
      `${result.totalGenerated} new recruits generated across ${result.castleCount} castles`
    );
  } catch (error) {
    console.error('[Garrison] Refresh failed:', error);
  }
}

/**
 * Start the garrison refresh scheduler
 * Aligns to hour boundaries so refresh happens at minute 0
 */
export function startGarrisonRefreshScheduler() {
  if (refreshIntervalId || initialTimeoutId) {
    console.warn('[Garrison] Refresh scheduler already running');
    return;
  }

  // Calculate time until next hour boundary
  const msUntilNextHour = calculateMsUntilNextHour();
  const minutesUntil = Math.round(msUntilNextHour / 60000);

  console.log(`[Garrison] Refresh scheduler starting (first refresh in ${minutesUntil} minutes at next hour boundary)`);

  // Set timeout to align with hour boundary, then start interval
  initialTimeoutId = setTimeout(() => {
    // Execute first refresh at hour boundary
    executeRefresh();

    // Then run at regular hourly intervals
    refreshIntervalId = setInterval(() => {
      executeRefresh();
    }, CHECK_INTERVAL);

    initialTimeoutId = null;
  }, msUntilNextHour);
}

/**
 * Stop the garrison refresh scheduler
 * Useful for graceful shutdown or testing
 */
export function stopGarrisonRefreshScheduler() {
  if (initialTimeoutId) {
    clearTimeout(initialTimeoutId);
    initialTimeoutId = null;
  }
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
    console.log('[Garrison] Refresh scheduler stopped');
  }
}

/**
 * Force an immediate garrison refresh (for admin/testing)
 * @returns {Promise<Object>} Refresh result
 */
export async function forceGarrisonRefresh() {
  console.log('[Garrison] Manual refresh triggered');
  return await refreshAllGarrisons();
}

export default {
  startGarrisonRefreshScheduler,
  stopGarrisonRefreshScheduler,
  forceGarrisonRefresh
};
