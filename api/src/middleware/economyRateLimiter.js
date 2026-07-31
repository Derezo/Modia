import { createLimiter } from './rateLimiterFactory.js';

/**
 * Rate limiters for economy-related actions
 *
 * These endpoints affect the game economy (gold, items, rewards) and need
 * stricter limits to prevent farming/exploitation.
 *
 * All use per-user limiting (useUserKey: true) to allow legitimate
 * activity while preventing abuse from individual accounts.
 */

/**
 * Chest claim rate limiter
 * Treasure chests are one-time per node, but limit rapid claiming attempts
 * Base: 10/min - allows exploring and claiming chests at reasonable pace
 */
export const chestClaimLimiter = createLimiter({
  name: 'economy:chest_claim',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 10,           // Base: 10, Prod: 20, Dev: 50
  message: 'Too many chest claim attempts. Please wait a moment.',
  useUserKey: true
});

/**
 * Stamina restore rate limiter
 * Gold-to-stamina conversion at towns - limit to prevent economy exploits
 * Base: 5/min - stamina restore is a premium action
 */
export const staminaRestoreLimiter = createLimiter({
  name: 'economy:stamina_restore',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 5,            // Base: 5, Prod: 10, Dev: 25
  message: 'Too many stamina restore requests. Please wait a moment.',
  useUserKey: true
});

/**
 * Shrine visit rate limiter
 * Shrines provide buffs with cooldowns, but limit rapid activation attempts
 * Base: 5/min - shrines have internal cooldowns anyway
 */
export const shrineLimiter = createLimiter({
  name: 'economy:shrine',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 5,            // Base: 5, Prod: 10, Dev: 25
  message: 'Too many shrine visit attempts. Please wait a moment.',
  useUserKey: true
});

/**
 * Relic claim rate limiter
 * Relics are account-wide collectibles - limit to prevent abuse
 * Base: 5/min - claiming relics is infrequent
 */
export const relicClaimLimiter = createLimiter({
  name: 'economy:relic_claim',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 5,            // Base: 5, Prod: 10, Dev: 25
  message: 'Too many relic claim attempts. Please wait a moment.',
  useUserKey: true
});

/**
 * Ruins puzzle solve rate limiter
 * Puzzles award gold - limit rapid solve attempts
 * Base: 10/min - puzzles are one-time per node but limit spam
 */
export const ruinsSolveLimiter = createLimiter({
  name: 'economy:ruins_solve',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 10,           // Base: 10, Prod: 20, Dev: 50
  message: 'Too many puzzle solve attempts. Please wait a moment.',
  useUserKey: true
});

/**
 * Shop buy rate limiter
 * Purchasing items from NPC shops
 * Base: 30/min - shopping can involve multiple transactions
 */
export const shopBuyLimiter = createLimiter({
  name: 'economy:shop_buy',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 30,           // Base: 30, Prod: 60, Dev: 150
  message: 'Too many purchase attempts. Please wait a moment.',
  useUserKey: true
});

/**
 * Shop sell rate limiter
 * Selling items to NPC shops
 * Base: 30/min - selling can involve multiple transactions
 */
export const shopSellLimiter = createLimiter({
  name: 'economy:shop_sell',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 30,           // Base: 30, Prod: 60, Dev: 150
  message: 'Too many sell attempts. Please wait a moment.',
  useUserKey: true
});

/**
 * Fast travel rate limiter
 * Uses the Wayfarer's Compass relic - costs gold
 * Base: 10/min - fast travel is occasional
 */
export const fastTravelLimiter = createLimiter({
  name: 'economy:fast_travel',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 10,           // Base: 10, Prod: 20, Dev: 50
  message: 'Too many fast travel attempts. Please wait a moment.',
  useUserKey: true
});

/**
 * Discovery claim rate limiter
 * For unlocking lore/discovery content at discovery nodes
 * Base: 10/min - discoveries are one-time per node
 */
export const discoveryLimiter = createLimiter({
  name: 'economy:discovery',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 10,           // Base: 10, Prod: 20, Dev: 50
  message: 'Too many discovery attempts. Please wait a moment.',
  useUserKey: true
});

/**
 * Fishing activity rate limiter
 * Fishing earns fish that can be sold for gold
 * Base: 90/min - one attempt includes cast/release/hook, up to four cue
 * actions, and resolve. Phase validation is the primary anti-spam boundary.
 */
export const fishingLimiter = createLimiter({
  name: 'economy:fishing',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 90,           // Base: 90, Prod: 180, Dev: 450
  message: 'Too many fishing actions. Please wait a moment.',
  useUserKey: true
});
