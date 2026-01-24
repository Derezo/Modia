import { createLimiter } from './rateLimiterFactory.js';

/**
 * Rate limiters for social features
 *
 * These endpoints manage friend requests, blocks, and clan operations.
 * Social features need limits to prevent harassment and spam.
 *
 * All use per-user limiting (useUserKey: true).
 */

/**
 * Friend request rate limiter
 * Limit friend requests to prevent spam/harassment
 * Base: 20/min - allows reasonable social activity
 */
export const friendRequestLimiter = createLimiter({
  name: 'social:friend_request',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 20,           // Base: 20, Prod: 40, Dev: 100
  message: 'Too many friend requests. Please wait a moment.',
  useUserKey: true
});

/**
 * Friend action rate limiter
 * For accepting/declining requests, removing friends
 * Base: 30/min - managing friends list can involve multiple actions
 */
export const friendActionLimiter = createLimiter({
  name: 'social:friend_action',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 30,           // Base: 30, Prod: 60, Dev: 150
  message: 'Too many friend actions. Please wait a moment.',
  useUserKey: true
});

/**
 * Block user rate limiter
 * Blocking is a moderation action that should be infrequent
 * Base: 10/min - blocking should be deliberate
 */
export const blockUserLimiter = createLimiter({
  name: 'social:block',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 10,           // Base: 10, Prod: 20, Dev: 50
  message: 'Too many block actions. Please wait a moment.',
  useUserKey: true
});

/**
 * Clan creation rate limiter
 * Creating a clan is a significant action
 * Base: 2/15min - clans are permanent, creation should be deliberate
 */
export const clanCreateLimiter = createLimiter({
  name: 'social:clan_create',
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 2,            // Base: 2, Prod: 4, Dev: 10
  message: 'Too many clan creation attempts. Please wait before creating another clan.',
  useUserKey: true
});

/**
 * Clan invite rate limiter
 * Inviting members to a clan
 * Base: 20/min - allows reasonable recruiting activity
 */
export const clanInviteLimiter = createLimiter({
  name: 'social:clan_invite',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 20,           // Base: 20, Prod: 40, Dev: 100
  message: 'Too many clan invites. Please wait a moment.',
  useUserKey: true
});

/**
 * Clan message rate limiter
 * Sending messages to clan chat
 * Base: 30/min - allows active chat participation
 */
export const clanMessageLimiter = createLimiter({
  name: 'social:clan_message',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 30,           // Base: 30, Prod: 60, Dev: 150
  message: 'Too many clan messages. Please wait a moment.',
  useUserKey: true
});

/**
 * Clan management rate limiter
 * For clan settings, promotions, kicks, disbanding
 * Base: 20/min - management actions are less frequent
 */
export const clanManageLimiter = createLimiter({
  name: 'social:clan_manage',
  windowMs: 60 * 1000,       // 1 minute
  maxRequests: 20,           // Base: 20, Prod: 40, Dev: 100
  message: 'Too many clan management actions. Please wait a moment.',
  useUserKey: true
});
