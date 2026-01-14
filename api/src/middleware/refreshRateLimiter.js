import { createLimiter } from './rateLimiterFactory.js';

/**
 * Rate limiter for auth token refresh endpoint
 *
 * Uses IP-based limiting (not user-based) because:
 * - No auth context available yet when refreshing
 * - Token rotation means user ID changes between refreshes
 *
 * Limits are generous to allow:
 * - Multiple tabs/windows refreshing
 * - Auto-refresh happening every ~59 minutes
 * - Some buffer for network retries
 */
export const refreshLimiter = createLimiter({
  name: 'auth:refresh',
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 20,           // Base: 20, Prod: 40, Dev: 100
  message: 'Too many token refresh attempts. Please log in again.',
  useUserKey: false          // IP-based (no auth context during refresh)
});
