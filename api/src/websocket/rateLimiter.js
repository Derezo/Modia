/**
 * @module WebSocketRateLimiter
 * @description WebSocket message rate limiting with Redis and in-memory fallback.
 *
 * Key responsibilities:
 * - Per-user rate limiting for WebSocket messages
 * - Category-based rate limits (chat, reactions, typing, room joins)
 * - Global rate limit enforcement
 * - Redis sliding window implementation with in-memory fallback
 *
 * Rate limit categories:
 * - global: 100 messages per 5 minutes (all message types)
 * - chat: 30 messages per minute (chat_message, private_message)
 * - reactions: 20 per minute (add_reaction, remove_reaction)
 * - typing: 60 per minute (typing_indicator)
 * - roomJoins: 30 per minute (join_room, join_battle, join_node)
 *
 * @see index.js - Main WebSocket handler that uses this module
 */

import { getRedisClient, isRedisConnected } from '../config/redis.js';

// ============================================================
// Rate Limit Configuration
// ============================================================

const WS_RATE_LIMITS = {
  global: { limit: 100, windowMs: 5 * 60 * 1000 },    // 100 per 5 min
  chat: { limit: 30, windowMs: 60 * 1000 },           // 30 per min
  reactions: { limit: 20, windowMs: 60 * 1000 },      // 20 per min
  typing: { limit: 60, windowMs: 60 * 1000 },         // 60 per min
  roomJoins: { limit: 30, windowMs: 60 * 1000 }       // 30 per min
};

const MESSAGE_CATEGORIES = {
  chat_message: 'chat',
  private_message: 'chat',
  add_reaction: 'reactions',
  remove_reaction: 'reactions',
  typing_indicator: 'typing',
  join_room: 'roomJoins',
  join_battle: 'roomJoins',
  join_node: 'roomJoins'
};

// Infrastructure messages that should bypass rate limiting entirely
// These are essential for connection health and reliability
const INFRASTRUCTURE_MESSAGES = new Set([
  'heartbeat',
  'ack',
  'battle:request_sync',
  'pong'
]);

/**
 * Check if a message type is an infrastructure message that should bypass rate limiting.
 * Infrastructure messages are essential for connection health and reliability.
 * @param {string} messageType - WebSocket message type
 * @returns {boolean} True if the message should bypass rate limiting
 */
function isInfrastructureMessage(messageType) {
  return INFRASTRUCTURE_MESSAGES.has(messageType);
}

// Per-user rate tracking (in-memory fallback): userId -> { global: [timestamps], ... }
const userRateLimits = new Map();

// ============================================================
// Redis Rate Limiting
// ============================================================

/**
 * Check rate limit using Redis sorted sets (sliding window)
 * @param {import('redis').RedisClientType} redisClient - Redis client
 * @param {number} userId - User ID
 * @param {string} category - Rate limit category
 * @param {Object} config - { limit, windowMs }
 * @returns {Promise<{ limited: boolean, retryAfter?: number }>}
 */
async function checkRedisRateLimit(redisClient, userId, category, config) {
  const key = `ws:rl:${userId}:${category}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;

  try {
    // Use a Redis transaction to atomically check and update
    const multi = redisClient.multi();

    // Remove expired entries
    multi.zRemRangeByScore(key, 0, windowStart);

    // Count current entries
    multi.zCard(key);

    // Add new entry
    multi.zAdd(key, { score: now, value: `${now}` });

    // Set key expiration (slightly longer than window to handle edge cases)
    multi.expire(key, Math.ceil(config.windowMs / 1000) + 60);

    const results = await multi.exec();
    const count = results[1]; // zCard result

    if (count >= config.limit) {
      // Get the oldest timestamp to calculate retry-after
      const oldest = await redisClient.zRange(key, 0, 0);
      const oldestTime = oldest.length > 0 ? parseInt(oldest[0], 10) : now;
      const retryAfter = config.windowMs - (now - oldestTime);
      return { limited: true, retryAfter: Math.max(0, retryAfter) };
    }

    return { limited: false };
  } catch (err) {
    console.warn('[WS RateLimit] Redis error, falling back to in-memory:', err.message);
    return { limited: false }; // Fail open on Redis errors
  }
}

// ============================================================
// In-Memory Rate Limiting (Fallback)
// ============================================================

/**
 * Check rate limit using in-memory storage
 * @param {number} userId - User ID
 * @param {string} category - Rate limit category (or null for global only)
 * @returns {{ limited: boolean, category?: string, retryAfter?: number }}
 */
function checkInMemoryRateLimit(userId, category) {
  const now = Date.now();

  if (!userRateLimits.has(userId)) {
    userRateLimits.set(userId, {
      global: [],
      chat: [],
      reactions: [],
      typing: [],
      roomJoins: []
    });
  }

  const userLimits = userRateLimits.get(userId);

  // Check global limit first
  const globalConfig = WS_RATE_LIMITS.global;
  userLimits.global = userLimits.global.filter(t => now - t < globalConfig.windowMs);
  if (userLimits.global.length >= globalConfig.limit) {
    const oldestTimestamp = userLimits.global[0];
    const retryAfter = globalConfig.windowMs - (now - oldestTimestamp);
    return { limited: true, category: 'global', retryAfter };
  }
  userLimits.global.push(now);

  // Check category-specific limit if applicable
  if (category && WS_RATE_LIMITS[category]) {
    const catConfig = WS_RATE_LIMITS[category];
    userLimits[category] = userLimits[category].filter(t => now - t < catConfig.windowMs);
    if (userLimits[category].length >= catConfig.limit) {
      const oldestTimestamp = userLimits[category][0];
      const retryAfter = catConfig.windowMs - (now - oldestTimestamp);
      return { limited: true, category, retryAfter };
    }
    userLimits[category].push(now);
  }

  return { limited: false };
}

// ============================================================
// Public API
// ============================================================

/**
 * Check if a user's message should be rate limited
 * Uses Redis if available, falls back to in-memory
 * @param {number} userId - User ID
 * @param {string} messageType - WebSocket message type
 * @returns {Promise<{ limited: boolean, category?: string, retryAfter?: number }>}
 */
async function checkRateLimit(userId, messageType) {
  // Skip in test environment
  if (process.env.NODE_ENV === 'test') {
    return { limited: false };
  }

  const category = MESSAGE_CATEGORIES[messageType];

  // Try Redis first if connected
  if (isRedisConnected()) {
    try {
      const redisClient = await getRedisClient();
      if (redisClient) {
        // Check global limit
        const globalConfig = WS_RATE_LIMITS.global;
        const globalResult = await checkRedisRateLimit(redisClient, userId, 'global', globalConfig);
        if (globalResult.limited) {
          return { limited: true, category: 'global', retryAfter: globalResult.retryAfter };
        }

        // Check category-specific limit
        if (category && WS_RATE_LIMITS[category]) {
          const catConfig = WS_RATE_LIMITS[category];
          const catResult = await checkRedisRateLimit(redisClient, userId, category, catConfig);
          if (catResult.limited) {
            return { limited: true, category, retryAfter: catResult.retryAfter };
          }
        }

        return { limited: false };
      }
    } catch (err) {
      console.warn('[WS RateLimit] Redis check failed:', err.message);
      // Fall through to in-memory
    }
  }

  // In-memory fallback
  return checkInMemoryRateLimit(userId, category);
}

/**
 * Clean up rate limit tracking for a disconnected user
 * @param {number} userId - User ID
 */
function cleanupUserRateLimits(userId) {
  // Clear in-memory tracking
  userRateLimits.delete(userId);

  // Note: Redis keys auto-expire via TTL, no cleanup needed
}

/**
 * Get the rate limit category for a message type
 * @param {string} messageType - WebSocket message type
 * @returns {string|undefined} Category name or undefined if no category
 */
function getMessageCategory(messageType) {
  return MESSAGE_CATEGORIES[messageType];
}

/**
 * Get rate limit configuration
 * @returns {Object} Rate limit configuration object
 */
function getRateLimitConfig() {
  return { ...WS_RATE_LIMITS };
}

export {
  checkRateLimit,
  cleanupUserRateLimits,
  getMessageCategory,
  getRateLimitConfig,
  isInfrastructureMessage,
  WS_RATE_LIMITS,
  MESSAGE_CATEGORIES,
  INFRASTRUCTURE_MESSAGES
};

export default {
  checkRateLimit,
  cleanupUserRateLimits,
  getMessageCategory,
  getRateLimitConfig,
  isInfrastructureMessage
};
