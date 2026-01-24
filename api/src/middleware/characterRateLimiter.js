import { createLimiter } from './rateLimiterFactory.js';

/**
 * Rate limiters for character-related actions
 *
 * These endpoints manage character creation and deletion, which are
 * sensitive operations that need strict limits to prevent spam.
 *
 * All use per-user limiting (useUserKey: true).
 */

/**
 * Character creation rate limiter
 * Stricter limit since character creation is a significant action
 * Base: 3/15min - characters are permanent, creation should be deliberate
 */
export const characterCreateLimiter = createLimiter({
  name: 'character:create',
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 3,            // Base: 3, Prod: 6, Dev: 15
  message: 'Too many character creation attempts. Please wait before creating another character.',
  useUserKey: true
});

/**
 * Character deletion rate limiter
 * Very strict limit since deletion is destructive
 * Base: 2/15min - deletion is rare and should be very deliberate
 */
export const characterDeleteLimiter = createLimiter({
  name: 'character:delete',
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 2,            // Base: 2, Prod: 4, Dev: 10
  message: 'Too many character deletion attempts. Please wait before deleting another character.',
  useUserKey: true
});

/**
 * Character update rate limiter
 * For name changes and other character modifications
 * Base: 10/min - updates are infrequent
 */
export const characterUpdateLimiter = createLimiter({
  name: 'character:update',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 10,           // Base: 10, Prod: 20, Dev: 50
  message: 'Too many character update attempts. Please wait a moment.',
  useUserKey: true
});

/**
 * Party management rate limiter
 * For adding/removing characters from party slots
 * Base: 30/min - party management can involve multiple changes
 */
export const partyManageLimiter = createLimiter({
  name: 'character:party',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 30,           // Base: 30, Prod: 60, Dev: 150
  message: 'Too many party management actions. Please wait a moment.',
  useUserKey: true
});
