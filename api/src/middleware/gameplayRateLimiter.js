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
