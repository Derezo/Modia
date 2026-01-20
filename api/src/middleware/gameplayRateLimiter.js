import { createLimiter } from './rateLimiterFactory.js';

/**
 * Rate limiters for gameplay actions
 *
 * These use per-user limiting (useUserKey: true) which means:
 * - Authenticated requests are keyed by user ID (more lenient per-user)
 * - Unauthenticated requests fall back to IP-based limiting
 *
 * Limits are higher than typical web apps because games have
 * frequent legitimate actions (travel, inventory, skills, etc.)
 */

/**
 * Travel rate limiter
 * Travel happens frequently during exploration
 * Base: 60/min = 1 travel per second average, reasonable for clicking around
 */
export const travelLimiter = createLimiter({
  name: 'gameplay:travel',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 60,           // Base: 60, Prod: 120, Dev: 300
  message: 'Too many travel requests. Please wait a moment.',
  useUserKey: true
});

/**
 * Skill learning rate limiter
 * Bulk skill purchasing happens, but shouldn't be too fast
 */
export const skillLimiter = createLimiter({
  name: 'gameplay:skill',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 30,           // Base: 30, Prod: 60, Dev: 150
  message: 'Too many skill requests. Please wait a moment.',
  useUserKey: true
});

/**
 * Inventory management rate limiter
 * Equip, unequip, use items - frequent during setup
 */
export const inventoryLimiter = createLimiter({
  name: 'gameplay:inventory',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 45,           // Base: 45, Prod: 90, Dev: 225
  message: 'Too many inventory actions. Please wait a moment.',
  useUserKey: true
});

/**
 * General read operations rate limiter
 * For endpoints that fetch data without side effects
 * Higher limit since reads are cheap and UI may poll
 */
export const gameReadLimiter = createLimiter({
  name: 'gameplay:read',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 120,          // Base: 120, Prod: 240, Dev: 600
  message: 'Too many requests. Please wait a moment.',
  useUserKey: true
});

/**
 * Quest read rate limiter
 * For fetching daily/weekly quests and streak info
 */
export const questReadLimiter = createLimiter({
  name: 'gameplay:quest:read',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 60,           // Base: 60, Prod: 120, Dev: 300
  message: 'Too many quest requests. Please wait a moment.',
  useUserKey: true
});

/**
 * Quest claim rate limiter
 * For claiming quest rewards - lower limit to prevent abuse
 */
export const questClaimLimiter = createLimiter({
  name: 'gameplay:quest:claim',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 20,           // Base: 20, Prod: 40, Dev: 100
  message: 'Too many quest claim attempts. Please wait a moment.',
  useUserKey: true
});

/**
 * Quest refresh rate limiter
 * For manual quest refresh - very limited
 */
export const questRefreshLimiter = createLimiter({
  name: 'gameplay:quest:refresh',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 10,           // Base: 10, Prod: 20, Dev: 50
  message: 'Too many quest refresh attempts. Please wait a moment.',
  useUserKey: true
});
